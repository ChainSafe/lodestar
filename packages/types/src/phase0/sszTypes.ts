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
import {ssz as primitiveSsz, ts as primitiveTs} from "../primitive";
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
  casingMap: {
    slot: "slot",
    proposerIndex: "proposer_index",
    parentRoot: "parent_root",
    stateRoot: "state_root",
    bodyRoot: "body_root",
  },
});

export const SignedBeaconBlockHeader = new ContainerType<phase0.SignedBeaconBlockHeader>({
  fields: {
    message: BeaconBlockHeader,
    signature: BLSSignature,
  },
  expectedCase: "notransform",
});

export const Checkpoint = new ContainerType<phase0.Checkpoint>({
  fields: {
    epoch: Epoch,
    root: Root,
  },
  expectedCase: "notransform",
});

export const CommitteeBits = new BitListType({
  limit: MAX_VALIDATORS_PER_COMMITTEE,
});

export const CommitteeIndices = new ListType<List<primitiveTs.ValidatorIndex>>({
  elementType: ValidatorIndex,
  limit: MAX_VALIDATORS_PER_COMMITTEE,
});

export const DepositMessage = new ContainerType<phase0.DepositMessage>({
  fields: {
    pubkey: BLSPubkey,
    withdrawalCredentials: Bytes32,
    amount: Number64,
  },
  casingMap: {
    pubkey: "pubkey",
    withdrawalCredentials: "withdrawal_credentials",
    amount: "amount",
  },
});

export const DepositData = new ContainerType<phase0.DepositData>({
  fields: {
    // Fields order is strickly preserved
    ...DepositMessage.fields,
    signature: BLSSignature,
  },
  casingMap: {
    ...DepositMessage.casingMap,
    signature: "signature",
  },
});

export const DepositDataRootList = new ListType<List<primitiveTs.Root>>({
  elementType: new RootType({expandedType: DepositData}),
  limit: 2 ** DEPOSIT_CONTRACT_TREE_DEPTH,
});

export const DepositEvent = new ContainerType<phase0.DepositEvent>({
  fields: {
    depositData: DepositData,
    blockNumber: Number64,
    index: Number64,
  },
  // Custom type, not in the consensus specs
  casingMap: {
    depositData: "deposit_data",
    blockNumber: "block_number",
    index: "index",
  },
});

export const Eth1Data = new ContainerType<phase0.Eth1Data>({
  fields: {
    depositRoot: Root,
    depositCount: Number64,
    blockHash: Bytes32,
  },
  casingMap: {
    depositRoot: "deposit_root",
    depositCount: "deposit_count",
    blockHash: "block_hash",
  },
});

export const Eth1DataVotes = new ListType({
  elementType: Eth1Data,
  limit: EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH,
});

export const Eth1DataOrdered = new ContainerType<phase0.Eth1DataOrdered>({
  fields: {
    // Fields order is strickly preserved
    ...Eth1Data.fields,
    blockNumber: Number64,
  },
  // Custom type, not in the consensus specs
  casingMap: {
    ...Eth1Data.casingMap,
    blockNumber: "block_number",
  },
});

export const Fork = new ContainerType<phase0.Fork>({
  fields: {
    previousVersion: Version,
    currentVersion: Version,
    epoch: Epoch,
  },
  casingMap: {
    previousVersion: "previous_version",
    currentVersion: "current_version",
    epoch: "epoch",
  },
});

export const ForkData = new ContainerType<phase0.ForkData>({
  fields: {
    currentVersion: Version,
    genesisValidatorsRoot: Root,
  },
  casingMap: {
    currentVersion: "current_version",
    genesisValidatorsRoot: "genesis_validators_root",
  },
});

export const ENRForkID = new ContainerType<phase0.ENRForkID>({
  fields: {
    forkDigest: ForkDigest,
    nextForkVersion: Version,
    nextForkEpoch: Epoch,
  },
  casingMap: {
    forkDigest: "fork_digest",
    nextForkVersion: "next_fork_version",
    nextForkEpoch: "next_fork_epoch",
  },
});

export const HistoricalBlockRoots = new VectorType<Vector<primitiveTs.Root>>({
  elementType: new RootType({expandedType: () => typesRef.get().BeaconBlock}),
  length: SLOTS_PER_HISTORICAL_ROOT,
});

export const HistoricalStateRoots = new VectorType<Vector<primitiveTs.Root>>({
  elementType: new RootType({expandedType: () => typesRef.get().BeaconState}),
  length: SLOTS_PER_HISTORICAL_ROOT,
});

