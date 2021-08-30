import {
  ATTESTATION_SUBNET_COUNT,
  DEPOSIT_CONTRACT_TREE_DEPTH,
  EPOCHS_PER_ETH1_VOTING_PERIOD,
  EPOCHS_PER_HISTORICAL_VECTOR,
  EPOCHS_PER_SLASHINGS_VECTOR,
  HISTORICAL_ROOTS_LIMIT,
  JUSTIFICATION_BITS_LENGTH,
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_DEPOSITS,
  MAX_PROPOSER_SLASHINGS,
  MAX_REQUEST_BLOCKS,
  MAX_VALIDATORS_PER_COMMITTEE,
  MAX_VOLUNTARY_EXITS,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
  VALIDATOR_REGISTRY_LIMIT,
} from "@chainsafe/lodestar-params";
import {
  BitListType,
  BitVectorType,
  ContainerLeafNodeStructType,
  ContainerType,
  List,
  ListType,
  RootType,
  Vector,
  VectorType,
} from "@chainsafe/ssz";
import {ssz as primitiveSsz} from "../primitive";
import {LazyVariable} from "../utils/lazyVar";
import * as phase0 from "./types";

const {
  Boolean,
  Bytes32,
  Number64,
  Uint64,
  Slot,
  Epoch,
  CommitteeIndex,
  ValidatorIndex,
  Gwei,
  Root,
  Version,
  ForkDigest,
  BLSPubkey,
  BLSSignature,
  Domain,
} = primitiveSsz;

// So the expandedRoots can be referenced, and break the circular dependency
const typesRef = new LazyVariable<{
  BeaconBlock: ContainerType<phase0.BeaconBlock>;
  BeaconState: ContainerType<phase0.BeaconState>;
}>();

// Misc types
// ==========

export const AttestationSubnets = new BitVectorType({
  length: ATTESTATION_SUBNET_COUNT,
});

export const BeaconBlockHeader = new ContainerType<phase0.BeaconBlockHeader>({
  fields: {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    parentRoot: Root,
    stateRoot: Root,
    bodyRoot: Root,
  },
});

export const SignedBeaconBlockHeader = new ContainerType<phase0.SignedBeaconBlockHeader>({
  fields: {
    message: BeaconBlockHeader,
    signature: BLSSignature,
  },
});

export const Checkpoint = new ContainerType<phase0.Checkpoint>({
  fields: {
    epoch: Epoch,
    root: Root,
  },
});

export const CommitteeBits = new BitListType({
  limit: MAX_VALIDATORS_PER_COMMITTEE,
});

export const CommitteeIndices = new ListType<List<phase0.ValidatorIndex>>({
  elementType: ValidatorIndex,
  limit: MAX_VALIDATORS_PER_COMMITTEE,
});

export const DepositMessage = new ContainerType<phase0.DepositMessage>({
  fields: {
    pubkey: BLSPubkey,
    withdrawalCredentials: Bytes32,
    amount: Gwei,
  },
});

export const DepositData = new ContainerType<phase0.DepositData>({
  fields: {
    pubkey: BLSPubkey,
    withdrawalCredentials: Bytes32,
    amount: Gwei,
    signature: BLSSignature,
  },
});

export const DepositDataRootList = new ListType<List<phase0.Root>>({
  elementType: new RootType({expandedType: DepositData}),
  limit: 2 ** DEPOSIT_CONTRACT_TREE_DEPTH,
});

export const DepositEvent = new ContainerType<phase0.DepositEvent>({
  fields: {
    depositData: DepositData,
    blockNumber: Number64,
    index: Number64,
  },
});

export const Eth1Data = new ContainerType<phase0.Eth1Data>({
  fields: {
    depositRoot: Root,
    depositCount: Number64,
    blockHash: Bytes32,
  },
});

export const Eth1DataOrdered = new ContainerType<phase0.Eth1DataOrdered>({
  fields: {
    depositRoot: Root,
    depositCount: Number64,
    blockHash: Bytes32,
    blockNumber: Number64,
  },
});

export const Fork = new ContainerType<phase0.Fork>({
  fields: {
    previousVersion: Version,
    currentVersion: Version,
    epoch: Epoch,
  },
});

