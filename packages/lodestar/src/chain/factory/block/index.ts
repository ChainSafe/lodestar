/**
 * @module chain/blockAssembly
 */

import {BeaconBlock, BeaconBlockHeader, Bytes96, Slot, ValidatorIndex, BeaconState,
  Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IBeaconDb} from "../../../db/api";
import {assembleBody} from "./body";
import {blockToHeader, fastStateTransition} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain} from "../../interface";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../../constants";


export async function assembleBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  slot: Slot,
  proposerIndex: ValidatorIndex,
  randaoReveal: Bytes96,
  graffiti = ZERO_HASH,
): Promise<BeaconBlock | null> {
  const parentBlock = await chain.getHeadBlock();
  const currentState = await chain.getHeadState();
  const parentHeader: BeaconBlockHeader = blockToHeader(config, parentBlock.message);
  const block: BeaconBlock = {
    slot,
    proposerIndex,
    parentRoot: config.types.BeaconBlockHeader.hashTreeRoot(parentHeader),
    stateRoot: undefined,
    body: await assembleBody(config, db, {...currentState, slot}, randaoReveal, graffiti),
  };


  block.stateRoot = computeNewStateRoot(config, currentState, block, chain);

  return block;
}

function computeNewStateRoot(config: IBeaconConfig, state: BeaconState, block: BeaconBlock, chain: IBeaconChain): Root {
  // state is cloned from the cache already
  const epochContext = chain.epochCtx.copy();
  const signedBlock = {
    message: block,
    signature: EMPTY_SIGNATURE,
  };
  const newState = fastStateTransition(epochContext, state, signedBlock, false, false, true);
  return config.types.BeaconState.hashTreeRoot(newState);
}
