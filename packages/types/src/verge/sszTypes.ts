import {
  ContainerType,
  ListCompositeType,
  ByteVectorType,
  VectorCompositeType,
  ListBasicType,
  UnionType,
  NoneType,
} from "@chainsafe/ssz";
import {
  HISTORICAL_ROOTS_LIMIT,
  VERKLE_WIDTH,
  MAX_STEMS,
  IPA_PROOF_DEPTH,
  MAX_COMMITMENTS_PER_STEM,
} from "@lodestar/params";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as capellaSsz} from "../capella/index.js";
import {ssz as denebSsz} from "../deneb/index.js";

const {UintNum64, Root, BLSSignature} = primitiveSsz;

// Spec: https://github.com/ethereum/consensus-specs/blob/db74090c1e8dc1fb2c052bae268e22dc63061e32/specs/verge/beacon-chain.md

// Custom types

export const Bytes31 = new ByteVectorType(31);
export const BanderwagonGroupElement = new ByteVectorType(32);
export const BanderwagonFieldElement = new ByteVectorType(32);
export const Stem = new ByteVectorType(31);

// Beacon chain

export const SuffixStateDiff = new ContainerType(
  {
    suffix: primitiveSsz.Byte,
    // Null means not currently present
    // TODO: Use new SSZ type Optional: https://github.com/ethereum/consensus-specs/commit/db74090c1e8dc1fb2c052bae268e22dc63061e32
    currentValue: new UnionType([new NoneType(), primitiveSsz.Bytes32]),
    // Null means value not updated
    newValue: new UnionType([new NoneType(), primitiveSsz.Bytes32]),
  },
  {typeName: "SuffixStateDiff", jsonCase: "eth2"}
);

export const StemStateDiff = new ContainerType(
  {
    stem: Stem,
    // Valid only if list is sorted by suffixes
    suffixDiffs: new ListCompositeType(SuffixStateDiff, VERKLE_WIDTH),
  },
  {typeName: "StemStateDiff", jsonCase: "eth2"}
);

// Valid only if list is sorted by stems
export const StateDiff = new ListCompositeType(StemStateDiff, MAX_STEMS);

export const IpaProof = new ContainerType(
  {
    C_L: new VectorCompositeType(BanderwagonGroupElement, IPA_PROOF_DEPTH),
    C_R: new VectorCompositeType(BanderwagonGroupElement, IPA_PROOF_DEPTH),
    finalEvaluation: BanderwagonFieldElement,
  },
  {typeName: "IpaProof", jsonCase: "eth2"}
);

export const VerkleProof = new ContainerType(
  {
    other_stems: new ListCompositeType(Bytes31, MAX_STEMS),
    depth_extension_present: new ListBasicType(primitiveSsz.Uint8, MAX_STEMS),
    commitments_by_path: new ListCompositeType(BanderwagonGroupElement, MAX_STEMS * MAX_COMMITMENTS_PER_STEM),
    D: BanderwagonGroupElement,
    ipaProof: IpaProof,
  },
  {typeName: "VerkleProof", jsonCase: "eth2"}
);

export const ExecutionWitness = new ContainerType(
  {
    state_diff: StateDiff,
    verkle_proof: VerkleProof,
  },
  {typeName: "ExecutionWitness", jsonCase: "eth2"}
);

// Beacon Chain types
// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#containers

export const ExecutionPayload = new ContainerType(
  {
    ...denebSsz.ExecutionPayload.fields,
    executionWitness: ExecutionWitness, // New in verge
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...denebSsz.ExecutionPayloadHeader.fields,
    executionWitness: ExecutionWitness, // New in verge
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

// We have to preserve Fields ordering while changing the type of ExecutionPayload
export const BeaconBlockBody = new ContainerType(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayload: ExecutionPayload, // Modified in verge
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: denebSsz.BlobKzgCommitments,
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...denebSsz.BeaconBlock.fields,
    body: BeaconBlockBody, // Modified in verge
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock, // Modified in verge
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const BlindedBeaconBlockBody = new ContainerType(
  {
    ...BeaconBlockBody.fields,
    executionPayloadHeader: ExecutionPayloadHeader, // Modified in verge
    blobKzgCommitments: denebSsz.BlobKzgCommitments,
  },
  {typeName: "BlindedBeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = new ContainerType(
  {
    ...denebSsz.BlindedBeaconBlock.fields,
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
    latestExecutionPayloadHeader: ExecutionPayloadHeader, // Modified in verge
    // Withdrawals
    nextWithdrawalIndex: capellaSsz.BeaconState.fields.nextWithdrawalIndex,
    nextWithdrawalValidatorIndex: capellaSsz.BeaconState.fields.nextWithdrawalValidatorIndex,
    // Deep history valid from Capella onwards
    historicalSummaries: capellaSsz.BeaconState.fields.historicalSummaries,
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);
