import {BitVectorType, ContainerType, VectorType, ListType, RootType, Vector} from "@chainsafe/ssz";
import {
  JUSTIFICATION_BITS_LENGTH,
  FINALIZED_ROOT_DEPTH,
  NEXT_SYNC_COMMITTEE_DEPTH,
  SYNC_COMMITTEE_SUBNET_COUNT,
  SYNC_COMMITTEE_SIZE,
  SLOTS_PER_HISTORICAL_ROOT,
  HISTORICAL_ROOTS_LIMIT,
  VALIDATOR_REGISTRY_LIMIT,
  EPOCHS_PER_HISTORICAL_VECTOR,
  EPOCHS_PER_SLASHINGS_VECTOR,
} from "@chainsafe/lodestar-params";
import {Root} from "../primitive/types";
import {ssz as phase0Ssz, ts as phase0Types} from "../phase0";
import {ssz as primitiveSsz} from "../primitive";
import {LazyVariable} from "../utils/lazyVar";
import * as altair from "./types";

const {
  Bytes32,
  Number64,
  Slot,
  SubcommitteeIndex,
  ValidatorIndex,
  Gwei,
  Root,
  Version,
  BLSPubkey,
  BLSSignature,
  ParticipationFlags,
} = primitiveSsz;

// So the expandedRoots can be referenced, and break the circular dependency
const typesRef = new LazyVariable<{
  BeaconBlock: ContainerType<altair.BeaconBlock>;
  BeaconState: ContainerType<altair.BeaconState>;
}>();

export const SyncSubnets = new BitVectorType({
  length: SYNC_COMMITTEE_SUBNET_COUNT,
});

export const Metadata = new ContainerType<altair.Metadata>({
  fields: {
    ...phase0Ssz.Metadata.fields,
    syncnets: SyncSubnets,
  },
  // New keys are strictly appended, phase0 key order is preserved
  casingMap: {
    ...phase0Ssz.Metadata.casingMap,
    syncnets: "syncnets",
  },
});

export const SyncCommittee = new ContainerType<altair.SyncCommittee>({
  fields: {
    pubkeys: new VectorType({elementType: BLSPubkey, length: SYNC_COMMITTEE_SIZE}),
    aggregatePubkey: BLSPubkey,
  },
  casingMap: {
    pubkeys: "pubkeys",
    aggregatePubkey: "aggregate_pubkey",
  },
});

export const SyncCommitteeMessage = new ContainerType<altair.SyncCommitteeMessage>({
  fields: {
    slot: Slot,
    beaconBlockRoot: Root,
    validatorIndex: ValidatorIndex,
    signature: BLSSignature,
  },
  casingMap: {
    slot: "slot",
    beaconBlockRoot: "beacon_block_root",
    validatorIndex: "validator_index",
    signature: "signature",
  },
});

export const SyncCommitteeContribution = new ContainerType<altair.SyncCommitteeContribution>({
  fields: {
    slot: Slot,
    beaconBlockRoot: Root,
    subcommitteeIndex: SubcommitteeIndex,
    aggregationBits: new BitVectorType({length: SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT}),
    signature: BLSSignature,
  },
  casingMap: {
    slot: "slot",
    beaconBlockRoot: "beacon_block_root",
    subcommitteeIndex: "subcommittee_index",
    aggregationBits: "aggregation_bits",
    signature: "signature",
  },
});

export const ContributionAndProof = new ContainerType<altair.ContributionAndProof>({
  fields: {
    aggregatorIndex: ValidatorIndex,
    contribution: SyncCommitteeContribution,
    selectionProof: BLSSignature,
  },
  casingMap: {
    aggregatorIndex: "aggregator_index",
    contribution: "contribution",
    selectionProof: "selection_proof",
  },
});

export const SignedContributionAndProof = new ContainerType<altair.SignedContributionAndProof>({
  fields: {
    message: ContributionAndProof,
    signature: BLSSignature,
  },
  expectedCase: "notransform",
});

export const SyncAggregatorSelectionData = new ContainerType<altair.SyncAggregatorSelectionData>({
  fields: {
    slot: Slot,
    subcommitteeIndex: SubcommitteeIndex,
  },
  casingMap: {
    slot: "slot",
    subcommitteeIndex: "subcommittee_index",
  },
});

export const SyncCommitteeBits = new BitVectorType({
  length: SYNC_COMMITTEE_SIZE,
});

export const SyncAggregate = new ContainerType<altair.SyncAggregate>({
  fields: {
    syncCommitteeBits: SyncCommitteeBits,
    syncCommitteeSignature: BLSSignature,
  },
  casingMap: {
    syncCommitteeBits: "sync_committee_bits",
    syncCommitteeSignature: "sync_committee_signature",
  },
});

// Re-declare with the new expanded type
export const HistoricalBlockRoots = new VectorType<Vector<Root>>({
  elementType: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
  length: SLOTS_PER_HISTORICAL_ROOT,
});

