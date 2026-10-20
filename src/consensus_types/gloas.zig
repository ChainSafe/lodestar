const ssz = @import("ssz");
const p = @import("primitive.zig");
const c = @import("constants");
const preset = @import("preset").preset;
const phase0 = @import("phase0.zig");
const altair = @import("altair.zig");
const bellatrix = @import("bellatrix.zig");
const capella = @import("capella.zig");
const deneb = @import("deneb.zig");
const electra = @import("electra.zig");
const fulu = @import("fulu.zig");

pub const Fork = phase0.Fork;
pub const ForkData = phase0.ForkData;
pub const Checkpoint = phase0.Checkpoint;
pub const Validator = phase0.Validator;
pub const Validators = ssz.FixedProgressiveListType(Validator, .{});
pub const AttestationData = phase0.AttestationData;
pub const PendingAttestation = phase0.PendingAttestation;
pub const Eth1Data = phase0.Eth1Data;
pub const Eth1DataVotes = phase0.Eth1DataVotes;
pub const HistoricalBatch = phase0.HistoricalBatch;
pub const DepositMessage = phase0.DepositMessage;
pub const DepositData = phase0.DepositData;
pub const BeaconBlockHeader = phase0.BeaconBlockHeader;
pub const SigningData = phase0.SigningData;
pub const ProposerSlashing = phase0.ProposerSlashing;
pub const Deposit = phase0.Deposit;
pub const VoluntaryExit = phase0.VoluntaryExit;
pub const SignedVoluntaryExit = phase0.SignedVoluntaryExit;
pub const Eth1Block = phase0.Eth1Block;
pub const HistoricalBlockRoots = phase0.HistoricalBlockRoots;
pub const HistoricalStateRoots = phase0.HistoricalStateRoots;
pub const ProposerSlashings = ssz.FixedProgressiveListType(ProposerSlashing, .{});
pub const Deposits = ssz.FixedProgressiveListType(Deposit, .{});
pub const VoluntaryExits = ssz.FixedProgressiveListType(SignedVoluntaryExit, .{});
pub const Slashings = phase0.Slashings;
pub const Balances = ssz.FixedProgressiveListType(p.Uint64, .{ .chunked_leaf = true });
pub const EpochParticipation = ssz.FixedProgressiveListType(p.Uint8, .{ .chunked_leaf = true });
pub const InactivityScores = ssz.FixedProgressiveListType(p.Uint64, .{ .chunked_leaf = true });
pub const RandaoMixes = phase0.RandaoMixes;

pub const SyncAggregate = altair.SyncAggregate;
pub const SyncCommittee = altair.SyncCommittee;
pub const SyncCommitteeMessage = altair.SyncCommitteeMessage;
pub const SyncCommitteeContribution = altair.SyncCommitteeContribution;
pub const ContributionAndProof = altair.ContributionAndProof;
pub const SignedContributionAndProof = altair.SignedContributionAndProof;
pub const SyncAggregatorSelectionData = altair.SyncAggregatorSelectionData;

pub const PowBlock = bellatrix.PowBlock;

pub const Withdrawal = capella.Withdrawal;
pub const Withdrawals = ssz.FixedProgressiveListType(Withdrawal, .{});
pub const BLSToExecutionChange = capella.BLSToExecutionChange;
pub const SignedBLSToExecutionChange = capella.SignedBLSToExecutionChange;
pub const SignedBLSToExecutionChanges = ssz.FixedProgressiveListType(SignedBLSToExecutionChange, .{});
pub const HistoricalSummary = capella.HistoricalSummary;

pub const BlobIdentifier = deneb.BlobIdentifier;
pub const BlobKzgCommitments = ssz.FixedProgressiveListType(p.KZGCommitment, .{});

