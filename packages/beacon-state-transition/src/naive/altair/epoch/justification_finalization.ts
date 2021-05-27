import {GENESIS_EPOCH, TIMELY_TARGET_FLAG_INDEX} from "@chainsafe/lodestar-params";
import {altair} from "@chainsafe/lodestar-types";
import {getBlockRoot, getCurrentEpoch, getPreviousEpoch, getTotalActiveBalance, getTotalBalance} from "../../../util";
import {getUnslashedParticipatingIndices} from "../../../altair/state_accessor";

export function processJustificationAndFinalization(state: altair.BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  if (currentEpoch <= GENESIS_EPOCH + 1) {
    return;
  }
  const previousEpoch = getPreviousEpoch(state);
  const bits = state.justificationBits;
  const oldPreviousJustifiedCheckpoint = state.previousJustifiedCheckpoint;
  const oldCurrentJustifiedCheckpoint = state.currentJustifiedCheckpoint;

  // Process justifications
  state.previousJustifiedCheckpoint = state.currentJustifiedCheckpoint;
  // Rotate the justification bitfield up one epoch to make room for the current epoch
  for (let i = bits.length - 1; i >= 1; i--) {
    bits[i] = bits[i - 1];
  }
  bits[0] = false;

  const matchingPreviousTargetIndices = getUnslashedParticipatingIndices(
    state,
    TIMELY_TARGET_FLAG_INDEX,
    previousEpoch
  );
  const totalActiveBalance = getTotalActiveBalance(state);
  if (getTotalBalance(state, matchingPreviousTargetIndices) * BigInt(3) >= totalActiveBalance * BigInt(2)) {
    state.currentJustifiedCheckpoint = {
      epoch: previousEpoch,
      root: getBlockRoot(state, previousEpoch),
    };
    bits[1] = true;
  }

  const matchingCurrentTargetIndices = getUnslashedParticipatingIndices(state, TIMELY_TARGET_FLAG_INDEX, currentEpoch);
  if (getTotalBalance(state, matchingCurrentTargetIndices) * BigInt(3) >= totalActiveBalance * BigInt(2)) {
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
