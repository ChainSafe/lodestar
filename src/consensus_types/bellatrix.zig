const ssz = @import("ssz");
const p = @import("primitive.zig");
const preset = @import("preset").preset;
const phase0 = @import("phase0.zig");
const altair = @import("altair.zig");

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

pub const SyncAggregate = altair.SyncAggregate;
pub const SyncCommittee = altair.SyncCommittee;
pub const SyncCommitteeMessage = altair.SyncCommitteeMessage;
pub const SyncCommitteeContribution = altair.SyncCommitteeContribution;
pub const ContributionAndProof = altair.ContributionAndProof;
pub const SignedContributionAndProof = altair.SignedContributionAndProof;
pub const SyncAggregatorSelectionData = altair.SyncAggregatorSelectionData;
pub const LightClientHeader = altair.LightClientHeader;
pub const LightClientBootstrap = altair.LightClientBootstrap;
pub const LightClientUpdate = altair.LightClientUpdate;
pub const LightClientFinalityUpdate = altair.LightClientFinalityUpdate;
pub const LightClientOptimisticUpdate = altair.LightClientOptimisticUpdate;

pub const LogsBloom = ssz.ByteVectorType(preset.BYTES_PER_LOGS_BLOOM);
pub const ExtraData = ssz.ByteListType(preset.MAX_EXTRA_DATA_BYTES);
pub const Transactions = ssz.VariableListType(ssz.ByteListType(preset.MAX_BYTES_PER_TRANSACTION), preset.MAX_TRANSACTIONS_PER_PAYLOAD);

pub const ExecutionPayload = ssz.VariableContainerType(struct {
    parent_hash: p.Bytes32,
    fee_recipient: p.ExecutionAddress,
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
});

pub const ExecutionPayloadHeader = ssz.VariableContainerType(struct {
    parent_hash: p.Bytes32,
    fee_recipient: p.ExecutionAddress,
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
});

pub const NewPayloadRequest = ssz.VariableContainerType(struct {
    execution_payload: ExecutionPayload,
});

pub const PowBlock = ssz.FixedContainerType(struct {
    block_hash: p.Bytes32,
    parent_hash: p.Bytes32,
    total_difficulty: p.Uint256,
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
});

pub const SignedBeaconBlock = ssz.VariableContainerType(struct {
    message: BeaconBlock,
    signature: p.BLSSignature,
});
