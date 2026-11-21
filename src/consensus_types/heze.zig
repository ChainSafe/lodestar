const ssz = @import("ssz");
const p = @import("primitive.zig");
const c = @import("constants");
const preset = @import("preset").preset;
const gloas = @import("gloas.zig");

pub const Fork = gloas.Fork;
pub const ForkData = gloas.ForkData;
pub const Checkpoint = gloas.Checkpoint;
pub const Validator = gloas.Validator;
pub const Validators = gloas.Validators;
pub const AttestationData = gloas.AttestationData;
pub const PendingAttestation = gloas.PendingAttestation;
pub const Eth1Data = gloas.Eth1Data;
pub const Eth1DataVotes = gloas.Eth1DataVotes;
pub const HistoricalBatch = gloas.HistoricalBatch;
pub const DepositMessage = gloas.DepositMessage;
pub const DepositData = gloas.DepositData;
pub const BeaconBlockHeader = gloas.BeaconBlockHeader;
pub const SigningData = gloas.SigningData;
pub const ProposerSlashing = gloas.ProposerSlashing;
pub const Deposit = gloas.Deposit;
pub const VoluntaryExit = gloas.VoluntaryExit;
pub const SignedVoluntaryExit = gloas.SignedVoluntaryExit;
pub const Eth1Block = gloas.Eth1Block;
pub const HistoricalBlockRoots = gloas.HistoricalBlockRoots;
pub const HistoricalStateRoots = gloas.HistoricalStateRoots;
pub const ProposerSlashings = gloas.ProposerSlashings;
pub const Deposits = gloas.Deposits;
pub const VoluntaryExits = gloas.VoluntaryExits;
pub const Slashings = gloas.Slashings;
pub const Balances = gloas.Balances;
pub const EpochParticipation = gloas.EpochParticipation;
pub const InactivityScores = gloas.InactivityScores;
pub const RandaoMixes = gloas.RandaoMixes;
pub const SyncAggregate = gloas.SyncAggregate;
pub const SyncCommittee = gloas.SyncCommittee;
pub const SyncCommitteeMessage = gloas.SyncCommitteeMessage;
pub const SyncCommitteeContribution = gloas.SyncCommitteeContribution;
pub const ContributionAndProof = gloas.ContributionAndProof;
pub const SignedContributionAndProof = gloas.SignedContributionAndProof;
pub const SyncAggregatorSelectionData = gloas.SyncAggregatorSelectionData;
pub const PowBlock = gloas.PowBlock;
pub const Withdrawal = gloas.Withdrawal;
pub const Withdrawals = gloas.Withdrawals;
pub const BLSToExecutionChange = gloas.BLSToExecutionChange;
pub const SignedBLSToExecutionChange = gloas.SignedBLSToExecutionChange;
pub const SignedBLSToExecutionChanges = gloas.SignedBLSToExecutionChanges;
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
pub const ExecutionRequests = gloas.ExecutionRequests;
pub const SingleAttestation = gloas.SingleAttestation;
pub const AggregationBits = gloas.AggregationBits;
pub const AttestingIndices = gloas.AttestingIndices;
pub const Attestation = gloas.Attestation;
pub const Attestations = gloas.Attestations;
pub const IndexedAttestation = gloas.IndexedAttestation;
pub const AttesterSlashing = gloas.AttesterSlashing;
pub const AttesterSlashings = gloas.AttesterSlashings;
pub const AggregateAndProof = gloas.AggregateAndProof;
pub const SignedAggregateAndProof = gloas.SignedAggregateAndProof;
pub const SignedBeaconBlockHeader = gloas.SignedBeaconBlockHeader;
pub const ExecutionPayloadHeader = gloas.ExecutionPayloadHeader;
pub const VersionedHashes = gloas.VersionedHashes;
pub const BlockAccessList = gloas.BlockAccessList;
pub const Transaction = gloas.Transaction;
pub const Transactions = gloas.Transactions;
pub const ExecutionPayload = gloas.ExecutionPayload;
pub const NewPayloadRequest = gloas.NewPayloadRequest;
pub const RowIndex = gloas.RowIndex;
pub const ColumnIndex = gloas.ColumnIndex;
pub const CustodyIndex = gloas.CustodyIndex;
pub const DataColumnIndices = gloas.DataColumnIndices;
pub const DataColumnsByRootIdentifier = gloas.DataColumnsByRootIdentifier;
pub const Cell = gloas.Cell;
pub const MatrixEntry = gloas.MatrixEntry;
pub const ProposerLookahead = gloas.ProposerLookahead;
pub const PayloadTimelinessCommittee = gloas.PayloadTimelinessCommittee;
pub const PayloadTimelinessCommitteeIndices = gloas.PayloadTimelinessCommitteeIndices;
pub const PayloadTimelinessCommitteeBits = gloas.PayloadTimelinessCommitteeBits;
pub const PtcWindow = gloas.PtcWindow;
pub const ExecutionBranch = gloas.ExecutionBranch;
pub const CurrentSyncCommitteeBranch = gloas.CurrentSyncCommitteeBranch;
pub const NextSyncCommitteeBranch = gloas.NextSyncCommitteeBranch;
pub const FinalityBranch = gloas.FinalityBranch;
pub const LightClientHeader = gloas.LightClientHeader;
pub const LightClientBootstrap = gloas.LightClientBootstrap;
pub const LightClientUpdate = gloas.LightClientUpdate;
pub const LightClientFinalityUpdate = gloas.LightClientFinalityUpdate;
pub const LightClientOptimisticUpdate = gloas.LightClientOptimisticUpdate;
pub const BuilderIndex = gloas.BuilderIndex;
pub const Builder = gloas.Builder;
pub const BuilderPendingWithdrawal = gloas.BuilderPendingWithdrawal;
pub const BuilderPendingPayment = gloas.BuilderPendingPayment;
pub const PayloadAttestationData = gloas.PayloadAttestationData;
pub const PayloadAttestation = gloas.PayloadAttestation;
pub const PayloadAttestationMessage = gloas.PayloadAttestationMessage;
pub const IndexedPayloadAttestation = gloas.IndexedPayloadAttestation;
pub const ProposerPreferences = gloas.ProposerPreferences;
pub const SignedProposerPreferences = gloas.SignedProposerPreferences;
pub const ExecutionPayloadEnvelope = gloas.ExecutionPayloadEnvelope;
pub const SignedExecutionPayloadEnvelope = gloas.SignedExecutionPayloadEnvelope;
pub const DataColumnSidecar = gloas.DataColumnSidecar;
pub const BlobSidecar = gloas.BlobSidecar;
pub const Builders = gloas.Builders;
pub const BuilderPendingPayments = gloas.BuilderPendingPayments;
pub const BuilderPendingWithdrawals = gloas.BuilderPendingWithdrawals;
pub const PayloadAttestations = gloas.PayloadAttestations;
pub const DataColumn = gloas.DataColumn;
pub const KZGProofs = gloas.KZGProofs;
pub const PayloadTimelinessCommitteeWindow = gloas.PayloadTimelinessCommitteeWindow;

