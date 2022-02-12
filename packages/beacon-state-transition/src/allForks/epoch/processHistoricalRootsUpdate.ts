import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {EpochProcess, CachedBeaconStateAllForks} from "../../types";

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
      ssz.phase0.HistoricalBatch.hashTreeRoot({
        blockRoots: state.blockRoots,
        stateRoots: state.stateRoots,
      })
    );
  }
}
