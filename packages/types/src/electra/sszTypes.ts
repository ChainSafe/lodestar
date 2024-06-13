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
  BLOCK_BODY_EXECUTION_PAYLOAD_DEPTH as EXECUTION_PAYLOAD_DEPTH,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  SLOTS_PER_EPOCH,
  MAX_DEPOSIT_RECEIPTS_PER_PAYLOAD,
  MAX_VALIDATORS_PER_COMMITTEE,
  MAX_COMMITTEES_PER_SLOT,
  MAX_ATTESTATIONS_ELECTRA,
  MAX_ATTESTER_SLASHINGS_ELECTRA,
  MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD,
  MAX_CONSOLIDATIONS,
  PENDING_BALANCE_DEPOSITS_LIMIT,
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
    committeeBits: CommitteeBits, // New in ELECTRA
    data: phase0Ssz.AttestationData,
    signature: BLSSignature,
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
    amount: UintNum64,
    signature: BLSSignature,
    index: DepositIndex,
  },
  {typeName: "DepositRequest", jsonCase: "eth2"}
);

export const DepositRequests = new ListCompositeType(DepositRequest, MAX_DEPOSIT_RECEIPTS_PER_PAYLOAD);

export const ExecutionLayerWithdrawalRequest = new ContainerType(
  {
    sourceAddress: ExecutionAddress,
    validatorPubkey: BLSPubkey,
    amount: UintNum64,
  },
  {typeName: "ExecutionLayerWithdrawalRequest", jsonCase: "eth2"}
);
export const ExecutionLayerWithdrawalRequests = new ListCompositeType(
  ExecutionLayerWithdrawalRequest,
  MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD
);

export const ExecutionPayload = new ContainerType(
  {
    ...denebSsz.ExecutionPayload.fields,
    depositRequests: DepositRequests, // New in ELECTRA
    withdrawalRequests: ExecutionLayerWithdrawalRequests, // New in ELECTRA
  },
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadHeader = new ContainerType(
  {
    ...denebSsz.ExecutionPayloadHeader.fields,
    depositRequestsRoot: Root, // New in ELECTRA
    withdrawalRequestsRoot: Root, // New in ELECTRA
  },
  {typeName: "ExecutionPayloadHeader", jsonCase: "eth2"}
);

export const Consolidation = new ContainerType(
  {
    sourceIndex: ValidatorIndex,
    targetIndex: ValidatorIndex,
    epoch: Epoch,
  },
  {typeName: "Consolidation", jsonCase: "eth2"}
);

export const SignedConsolidation = new ContainerType(
  {
    message: Consolidation,
    signature: BLSSignature,
  },
  {typeName: "SignedConsolidation", jsonCase: "eth2"}
);

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
    executionPayload: ExecutionPayload, // Modified in ELECTRA
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: denebSsz.BeaconBlockBody.fields.blobKzgCommitments,
    consolidations: new ListCompositeType(SignedConsolidation, MAX_CONSOLIDATIONS), // [New in Electra]
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
    executionPayloadHeader: ExecutionPayloadHeader, // Modified in ELECTRA
    blsToExecutionChanges: capellaSsz.BeaconBlockBody.fields.blsToExecutionChanges,
    blobKzgCommitments: denebSsz.BeaconBlockBody.fields.blobKzgCommitments,
    consolidations: new ListCompositeType(SignedConsolidation, MAX_CONSOLIDATIONS), // [New in Electra]
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
    blindedBlobsBundle: denebSsz.BlobKzgCommitments,
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
    executionPayload: ExecutionPayload, // Modified in ELECTRA
    blobsBundle: denebSsz.BlobsBundle,
  },
  {typeName: "ExecutionPayloadAndBlobsBundle", jsonCase: "eth2"}
);

export const PendingBalanceDeposit = new ContainerType(
  {
    index: ValidatorIndex,
    amount: Gwei,
  },
  {typeName: "PendingBalanceDeposit", jsonCase: "eth2"}
);

export const PendingBalanceDeposits = new ListCompositeType(PendingBalanceDeposit, PENDING_BALANCE_DEPOSITS_LIMIT);

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
    latestExecutionPayloadHeader: ExecutionPayloadHeader, // Modified in ELECTRA
    // Withdrawals
    nextWithdrawalIndex: capellaSsz.BeaconState.fields.nextWithdrawalIndex,
    nextWithdrawalValidatorIndex: capellaSsz.BeaconState.fields.nextWithdrawalValidatorIndex,
    // Deep history valid from Capella onwards
    historicalSummaries: capellaSsz.BeaconState.fields.historicalSummaries,
    depositRequestsStartIndex: UintBn64, // New in ELECTRA:EIP6110
    depositBalanceToConsume: Gwei, // New in Electra:EIP7251
    exitBalanceToConsume: Gwei, // New in Electra:EIP7251
    earliestExitEpoch: Epoch, // New in Electra:EIP7251
    consolidationBalanceToConsume: Gwei, // New in Electra:EIP7251
    earliestConsolidationEpoch: Epoch, // New in Electra:EIP7251
    pendingBalanceDeposits: PendingBalanceDeposits, // New in Electra:EIP7251
    pendingPartialWithdrawals: new ListCompositeType(PendingPartialWithdrawal, PENDING_PARTIAL_WITHDRAWALS_LIMIT), // New in Electra:EIP7251
    pendingConsolidations: new ListCompositeType(PendingConsolidation, PENDING_CONSOLIDATIONS_LIMIT), // New in Electra:EIP7251
  },
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const LightClientHeader = new ContainerType(
  {
    beacon: phase0Ssz.BeaconBlockHeader,
    execution: ExecutionPayloadHeader, // Modified in ELECTRA
    executionBranch: new VectorCompositeType(Bytes32, EXECUTION_PAYLOAD_DEPTH),
  },
  {typeName: "LightClientHeader", jsonCase: "eth2"}
);

export const LightClientBootstrap = new ContainerType(
  {
    header: LightClientHeader,
    currentSyncCommittee: altairSsz.SyncCommittee,
    currentSyncCommitteeBranch: new VectorCompositeType(Bytes32, NEXT_SYNC_COMMITTEE_DEPTH_ELECTRA),
  },
  {typeName: "LightClientBootstrap", jsonCase: "eth2"}
);

export const LightClientUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    nextSyncCommittee: altairSsz.SyncCommittee,
    nextSyncCommitteeBranch: new VectorCompositeType(Bytes32, NEXT_SYNC_COMMITTEE_DEPTH_ELECTRA),
    finalizedHeader: LightClientHeader,
    finalityBranch: new VectorCompositeType(Bytes32, FINALIZED_ROOT_DEPTH_ELECTRA),
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientUpdate", jsonCase: "eth2"}
);

export const LightClientFinalityUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    finalizedHeader: LightClientHeader,
    finalityBranch: new VectorCompositeType(Bytes32, FINALIZED_ROOT_DEPTH_ELECTRA),
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
