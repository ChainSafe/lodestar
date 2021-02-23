/**
 * @module chain/blockAssembly
 */

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Bytes96, Root, Slot} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {ZERO_HASH} from "../../../constants";
import {IBeaconDb} from "../../../db/api";
import {IEth1ForBlockProduction} from "../../../eth1";
import {IBeaconChain, ITreeStateContext} from "../../interface";
import {assembleBody} from "./body";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";

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
  const stateContext = await chain.regen.getBlockSlotState(head.blockRoot, slot);

  const block: phase0.BeaconBlock = {
    slot,
    proposerIndex: stateContext.epochCtx.getBeaconProposer(slot),
    parentRoot: head.blockRoot,
    stateRoot: ZERO_HASH,
    body: await assembleBody(
      config,
      db,
      eth1,
      stateContext.state.getOriginalState() as TreeBacked<phase0.BeaconState>,
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
function computeNewStateRoot(config: IBeaconConfig, stateContext: ITreeStateContext, block: phase0.BeaconBlock): Root {
  const postState = {
    state: stateContext.state.clone(),
    epochCtx: stateContext.epochCtx.copy(),
  };
  phase0.fast.processBlock(postState.epochCtx, postState.state, block, true);

  return config.types.phase0.BeaconState.hashTreeRoot(postState.state);
}
