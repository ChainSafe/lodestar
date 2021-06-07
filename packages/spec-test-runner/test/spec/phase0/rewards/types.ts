import {VALIDATOR_REGISTRY_LIMIT} from "@chainsafe/lodestar-params";
import {phase0, Gwei, ssz} from "@chainsafe/lodestar-types";
import {ContainerType, ListType} from "@chainsafe/ssz";
import {IBaseSpecTest} from "../../type";

export interface IDeltas {
  rewards: Gwei[];
  penalties: Gwei[];
}

export interface IAttestationDeltas {
  sourceDeltas: IDeltas;
  targetDeltas: IDeltas;
  headDeltas: IDeltas;
  inclusionDelayDeltas: IDeltas;
  inactivityPenaltyDeltas: IDeltas;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const DeltasType = new ContainerType({
  fields: {
    rewards: new ListType({
      elementType: ssz.Gwei,
      limit: VALIDATOR_REGISTRY_LIMIT,
    }),
    penalties: new ListType({
      elementType: ssz.Gwei,
      limit: VALIDATOR_REGISTRY_LIMIT,
    }),
  },
});

// eslint-disable-next-line @typescript-eslint/naming-convention
export const AttestationDeltasType = new ContainerType({
  fields: {
    sourceDeltas: DeltasType,
    targetDeltas: DeltasType,
    headDeltas: DeltasType,
    inclusionDelayDeltas: DeltasType,
    inactivityPenaltyDeltas: DeltasType,
  },
});

export interface IRewardsTestCase extends IBaseSpecTest {
  [k: string]: IDeltas | unknown | null | undefined;
  pre: phase0.BeaconState;
}

export function generateSZZTypeMapping(): Record<string, unknown> {
  const typeMappings: Record<string, unknown> = {};
  typeMappings["source_deltas"] = DeltasType;
  typeMappings["target_deltas"] = DeltasType;
  typeMappings["head_deltas"] = DeltasType;
  typeMappings["inclusion_delay_deltas"] = DeltasType;
  typeMappings["inactivity_penalty_deltas"] = DeltasType;
  return typeMappings;
}
