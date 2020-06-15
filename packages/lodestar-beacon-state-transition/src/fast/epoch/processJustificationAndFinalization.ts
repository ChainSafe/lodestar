import {BeaconState} from "@chainsafe/lodestar-types";

import {GENESIS_EPOCH} from "../../constants";
import {getBlockRoot} from "../../util";
import {EpochContext, IEpochProcess} from "../util";


export function processJustificationAndFinalization(
  epochCtx: EpochContext,
  process: IEpochProcess,
  state: BeaconState
): void {
  const config = epochCtx.config;
  const previousEpoch = process.prevEpoch;
  const currentEpoch = process.currentEpoch;

  if (currentEpoch <= GENESIS_EPOCH + 1n) {
    return;
  }

  const oldPreviousJustifiedCheckpoint = state.previousJustifiedCheckpoint;
  const oldCurrentJustifiedCheckpoint = state.currentJustifiedCheckpoint;

  // Process justifications
  state.previousJustifiedCheckpoint = state.currentJustifiedCheckpoint;
  const bits = state.justificationBits;
  for (let i = bits.length - 1; i >= 1; i--) {
    bits[i] = bits[i-1];
  }
  bits[0] = false;

  if (process.prevEpochTargetStake * BigInt(3) >= process.totalActiveStake * BigInt(2)) {
    state.currentJustifiedCheckpoint = {
      epoch: previousEpoch,
      root: getBlockRoot(config, state, previousEpoch),
    };
    bits[1] = true;
  }
  if (process.currEpochTargetStake * BigInt(3) >= process.totalActiveStake * BigInt(2)) {
    state.currentJustifiedCheckpoint = {
      epoch: currentEpoch,
      root: getBlockRoot(config, state, currentEpoch),
    };
    bits[0] = true;
  }
  state.justificationBits = bits;

  // Process finalizations
  // The 2nd/3rd/4th most recent epochs are all justified, the 2nd using the 4th as source
  if (
    bits[1] && bits[2] && bits[3] &&
    oldPreviousJustifiedCheckpoint.epoch + 3n === currentEpoch
  ) {
    state.finalizedCheckpoint = oldPreviousJustifiedCheckpoint;
  }
  // The 2nd/3rd most recent epochs are both justified, the 2nd using the 3rd as source
  if (
    bits[1] && bits[2] &&
    oldPreviousJustifiedCheckpoint.epoch + 2n === currentEpoch
  ) {
    state.finalizedCheckpoint = oldPreviousJustifiedCheckpoint;
  }
  // The 1st/2nd/3rd most recent epochs are all justified, the 1st using the 3rd as source
  if (
    bits[0] && bits[1] && bits[2] &&
    oldCurrentJustifiedCheckpoint.epoch + 2n === currentEpoch
  ) {
    state.finalizedCheckpoint = oldCurrentJustifiedCheckpoint;
  }
  // The 1st/2nd most recent epochs are both justified, the 1st using the 2nd as source
  if (
    bits[0] && bits[1] &&
    oldCurrentJustifiedCheckpoint.epoch + 1n === currentEpoch
  ) {
    state.finalizedCheckpoint = oldCurrentJustifiedCheckpoint;
  }
}
