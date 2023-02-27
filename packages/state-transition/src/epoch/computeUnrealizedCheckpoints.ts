import {ForkSeq, GENESIS_EPOCH} from "@lodestar/params";
import {phase0} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "../types.js";
import {beforeProcessEpoch} from "../cache/epochProcess.js";
import {
  weighJustificationAndFinalization,
  processJustificationAndFinalization,
} from "./processJustificationAndFinalization.js";

/**
 * Compute on-the-fly justified / finalized checkpoints.
 *   - For phase0, we need to create the cache through beforeProcessEpoch
 *   - For other forks, use the progressive balances inside EpochContext
 */
export function computeUnrealizedCheckpoints(
  state: CachedBeaconStateAllForks
): {justifiedCheckpoint: phase0.Checkpoint; finalizedCheckpoint: phase0.Checkpoint} {
  let stateRealizedCheckpoints: CachedBeaconStateAllForks;

  // For phase0, we need to create the cache through beforeProcessEpoch
  if (state.config.getForkSeq(state.slot) === ForkSeq.phase0) {
    // Clone state to mutate below         true = do not transfer cache
    stateRealizedCheckpoints = state.clone(true);
    const epochProcess = beforeProcessEpoch(stateRealizedCheckpoints);
    processJustificationAndFinalization(stateRealizedCheckpoints, epochProcess);
  }

  // For other forks, use the progressive balances inside EpochContext
  else {
    // same logic to processJustificationAndFinalization
    if (state.epochCtx.epoch <= GENESIS_EPOCH + 1) {
      stateRealizedCheckpoints = state;
    }

    // Clone state and use progressive balances
    else {
      // Clone state to mutate below         true = do not transfer cache
      stateRealizedCheckpoints = state.clone(true);

      weighJustificationAndFinalization(
        stateRealizedCheckpoints,
        state.epochCtx.totalActiveBalanceIncrements,
        // minimum of total progressive unslashed balance should be 1
        Math.max(state.epochCtx.previousTargetUnslashedBalanceIncrements, 1),
        Math.max(state.epochCtx.currentTargetUnslashedBalanceIncrements, 1)
      );
    }
  }

  return {
    justifiedCheckpoint: stateRealizedCheckpoints.currentJustifiedCheckpoint,
    finalizedCheckpoint: stateRealizedCheckpoints.finalizedCheckpoint,
  };
}
