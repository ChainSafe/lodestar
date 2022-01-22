import {allForks, altair, bellatrix, phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconState, EpochContext, IEpochProcess} from "./allForks/util";

export {EpochContext, IEpochProcess};

export type BeaconStateCachedPhase0 = CachedBeaconState<phase0.BeaconState>;
export type BeaconStateCachedAltair = CachedBeaconState<altair.BeaconState>;
export type BeaconStateCachedBellatrix = CachedBeaconState<bellatrix.BeaconState>;
export type BeaconStateCachedAllForks = CachedBeaconState<allForks.BeaconState>;
export type BeaconStateCachedAnyFork =
  | BeaconStateCachedPhase0
  | BeaconStateCachedAltair
  | BeaconStateCachedBellatrix
  | BeaconStateCachedAllForks;
