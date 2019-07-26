/**
 * @module chain/stateTransition/util
 */

import assert from "assert";
import {hashTreeRoot} from "@chainsafe/ssz";

import {
  EMPTY_SIGNATURE,
  ZERO_HASH,
} from "../../../constants";
import {
  BeaconBlock,
  BeaconBlockHeader,
  BeaconState,
  Epoch,
  Hash,
  Slot,
} from "../../../types";
import {IBeaconConfig} from "../../../config";

import {computeStartSlotOfEpoch} from "./epoch";


/**
 * Return the block root at a recent [[slot]].
 */
export function getBlockRootAtSlot(config: IBeaconConfig, state: BeaconState, slot: Slot): Hash {
  assert(slot < state.slot);
  assert(state.slot <= slot + config.params.SLOTS_PER_HISTORICAL_ROOT);
  return state.blockRoots[slot % config.params.SLOTS_PER_HISTORICAL_ROOT];
}

/**
 * Return the block root at the start of a recent [[epoch]].
 */
export function getBlockRoot(config: IBeaconConfig, state: BeaconState, epoch: Epoch): Hash {
  return getBlockRootAtSlot(config, state, computeStartSlotOfEpoch(config, epoch));
}
/**
 * Return the block header corresponding to a block with ``state_root`` set to ``ZERO_HASH``.
 */
export function getTemporaryBlockHeader(config: IBeaconConfig, block: BeaconBlock): BeaconBlockHeader {
  return {
    slot: block.slot,
    parentRoot: block.parentRoot,
    stateRoot: ZERO_HASH,
    bodyRoot: hashTreeRoot(block.body, config.types.BeaconBlockBody),
    signature: EMPTY_SIGNATURE,
  };
}
