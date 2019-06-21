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

//SPEC 0.7
// def state_transition(state: BeaconState, block: BeaconBlock, validate_state_root: bool=False) -> BeaconState:
//   # Process slots (including those with no blocks) since block
// process_slots(state, block.slot)
// # Process block
// process_block(state, block)
// # Validate state root (`validate_state_root == True` in production)
// if validate_state_root:
// assert block.state_root == hash_tree_root(state)
// # Return post-state
// return state


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
