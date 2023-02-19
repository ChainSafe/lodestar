import {CompositeViewDU} from "@chainsafe/ssz";
import {Epoch, RootHex, ssz} from "@lodestar/types";
import {EpochShuffling} from "../util/epochShuffling.js";

export type BeaconStatePhase0 = CompositeViewDU<typeof ssz.phase0.BeaconState>;
export type BeaconStateAltair = CompositeViewDU<typeof ssz.altair.BeaconState>;
export type BeaconStateBellatrix = CompositeViewDU<typeof ssz.bellatrix.BeaconState>;
export type BeaconStateCapella = CompositeViewDU<typeof ssz.capella.BeaconState>;
export type BeaconStateDeneb = CompositeViewDU<typeof ssz.deneb.BeaconState>;
export type BeaconStateVerge = CompositeViewDU<typeof ssz.verge.BeaconState>;

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
  | BeaconStateDeneb
  | BeaconStateVerge;

export type BeaconStateExecutions = BeaconStateBellatrix | BeaconStateCapella | BeaconStateDeneb | BeaconStateVerge;

export type ShufflingGetter = (shufflingEpoch: Epoch, dependentRoot: RootHex) => EpochShuffling | null;
