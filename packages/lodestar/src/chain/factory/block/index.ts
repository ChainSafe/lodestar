/**
 * @module chain/blockAssembly
 */

import {processBlock} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconBlock, Bytes96, Root, Slot} from "@chainsafe/lodestar-types";
import {ZERO_HASH} from "../../../constants";
import {IBeaconDb} from "../../../db/api";
import {IEth1ForBlockProduction} from "../../../eth1";
import {IBeaconChain} from "../../interface";
import {assembleBody} from "./body";

export async function assembleBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  eth1: IEth1ForBlockProduction,
  slot: Slot,
  randaoReveal: Bytes96,
  graffiti = ZERO_HASH
): Promise<BeaconBlock> {
  const head = chain.forkChoice.getHead();
  const headCachedState = await chain.regen.getBlockSlotState(head.blockRoot, slot);

  const block: BeaconBlock = {
    slot,
    proposerIndex: headCachedState.getBeaconProposer(slot),
    parentRoot: head.blockRoot,
    stateRoot: ZERO_HASH,
    body: await assembleBody(config, db, eth1, headCachedState.getTreeBackedState(), randaoReveal, graffiti),
  };
  block.stateRoot = computeNewStateRoot(config, headCachedState, block);

  return block;
}

/**
 * Instead of running fastStateTransition(), only need to process block since
 * stateContext is processed until block.slot already (this is to avoid double
 * epoch transition which happen at slot % 32 === 0)
 */
function computeNewStateRoot(config: IBeaconConfig, cachedState: CachedBeaconState, block: BeaconBlock): Root {
  const postState = cachedState.clone();
  processBlock(postState, block, true);

  return postState.getTreeBackedState().hashTreeRoot();
}
