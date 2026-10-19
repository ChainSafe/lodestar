const std = @import("std");
const ssz = @import("ssz");
const p = @import("primitive.zig");
const c = @import("constants");
const preset = @import("preset").preset;
const phase0 = @import("phase0.zig");
const altair = @import("altair.zig");
const bellatrix = @import("bellatrix.zig");
const capella = @import("capella.zig");
const deneb = @import("deneb.zig");

pub const Fork = phase0.Fork;
pub const ForkData = phase0.ForkData;
pub const Checkpoint = phase0.Checkpoint;
pub const Validator = phase0.Validator;
pub const Validators = phase0.Validators;
pub const AttestationData = phase0.AttestationData;
pub const PendingAttestation = phase0.PendingAttestation;
pub const Eth1Data = phase0.Eth1Data;
pub const Eth1DataVotes = phase0.Eth1DataVotes;
pub const HistoricalBatch = phase0.HistoricalBatch;
pub const DepositMessage = phase0.DepositMessage;
pub const DepositData = phase0.DepositData;
pub const BeaconBlockHeader = phase0.BeaconBlockHeader;
pub const SignedBeaconBlockHeader = phase0.SignedBeaconBlockHeader;
pub const SigningData = phase0.SigningData;
pub const ProposerSlashing = phase0.ProposerSlashing;
pub const Deposit = phase0.Deposit;
pub const VoluntaryExit = phase0.VoluntaryExit;
pub const SignedVoluntaryExit = phase0.SignedVoluntaryExit;
pub const Eth1Block = phase0.Eth1Block;
pub const HistoricalBlockRoots = phase0.HistoricalBlockRoots;
pub const HistoricalStateRoots = phase0.HistoricalStateRoots;
pub const ProposerSlashings = phase0.ProposerSlashings;
pub const AttesterSlashings = ssz.VariableListType(AttesterSlashing, preset.MAX_ATTESTER_SLASHINGS_ELECTRA);
pub const Slashings = phase0.Slashings;
pub const Balances = phase0.Balances;
pub const RandaoMixes = phase0.RandaoMixes;
pub const Deposits = phase0.Deposits;
pub const VoluntaryExits = phase0.VoluntaryExits;

pub const SyncAggregate = altair.SyncAggregate;
pub const SyncCommittee = altair.SyncCommittee;
pub const SyncCommitteeMessage = altair.SyncCommitteeMessage;
pub const SyncCommitteeContribution = altair.SyncCommitteeContribution;
pub const ContributionAndProof = altair.ContributionAndProof;
pub const SignedContributionAndProof = altair.SignedContributionAndProof;
pub const SyncAggregatorSelectionData = altair.SyncAggregatorSelectionData;

pub const PowBlock = bellatrix.PowBlock;

pub const Withdrawal = capella.Withdrawal;
pub const BLSToExecutionChange = capella.BLSToExecutionChange;
pub const SignedBLSToExecutionChange = capella.SignedBLSToExecutionChange;
pub const SignedBLSToExecutionChanges = capella.SignedBLSToExecutionChanges;
pub const HistoricalSummary = capella.HistoricalSummary;

pub const BlobIdentifier = deneb.BlobIdentifier;
pub const ExecutionPayload = deneb.ExecutionPayload;
pub const ExecutionPayloadHeader = deneb.ExecutionPayloadHeader;
pub const BlobKzgCommitments = deneb.BlobKzgCommitments;

pub const PendingDeposit = ssz.FixedContainerType(struct {
    pubkey: p.BLSPubkey,
    withdrawal_credentials: p.Bytes32,
    amount: p.Gwei,
    signature: p.BLSSignature,
    slot: p.Slot,
});

pub const PendingPartialWithdrawal = ssz.FixedContainerType(struct {
    validator_index: p.ValidatorIndex,
    amount: p.Gwei,
    withdrawable_epoch: p.Epoch,
});

pub const PendingConsolidation = ssz.FixedContainerType(struct {
    source_index: p.ValidatorIndex,
    target_index: p.ValidatorIndex,
});

pub const DepositRequest = ssz.FixedContainerType(struct {
    pubkey: p.BLSPubkey,
    withdrawal_credentials: p.Bytes32,
    amount: p.Gwei,
    signature: p.BLSSignature,
    index: p.Uint64,
});

pub const WithdrawalRequest = ssz.FixedContainerType(struct {
    source_address: p.ExecutionAddress,
    validator_pubkey: p.BLSPubkey,
    amount: p.Gwei,
});

pub const ConsolidationRequest = ssz.FixedContainerType(struct {
    source_address: p.ExecutionAddress,
    source_pubkey: p.BLSPubkey,
    target_pubkey: p.BLSPubkey,
});

pub const ExecutionRequests = ssz.VariableContainerType(struct {
    deposits: ssz.FixedListType(DepositRequest, preset.MAX_DEPOSIT_REQUESTS_PER_PAYLOAD, .{}),
    withdrawals: ssz.FixedListType(WithdrawalRequest, preset.MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD, .{}),
    consolidations: ssz.FixedListType(ConsolidationRequest, preset.MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD, .{}),
});

