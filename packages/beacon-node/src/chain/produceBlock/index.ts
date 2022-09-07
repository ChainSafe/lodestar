import {CachedBeaconStateAllForks, stateTransition} from "@lodestar/state-transition";
import {allForks, Root} from "@lodestar/types";
import {fromHexString} from "@chainsafe/ssz";

import {ZERO_HASH} from "../../constants/index.js";
import {IMetrics} from "../../metrics/index.js";
import {RegenCaller} from "../regen/index.js";
import type {BeaconChain} from "../chain.js";
import {produceBlockBody, BlockType, AssembledBlockType, BlockAttributes} from "./produceBlockBody.js";

export {BlockType, AssembledBlockType};

export async function produceBlock<T extends BlockType>(
  this: BeaconChain,
  blockType: T,
  {randaoReveal, graffiti, slot}: BlockAttributes
): Promise<AssembledBlockType<T>> {
  const head = this.forkChoice.getHead();
  const state = await this.regen.getBlockSlotState(head.blockRoot, slot, RegenCaller.produceBlock);
  const parentBlockRoot = fromHexString(head.blockRoot);
  const proposerIndex = state.epochCtx.getBeaconProposer(slot);
  const proposerPubKey = state.epochCtx.index2pubkey[proposerIndex]?.toBytes();
  // if (!proposerPubKey) throw Error("proposerPubKey not found");

  const block = {
    slot,
    proposerIndex,
    parentRoot: parentBlockRoot,
    stateRoot: ZERO_HASH,
    body: await produceBlockBody.call(this, blockType, state, {
      randaoReveal,
      graffiti,
      slot,
      parentSlot: slot - 1,
      parentBlockRoot,
      proposerIndex,
      proposerPubKey,
    }),
  } as AssembledBlockType<T>;

  block.stateRoot = computeNewStateRoot(this.metrics, state, block);

  return block;
}

/**
 * Instead of running fastStateTransition(), only need to process block since
 * state is processed until block.slot already (this is to avoid double
 * epoch transition which happen at slot % 32 === 0)
 */
function computeNewStateRoot(
  metrics: IMetrics | null,
  state: CachedBeaconStateAllForks,
  block: allForks.FullOrBlindedBeaconBlock
): Root {
  // Set signature to zero to re-use stateTransition() function which requires the SignedBeaconBlock type
  const blockEmptySig = {message: block, signature: ZERO_HASH} as allForks.FullOrBlindedSignedBeaconBlock;

  const postState = stateTransition(
    state,
    blockEmptySig,
    // verifyStateRoot: false  | the root in the block is zero-ed, it's being computed here
    // verifyProposer: false   | as the block signature is zero-ed
    // verifySignatures: false | since the data to assemble the block is trusted
    {verifyStateRoot: false, verifyProposer: false, verifySignatures: false},
    metrics
  );

  return postState.hashTreeRoot();
}
