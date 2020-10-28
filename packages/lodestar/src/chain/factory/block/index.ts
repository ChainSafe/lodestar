/**
 * @module chain/blockAssembly
 */

import {BeaconBlock, Bytes96, Root, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IBeaconDb} from "../../../db/api";
import {assembleBody} from "./body";
import {fastStateTransition} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain} from "../../interface";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../../constants";
import {IStateContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IEth1ForBlockProduction} from "../../../eth1";

export async function assembleBlock(
  config: IBeaconConfig,
  chain: IBeaconChain,
  db: IBeaconDb,
  eth1: IEth1ForBlockProduction,
  slot: Slot,
  proposerIndex: ValidatorIndex,
  randaoReveal: Bytes96,
  graffiti = ZERO_HASH
): Promise<BeaconBlock> {
  const head = chain.forkChoice.getHead();
  const stateContext = await chain.regen.getBlockSlotState(head.blockRoot, slot);
  const block: BeaconBlock = {
    slot,
    proposerIndex,
    parentRoot: head.blockRoot,
    stateRoot: ZERO_HASH,
    body: await assembleBody(config, db, eth1, stateContext.state, randaoReveal, graffiti),
  };

  const preStateContext = await chain.regen.getBlockSlotState(head.blockRoot, slot - 1);
  block.stateRoot = computeNewStateRoot(config, preStateContext, block);

  return block;
}

function computeNewStateRoot(config: IBeaconConfig, stateContext: IStateContext, block: BeaconBlock): Root {
  // state is cloned from the cache already
  const signedBlock = {
    message: block,
    signature: EMPTY_SIGNATURE,
  };
  const newState = fastStateTransition(stateContext, signedBlock, {
    verifyStateRoot: false,
    verifyProposer: false,
    verifySignatures: true,
  });
  return config.types.BeaconState.hashTreeRoot(newState.state);
}
