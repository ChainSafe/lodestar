import {EPOCHS_PER_SLASHINGS_VECTOR} from "@lodestar/params";
import {EpochTransitionCache, CachedBeaconStateAllForks} from "../types.js";

/**
 * Reset the next slashings balance accumulator
 *
 * PERF: Almost no (constant) cost
 */
export function processSlashingsReset(state: CachedBeaconStateAllForks, cache: EpochTransitionCache): void {
  const nextEpoch = cache.currentEpoch + 1;

  // reset slashings
  state.slashings.set(nextEpoch % EPOCHS_PER_SLASHINGS_VECTOR, BigInt(0));
}
