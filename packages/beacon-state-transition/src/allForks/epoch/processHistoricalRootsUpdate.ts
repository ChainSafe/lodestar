import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {EpochProcess, CachedBeaconStateAllForks} from "../../types.js";

/**
 * Persist blockRoots and stateRoots to historicalRoots.
 *
 * PERF: Very low (constant) cost. Most of the HistoricalBatch should already be hashed.
 */
export function processHistoricalRootsUpdate(state: CachedBeaconStateAllForks, epochProcess: EpochProcess): void {
  const nextEpoch = epochProcess.currentEpoch + 1;

  // set historical root accumulator
  if (nextEpoch % intDiv(SLOTS_PER_HISTORICAL_ROOT, SLOTS_PER_EPOCH) === 0) {
    state.historicalRoots.push(
      // HistoricalBatchRoots = Non-spec'ed helper type to allow efficient hashing in epoch transition.
      // This type is like a 'Header' of HistoricalBatch where its fields are hashed.
      ssz.phase0.HistoricalBatchRoots.hashTreeRoot({
        blockRoots: state.blockRoots.hashTreeRoot(),
        stateRoots: state.stateRoots.hashTreeRoot(),
      })
    );
  }
}
