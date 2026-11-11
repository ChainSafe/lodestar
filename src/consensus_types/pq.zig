const ssz = @import("ssz");
const p = @import("primitive.zig");
const c = @import("constants");
const preset = @import("preset").preset;
const gloas = @import("gloas.zig");

pub const Fork = gloas.Fork;
pub const ForkData = gloas.ForkData;
pub const Checkpoint = gloas.Checkpoint;
pub const AttestationData = gloas.AttestationData;
pub const PendingAttestation = gloas.PendingAttestation;
pub const Eth1Data = gloas.Eth1Data;
pub const Eth1DataVotes = gloas.Eth1DataVotes;
pub const HistoricalBatch = gloas.HistoricalBatch;
pub const DepositMessage = gloas.DepositMessage;
pub const DepositData = gloas.DepositData;
pub const BeaconBlockHeader = gloas.BeaconBlockHeader;
pub const SigningData = gloas.SigningData;
pub const Deposit = gloas.Deposit;
pub const VoluntaryExit = gloas.VoluntaryExit;
pub const Eth1Block = gloas.Eth1Block;
pub const HistoricalBlockRoots = gloas.HistoricalBlockRoots;
pub const HistoricalStateRoots = gloas.HistoricalStateRoots;
pub const Deposits = gloas.Deposits;
pub const Slashings = gloas.Slashings;
pub const Balances = gloas.Balances;
pub const EpochParticipation = gloas.EpochParticipation;
pub const InactivityScores = gloas.InactivityScores;
pub const RandaoMixes = gloas.RandaoMixes;
pub const PowBlock = gloas.PowBlock;
pub const Withdrawal = gloas.Withdrawal;
pub const Withdrawals = gloas.Withdrawals;
pub const HistoricalSummary = gloas.HistoricalSummary;
pub const BlobIdentifier = gloas.BlobIdentifier;
pub const BlobKzgCommitments = gloas.BlobKzgCommitments;
pub const PendingDeposit = gloas.PendingDeposit;
pub const PendingPartialWithdrawal = gloas.PendingPartialWithdrawal;
pub const PendingConsolidation = gloas.PendingConsolidation;
pub const PendingDeposits = gloas.PendingDeposits;
pub const PendingPartialWithdrawals = gloas.PendingPartialWithdrawals;
pub const PendingConsolidations = gloas.PendingConsolidations;
pub const DepositRequest = gloas.DepositRequest;
pub const WithdrawalRequest = gloas.WithdrawalRequest;
pub const ConsolidationRequest = gloas.ConsolidationRequest;
pub const BuilderDepositRequest = gloas.BuilderDepositRequest;
pub const BuilderExitRequest = gloas.BuilderExitRequest;
pub const DepositRequests = gloas.DepositRequests;
pub const WithdrawalRequests = gloas.WithdrawalRequests;
pub const ConsolidationRequests = gloas.ConsolidationRequests;
pub const BuilderDepositRequests = gloas.BuilderDepositRequests;
pub const BuilderExitRequests = gloas.BuilderExitRequests;
pub const AggregationBits = gloas.AggregationBits;
pub const AttestingIndices = gloas.AttestingIndices;
pub const ExecutionPayloadHeader = gloas.ExecutionPayloadHeader;
pub const VersionedHashes = gloas.VersionedHashes;
pub const BlockAccessList = gloas.BlockAccessList;
pub const Transaction = gloas.Transaction;
pub const Transactions = gloas.Transactions;
pub const ExecutionPayload = gloas.ExecutionPayload;
pub const RowIndex = gloas.RowIndex;
pub const ColumnIndex = gloas.ColumnIndex;
pub const CustodyIndex = gloas.CustodyIndex;
pub const DataColumnIndices = gloas.DataColumnIndices;
pub const DataColumnsByRootIdentifier = gloas.DataColumnsByRootIdentifier;
pub const Cell = gloas.Cell;
pub const MatrixEntry = gloas.MatrixEntry;
pub const ProposerLookahead = gloas.ProposerLookahead;
pub const PayloadTimelinessCommittee = gloas.PayloadTimelinessCommittee;
pub const PtcWindow = gloas.PtcWindow;
pub const BuilderIndex = gloas.BuilderIndex;
pub const BuilderPendingWithdrawal = gloas.BuilderPendingWithdrawal;
pub const BuilderPendingPayment = gloas.BuilderPendingPayment;
pub const PayloadAttestationData = gloas.PayloadAttestationData;
pub const ProposerPreferences = gloas.ProposerPreferences;
pub const ExecutionPayloadBid = gloas.ExecutionPayloadBid;
pub const DataColumnSidecar = gloas.DataColumnSidecar;
pub const BlobSidecar = gloas.BlobSidecar;
pub const BuilderPendingPayments = gloas.BuilderPendingPayments;
pub const BuilderPendingWithdrawals = gloas.BuilderPendingWithdrawals;
pub const DataColumn = gloas.DataColumn;
pub const KZGProofs = gloas.KZGProofs;
pub const PayloadTimelinessCommitteeWindow = gloas.PayloadTimelinessCommitteeWindow;

