import {allForks} from "@chainsafe/lodestar-types";
import {getRandaoMix} from "../../util";
import {IEpochProcess, CachedBeaconState} from "../util";

export function processRandaoMixesReset(state: CachedBeaconState<allForks.BeaconState>, process: IEpochProcess): void {
  const {config} = state;
  const currentEpoch = process.currentEpoch;
  const nextEpoch = currentEpoch + 1;
  const {EPOCHS_PER_HISTORICAL_VECTOR} = config.params;

  // set randao mix
  state.randaoMixes[nextEpoch % EPOCHS_PER_HISTORICAL_VECTOR] = getRandaoMix(config, state, currentEpoch);
}
