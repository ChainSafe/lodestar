import {allForks, altair, bellatrix, phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconState, EpochContext, IEpochProcess} from "./allForks/util";

export {EpochContext, IEpochProcess};

export type CachedBeaconStatePhase0 = CachedBeaconState<phase0.BeaconState>;
export type CachedBeaconStateAltair = CachedBeaconState<altair.BeaconState>;
export type CachedBeaconStateBellatrix = CachedBeaconState<bellatrix.BeaconState>;
export type CachedBeaconStateAllForks = CachedBeaconState<allForks.BeaconState>;
export type CachedBeaconStateAnyFork =
  | CachedBeaconStatePhase0
  | CachedBeaconStateAltair
  | CachedBeaconStateBellatrix
  | CachedBeaconStateAllForks;
