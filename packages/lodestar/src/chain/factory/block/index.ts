/**
 * @module chain/blockAssembly
 */

import {CachedBeaconStateAllForks, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {Bytes32, Bytes96, Root, Slot} from "@chainsafe/lodestar-types";
import {fromHexString} from "@chainsafe/ssz";

import {ZERO_HASH} from "../../../constants";
import {IMetrics} from "../../../metrics";
import {IBeaconChain} from "../../interface";
import {assembleBody} from "./body";
import {RegenCaller} from "../../regen";

type AssembleBlockModules = {
  chain: IBeaconChain;
  metrics: IMetrics | null;
};

export async function assembleBlock(
  {chain, metrics}: AssembleBlockModules,
  {
    randaoReveal,
    graffiti,
    slot,
  }: {
    randaoReveal: Bytes96;
    graffiti: Bytes32;
    slot: Slot;
  }
): Promise<allForks.BeaconBlock> {
  const head = chain.forkChoice.getHead();
  const state = await chain.regen.getBlockSlotState(head.blockRoot, slot, RegenCaller.produceBlock);
  const parentBlockRoot = fromHexString(head.blockRoot);
  const proposerIndex = state.epochCtx.getBeaconProposer(slot);

  const block: allForks.BeaconBlock = {
    slot,
    proposerIndex,
    parentRoot: parentBlockRoot,
    stateRoot: ZERO_HASH,
    body: await assembleBody(chain, state, {
      randaoReveal,
      graffiti,
      blockSlot: slot,
      parentSlot: slot - 1,
      parentBlockRoot,
      proposerIndex,
    }),
  };

  block.stateRoot = computeNewStateRoot({metrics}, state, block);

  return block;
}

/**
 * Instead of running fastStateTransition(), only need to process block since
 * state is processed until block.slot already (this is to avoid double
 * epoch transition which happen at slot % 32 === 0)
 */
function computeNewStateRoot(
  {metrics}: {metrics: IMetrics | null},
  state: CachedBeaconStateAllForks,
  block: allForks.BeaconBlock
): Root {
  const postState = state.clone();
  // verifySignatures = false since the data to assemble the block is trusted
  allForks.processBlock(postState, block, {verifySignatures: false}, metrics);

  return postState.hashTreeRoot();
}