pub const VersionedHashes = deneb.VersionedHashes;
pub const NewPayloadRequest = ssz.VariableContainerType(struct {
    execution_payload: ExecutionPayload,
    versioned_hashes: VersionedHashes,
    parent_beacon_block_root: p.Root,
    execution_requests: ExecutionRequests,
});

pub const SingleAttestation = ssz.FixedContainerType(struct {
    committee_index: p.CommitteeIndex,
    attester_index: p.ValidatorIndex,
    data: AttestationData,
    signature: p.BLSSignature,
});

pub const Attestation = ssz.VariableContainerType(struct {
    aggregation_bits: ssz.BitListType(preset.MAX_VALIDATORS_PER_COMMITTEE * preset.MAX_COMMITTEES_PER_SLOT),
    data: AttestationData,
    signature: p.BLSSignature,
    committee_bits: ssz.BitVectorType(preset.MAX_COMMITTEES_PER_SLOT),
});

pub const Attestations = ssz.VariableListType(Attestation, preset.MAX_ATTESTATIONS_ELECTRA);

pub const IndexedAttestation = ssz.VariableContainerType(struct {
    attesting_indices: ssz.FixedListType(p.ValidatorIndex, preset.MAX_VALIDATORS_PER_COMMITTEE * preset.MAX_COMMITTEES_PER_SLOT, .{}),
    data: AttestationData,
    signature: p.BLSSignature,
});

pub const AttesterSlashing = ssz.VariableContainerType(struct {
    attestation_1: IndexedAttestation,
    attestation_2: IndexedAttestation,
});

pub const AggregateAndProof = ssz.VariableContainerType(struct {
    aggregator_index: p.ValidatorIndex,
    aggregate: Attestation,
    selection_proof: p.BLSSignature,
});

pub const SignedAggregateAndProof = ssz.VariableContainerType(struct {
    message: AggregateAndProof,
    signature: p.BLSSignature,
});

pub const BlobSidecar = ssz.FixedContainerType(struct {
    index: p.BlobIndex,
    blob: ssz.ByteVectorType(c.BYTES_PER_FIELD_ELEMENT * preset.FIELD_ELEMENTS_PER_BLOB),
    kzg_commitment: p.KZGCommitment,
    kzg_proof: p.KZGProof,
    signed_block_header: SignedBeaconBlockHeader,
    kzg_commitment_inclusion_proof: ssz.FixedVectorType(p.Bytes32, preset.KZG_COMMITMENT_INCLUSION_PROOF_DEPTH, .{}),
});

pub const LightClientHeader = ssz.VariableContainerType(struct {
    beacon: BeaconBlockHeader,
    execution: ExecutionPayloadHeader,
    execution_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.EXECUTION_PAYLOAD_GINDEX), .{}),
});

pub const LightClientBootstrap = ssz.VariableContainerType(struct {
    header: LightClientHeader,
    current_sync_committee: SyncCommittee,
    current_sync_committee_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.CURRENT_SYNC_COMMITTEE_GINDEX_ELECTRA), .{}),
});

pub const LightClientUpdate = ssz.VariableContainerType(struct {
    attested_header: LightClientHeader,
    next_sync_committee: SyncCommittee,
    next_sync_committee_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.NEXT_SYNC_COMMITTEE_GINDEX_ELECTRA), .{}),
    finalized_header: LightClientHeader,
    finality_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.FINALIZED_ROOT_GINDEX_ELECTRA), .{}),
    sync_aggregate: SyncAggregate,
    signature_slot: p.Slot,
});

pub const LightClientFinalityUpdate = ssz.VariableContainerType(struct {
    attested_header: LightClientHeader,
    finalized_header: LightClientHeader,
    finality_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.FINALIZED_ROOT_GINDEX_ELECTRA), .{}),
    sync_aggregate: SyncAggregate,
    signature_slot: p.Slot,
});

pub const LightClientOptimisticUpdate = ssz.VariableContainerType(struct {
    attested_header: LightClientHeader,
    sync_aggregate: SyncAggregate,
    signature_slot: p.Slot,
});

pub const BeaconBlockBody = ssz.VariableContainerType(struct {
    randao_reveal: p.BLSSignature,
    eth1_data: Eth1Data,
    graffiti: p.Bytes32,
    proposer_slashings: ProposerSlashings,
    attester_slashings: AttesterSlashings,
    attestations: Attestations,
    deposits: Deposits,
    voluntary_exits: VoluntaryExits,
    sync_aggregate: SyncAggregate,
    execution_payload: ExecutionPayload,
    bls_to_execution_changes: SignedBLSToExecutionChanges,
    blob_kzg_commitments: BlobKzgCommitments,
    execution_requests: ExecutionRequests,
});

pub const BeaconBlock = ssz.VariableContainerType(struct {
    slot: p.Slot,
    proposer_index: p.ValidatorIndex,
    parent_root: p.Root,
    state_root: p.Root,
    body: BeaconBlockBody,
});

