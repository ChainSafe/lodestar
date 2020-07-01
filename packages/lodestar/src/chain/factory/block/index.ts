/**
 * @module chain/blockAssembly
 */

import {BeaconBlock, BeaconBlockHeader, Bytes96, Slot, ValidatorIndex, BeaconState,
  Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IBeaconDb} from "../../../db/api";
import {assembleBody} from "./body";
import {blockToHeader, stateTransition} from "@chainsafe/lodestar-beacon-state-transition";
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
  const [parentBlock, currentState] = await Promise.all([
    chain.getHeadBlock(),
    chain.getHeadState()
  ]);
  const parentHeader: BeaconBlockHeader = blockToHeader(config, parentBlock.message);
  const block: BeaconBlock = {
    slot,
    proposerIndex,
    parentRoot: config.types.BeaconBlockHeader.hashTreeRoot(parentHeader),
    stateRoot: undefined,
    body: await assembleBody(config, db, {...currentState, slot}, randaoReveal, graffiti),
  };


  block.stateRoot = computeNewStateRoot(config, currentState, block);

  return block;
}

function computeNewStateRoot(config: IBeaconConfig, state: BeaconState, block: BeaconBlock): Root {
  // state is cloned from the cache already
  const signedBlock = {
    message: block,
    signature: EMPTY_SIGNATURE,
  };
  const newState = stateTransition(config, state, signedBlock, false, false, true);
  return config.types.BeaconState.hashTreeRoot(newState);
}
