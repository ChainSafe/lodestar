import {BitVectorType, ContainerType, ListBasicType, ListCompositeType, VectorCompositeType} from "@chainsafe/ssz";
import {
  FINALIZED_ROOT_DEPTH,
  NEXT_SYNC_COMMITTEE_DEPTH,
  SYNC_COMMITTEE_SUBNET_COUNT,
  SYNC_COMMITTEE_SIZE,
  HISTORICAL_ROOTS_LIMIT,
  VALIDATOR_REGISTRY_LIMIT,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import * as phase0Ssz from "../phase0/sszTypes.js";
import * as primitiveSsz from "../primitive/sszTypes.js";

const {
  Bytes32,
  UintNum64,
  UintBn64,
  Slot,
  SubcommitteeIndex,
  ValidatorIndex,
  Root,
  BLSPubkey,
  BLSSignature,
  ParticipationFlags,
} = primitiveSsz;

export const SyncSubnets = BitVectorType.named(SYNC_COMMITTEE_SUBNET_COUNT, {typeName: "SyncSubnets"});

export const Metadata = ContainerType.named(
  {
    seqNumber: UintBn64,
    attnets: phase0Ssz.AttestationSubnets,
    syncnets: SyncSubnets,
  },
  {typeName: "MetadataAltair", jsonCase: "eth2"}
);

export const SyncCommittee = ContainerType.named(
  {
    pubkeys: VectorCompositeType.named(BLSPubkey, SYNC_COMMITTEE_SIZE, {typeName: "SyncCommitteePubkeys"}),
    aggregatePubkey: BLSPubkey,
  },
  {typeName: "SyncCommittee", jsonCase: "eth2"}
);

export const SyncCommitteeMessage = ContainerType.named(
  {
    slot: Slot,
    beaconBlockRoot: Root,
    validatorIndex: ValidatorIndex,
    signature: BLSSignature,
  },
  {typeName: "SyncCommitteeMessage", jsonCase: "eth2"}
);

export const SyncCommitteeContribution = ContainerType.named(
  {
    slot: Slot,
    beaconBlockRoot: Root,
    subcommitteeIndex: SubcommitteeIndex,
    aggregationBits: BitVectorType.named(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT, {
      typeName: "AggregationBits",
    }),
    signature: BLSSignature,
  },
  {typeName: "SyncCommitteeContribution", jsonCase: "eth2"}
);

export const ContributionAndProof = ContainerType.named(
  {
    aggregatorIndex: ValidatorIndex,
    contribution: SyncCommitteeContribution,
    selectionProof: BLSSignature,
  },
  {typeName: "ContributionAndProof", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedContributionAndProof = ContainerType.named(
  {
    message: ContributionAndProof,
    signature: BLSSignature,
  },
  {typeName: "SignedContributionAndProof", jsonCase: "eth2"}
);

export const SyncAggregatorSelectionData = ContainerType.named(
  {
    slot: Slot,
    subcommitteeIndex: SubcommitteeIndex,
  },
  {typeName: "SyncAggregatorSelectionData", jsonCase: "eth2"}
);

export const SyncCommitteeBits = BitVectorType.named(SYNC_COMMITTEE_SIZE, {typeName: "SyncCommitteeBits"});

export const SyncAggregate = ContainerType.named(
  {
    syncCommitteeBits: SyncCommitteeBits,
    syncCommitteeSignature: BLSSignature,
  },
  {typeName: "SyncCommitteeBits", jsonCase: "eth2"}
);

export const BeaconBlockBody = ContainerType.named(
  {
    ...phase0Ssz.BeaconBlockBody.fields,
    syncAggregate: SyncAggregate,
  },
  {typeName: "BeaconBlockBodyAltair", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = ContainerType.named(
  {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    parentRoot: Root,
    stateRoot: Root,
    body: BeaconBlockBody,
  },
  {typeName: "BeaconBlockAltair", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = ContainerType.named(
  {
    message: BeaconBlock,
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlockAltair", jsonCase: "eth2"}
);

export const EpochParticipation = ListBasicType.named(ParticipationFlags, VALIDATOR_REGISTRY_LIMIT, {
  typeName: "EpochParticipation",
});
export const InactivityScores = ListBasicType.named(UintNum64, VALIDATOR_REGISTRY_LIMIT, {
  typeName: "InactivityScores",
});

// we don't reuse phase0.BeaconState fields since we need to replace some keys
// and we cannot keep order doing that
export const BeaconState = ContainerType.named(
  {
    genesisTime: UintNum64,
    genesisValidatorsRoot: Root,
    slot: Slot,
    fork: phase0Ssz.Fork,
    // History
    latestBlockHeader: phase0Ssz.BeaconBlockHeader,
    blockRoots: phase0Ssz.HistoricalBlockRoots,
    stateRoots: phase0Ssz.HistoricalStateRoots,
    historicalRoots: ListCompositeType.named(Root, HISTORICAL_ROOTS_LIMIT, {typeName: "HistoricalRoots"}),
    // Eth1
    eth1Data: phase0Ssz.Eth1Data,
    eth1DataVotes: phase0Ssz.Eth1DataVotes,
    eth1DepositIndex: UintNum64,
    // Registry
    validators: phase0Ssz.Validators,
    balances: phase0Ssz.Balances,
    randaoMixes: phase0Ssz.RandaoMixes,
    // Slashings
    slashings: phase0Ssz.Slashings,
    // Participation
    previousEpochParticipation: EpochParticipation,
    currentEpochParticipation: EpochParticipation,
    // Finality
    justificationBits: phase0Ssz.JustificationBits,
    previousJustifiedCheckpoint: phase0Ssz.Checkpoint,
    currentJustifiedCheckpoint: phase0Ssz.Checkpoint,
    finalizedCheckpoint: phase0Ssz.Checkpoint,
    // Inactivity
    inactivityScores: InactivityScores,
    // Sync
    currentSyncCommittee: SyncCommittee,
    nextSyncCommittee: SyncCommittee,
  },
  {typeName: "BeaconStateAltair", jsonCase: "eth2"}
);

export const LightClientHeader = ContainerType.named(
  {
    beacon: phase0Ssz.BeaconBlockHeader,
  },
  {typeName: "LightClientHeader", jsonCase: "eth2"}
);

export const LightClientBootstrap = ContainerType.named(
  {
    header: LightClientHeader,
    currentSyncCommittee: SyncCommittee,
    currentSyncCommitteeBranch: VectorCompositeType.named(Bytes32, NEXT_SYNC_COMMITTEE_DEPTH, {
      typeName: "CurrentSyncCommitteeBranch",
    }),
  },
  {typeName: "LightClientBootstrap", jsonCase: "eth2"}
);

export const LightClientUpdate = ContainerType.named(
  {
    attestedHeader: LightClientHeader,
    nextSyncCommittee: SyncCommittee,
    nextSyncCommitteeBranch: VectorCompositeType.named(Bytes32, NEXT_SYNC_COMMITTEE_DEPTH, {
      typeName: "NextSyncCommitteeBranch",
    }),
    finalizedHeader: LightClientHeader,
    finalityBranch: VectorCompositeType.named(Bytes32, FINALIZED_ROOT_DEPTH, {typeName: "FinalityBranch"}),
    syncAggregate: SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientUpdate", jsonCase: "eth2"}
);

export const LightClientFinalityUpdate = ContainerType.named(
  {
    attestedHeader: LightClientHeader,
    finalizedHeader: LightClientHeader,
    finalityBranch: VectorCompositeType.named(Bytes32, FINALIZED_ROOT_DEPTH, {typeName: "FinalityBranch"}),
    syncAggregate: SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientFinalityUpdate", jsonCase: "eth2"}
);

export const LightClientOptimisticUpdate = ContainerType.named(
  {
    attestedHeader: LightClientHeader,
    syncAggregate: SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientOptimisticUpdate", jsonCase: "eth2"}
);

export const LightClientUpdatesByRange = ContainerType.named(
  {
    startPeriod: UintNum64,
    count: UintNum64,
  },
  {typeName: "LightClientUpdatesByRange", jsonCase: "eth2"}
);

export const LightClientStore = ContainerType.named(
  {
    snapshot: LightClientBootstrap,
    validUpdates: ListCompositeType.named(LightClientUpdate, EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH, {
      typeName: "ValidUpdates",
    }),
  },
  {typeName: "LightClientStore", jsonCase: "eth2"}
);
