const std = @import("std");
const ssz = @import("ssz");
const p = @import("primitive.zig");
const c = @import("constants");
const preset = @import("preset").preset;
const phase0 = @import("phase0.zig");

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

pub const SyncAggregate = ssz.FixedContainerType(struct {
    sync_committee_bits: ssz.BitVectorType(preset.SYNC_COMMITTEE_SIZE),
    sync_committee_signature: p.BLSSignature,
});

pub const SyncCommittee = ssz.FixedContainerType(struct {
    pubkeys: ssz.FixedVectorType(p.BLSPubkey, preset.SYNC_COMMITTEE_SIZE, .{}),
    aggregate_pubkey: p.BLSPubkey,
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
});

pub const BeaconBlock = ssz.VariableContainerType(struct {
    slot: p.Slot,
    proposer_index: p.ValidatorIndex,
    parent_root: p.Root,
    state_root: p.Root,
    body: BeaconBlockBody,
});

pub const InactivityScores = ssz.FixedListType(p.Uint64, preset.VALIDATOR_REGISTRY_LIMIT, .{ .chunked_leaf = true });
pub const EpochParticipation = ssz.FixedListType(p.Uint8, preset.VALIDATOR_REGISTRY_LIMIT, .{ .chunked_leaf = true });

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
    previous_epoch_participation: EpochParticipation,
    current_epoch_participation: EpochParticipation,
    justification_bits: phase0.JustificationBits,
    previous_justified_checkpoint: Checkpoint,
    current_justified_checkpoint: Checkpoint,
    finalized_checkpoint: Checkpoint,
    inactivity_scores: InactivityScores,
    current_sync_committee: SyncCommittee,
    next_sync_committee: SyncCommittee,
});

pub const SignedBeaconBlock = ssz.VariableContainerType(struct {
    message: BeaconBlock,
    signature: p.BLSSignature,
});

pub const SyncCommitteeMessage = ssz.FixedContainerType(struct {
    slot: p.Slot,
    beacon_block_root: p.Root,
    validator_index: p.ValidatorIndex,
    signature: p.BLSSignature,
});

pub const SyncCommitteeContribution = ssz.FixedContainerType(struct {
    slot: p.Slot,
    beacon_block_root: p.Root,
    subcommittee_index: p.Uint64,
    aggregation_bits: ssz.BitVectorType(preset.SYNC_COMMITTEE_SIZE / c.SYNC_COMMITTEE_SUBNET_COUNT),
    signature: p.BLSSignature,
});

pub const ContributionAndProof = ssz.FixedContainerType(struct {
    aggregator_index: p.ValidatorIndex,
    contribution: SyncCommitteeContribution,
    selection_proof: p.BLSSignature,
});

pub const SignedContributionAndProof = ssz.FixedContainerType(struct {
    message: ContributionAndProof,
    signature: p.BLSSignature,
});

pub const SyncAggregatorSelectionData = ssz.FixedContainerType(struct {
    slot: p.Slot,
    subcommittee_index: p.Uint64,
});

pub const LightClientHeader = ssz.FixedContainerType(struct {
    beacon: BeaconBlockHeader,
});

pub const LightClientBootstrap = ssz.FixedContainerType(struct {
    header: LightClientHeader,
    current_sync_committee: SyncCommittee,
    current_sync_committee_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.CURRENT_SYNC_COMMITTEE_GINDEX), .{}),
});

pub const LightClientUpdate = ssz.FixedContainerType(struct {
    attested_header: LightClientHeader,
    next_sync_committee: SyncCommittee,
    next_sync_committee_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.NEXT_SYNC_COMMITTEE_GINDEX), .{}),
    finalized_header: LightClientHeader,
    finality_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.FINALIZED_ROOT_GINDEX), .{}),
    sync_aggregate: SyncAggregate,
    signature_slot: p.Slot,
});

pub const LightClientFinalityUpdate = ssz.FixedContainerType(struct {
    attested_header: LightClientHeader,
    finalized_header: LightClientHeader,
    finality_branch: ssz.FixedVectorType(p.Bytes32, std.math.log2(c.FINALIZED_ROOT_GINDEX), .{}),
    sync_aggregate: SyncAggregate,
    signature_slot: p.Slot,
});

pub const LightClientOptimisticUpdate = ssz.FixedContainerType(struct {
    attested_header: LightClientHeader,
    sync_aggregate: SyncAggregate,
    signature_slot: p.Slot,
});
