/**
 * @module chain/blockAssembly
 */

import {CachedBeaconState, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Bytes96, Root, Slot} from "@chainsafe/lodestar-types";
import {ZERO_HASH} from "../../../constants";
import {IBeaconDb} from "../../../db";
import {IEth1ForBlockProduction} from "../../../eth1";
import {IMetrics} from "../../../metrics";
import {IBeaconChain} from "../../interface";
import {assembleBody} from "./body";
import {RegenCaller} from "../../regen";

type AssembleBlockModules = {
  config: IChainForkConfig;
  chain: IBeaconChain;
  db: IBeaconDb;
  eth1: IEth1ForBlockProduction;
  metrics: IMetrics | null;
};

export async function assembleBlock(
  {config, chain, db, eth1, metrics}: AssembleBlockModules,
  slot: Slot,
  randaoReveal: Bytes96,
  graffiti = ZERO_HASH
): Promise<allForks.BeaconBlock> {
  const head = chain.forkChoice.getHead();
  const state = await chain.regen.getBlockSlotState(head.blockRoot, slot, RegenCaller.produceBlock);

  const block: allForks.BeaconBlock = {
    slot,
    proposerIndex: state.getBeaconProposer(slot),
    parentRoot: head.blockRoot,
    stateRoot: ZERO_HASH,
    body: await assembleBody({config, chain, db, eth1}, state, randaoReveal, graffiti, slot, {
      parentSlot: slot - 1,
      parentBlockRoot: head.blockRoot,
    }),
  };
  block.stateRoot = computeNewStateRoot({config, metrics}, state, block);

  return block;
}

/**
 * Instead of running fastStateTransition(), only need to process block since
 * state is processed until block.slot already (this is to avoid double
 * epoch transition which happen at slot % 32 === 0)
 */
function computeNewStateRoot(
  {config, metrics}: {config: IChainForkConfig; metrics: IMetrics | null},
  state: CachedBeaconState<allForks.BeaconState>,
  block: allForks.BeaconBlock
): Root {
  const postState = state.clone();
  // verifySignatures = false since the data to assemble the block is trusted
  allForks.processBlock(postState, block, {verifySignatures: false}, metrics);

  return config.getForkTypes(state.slot).BeaconState.hashTreeRoot(postState);
}
