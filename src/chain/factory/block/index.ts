/**
 * @module chain/blockAssembly
 */

import {BeaconBlock, BeaconBlockBody, BeaconBlockHeader, BeaconState, bytes96, Slot} from "../../../types";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import {BeaconDB} from "../../../db/api";
import {OpPool} from "../../../opPool";
import {assembleBody} from "./body";
import {processBlock} from "../../stateTransition/block";
import {IEth1Notifier} from "../../../eth1";

export async function assembleBlock(
  db: BeaconDB,
  opPool: OpPool,
  eth1: IEth1Notifier,
  slot: Slot,
  randao: bytes96
): Promise<BeaconBlock> {
  const [parentBlock, currentState, merkleTree] = await Promise.all([
    db.getChainHead(),
    db.getState(),
    db.getMerkleTree()
  ]);
  const parentHeader: BeaconBlockHeader = {
    stateRoot: parentBlock.stateRoot,
    signature: parentBlock.signature,
    slot: parentBlock.slot,
    previousBlockRoot: parentBlock.previousBlockRoot,
    blockBodyRoot: hashTreeRoot(parentBlock.body, BeaconBlockBody),
  };
  const block: BeaconBlock = {
    slot,
    previousBlockRoot: signingRoot(parentHeader, BeaconBlockHeader),
    signature: undefined,
    stateRoot: undefined,
    body: await assembleBody(opPool, eth1, merkleTree, currentState, randao),
  };

  //This will effectively copy state so we avoid modifying existing state
  const nextState = {...currentState};
  processBlock(nextState, block, false);

  block.stateRoot = hashTreeRoot(nextState, BeaconState);

  return block;
}
