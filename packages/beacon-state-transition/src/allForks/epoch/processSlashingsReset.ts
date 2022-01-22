import {EPOCHS_PER_SLASHINGS_VECTOR} from "@chainsafe/lodestar-params";
import {IEpochProcess, BeaconStateCachedAllForks} from "../util";

/**
 * Reset the next slashings balance accumulator
 *
 * PERF: Almost no (constant) cost
 */
export function processSlashingsReset(state: BeaconStateCachedAllForks, epochProcess: IEpochProcess): void {
  const nextEpoch = epochProcess.currentEpoch + 1;

  // reset slashings
  state.slashings[nextEpoch % EPOCHS_PER_SLASHINGS_VECTOR] = BigInt(0);
}
