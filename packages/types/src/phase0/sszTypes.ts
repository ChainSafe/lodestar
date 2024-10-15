import {
  BitListType,
  BitVectorType,
  ContainerType,
  ListBasicType,
  ListCompositeType,
  VectorBasicType,
  ListUintNum64Type,
  VectorCompositeType,
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
} from "@lodestar/params";
import * as primitiveSsz from "../primitive/sszTypes.js";
import {ValidatorNodeStruct} from "./validator.js";
import {ListValidatorType} from "./listValidator.js";

const {
  Bytes32,
  UintNum64,
  UintBn64,
  Slot,
  Epoch,
  CommitteeIndex,
  ValidatorIndex,
  Root,
  Version,
  ForkDigest,
  BLSPubkey,
  BLSSignature,
  Domain,
} = primitiveSsz;

// Misc types
// ==========

export const AttestationSubnets = new BitVectorType(ATTESTATION_SUBNET_COUNT);

/** BeaconBlockHeader where slot is bounded by the clock, and values above it are invalid */
export const BeaconBlockHeader = new ContainerType(
  {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    parentRoot: Root,
    stateRoot: Root,
    bodyRoot: Root,
  },
  {typeName: "BeaconBlockHeader", jsonCase: "eth2", cachePermanentRootStruct: true}
);