pub const PendingDeposit = electra.PendingDeposit;
pub const PendingPartialWithdrawal = electra.PendingPartialWithdrawal;
pub const PendingConsolidation = electra.PendingConsolidation;
pub const PendingDeposits = ssz.FixedProgressiveListType(PendingDeposit, .{});
pub const PendingPartialWithdrawals = ssz.FixedProgressiveListType(PendingPartialWithdrawal, .{});
pub const PendingConsolidations = ssz.FixedProgressiveListType(PendingConsolidation, .{});
pub const DepositRequest = electra.DepositRequest;
pub const WithdrawalRequest = electra.WithdrawalRequest;
pub const ConsolidationRequest = electra.ConsolidationRequest;
pub const BuilderDepositRequest = ssz.FixedContainerType(struct {
    pubkey: p.BLSPubkey,
    withdrawal_credentials: p.Bytes32,
    amount: p.Gwei,
    signature: p.BLSSignature,
});
pub const BuilderExitRequest = ssz.FixedContainerType(struct {
    source_address: p.ExecutionAddress,
    pubkey: p.BLSPubkey,
});
pub const DepositRequests = ssz.FixedProgressiveListType(DepositRequest, .{});
pub const WithdrawalRequests = ssz.FixedProgressiveListType(WithdrawalRequest, .{});
pub const ConsolidationRequests = ssz.FixedProgressiveListType(ConsolidationRequest, .{});
pub const BuilderDepositRequests = ssz.FixedProgressiveListType(BuilderDepositRequest, .{});
pub const BuilderExitRequests = ssz.FixedProgressiveListType(BuilderExitRequest, .{});
pub const ExecutionRequests = ssz.VariableProgressiveContainerType(struct {
    deposits: DepositRequests,
    withdrawals: WithdrawalRequests,
    consolidations: ConsolidationRequests,
    builder_deposits: BuilderDepositRequests,
    builder_exits: BuilderExitRequests,
}, &@as([5]u1, @splat(1)));
pub const SingleAttestation = electra.SingleAttestation;
pub const AggregationBits = ssz.ProgressiveBitListType(.{});
pub const AttestingIndices = ssz.FixedProgressiveListType(p.ValidatorIndex, .{});
pub const Attestation = ssz.VariableProgressiveContainerType(struct {
    aggregation_bits: AggregationBits,
    data: AttestationData,
    signature: p.BLSSignature,
    committee_bits: ssz.BitVectorType(preset.MAX_COMMITTEES_PER_SLOT),
}, &@as([4]u1, @splat(1)));
pub const Attestations = ssz.VariableProgressiveListType(Attestation, .{});
pub const IndexedAttestation = ssz.VariableProgressiveContainerType(struct {
    attesting_indices: AttestingIndices,
    data: AttestationData,
    signature: p.BLSSignature,
}, &@as([3]u1, @splat(1)));
pub const AttesterSlashing = ssz.VariableContainerType(struct {
    attestation_1: IndexedAttestation,
    attestation_2: IndexedAttestation,
});
pub const AttesterSlashings = ssz.VariableProgressiveListType(AttesterSlashing, .{});
pub const AggregateAndProof = ssz.VariableContainerType(struct {
    aggregator_index: p.ValidatorIndex,
    aggregate: Attestation,
    selection_proof: p.BLSSignature,
});
pub const SignedAggregateAndProof = ssz.VariableContainerType(struct {
    message: AggregateAndProof,
    signature: p.BLSSignature,
});
pub const SignedBeaconBlockHeader = electra.SignedBeaconBlockHeader;

// ExecutionPayloadHeader retained for light client usage
pub const ExecutionPayloadHeader = electra.ExecutionPayloadHeader;
pub const VersionedHashes = electra.VersionedHashes;

// RLP-encoded block access list (EIP-7928)
pub const BlockAccessList = ssz.ProgressiveByteListType(.{});
pub const Transaction = ssz.ProgressiveByteListType(.{});
pub const Transactions = ssz.VariableProgressiveListType(Transaction, .{});

// Gloas ExecutionPayload adds block_access_list (EIP-7928) and slot_number (EIP-7843)
pub const ExecutionPayload = ssz.VariableProgressiveContainerType(struct {
    parent_hash: p.Bytes32,
    fee_recipient: p.Bytes20,
    state_root: p.Bytes32,
    receipts_root: p.Bytes32,
    logs_bloom: bellatrix.LogsBloom,
    prev_randao: p.Bytes32,
    block_number: p.Uint64,
    gas_limit: p.Uint64,
    gas_used: p.Uint64,
    timestamp: p.Uint64,
    extra_data: bellatrix.ExtraData,
    base_fee_per_gas: p.Uint256,
    block_hash: p.Bytes32,
    transactions: Transactions,
    withdrawals: Withdrawals,
    blob_gas_used: p.Uint64,
    excess_blob_gas: p.Uint64,
    block_access_list: BlockAccessList,
    slot_number: p.Uint64,
}, &@as([19]u1, @splat(1)));