export const ForkData = new ContainerType<phase0.ForkData>({
  fields: {
    currentVersion: Version,
    genesisValidatorsRoot: Root,
  },
});

export const ENRForkID = new ContainerType<phase0.ENRForkID>({
  fields: {
    forkDigest: ForkDigest,
    nextForkVersion: Version,
    nextForkEpoch: Epoch,
  },
});

export const HistoricalBlockRoots = new VectorType<Vector<phase0.Root>>({
  elementType: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
  length: SLOTS_PER_HISTORICAL_ROOT,
});

export const HistoricalStateRoots = new VectorType<Vector<phase0.Root>>({
  elementType: new RootType({expandedType: () => typesRef.get().BeaconState}),
  length: SLOTS_PER_HISTORICAL_ROOT,
});

export const HistoricalBatch = new ContainerType<phase0.HistoricalBatch>({
  fields: {
    blockRoots: HistoricalBlockRoots,
    stateRoots: HistoricalStateRoots,
  },
});

export const Validator = new ContainerLeafNodeStructType<phase0.Validator>({
  fields: {
    pubkey: BLSPubkey,
    withdrawalCredentials: Bytes32,
    effectiveBalance: Gwei,
    slashed: Boolean,
    activationEligibilityEpoch: Epoch,
    activationEpoch: Epoch,
    exitEpoch: Epoch,
    withdrawableEpoch: Epoch,
  },
});

// Misc dependants

export const AttestationData = new ContainerType<phase0.AttestationData>({
  fields: {
    slot: Slot,
    index: CommitteeIndex,
    beaconBlockRoot: Root,
    source: Checkpoint,
    target: Checkpoint,
  },
});

export const IndexedAttestation = new ContainerType<phase0.IndexedAttestation>({
  fields: {
    attestingIndices: CommitteeIndices,
    data: AttestationData,
    signature: BLSSignature,
  },
});

export const PendingAttestation = new ContainerType<phase0.PendingAttestation>({
  fields: {
    aggregationBits: CommitteeBits,
    data: AttestationData,
    inclusionDelay: Slot,
    proposerIndex: ValidatorIndex,
  },
});

export const SigningData = new ContainerType<phase0.SigningData>({
  fields: {
    objectRoot: Root,
    domain: Domain,
  },
});

// Operations types
// ================

export const Attestation = new ContainerType<phase0.Attestation>({
  fields: {
    aggregationBits: CommitteeBits,
    data: AttestationData,
    signature: BLSSignature,
  },
});

export const AttesterSlashing = new ContainerType<phase0.AttesterSlashing>({
  fields: {
    attestation1: IndexedAttestation,
    attestation2: IndexedAttestation,
  },
});

export const Deposit = new ContainerType<phase0.Deposit>({
  fields: {
    proof: new VectorType({elementType: Bytes32, length: DEPOSIT_CONTRACT_TREE_DEPTH + 1}),
    data: DepositData,
  },
});

export const ProposerSlashing = new ContainerType<phase0.ProposerSlashing>({
  fields: {
    signedHeader1: SignedBeaconBlockHeader,
    signedHeader2: SignedBeaconBlockHeader,
  },
});

export const VoluntaryExit = new ContainerType<phase0.VoluntaryExit>({
  fields: {
    epoch: Epoch,
    validatorIndex: ValidatorIndex,
  },
});

export const SignedVoluntaryExit = new ContainerType<phase0.SignedVoluntaryExit>({
  fields: {
    message: VoluntaryExit,
    signature: BLSSignature,
  },
});

// Block types
// ===========

export const BeaconBlockBody = new ContainerType<phase0.BeaconBlockBody>({
  fields: {
    randaoReveal: BLSSignature,
    eth1Data: Eth1Data,
    graffiti: Bytes32,
    proposerSlashings: new ListType({elementType: ProposerSlashing, limit: MAX_PROPOSER_SLASHINGS}),
    attesterSlashings: new ListType({elementType: AttesterSlashing, limit: MAX_ATTESTER_SLASHINGS}),
    attestations: new ListType({elementType: Attestation, limit: MAX_ATTESTATIONS}),
    deposits: new ListType({elementType: Deposit, limit: MAX_DEPOSITS}),
    voluntaryExits: new ListType({elementType: SignedVoluntaryExit, limit: MAX_VOLUNTARY_EXITS}),
  },
});

