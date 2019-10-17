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
import {processSlots, stateTransition} from "@chainsafe/eth2.0-state-transition";
import {IBeaconChain} from "../../interface";
import {blockToHeader} from "@chainsafe/eth2.0-state-transition";

export async function assembleBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  opPool: OpPool,
  eth1: IEth1Notifier,
  slot: Slot,
  randao: bytes96
): Promise<BeaconBlock|null> {
  const [parentBlock, currentState] = await Promise.all([
    db.block.get(chain.forkChoice.head()),
    db.state.getLatest(),
  ]);
  if(slot > currentState.slot) {
    processSlots(config, currentState, slot);
  }
  const merkleTree = await db.merkleTree.getProgressiveMerkleTree(config, currentState.eth1DepositIndex);
  const parentHeader: BeaconBlockHeader = blockToHeader(config, parentBlock);
  const block: BeaconBlock = {
    slot,
    parentRoot: signingRoot(parentHeader, config.types.BeaconBlockHeader),
    // @ts-ignore
    signature: undefined,
    // @ts-ignore
    stateRoot: undefined,
    body: await assembleBody(config, opPool, eth1, merkleTree, currentState, randao),
  };

  block.stateRoot = hashTreeRoot(
    stateTransition(config, currentState, block, false, false),
    config.types.BeaconState
  );

  return block;
}
