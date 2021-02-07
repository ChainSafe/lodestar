/**
 * @module chain/blockAssembly
 */

import {processBlock} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconBlock, BeaconState, Bytes96, Root, Slot} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {ZERO_HASH} from "../../../constants";
import {IBeaconDb} from "../../../db/api";
import {ITreeStateContext} from "../../../chain/stateContextCache";
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
  const stateContext = await chain.regen.getBlockSlotState(head.blockRoot, slot);

  const block: BeaconBlock = {
    slot,
    proposerIndex: stateContext.epochCtx.getBeaconProposer(slot),
    parentRoot: head.blockRoot,
    stateRoot: ZERO_HASH,
    body: await assembleBody(
      config,
      db,
      eth1,
      stateContext.state.getOriginalState() as TreeBacked<BeaconState>,
      randaoReveal,
      graffiti
    ),
  };
  block.stateRoot = computeNewStateRoot(config, stateContext, block);

  return block;
}

/**
 * Instead of running fastStateTransition(), only need to process block since
 * stateContext is processed until block.slot already (this is to avoid double
 * epoch transition which happen at slot % 32 === 0)
 */
function computeNewStateRoot(config: IBeaconConfig, stateContext: ITreeStateContext, block: BeaconBlock): Root {
  const postState = {
    state: stateContext.state.clone(),
    epochCtx: stateContext.epochCtx.copy(),
  };
  processBlock(postState.epochCtx, postState.state, block, true);

  return config.types.BeaconState.hashTreeRoot(postState.state);
}
