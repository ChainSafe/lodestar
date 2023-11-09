import {ContainerType, ListCompositeType, ByteVectorType, VectorCompositeType} from "@chainsafe/ssz";
import {
  HISTORICAL_ROOTS_LIMIT,
  MAX_BLOB_COMMITMENTS_PER_BLOCK,
  FIELD_ELEMENTS_PER_BLOB,
  MAX_REQUEST_BLOB_SIDECARS,
  BYTES_PER_FIELD_ELEMENT,
  BLOCK_BODY_EXECUTION_PAYLOAD_DEPTH as EXECUTION_PAYLOAD_DEPTH,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as bellatrixSsz} from "../bellatrix/index.js";
import {ssz as capellaSsz} from "../capella/index.js";

const {
  UintNum64,
  Slot,
  Root,
  BLSSignature,
  UintBn64,
  UintBn256,
  Bytes32,
  Bytes48,
  Bytes96,
  BLSPubkey,
  BlobIndex,
  ValidatorIndex,
} = primitiveSsz;

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
export const Blobs = new ListCompositeType(Blob, MAX_BLOB_COMMITMENTS_PER_BLOCK);
export const BlindedBlob = Bytes32;
export const BlindedBlobs = new ListCompositeType(BlindedBlob, MAX_BLOB_COMMITMENTS_PER_BLOCK);

export const VersionedHash = Bytes32;
export const BlobKzgCommitments = new ListCompositeType(KZGCommitment, MAX_BLOB_COMMITMENTS_PER_BLOCK);
export const KZGProofs = new ListCompositeType(KZGProof, MAX_BLOB_COMMITMENTS_PER_BLOCK);

// ReqResp types
// =============

export const BlobSidecarsByRangeRequest = new ContainerType(
  {
    startSlot: Slot,
    count: UintNum64,
  },
  {typeName: "BlobSidecarsByRangeRequest", jsonCase: "eth2"}
);

export const BlobIdentifier = new ContainerType(
  {
    blockRoot: Root,
    index: BlobIndex,
  },
  {typeName: "BlobIdentifier", jsonCase: "eth2"}
);

export const BlobSidecarsByRootRequest = new ListCompositeType(BlobIdentifier, MAX_REQUEST_BLOB_SIDECARS);

// Beacon Chain types
// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#containers

