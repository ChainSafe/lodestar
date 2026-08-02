import {
  BitVectorType,
  ContainerType,
  ListBasicType,
  ListCompositeType,
  ProgressiveBitListType,
  ProgressiveByteListType,
  ProgressiveContainerType,
  ProgressiveListBasicType,
  ProgressiveListCompositeType,
  VectorBasicType,
  VectorCompositeType,
} from "@chainsafe/ssz";
import {
  CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  EXECUTION_BLOCK_HASH_DEPTH_GLOAS,
  FINALIZED_ROOT_DEPTH_GLOAS,
  HISTORICAL_ROOTS_LIMIT,
  MIN_SEED_LOOKAHEAD,
  NEXT_SYNC_COMMITTEE_DEPTH_GLOAS,
  NUMBER_OF_COLUMNS,
  PTC_SIZE,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
} from "@lodestar/params";
import {ssz as altairSsz} from "../altair/index.js";
import {ssz as capellaSsz} from "../capella/index.js";
import {ssz as denebSsz} from "../deneb/index.js";
import {ssz as electraSsz} from "../electra/index.js";
import {ssz as fuluSsz} from "../fulu/index.js";
import {ssz as phase0Ssz} from "../phase0/index.js";
import {ssz as primitiveSsz} from "../primitive/index.js";

// biome-ignore lint/suspicious/noShadowRestrictedNames: We explicitly want `Boolean` name to be imported
const {Boolean} = primitiveSsz;

const {
  Gwei,
  ExecutionAddress,
  ValidatorIndex,
  Epoch,
  BLSSignature,
  Bytes32,
  Root,
  Slot,
  UintBn64,
  UintNum64,
  BLSPubkey,
  Uint8,
  BuilderIndex,
  EpochInf,
  ParticipationFlags,
} = primitiveSsz;

function activeFields(count: number): boolean[] {
  return Array.from({length: count}, () => true);
}

export const ExecutionBranch = new VectorCompositeType(Bytes32, EXECUTION_BLOCK_HASH_DEPTH_GLOAS);

export const CurrentSyncCommitteeBranch = new VectorCompositeType(Bytes32, CURRENT_SYNC_COMMITTEE_DEPTH_GLOAS);

export const FinalityBranch = new VectorCompositeType(Bytes32, FINALIZED_ROOT_DEPTH_GLOAS);

export const NextSyncCommitteeBranch = new VectorCompositeType(Bytes32, NEXT_SYNC_COMMITTEE_DEPTH_GLOAS);

export const AggregationBits = new ProgressiveBitListType({typeName: "AggregationBits"});
export const AttestingIndices = new ProgressiveListBasicType(ValidatorIndex, {typeName: "AttestingIndices"});
export const Transaction = new ProgressiveByteListType({typeName: "Transaction"});
export const Transactions = new ProgressiveListCompositeType(Transaction, {typeName: "Transactions"});
export const Withdrawals = new ProgressiveListCompositeType(capellaSsz.Withdrawal, {typeName: "Withdrawals"});
export const BlobKzgCommitments = new ProgressiveListCompositeType(denebSsz.KZGCommitment, {
  typeName: "BlobKzgCommitments",
});
export const KZGProofs = new ProgressiveListCompositeType(denebSsz.KZGProof, {typeName: "KZGProofs"});
export const DataColumn = new ProgressiveListCompositeType(fuluSsz.Cell, {typeName: "DataColumn"});

export const Attestation = new ProgressiveContainerType(
  {
    aggregationBits: AggregationBits,
    data: phase0Ssz.AttestationData,
    signature: BLSSignature,
    committeeBits: electraSsz.CommitteeBits,
  },
  activeFields(4),
  {typeName: "Attestation", jsonCase: "eth2"}
);

export const IndexedAttestation = new ProgressiveContainerType(
  {
    attestingIndices: AttestingIndices,
    data: phase0Ssz.AttestationData,
    signature: BLSSignature,
  },
  activeFields(3),
  {typeName: "IndexedAttestation", jsonCase: "eth2"}
);

/** Same as `IndexedAttestation` but epoch, slot and index are not bounded and must be a bigint */
export const IndexedAttestationBigint = new ProgressiveContainerType(
  {
    attestingIndices: AttestingIndices,
    data: phase0Ssz.AttestationDataBigint,
    signature: BLSSignature,
  },
  activeFields(3),
  {typeName: "IndexedAttestation", jsonCase: "eth2"}
);

