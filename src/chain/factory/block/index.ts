/**
 * @module chain/blockAssembly
 */

import {
  BeaconBlock,
  BeaconBlockBody,
  BeaconBlockHeader,
  BeaconState,
  bytes96,
  Slot
} from "../../../types";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import {BeaconDB} from "../../../db/api";
import {OpPool} from "../../../opPool";
import {assembleBody} from "./body";
import {processBlock} from "../../stateTransition/block";

export async function assembleBlock(
  db: BeaconDB,
  opPool: OpPool,
  slot: Slot,
  randao: bytes96
): Promise<BeaconBlock> {
  const [parentBlock, currentState] = await Promise.all([
    db.getChainHead(),
    db.getState(),
  ]);
  const parentHeader: BeaconBlockHeader = {
    stateRoot: parentBlock.stateRoot,
    signature: parentBlock.signature,
    slot: parentBlock.slot,
    parentRoot: parentBlock.parentRoot,
    bodyRoot: hashTreeRoot(parentBlock.body, BeaconBlockBody),
  };
  const block: BeaconBlock = {
    slot,
    parentRoot: signingRoot(parentHeader, BeaconBlockHeader),
    signature: undefined,
    stateRoot: undefined,
    body: await assembleBody(opPool, currentState, randao),
  };

  //This will effectively copy state so we avoid modifying existing state
  const nextState = {...currentState};
  processBlock(nextState, block);

  block.stateRoot = hashTreeRoot(nextState, BeaconState);

  return block;
}
