import {CompositeViewDU} from "@chainsafe/ssz";
import {ForkAll, ForkExecution, ForkName} from "@lodestar/params";
import {Epoch, RootHex, SSZTypesFor} from "@lodestar/types";
import {EpochShuffling} from "../util/epochShuffling.js";

export type BeaconStatePhase0 = CompositeViewDU<SSZTypesFor<ForkName.phase0, "BeaconState">>;
export type BeaconStateAltair = CompositeViewDU<SSZTypesFor<ForkName.altair, "BeaconState">>;
export type BeaconStateBellatrix = CompositeViewDU<SSZTypesFor<ForkName.bellatrix, "BeaconState">>;
export type BeaconStateCapella = CompositeViewDU<SSZTypesFor<ForkName.capella, "BeaconState">>;
export type BeaconStateDeneb = CompositeViewDU<SSZTypesFor<ForkName.deneb, "BeaconState">>;
export type BeaconStateElectra = CompositeViewDU<SSZTypesFor<ForkName.electra, "BeaconState">>;

export type BeaconStateAllForks = CompositeViewDU<SSZTypesFor<ForkAll, "BeaconState">>;
export type BeaconStateExecutions = CompositeViewDU<SSZTypesFor<ForkExecution, "BeaconState">>;

export type ShufflingGetter = (shufflingEpoch: Epoch, dependentRoot: RootHex) => EpochShuffling | null;
