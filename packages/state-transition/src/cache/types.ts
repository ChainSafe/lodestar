import {ssz} from "@lodestar/types";
import {CompositeViewDU} from "@chainsafe/ssz";

export type BeaconStatePhase0 = CompositeViewDU<typeof ssz.phase0.BeaconState>;
export type BeaconStateAltair = CompositeViewDU<typeof ssz.altair.BeaconState>;
export type BeaconStateBellatrix = CompositeViewDU<typeof ssz.bellatrix.BeaconState>;
export type BeaconStateCapella = CompositeViewDU<typeof ssz.capella.BeaconState>;
export type BeaconState4844 = CompositeViewDU<typeof ssz.eip4844.BeaconState>;

// Union at the TreeViewDU level
// - Works well as function argument and as generic type for allForks functions
//
// Quasi-equivalent to
// CompositeViewDU<typeof ssz.phase0.BeaconState | typeof ssz.altair.BeaconState | typeof ssz.bellatrix.BeaconState | typeof ssz.capella.BeaconState | typeof ssz.eip4844.BeaconState>
export type BeaconStateAllForks =
  | BeaconStatePhase0
  | BeaconStateAltair
  | BeaconStateBellatrix
  | BeaconStateCapella
  | BeaconState4844;

export type BeaconStateExecutions = BeaconStateBellatrix | BeaconStateCapella | BeaconState4844;
