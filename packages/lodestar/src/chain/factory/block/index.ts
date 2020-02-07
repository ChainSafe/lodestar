/**
 * @module chain/blockAssembly
 */

import {BeaconBlock, BeaconBlockHeader, Bytes96, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {IBeaconDb} from "../../../db/api";
import {OpPool} from "../../../opPool";
import {assembleBody} from "./body";
import {IEth1Notifier} from "../../../eth1";
import {processSlots, stateTransition, blockToHeader} from "@chainsafe/eth2.0-state-transition";
import {IBeaconChain} from "../../interface";
import {EMPTY_SIGNATURE} from "../../../constants";


export async function assembleBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  opPool: OpPool,
  eth1: IEth1Notifier,
  slot: Slot,
  randao: Bytes96
): Promise<BeaconBlock | null> {
  const parentBlock = await db.block.get(chain.forkChoice.head());
  const currentState = await db.state.get(parentBlock.message.stateRoot);

  if (slot > currentState.slot) {
    processSlots(config, currentState, slot);
  }
  const depositDataRootList = await db.depositDataRootList.get(currentState.eth1DepositIndex);
  const parentHeader: BeaconBlockHeader = blockToHeader(config, parentBlock.message);
  const block: BeaconBlock = {
    slot,
    parentRoot: config.types.BeaconBlockHeader.hashTreeRoot(parentHeader),
    stateRoot: undefined,
    body: await assembleBody(config, opPool, eth1, depositDataRootList, currentState, randao),
  };

  block.stateRoot = config.types.BeaconState.hashTreeRoot(
    stateTransition(config, currentState, {message: block, signature: EMPTY_SIGNATURE}, false, false, true),
  );

  return block;
}
