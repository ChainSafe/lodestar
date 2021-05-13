import {allForks} from "@chainsafe/lodestar-types";
import {intDiv} from "@chainsafe/lodestar-utils";
import {IEpochProcess, CachedBeaconState} from "../util";

export function processHistoricalRootsUpdate(
  state: CachedBeaconState<allForks.BeaconState>,
  process: IEpochProcess
): void {
  const {config} = state;
  const nextEpoch = process.currentEpoch + 1;
  const {SLOTS_PER_HISTORICAL_ROOT, SLOTS_PER_EPOCH} = config.params;

  // set historical root accumulator
  if (nextEpoch % intDiv(SLOTS_PER_HISTORICAL_ROOT, SLOTS_PER_EPOCH) === 0) {
    state.historicalRoots.push(
      config.types.phase0.HistoricalBatch.hashTreeRoot({
        blockRoots: state.blockRoots,
        stateRoots: state.stateRoots,
      })
    );
  }
}
