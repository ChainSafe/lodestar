/**
 * @module chain/blockAssembly
 */

import {BeaconBlock, BeaconBlockHeader, Bytes96, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IBeaconDb} from "../../../db/api";
import {assembleBody} from "./body";
import {blockToHeader, EpochContext, fastStateTransition} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain} from "../../interface";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../../constants";
import {IStateContext} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";


export async function assembleBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  slot: Slot,
  proposerIndex: ValidatorIndex,
  randaoReveal: Bytes96,
  graffiti = ZERO_HASH,
): Promise<BeaconBlock | null> {
  const [parentBlock, stateContext] = await Promise.all([
    chain.getHeadBlock(),
    chain.getHeadContext()
  ]);
  const parentHeader: BeaconBlockHeader = blockToHeader(config, parentBlock.message);
  stateContext.state.slot = slot;
  const block: BeaconBlock = {
    slot,
    proposerIndex,
    parentRoot: config.types.BeaconBlockHeader.hashTreeRoot(parentHeader),
    stateRoot: undefined,
    body: await assembleBody(config, db, stateContext.state, randaoReveal, graffiti),
  };

  let epochCtx: EpochContext;
  if(!stateContext.epochCtx) {
    epochCtx = new EpochContext(config);
    epochCtx.loadState(stateContext.state);
  } else {
    epochCtx = stateContext.epochCtx;
  }
  block.stateRoot = computeNewStateRoot(config, {state: stateContext.state, epochCtx}, block);

  return block;
}

function computeNewStateRoot(config: IBeaconConfig, stateContext: IStateContext, block: BeaconBlock): Root {
  // state is cloned from the cache already
  const signedBlock = {
    message: block,
    signature: EMPTY_SIGNATURE,
  };
  const newState = fastStateTransition(stateContext, signedBlock, false, false, true);
  return config.types.BeaconState.hashTreeRoot(newState.state);
}
