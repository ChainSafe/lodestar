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
  state.slot = state.slot.addn(1);
  state.latestBlockRoots[state.slot.subn(1).modn(LATEST_BLOCK_ROOTS_LENGTH)] = prevBlockRoot;
  if (state.slot.modn(LATEST_BLOCK_ROOTS_LENGTH) === 0) {
    state.batchedBlockRoots.push(merkleRoot(state.latestBlockRoots));
  }
  return state;
}
