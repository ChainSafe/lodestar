/**
 * @module chain/stateTransition/util
 */

import {Epoch, Slot, Root, phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert} from "@chainsafe/lodestar-utils";

import {ZERO_HASH} from "../constants";
import {computeStartSlotAtEpoch} from "./epoch";
import { BeaconState } from ".";

/**
 * Return the block root at a recent [[slot]].
 */
export function getBlockRootAtSlot(config: IBeaconConfig, state: BeaconState, slot: Slot): Root {
  assert.lt(slot, state.slot, "Cannot get block root for slot in the future");
  assert.lte(
    state.slot,
    slot + config.params.SLOTS_PER_HISTORICAL_ROOT,
    `Cannot get block root from slot more than ${config.params.SLOTS_PER_HISTORICAL_ROOT} in the past`
  );
  return state.blockRoots[slot % config.params.SLOTS_PER_HISTORICAL_ROOT];
}

/**
 * Return the block root at the start of a recent [[epoch]].
 */
export function getBlockRoot(config: IBeaconConfig, state: BeaconState, epoch: Epoch): Root {
  return getBlockRootAtSlot(config, state, computeStartSlotAtEpoch(config, epoch));
}
/**
 * Return the block header corresponding to a block with ``state_root`` set to ``ZERO_HASH``.
 */
export function getTemporaryBlockHeader(config: IBeaconConfig, block: phase0.BeaconBlock): phase0.BeaconBlockHeader {
  return {
    slot: block.slot,
    proposerIndex: block.proposerIndex,
    parentRoot: block.parentRoot,
    // `state_root` is zeroed and overwritten in the next `process_slot` call
    stateRoot: ZERO_HASH,
    bodyRoot: config.types.phase0.BeaconBlockBody.hashTreeRoot(block.body),
  };
}

/**
 * Receives a BeaconBlock, and produces the corresponding BeaconBlockHeader.
 */
export function blockToHeader(config: IBeaconConfig, block: phase0.BeaconBlock): phase0.BeaconBlockHeader {
  return {
    stateRoot: block.stateRoot,
    proposerIndex: block.proposerIndex,
    slot: block.slot,
    parentRoot: block.parentRoot,
    bodyRoot: config.types.phase0.BeaconBlockBody.hashTreeRoot(block.body),
  };
}

/**
 * Receives a SignedBeaconBlock, and produces the corresponding SignedBeaconBlockHeader.
 */
export function signedBlockToSignedHeader(
  config: IBeaconConfig,
  signedBlock: phase0.SignedBeaconBlock
): phase0.SignedBeaconBlockHeader {
  return {
    message: blockToHeader(config, signedBlock.message),
    signature: signedBlock.signature,
  };
}