pub const InclusionListCommittee = ssz.FixedVectorType(p.ValidatorIndex, preset.INCLUSION_LIST_COMMITTEE_SIZE, .{});
pub const InclusionListBits = ssz.BitVectorType(preset.INCLUSION_LIST_COMMITTEE_SIZE);

pub const InclusionList = ssz.VariableContainerType(struct {
    slot: p.Slot,
    validator_index: p.ValidatorIndex,
    dependent_root: p.Root,
    transactions: Transactions,
});

pub const SignedInclusionList = ssz.VariableContainerType(struct {
    message: InclusionList,
    signature: p.BLSSignature,
});

pub const InclusionListsByIndicesRequest = ssz.FixedContainerType(struct {
    slot: p.Slot,
    dependent_root: p.Root,
    indices: InclusionListBits,
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
    inclusion_list_bits: InclusionListBits,
}, &@as([13]u1, @splat(1)));

pub const SignedExecutionPayloadBid = ssz.VariableContainerType(struct {
    message: ExecutionPayloadBid,
    signature: p.BLSSignature,
});

pub const BeaconBlockBody = ssz.VariableProgressiveContainerType(struct {
    randao_reveal: p.BLSSignature,
    graffiti: p.Bytes32,
    proposer_slashings: ProposerSlashings,
    attester_slashings: AttesterSlashings,
    attestations: Attestations,
    voluntary_exits: VoluntaryExits,
    sync_aggregate: SyncAggregate,
    bls_to_execution_changes: SignedBLSToExecutionChanges,
    signed_execution_payload_bid: SignedExecutionPayloadBid,
    payload_attestations: PayloadAttestations,
    parent_execution_requests: ExecutionRequests,
}, &.{ 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1 });

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

pub const BeaconState = ssz.VariableProgressiveContainerType(struct {
    genesis_time: p.Uint64,
    genesis_validators_root: p.Root,
    slot: p.Slot,
    fork: Fork,
    latest_block_header: BeaconBlockHeader,
    block_roots: HistoricalBlockRoots,
    state_roots: HistoricalStateRoots,
    historical_roots: ssz.FixedListType(p.Root, preset.HISTORICAL_ROOTS_LIMIT, .{}),
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
    latest_block_hash: p.Bytes32,
    next_withdrawal_index: p.WithdrawalIndex,
    next_withdrawal_validator_index: p.ValidatorIndex,
    historical_summaries: ssz.FixedListType(HistoricalSummary, preset.HISTORICAL_ROOTS_LIMIT, .{}),
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
}, &.{ 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 });

test {
    _ = @import("heze_test.zig");
}
