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

export const SyncSubnets = new BitVectorType(SYNC_COMMITTEE_SUBNET_COUNT);

export const Metadata = new ContainerType(
  {
    seqNumber: UintBn64,
    attnets: phase0Ssz.AttestationSubnets,
    syncnets: SyncSubnets,
  },
  {typeName: "Metadata", jsonCase: "eth2"}
);

export const SyncCommittee = new ContainerType(
  {
    pubkeys: new VectorCompositeType(BLSPubkey, SYNC_COMMITTEE_SIZE),
    aggregatePubkey: BLSPubkey,
  },
  {typeName: "SyncCommittee", jsonCase: "eth2"}
);

export const SyncCommitteeMessage = new ContainerType(
  {
    slot: Slot,
    beaconBlockRoot: Root,
    validatorIndex: ValidatorIndex,
    signature: BLSSignature,
  },
  {typeName: "SyncCommitteeMessage", jsonCase: "eth2"}
);

export const SyncCommitteeContribution = new ContainerType(
  {
    slot: Slot,
    beaconBlockRoot: Root,
    subcommitteeIndex: SubcommitteeIndex,
    aggregationBits: new BitVectorType(SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT),
    signature: BLSSignature,
  },
  {typeName: "SyncCommitteeContribution", jsonCase: "eth2"}
);

export const ContributionAndProof = new ContainerType(
  {
    aggregatorIndex: ValidatorIndex,
    contribution: SyncCommitteeContribution,
    selectionProof: BLSSignature,
  },
  {typeName: "ContributionAndProof", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedContributionAndProof = new ContainerType(
  {
    message: ContributionAndProof,
    signature: BLSSignature,
  },
  {typeName: "SignedContributionAndProof", jsonCase: "eth2"}
);

export const SyncAggregatorSelectionData = new ContainerType(
  {
    slot: Slot,
    subcommitteeIndex: SubcommitteeIndex,
  },
  {typeName: "SyncAggregatorSelectionData", jsonCase: "eth2"}
);

export const SyncCommitteeBits = new BitVectorType(SYNC_COMMITTEE_SIZE);

export const SyncAggregate = new ContainerType(
  {
    syncCommitteeBits: SyncCommitteeBits,
    syncCommitteeSignature: BLSSignature,
  },
  {typeName: "SyncCommitteeBits", jsonCase: "eth2"}
);

export const BeaconBlockBody = new ContainerType(
  {
    ...phase0Ssz.BeaconBlockBody.fields,
    syncAggregate: SyncAggregate,
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    parentRoot: Root,
    stateRoot: Root,
    body: BeaconBlockBody,
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock,
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const EpochParticipation = new ListBasicType(ParticipationFlags, VALIDATOR_REGISTRY_LIMIT);
export const InactivityScores = new ListBasicType(UintNum64, VALIDATOR_REGISTRY_LIMIT);

// we don't reuse phase0.BeaconState fields since we need to replace some keys
// and we cannot keep order doing that
export const BeaconState = new ContainerType(
  {
    genesisTime: UintNum64,
    genesisValidatorsRoot: Root,
    slot: Slot,
    fork: phase0Ssz.Fork,
    // History
    latestBlockHeader: phase0Ssz.BeaconBlockHeader,
    blockRoots: phase0Ssz.HistoricalBlockRoots,
    stateRoots: phase0Ssz.HistoricalStateRoots,
    historicalRoots: new ListCompositeType(Root, HISTORICAL_ROOTS_LIMIT),
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
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const LightClientHeader = new ContainerType(
  {
    beacon: phase0Ssz.BeaconBlockHeader,
  },
  {typeName: "LightClientHeader", jsonCase: "eth2"}
);

export const LightClientBootstrap = new ContainerType(
  {
    header: LightClientHeader,
    currentSyncCommittee: SyncCommittee,
    currentSyncCommitteeBranch: new VectorCompositeType(Bytes32, NEXT_SYNC_COMMITTEE_DEPTH),
  },
  {typeName: "LightClientBootstrap", jsonCase: "eth2"}
);

export const LightClientUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    nextSyncCommittee: SyncCommittee,
    nextSyncCommitteeBranch: new VectorCompositeType(Bytes32, NEXT_SYNC_COMMITTEE_DEPTH),
    finalizedHeader: LightClientHeader,
    finalityBranch: new VectorCompositeType(Bytes32, FINALIZED_ROOT_DEPTH),
    syncAggregate: SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientUpdate", jsonCase: "eth2"}
);

export const LightClientFinalityUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    finalizedHeader: LightClientHeader,
    finalityBranch: new VectorCompositeType(Bytes32, FINALIZED_ROOT_DEPTH),
    syncAggregate: SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientFinalityUpdate", jsonCase: "eth2"}
);

export const LightClientOptimisticUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    syncAggregate: SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientOptimisticUpdate", jsonCase: "eth2"}
);

export const LightClientUpdatesByRange = new ContainerType(
  {
    startPeriod: UintNum64,
    count: UintNum64,
  },
  {typeName: "LightClientUpdatesByRange", jsonCase: "eth2"}
);

export const LightClientStore = new ContainerType(
  {
    snapshot: LightClientBootstrap,
    validUpdates: new ListCompositeType(LightClientUpdate, EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH),
  },
  {typeName: "LightClientStore", jsonCase: "eth2"}
);
