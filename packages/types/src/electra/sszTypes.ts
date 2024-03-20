import {ContainerType, ListCompositeType} from "@chainsafe/ssz";
import {
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  SLOTS_PER_EPOCH,
  HISTORICAL_ROOTS_LIMIT,
  MAX_TRANSACTIONS_PER_INCLUSION_LIST,
} from "@lodestar/params";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as bellatrixSsz} from "../bellatrix/index.js";
import {ssz as capellaSsz} from "../capella/index.js";
import {ssz as denebSsz} from "../deneb/index.js";

const {BLSSignature, ExecutionAddress, Root, UintBn256, BLSPubkey, ValidatorIndex, Slot, UintNum64} = primitiveSsz;

export const ILSummary = new ListCompositeType(ExecutionAddress, MAX_TRANSACTIONS_PER_INCLUSION_LIST);
export const ILTransactions = new ListCompositeType(bellatrixSsz.Transaction, MAX_TRANSACTIONS_PER_INCLUSION_LIST);

export const SignedInclusionListSummary = new ContainerType(
  {
    summary: ILSummary,
    signature: BLSSignature,
  },
  {typeName: "SignedInclusionListSummary", jsonCase: "eth2"}
);

export const NewInclusionListRequest = new ContainerType(
  {
    slot: Slot,
    inclusionList: ILTransactions,
    summary: ILSummary,
    parentBlockHash: Root,
  },
  {typeName: "NewInclusionListRequest", jsonCase: "eth2"}
);

export const ExecutionPayload = new ContainerType(
  {
    ...denebSsz.ExecutionPayload.fields,
    previousInclusionListSummary: SignedInclusionListSummary,
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...denebSsz.ExecutionPayloadHeader.fields,
    previousInclusionListSummaryRoot: Root,
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

export const BeaconBlockBody = new ContainerType(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayload: ExecutionPayload, // Modified in ELECTRA
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: denebSsz.BlobKzgCommitments,
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...phase0Ssz.BeaconBlock.fields,
    body: BeaconBlockBody, // Modified in ELECTRA
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

export const BlindedBeaconBlockBody = new ContainerType(
  {
    ...altairSsz.BeaconBlockBody.fields,
    executionPayloadHeader: ExecutionPayloadHeader, // Modified in ELECTRA
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: denebSsz.BlobKzgCommitments,
  },
  {typeName: "BlindedBeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = new ContainerType(
  {
    ...bellatrixSsz.BlindedBeaconBlock.fields,
    body: BlindedBeaconBlockBody, // Modified in ELECTRA
  },
  {typeName: "BlindedBeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBlindedBeaconBlock = new ContainerType(
  {
    message: BlindedBeaconBlock,
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBeaconBlock", jsonCase: "eth2"}
);

export const BuilderBid = new ContainerType(
  {
    header: ExecutionPayloadHeader,
    blobKzgCommitments: denebSsz.BlobKzgCommitments,
    value: UintBn256,
    pubkey: BLSPubkey,
  },
  {typeName: "BuilderBid", jsonCase: "eth2"}
);

export const ExecutionPayloadAndBlobsBundle = new ContainerType(
  {
    executionPayload: ExecutionPayload,
    blobsBundle: denebSsz.BlobsBundle,
  },
  {typeName: "ExecutionPayloadAndBlobsBundle", jsonCase: "eth2"}
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
    latestExecutionPayloadHeader: ExecutionPayloadHeader, // Modified in ELECTRA
    // Withdrawals
    nextWithdrawalIndex: capellaSsz.BeaconState.fields.nextWithdrawalIndex,
    nextWithdrawalValidatorIndex: capellaSsz.BeaconState.fields.nextWithdrawalValidatorIndex,
    // Deep history valid from Capella onwards
    historicalSummaries: capellaSsz.BeaconState.fields.historicalSummaries,
    // Inclusion list validation
    previousProposerIndex: ValidatorIndex, // New in Electra
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const LightClientHeader = new ContainerType(
  {
    beacon: phase0Ssz.BeaconBlockHeader,
    execution: ExecutionPayloadHeader,
    executionBranch: capellaSsz.LightClientHeader.fields.executionBranch,
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
    previousInclusionListSummary: SignedInclusionListSummary,
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
