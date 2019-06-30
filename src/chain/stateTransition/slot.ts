/**
 * @module chain/stateTransition/slot
 */

import assert from "assert";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";

import {
  BeaconState,
  BeaconBlockHeader, Slot,
} from "../../types";

import {
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT, ZERO_HASH,
} from "../../constants";

import {processEpoch} from "./epoch";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.7.1/specs/core/0_beacon-chain.md#beacon-chain-state-transition-function

export function processSlots(state: BeaconState, slot: Slot): void{
  assert(state.slot <= slot);

  while (state.slot < slot){
    processSlot(state);
    // Process epoch on the first slot of the next epoch
    if ((state.slot + 1) % SLOTS_PER_EPOCH === 0){
      processEpoch(state);
    }
    state.slot++;
  }
}

function processSlot(state: BeaconState): void {
  // Cache state root
  const previousStateRoot = hashTreeRoot(state, BeaconState);
  state.latestStateRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = previousStateRoot;

  // Cache latest block header state root
  if (state.latestBlockHeader.stateRoot.equals(ZERO_HASH)) {
    state.latestBlockHeader.stateRoot = previousStateRoot;
  }

  // Cache block root
  const previousBlockRoot = signingRoot(state.latestBlockHeader, BeaconBlockHeader);
  state.latestBlockRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = previousBlockRoot;
}

export function advanceSlot(state: BeaconState): void {
  state.slot++;
}
