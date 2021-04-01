/**
 * @module chain/blockAssembly
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Bytes96, Root, Slot} from "@chainsafe/lodestar-types";
import {ZERO_HASH} from "../../../constants";
import {IBeaconDb} from "../../../db";
import {IEth1ForBlockProduction} from "../../../eth1";
import {IBeaconChain} from "../../interface";
import {assembleBody} from "./body";
import {CachedBeaconState, phase0} from "@chainsafe/lodestar-beacon-state-transition";

export async function assembleBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  eth1: IEth1ForBlockProduction,
  slot: Slot,
  randaoReveal: Bytes96,
  graffiti = ZERO_HASH
): Promise<phase0.BeaconBlock> {
  const head = chain.forkChoice.getHead();
  const state = await chain.regen.getBlockSlotState(head.blockRoot, slot);

  const block: phase0.BeaconBlock = {
    slot,
    proposerIndex: state.getBeaconProposer(slot),
    parentRoot: head.blockRoot,
    stateRoot: ZERO_HASH,
    body: await assembleBody(config, db, eth1, state as CachedBeaconState<phase0.BeaconState>, randaoReveal, graffiti),
  };
  block.stateRoot = computeNewStateRoot(config, state as CachedBeaconState<phase0.BeaconState>, block);

  return block;
}

/**
 * Instead of running fastStateTransition(), only need to process block since
 * state is processed until block.slot already (this is to avoid double
 * epoch transition which happen at slot % 32 === 0)
 */
function computeNewStateRoot(
  config: IBeaconConfig,
  state: CachedBeaconState<phase0.BeaconState>,
  block: phase0.BeaconBlock
): Root {
  const postState = state.clone();
  // verifySignatures = false since the data to assemble the block is trusted
  phase0.fast.processBlock(postState, block, false);

  return config.types.phase0.BeaconState.hashTreeRoot(postState);
}
