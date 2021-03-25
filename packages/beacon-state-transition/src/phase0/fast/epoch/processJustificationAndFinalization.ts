import {phase0} from "@chainsafe/lodestar-types";

import {GENESIS_EPOCH} from "../../../constants";
import {getBlockRoot} from "../../../util";
import {CachedBeaconState, IEpochProcess} from "../util";

export function processJustificationAndFinalization(
  state: CachedBeaconState<phase0.BeaconState>,
  process: IEpochProcess
): void {
  const config = state.config;
  const previousEpoch = process.prevEpoch;
  const currentEpoch = process.currentEpoch;

  // Initial FFG checkpoint values have a `0x00` stub for `root`.
  // Skip FFG updates in the first two epochs to avoid corner cases that might result in modifying this stub.
  if (currentEpoch <= GENESIS_EPOCH + 1) {
    return;
  }

  const oldPreviousJustifiedCheckpoint = state.previousJustifiedCheckpoint;
  const oldCurrentJustifiedCheckpoint = state.currentJustifiedCheckpoint;

  // Process justifications
  state.previousJustifiedCheckpoint = state.currentJustifiedCheckpoint;
  const bits = state.justificationBits;
  for (let i = bits.length - 1; i >= 1; i--) {
    bits[i] = bits[i - 1];
  }
  bits[0] = false;

  if (process.prevEpochUnslashedStake.targetStake * BigInt(3) >= process.totalActiveStake * BigInt(2)) {
    state.currentJustifiedCheckpoint = {
      epoch: previousEpoch,
      root: getBlockRoot(config, state, previousEpoch),
    };
    bits[1] = true;
  }
  if (process.currEpochUnslashedTargetStake * BigInt(3) >= process.totalActiveStake * BigInt(2)) {
    state.currentJustifiedCheckpoint = {
      epoch: currentEpoch,
      root: getBlockRoot(config, state, currentEpoch),
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
