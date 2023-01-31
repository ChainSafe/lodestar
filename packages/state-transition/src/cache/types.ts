import {ssz} from "@lodestar/types";
import {CompositeViewDU} from "@chainsafe/ssz";

export type BeaconStatePhase0 = CompositeViewDU<typeof ssz.phase0.BeaconState>;
export type BeaconStateAltair = CompositeViewDU<typeof ssz.altair.BeaconState>;
export type BeaconStateBellatrix = CompositeViewDU<typeof ssz.bellatrix.BeaconState>;
export type BeaconStateCapella = CompositeViewDU<typeof ssz.capella.BeaconState>;
export type BeaconStateDeneb = CompositeViewDU<typeof ssz.deneb.BeaconState>;

// Union at the TreeViewDU level
// - Works well as function argument and as generic type for allForks functions
//
// Quasy equivalent to
// CompositeViewDU<typeof ssz.phase0.BeaconState | typeof ssz.altair.BeaconState | ...> // + future forks
export type BeaconStateAllForks =
  | BeaconStatePhase0
  | BeaconStateAltair
  | BeaconStateBellatrix
  | BeaconStateCapella
  | BeaconStateDeneb;

export type BeaconStateExecutions = BeaconStateBellatrix | BeaconStateCapella | BeaconStateDeneb;
