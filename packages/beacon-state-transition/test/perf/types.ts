import {allForks, altair, phase0} from "../../src";
import {IEpochProcess} from "../../src/allForks";

// Type aliases to typesafe itBench() calls

export type State = allForks.CachedBeaconState<allForks.BeaconState>;
export type StateAltair = allForks.CachedBeaconState<altair.BeaconState>;
export type StateBlock = {state: allForks.CachedBeaconState<allForks.BeaconState>; block: allForks.SignedBeaconBlock};
export type StateAttestations = {
  state: allForks.CachedBeaconState<allForks.BeaconState>;
  attestations: phase0.Attestation[];
};
export type StateEpoch = {state: allForks.CachedBeaconState<allForks.BeaconState>; epochProcess: IEpochProcess};
export type StatePhase0Epoch = {state: allForks.CachedBeaconState<phase0.BeaconState>; epochProcess: IEpochProcess};
export type StateAltairEpoch = {state: allForks.CachedBeaconState<altair.BeaconState>; epochProcess: IEpochProcess};
