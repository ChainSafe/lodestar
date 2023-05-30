import {EPOCHS_PER_HISTORICAL_VECTOR} from "@lodestar/params";
import {EpochTransitionCache, CachedBeaconStateAllForks} from "../types.js";

/**
 * Write next randaoMix
 *
 * PERF: Almost no (constant) cost
 */
export function processRandaoMixesReset(state: CachedBeaconStateAllForks, cache: EpochTransitionCache): void {
  const currentEpoch = cache.currentEpoch;
  const nextEpoch = currentEpoch + 1;

  // set randao mix
  state.randaoMixes.set(
    nextEpoch % EPOCHS_PER_HISTORICAL_VECTOR,
    state.randaoMixes.get(currentEpoch % EPOCHS_PER_HISTORICAL_VECTOR)
  );
}
