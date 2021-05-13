import {config} from "@chainsafe/lodestar-config/mainnet";
import {phase0, Gwei} from "@chainsafe/lodestar-types";
import {ContainerType, ListType} from "@chainsafe/ssz";

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
      elementType: config.types.Gwei,
      limit: config.params.VALIDATOR_REGISTRY_LIMIT,
    }),
    penalties: new ListType({
      elementType: config.types.Gwei,
      limit: config.params.VALIDATOR_REGISTRY_LIMIT,
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

export interface IRewardsTestCase {
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
