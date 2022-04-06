/**
 * @module chain/stateTransition/util
 */

import {Epoch, Slot, Root, phase0, allForks} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";

import {ZERO_HASH} from "../constants/index.js";
import {computeStartSlotAtEpoch} from "./epoch.js";
import {SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";
import {BeaconStateAllForks} from "../types.js";

/**
 * Return the block root at a recent [[slot]].
 */
export function getBlockRootAtSlot(state: BeaconStateAllForks, slot: Slot): Root {
  if (slot >= state.slot) {
    throw Error(`Can only get block root in the past currentSlot=${state.slot} slot=${slot}`);
  }
  if (slot < state.slot - SLOTS_PER_HISTORICAL_ROOT) {
    throw Error(`Cannot get block root more than ${SLOTS_PER_HISTORICAL_ROOT} in the past`);
  }
  return state.blockRoots.get(slot % SLOTS_PER_HISTORICAL_ROOT);
}

/**
 * Return the block root at the start of a recent [[epoch]].
 */
export function getBlockRoot(state: BeaconStateAllForks, epoch: Epoch): Root {
  return getBlockRootAtSlot(state, computeStartSlotAtEpoch(epoch));
}
/**
 * Return the block header corresponding to a block with ``state_root`` set to ``ZERO_HASH``.
 */
export function getTemporaryBlockHeader(
  config: IChainForkConfig,
  block: allForks.BeaconBlock
): phase0.BeaconBlockHeader {
  return {
    slot: block.slot,
    proposerIndex: block.proposerIndex,
    parentRoot: block.parentRoot,
    // `state_root` is zeroed and overwritten in the next `process_slot` call
    stateRoot: ZERO_HASH,
    bodyRoot: config.getForkTypes(block.slot).BeaconBlockBody.hashTreeRoot(block.body),
  };
}

/**
 * Receives a BeaconBlock, and produces the corresponding BeaconBlockHeader.
 */
export function blockToHeader(config: IChainForkConfig, block: allForks.BeaconBlock): phase0.BeaconBlockHeader {
  return {
    stateRoot: block.stateRoot,
    proposerIndex: block.proposerIndex,
    slot: block.slot,
    parentRoot: block.parentRoot,
    bodyRoot: config.getForkTypes(block.slot).BeaconBlockBody.hashTreeRoot(block.body),
  };
}