export const AttesterSlashing = new ContainerType(
  {
    attestation1: IndexedAttestationBigint,
    attestation2: IndexedAttestationBigint,
  },
  {typeName: "AttesterSlashing", jsonCase: "eth2"}
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

export const DepositRequest = electraSsz.DepositRequest;
export const DepositRequests = new ProgressiveListCompositeType(DepositRequest, {typeName: "DepositRequests"});
export const WithdrawalRequest = electraSsz.WithdrawalRequest;
export const WithdrawalRequests = new ProgressiveListCompositeType(WithdrawalRequest, {
  typeName: "WithdrawalRequests",
});
export const ConsolidationRequest = electraSsz.ConsolidationRequest;
export const ConsolidationRequests = new ProgressiveListCompositeType(ConsolidationRequest, {
  typeName: "ConsolidationRequests",
});

// New in GLOAS:EIP8282
export const BuilderDepositRequest = new ContainerType(
  {
    pubkey: BLSPubkey,
    withdrawalCredentials: Bytes32,
    amount: UintNum64,
    signature: BLSSignature,
  },
  {typeName: "BuilderDepositRequest", jsonCase: "eth2"}
);
export const BuilderDepositRequests = new ProgressiveListCompositeType(BuilderDepositRequest, {
  typeName: "BuilderDepositRequests",
});

// New in GLOAS:EIP8282
export const BuilderExitRequest = new ContainerType(
  {
    sourceAddress: ExecutionAddress,
    pubkey: BLSPubkey,
  },
  {typeName: "BuilderExitRequest", jsonCase: "eth2"}
);
export const BuilderExitRequests = new ProgressiveListCompositeType(BuilderExitRequest, {
  typeName: "BuilderExitRequests",
});

export const ExecutionRequests = new ProgressiveContainerType(
  {
    deposits: DepositRequests,
    withdrawals: WithdrawalRequests,
    consolidations: ConsolidationRequests,
    builderDeposits: BuilderDepositRequests, // New in GLOAS:EIP8282
    builderExits: BuilderExitRequests, // New in GLOAS:EIP8282
  },
  activeFields(5),
  {typeName: "ExecutionRequests", jsonCase: "eth2"}
);

export const ProposerSlashings = new ProgressiveListCompositeType(phase0Ssz.ProposerSlashing, {
  typeName: "ProposerSlashings",
});
export const AttesterSlashings = new ProgressiveListCompositeType(AttesterSlashing, {
  typeName: "AttesterSlashings",
});
export const Attestations = new ProgressiveListCompositeType(Attestation, {typeName: "Attestations"});
export const Deposits = new ProgressiveListCompositeType(phase0Ssz.Deposit, {typeName: "Deposits"});
export const VoluntaryExits = new ProgressiveListCompositeType(phase0Ssz.SignedVoluntaryExit, {
  typeName: "VoluntaryExits",
});
export const BlsToExecutionChanges = new ProgressiveListCompositeType(capellaSsz.SignedBLSToExecutionChange, {
  typeName: "BLSToExecutionChanges",
});

export const Validators = new ProgressiveListCompositeType(phase0Ssz.Validator, {typeName: "Validators"});
export const Balances = new ProgressiveListBasicType(UintNum64, {typeName: "Balances"});
export const EpochParticipation = new ProgressiveListBasicType(ParticipationFlags, {
  typeName: "EpochParticipation",
});
export const InactivityScores = new ProgressiveListBasicType(UintNum64, {typeName: "InactivityScores"});
export const PendingDeposits = new ProgressiveListCompositeType(electraSsz.PendingDeposit, {
  typeName: "PendingDeposits",
});
export const PendingPartialWithdrawals = new ProgressiveListCompositeType(electraSsz.PendingPartialWithdrawal, {
  typeName: "PendingPartialWithdrawals",
});
export const PendingConsolidations = new ProgressiveListCompositeType(electraSsz.PendingConsolidation, {
  typeName: "PendingConsolidations",
});

export const Builder = new ContainerType(
  {
    pubkey: BLSPubkey,
    version: Uint8,
    executionAddress: ExecutionAddress,
    balance: UintNum64,
    depositEpoch: EpochInf,
    withdrawableEpoch: EpochInf,
  },
  {typeName: "Builder", jsonCase: "eth2"}
);

export const BuilderPendingWithdrawal = new ContainerType(
  {
    feeRecipient: ExecutionAddress,
    amount: UintNum64,
    builderIndex: BuilderIndex,
  },
  {typeName: "BuilderPendingWithdrawal", jsonCase: "eth2"}
);

export const BuilderPendingPayment = new ContainerType(
  {
    weight: UintNum64,
    withdrawal: BuilderPendingWithdrawal,
    proposerIndex: ValidatorIndex,
  },
  {typeName: "BuilderPendingPayment", jsonCase: "eth2"}
);

export const Builders = new ProgressiveListCompositeType(Builder, {typeName: "Builders"});
export const BuilderPendingWithdrawals = new ProgressiveListCompositeType(BuilderPendingWithdrawal, {
  typeName: "BuilderPendingWithdrawals",
});

export const PayloadTimelinessCommittee = new VectorBasicType(ValidatorIndex, PTC_SIZE);
export const PtcWindow = new VectorCompositeType(
  PayloadTimelinessCommittee,
  (2 + MIN_SEED_LOOKAHEAD) * SLOTS_PER_EPOCH
);

export const PayloadAttestationData = new ContainerType(
  {
    beaconBlockRoot: Root,
    slot: Slot,
    payloadPresent: Boolean,
    blobDataAvailable: Boolean,
  },
  {typeName: "PayloadAttestationData", jsonCase: "eth2"}
);

export const PayloadAttestation = new ProgressiveContainerType(
  {
    aggregationBits: new BitVectorType(PTC_SIZE),
    data: PayloadAttestationData,
    signature: BLSSignature,
  },
  activeFields(3),
  {typeName: "PayloadAttestation", jsonCase: "eth2"}
);

export const PayloadAttestations = new ProgressiveListCompositeType(PayloadAttestation, {
  typeName: "PayloadAttestations",
});

export const PayloadAttestationMessage = new ContainerType(
  {
    validatorIndex: ValidatorIndex,
    data: PayloadAttestationData,
    signature: BLSSignature,
  },
  {typeName: "PayloadAttestationMessage", jsonCase: "eth2"}
);

export const IndexedPayloadAttestation = new ProgressiveContainerType(
  {
    attestingIndices: new ListBasicType(ValidatorIndex, PTC_SIZE),
    data: PayloadAttestationData,
    signature: BLSSignature,
  },
  activeFields(3),
  {typeName: "IndexedPayloadAttestation", jsonCase: "eth2"}
);

export const ProposerPreferences = new ContainerType(
  {
    dependentRoot: Root,
    proposalSlot: Slot,
    validatorIndex: ValidatorIndex,
    feeRecipient: ExecutionAddress,
    // targetGasLimit is a proposer-set uint64 with no bound; use UintBn64 so a value above 2**53
    // round-trips exactly (this container is not in the block HTR, but the value is emitted to the
    // EL via engine PayloadAttributesV4 and over the SSE payload_attributes event).
    targetGasLimit: UintBn64,
  },
  {typeName: "ProposerPreferences", jsonCase: "eth2"}
);

export const SignedProposerPreferences = new ContainerType(
  {
    message: ProposerPreferences,
    signature: BLSSignature,
  },
  {typeName: "SignedProposerPreferences", jsonCase: "eth2"}
);

export const ExecutionPayloadBid = new ProgressiveContainerType(
  {
    parentBlockHash: Bytes32,
    parentBlockRoot: Root,
    blockHash: Bytes32,
    prevRandao: Bytes32,
    feeRecipient: ExecutionAddress,
    gasLimit: UintNum64,
    builderIndex: BuilderIndex,
    slot: Slot,
    value: UintNum64,
    executionPayment: UintNum64,
    blobKzgCommitments: BlobKzgCommitments,
    executionRequestsRoot: Root,
  },
  activeFields(12),
  {typeName: "ExecutionPayloadBid", jsonCase: "eth2"}
);

export const SignedExecutionPayloadBid = new ContainerType(
  {
    message: ExecutionPayloadBid,
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionPayloadBid", jsonCase: "eth2"}
);

export const BlockAccessList = new ProgressiveByteListType({typeName: "BlockAccessList"});

export const ExecutionPayload = new ProgressiveContainerType(
  {
    ...electraSsz.ExecutionPayload.fields,
    transactions: Transactions,
    withdrawals: Withdrawals,
    blockAccessList: BlockAccessList, // New in GLOAS:EIP-7928
    slotNumber: Slot, // New in GLOAS:EIP-7843
  },
  activeFields(19),
  {typeName: "ExecutionPayload", jsonCase: "eth2"}
);

export const ExecutionPayloadEnvelope = new ProgressiveContainerType(
  {
    payload: ExecutionPayload,
    executionRequests: ExecutionRequests,
    builderIndex: BuilderIndex,
    beaconBlockRoot: Root,
    parentBeaconBlockRoot: Root,
  },
  activeFields(5),
  {typeName: "ExecutionPayloadEnvelope", jsonCase: "eth2"}
);

export const SignedExecutionPayloadEnvelope = new ContainerType(
  {
    message: ExecutionPayloadEnvelope,
    signature: BLSSignature,
  },
  {typeName: "SignedExecutionPayloadEnvelope", jsonCase: "eth2"}
);

export const SignedExecutionPayloadEnvelopeContents = new ContainerType(
  {
    signedExecutionPayloadEnvelope: SignedExecutionPayloadEnvelope,
    kzgProofs: fuluSsz.KZGProofs,
    blobs: denebSsz.Blobs,
  },
  {typeName: "SignedExecutionPayloadEnvelopeContents", jsonCase: "eth2"}
);

export const BeaconBlockBody = new ProgressiveContainerType(
  {
    randaoReveal: phase0Ssz.BeaconBlockBody.fields.randaoReveal,
    eth1Data: phase0Ssz.BeaconBlockBody.fields.eth1Data,
    graffiti: phase0Ssz.BeaconBlockBody.fields.graffiti,
    proposerSlashings: ProposerSlashings,
    attesterSlashings: AttesterSlashings,
    attestations: Attestations,
    deposits: Deposits,
    voluntaryExits: VoluntaryExits,
    syncAggregate: altairSsz.BeaconBlockBody.fields.syncAggregate,
    // executionPayload: ExecutionPayload, // Removed in GLOAS:EIP7732
    blsToExecutionChanges: BlsToExecutionChanges,
    // blobKzgCommitments: denebSsz.BeaconBlockBody.fields.blobKzgCommitments, // Removed in GLOAS:EIP7732
    // executionRequests: ExecutionRequests, // Removed in GLOAS:EIP7732
    signedExecutionPayloadBid: SignedExecutionPayloadBid, // New in GLOAS:EIP7732
    payloadAttestations: PayloadAttestations, // New in GLOAS:EIP7732
    parentExecutionRequests: ExecutionRequests, // New in GLOAS:EIP7732
  },
  activeFields(13),
  {typeName: "BeaconBlockBody", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const BeaconBlock = new ContainerType(
  {
    ...fuluSsz.BeaconBlock.fields,
    body: BeaconBlockBody, // Modified in GLOAS
  },
  {typeName: "BeaconBlock", jsonCase: "eth2", cachePermanentRootStruct: true}
);

export const SignedBeaconBlock = new ContainerType(
  {
    message: BeaconBlock, // Modified in GLOAS
    signature: BLSSignature,
  },
  {typeName: "SignedBeaconBlock", jsonCase: "eth2"}
);

// Full block production response for self-builds, enables stateless envelope publishing
export const BlockContents = new ContainerType(
  {
    block: BeaconBlock,
    executionPayloadEnvelope: ExecutionPayloadEnvelope,
    kzgProofs: fuluSsz.KZGProofs,
    blobs: denebSsz.Blobs,
  },
  {typeName: "BlockContents", jsonCase: "eth2"}
);

export const LightClientHeader = new ContainerType(
  {
    beacon: phase0Ssz.BeaconBlockHeader,
    executionBlockHash: Bytes32,
    executionBranch: ExecutionBranch,
  },
  {typeName: "LightClientHeader", jsonCase: "eth2"}
);

export const LightClientBootstrap = new ContainerType(
  {
    header: LightClientHeader,
    currentSyncCommittee: altairSsz.SyncCommittee,
    currentSyncCommitteeBranch: CurrentSyncCommitteeBranch,
  },
  {typeName: "LightClientBootstrap", jsonCase: "eth2"}
);

export const LightClientUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    nextSyncCommittee: altairSsz.SyncCommittee,
    nextSyncCommitteeBranch: NextSyncCommitteeBranch,
    finalizedHeader: LightClientHeader,
    finalityBranch: FinalityBranch,
    syncAggregate: altairSsz.SyncAggregate,
    signatureSlot: Slot,
  },
  {typeName: "LightClientUpdate", jsonCase: "eth2"}
);

export const LightClientFinalityUpdate = new ContainerType(
  {
    attestedHeader: LightClientHeader,
    finalizedHeader: LightClientHeader,
    finalityBranch: FinalityBranch,
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

export const BeaconState = new ProgressiveContainerType(
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
    validators: Validators,
    balances: Balances,
    randaoMixes: phase0Ssz.RandaoMixes,
    // Slashings
    slashings: phase0Ssz.Slashings,
    // Participation
    previousEpochParticipation: EpochParticipation,
    currentEpochParticipation: EpochParticipation,
    // Finality
    justificationBits: phase0Ssz.JustificationBits,
    previousJustifiedCheckpoint: phase0Ssz.Checkpoint,
    currentJustifiedCheckpoint: phase0Ssz.Checkpoint,
    finalizedCheckpoint: phase0Ssz.Checkpoint,
    // Inactivity
    inactivityScores: InactivityScores,
    // Sync
    currentSyncCommittee: altairSsz.SyncCommittee,
    nextSyncCommittee: altairSsz.SyncCommittee,
    // Execution
    // latestExecutionPayloadHeader: ExecutionPayloadHeader, // Removed in GLOAS:EIP7732
    latestBlockHash: Bytes32, // New in GLOAS:EIP7732
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
    pendingDeposits: PendingDeposits,
    pendingPartialWithdrawals: PendingPartialWithdrawals,
    pendingConsolidations: PendingConsolidations,
    proposerLookahead: fuluSsz.BeaconState.fields.proposerLookahead,
    builders: Builders, // New in GLOAS:EIP7732
    nextWithdrawalBuilderIndex: BuilderIndex, // New in GLOAS:EIP7732
    executionPayloadAvailability: new BitVectorType(SLOTS_PER_HISTORICAL_ROOT), // New in GLOAS:EIP7732
    builderPendingPayments: new VectorCompositeType(BuilderPendingPayment, 2 * SLOTS_PER_EPOCH), // New in GLOAS:EIP7732
    builderPendingWithdrawals: BuilderPendingWithdrawals, // New in GLOAS:EIP7732
    latestExecutionPayloadBid: ExecutionPayloadBid, // New in GLOAS:EIP7732
    payloadExpectedWithdrawals: Withdrawals, // New in GLOAS:EIP7732
    ptcWindow: PtcWindow, // New in GLOAS:EIP7732
  },
  activeFields(46),
  {typeName: "BeaconState", jsonCase: "eth2"}
);

export const DataColumnSidecar = new ContainerType(
  {
    index: fuluSsz.DataColumnSidecar.fields.index,
    column: DataColumn,
    // kzgCommitments: denebSsz.BlobKzgCommitments, // Removed in GLOAS:EIP7732
    kzgProofs: KZGProofs,
    // signedBlockHeader: phase0Ssz.SignedBeaconBlockHeader, // Removed in GLOAS:EIP7732
    // kzgCommitmentsInclusionProof: KzgCommitmentsInclusionProof, // Removed in GLOAS:EIP7732
    slot: Slot, // New in GLOAS:EIP7732
    beaconBlockRoot: Root, // New in GLOAS:EIP7732
  },
  {typeName: "DataColumnSidecar", jsonCase: "eth2"}
);

export const DataColumnSidecars = new ListCompositeType(DataColumnSidecar, NUMBER_OF_COLUMNS);

export const ExecutionPayloadEnvelopesByRangeRequest = new ContainerType(
  {startSlot: Slot, count: UintNum64},
  {typeName: "ExecutionPayloadEnvelopesByRangeRequest", jsonCase: "eth2"}
);

// PayloadAttributes primarily for SSE event
export const PayloadAttributes = new ContainerType(
  {
    ...denebSsz.PayloadAttributes.fields,
    slotNumber: Slot,
    targetGasLimit: UintBn64,
  },
  {typeName: "PayloadAttributes", jsonCase: "eth2"}
);

export const SSEPayloadAttributes = new ContainerType(
  {
    proposerIndex: UintNum64,
    proposalSlot: Slot,
    // parentBlockNumber: UintNum64, // Removed in GLOAS:EIP7732
    parentBlockRoot: Root,
    parentBlockHash: Root,
    payloadAttributes: PayloadAttributes,
  },
  {typeName: "SSEPayloadAttributes", jsonCase: "eth2"}
);