pub const NewPayloadRequest = ssz.VariableProgressiveContainerType(struct {
    execution_payload: ExecutionPayload,
    versioned_hashes: VersionedHashes,
    parent_beacon_block_root: p.Root,
    execution_requests: ExecutionRequests,
}, &@as([4]u1, @splat(1)));

// Reuse Fulu DAS types
pub const RowIndex = fulu.RowIndex;
pub const ColumnIndex = fulu.ColumnIndex;
pub const CustodyIndex = fulu.CustodyIndex;
pub const DataColumnIndices = fulu.DataColumnIndices;
pub const DataColumnsByRootIdentifier = fulu.DataColumnsByRootIdentifier;
pub const Cell = fulu.Cell;
pub const MatrixEntry = fulu.MatrixEntry;
pub const ProposerLookahead = fulu.ProposerLookahead;

// Cached payload-timeliness committees for the previous, current, and next epochs
pub const PayloadTimelinessCommittee = ssz.FixedVectorType(p.ValidatorIndex, preset.PTC_SIZE, .{});
pub const PayloadTimelinessCommitteeIndices = ssz.FixedListType(p.ValidatorIndex, preset.PTC_SIZE, .{});
pub const PayloadTimelinessCommitteeBits = ssz.BitVectorType(preset.PTC_SIZE);
pub const PtcWindow = ssz.FixedVectorType(
    PayloadTimelinessCommittee,
    (2 + preset.MIN_SEED_LOOKAHEAD) * preset.SLOTS_PER_EPOCH,
    .{},
);

pub const ExecutionBranch = ssz.FixedVectorType(p.Root, 11, .{});
pub const CurrentSyncCommitteeBranch = ssz.FixedVectorType(p.Root, 11, .{});
pub const NextSyncCommitteeBranch = ssz.FixedVectorType(p.Root, 11, .{});
pub const FinalityBranch = ssz.FixedVectorType(p.Root, 9, .{});
pub const LightClientHeader = ssz.FixedContainerType(struct {
    beacon: BeaconBlockHeader,
    execution_block_hash: p.Bytes32,
    execution_branch: ExecutionBranch,
});
pub const LightClientBootstrap = ssz.FixedContainerType(struct {
    header: LightClientHeader,
    current_sync_committee: SyncCommittee,
    current_sync_committee_branch: CurrentSyncCommitteeBranch,
});
pub const LightClientUpdate = ssz.FixedContainerType(struct {
    attested_header: LightClientHeader,
    next_sync_committee: SyncCommittee,
    next_sync_committee_branch: NextSyncCommitteeBranch,
    finalized_header: LightClientHeader,
    finality_branch: FinalityBranch,
    sync_aggregate: SyncAggregate,
    signature_slot: p.Slot,
});
pub const LightClientFinalityUpdate = ssz.FixedContainerType(struct {
    attested_header: LightClientHeader,
    finalized_header: LightClientHeader,
    finality_branch: FinalityBranch,
    sync_aggregate: SyncAggregate,
    signature_slot: p.Slot,
});
pub const LightClientOptimisticUpdate = ssz.FixedContainerType(struct {
    attested_header: LightClientHeader,
    sync_aggregate: SyncAggregate,
    signature_slot: p.Slot,
});

// New Gloas types

// Alias for builder indices (Uint64 like ValidatorIndex)
pub const BuilderIndex = p.Uint64;

pub const Builder = ssz.FixedContainerType(struct {
    pubkey: p.BLSPubkey,
    version: p.Uint8,
    execution_address: p.ExecutionAddress,
    balance: p.Uint64,
    deposit_epoch: p.Uint64,
    withdrawable_epoch: p.Uint64,
});

pub const BuilderPendingWithdrawal = ssz.FixedContainerType(struct {
    fee_recipient: p.ExecutionAddress,
    amount: p.Uint64,
    builder_index: BuilderIndex,
});

pub const BuilderPendingPayment = ssz.FixedContainerType(struct {
    weight: p.Uint64,
    withdrawal: BuilderPendingWithdrawal,
    proposer_index: p.ValidatorIndex,
});

pub const PayloadAttestationData = ssz.FixedContainerType(struct {
    beacon_block_root: p.Root,
    slot: p.Slot,
    payload_present: p.Boolean,
    blob_data_available: p.Boolean,
});

