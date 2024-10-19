import {
  BitListType,
  BitVectorType,
  ContainerType,
  ListBasicType,
  ListCompositeType,
  VectorCompositeType,
} from "@chainsafe/ssz";
import {
  HISTORICAL_ROOTS_LIMIT,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  SLOTS_PER_EPOCH,
  MAX_DEPOSIT_REQUESTS_PER_PAYLOAD,
  MAX_VALIDATORS_PER_COMMITTEE,
  MAX_COMMITTEES_PER_SLOT,
  MAX_ATTESTATIONS_ELECTRA,
  MAX_ATTESTER_SLASHINGS_ELECTRA,
  MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD,
  MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD,
  PENDING_DEPOSITS_LIMIT,
  PENDING_PARTIAL_WITHDRAWALS_LIMIT,
  PENDING_CONSOLIDATIONS_LIMIT,
  FINALIZED_ROOT_DEPTH_ELECTRA,
  NEXT_SYNC_COMMITTEE_DEPTH_ELECTRA,
} from "@lodestar/params";
import {ssz as primitiveSsz} from "../primitive/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as bellatrixSsz} from "../bellatrix/index.js";
import {ssz as capellaSsz} from "../capella/index.js";
import {ssz as denebSsz} from "../deneb/index.js";

const {
  Epoch,
  Gwei,
  UintNum64,
  Slot,
  Root,
  BLSSignature,
  UintBn256,
  Bytes32,
  BLSPubkey,
  DepositIndex,
  UintBn64,
  ExecutionAddress,
  ValidatorIndex,
} = primitiveSsz;

export const AggregationBits = new BitListType(MAX_VALIDATORS_PER_COMMITTEE * MAX_COMMITTEES_PER_SLOT);

// This CommitteeBits serves a different purpose than CommitteeBits in phase0
// TODO Electra: Rename phase0.CommitteeBits to ParticipationBits to avoid confusion
export const CommitteeBits = new BitVectorType(MAX_COMMITTEES_PER_SLOT);

export const AttestingIndices = new ListBasicType(
  ValidatorIndex,
  MAX_VALIDATORS_PER_COMMITTEE * MAX_COMMITTEES_PER_SLOT
);

export const Attestation = new ContainerType(
  {
    aggregationBits: AggregationBits, // Modified in ELECTRA
    data: phase0Ssz.AttestationData,
    signature: BLSSignature,
    committeeBits: CommitteeBits, // New in ELECTRA
  },
  {typeName: "Attestation", jsonCase: "eth2"}
);

export const IndexedAttestation = new ContainerType(
  {
    attestingIndices: AttestingIndices, // Modified in ELECTRA
    data: phase0Ssz.AttestationData,
    signature: BLSSignature,
  },
  {typeName: "IndexedAttestation", jsonCase: "eth2"}
);

/** Same as `IndexedAttestation` but epoch, slot and index are not bounded and must be a bigint */
export const IndexedAttestationBigint = new ContainerType(
  {
    attestingIndices: AttestingIndices, // Modified in ELECTRA
    data: phase0Ssz.AttestationDataBigint,
    signature: BLSSignature,
  },
  {typeName: "IndexedAttestation", jsonCase: "eth2"}
);

export const AttesterSlashing = new ContainerType(
  {
    attestation1: IndexedAttestationBigint, // Modified in ELECTRA
    attestation2: IndexedAttestationBigint, // Modified in ELECTRA
  },
  {typeName: "AttesterSlashing", jsonCase: "eth2"}
);

