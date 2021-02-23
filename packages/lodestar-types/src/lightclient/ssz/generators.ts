import {
  // TODO add these to params?
  // NEXT_SYNC_COMMITTEE_INDEX,
  // MAX_VALID_LIGHT_CLIENT_UPDATES,
  // FINALIZED_ROOT_INDEX,
  IBeaconParams,
} from "@chainsafe/lodestar-params";
import {BitVectorType, ContainerType, VectorType, ListType} from "@chainsafe/ssz";
import {IPhase0SSZTypes} from "../../phase0";
import * as lightclient from "../types";
import {ILightclientSSZTypes} from "./interface";

const NEXT_SYNC_COMMITTEE_INDEX = 0;
const MAX_VALID_LIGHT_CLIENT_UPDATES = 0;
const FINALIZED_ROOT_INDEX = 0;

type LightClientTypesGenerator<T> = (
  params: IBeaconParams,
  phase0Types: IPhase0SSZTypes,
  lightclientTypes: ILightclientSSZTypes
) => T;

export const SyncCommittee: LightClientTypesGenerator<ContainerType<lightclient.SyncCommittee>> = (
  params,
  phase0Types
) => {
  return new ContainerType({
    fields: {
      pubkeys: new VectorType({
        elementType: phase0Types.BLSPubkey,
        length: params.SYNC_COMMITTEE_SIZE,
      }),
      pubkeyAggregates: new VectorType({
        elementType: phase0Types.BLSPubkey,
        length: Math.floor(params.SYNC_COMMITTEE_SIZE / params.SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE),
      }),
    },
  });
};

export const BeaconBlockBody: LightClientTypesGenerator<ContainerType<lightclient.BeaconBlockBody>> = (
  params,
  phase0Types
) => {
  return new ContainerType({
    fields: {
      ...phase0Types.BeaconBlockBody.fields,
      syncCommitteeBits: new BitVectorType({length: params.SYNC_COMMITTEE_SIZE}),
      syncCommitteeSignature: phase0Types.BLSSignature,
    },
  });
};
export const BeaconBlock: LightClientTypesGenerator<ContainerType<lightclient.BeaconBlock>> = (
  params,
  phase0Types,
  lightclientTypes
) => {
  return new ContainerType({
    fields: {
      ...phase0Types.BeaconBlock.fields,
      body: lightclientTypes.BeaconBlockBody,
    },
  });
};

export const SignedBeaconBlock: LightClientTypesGenerator<ContainerType<lightclient.SignedBeaconBlock>> = (
  params,
  phase0Types,
  lightclientTypes
) => {
  return new ContainerType({
    fields: {
      ...phase0Types.SignedBeaconBlock.fields,
      message: lightclientTypes.BeaconBlock,
    },
  });
};

export const BeaconState: LightClientTypesGenerator<ContainerType<lightclient.BeaconState>> = (
  params,
  phase0Types,
  lightclientTypes
) => {
  return new ContainerType({
    fields: {
      ...phase0Types.BeaconState.fields,
      previousEpochParticipation: new ListType({
        elementType: phase0Types.ValidatorFlag,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      currentEpochParticipation: new ListType({
        elementType: phase0Types.ValidatorFlag,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      currentSyncCommittee: lightclientTypes.SyncCommittee,
      nextSyncCommittee: lightclientTypes.SyncCommittee,
    },
  });
};

export const LightclientSnapshot: LightClientTypesGenerator<ContainerType<lightclient.LightclientSnapshot>> = (
  params,
  phase0Types,
  lightclientTypes
) => {
  return new ContainerType({
    fields: {
      header: lightclientTypes.BeaconBlockHeader,
      nextSyncCommittee: lightclientTypes.SyncCommittee,
      currentSyncCommittee: lightclientTypes.SyncCommittee,
    },
  });
};

export const LightclientUpdate: LightClientTypesGenerator<ContainerType<lightclient.LightclientUpdate>> = (
  params,
  phase0Types,
  lightclientTypes
) => {
  return new ContainerType({
    fields: {
      header: lightclientTypes.BeaconBlockHeader,
      nextSyncCommittee: lightclientTypes.SyncCommittee,
      nextSyncCommitteeBranch: new VectorType({
        elementType: phase0Types.Bytes32,
        length: Math.log2(NEXT_SYNC_COMMITTEE_INDEX),
      }),
      finalityHeader: lightclientTypes.BeaconBlockHeader,
      finalityBranch: new VectorType({
        elementType: phase0Types.Bytes32,
        length: Math.log2(FINALIZED_ROOT_INDEX),
      }),
      syncCommitteeBits: new BitVectorType({length: params.SYNC_COMMITTEE_SIZE}),
      syncCommitteeSignature: phase0Types.BLSSignature,
      forkVersion: phase0Types.Version,
    },
  });
};

export const LightclientStore: LightClientTypesGenerator<ContainerType<lightclient.LightclientStore>> = (
  params,
  phase0Types,
  lightclientTypes
) => {
  return new ContainerType({
    fields: {
      snapshot: lightclientTypes.LightclientSnapshot,
      validUpdates: new ListType({
        elementType: lightclientTypes.LightclientUpdate,
        limit: MAX_VALID_LIGHT_CLIENT_UPDATES,
      }),
    },
  });
};
