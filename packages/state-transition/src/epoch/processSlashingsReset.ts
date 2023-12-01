import {EFFECTIVE_BALANCE_INCREMENT, EPOCHS_PER_SLASHINGS_VECTOR} from "@lodestar/params";
import {EpochTransitionCache, CachedBeaconStateAllForks} from "../types.js";

/**
 * Reset the next slashings balance accumulator
 *
 * PERF: Almost no (constant) cost
 */
export function processSlashingsReset(state: CachedBeaconStateAllForks, cache: EpochTransitionCache): void {
  const nextEpoch = cache.currentEpoch + 1;

  // reset slashings
  const slashIndex = nextEpoch % EPOCHS_PER_SLASHINGS_VECTOR;
  const oldSlashingValueByIncrement = Math.floor(state.slashings.get(slashIndex) / EFFECTIVE_BALANCE_INCREMENT);
  state.slashings.set(slashIndex, 0);
  state.epochCtx.totalSlashingsByIncrement = Math.max(
    0,
    state.epochCtx.totalSlashingsByIncrement - oldSlashingValueByIncrement
  );
}
