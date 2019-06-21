/**
 * @module chain/stateTransition
 */

import {
  BeaconBlock,
  BeaconState,
} from "../../types";

import {processBlock} from "./block";
import {processEpoch} from "./epoch";
import {processSlots} from "./slot";
import {hashTreeRoot} from "@chainsafe/ssz";
import  assert from "assert";


export {
  processBlock,
  processEpoch,
};

export function stateTransition(
  state: BeaconState, block: BeaconBlock,
  validateStateRoot = false
): BeaconState {
  // Process slots (including those with no blocks) since block
  processSlots(state, block.slot);
  // Process block
  processBlock(state, block)
  // Validate state root (`validate_state_root == True` in production)
  if (validateStateRoot){
    assert(block.stateRoot == hashTreeRoot(state, BeaconState));
  }

  // Return post-state
  return state;
}
