import {allForks, altair, phase0} from "../../src";
import {
  IEpochProcess,
  BeaconStateCachedAllForks,
  BeaconStateCachedPhase0,
  BeaconStateCachedAltair,
} from "../../src/allForks";

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
