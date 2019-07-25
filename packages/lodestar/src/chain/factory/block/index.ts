/**
 * @module chain/blockAssembly
 */

import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import {BeaconBlock, BeaconBlockBody, BeaconBlockHeader, BeaconState, bytes96, Slot} from "../../../types";
import {IBeaconConfig} from "../../../config";
import {BeaconDB} from "../../../db/api";
import {OpPool} from "../../../opPool";
import {assembleBody} from "./body";
import {IEth1Notifier} from "../../../eth1";
import {stateTransition} from "../../stateTransition";

export async function assembleBlock(
  config: IBeaconConfig,
  db: BeaconDB,
  opPool: OpPool,
  eth1: IEth1Notifier,
  slot: Slot,
  randao: bytes96
): Promise<BeaconBlock> {
  const [parentBlock, currentState] = await Promise.all([
    db.getChainHead(),
    db.getLatestState(),
  ]);
  const merkleTree = await db.getMerkleTree(currentState.eth1DepositIndex);
  const parentHeader: BeaconBlockHeader = {
    stateRoot: parentBlock.stateRoot,
    signature: parentBlock.signature,
    slot: parentBlock.slot,
    parentRoot: parentBlock.parentRoot,
    bodyRoot: hashTreeRoot(parentBlock.body, config.types.BeaconBlockBody),
  };
  const block: BeaconBlock = {
    slot,
    parentRoot: signingRoot(parentHeader, config.types.BeaconBlockHeader),
    signature: undefined,
    stateRoot: undefined,
    body: await assembleBody(config, opPool, eth1, merkleTree, currentState, randao),
  };

  //This will effectively copy state so we avoid modifying existing state
  const nextState = {...currentState};
  stateTransition(config, nextState, block, false, false);

  block.stateRoot = hashTreeRoot(nextState, config.types.BeaconState);

  return block;
}
