import {
  NEXT_SYNC_COMMITTEE_INDEX,
  MAX_VALID_LIGHT_CLIENT_UPDATES,
  FINALIZED_ROOT_INDEX,
} from "@chainsafe/lodestar-params";
import {BitVectorType, ContainerType, VectorType, ListType} from "@chainsafe/ssz";
import * as t from "../../../types/lightclient/types";
import {LightClientTypesGenerator} from "./interface";

export const SyncCommittee: LightClientTypesGenerator<ContainerType<t.SyncCommittee>> = (params, phase0Types) => {
  return new ContainerType({
    fields: {
      pubkeys: new VectorType({
        elementType: phase0Types.BLSPubkey,
        length: params.lightclient.SYNC_COMMITTEE_SIZE,
      }),
      pubkeyAggregates: new VectorType({
        elementType: phase0Types.BLSPubkey,
        length: Math.floor(
          params.lightclient.SYNC_COMMITTEE_SIZE / params.lightclient.SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE
        ),
      }),
    },
  });
};

export const BeaconBlock: LightClientTypesGenerator<ContainerType<t.BeaconBlock>> = (params, phase0Types) => {
  return new ContainerType({
    fields: {
      ...phase0Types.BeaconBlock.fields,
      syncCommitteeBits: new BitVectorType({length: params.lightclient.SYNC_COMMITTEE_SIZE}),
      syncCommitteeSignature: phase0Types.BLSSignature,
    },
  });
};

export const BeaconBlockHeader: LightClientTypesGenerator<ContainerType<t.BeaconBlockHeader>> = (
  params,
  phase0Types
) => {
  return new ContainerType({
    fields: {
      ...phase0Types.BeaconBlockHeader.fields,
      syncCommitteeBits: new BitVectorType({length: params.lightclient.SYNC_COMMITTEE_SIZE}),
      syncCommitteeSignature: phase0Types.BLSSignature,
    },
  });
};

export const BeaconState: LightClientTypesGenerator<ContainerType<t.BeaconState>, "SyncCommittee"> = (
  params,
  phase0Types,
  lightclientTypes
) => {
  return new ContainerType({
    fields: {
      ...phase0Types.BeaconState.fields,
      currentSyncCommittee: lightclientTypes.SyncCommittee,
      nextSyncCommittee: lightclientTypes.SyncCommittee,
    },
  });
};

export const LightclientSnapshot: LightClientTypesGenerator<
  ContainerType<t.LightclientSnapshot>,
  "SyncCommittee" | "BeaconBlockHeader"
> = (params, phase0Types, lightclientTypes) => {
  return new ContainerType({
    fields: {
      header: lightclientTypes.BeaconBlockHeader,
      nextSyncCommittee: lightclientTypes.SyncCommittee,
      currentSyncCommittee: lightclientTypes.SyncCommittee,
    },
  });
};

export const LightclientUpdate: LightClientTypesGenerator<
  ContainerType<t.LightclientUpdate>,
  "SyncCommittee" | "BeaconBlockHeader"
> = (params, phase0Types, lightclientTypes) => {
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
      syncCommitteeBits: new BitVectorType({length: params.lightclient.SYNC_COMMITTEE_SIZE}),
      syncCommitteeSignature: phase0Types.BLSSignature,
      forkVersion: phase0Types.Version,
    },
  });
};

export const LightclientStore: LightClientTypesGenerator<
  ContainerType<t.LightclientStore>,
  "LightclientSnapshot" | "LightclientUpdate"
> = (params, phase0Types, lightclientTypes) => {
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
