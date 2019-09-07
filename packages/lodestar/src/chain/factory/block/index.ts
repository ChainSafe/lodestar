/**
 * @module chain/blockAssembly
 */

import {BeaconBlock, BeaconBlockHeader, bytes96, Slot} from "@chainsafe/eth2.0-types";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {IBeaconDb} from "../../../db/api";
import {OpPool} from "../../../opPool";
import {assembleBody} from "./body";
import {IEth1Notifier} from "../../../eth1";
import {stateTransition} from "../../stateTransition";

export async function assembleBlock(
  config: IBeaconConfig,
  db: IBeaconDb,
  opPool: OpPool,
  eth1: IEth1Notifier,
  slot: Slot,
  randao: bytes96
): Promise<BeaconBlock> {
  const [parentBlock, currentState] = await Promise.all([
    db.block.getChainHead(),
    db.state.getLatest(),
  ]);
  const merkleTree = await db.merkleTree.getProgressiveMerkleTree(currentState.eth1DepositIndex);
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
