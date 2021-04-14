import {
  // TODO add these to params?
  // NEXT_SYNC_COMMITTEE_INDEX,
  // MAX_VALID_LIGHT_CLIENT_UPDATES,
  // FINALIZED_ROOT_INDEX,
  IBeaconParams,
  JUSTIFICATION_BITS_LENGTH,
} from "@chainsafe/lodestar-params";
import {BitVectorType, ContainerType, VectorType, ListType, RootType, BitListType} from "@chainsafe/ssz";
import {IPhase0SSZTypes} from "../../phase0";
import * as altair from "../types";
import {IAltairSSZTypes} from "./interface";

const NEXT_SYNC_COMMITTEE_INDEX = 0;
const MAX_VALID_LIGHT_CLIENT_UPDATES = 0;
const FINALIZED_ROOT_INDEX = 0;

type LightClientTypesGenerator<T> = (
  params: IBeaconParams,
  phase0Types: IPhase0SSZTypes,
  altairTypes: IAltairSSZTypes
) => T;

export const SyncCommittee: LightClientTypesGenerator<ContainerType<altair.SyncCommittee>> = (params, phase0Types) => {
  return new ContainerType({
    fields: {
      pubkeys: new VectorType({
        elementType: phase0Types.BLSPubkey,
        length: params.SYNC_COMMITTEE_SIZE,
      }),
      pubkeyAggregates: new VectorType({
        elementType: phase0Types.BLSPubkey,
        length: Math.floor(params.SYNC_COMMITTEE_SIZE / params.SYNC_PUBKEYS_PER_AGGREGATE),
      }),
    },
  });
};

export const SyncCommitteeSignature: LightClientTypesGenerator<ContainerType<altair.SyncCommitteeSignature>> = (params, phase0Types) => {
  return new ContainerType({
    fields: {
      slot: phase0Types.Slot,
      beaconBlockRoot: phase0Types.Root,
      validatorIndex: phase0Types.ValidatorIndex,
      signature: phase0Types.BLSSignature,
    },
  });
};

export const SyncCommitteeBits: LightClientTypesGenerator<BitListType> = (params) => {
  return new BitListType({
    limit: params.SYNC_COMMITTEE_SIZE / params.SYNC_COMMITTEE_SUBNET_COUNT,
  });
};

export const SyncCommitteeContribution: LightClientTypesGenerator<ContainerType<altair.SyncCommitteeContribution>> = (params, phase0Types, altairTypes) => {
  return new ContainerType({
    fields: {
      slot: phase0Types.Slot,
      beaconBlockRoot: phase0Types.Root,
      subCommitteeIndex: phase0Types.SubCommitteeIndex,
      aggregationBits: altairTypes.SyncCommiteeBits,
      signature: phase0Types.BLSSignature,
    },
  });
};

export const ContributionAndProof: LightClientTypesGenerator<ContainerType<altair.ContributionAndProof>> = (params, phase0Types, altairTypes) => {
  return new ContainerType({
    fields: {
      aggregatorIndex: phase0Types.ValidatorIndex,
      contribution: altairTypes.SyncCommitteeContribution,
    },
  });
};

export const SignedContributionAndProof: LightClientTypesGenerator<ContainerType<altair.SignedContributionAndProof>> = (params, phase0Types, altairTypes) => {
  return new ContainerType({
    fields: {
      message: altairTypes.ContributionAndProof,
      signature: phase0Types.BLSSignature,
    },
  });
};

export const SyncCommitteeSigningData: LightClientTypesGenerator<ContainerType<altair.SyncCommitteeSigningData>> = (params, phase0Types, altairTypes) => {
  return new ContainerType({
    fields: {
      slot: phase0Types.Slot,
      subCommitteeIndex: phase0Types.SubCommitteeIndex,
    },
  });
};

