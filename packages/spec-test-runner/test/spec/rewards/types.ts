import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconState, Gwei} from "@chainsafe/lodestar-types";
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

export const IDeltasType = new ContainerType({
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

export const IAttestationDeltasType = new ContainerType({
  fields: {
    sourceDeltas: IDeltasType,
    targetDeltas: IDeltasType,
    headDeltas: IDeltasType,
    inclusionDelayDeltas: IDeltasType,
    inactivityPenaltyDeltas: IDeltasType,
  },
});

export interface IRewardsTestCase {
  [k: string]: IDeltas | unknown | null | undefined;
  pre: BeaconState;
}
