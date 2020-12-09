import {BitVectorType, ContainerType, VectorType} from "@chainsafe/ssz";
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
