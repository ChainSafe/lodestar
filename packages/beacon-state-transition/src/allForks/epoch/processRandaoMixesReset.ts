import {EPOCHS_PER_HISTORICAL_VECTOR} from "@chainsafe/lodestar-params";
import {EpochProcess, CachedBeaconStateAllForks} from "../../types.js";

/**
 * Write next randaoMix
 *
 * PERF: Almost no (constant) cost
 */
export function processRandaoMixesReset(state: CachedBeaconStateAllForks, epochProcess: EpochProcess): void {
  const currentEpoch = epochProcess.currentEpoch;
  const nextEpoch = currentEpoch + 1;

  // set randao mix
  state.randaoMixes.set(
    nextEpoch % EPOCHS_PER_HISTORICAL_VECTOR,
    state.randaoMixes.get(currentEpoch % EPOCHS_PER_HISTORICAL_VECTOR)
  );
}