pub const XMSSPubkey = p.Bytes32;
pub const XMSSSignature = ssz.ByteVectorType(c.XMSS_SIGNATURE_SIZE);
/// A leaf of a validator's VRF tree followed by its Merkle branch.
pub const VRFProof = ssz.FixedVectorType(p.Bytes32, c.VRF_TREE_DEPTH + 1, .{});
pub const AttestationProof = ssz.ByteListType(preset.MAX_STARK_PROOF_SIZE);

pub const Validator = ssz.StructContainerType(struct {
    pubkey: XMSSPubkey,
    vrf_root: p.Root,
    withdrawal_credentials: p.Root,
    effective_balance: p.Gwei,
    slashed: p.Boolean,
    activation_eligibility_epoch: p.Epoch,
    activation_epoch: p.Epoch,
    exit_epoch: p.Epoch,
    withdrawable_epoch: p.Epoch,
});
pub const Validators = ssz.FixedProgressiveListType(Validator, .{});

pub const SignedBeaconBlockHeader = ssz.FixedContainerType(struct {
    message: BeaconBlockHeader,
    signature: XMSSSignature,
});
pub const ProposerSlashing = ssz.FixedContainerType(struct {
    signed_header_1: SignedBeaconBlockHeader,
    signed_header_2: SignedBeaconBlockHeader,
});
pub const ProposerSlashings = ssz.FixedProgressiveListType(ProposerSlashing, .{});

pub const SignedVoluntaryExit = ssz.FixedContainerType(struct {
    message: VoluntaryExit,
    signature: XMSSSignature,
});
pub const VoluntaryExits = ssz.FixedProgressiveListType(SignedVoluntaryExit, .{});

pub const SingleAttestation = ssz.FixedContainerType(struct {
    committee_index: p.CommitteeIndex,
    attester_index: p.ValidatorIndex,
    data: AttestationData,
    signature: XMSSSignature,
});
pub const Attestation = ssz.VariableProgressiveContainerType(struct {
    aggregation_bits: AggregationBits,
    data: AttestationData,
    committee_bits: ssz.BitVectorType(preset.MAX_COMMITTEES_PER_SLOT),
}, &.{ 1, 1, 0, 1 });
pub const Attestations = ssz.VariableProgressiveListType(Attestation, .{});
pub const IndexedAttestation = ssz.VariableProgressiveContainerType(struct {
    attesting_indices: AttestingIndices,
    data: AttestationData,
    proof: AttestationProof,
}, &@as([3]u1, @splat(1)));
pub const AttesterSlashing = ssz.VariableContainerType(struct {
    attestation_1: IndexedAttestation,
    attestation_2: IndexedAttestation,
});
pub const AttesterSlashings = ssz.VariableProgressiveListType(AttesterSlashing, .{});
pub const AggregateAndProof = ssz.VariableContainerType(struct {
    aggregator_index: p.ValidatorIndex,
    aggregate: Attestation,
    selection_proof: VRFProof,
    proof: AttestationProof,
});
pub const SignedAggregateAndProof = ssz.VariableContainerType(struct {
    message: AggregateAndProof,
    signature: XMSSSignature,
});

pub const Builder = ssz.FixedContainerType(struct {
    pubkey: XMSSPubkey,
    version: p.Uint8,
    execution_address: p.ExecutionAddress,
    balance: p.Uint64,
    deposit_epoch: p.Uint64,
    withdrawable_epoch: p.Uint64,
});
pub const Builders = ssz.FixedProgressiveListType(Builder, .{});

pub const PayloadAttestationMessage = ssz.FixedContainerType(struct {
    validator_index: p.ValidatorIndex,
    data: PayloadAttestationData,
    signature: XMSSSignature,
});
pub const SignedProposerPreferences = ssz.FixedContainerType(struct {
    message: ProposerPreferences,
    signature: XMSSSignature,
});
pub const SignedExecutionPayloadBid = ssz.VariableContainerType(struct {
    message: ExecutionPayloadBid,
    signature: XMSSSignature,
});