export const AggregateAndProof = new ContainerType(
  {
    aggregatorIndex: ValidatorIndex,
    aggregate: Attestation, // Modified in ELECTRA
    selectionProof: BLSSignature,
  },
  {typeName: "AggregateAndProof", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedAggregateAndProof = new ContainerType(
  {
    message: AggregateAndProof, // Modified in ELECTRA
    signature: BLSSignature,
  },
  {typeName: "SignedAggregateAndProof", jsonCase: "eth2"}
);

export const DepositRequest = new ContainerType(
  {
    pubkey: BLSPubkey,
    withdrawalCredentials: Bytes32,
    // this is actually gwei uintbn64 type, but super unlikely to get a high amount here
    // to warrant a bn type
    amount: UintNum64,
    signature: BLSSignature,
    index: DepositIndex,
  },
  {typeName: "DepositRequest", jsonCase: "eth2"}
);

export const DepositRequests = new ListCompositeType(DepositRequest, MAX_DEPOSIT_REQUESTS_PER_PAYLOAD);

export const WithdrawalRequest = new ContainerType(
  {
    sourceAddress: ExecutionAddress,
    validatorPubkey: BLSPubkey,
    amount: Gwei,
  },
  {typeName: "WithdrawalRequest", jsonCase: "eth2"}
);
export const WithdrawalRequests = new ListCompositeType(WithdrawalRequest, MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD);
export const ConsolidationRequest = new ContainerType(
  {
    sourceAddress: ExecutionAddress,
    sourcePubkey: BLSPubkey,
    targetPubkey: BLSPubkey,
  },
  {typeName: "ConsolidationRequest", jsonCase: "eth2"}
);
export const ConsolidationRequests = new ListCompositeType(
  ConsolidationRequest,
  MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD
);

export const ExecutionRequests = new ContainerType(
  {
    deposits: DepositRequests,
    withdrawals: WithdrawalRequests,
    consolidations: ConsolidationRequests,
  },
  {typeName: "ExecutionRequests", jsonCase: "eth2"}
);

// Explicitly defining electra containers for consistency's sake
export const ExecutionPayloadHeader = denebSsz.ExecutionPayloadHeader;
export const ExecutionPayload = denebSsz.ExecutionPayload;

// We have to preserve Fields ordering while changing the type of ExecutionPayload
export const BeaconBlockBody = new ContainerType(
  {
    randaoReveal: phase0Ssz.BeaconBlockBody.fields.randaoReveal,
    eth1Data: phase0Ssz.BeaconBlockBody.fields.eth1Data,
    graffiti: phase0Ssz.BeaconBlockBody.fields.graffiti,
    proposerSlashings: phase0Ssz.BeaconBlockBody.fields.proposerSlashings,
    attesterSlashings: new ListCompositeType(AttesterSlashing, MAX_ATTESTER_SLASHINGS_ELECTRA), // Modified in ELECTRA
    attestations: new ListCompositeType(Attestation, MAX_ATTESTATIONS_ELECTRA), // Modified in ELECTRA
    deposits: phase0Ssz.BeaconBlockBody.fields.deposits,
    voluntaryExits: phase0Ssz.BeaconBlockBody.fields.voluntaryExits,
    syncAggregate: altairSsz.BeaconBlockBody.fields.syncAggregate,
    executionPayload: ExecutionPayload,
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: denebSsz.BeaconBlockBody.fields.blobKzgCommitments,
    executionRequests: ExecutionRequests, // New in ELECTRA:EIP7251
  },
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...denebSsz.BeaconBlock.fields,
    body: BeaconBlockBody, // Modified in ELECTRA
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock, // Modified in ELECTRA
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
    attesterSlashings: new ListCompositeType(AttesterSlashing, MAX_ATTESTER_SLASHINGS_ELECTRA), // Modified in ELECTRA
    attestations: new ListCompositeType(Attestation, MAX_ATTESTATIONS_ELECTRA), // Modified in ELECTRA
    deposits: phase0Ssz.BeaconBlockBody.fields.deposits,
    voluntaryExits: phase0Ssz.BeaconBlockBody.fields.voluntaryExits,
    syncAggregate: altairSsz.SyncAggregate,
    executionPayloadHeader: ExecutionPayloadHeader,
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: denebSsz.BeaconBlockBody.fields.blobKzgCommitments,
    executionRequests: ExecutionRequests, // New in ELECTRA
  },
  {typeName: "BlindedBeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BlindedBeaconBlock = new ContainerType(
  {
    ...denebSsz.BlindedBeaconBlock.fields,
    body: BlindedBeaconBlockBody, // Modified in ELECTRA
  },
  {typeName: "BlindedBeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBlindedBeaconBlock = new ContainerType(
  {
    message: BlindedBeaconBlock, // Modified in ELECTRA
    signature: BLSSignature,
  },
  {typeName: "SignedBlindedBeaconBlock", jsonCase: "eth2"}
);

export const BuilderBid = new ContainerType(
  {
    header: ExecutionPayloadHeader, // Modified in ELECTRA
    blobKzgCommitments: denebSsz.BlobKzgCommitments,
    executionRequests: ExecutionRequests, // New in ELECTRA
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

export const PendingDeposit = new ContainerType(
  {
    pubkey: BLSPubkey,
    withdrawalCredentials: Bytes32,
    // this is actually gwei uintbn64 type, but super unlikely to get a high amount here
    // to warrant a bn type
    amount: UintNum64,
    signature: BLSSignature,
    slot: Slot,
  },
  {typeName: "PendingDeposit", jsonCase: "eth2"}
);

export const PendingDeposits = new ListCompositeType(PendingDeposit, PENDING_DEPOSITS_LIMIT);

export const PendingPartialWithdrawal = new ContainerType(
  {
    index: ValidatorIndex,
    amount: Gwei,
    withdrawableEpoch: Epoch,
  },
  {typeName: "PendingPartialWithdrawal", jsonCase: "eth2"}
);

export const PendingConsolidation = new ContainerType(
  {
    sourceIndex: ValidatorIndex,
    targetIndex: ValidatorIndex,
  },
  {typeName: "PendingConsolidation", jsonCase: "eth2"}
);

// In EIP-7251, we spread deneb fields as new fields are appended at the end
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
    latestExecutionPayloadHeader: ExecutionPayloadHeader,
    // Withdrawals
    nextWithdrawalIndex: capellaSsz.BeaconState.fields.nextWithdrawalIndex,
    nextWithdrawalValidatorIndex: capellaSsz.BeaconState.fields.nextWithdrawalValidatorIndex,
    // Deep history valid from Capella onwards
    historicalSummaries: capellaSsz.BeaconState.fields.historicalSummaries,
    depositRequestsStartIndex: UintBn64, // New in ELECTRA:EIP6110
    depositBalanceToConsume: Gwei, // New in ELECTRA:EIP7251
    exitBalanceToConsume: Gwei, // New in ELECTRA:EIP7251
    earliestExitEpoch: Epoch, // New in ELECTRA:EIP7251
    consolidationBalanceToConsume: Gwei, // New in ELECTRA:EIP7251
    earliestConsolidationEpoch: Epoch, // New in ELECTRA:EIP7251
    pendingDeposits: PendingDeposits, // New in ELECTRA:EIP7251
    pendingPartialWithdrawals: new ListCompositeType(PendingPartialWithdrawal, PENDING_PARTIAL_WITHDRAWALS_LIMIT), // New in ELECTRA:EIP7251
    pendingConsolidations: new ListCompositeType(PendingConsolidation, PENDING_CONSOLIDATIONS_LIMIT), // New in ELECTRA:EIP7251
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const LightClientBootstrap = new ContainerType(
  {
    header: denebSsz.LightClientHeader,
    currentSyncCommittee: altairSsz.SyncCommittee,
    currentSyncCommitteeBranch: new VectorCompositeType(Bytes32, NEXT_SYNC_COMMITTEE_DEPTH_ELECTRA),
  },
  {typeName: "LightClientBootstrap", jsonCase: "eth2"}
);

export const LightClientUpdate = new ContainerType(
  {
    attestedHeader: denebSsz.LightClientHeader,
    nextSyncCommittee: altairSsz.SyncCommittee,
    nextSyncCommitteeBranch: new VectorCompositeType(Bytes32, NEXT_SYNC_COMMITTEE_DEPTH_ELECTRA), // Modified in ELECTRA
    finalizedHeader: denebSsz.LightClientHeader,
    finalityBranch: new VectorCompositeType(Bytes32, FINALIZED_ROOT_DEPTH_ELECTRA), // Modified in ELECTRA
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientUpdate", jsonCase: "eth2"}
);

export const LightClientFinalityUpdate = new ContainerType(
  {
    attestedHeader: denebSsz.LightClientHeader,
    finalizedHeader: denebSsz.LightClientHeader,
    finalityBranch: new VectorCompositeType(Bytes32, FINALIZED_ROOT_DEPTH_ELECTRA), // Modified in ELECTRA
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientFinalityUpdate", jsonCase: "eth2"}
);

export const LightClientOptimisticUpdate = new ContainerType(
  {
    attestedHeader: denebSsz.LightClientHeader,
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

export const BlockContents = new ContainerType(
  {
    block: BeaconBlock,
    kzgProofs: denebSsz.KZGProofs,
    blobs: denebSsz.Blobs,
  },
  {typeName: "BlockContents", jsonCase: "eth2"}
);

export const SignedBlockContents = new ContainerType(
  {
    signedBlock: SignedBeaconBlock,
    kzgProofs: denebSsz.KZGProofs,
    blobs: denebSsz.Blobs,
  },
  {typeName: "BlockContents", jsonCase: "eth2"}
);
