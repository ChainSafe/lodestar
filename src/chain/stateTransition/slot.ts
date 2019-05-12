/**
 * @module chain/stateTransition/slot
 */

import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";

import {
  BeaconState,
  BeaconBlockHeader,
} from "../../types";

import {
  SLOTS_PER_HISTORICAL_ROOT, ZERO_HASH,
} from "../../constants";


export function cacheState(state: BeaconState): void {
  // Cache latest known state root (for previous slot)
  const latestStateRoot = hashTreeRoot(state, BeaconState);
  state.latestStateRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] = latestStateRoot;

  // Store latest known state root (for previous slot) in latest_block_header if it is empty
  if (state.latestBlockHeader.stateRoot.equals(ZERO_HASH)) {
    state.latestBlockHeader.stateRoot = latestStateRoot;
  }

  // Cache latest known block root (for previous slot)
  state.latestBlockRoots[state.slot % SLOTS_PER_HISTORICAL_ROOT] =
    signingRoot(state.latestBlockHeader, BeaconBlockHeader);
}

export function advanceSlot(state: BeaconState): void {
  state.slot++;
}
