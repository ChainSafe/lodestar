import {EPOCHS_PER_SLASHINGS_VECTOR} from "@chainsafe/lodestar-params";
import {EpochProcess, CachedBeaconStateAllForks} from "../../types.js";

/**
 * Reset the next slashings balance accumulator
 *
 * PERF: Almost no (constant) cost
 */
export function processSlashingsReset(state: CachedBeaconStateAllForks, epochProcess: EpochProcess): void {
  const nextEpoch = epochProcess.currentEpoch + 1;

  // reset slashings
  state.slashings.set(nextEpoch % EPOCHS_PER_SLASHINGS_VECTOR, BigInt(0));
}