export const HistoricalBatch = new ContainerType<phase0.HistoricalBatch>({
  fields: {
    blockRoots: HistoricalBlockRoots,
    stateRoots: HistoricalStateRoots,
  },
  casingMap: {
    blockRoots: "block_roots",
    stateRoots: "state_roots",
  },
});

export const Validator = new ContainerLeafNodeStructType<phase0.Validator>({
  fields: {
    pubkey: BLSPubkey,
    withdrawalCredentials: Bytes32,
    effectiveBalance: Number64,
    slashed: Boolean,
    activationEligibilityEpoch: Epoch,
    activationEpoch: Epoch,
    exitEpoch: Epoch,
    withdrawableEpoch: Epoch,
  },
  casingMap: {
    pubkey: "pubkey",
    withdrawalCredentials: "withdrawal_credentials",
    effectiveBalance: "effective_balance",
    slashed: "slashed",
    activationEligibilityEpoch: "activation_eligibility_epoch",
    activationEpoch: "activation_epoch",
    exitEpoch: "exit_epoch",
    withdrawableEpoch: "withdrawable_epoch",
  },
});

// Export as stand-alone for direct tree optimizations
export const Validators = new ListType({elementType: Validator, limit: VALIDATOR_REGISTRY_LIMIT});
export const Balances = new ListType({elementType: Number64, limit: VALIDATOR_REGISTRY_LIMIT});
export const RandaoMixes = new VectorType({elementType: Bytes32, length: EPOCHS_PER_HISTORICAL_VECTOR});
export const Slashings = new VectorType({elementType: Gwei, length: EPOCHS_PER_SLASHINGS_VECTOR});
export const JustificationBits = new BitVectorType({length: JUSTIFICATION_BITS_LENGTH});

// Misc dependants

export const AttestationData = new ContainerType<phase0.AttestationData>({
  fields: {
    slot: Slot,
    index: CommitteeIndex,
    beaconBlockRoot: Root,
    source: Checkpoint,
    target: Checkpoint,
  },
  casingMap: {
    slot: "slot",
    index: "index",
    beaconBlockRoot: "beacon_block_root",
    source: "source",
    target: "target",
  },
});

export const IndexedAttestation = new ContainerType<phase0.IndexedAttestation>({
  fields: {
    attestingIndices: CommitteeIndices,
    data: AttestationData,
    signature: BLSSignature,
  },
  casingMap: {
    attestingIndices: "attesting_indices",
    data: "data",
    signature: "signature",
  },
});

export const PendingAttestation = new ContainerType<phase0.PendingAttestation>({
  fields: {
    aggregationBits: CommitteeBits,
    data: AttestationData,
    inclusionDelay: Slot,
    proposerIndex: ValidatorIndex,
  },
  casingMap: {
    aggregationBits: "aggregation_bits",
    data: "data",
    inclusionDelay: "inclusion_delay",
    proposerIndex: "proposer_index",
  },
});

