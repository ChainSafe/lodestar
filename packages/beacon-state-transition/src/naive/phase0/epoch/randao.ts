import {phase0} from "@chainsafe/lodestar-types";
import {getRandaoMix, getCurrentEpoch} from "../../../util";
import {EPOCHS_PER_HISTORICAL_VECTOR} from "@chainsafe/lodestar-params";

export function processRandaoMixesReset(state: phase0.BeaconState): void {
  const currentEpoch = getCurrentEpoch(state);
  const nextEpoch = currentEpoch + 1;
  // Set randao mix
  state.randaoMixes[nextEpoch % EPOCHS_PER_HISTORICAL_VECTOR] = getRandaoMix(state, currentEpoch);
}
