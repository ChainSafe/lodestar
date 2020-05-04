/**
 * @module chain/blockAssembly
 */

import {BeaconBlock, BeaconBlockHeader, Bytes96, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IBeaconDb} from "../../../db/api";
import {assembleBody} from "./body";
import {processSlots, stateTransition, blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
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
  const parentBlock = await db.block.get(chain.forkChoice.head());
  const currentState = await db.state.get(parentBlock.message.stateRoot.valueOf() as Uint8Array);

  if (slot > currentState.slot) {
    processSlots(config, currentState, slot);
  }
  const parentHeader: BeaconBlockHeader = blockToHeader(config, parentBlock.message);
  const block: BeaconBlock = {
    slot,
    proposerIndex,
    parentRoot: config.types.BeaconBlockHeader.hashTreeRoot(parentHeader),
    stateRoot: undefined,
    body: await assembleBody(config, db, currentState, randaoReveal, graffiti),
  };

  block.stateRoot = config.types.BeaconState.hashTreeRoot(
    stateTransition(config, currentState, {message: block, signature: EMPTY_SIGNATURE}, false, false, true),
  );

  return block;
}
