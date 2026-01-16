import {ContainerType, ByteListType, ListCompositeType} from "@chainsafe/ssz";
import {HISTORICAL_ROOTS_LIMIT, MAX_BYTES_PER_TRANSACTION} from "@lodestar/params";

import {ssz as fuluSsz} from "../fulu/index.js";
import {ssz as denebSsz} from "../deneb/index.js";
import {ssz as electraSsz} from "../electra/index.js";
import {ssz as capellaSsz} from "../capella/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

import {ssz as bellatrixSsz} from "../bellatrix/index.js";

const {BLSPubkey, BLSSignature, Root, Slot, UintNum64, UintBn256, UintBn64, Gwei, Epoch} = primitiveSsz;

export const BlockAccessList = new ByteListType(MAX_BYTES_PER_TRANSACTION);

export const ExecutionPayload = new ContainerType(
  {
    ...denebSsz.ExecutionPayload.fields,
    blockAccessList: BlockAccessList, // New in GLOAS:EIP-7928
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...denebSsz.ExecutionPayloadHeader.fields,
    blockAccessListRoot: Root, // New in GLOAS:EIP-7928
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

export const BeaconBlockBody = new ContainerType(
  {
    randaoReveal: phase0Ssz.BeaconBlockBody.fields.randaoReveal,
    eth1Data: phase0Ssz.BeaconBlockBody.fields.eth1Data,
    graffiti: phase0Ssz.BeaconBlockBody.fields.graffiti,
    proposerSlashings: phase0Ssz.BeaconBlockBody.fields.proposerSlashings,
    attesterSlashings: electraSsz.BeaconBlockBody.fields.attesterSlashings,
    attestations: electraSsz.BeaconBlockBody.fields.attestations,
    deposits: phase0Ssz.BeaconBlockBody.fields.deposits,
    voluntaryExits: phase0Ssz.BeaconBlockBody.fields.voluntaryExits,
    syncAggregate: altairSsz.BeaconBlockBody.fields.syncAggregate,
    executionPayload: ExecutionPayload, // Modified in GLOAS:EIP-7928
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: denebSsz.BeaconBlockBody.fields.blobKzgCommitments,
    executionRequests: electraSsz.BeaconBlockBody.fields.executionRequests,
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...fuluSsz.BeaconBlock.fields,
    body: BeaconBlockBody, // Modified in GLOAS:EIP-7928
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock, // Modified in GLOAS:EIP-7928
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

export const BlindedBeaconBlockBody = new ContainerType(
  {
    randaoReveal: phase0Ssz.BeaconBlockBody.fields.randaoReveal,
    eth1Data: phase0Ssz.BeaconBlockBody.fields.eth1Data,
    graffiti: phase0Ssz.BeaconBlockBody.fields.graffiti,
    proposerSlashings: phase0Ssz.BeaconBlockBody.fields.proposerSlashings,
    attesterSlashings: electraSsz.BeaconBlockBody.fields.attesterSlashings,
    attestations: electraSsz.BeaconBlockBody.fields.attestations,
    deposits: phase0Ssz.BeaconBlockBody.fields.deposits,
    voluntaryExits: phase0Ssz.BeaconBlockBody.fields.voluntaryExits,
    syncAggregate: altairSsz.SyncAggregate,
    executionPayloadHeader: ExecutionPayloadHeader, // Modified in GLOAS:EIP-7928
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: denebSsz.BeaconBlockBody.fields.blobKzgCommitments,
    executionRequests: electraSsz.BeaconBlockBody.fields.executionRequests,
  },
  {typeName: "BlindedBeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = new ContainerType(
  {
    ...electraSsz.BlindedBeaconBlock.fields,
    body: BlindedBeaconBlockBody, // Modified in GLOAS:EIP-7928
  },
  {typeName: "BlindedBeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBlindedBeaconBlock = new ContainerType(
  {
    message: BlindedBeaconBlock, // Modified in GLOAS:EIP-7928
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBeaconBlock", jsonCase: "eth2"}
);

export const BuilderBid = new ContainerType(
  {
    header: ExecutionPayloadHeader, // Modified in GLOAS:EIP-7928
    blobKzgCommitments: denebSsz.BlobKzgCommitments,
    executionRequests: electraSsz.ExecutionRequests,
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

// We don't spread fulu.BeaconState fields since we need to replace
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
    latestExecutionPayloadHeader: ExecutionPayloadHeader, // Modified in GLOAS:EIP-7928
    // Withdrawals
    nextWithdrawalIndex: capellaSsz.BeaconState.fields.nextWithdrawalIndex,
    nextWithdrawalValidatorIndex: capellaSsz.BeaconState.fields.nextWithdrawalValidatorIndex,
    // Deep history valid from Capella onwards
    historicalSummaries: capellaSsz.BeaconState.fields.historicalSummaries,
    depositRequestsStartIndex: UintBn64,
    depositBalanceToConsume: Gwei,
    exitBalanceToConsume: Gwei,
    earliestExitEpoch: Epoch,
    consolidationBalanceToConsume: Gwei,
    earliestConsolidationEpoch: Epoch,
    pendingDeposits: electraSsz.PendingDeposits,
    pendingPartialWithdrawals: electraSsz.PendingPartialWithdrawals,
    pendingConsolidations: electraSsz.PendingConsolidations,
    proposerLookahead: fuluSsz.ProposerLookahead,
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const BlockContents = new ContainerType(
  {
    block: BeaconBlock, // Modified in GLOAS:EIP-7928
    kzgProofs: fuluSsz.BlockContents.fields.kzgProofs,
    blobs: fuluSsz.BlockContents.fields.blobs,
  },
  {typeName: "BlockContents", jsonCase: "eth2"}
);

export const SignedBlockContents = new ContainerType(
  {
    signedBlock: SignedBeaconBlock, // Modified in GLOAS:EIP-7928
    kzgProofs: fuluSsz.SignedBlockContents.fields.kzgProofs,
    blobs: fuluSsz.SignedBlockContents.fields.blobs,
  },
  {typeName: "SignedBlockContents", jsonCase: "eth2"}
);

// PayloadAttributes primarily for SSE event - New in GLOAS:EIP-7843
export const PayloadAttributes = new ContainerType(
  {
    ...denebSsz.PayloadAttributes.fields,
    slotNumber: Slot,
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