export const SyncAggregate: LightClientTypesGenerator<ContainerType<altair.SyncAggregate>> = (params, phase0Types) => {
  return new ContainerType({
    fields: {
      syncCommitteeBits: new BitVectorType({length: params.SYNC_COMMITTEE_SIZE}),
      syncCommitteeSignature: phase0Types.BLSSignature,
    },
  });
};

export const BeaconBlockBody: LightClientTypesGenerator<ContainerType<altair.BeaconBlockBody>> = (
  params,
  phase0Types,
  altairTypes
) => {
  return new ContainerType({
    fields: {
      ...phase0Types.BeaconBlockBody.fields,
      syncAggregate: altairTypes.SyncAggregate,
    },
  });
};
export const BeaconBlock: LightClientTypesGenerator<ContainerType<altair.BeaconBlock>> = (
  params,
  phase0Types,
  altairTypes
) => {
  return new ContainerType({
    fields: {
      ...phase0Types.BeaconBlock.fields,
      body: altairTypes.BeaconBlockBody,
    },
  });
};

export const SignedBeaconBlock: LightClientTypesGenerator<ContainerType<altair.SignedBeaconBlock>> = (
  params,
  phase0Types,
  altairTypes
) => {
  return new ContainerType({
    fields: {
      message: altairTypes.BeaconBlock,
      signature: phase0Types.BLSSignature,
    },
  });
};

export const BeaconState: LightClientTypesGenerator<ContainerType<altair.BeaconState>> = (
  params,
  phase0Types,
  altairTypes
) => {
  //we don't reuse phase0.BeaconState fields since we need to replace some keys
  //and we cannot keep order doing that
  const container = new ContainerType<altair.BeaconState>({
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
      // Participation
      previousEpochParticipation: new ListType({
        elementType: phase0Types.ParticipationFlags,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      currentEpochParticipation: new ListType({
        elementType: phase0Types.ParticipationFlags,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      // Finality
      justificationBits: new BitVectorType({
        length: JUSTIFICATION_BITS_LENGTH,
      }),
      previousJustifiedCheckpoint: phase0Types.Checkpoint,
      currentJustifiedCheckpoint: phase0Types.Checkpoint,
      finalizedCheckpoint: phase0Types.Checkpoint,
      // Inactivity
      inactivityScores: new ListType({
        elementType: phase0Types.Number64,
        limit: params.VALIDATOR_REGISTRY_LIMIT,
      }),
      // Sync
      currentSyncCommittee: altairTypes.SyncCommittee,
      nextSyncCommittee: altairTypes.SyncCommittee,
    },
  });
  return container;
};

export const AltairSnapshot: LightClientTypesGenerator<ContainerType<altair.AltairSnapshot>> = (
  params,
  phase0Types,
  altairTypes
) => {
  return new ContainerType({
    fields: {
      header: altairTypes.BeaconBlockHeader,
      nextSyncCommittee: altairTypes.SyncCommittee,
      currentSyncCommittee: altairTypes.SyncCommittee,
    },
  });
};

export const AltairUpdate: LightClientTypesGenerator<ContainerType<altair.AltairUpdate>> = (
  params,
  phase0Types,
  altairTypes
) => {
  return new ContainerType({
    fields: {
      header: altairTypes.BeaconBlockHeader,
      nextSyncCommittee: altairTypes.SyncCommittee,
      nextSyncCommitteeBranch: new VectorType({
        elementType: phase0Types.Bytes32,
        length: Math.log2(NEXT_SYNC_COMMITTEE_INDEX),
      }),
      finalityHeader: altairTypes.BeaconBlockHeader,
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

export const AltairStore: LightClientTypesGenerator<ContainerType<altair.AltairStore>> = (
  params,
  phase0Types,
  altairTypes
) => {
  return new ContainerType({
    fields: {
      snapshot: altairTypes.AltairSnapshot,
      validUpdates: new ListType({
        elementType: altairTypes.AltairUpdate,
        limit: MAX_VALID_LIGHT_CLIENT_UPDATES,
      }),
    },
  });
};
