import {EPOCHS_PER_HISTORICAL_VECTOR} from "@chainsafe/lodestar-params";
import {getRandaoMix} from "../../util";
import {IEpochProcess, BeaconStateCachedAllForks} from "../../types";

/**
 * Write next randaoMix
 *
 * PERF: Almost no (constant) cost
 */
export function processRandaoMixesReset(state: BeaconStateCachedAllForks, epochProcess: IEpochProcess): void {
  const currentEpoch = epochProcess.currentEpoch;
  const nextEpoch = currentEpoch + 1;

  // set randao mix
  state.randaoMixes[nextEpoch % EPOCHS_PER_HISTORICAL_VECTOR] = getRandaoMix(state, currentEpoch);
}