pub const PayloadAttestation = ssz.FixedProgressiveContainerType(struct {
    aggregation_bits: PayloadTimelinessCommitteeBits,
    data: PayloadAttestationData,
    signature: p.BLSSignature,
}, &@as([3]u1, @splat(1)));

pub const PayloadAttestationMessage = ssz.FixedContainerType(struct {
    validator_index: p.ValidatorIndex,
    data: PayloadAttestationData,
    signature: p.BLSSignature,
});

pub const IndexedPayloadAttestation = ssz.VariableProgressiveContainerType(struct {
    attesting_indices: PayloadTimelinessCommitteeIndices,
    data: PayloadAttestationData,
    signature: p.BLSSignature,
}, &@as([3]u1, @splat(1)));

pub const ProposerPreferences = ssz.FixedContainerType(struct {
    dependent_root: p.Root,
    proposal_slot: p.Slot,
    validator_index: p.ValidatorIndex,
    fee_recipient: p.ExecutionAddress,
    target_gas_limit: p.Uint64,
});

pub const SignedProposerPreferences = ssz.FixedContainerType(struct {
    message: ProposerPreferences,
    signature: p.BLSSignature,
});

pub const ExecutionPayloadBid = ssz.VariableProgressiveContainerType(struct {
    parent_block_hash: p.Bytes32,
    parent_block_root: p.Root,
    block_hash: p.Bytes32,
    prev_randao: p.Bytes32,
    fee_recipient: p.ExecutionAddress,
    gas_limit: p.Uint64,
    builder_index: BuilderIndex,
    slot: p.Slot,
    value: p.Uint64,
    execution_payment: p.Uint64,
    blob_kzg_commitments: BlobKzgCommitments,
    execution_requests_root: p.Root,
}, &@as([12]u1, @splat(1)));

pub const SignedExecutionPayloadBid = ssz.VariableContainerType(struct {
    message: ExecutionPayloadBid,
    signature: p.BLSSignature,
});

pub const ExecutionPayloadEnvelope = ssz.VariableProgressiveContainerType(struct {
    payload: ExecutionPayload,
    execution_requests: ExecutionRequests,
    builder_index: BuilderIndex,
    beacon_block_root: p.Root,
    parent_beacon_block_root: p.Root,
}, &@as([5]u1, @splat(1)));

pub const SignedExecutionPayloadEnvelope = ssz.VariableContainerType(struct {
    message: ExecutionPayloadEnvelope,
    signature: p.BLSSignature,
});

pub const BeaconBlockBody = ssz.VariableProgressiveContainerType(struct {
    randao_reveal: p.BLSSignature,
    eth1_data: Eth1Data,
    graffiti: p.Bytes32,
    proposer_slashings: ProposerSlashings,
    attester_slashings: AttesterSlashings,
    attestations: Attestations,
    deposits: Deposits,
    voluntary_exits: VoluntaryExits,
    sync_aggregate: SyncAggregate,
    // execution_payload: ExecutionPayload, // Removed in GLOAS:EIP7732
    bls_to_execution_changes: SignedBLSToExecutionChanges,
    // blob_kzg_commitments: deneb.BlobKzgCommitments, // Removed in GLOAS:EIP7732
    // execution_requests: ExecutionRequests, // Removed in GLOAS:EIP7732
    signed_execution_payload_bid: SignedExecutionPayloadBid, // New in GLOAS:EIP7732
    payload_attestations: PayloadAttestations, // New in GLOAS:EIP7732
    parent_execution_requests: ExecutionRequests, // New in GLOAS:EIP7732
}, &@as([13]u1, @splat(1)));

pub const BeaconBlock = ssz.VariableContainerType(struct {
    slot: p.Slot,
    proposer_index: p.ValidatorIndex,
    parent_root: p.Root,
    state_root: p.Root,
    body: BeaconBlockBody,
});

pub const SignedBeaconBlock = ssz.VariableContainerType(struct {
    message: BeaconBlock,
    signature: p.BLSSignature,
});

