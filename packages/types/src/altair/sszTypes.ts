import {
  JUSTIFICATION_BITS_LENGTH,
  FINALIZED_ROOT_INDEX_FLOORLOG2,
  NEXT_SYNC_COMMITTEE_INDEX_FLOORLOG2,
  SYNC_COMMITTEE_SUBNET_COUNT,
  SYNC_COMMITTEE_SIZE,
  SLOTS_PER_HISTORICAL_ROOT,
  HISTORICAL_ROOTS_LIMIT,
  EPOCHS_PER_ETH1_VOTING_PERIOD,
  SLOTS_PER_EPOCH,
  VALIDATOR_REGISTRY_LIMIT,
  EPOCHS_PER_HISTORICAL_VECTOR,
  EPOCHS_PER_SLASHINGS_VECTOR,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
} from "@chainsafe/lodestar-params";
import {BitVectorType, ContainerType, VectorType, ListType, RootType, Vector} from "@chainsafe/ssz";
import {ssz as phase0Ssz} from "../phase0";
import {ssz as primitiveSsz} from "../primitive";
import {LazyVariable} from "../utils/lazyVar";
import * as altair from "./types";

const {
  Bytes32,
  Number64,
  Uint64,
  Slot,
  SubCommitteeIndex,
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
    seqNumber: Uint64,
    attnets: phase0Ssz.AttestationSubnets,
    syncnets: SyncSubnets,
  },
});

export const SyncCommittee = new ContainerType<altair.SyncCommittee>({
  fields: {
    pubkeys: new VectorType({elementType: BLSPubkey, length: SYNC_COMMITTEE_SIZE}),
    aggregatePubkey: BLSPubkey,
  },
});

export const SyncCommitteeMessage = new ContainerType<altair.SyncCommitteeMessage>({
  fields: {
    slot: Slot,
    beaconBlockRoot: Root,
    validatorIndex: ValidatorIndex,
    signature: BLSSignature,
  },
});

export const SyncCommitteeContribution = new ContainerType<altair.SyncCommitteeContribution>({
  fields: {
    slot: Slot,
    beaconBlockRoot: Root,
    subCommitteeIndex: SubCommitteeIndex,
    aggregationBits: new BitVectorType({length: SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT}),
    signature: BLSSignature,
  },
});

export const ContributionAndProof = new ContainerType<altair.ContributionAndProof>({
  fields: {
    aggregatorIndex: ValidatorIndex,
    contribution: SyncCommitteeContribution,
    selectionProof: BLSSignature,
  },
});

export const SignedContributionAndProof = new ContainerType<altair.SignedContributionAndProof>({
  fields: {
    message: ContributionAndProof,
    signature: BLSSignature,
  },
});

export const SyncAggregatorSelectionData = new ContainerType<altair.SyncAggregatorSelectionData>({
  fields: {
    slot: Slot,
    subCommitteeIndex: SubCommitteeIndex,
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
});

// Re-declare with the new expanded type
export const HistoricalBlockRoots = new VectorType<Vector<altair.Root>>({
  elementType: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
  length: SLOTS_PER_HISTORICAL_ROOT,
});

export const HistoricalStateRoots = new VectorType<Vector<altair.Root>>({
  elementType: new RootType({expandedType: () => typesRef.get().BeaconState}),
  length: SLOTS_PER_HISTORICAL_ROOT,
});

export const HistoricalBatch = new ContainerType<altair.HistoricalBatch>({
  fields: {
    blockRoots: HistoricalBlockRoots,
    stateRoots: HistoricalStateRoots,
  },
});

export const BeaconBlockBody = new ContainerType<altair.BeaconBlockBody>({
  fields: {
    ...phase0Ssz.BeaconBlockBody.fields,
    syncAggregate: SyncAggregate,
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
});

export const SignedBeaconBlock = new ContainerType<altair.SignedBeaconBlock>({
  fields: {
    message: BeaconBlock,
    signature: BLSSignature,
  },
});

//we don't reuse phase0.BeaconState fields since we need to replace some keys
//and we cannot keep order doing that
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
    eth1DataVotes: new ListType({
      elementType: phase0Ssz.Eth1Data,
      limit: EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH,
    }),
    eth1DepositIndex: Number64,
    // Registry
    validators: new ListType({elementType: phase0Ssz.Validator, limit: VALIDATOR_REGISTRY_LIMIT}),
    balances: new ListType({elementType: Number64, limit: VALIDATOR_REGISTRY_LIMIT}),
    randaoMixes: new VectorType({elementType: Bytes32, length: EPOCHS_PER_HISTORICAL_VECTOR}),
    // Slashings
    slashings: new VectorType({elementType: Gwei, length: EPOCHS_PER_SLASHINGS_VECTOR}),
    // Participation
    previousEpochParticipation: new ListType({
      elementType: ParticipationFlags,
      limit: VALIDATOR_REGISTRY_LIMIT,
    }),
    currentEpochParticipation: new ListType({
      elementType: ParticipationFlags,
      limit: VALIDATOR_REGISTRY_LIMIT,
    }),
    // Finality
    justificationBits: new BitVectorType({length: JUSTIFICATION_BITS_LENGTH}),
    previousJustifiedCheckpoint: phase0Ssz.Checkpoint,
    currentJustifiedCheckpoint: phase0Ssz.Checkpoint,
    finalizedCheckpoint: phase0Ssz.Checkpoint,
    // Inactivity
    inactivityScores: new ListType({elementType: Number64, limit: VALIDATOR_REGISTRY_LIMIT}),
    // Sync
    currentSyncCommittee: SyncCommittee,
    nextSyncCommittee: SyncCommittee,
  },
});

export const LightClientSnapshot = new ContainerType<altair.LightClientSnapshot>({
  fields: {
    header: phase0Ssz.BeaconBlockHeader,
    nextSyncCommittee: SyncCommittee,
    currentSyncCommittee: SyncCommittee,
  },
});

export const LightClientUpdate = new ContainerType<altair.LightClientUpdate>({
  fields: {
    header: phase0Ssz.BeaconBlockHeader,
    nextSyncCommittee: SyncCommittee,
    nextSyncCommitteeBranch: new VectorType({
      elementType: Bytes32,
      length: NEXT_SYNC_COMMITTEE_INDEX_FLOORLOG2,
    }),
    finalityHeader: phase0Ssz.BeaconBlockHeader,
    finalityBranch: new VectorType({elementType: Bytes32, length: FINALIZED_ROOT_INDEX_FLOORLOG2}),
    syncCommitteeBits: new BitVectorType({length: SYNC_COMMITTEE_SIZE}),
    syncCommitteeSignature: BLSSignature,
    forkVersion: Version,
  },
});

export const LightClientStore = new ContainerType<altair.LightClientStore>({
  fields: {
    snapshot: LightClientSnapshot,
    validUpdates: new ListType({
      elementType: LightClientUpdate,
      limit: EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH,
    }),
  },
});

// MUST set typesRef here, otherwise expandedType() calls will throw
typesRef.set({BeaconBlock, BeaconState});
