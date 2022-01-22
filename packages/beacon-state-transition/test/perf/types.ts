import {allForks, phase0, BeaconStateCachedAllForks, BeaconStateCachedPhase0, BeaconStateCachedAltair} from "../../src";
import {IEpochProcess} from "../../src/types";

// Type aliases to typesafe itBench() calls

export type State = BeaconStateCachedAllForks;
export type StateAltair = BeaconStateCachedAltair;
export type StateBlock = {state: BeaconStateCachedAllForks; block: allForks.SignedBeaconBlock};
export type StateAttestations = {
  state: BeaconStateCachedAllForks;
  attestations: phase0.Attestation[];
};
export type StateEpoch = {state: BeaconStateCachedAllForks; epochProcess: IEpochProcess};
export type StatePhase0Epoch = {state: BeaconStateCachedPhase0; epochProcess: IEpochProcess};
export type StateAltairEpoch = {state: BeaconStateCachedAltair; epochProcess: IEpochProcess};
