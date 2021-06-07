import {EPOCHS_PER_HISTORICAL_VECTOR} from "@chainsafe/lodestar-params";
import {allForks} from "@chainsafe/lodestar-types";
import {getRandaoMix} from "../../util";
import {IEpochProcess, CachedBeaconState} from "../util";

export function processRandaoMixesReset(state: CachedBeaconState<allForks.BeaconState>, process: IEpochProcess): void {
  const currentEpoch = process.currentEpoch;
  const nextEpoch = currentEpoch + 1;

  // set randao mix
  state.randaoMixes[nextEpoch % EPOCHS_PER_HISTORICAL_VECTOR] = getRandaoMix(state, currentEpoch);
}