export const SigningData = new ContainerType<phase0.SigningData>({
  fields: {
    objectRoot: Root,
    domain: Domain,
  },
  casingMap: {
    objectRoot: "object_root",
    domain: "domain",
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
  casingMap: {
    aggregationBits: "aggregation_bits",
    data: "data",
    signature: "signature",
  },
});

export const AttesterSlashing = new ContainerType<phase0.AttesterSlashing>({
  fields: {
    attestation1: IndexedAttestation,
    attestation2: IndexedAttestation,
  },
  // Declaration time casingMap for toJson/fromJson for container <=> json data
  casingMap: {
    attestation1: "attestation_1",
    attestation2: "attestation_2",
  },
});

export const Deposit = new ContainerType<phase0.Deposit>({
  fields: {
    proof: new VectorType({elementType: Bytes32, length: DEPOSIT_CONTRACT_TREE_DEPTH + 1}),
    data: DepositData,
  },
  expectedCase: "notransform",
});

export const ProposerSlashing = new ContainerType<phase0.ProposerSlashing>({
  fields: {
    signedHeader1: SignedBeaconBlockHeader,
    signedHeader2: SignedBeaconBlockHeader,
  },
  // Declaration time casingMap for toJson/fromJson for container <=> json data
  casingMap: {
    signedHeader1: "signed_header_1",
    signedHeader2: "signed_header_2",
  },
});

export const VoluntaryExit = new ContainerType<phase0.VoluntaryExit>({
  fields: {
    epoch: Epoch,
    validatorIndex: ValidatorIndex,
  },
  casingMap: {
    epoch: "epoch",
    validatorIndex: "validator_index",
  },
});

export const SignedVoluntaryExit = new ContainerType<phase0.SignedVoluntaryExit>({
  fields: {
    message: VoluntaryExit,
    signature: BLSSignature,
  },
  expectedCase: "notransform",
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
  casingMap: {
    randaoReveal: "randao_reveal",
    eth1Data: "eth1_data",
    graffiti: "graffiti",
    proposerSlashings: "proposer_slashings",
    attesterSlashings: "attester_slashings",
    attestations: "attestations",
    deposits: "deposits",
    voluntaryExits: "voluntary_exits",
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
  casingMap: {
    slot: "slot",
    proposerIndex: "proposer_index",
    parentRoot: "parent_root",
    stateRoot: "state_root",
    body: "body",
  },
});

export const SignedBeaconBlock = new ContainerType<phase0.SignedBeaconBlock>({
  fields: {
    message: BeaconBlock,
    signature: BLSSignature,
  },
  expectedCase: "notransform",
});

// State types
// ===========

export const EpochAttestations = new ListType<List<phase0.PendingAttestation>>({
  elementType: PendingAttestation,
  limit: MAX_ATTESTATIONS * SLOTS_PER_EPOCH,
});

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
    eth1DataVotes: Eth1DataVotes,
    eth1DepositIndex: Number64,
    // Registry
    validators: Validators,
    balances: Balances,
    randaoMixes: RandaoMixes,
    // Slashings
    slashings: Slashings,
    // Attestations
    previousEpochAttestations: EpochAttestations,
    currentEpochAttestations: EpochAttestations,
    // Finality
    justificationBits: JustificationBits,
    previousJustifiedCheckpoint: Checkpoint,
    currentJustifiedCheckpoint: Checkpoint,
    finalizedCheckpoint: Checkpoint,
  },
  casingMap: {
    genesisTime: "genesis_time",
    genesisValidatorsRoot: "genesis_validators_root",
    slot: "slot",
    fork: "fork",
    latestBlockHeader: "latest_block_header",
    blockRoots: "block_roots",
    stateRoots: "state_roots",
    historicalRoots: "historical_roots",
    eth1Data: "eth1_data",
    eth1DataVotes: "eth1_data_votes",
    eth1DepositIndex: "eth1_deposit_index",
    validators: "validators",
    balances: "balances",
    randaoMixes: "randao_mixes",
    slashings: "slashings",
    previousEpochAttestations: "previous_epoch_attestations",
    currentEpochAttestations: "current_epoch_attestations",
    justificationBits: "justification_bits",
    previousJustifiedCheckpoint: "previous_justified_checkpoint",
    currentJustifiedCheckpoint: "current_justified_checkpoint",
    finalizedCheckpoint: "finalized_checkpoint",
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
  // Custom type, not in the consensus specs
  casingMap: {
    validators: "validators",
    committeeIndex: "committee_index",
    slot: "slot",
  },
});

export const AggregateAndProof = new ContainerType<phase0.AggregateAndProof>({
  fields: {
    aggregatorIndex: ValidatorIndex,
    aggregate: Attestation,
    selectionProof: BLSSignature,
  },
  casingMap: {
    aggregatorIndex: "aggregator_index",
    aggregate: "aggregate",
    selectionProof: "selection_proof",
  },
});

export const SignedAggregateAndProof = new ContainerType<phase0.SignedAggregateAndProof>({
  fields: {
    message: AggregateAndProof,
    signature: BLSSignature,
  },
  expectedCase: "notransform",
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
  casingMap: {
    forkDigest: "fork_digest",
    finalizedRoot: "finalized_root",
    finalizedEpoch: "finalized_epoch",
    headRoot: "head_root",
    headSlot: "head_slot",
  },
});

export const Goodbye = Uint64;

export const Ping = Uint64;

export const Metadata = new ContainerType<phase0.Metadata>({
  fields: {
    seqNumber: Uint64,
    attnets: AttestationSubnets,
  },
  casingMap: {
    seqNumber: "seq_number",
    attnets: "attnets",
  },
});

export const BeaconBlocksByRangeRequest = new ContainerType<phase0.BeaconBlocksByRangeRequest>({
  fields: {
    startSlot: Slot,
    count: Number64,
    step: Number64,
  },
  casingMap: {
    startSlot: "start_slot",
    count: "count",
    step: "step",
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
  // From beacon-apis
  casingMap: {
    genesisValidatorsRoot: "genesis_validators_root",
    genesisTime: "genesis_time",
    genesisForkVersion: "genesis_fork_version",
  },
});

// MUST set typesRef here, otherwise expandedType() calls will throw
typesRef.set({BeaconBlock, BeaconState});
