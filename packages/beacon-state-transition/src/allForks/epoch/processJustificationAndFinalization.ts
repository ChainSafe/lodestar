import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {BitArray} from "@chainsafe/ssz";
import {ssz} from "@chainsafe/lodestar-types";
import {getBlockRoot} from "../../util/index.js";
import {CachedBeaconStateAllForks, EpochProcess} from "../../types.js";

/**
 * Update justified and finalized checkpoints depending on network participation.
 *
 * PERF: Very low (constant) cost. Persist small objects to the tree.
 */
export function processJustificationAndFinalization(
  state: CachedBeaconStateAllForks,
  epochProcess: EpochProcess
): void {
  const previousEpoch = epochProcess.prevEpoch;
  const currentEpoch = epochProcess.currentEpoch;

  // Initial FFG checkpoint values have a `0x00` stub for `root`.
  // Skip FFG updates in the first two epochs to avoid corner cases that might result in modifying this stub.
  if (currentEpoch <= GENESIS_EPOCH + 1) {
    return;
  }

  const oldPreviousJustifiedCheckpoint = state.previousJustifiedCheckpoint;
  const oldCurrentJustifiedCheckpoint = state.currentJustifiedCheckpoint;

  // Process justifications
  state.previousJustifiedCheckpoint = state.currentJustifiedCheckpoint;
  const bits = state.justificationBits.toBoolArray();

  // Rotate bits
  for (let i = bits.length - 1; i >= 1; i--) {
    bits[i] = bits[i - 1];
  }
  bits[0] = false;

  if (epochProcess.prevEpochUnslashedStake.targetStakeByIncrement * 3 >= epochProcess.totalActiveStakeByIncrement * 2) {
    state.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
      epoch: previousEpoch,
      root: getBlockRoot(state, previousEpoch),
    });
    bits[1] = true;
  }
  if (epochProcess.currEpochUnslashedTargetStakeByIncrement * 3 >= epochProcess.totalActiveStakeByIncrement * 2) {
    state.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
      epoch: currentEpoch,
      root: getBlockRoot(state, currentEpoch),
    });
    bits[0] = true;
  }

  state.justificationBits = ssz.phase0.JustificationBits.toViewDU(BitArray.fromBoolArray(bits));

  // TODO: Consider rendering bits as array of boolean for faster repeated access here

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