export const BeaconBlock = new ContainerType<phase0.BeaconBlock>({
  fields: {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    parentRoot: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
    stateRoot: new RootType({expandedType: () => typesRef.get().BeaconState}),
    body: BeaconBlockBody,
  },
});

export const SignedBeaconBlock = new ContainerType<phase0.SignedBeaconBlock>({
  fields: {
    message: BeaconBlock,
    signature: BLSSignature,
  },
});

// State types
// ===========

export const EpochAttestations = new ListType<List<phase0.PendingAttestation>>({
  elementType: PendingAttestation,
  limit: MAX_ATTESTATIONS * SLOTS_PER_EPOCH,
});

export const Balances = new ListType<List<bigint>>({elementType: Gwei, limit: VALIDATOR_REGISTRY_LIMIT});

export const BeaconState = new ContainerType<phase0.BeaconState>({
  fields: {
    // Misc
    genesisTime: Number64,
    genesisValidatorsRoot: Root,
    slot: Slot,
    fork: Fork,
    // History
    latestBlockHeader: BeaconBlockHeader,
    blockRoots: HistoricalBlockRoots,
    stateRoots: HistoricalStateRoots,
    historicalRoots: new ListType({
      elementType: new RootType({expandedType: HistoricalBatch}),
      limit: HISTORICAL_ROOTS_LIMIT,
    }),
    // Eth1
    eth1Data: Eth1Data,
    eth1DataVotes: new ListType({
      elementType: Eth1Data,
      limit: EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH,
    }),
    eth1DepositIndex: Number64,
    // Registry
    validators: new ListType({elementType: Validator, limit: VALIDATOR_REGISTRY_LIMIT}),
    balances: Balances,
    randaoMixes: new VectorType({elementType: Bytes32, length: EPOCHS_PER_HISTORICAL_VECTOR}),
    // Slashings
    slashings: new VectorType({elementType: Gwei, length: EPOCHS_PER_SLASHINGS_VECTOR}),
    // Attestations
    previousEpochAttestations: EpochAttestations,
    currentEpochAttestations: EpochAttestations,
    // Finality
    justificationBits: new BitVectorType({length: JUSTIFICATION_BITS_LENGTH}),
    previousJustifiedCheckpoint: Checkpoint,
    currentJustifiedCheckpoint: Checkpoint,
    finalizedCheckpoint: Checkpoint,
  },
});

// Validator types
// ===============

export const CommitteeAssignment = new ContainerType<phase0.CommitteeAssignment>({
  fields: {
    validators: CommitteeIndices,
    committeeIndex: CommitteeIndex,
    slot: Slot,
  },
});

export const AggregateAndProof = new ContainerType<phase0.AggregateAndProof>({
  fields: {
    aggregatorIndex: ValidatorIndex,
    aggregate: Attestation,
    selectionProof: BLSSignature,
  },
});

export const SignedAggregateAndProof = new ContainerType<phase0.SignedAggregateAndProof>({
  fields: {
    message: AggregateAndProof,
    signature: BLSSignature,
  },
});

// ReqResp types
// =============

export const Status = new ContainerType<phase0.Status>({
  fields: {
    forkDigest: ForkDigest,
    finalizedRoot: Root,
    finalizedEpoch: Epoch,
    headRoot: Root,
    headSlot: Slot,
  },
});

export const Goodbye = Uint64;

export const Ping = Uint64;

export const Metadata = new ContainerType<phase0.Metadata>({
  fields: {
    seqNumber: Uint64,
    attnets: AttestationSubnets,
  },
});

export const BeaconBlocksByRangeRequest = new ContainerType<phase0.BeaconBlocksByRangeRequest>({
  fields: {
    startSlot: Slot,
    count: Number64,
    step: Number64,
  },
});

export const BeaconBlocksByRootRequest = new ListType({elementType: Root, limit: MAX_REQUEST_BLOCKS});

// Api types
// =========

export const Genesis = new ContainerType<phase0.Genesis>({
  fields: {
    genesisValidatorsRoot: Root,
    genesisTime: Uint64,
    genesisForkVersion: Version,
  },
});

// MUST set typesRef here, otherwise expandedType() calls will throw
typesRef.set({BeaconBlock, BeaconState});
