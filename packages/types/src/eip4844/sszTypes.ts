import {ContainerType, ListCompositeType, ByteVectorType} from "@chainsafe/ssz";
import {
  HISTORICAL_ROOTS_LIMIT,
  FIELD_ELEMENTS_PER_BLOB,
  MAX_BLOBS_PER_BLOCK,
  MAX_REQUEST_BLOCKS,
  BYTES_PER_FIELD_ELEMENT,
} from "@lodestar/params";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as capellaSsz} from "../capella/index.js";
import {ssz as bellatrixSsz} from "../bellatrix/index.js";

const {UintNum64, Slot, Root, BLSSignature, UintBn256, Bytes32, Bytes48, Bytes96, BLSPubkey} = primitiveSsz;

// Polynomial commitments
// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/polynomial-commitments.md

// Custom types
// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/polynomial-commitments.md#custom-types
export const G1Point = Bytes48;
export const G2Point = Bytes96;
export const BLSFieldElement = Bytes32;
export const KZGCommitment = Bytes48;
export const KZGProof = Bytes48;

// Beacon chain

// Custom types
// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#custom-types

export const Blob = new ByteVectorType(BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_BLOB);
export const Blobs = new ListCompositeType(Blob, MAX_BLOBS_PER_BLOCK);
export const VersionedHash = Bytes32;
export const BlobKzgCommitments = new ListCompositeType(KZGCommitment, MAX_BLOBS_PER_BLOCK);

// Constants

// Validator types
// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md

// A polynomial in evaluation form
export const Polynomial = new ListCompositeType(BLSFieldElement, FIELD_ELEMENTS_PER_BLOB);

// class BlobsAndCommitments(Container):
//     blobs: List[Blob, MAX_BLOBS_PER_BLOCK]
//     kzg_commitments: List[KZGCommitment, MAX_BLOBS_PER_BLOCK]
export const BlobsAndCommitments = new ContainerType(
  {
    blobs: Blobs,
    kzgCommitments: BlobKzgCommitments,
  },
  {typeName: "BlobsAndCommitments", jsonCase: "eth2"}
);

// class PolynomialAndCommitment(Container):
//     polynomial: Polynomial
//     kzg_commitment: KZGCommitment
export const PolynomialAndCommitment = new ContainerType(
  {
    polynomial: Polynomial,
    kzgCommitment: KZGCommitment,
  },
  {typeName: "PolynomialAndCommitment", jsonCase: "eth2"}
);

// ReqResp types
// =============

export const BlobsSidecarsByRangeRequest = new ContainerType(
  {
    startSlot: Slot,
    count: UintNum64,
  },
  {typeName: "BlobsSidecarsByRangeRequest", jsonCase: "eth2"}
);

export const BeaconBlockAndBlobsSidecarByRootRequest = new ListCompositeType(Root, MAX_REQUEST_BLOCKS);

// Beacon Chain types
// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#containers

export const ExecutionPayload = new ContainerType(
  {
    ...bellatrixSsz.CommonExecutionPayloadType.fields,
    excessDataGas: UintBn256, // New in EIP-4844
    // Extra payload fields
    blockHash: Root,
    transactions: bellatrixSsz.Transactions,
    withdrawals: capellaSsz.Withdrawals, // New in capella
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...bellatrixSsz.CommonExecutionPayloadType.fields,
    excessDataGas: UintBn256, // New in EIP-4844
    blockHash: Root,
    transactionsRoot: Root,
    withdrawalsRoot: Root,
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

// We have to preserve Fields ordering while changing the type of ExecutionPayload
export const BeaconBlockBody = new ContainerType(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayload: ExecutionPayload, // Modified in EIP-4844
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: BlobKzgCommitments, // New in EIP-4844
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...capellaSsz.BeaconBlock.fields,
    body: BeaconBlockBody, // Modified in EIP-4844
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock, // Modified in EIP-4844
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const BlobsSidecar = new ContainerType(
  {
    beaconBlockRoot: Root,
    beaconBlockSlot: Slot,
    blobs: Blobs,
    kzgAggregatedProof: KZGProof,
  },
  {typeName: "BlobsSidecar", jsonCase: "eth2"}
);

export const SignedBeaconBlockAndBlobsSidecar = new ContainerType(
  {
    beaconBlock: SignedBeaconBlock,
    blobsSidecar: BlobsSidecar,
  },
  {typeName: "SignedBeaconBlockAndBlobsSidecar", jsonCase: "eth2"}
);

export const BlindedBeaconBlockBody = new ContainerType(
  {
    ...BeaconBlockBody.fields,
    executionPayloadHeader: ExecutionPayloadHeader, // Modified in EIP-4844
    blobKzgCommitments: BlobKzgCommitments, // New in EIP-4844
  },
  {typeName: "BlindedBeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = new ContainerType(
  {
    ...capellaSsz.BlindedBeaconBlock.fields,
    body: BlindedBeaconBlockBody, // Modified in EIP-4844
  },
  {typeName: "BlindedBeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBlindedBeaconBlock = new ContainerType(
  {
    message: BlindedBeaconBlock, // Modified in EIP-4844
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBeaconBlock", jsonCase: "eth2"}
);

export const BuilderBid = new ContainerType(
  {
    header: ExecutionPayloadHeader,
    value: UintBn256,
    pubkey: BLSPubkey,
    blobKzgCommitments: BlobKzgCommitments,
  },
  {typeName: "BuilderBid", jsonCase: "eth2"}
);

export const SignedBuilderBid = new ContainerType(
  {
    message: BuilderBid,
    signature: BLSSignature,
  },
  {typeName: "SignedBuilderBid", jsonCase: "eth2"}
);

// We don't spread capella.BeaconState fields since we need to replace
// latestExecutionPayloadHeader and we cannot keep order doing that
export const BeaconState = new ContainerType(
  {
    genesisTime: UintNum64,
    genesisValidatorsRoot: Root,
    slot: primitiveSsz.Slot,
    fork: phase0Ssz.Fork,
    // History
    latestBlockHeader: phase0Ssz.BeaconBlockHeader,
    blockRoots: phase0Ssz.HistoricalBlockRoots,
    stateRoots: phase0Ssz.HistoricalStateRoots,
    // historical_roots Frozen in Capella, replaced by historical_summaries
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
    previousEpochParticipation: altairSsz.EpochParticipation,
    currentEpochParticipation: altairSsz.EpochParticipation,
    // Finality
    justificationBits: phase0Ssz.JustificationBits,
    previousJustifiedCheckpoint: phase0Ssz.Checkpoint,
    currentJustifiedCheckpoint: phase0Ssz.Checkpoint,
    finalizedCheckpoint: phase0Ssz.Checkpoint,
    // Inactivity
    inactivityScores: altairSsz.InactivityScores,
    // Sync
    currentSyncCommittee: altairSsz.SyncCommittee,
    nextSyncCommittee: altairSsz.SyncCommittee,
    // Execution
    latestExecutionPayloadHeader: ExecutionPayloadHeader, // Modified in EIP-4844
    // Withdrawals
    nextWithdrawalIndex: capellaSsz.BeaconState.fields.nextWithdrawalIndex,
    nextWithdrawalValidatorIndex: capellaSsz.BeaconState.fields.nextWithdrawalValidatorIndex,
    // Deep history valid from Capella onwards
    historicalSummaries: capellaSsz.BeaconState.fields.historicalSummaries,
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);
