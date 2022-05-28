import {
  allForks,
  CachedBeaconStateAllForks,
  CachedBeaconStatePhase0,
  CachedBeaconStateAltair,
} from "../../src/index.js";
import {EpochProcess} from "../../src/types.js";

// Type aliases to typesafe itBench() calls

export type State = CachedBeaconStateAllForks;
export type StateAltair = CachedBeaconStateAltair;
export type StateBlock = {state: CachedBeaconStateAllForks; block: allForks.SignedBeaconBlock};
export type StateEpoch = {state: CachedBeaconStateAllForks; epochProcess: EpochProcess};
export type StatePhase0Epoch = {state: CachedBeaconStatePhase0; epochProcess: EpochProcess};
export type StateAltairEpoch = {state: CachedBeaconStateAltair; epochProcess: EpochProcess};