export const ExecutionPayload = new ContainerType(
  {
    ...capellaSsz.ExecutionPayload.fields,
    blobGasUsed: UintBn64, // New in DENEB
    excessBlobGas: UintBn64, // New in DENEB
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...capellaSsz.ExecutionPayloadHeader.fields,
    blobGasUsed: UintBn64, // New in DENEB
    excessBlobGas: UintBn64, // New in DENEB
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

// We have to preserve Fields ordering while changing the type of ExecutionPayload
export const BeaconBlockBody = new ContainerType(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayload: ExecutionPayload, // Modified in DENEB
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: BlobKzgCommitments, // New in DENEB
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...capellaSsz.BeaconBlock.fields,
    body: BeaconBlockBody, // Modified in DENEB
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock, // Modified in DENEB
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const BlobSidecar = new ContainerType(
  {
    blockRoot: Root,
    index: BlobIndex,
    slot: Slot,
    blockParentRoot: Root,
    proposerIndex: ValidatorIndex,
    blob: Blob,
    kzgCommitment: KZGCommitment,
    kzgProof: KZGProof,
  },
  {typeName: "BlobSidecar", jsonCase: "eth2"}
);

export const BlobSidecars = new ListCompositeType(BlobSidecar, MAX_BLOB_COMMITMENTS_PER_BLOCK);

export const SignedBlobSidecar = new ContainerType(
  {
    message: BlobSidecar,
    signature: BLSSignature,
  },
  {typeName: "SignedBlobSidecar", jsonCase: "eth2"}
);
export const SignedBlobSidecars = new ListCompositeType(SignedBlobSidecar, MAX_BLOB_COMMITMENTS_PER_BLOCK);

export const BlobsBundle = new ContainerType(
  {
    commitments: BlobKzgCommitments,
    proofs: KZGProofs,
    blobs: Blobs,
  },
  {typeName: "BlobsBundle", jsonCase: "eth2"}
);

export const BlindedBlobSidecar = new ContainerType(
  {
    blockRoot: Root,
    index: BlobIndex,
    slot: Slot,
    blockParentRoot: Root,
    proposerIndex: ValidatorIndex,
    blobRoot: BlindedBlob,
    kzgCommitment: KZGCommitment,
    kzgProof: KZGProof,
  },
  {typeName: "BlindedBlobSidecar", jsonCase: "eth2"}
);

export const BlindedBlobSidecars = new ListCompositeType(BlindedBlobSidecar, MAX_BLOB_COMMITMENTS_PER_BLOCK);

export const SignedBlindedBlobSidecar = new ContainerType(
  {
    message: BlindedBlobSidecar,
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBlobSidecar", jsonCase: "eth2"}
);

export const SignedBlindedBlobSidecars = new ListCompositeType(
  SignedBlindedBlobSidecar,
  MAX_BLOB_COMMITMENTS_PER_BLOCK
);

export const BlindedBeaconBlockBody = new ContainerType(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayloadHeader: ExecutionPayloadHeader, // Modified in DENEB
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: BlobKzgCommitments, // New in DENEB
  },
  {typeName: "BlindedBeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = new ContainerType(
  {
    ...capellaSsz.BlindedBeaconBlock.fields,
    body: BlindedBeaconBlockBody, // Modified in DENEB
  },
  {typeName: "BlindedBeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBlindedBeaconBlock = new ContainerType(
  {
    message: BlindedBeaconBlock, // Modified in DENEB
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBeaconBlock", jsonCase: "eth2"}
);

export const BlindedBlobsBundle = new ContainerType(
  {
    commitments: BlobKzgCommitments,
    proofs: KZGProofs,
    blobRoots: BlindedBlobs,
  },
  {typeName: "BlindedBlobsBundle", jsonCase: "eth2"}
);

export const BuilderBid = new ContainerType(
  {
    header: ExecutionPayloadHeader,
    blindedBlobsBundle: BlindedBlobsBundle,
    value: UintBn256,
    pubkey: BLSPubkey,
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

export const ExecutionPayloadAndBlobsBundle = new ContainerType(
  {
    executionPayload: ExecutionPayload,
    blobsBundle: BlobsBundle,
  },
  {typeName: "ExecutionPayloadAndBlobsBundle", jsonCase: "eth2"}
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
    latestExecutionPayloadHeader: ExecutionPayloadHeader, // Modified in DENEB
    // Withdrawals
    nextWithdrawalIndex: capellaSsz.BeaconState.fields.nextWithdrawalIndex,
    nextWithdrawalValidatorIndex: capellaSsz.BeaconState.fields.nextWithdrawalValidatorIndex,
    // Deep history valid from Capella onwards
    historicalSummaries: capellaSsz.BeaconState.fields.historicalSummaries,
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const LightClientHeader = new ContainerType(
  {
    beacon: phase0Ssz.BeaconBlockHeader,
    execution: ExecutionPayloadHeader,
    executionBranch: new VectorCompositeType(Bytes32, EXECUTION_PAYLOAD_DEPTH),
  },
  {typeName: "LightClientHeader", jsonCase: "eth2"}
);

export const LightClientBootstrap = new ContainerType(
  {
    header: LightClientHeader,
    currentSyncCommittee: altairSsz.SyncCommittee,
    currentSyncCommitteeBranch: altairSsz.LightClientBootstrap.fields.currentSyncCommitteeBranch,
  },
  {typeName: "LightClientBootstrap", jsonCase: "eth2"}
);

export const LightClientUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    nextSyncCommittee: altairSsz.SyncCommittee,
    nextSyncCommitteeBranch: altairSsz.LightClientUpdate.fields.nextSyncCommitteeBranch,
    finalizedHeader: LightClientHeader,
    finalityBranch: altairSsz.LightClientUpdate.fields.finalityBranch,
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientUpdate", jsonCase: "eth2"}
);

export const LightClientFinalityUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    finalizedHeader: LightClientHeader,
    finalityBranch: altairSsz.LightClientFinalityUpdate.fields.finalityBranch,
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientFinalityUpdate", jsonCase: "eth2"}
);

export const LightClientOptimisticUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientOptimisticUpdate", jsonCase: "eth2"}
);

export const LightClientStore = new ContainerType(
  {
    snapshot: LightClientBootstrap,
    validUpdates: new ListCompositeType(LightClientUpdate, EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH),
  },
  {typeName: "LightClientStore", jsonCase: "eth2"}
);

// PayloadAttributes primarily for SSE event
export const PayloadAttributes = new ContainerType(
  {
    ...capellaSsz.PayloadAttributes.fields,
    parentBeaconBlockRoot: Root,
  },
  {typeName: "PayloadAttributes", jsonCase: "eth2"}
);

export const SSEPayloadAttributes = new ContainerType(
  {
    ...bellatrixSsz.SSEPayloadAttributesCommon.fields,
    payloadAttributes: PayloadAttributes,
  },
  {typeName: "SSEPayloadAttributes", jsonCase: "eth2"}
);
