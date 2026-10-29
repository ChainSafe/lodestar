const std = @import("std");
const ssz = @import("ssz");
const p = @import("primitive.zig");
const c = @import("constants");
const preset = @import("preset").preset;
const phase0 = @import("phase0.zig");
const altair = @import("altair.zig");
const bellatrix = @import("bellatrix.zig");
const capella = @import("capella.zig");

pub const Fork = phase0.Fork;
pub const ForkData = phase0.ForkData;
pub const Checkpoint = phase0.Checkpoint;
pub const Validator = phase0.Validator;
pub const Validators = phase0.Validators;
pub const AttestationData = phase0.AttestationData;
pub const IndexedAttestation = phase0.IndexedAttestation;
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
pub const AttesterSlashing = phase0.AttesterSlashing;
pub const Attestation = phase0.Attestation;
pub const Deposit = phase0.Deposit;
pub const VoluntaryExit = phase0.VoluntaryExit;
pub const SignedVoluntaryExit = phase0.SignedVoluntaryExit;
pub const Eth1Block = phase0.Eth1Block;
pub const AggregateAndProof = phase0.AggregateAndProof;
pub const SignedAggregateAndProof = phase0.SignedAggregateAndProof;
pub const HistoricalBlockRoots = phase0.HistoricalBlockRoots;
pub const HistoricalStateRoots = phase0.HistoricalStateRoots;
pub const ProposerSlashings = phase0.ProposerSlashings;
pub const AttesterSlashings = phase0.AttesterSlashings;
pub const Slashings = phase0.Slashings;
pub const Balances = phase0.Balances;
pub const RandaoMixes = phase0.RandaoMixes;
pub const Attestations = phase0.Attestations;
pub const Deposits = phase0.Deposits;
pub const VoluntaryExits = phase0.VoluntaryExits;

pub const EpochParticipation = altair.EpochParticipation;
pub const InactivityScores = altair.InactivityScores;
pub const SyncAggregate = altair.SyncAggregate;
pub const SyncCommittee = altair.SyncCommittee;
pub const SyncCommitteeMessage = altair.SyncCommitteeMessage;
pub const SyncCommitteeContribution = altair.SyncCommitteeContribution;
pub const ContributionAndProof = altair.ContributionAndProof;
pub const SignedContributionAndProof = altair.SignedContributionAndProof;
pub const SyncAggregatorSelectionData = altair.SyncAggregatorSelectionData;

pub const PowBlock = bellatrix.PowBlock;
pub const LogsBloom = bellatrix.LogsBloom;
pub const ExtraData = bellatrix.ExtraData;
pub const Transactions = bellatrix.Transactions;
pub const VersionedHashes = ssz.FixedListType(p.VersionedHash, preset.MAX_BLOB_COMMITMENTS_PER_BLOCK, .{});

pub const Withdrawal = capella.Withdrawal;
pub const BLSToExecutionChange = capella.BLSToExecutionChange;
pub const SignedBLSToExecutionChange = capella.SignedBLSToExecutionChange;
pub const SignedBLSToExecutionChanges = capella.SignedBLSToExecutionChanges;
pub const HistoricalSummary = capella.HistoricalSummary;
pub const Withdrawals = capella.Withdrawals;

pub const BlobSidecar = ssz.FixedContainerType(struct {
    index: p.BlobIndex,
    blob: ssz.ByteVectorType(c.BYTES_PER_FIELD_ELEMENT * preset.FIELD_ELEMENTS_PER_BLOB),
    kzg_commitment: p.KZGCommitment,
    kzg_proof: p.KZGProof,
    signed_block_header: SignedBeaconBlockHeader,
    kzg_commitment_inclusion_proof: ssz.FixedVectorType(p.Bytes32, preset.KZG_COMMITMENT_INCLUSION_PROOF_DEPTH, .{}),
});

pub const BlobIdentifier = ssz.FixedContainerType(struct {
    block_root: p.Root,
    index: p.BlobIndex,
});

pub const LightClientHeader = ssz.VariableContainerType(struct {
    beacon: BeaconBlockHeader,
    execution: ExecutionPayloadHeader,
    execution_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.EXECUTION_PAYLOAD_GINDEX), .{}),
});

