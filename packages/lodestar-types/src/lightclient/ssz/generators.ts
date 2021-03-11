import {
  // TODO add these to params?
  // NEXT_SYNC_COMMITTEE_INDEX,
  // MAX_VALID_LIGHT_CLIENT_UPDATES,
  // FINALIZED_ROOT_INDEX,
  IBeaconParams,
  JUSTIFICATION_BITS_LENGTH,
} from "@chainsafe/lodestar-params";
import {BitVectorType, ContainerType, VectorType, ListType, RootType} from "@chainsafe/ssz";
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
      message: lightclientTypes.BeaconBlock,
      signature: phase0Types.BLSSignature,
    },
  });
};

export const BeaconState: LightClientTypesGenerator<ContainerType<lightclient.BeaconState>> = (
  params,
  phase0Types,
  lightclientTypes
) => {
  //we don't reuse phase0.BeaconState fields since we need to replace some keys
  //and we cannot keep order doing that
  const container = new ContainerType<lightclient.BeaconState>({
    fields: {
      genesisTime: phase0Types.Number64,
      genesisValidatorsRoot: phase0Types.Root,
      slot: phase0Types.Slot,
      fork: phase0Types.Fork,
      // History
      latestBlockHeader: phase0Types.BeaconBlockHeader,
      blockRoots: phase0Types.HistoricalBlockRoots,
      stateRoots: phase0Types.HistoricalStateRoots,
      historicalRoots: new ListType({
        elementType: new RootType({
          expandedType: phase0Types.HistoricalBatch,
        }),
        limit: params.HISTORICAL_ROOTS_LIMIT,
      }),
      // Eth1
      eth1Data: phase0Types.Eth1Data,
      eth1DataVotes: new ListType({
        elementType: phase0Types.Eth1Data,
        limit: params.EPOCHS_PER_ETH1_VOTING_PERIOD * params.SLOTS_PER_EPOCH,
      }),
      eth1DepositIndex: phase0Types.Number64,
      // Registry
      validators: new ListType({
        elementType: phase0Types.Validator,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      balances: new ListType({
        elementType: phase0Types.Gwei,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      randaoMixes: new VectorType({
        elementType: phase0Types.Bytes32,
        length: params.EPOCHS_PER_HISTORICAL_VECTOR,
      }),
      // Slashings
      slashings: new VectorType({
        elementType: phase0Types.Gwei,
        length: params.EPOCHS_PER_SLASHINGS_VECTOR,
      }),
      // Attestations
      previousEpochParticipation: new ListType({
        elementType: phase0Types.ValidatorFlag,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      currentEpochParticipation: new ListType({
        elementType: phase0Types.ValidatorFlag,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      // Finality
      justificationBits: new BitVectorType({
        length: JUSTIFICATION_BITS_LENGTH,
      }),
      previousJustifiedCheckpoint: phase0Types.Checkpoint,
      currentJustifiedCheckpoint: phase0Types.Checkpoint,
      finalizedCheckpoint: phase0Types.Checkpoint,

      currentSyncCommittee: lightclientTypes.SyncCommittee,
      nextSyncCommittee: lightclientTypes.SyncCommittee,
    },
  });
  return container;
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
