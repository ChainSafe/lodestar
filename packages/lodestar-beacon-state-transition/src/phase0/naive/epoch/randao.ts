import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {getRandaoMix, getCurrentEpoch} from "../../..";

export function processRandaoMixesReset(config: IBeaconConfig, state: phase0.BeaconState): void {
  const currentEpoch = getCurrentEpoch(config, state);
  const nextEpoch = currentEpoch + 1;
  // Set randao mix
  state.randaoMixes[nextEpoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR] = getRandaoMix(config, state, currentEpoch);
}
