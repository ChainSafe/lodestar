/**
 * @module chain/stateTransition/slot
 */

import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";

import {
  BeaconState,
  BeaconBlockHeader, Slot,
} from "../../types";

import {
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT, ZERO_HASH,
} from "../../constants";

import  {processEpoch} from "./index";
import assert from "assert";

//SPEC 0.7
// def process_slots(state: BeaconState, slot: Slot) -> None:
//   assert state.slot <= slot
// while state.slot < slot:
// process_slot(state)
// # Process epoch on the first slot of the next epoch
// if (state.slot + 1) % SLOTS_PER_EPOCH == 0:
// process_epoch(state)
// state.slot += 1

export function processSlots(state: BeaconState, slot: Slot): void{
  assert(state.slot <= slot);

  while (state.slot < slot){
    processSlot(state);
    // Process epoch on the first slot of the next epoch
    if ((state.slot + 1) % SLOTS_PER_EPOCH == 0){
      processEpoch(state);
    }
    state.slot++;
  }


}
//SPEC 0.7
// def process_slot(state: BeaconState) -> None:
//   # Cache state root
// previous_state_root = hash_tree_root(state)
// state.latest_state_roots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = previous_state_root
//
// # Cache latest block header state root
// if state.latest_block_header.state_root == ZERO_HASH:
// state.latest_block_header.state_root = previous_state_root
//
// # Cache block root
// previous_block_root = signing_root(state.latest_block_header)
// state.latest_block_roots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = previous_block_root

function processSlot(state: BeaconState): void {

  // Cache state root
  let previousStateRoot = hashTreeRoot(state, BeaconState);
  state.latestStateRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = previousStateRoot;

  // Cache latest block header state root
  if (state.latestBlockHeader.stateRoot == ZERO_HASH){
    state.latestBlockHeader.stateRoot = previousStateRoot;
  }

  // Cache block root
  let previousBlockRoot = signingRoot(state.latestBlockHeader, BeaconBlockHeader);
  state.latestBlockRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = previousBlockRoot;
}

export function advanceSlot(state: BeaconState): void {
  state.slot++;
}