pub const BlindedBeaconBlockBody = ssz.VariableContainerType(struct {
    randao_reveal: p.BLSSignature,
    eth1_data: Eth1Data,
    graffiti: p.Bytes32,
    proposer_slashings: ssz.FixedListType(ProposerSlashing, preset.MAX_PROPOSER_SLASHINGS, .{}),
    attester_slashings: AttesterSlashings,
    attestations: ssz.VariableListType(Attestation, preset.MAX_ATTESTATIONS_ELECTRA),
    deposits: ssz.FixedListType(Deposit, preset.MAX_DEPOSITS, .{}),
    voluntary_exits: ssz.FixedListType(SignedVoluntaryExit, preset.MAX_VOLUNTARY_EXITS, .{}),
    sync_aggregate: SyncAggregate,
    execution_payload_header: ExecutionPayloadHeader,
    bls_to_execution_changes: ssz.FixedListType(SignedBLSToExecutionChange, preset.MAX_BLS_TO_EXECUTION_CHANGES, .{}),
    blob_kzg_commitments: ssz.FixedListType(p.KZGCommitment, preset.MAX_BLOB_COMMITMENTS_PER_BLOCK, .{}),
    execution_requests: ExecutionRequests,
});

pub const BlindedBeaconBlock = ssz.VariableContainerType(struct {
    slot: p.Slot,
    proposer_index: p.ValidatorIndex,
    parent_root: p.Root,
    state_root: p.Root,
    body: BlindedBeaconBlockBody,
});

pub const SignedBlindedBeaconBlock = ssz.VariableContainerType(struct {
    message: BlindedBeaconBlock,
    signature: p.BLSSignature,
});

pub const PendingDeposits = ssz.FixedListType(PendingDeposit, preset.PENDING_DEPOSITS_LIMIT, .{});
pub const PendingPartialWithdrawals = ssz.FixedListType(PendingPartialWithdrawal, preset.PENDING_PARTIAL_WITHDRAWALS_LIMIT, .{});
pub const PendingConsolidations = ssz.FixedListType(PendingConsolidation, preset.PENDING_CONSOLIDATIONS_LIMIT, .{});

pub const BeaconState = ssz.VariableContainerType(struct {
    genesis_time: p.Uint64,
    genesis_validators_root: p.Root,
    slot: p.Slot,
    fork: Fork,
    latest_block_header: BeaconBlockHeader,
    block_roots: HistoricalBlockRoots,
    state_roots: HistoricalStateRoots,
    historical_roots: phase0.HistoricalRoots,
    eth1_data: Eth1Data,
    eth1_data_votes: phase0.Eth1DataVotes,
    eth1_deposit_index: p.Uint64,
    validators: phase0.Validators,
    balances: phase0.Balances,
    randao_mixes: phase0.RandaoMixes,
    slashings: phase0.Slashings,
    previous_epoch_participation: altair.EpochParticipation,
    current_epoch_participation: altair.EpochParticipation,
    justification_bits: phase0.JustificationBits,
    previous_justified_checkpoint: Checkpoint,
    current_justified_checkpoint: Checkpoint,
    finalized_checkpoint: Checkpoint,
    inactivity_scores: altair.InactivityScores,
    current_sync_committee: SyncCommittee,
    next_sync_committee: SyncCommittee,
    latest_execution_payload_header: ExecutionPayloadHeader,
    next_withdrawal_index: p.WithdrawalIndex,
    next_withdrawal_validator_index: p.ValidatorIndex,
    historical_summaries: capella.HistoricalSummaries,
    deposit_requests_start_index: p.Uint64,
    deposit_balance_to_consume: p.Gwei,
    exit_balance_to_consume: p.Gwei,
    earliest_exit_epoch: p.Epoch,
    consolidation_balance_to_consume: p.Gwei,
    earliest_consolidation_epoch: p.Epoch,
    pending_deposits: PendingDeposits,
    pending_partial_withdrawals: PendingPartialWithdrawals,
    pending_consolidations: PendingConsolidations,
});

pub const SignedBeaconBlock = ssz.VariableContainerType(struct {
    message: BeaconBlock,
    signature: p.BLSSignature,
});

test "blinded block body should have the same root as the full body" {
    const allocator = std.testing.allocator;
    const body = BeaconBlockBody.default_value;
    var blinded_body = BlindedBeaconBlockBody.default_value;
    try bellatrix.Transactions.hashTreeRoot(allocator, &body.execution_payload.transactions, &blinded_body.execution_payload_header.transactions_root);
    try capella.Withdrawals.hashTreeRoot(allocator, &body.execution_payload.withdrawals, &blinded_body.execution_payload_header.withdrawals_root);

    var full_root: [32]u8 = undefined;
    var blinded_root: [32]u8 = undefined;
    try BeaconBlockBody.hashTreeRoot(allocator, &body, &full_root);
    try BlindedBeaconBlockBody.hashTreeRoot(allocator, &blinded_body, &blinded_root);
    try std.testing.expectEqualSlices(u8, &full_root, &blinded_root);
}
