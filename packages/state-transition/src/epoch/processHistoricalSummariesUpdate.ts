import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {intDiv} from "@lodestar/utils";
import {EpochProcess, CachedBeaconStateCapella} from "../types.js";

/**
 * Persist blockRoots and stateRoots to historicalSummaries.
 *
 * PERF: Very low (constant) cost. Most of the HistoricalSummaries should already be hashed.
 */
export function processHistoricalSummariesUpdate(state: CachedBeaconStateCapella, epochProcess: EpochProcess): void {
  const nextEpoch = epochProcess.currentEpoch + 1;

  // set historical root accumulator
  if (nextEpoch % intDiv(SLOTS_PER_HISTORICAL_ROOT, SLOTS_PER_EPOCH) === 0) {
    state.historicalSummaries.push(
      ssz.capella.HistoricalSummary.toViewDU({
        blockSummaryRoot: state.blockRoots.hashTreeRoot(),
        stateSummaryRoot: state.stateRoots.hashTreeRoot(),
      })
    );
  }
}
