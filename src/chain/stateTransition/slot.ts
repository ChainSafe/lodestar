import {
  BeaconState,
  bytes32,
} from "../../types";

import {
  LATEST_BLOCK_ROOTS_LENGTH,
} from "../../constants";

import {
  merkleRoot,
} from "../helpers/stateTransitionHelpers";

export function processSlot(state: BeaconState, prevBlockRoot: bytes32): BeaconState {
  state.slot++;
  state.latestBlockRoots[(state.slot - 1) % LATEST_BLOCK_ROOTS_LENGTH] = prevBlockRoot;
  if (state.slot % LATEST_BLOCK_ROOTS_LENGTH === 0) {
    state.batchedBlockRoots.push(merkleRoot(state.latestBlockRoots));
  }
  return state;
}
