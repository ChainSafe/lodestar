/**
 * @module chain/stateTransition/epoch
 */

import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";

import {getBlockRoot, getCurrentEpoch, getPreviousEpoch, getTotalActiveBalance} from "../../../util";

import {getAttestingBalance, getMatchingTargetAttestations} from "./util";

export function processJustificationAndFinalization(state: phase0.BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  if (currentEpoch <= GENESIS_EPOCH + 1) {
    return;
  }
  const previousEpoch = getPreviousEpoch(state);
  const oldPreviousJustifiedCheckpoint = state.previousJustifiedCheckpoint;
  const oldCurrentJustifiedCheckpoint = state.currentJustifiedCheckpoint;
  const bits = state.justificationBits;

  // Process justifications
  state.previousJustifiedCheckpoint = state.currentJustifiedCheckpoint;
  // Rotate the justification bitfield up one epoch to make room for the current epoch
  for (let i = bits.length - 1; i >= 1; i--) {
    bits[i] = bits[i - 1];
  }
  bits[0] = false;
  const totalActiveBalance = getTotalActiveBalance(state);

  // If the previous epoch gets justified, fill the second last bit
  const previousEpochMatchingTargetBalance = getAttestingBalance(
    state,
    getMatchingTargetAttestations(state, previousEpoch)
  );
  if (previousEpochMatchingTargetBalance * BigInt(3) >= totalActiveBalance * BigInt(2)) {
    state.currentJustifiedCheckpoint = {
      epoch: previousEpoch,
      root: getBlockRoot(state, previousEpoch),
    };
    bits[1] = true;
  }
  // If the current epoch gets justified, fill the last bit
  const currentEpochMatchingTargetBalance = getAttestingBalance(
    state,
    getMatchingTargetAttestations(state, currentEpoch)
  );
  if (currentEpochMatchingTargetBalance * BigInt(3) >= totalActiveBalance * BigInt(2)) {
    state.currentJustifiedCheckpoint = {
      epoch: currentEpoch,
      root: getBlockRoot(state, currentEpoch),
    };
    bits[0] = true;
  }
  state.justificationBits = bits;

  // Process finalizations
  // The 2nd/3rd/4th most recent epochs are all justified, the 2nd using the 4th as source
  if (bits[1] && bits[2] && bits[3] && oldPreviousJustifiedCheckpoint.epoch + 3 === currentEpoch) {
    state.finalizedCheckpoint = oldPreviousJustifiedCheckpoint;
  }
  // The 2nd/3rd most recent epochs are both justified, the 2nd using the 3rd as source
  if (bits[1] && bits[2] && oldPreviousJustifiedCheckpoint.epoch + 2 === currentEpoch) {
    state.finalizedCheckpoint = oldPreviousJustifiedCheckpoint;
  }
  // The 1st/2nd/3rd most recent epochs are all justified, the 1st using the 3rd as source
  if (bits[0] && bits[1] && bits[2] && oldCurrentJustifiedCheckpoint.epoch + 2 === currentEpoch) {
    state.finalizedCheckpoint = oldCurrentJustifiedCheckpoint;
  }
  // The 1st/2nd most recent epochs are both justified, the 1st using the 2nd as source
  if (bits[0] && bits[1] && oldCurrentJustifiedCheckpoint.epoch + 1 === currentEpoch) {
    state.finalizedCheckpoint = oldCurrentJustifiedCheckpoint;
  }
}
