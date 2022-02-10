import {allForks, altair, bellatrix, phase0} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "./cache/cachedBeaconState";

export {EpochContext} from "./cache/epochContext";
export {EpochProcess} from "./cache/epochProcess";

export type CachedBeaconStatePhase0 = CachedBeaconState<phase0.BeaconState>;
export type CachedBeaconStateAltair = CachedBeaconState<altair.BeaconState>;
export type CachedBeaconStateBellatrix = CachedBeaconState<bellatrix.BeaconState>;
export type CachedBeaconStateAllForks = CachedBeaconState<allForks.BeaconState>;
export type CachedBeaconStateAnyFork =
  | CachedBeaconStatePhase0
  | CachedBeaconStateAltair
  | CachedBeaconStateBellatrix
  | CachedBeaconStateAllForks;
