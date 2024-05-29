import {Epoch, RootHex, SSZInstanceTypesFor} from "@lodestar/types";
import {ForkAll, ForkExecution, ForkName} from "@lodestar/params";
import {EpochShuffling} from "../util/epochShuffling.js";

export type BeaconStatePhase0 = SSZInstanceTypesFor<ForkName.phase0, "BeaconState">;
export type BeaconStateAltair = SSZInstanceTypesFor<ForkName.altair, "BeaconState">;
export type BeaconStateBellatrix = SSZInstanceTypesFor<ForkName.bellatrix, "BeaconState">;
export type BeaconStateCapella = SSZInstanceTypesFor<ForkName.capella, "BeaconState">;
export type BeaconStateDeneb = SSZInstanceTypesFor<ForkName.deneb, "BeaconState">;

export type BeaconStateAllForks = SSZInstanceTypesFor<ForkAll, "BeaconState">;
export type BeaconStateExecutions = SSZInstanceTypesFor<ForkExecution, "BeaconState">;

export type ShufflingGetter = (shufflingEpoch: Epoch, dependentRoot: RootHex) => EpochShuffling | null;