pub const LightClientBootstrap = ssz.VariableContainerType(struct {
    header: LightClientHeader,
    current_sync_committee: SyncCommittee,
    current_sync_committee_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.CURRENT_SYNC_COMMITTEE_GINDEX), .{}),
});

pub const LightClientUpdate = ssz.VariableContainerType(struct {
    attested_header: LightClientHeader,
    next_sync_committee: SyncCommittee,
    next_sync_committee_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.NEXT_SYNC_COMMITTEE_GINDEX), .{}),
    finalized_header: LightClientHeader,
    finality_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.FINALIZED_ROOT_GINDEX), .{}),
    sync_aggregate: SyncAggregate,
    signature_slot: p.Slot,
});

pub const LightClientFinalityUpdate = ssz.VariableContainerType(struct {
    attested_header: LightClientHeader,
    finalized_header: LightClientHeader,
    finality_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.FINALIZED_ROOT_GINDEX), .{}),
    sync_aggregate: SyncAggregate,
    signature_slot: p.Slot,
});

pub const LightClientOptimisticUpdate = ssz.VariableContainerType(struct {
    attested_header: LightClientHeader,
    sync_aggregate: SyncAggregate,
    signature_slot: p.Slot,
});

pub const ExecutionPayload = ssz.VariableContainerType(struct {
    parent_hash: p.Bytes32,
    fee_recipient: p.Bytes20,
    state_root: p.Bytes32,
    receipts_root: p.Bytes32,
    logs_bloom: LogsBloom,
    prev_randao: p.Bytes32,
    block_number: p.Uint64,
    gas_limit: p.Uint64,
    gas_used: p.Uint64,
    timestamp: p.Uint64,
    extra_data: ExtraData,
    base_fee_per_gas: p.Uint256,
    block_hash: p.Bytes32,
    transactions: Transactions,
    withdrawals: Withdrawals,
    blob_gas_used: p.Uint64,
    excess_blob_gas: p.Uint64,
});

pub const ExecutionPayloadHeader = ssz.VariableContainerType(struct {
    parent_hash: p.Bytes32,
    fee_recipient: p.Bytes20,
    state_root: p.Bytes32,
    receipts_root: p.Bytes32,
    logs_bloom: LogsBloom,
    prev_randao: p.Bytes32,
    block_number: p.Uint64,
    gas_limit: p.Uint64,
    gas_used: p.Uint64,
    timestamp: p.Uint64,
    extra_data: ExtraData,
    base_fee_per_gas: p.Uint256,
    block_hash: p.Bytes32,
    transactions_root: p.Root,
    withdrawals_root: p.Root,
    blob_gas_used: p.Uint64,
    excess_blob_gas: p.Uint64,
});

pub const BlobKzgCommitments = ssz.FixedListType(p.KZGCommitment, preset.MAX_BLOB_COMMITMENTS_PER_BLOCK, .{});

pub const NewPayloadRequest = ssz.VariableContainerType(struct {
    execution_payload: ExecutionPayload,
    versioned_hashes: VersionedHashes,
    parent_beacon_block_root: p.Root,
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
    attester_slashings: ssz.VariableListType(AttesterSlashing, preset.MAX_ATTESTER_SLASHINGS),
    attestations: ssz.VariableListType(Attestation, preset.MAX_ATTESTATIONS),
    deposits: ssz.FixedListType(Deposit, preset.MAX_DEPOSITS, .{}),
    voluntary_exits: ssz.FixedListType(SignedVoluntaryExit, preset.MAX_VOLUNTARY_EXITS, .{}),
    sync_aggregate: SyncAggregate,
    execution_payload_header: ExecutionPayloadHeader,
    bls_to_execution_changes: ssz.FixedListType(SignedBLSToExecutionChange, preset.MAX_BLS_TO_EXECUTION_CHANGES, .{}),
    blob_kzg_commitments: ssz.FixedListType(p.KZGCommitment, preset.MAX_BLOB_COMMITMENTS_PER_BLOCK, .{}),
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
});

pub const SignedBeaconBlock = ssz.VariableContainerType(struct {
    message: BeaconBlock,
    signature: p.BLSSignature,
});