/** BeaconBlockHeader where slot is NOT bounded by the clock, i.e. slashings. So slot is a bigint. */
export const BeaconBlockHeaderBigint = new ContainerType(
  {
    slot: UintBn64,
    proposerIndex: ValidatorIndex,
    parentRoot: Root,
    stateRoot: Root,
    bodyRoot: Root,
  },
  {typeName: "BeaconBlockHeader", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlockHeader = new ContainerType(
  {
    message: BeaconBlockHeader,
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlockHeader", jsonCase: "eth2"}
);

/** Same as `SignedBeaconBlockHeader` but slot is not bounded by the clock and must be a bigint */
export const SignedBeaconBlockHeaderBigint = new ContainerType(
  {
    message: BeaconBlockHeaderBigint,
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlockHeader", jsonCase: "eth2"}
);

/** Checkpoint where epoch is bounded by the clock, and values above it are invalid */
export const Checkpoint = new ContainerType(
  {
    epoch: Epoch,
    root: Root,
  },
  {typeName: "Checkpoint", jsonCase: "eth2"}
);

/** Checkpoint where epoch is NOT bounded by the clock, so must be a bigint */
export const CheckpointBigint = new ContainerType(
  {
    epoch: UintBn64,
    root: Root,
  },
  {typeName: "Checkpoint", jsonCase: "eth2"}
);

export const CommitteeBits = new BitListType(MAX_VALIDATORS_PER_COMMITTEE);

export const CommitteeIndices = new ListBasicType(ValidatorIndex, MAX_VALIDATORS_PER_COMMITTEE);

export const DepositMessage = new ContainerType(
  {
    pubkey: BLSPubkey,
    withdrawalCredentials: Bytes32,
    amount: UintNum64,
  },
  {typeName: "DepositMessage", jsonCase: "eth2"}
);

export const DepositData = new ContainerType(
  {
    pubkey: BLSPubkey,
    withdrawalCredentials: Bytes32,
    amount: UintNum64,
    signature: BLSSignature,
  },
  {typeName: "DepositData", jsonCase: "eth2"}
);

export const DepositDataRootList = new ListCompositeType(Root, 2 ** DEPOSIT_CONTRACT_TREE_DEPTH);

export const DepositEvent = new ContainerType(
  {
    depositData: DepositData,
    blockNumber: UintNum64,
    index: UintNum64,
  },
  {typeName: "DepositEvent", jsonCase: "eth2"}
);

export const Eth1Data = new ContainerType(
  {
    depositRoot: Root,
    depositCount: UintNum64,
    blockHash: Bytes32,
  },
  {typeName: "Eth1Data", jsonCase: "eth2"}
);

export const Eth1DataVotes = new ListCompositeType(Eth1Data, EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH);

export const Eth1DataOrdered = new ContainerType(
  {
    depositRoot: Root,
    depositCount: UintNum64,
    blockHash: Bytes32,
    blockNumber: UintNum64,
  },
  {typeName: "Eth1DataOrdered", jsonCase: "eth2"}
);

/** Spec'ed but only used in lodestar as a type */
export const Eth1Block = new ContainerType(
  {
    timestamp: UintNum64,
    depositRoot: Root,
    depositCount: UintNum64,
  },
  {typeName: "Eth1Block", jsonCase: "eth2"}
);

export const Fork = new ContainerType(
  {
    previousVersion: Version,
    currentVersion: Version,
    epoch: Epoch,
  },
  {typeName: "Fork", jsonCase: "eth2"}
);

export const ForkData = new ContainerType(
  {
    currentVersion: Version,
    genesisValidatorsRoot: Root,
  },
  {typeName: "ForkData", jsonCase: "eth2"}
);

export const ENRForkID = new ContainerType(
  {
    forkDigest: ForkDigest,
    nextForkVersion: Version,
    nextForkEpoch: Epoch,
  },
  {typeName: "ENRForkID", jsonCase: "eth2"}
);

export const HistoricalBlockRoots = new VectorCompositeType(Root, SLOTS_PER_HISTORICAL_ROOT);
export const HistoricalStateRoots = new VectorCompositeType(Root, SLOTS_PER_HISTORICAL_ROOT);

export const HistoricalBatch = new ContainerType(
  {
    blockRoots: HistoricalBlockRoots,
    stateRoots: HistoricalStateRoots,
  },
  {typeName: "HistoricalBatch", jsonCase: "eth2"}
);

/**
 * Non-spec'ed helper type to allow efficient hashing in epoch transition.
 * This type is like a 'Header' of HistoricalBatch where its fields are hashed.
 */
export const HistoricalBatchRoots = new ContainerType(
  {
    blockRoots: Root, // Hashed HistoricalBlockRoots
    stateRoots: Root, // Hashed HistoricalStateRoots
  },
  {typeName: "HistoricalBatchRoots", jsonCase: "eth2"}
);

// The main Validator type is the 'ContainerNodeStructType' version
export const Validator = ValidatorNodeStruct;

// Export as stand-alone for direct tree optimizations
export const Validators = new ListValidatorType(VALIDATOR_REGISTRY_LIMIT);
// this ListUintNum64Type is used to cache Leaf Nodes of BeaconState.balances after epoch transition
export const Balances = new ListUintNum64Type(VALIDATOR_REGISTRY_LIMIT);
export const RandaoMixes = new VectorCompositeType(Bytes32, EPOCHS_PER_HISTORICAL_VECTOR);
/**
 * This is initially a Gwei (BigInt) vector, however since Nov 2023 it's converted to UintNum64 (number) vector in the state transition because:
 * - state.slashings[nextEpoch % EPOCHS_PER_SLASHINGS_VECTOR] is reset per epoch in processSlashingsReset()
 * - max slashed validators per epoch is SLOTS_PER_EPOCH * MAX_ATTESTER_SLASHINGS * MAX_VALIDATORS_PER_COMMITTEE which is 32 * 2 * 2048 = 131072 on mainnet
 * - with that and 32_000_000_000 MAX_EFFECTIVE_BALANCE or 2048_000_000_000 MAX_EFFECTIVE_BALANCE_ELECTRA, it still fits in a number given that Math.floor(Number.MAX_SAFE_INTEGER / 32_000_000_000) = 281474
 * - we don't need to compute the total slashings from state.slashings, it's handled by totalSlashingsByIncrement in EpochCache
 */
export const Slashings = new VectorBasicType(UintNum64, EPOCHS_PER_SLASHINGS_VECTOR);
export const JustificationBits = new BitVectorType(JUSTIFICATION_BITS_LENGTH);

// Misc dependants

export const AttestationData = new ContainerType(
  {
    slot: Slot,
    index: CommitteeIndex,
    beaconBlockRoot: Root,
    source: Checkpoint,
    target: Checkpoint,
  },
  {typeName: "AttestationData", jsonCase: "eth2", cachePermanentRootStruct: true}
);

/** Same as `AttestationData` but epoch, slot and index are not bounded and must be a bigint */
export const AttestationDataBigint = new ContainerType(
  {
    slot: UintBn64,
    index: UintBn64,
    beaconBlockRoot: Root,
    source: CheckpointBigint,
    target: CheckpointBigint,
  },
  {typeName: "AttestationData", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const IndexedAttestation = new ContainerType(
  {
    attestingIndices: CommitteeIndices,
    data: AttestationData,
    signature: BLSSignature,
  },
  {typeName: "IndexedAttestation", jsonCase: "eth2"}
);

/** Same as `IndexedAttestation` but epoch, slot and index are not bounded and must be a bigint */
export const IndexedAttestationBigint = new ContainerType(
  {
    attestingIndices: CommitteeIndices,
    data: AttestationDataBigint,
    signature: BLSSignature,
  },
  {typeName: "IndexedAttestation", jsonCase: "eth2"}
);

export const PendingAttestation = new ContainerType(
  {
    aggregationBits: CommitteeBits,
    data: AttestationData,
    inclusionDelay: Slot,
    proposerIndex: ValidatorIndex,
  },
  {typeName: "PendingAttestation", jsonCase: "eth2"}
);

export const SigningData = new ContainerType(
  {
    objectRoot: Root,
    domain: Domain,
  },
  {typeName: "SigningData", jsonCase: "eth2"}
);

// Operations types
// ================

export const Attestation = new ContainerType(
  {
    aggregationBits: CommitteeBits,
    data: AttestationData,
    signature: BLSSignature,
  },
  {typeName: "Attestation", jsonCase: "eth2"}
);

export const AttesterSlashing = new ContainerType(
  {
    // In state transition, AttesterSlashing attestations are only partially validated. Their slot and epoch could
    // be higher than the clock and the slashing would still be valid. Same applies to attestation data index, which
    // can be any arbitrary value. Must use bigint variants to hash correctly to all possible values
    attestation1: IndexedAttestationBigint,
    attestation2: IndexedAttestationBigint,
  },
  {typeName: "AttesterSlashing", jsonCase: "eth2"}
);

export const Deposit = new ContainerType(
  {
    proof: new VectorCompositeType(Bytes32, DEPOSIT_CONTRACT_TREE_DEPTH + 1),
    data: DepositData,
  },
  {typeName: "Deposit", jsonCase: "eth2"}
);

export const ProposerSlashing = new ContainerType(
  {
    // In state transition, ProposerSlashing headers are only partially validated. Their slot could be higher than the
    // clock and the slashing would still be valid. Must use bigint variants to hash correctly to all possible values
    signedHeader1: SignedBeaconBlockHeaderBigint,
    signedHeader2: SignedBeaconBlockHeaderBigint,
  },
  {typeName: "ProposerSlashing", jsonCase: "eth2"}
);

export const VoluntaryExit = new ContainerType(
  {
    epoch: Epoch,
    validatorIndex: ValidatorIndex,
  },
  {typeName: "VoluntaryExit", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedVoluntaryExit = new ContainerType(
  {
    message: VoluntaryExit,
    signature: BLSSignature,
  },
  {typeName: "SignedVoluntaryExit", jsonCase: "eth2"}
);

// Block types
// ===========

export const BeaconBlockBody = new ContainerType(
  {
    randaoReveal: BLSSignature,
    eth1Data: Eth1Data,
    graffiti: Bytes32,
    proposerSlashings: new ListCompositeType(ProposerSlashing, MAX_PROPOSER_SLASHINGS),
    attesterSlashings: new ListCompositeType(AttesterSlashing, MAX_ATTESTER_SLASHINGS),
    attestations: new ListCompositeType(Attestation, MAX_ATTESTATIONS),
    deposits: new ListCompositeType(Deposit, MAX_DEPOSITS),
    voluntaryExits: new ListCompositeType(SignedVoluntaryExit, MAX_VOLUNTARY_EXITS),
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

// State types
// ===========

export const EpochAttestations = new ListCompositeType(PendingAttestation, MAX_ATTESTATIONS * SLOTS_PER_EPOCH);

export const BeaconState = new ContainerType(
  {
    // Misc
    genesisTime: UintNum64,
    genesisValidatorsRoot: Root,
    slot: Slot,
    fork: Fork,
    // History
    latestBlockHeader: BeaconBlockHeader,
    blockRoots: HistoricalBlockRoots,
    stateRoots: HistoricalStateRoots,
    historicalRoots: new ListCompositeType(Root, HISTORICAL_ROOTS_LIMIT),
    // Eth1
    eth1Data: Eth1Data,
    eth1DataVotes: Eth1DataVotes,
    eth1DepositIndex: UintNum64,
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
  {typeName: "BeaconState", jsonCase: "eth2"}
);

// Validator types
// ===============

export const CommitteeAssignment = new ContainerType(
  {
    validators: CommitteeIndices,
    committeeIndex: CommitteeIndex,
    slot: Slot,
  },
  {typeName: "CommitteeAssignment", jsonCase: "eth2"}
);

export const AggregateAndProof = new ContainerType(
  {
    aggregatorIndex: ValidatorIndex,
    aggregate: Attestation,
    selectionProof: BLSSignature,
  },
  {typeName: "AggregateAndProof", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedAggregateAndProof = new ContainerType(
  {
    message: AggregateAndProof,
    signature: BLSSignature,
  },
  {typeName: "SignedAggregateAndProof", jsonCase: "eth2"}
);

// ReqResp types
// =============

export const Status = new ContainerType(
  {
    forkDigest: ForkDigest,
    finalizedRoot: Root,
    finalizedEpoch: Epoch,
    headRoot: Root,
    headSlot: Slot,
  },
  {typeName: "Status", jsonCase: "eth2"}
);

export const Goodbye = UintBn64;

export const Ping = UintBn64;

export const Metadata = new ContainerType(
  {
    seqNumber: UintBn64,
    attnets: AttestationSubnets,
  },
  {typeName: "Metadata", jsonCase: "eth2"}
);

export const BeaconBlocksByRangeRequest = new ContainerType(
  {
    startSlot: Slot,
    count: UintNum64,
    step: UintNum64,
  },
  {typeName: "BeaconBlocksByRangeRequest", jsonCase: "eth2"}
);

export const BeaconBlocksByRootRequest = new ListCompositeType(Root, MAX_REQUEST_BLOCKS);

// Api types
// =========

export const Genesis = new ContainerType(
  {
    genesisValidatorsRoot: Root,
    genesisTime: UintNum64,
    genesisForkVersion: Version,
  },
  {typeName: "Genesis", jsonCase: "eth2"}
);
