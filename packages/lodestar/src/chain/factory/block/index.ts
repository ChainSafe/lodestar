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
import {processSlots, stateTransition, blockToHeader} from "@chainsafe/eth2.0-state-transition";
import {IBeaconChain} from "../../interface";


export async function assembleBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  opPool: OpPool,
  eth1: IEth1Notifier,
  slot: Slot,
  randao: bytes96
): Promise<BeaconBlock | null> {
  const parentBlock = await db.block.get(chain.forkChoice.head());
  const currentState = await db.state.get(parentBlock.stateRoot);

  if (slot > currentState.slot) {
    processSlots(config, currentState, slot);
  }
  const merkleTree = await db.merkleTree.getProgressiveMerkleTree(config, currentState.eth1DepositIndex);
  const parentHeader: BeaconBlockHeader = blockToHeader(config, parentBlock);
  const block: BeaconBlock = {
    slot,
    parentRoot: signingRoot(config.types.BeaconBlockHeader, parentHeader),
    signature: undefined,
    stateRoot: undefined,
    body: await assembleBody(config, opPool, eth1, merkleTree, currentState, randao),
  };

  block.stateRoot = hashTreeRoot(
    config.types.BeaconState,
    stateTransition(config, currentState, block, false, false, true),
  );

  return block;
}