export const HistoricalStateRoots = new VectorType<Vector<Root>>({
  elementType: new RootType({expandedType: () => typesRef.get().BeaconState}),
  length: SLOTS_PER_HISTORICAL_ROOT,
});

export const HistoricalBatch = new ContainerType<phase0Types.HistoricalBatch>({
  fields: {
    blockRoots: HistoricalBlockRoots,
    stateRoots: HistoricalStateRoots,
  },
  casingMap: phase0Ssz.HistoricalBatch.casingMap,
});

export const BeaconBlockBody = new ContainerType<altair.BeaconBlockBody>({
  fields: {
    ...phase0Ssz.BeaconBlockBody.fields,
    syncAggregate: SyncAggregate,
  },
  casingMap: {
    ...phase0Ssz.BeaconBlockBody.casingMap,
    syncAggregate: "sync_aggregate",
  },
});

export const BeaconBlock = new ContainerType<altair.BeaconBlock>({
  fields: {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    // Reclare expandedType() with altair block and altair state
    parentRoot: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
    stateRoot: new RootType({expandedType: () => typesRef.get().BeaconState}),
    body: BeaconBlockBody,
  },
  casingMap: phase0Ssz.BeaconBlock.casingMap,
});

export const SignedBeaconBlock = new ContainerType<altair.SignedBeaconBlock>({
  fields: {
    message: BeaconBlock,
    signature: BLSSignature,
  },
  expectedCase: "notransform",
});

export const EpochParticipation = new ListType({elementType: ParticipationFlags, limit: VALIDATOR_REGISTRY_LIMIT});
export const InactivityScores = new ListType({elementType: Number64, limit: VALIDATOR_REGISTRY_LIMIT});

// we don't reuse phase0.BeaconState fields since we need to replace some keys
// and we cannot keep order doing that
export const BeaconState = new ContainerType<altair.BeaconState>({
  fields: {
    genesisTime: Number64,
    genesisValidatorsRoot: Root,
    slot: Slot,
    fork: phase0Ssz.Fork,
    // History
    latestBlockHeader: phase0Ssz.BeaconBlockHeader,
    blockRoots: HistoricalBlockRoots,
    stateRoots: HistoricalStateRoots,
    historicalRoots: new ListType({
      elementType: new RootType({expandedType: HistoricalBatch}),
      limit: HISTORICAL_ROOTS_LIMIT,
    }),
    // Eth1
    eth1Data: phase0Ssz.Eth1Data,
    eth1DataVotes: phase0Ssz.Eth1DataVotes,
    eth1DepositIndex: Number64,
    // Registry
    validators: new ListType({elementType: phase0Ssz.Validator, limit: VALIDATOR_REGISTRY_LIMIT}),
    balances: new ListType({elementType: Number64, limit: VALIDATOR_REGISTRY_LIMIT}),
    randaoMixes: new VectorType({elementType: Bytes32, length: EPOCHS_PER_HISTORICAL_VECTOR}),
    // Slashings
    slashings: new VectorType({elementType: Gwei, length: EPOCHS_PER_SLASHINGS_VECTOR}),
    // Participation
    previousEpochParticipation: EpochParticipation,
    currentEpochParticipation: EpochParticipation,
    // Finality
    justificationBits: new BitVectorType({length: JUSTIFICATION_BITS_LENGTH}),
    previousJustifiedCheckpoint: phase0Ssz.Checkpoint,
    currentJustifiedCheckpoint: phase0Ssz.Checkpoint,
    finalizedCheckpoint: phase0Ssz.Checkpoint,
    // Inactivity
    inactivityScores: InactivityScores,
    // Sync
    currentSyncCommittee: SyncCommittee,
    nextSyncCommittee: SyncCommittee,
  },
  casingMap: {
    ...phase0Ssz.BeaconState.casingMap,
    inactivityScores: "inactivity_scores",
    currentSyncCommittee: "current_sync_committee",
    nextSyncCommittee: "next_sync_committee",
  },
});

export const LightClientUpdate = new ContainerType<altair.LightClientUpdate>({
  fields: {
    attestedHeader: phase0Ssz.BeaconBlockHeader,
    nextSyncCommittee: SyncCommittee,
    nextSyncCommitteeBranch: new VectorType({
      elementType: Bytes32,
      length: NEXT_SYNC_COMMITTEE_DEPTH,
    }),
    finalizedHeader: phase0Ssz.BeaconBlockHeader,
    finalityBranch: new VectorType({elementType: Bytes32, length: FINALIZED_ROOT_DEPTH}),
    syncAggregate: SyncAggregate,
    forkVersion: Version,
  },
  casingMap: {
    attestedHeader: "attested_header",
    nextSyncCommittee: "next_sync_committee",
    nextSyncCommitteeBranch: "next_sync_committee_branch",
    finalizedHeader: "finalized_header",
    finalityBranch: "finality_branch",
    syncAggregate: "sync_aggregate",
    forkVersion: "fork_version",
  },
});

// MUST set typesRef here, otherwise expandedType() calls will throw
typesRef.set({BeaconBlock, BeaconState});
