import {ContainerType, ListCompositeType, ByteVectorType, VectorCompositeType} from "@chainsafe/ssz";
import {
  HISTORICAL_ROOTS_LIMIT,
  FIELD_ELEMENTS_PER_BLOB,
  MAX_BLOBS_PER_BLOCK,
  MAX_REQUEST_BLOCKS,
  BYTES_PER_FIELD_ELEMENT,
  BLOCK_BODY_EXECUTION_PAYLOAD_DEPTH as EXECUTION_PAYLOAD_DEPTH,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as capellaSsz} from "../capella/index.js";

const {
  UintNum64,
  Slot,
  Root,
  BLSSignature,
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
export const Blobs = ListCompositeType.named(Blob, MAX_BLOBS_PER_BLOCK, {typeName: "Blobs"});
export const BlindedBlob = Bytes32;
export const BlindedBlobs = ListCompositeType.named(BlindedBlob, MAX_BLOBS_PER_BLOCK, {typeName: "BlindedBlobs"});
export const VersionedHash = Bytes32;
export const BlobKzgCommitments = ListCompositeType.named(KZGCommitment, MAX_BLOBS_PER_BLOCK, {
  typeName: "BlobKzgCommitments",
});

// Constants

// Validator types
// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md

// A polynomial in evaluation form
export const Polynomial = ListCompositeType.named(BLSFieldElement, FIELD_ELEMENTS_PER_BLOB, {typeName: "Polynomial"});

// class BlobsAndCommitments(Container):
//     blobs: List[Blob, MAX_BLOBS_PER_BLOCK]
//     kzg_commitments: List[KZGCommitment, MAX_BLOBS_PER_BLOCK]
export const BlobsAndCommitments = ContainerType.named(
  {
    blobs: Blobs,
    kzgCommitments: BlobKzgCommitments,
  },
  {typeName: "BlobsAndCommitments", jsonCase: "eth2"}
);

// class PolynomialAndCommitment(Container):
//     polynomial: Polynomial
//     kzg_commitment: KZGCommitment
export const PolynomialAndCommitment = ContainerType.named(
  {
    polynomial: Polynomial,
    kzgCommitment: KZGCommitment,
  },
  {typeName: "PolynomialAndCommitment", jsonCase: "eth2"}
);

// ReqResp types
// =============

export const BlobsSidecarsByRangeRequest = ContainerType.named(
  {
    startSlot: Slot,
    count: UintNum64,
  },
  {typeName: "BlobsSidecarsByRangeRequest", jsonCase: "eth2"}
);

export const BeaconBlockAndBlobsSidecarByRootRequest = ListCompositeType.named(Root, MAX_REQUEST_BLOCKS, {
  typeName: "BeaconBlockAndBlobsSidecarByRootRequest",
});

// Beacon Chain types
// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#containers

export const ExecutionPayload = ContainerType.named(
  {
    ...capellaSsz.ExecutionPayload.fields,
    excessDataGas: UintBn256, // New in DENEB
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = ContainerType.named(
  {
    ...capellaSsz.ExecutionPayloadHeader.fields,
    excessDataGas: UintBn256, // New in DENEB
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

// We have to preserve Fields ordering while changing the type of ExecutionPayload
export const BeaconBlockBody = ContainerType.named(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayload: ExecutionPayload, // Modified in DENEB
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: BlobKzgCommitments, // New in DENEB
  },
  {typeName: "BeaconBlockBodyDeneb", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = ContainerType.named(
  {
    ...capellaSsz.BeaconBlock.fields,
    body: BeaconBlockBody, // Modified in DENEB
  },
  {typeName: "BeaconBlockDeneb", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = ContainerType.named(
  {
    message: BeaconBlock, // Modified in DENEB
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlockDeneb", jsonCase: "eth2"}
);

export const BlobSidecar = ContainerType.named(
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

export const BlobSidecars = ListCompositeType.named(BlobSidecar, MAX_BLOBS_PER_BLOCK, {typeName: "BlobSidecars"});

export const SignedBlobSidecar = ContainerType.named(
  {
    message: BlobSidecar,
    signature: BLSSignature,
  },
  {typeName: "SignedBlobSidecar", jsonCase: "eth2"}
);
export const SignedBlobSidecars = ListCompositeType.named(SignedBlobSidecar, MAX_BLOBS_PER_BLOCK, {
  typeName: "SignedBlobSidecars",
});

export const BlindedBlobSidecar = ContainerType.named(
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

export const BlindedBlobSidecars = ListCompositeType.named(BlindedBlobSidecar, MAX_BLOBS_PER_BLOCK, {
  typeName: "BlindedBlobSidecars",
});

export const SignedBlindedBlobSidecar = ContainerType.named(
  {
    message: BlindedBlobSidecar,
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBlobSidecar", jsonCase: "eth2"}
);

export const SignedBlindedBlobSidecars = ListCompositeType.named(SignedBlindedBlobSidecar, MAX_BLOBS_PER_BLOCK, {
  typeName: "SignedBlindedBlobSidecars",
});

// TODO: replace and cleanup previous types when other parts integrated seamlessly
export const BlobsSidecar = ContainerType.named(
  {
    beaconBlockRoot: Root,
    beaconBlockSlot: Slot,
    blobs: Blobs,
    kzgAggregatedProof: KZGProof,
  },
  {typeName: "BlobsSidecar", jsonCase: "eth2"}
);

export const SignedBeaconBlockAndBlobsSidecar = ContainerType.named(
  {
    beaconBlock: SignedBeaconBlock,
    blobsSidecar: BlobsSidecar,
  },
  {typeName: "SignedBeaconBlockAndBlobsSidecar", jsonCase: "eth2"}
);

export const BlindedBeaconBlockBody = ContainerType.named(
  {
    ...BeaconBlockBody.fields,
    executionPayloadHeader: ExecutionPayloadHeader, // Modified in DENEB
    blobKzgCommitments: BlobKzgCommitments, // New in DENEB
  },
  {typeName: "BlindedBeaconBlockBodyDeneb", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = ContainerType.named(
  {
    ...capellaSsz.BlindedBeaconBlock.fields,
    body: BlindedBeaconBlockBody, // Modified in DENEB
  },
  {typeName: "BlindedBeaconBlockDeneb", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBlindedBeaconBlock = ContainerType.named(
  {
    message: BlindedBeaconBlock, // Modified in DENEB
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBeaconBlockDeneb", jsonCase: "eth2"}
);

export const BuilderBid = ContainerType.named(
  {
    header: ExecutionPayloadHeader,
    value: UintBn256,
    pubkey: BLSPubkey,
    blobKzgCommitments: BlobKzgCommitments,
  },
  {typeName: "BuilderBid", jsonCase: "eth2"}
);

export const SignedBuilderBid = ContainerType.named(
  {
    message: BuilderBid,
    signature: BLSSignature,
  },
  {typeName: "SignedBuilderBid", jsonCase: "eth2"}
);

// We don't spread capella.BeaconState fields since we need to replace
// latestExecutionPayloadHeader and we cannot keep order doing that
export const BeaconState = ContainerType.named(
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
  {typeName: "BeaconStateDeneb", jsonCase: "eth2"}
);

export const LightClientHeader = ContainerType.named(
  {
    beacon: phase0Ssz.BeaconBlockHeader,
    execution: ExecutionPayloadHeader,
    executionBranch: VectorCompositeType.named(Bytes32, EXECUTION_PAYLOAD_DEPTH, {typeName: "ExecutionBranch"}),
  },
  {typeName: "LightClientHeader", jsonCase: "eth2"}
);

export const LightClientBootstrap = ContainerType.named(
  {
    header: LightClientHeader,
    currentSyncCommittee: altairSsz.SyncCommittee,
    currentSyncCommitteeBranch: altairSsz.LightClientBootstrap.fields.currentSyncCommitteeBranch,
  },
  {typeName: "LightClientBootstrap", jsonCase: "eth2"}
);

export const LightClientUpdate = ContainerType.named(
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

export const LightClientFinalityUpdate = ContainerType.named(
  {
    attestedHeader: LightClientHeader,
    finalizedHeader: LightClientHeader,
    finalityBranch: altairSsz.LightClientFinalityUpdate.fields.finalityBranch,
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientFinalityUpdate", jsonCase: "eth2"}
);

export const LightClientOptimisticUpdate = ContainerType.named(
  {
    attestedHeader: LightClientHeader,
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientOptimisticUpdate", jsonCase: "eth2"}
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