pub const DataColumnSidecar = ssz.VariableContainerType(struct {
    index: ColumnIndex,
    column: DataColumn,
    // kzg_commitments: deneb.BlobKzgCommitments, // Removed in GLOAS:EIP7732
    kzg_proofs: KZGProofs,
    // signed_block_header: phase0.SignedBeaconBlockHeader, // Removed in GLOAS:EIP7732
    // kzg_commitments_inclusion_proof: ssz.FixedVectorType(p.Bytes32, preset.KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH, .{}), // Removed in GLOAS:EIP7732
    slot: p.Slot, // New in GLOAS:EIP7732
    beacon_block_root: p.Root, // New in GLOAS:EIP7732
});

pub const BeaconState = ssz.VariableProgressiveContainerType(struct {
    genesis_time: p.Uint64,
    genesis_validators_root: p.Root,
    slot: p.Slot,
    fork: Fork,
    latest_block_header: BeaconBlockHeader,
    block_roots: HistoricalBlockRoots,
    state_roots: HistoricalStateRoots,
    historical_roots: ssz.FixedListType(p.Root, preset.HISTORICAL_ROOTS_LIMIT, .{}),
    eth1_data: Eth1Data,
    eth1_data_votes: phase0.Eth1DataVotes,
    eth1_deposit_index: p.Uint64,
    validators: Validators,
    balances: Balances,
    randao_mixes: ssz.FixedVectorType(p.Bytes32, preset.EPOCHS_PER_HISTORICAL_VECTOR, .{}),
    slashings: ssz.FixedVectorType(p.Gwei, preset.EPOCHS_PER_SLASHINGS_VECTOR, .{}),
    previous_epoch_participation: EpochParticipation,
    current_epoch_participation: EpochParticipation,
    justification_bits: ssz.BitVectorType(c.JUSTIFICATION_BITS_LENGTH),
    previous_justified_checkpoint: Checkpoint,
    current_justified_checkpoint: Checkpoint,
    finalized_checkpoint: Checkpoint,
    inactivity_scores: InactivityScores,
    current_sync_committee: SyncCommittee,
    next_sync_committee: SyncCommittee,
    // latest_execution_payload_header: ExecutionPayloadHeader, // Removed in GLOAS:EIP7732
    latest_block_hash: p.Bytes32, // New in GLOAS:EIP7732
    next_withdrawal_index: p.WithdrawalIndex,
    next_withdrawal_validator_index: p.ValidatorIndex,
    historical_summaries: ssz.FixedListType(HistoricalSummary, preset.HISTORICAL_ROOTS_LIMIT, .{}),
    deposit_requests_start_index: p.Uint64,
    deposit_balance_to_consume: p.Gwei,
    exit_balance_to_consume: p.Gwei,
    earliest_exit_epoch: p.Epoch,
    consolidation_balance_to_consume: p.Gwei,
    earliest_consolidation_epoch: p.Epoch,
    pending_deposits: PendingDeposits,
    pending_partial_withdrawals: PendingPartialWithdrawals,
    pending_consolidations: PendingConsolidations,
    proposer_lookahead: ProposerLookahead,
    builders: Builders, // New in GLOAS:EIP7732
    next_withdrawal_builder_index: BuilderIndex, // New in GLOAS:EIP7732
    execution_payload_availability: ssz.BitVectorType(preset.SLOTS_PER_HISTORICAL_ROOT), // New in GLOAS:EIP7732
    builder_pending_payments: BuilderPendingPayments, // New in GLOAS:EIP7732
    builder_pending_withdrawals: BuilderPendingWithdrawals, // New in GLOAS:EIP7732
    latest_execution_payload_bid: ExecutionPayloadBid, // New in GLOAS:EIP7732
    payload_expected_withdrawals: Withdrawals, // New in GLOAS:EIP7732
    ptc_window: PtcWindow, // New in GLOAS:EIP7732
}, &@as([46]u1, @splat(1)));

pub const BlobSidecar = electra.BlobSidecar;

pub const Builders = ssz.FixedProgressiveListType(Builder, .{});
pub const BuilderPendingPayments = ssz.FixedVectorType(BuilderPendingPayment, 2 * preset.SLOTS_PER_EPOCH, .{});
pub const BuilderPendingWithdrawals = ssz.FixedProgressiveListType(BuilderPendingWithdrawal, .{});
pub const PayloadAttestations = ssz.FixedProgressiveListType(PayloadAttestation, .{});
pub const DataColumn = ssz.FixedProgressiveListType(Cell, .{});
pub const KZGProofs = ssz.FixedProgressiveListType(p.KZGProof, .{});

pub const PayloadTimelinessCommitteeWindow = PtcWindow;