/// The signing container of a preregistration.
pub const ValidatorPreregistration = ssz.FixedContainerType(struct {
    pubkey: XMSSPubkey,
    withdrawal_credentials: p.Bytes32,
    vrf_root: p.Root,
});
pub const PreregistrationRequest = ssz.FixedContainerType(struct {
    pubkey: XMSSPubkey,
    withdrawal_credentials: p.Bytes32,
    vrf_root: p.Root,
    signature: XMSSSignature,
});
pub const StoredPreregistration = ssz.FixedContainerType(struct {
    pubkey: XMSSPubkey,
    withdrawal_credentials: p.Bytes32,
    vrf_root: p.Root,
    expiry_slot: p.Slot,
});
pub const PreregistrationRequests = ssz.FixedProgressiveListType(PreregistrationRequest, .{});
pub const ValidatorPreregistrations = ssz.FixedProgressiveListType(StoredPreregistration, .{});

// Indices 5 and 6 held the EIP-8483 registration requests.
pub const ExecutionRequests = ssz.VariableProgressiveContainerType(struct {
    deposits: DepositRequests,
    withdrawals: WithdrawalRequests,
    consolidations: ConsolidationRequests,
    builder_deposits: BuilderDepositRequests,
    builder_exits: BuilderExitRequests,
    preregistrations: PreregistrationRequests,
}, &.{ 1, 1, 1, 1, 1, 0, 0, 1 });

pub const NewPayloadRequest = ssz.VariableProgressiveContainerType(struct {
    execution_payload: ExecutionPayload,
    versioned_hashes: VersionedHashes,
    parent_beacon_block_root: p.Root,
    execution_requests: ExecutionRequests,
}, &@as([4]u1, @splat(1)));

pub const ExecutionPayloadEnvelope = ssz.VariableProgressiveContainerType(struct {
    payload: ExecutionPayload,
    execution_requests: ExecutionRequests,
    builder_index: BuilderIndex,
    beacon_block_root: p.Root,
    parent_beacon_block_root: p.Root,
}, &@as([5]u1, @splat(1)));
pub const SignedExecutionPayloadEnvelope = ssz.VariableContainerType(struct {
    message: ExecutionPayloadEnvelope,
    signature: XMSSSignature,
});

// Removed: sync_aggregate (8), bls_to_execution_changes (9), payload_attestations (11).
pub const BeaconBlockBody = ssz.VariableProgressiveContainerType(struct {
    randao_reveal: VRFProof,
    eth1_data: Eth1Data,
    graffiti: p.Bytes32,
    proposer_slashings: ProposerSlashings,
    attester_slashings: AttesterSlashings,
    attestations: Attestations,
    deposits: Deposits,
    voluntary_exits: VoluntaryExits,
    signed_execution_payload_bid: SignedExecutionPayloadBid,
    parent_execution_requests: ExecutionRequests,
    proof: AttestationProof,
}, &.{ 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1 });

pub const BeaconBlock = ssz.VariableContainerType(struct {
    slot: p.Slot,
    proposer_index: p.ValidatorIndex,
    parent_root: p.Root,
    state_root: p.Root,
    body: BeaconBlockBody,
});
pub const SignedBeaconBlock = ssz.VariableContainerType(struct {
    message: BeaconBlock,
    signature: XMSSSignature,
});

// Removed: the sync committees (22, 23) and the EIP-8483 registrations (46, 47).
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
    eth1_data_votes: Eth1DataVotes,
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
    latest_block_hash: p.Bytes32,
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
    builders: Builders,
    next_withdrawal_builder_index: BuilderIndex,
    execution_payload_availability: ssz.BitVectorType(preset.SLOTS_PER_HISTORICAL_ROOT),
    builder_pending_payments: BuilderPendingPayments,
    builder_pending_withdrawals: BuilderPendingWithdrawals,
    latest_execution_payload_bid: ExecutionPayloadBid,
    payload_expected_withdrawals: Withdrawals,
    ptc_window: PtcWindow,
    validator_preregistrations: ValidatorPreregistrations,
}, &(@as([22]u1, @splat(1)) ++ .{ 0, 0 } ++ @as([22]u1, @splat(1)) ++ .{ 0, 0, 1 }));

test {
    _ = @import("pq_test.zig");
}
