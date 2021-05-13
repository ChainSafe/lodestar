import {phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "../allForks/util";

export function upgradeState(state: CachedBeaconState<phase0.BeaconState>): CachedBeaconState<phase0.BeaconState> {
  return state;
}
