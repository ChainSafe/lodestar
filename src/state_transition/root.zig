const std = @import("std");
const testing = std.testing;

pub const stateTransition = @import("state_transition.zig").stateTransition;
pub const processSlots = @import("state_transition.zig").processSlots;
pub const Diagnostics = @import("diagnostics").Diagnostics;
pub const TransitionOpts = @import("state_transition.zig").TransitionOpts;

pub const metrics = @import("metrics.zig");
pub const ValidatorMonitor = @import("ValidatorMonitor.zig");

pub const RefCount = @import("./utils/ref_count.zig").RefCount;
pub const computeSigningRoot = @import("./utils/signing_root.zig").computeSigningRoot;
pub const computeEpochAtSlot = @import("./utils/epoch.zig").computeEpochAtSlot;
pub const CachedBeaconState = @import("./cache/state_cache.zig").CachedBeaconState;
pub const EffectiveBalanceIncrements = @import("./cache/effective_balance_increments.zig").EffectiveBalanceIncrements;
pub const EffectiveBalanceIncrementsRc = @import("./cache/effective_balance_increments.zig").EffectiveBalanceIncrementsRc;
pub const buildSlashingsCacheFromStateIfNeeded = @import("./cache/slashings_cache.zig").buildFromStateIfNeeded;

pub const EpochCacheImmutableData = @import("./cache/epoch_cache.zig").EpochCacheImmutableData;
pub const EpochCache = @import("./cache/epoch_cache.zig").EpochCache;
pub const SyncCommitteeCache = @import("./cache/sync_committee_cache.zig").SyncCommitteeCache;

pub const committee_indices = @import("./utils/committee_indices.zig");
pub const PubkeyCache = @import("./cache/pubkey_cache.zig").PubkeyCache;
pub const pkix = @import("./cache/pkix.zig");
pub const signature_set_verifier = @import("./signature_sets/verifier.zig");

pub const EpochTransitionCache = @import("./cache/epoch_transition_cache.zig").EpochTransitionCache;
pub const validator_flat_cache = @import("./cache/validator_flat_cache.zig");
pub const processEpoch = @import("./epoch/process_epoch.zig").processEpoch;
pub const processJustificationAndFinalization = @import("./epoch/process_justification_and_finalization.zig").processJustificationAndFinalization;
pub const computeUnrealizedCheckpoints = @import("./utils/unrealized_checkpoints.zig").computeUnrealizedCheckpoints;
pub const UnrealizedCheckpoints = @import("./utils/unrealized_checkpoints.zig").UnrealizedCheckpoints;
pub const processInactivityUpdates = @import("./epoch/process_inactivity_updates.zig").processInactivityUpdates;
pub const processRegistryUpdates = @import("./epoch/process_registry_updates.zig").processRegistryUpdates;
pub const processSlashings = @import("./epoch/process_slashings.zig").processSlashings;
pub const processRewardsAndPenalties = @import("./epoch/process_rewards_and_penalties.zig").processRewardsAndPenalties;
pub const getRewardsAndPenalties = @import("./epoch/process_rewards_and_penalties.zig").getRewardsAndPenalties;
pub const ProposerRewards = @import("./cache/state_cache.zig").ProposerRewards;
pub const computeBlockRewards = @import("./rewards/block_rewards.zig").computeBlockRewards;
pub const computeBlockRewardsAny = @import("./rewards/block_rewards.zig").computeBlockRewardsAny;
pub const BlockRewards = @import("./rewards/block_rewards.zig").BlockRewards;
pub const SyncCommitteeReward = @import("./rewards/sync_committee_rewards.zig").SyncCommitteeReward;
pub const computeSyncCommitteeRewards = @import("./rewards/sync_committee_rewards.zig").computeSyncCommitteeRewards;
pub const AttestationsRewards = @import("./rewards/attestations_rewards.zig").AttestationsRewards;
pub const computeAttestationsRewards = @import("./rewards/attestations_rewards.zig").computeAttestationsRewards;
pub const processEth1DataReset = @import("./epoch/process_eth1_data_reset.zig").processEth1DataReset;
pub const processPendingDeposits = @import("./epoch/process_pending_deposits.zig").processPendingDeposits;
pub const processPendingConsolidations = @import("./epoch/process_pending_consolidations.zig").processPendingConsolidations;
pub const processEffectiveBalanceUpdates = @import("./epoch/process_effective_balance_updates.zig").processEffectiveBalanceUpdates;
pub const processSlashingsReset = @import("./epoch/process_slashings_reset.zig").processSlashingsReset;
pub const processRandaoMixesReset = @import("./epoch/process_randao_mixes_reset.zig").processRandaoMixesReset;
pub const processHistoricalSummariesUpdate = @import("./epoch/process_historical_summaries_update.zig").processHistoricalSummariesUpdate;
pub const processHistoricalRootsUpdate = @import("./epoch/process_historical_roots_update.zig").processHistoricalRootsUpdate;
pub const processParticipationRecordUpdates = @import("./epoch/process_participation_record_updates.zig").processParticipationRecordUpdates;
pub const processParticipationFlagUpdates = @import("./epoch/process_participation_flag_updates.zig").processParticipationFlagUpdates;
pub const processSyncCommitteeUpdates = @import("./epoch/process_sync_committee_updates.zig").processSyncCommitteeUpdates;
pub const getNextSyncCommitteeIndices = @import("./utils/sync_committee.zig").getNextSyncCommitteeIndices;

pub const upgradeStateToAltair = @import("./slot/upgrade_state_to_altair.zig").upgradeStateToAltair;
pub const upgradeStateToBellatrix = @import("./slot/upgrade_state_to_bellatrix.zig").upgradeStateToBellatrix;
pub const upgradeStateToCapella = @import("./slot/upgrade_state_to_capella.zig").upgradeStateToCapella;
pub const upgradeStateToDeneb = @import("./slot/upgrade_state_to_deneb.zig").upgradeStateToDeneb;
pub const upgradeStateToElectra = @import("./slot/upgrade_state_to_electra.zig").upgradeStateToElectra;
pub const upgradeStateToFulu = @import("./slot/upgrade_state_to_fulu.zig").upgradeStateToFulu;

// Block
pub const processBlockHeader = @import("./block/process_block_header.zig").processBlockHeader;
pub const processWithdrawals = @import("./block/process_withdrawals.zig").processWithdrawals;
pub const getExpectedWithdrawals = @import("./block/process_withdrawals.zig").getExpectedWithdrawals;
pub const processExecutionPayload = @import("./block/process_execution_payload.zig").processExecutionPayload;
pub const processRandao = @import("./block/process_randao.zig").processRandao;
pub const processEth1Data = @import("./block/process_eth1_data.zig").processEth1Data;
pub const processOperations = @import("./block/process_operations.zig").processOperations;
pub const processSyncAggregate = @import("./block/process_sync_committee.zig").processSyncAggregate;
pub const processBlobKzgCommitments = @import("./block/process_blob_kzg_commitments.zig").processBlobKzgCommitments;
pub const processBlock = @import("./block/process_block.zig").processBlock;
pub const processAttestations = @import("./block/process_attestations.zig").processAttestations;
pub const processAttesterSlashing = @import("./block/process_attester_slashing.zig").processAttesterSlashing;
pub const processDeposit = @import("./block/process_deposit.zig").processDeposit;
pub const processProposerSlashing = @import("./block/process_proposer_slashing.zig").processProposerSlashing;
pub const processVoluntaryExit = @import("./block/process_voluntary_exit.zig").processVoluntaryExit;
pub const isValidVoluntaryExit = @import("./block/process_voluntary_exit.zig").isValidVoluntaryExit;
pub const getVoluntaryExitValidity = @import("./block/process_voluntary_exit.zig").getVoluntaryExitValidity;
pub const VoluntaryExitValidity = @import("./block/process_voluntary_exit.zig").VoluntaryExitValidity;
pub const processBlsToExecutionChange = @import("./block/process_bls_to_execution_change.zig").processBlsToExecutionChange;
pub const processDepositRequest = @import("./block/process_deposit_request.zig").processDepositRequest;
pub const processWithdrawalRequest = @import("./block/process_withdrawal_request.zig").processWithdrawalRequest;
pub const processConsolidationRequest = @import("./block/process_consolidation_request.zig").processConsolidationRequest;

// utils
pub const validator_status = @import("./utils/validator_status.zig");
pub const ValidatorStatus = validator_status.ValidatorStatus;
pub const getValidatorStatus = validator_status.getValidatorStatus;
pub const getBlockRootAtSlot = @import("./utils/block_root.zig").getBlockRootAtSlot;
pub const computeSlotsSinceEpochStart = @import("./utils/epoch.zig").computeSlotsSinceEpochStart;
pub const computeStartSlotAtEpoch = @import("./utils/epoch.zig").computeStartSlotAtEpoch;
pub const AnchorCheckpoint = @import("./AnchorCheckpoint.zig");
pub const deinitReusedEpochTransitionCache = @import("./state_transition.zig").deinitReusedEpochTransitionCache;
pub const isExecutionEnabled = @import("./utils/execution.zig").isExecutionEnabled;
pub const isMergeTransitionComplete = @import("./utils/execution.zig").isMergeTransitionComplete;
pub const getRandaoMix = @import("./utils/seed.zig").getRandaoMix;
pub const getEffectiveBalanceIncrementsZeroInactive = @import("./utils/balance.zig").getEffectiveBalanceIncrementsZeroInactive;
pub const getStateSlotFromBytes = @import("ssz_bytes.zig").getStateSlotFromBytes;
pub const getLastProcessedSlotFromStateBytes = @import("ssz_bytes.zig").getLastProcessedSlotFromStateBytes;
pub const STATE_SLOTS_PREFIX_LEN = @import("ssz_bytes.zig").STATE_SLOTS_PREFIX_LEN;

pub const WithdrawalsResult = @import("./block/process_withdrawals.zig").WithdrawalsResult;

pub const test_utils = @import("test_utils/root.zig");

pub const bls = @import("utils/bls.zig");
const seed = @import("./utils/seed.zig");
pub const state_transition = @import("./state_transition.zig");
pub const BlockExternalData = state_transition.BlockExternalData;
pub const ExecutionPayloadStatus = state_transition.ExecutionPayloadStatus;
pub const DataAvailabilityStatus = state_transition.DataAvailabilityStatus;
pub const preset = @import("preset").preset;
const EpochShuffling = @import("./utils/epoch_shuffling.zig");
pub const calculateShufflingDecisionRoot = EpochShuffling.calculateShufflingDecisionRoot;
pub const processProposerLookahead = @import("./epoch/process_proposer_lookahead.zig").processProposerLookahead;
pub const startProposerLookaheadShuffling = @import("./epoch/process_proposer_lookahead.zig").startProposerLookaheadShuffling;

const load_state = @import("load_state.zig");
pub const loadState = load_state.loadState;
pub const MigrateStateOutput = load_state.MigrateStateOutput;

const sync_committees_witness = @import("./sync_committees_witness.zig");
pub const getSyncCommitteesWitness = sync_committees_witness.getSyncCommitteesWitness;
pub const SyncCommitteeWitness = sync_committees_witness.SyncCommitteeWitness;

const weak_subjectivity = @import("weak_subjectivity.zig");
pub const getLatestWeakSubjectivityCheckpointEpoch = weak_subjectivity.getLatestWeakSubjectivityCheckpointEpoch;

test {
    testing.refAllDecls(@This());
    testing.refAllDecls(seed);
    testing.refAllDecls(state_transition);
    testing.refAllDecls(EpochShuffling);
    testing.refAllDecls(load_state);
    testing.refAllDecls(sync_committees_witness);
    testing.refAllDecls(weak_subjectivity);
    testing.refAllDecls(@import("ssz_bytes.zig"));
}

pub const processExecutionPayloadBid = @import("block/process_execution_payload_bid.zig").processExecutionPayloadBid;
pub const processParentExecutionPayload = @import("block/process_parent_execution_payload.zig").processParentExecutionPayload;
pub const applyParentExecutionPayload = @import("block/process_parent_execution_payload.zig").applyParentExecutionPayload;
pub const processBuilderDepositRequest = @import("block/process_builder_deposit_request.zig").processBuilderDepositRequest;
pub const processBuilderExitRequest = @import("block/process_builder_exit_request.zig").processBuilderExitRequest;
pub const processPayloadAttestation = @import("block/process_payload_attestation.zig").processPayloadAttestation;
pub const processBuilderPendingPayments = @import("epoch/process_builder_pending_payments.zig").processBuilderPendingPayments;
pub const processPtcWindow = @import("epoch/process_ptc_window.zig").processPtcWindow;
pub const canBuilderCoverBid = @import("utils/gloas.zig").canBuilderCoverBid;
pub const getPayloadTimelinessCommittee = @import("utils/gloas.zig").getPayloadTimelinessCommittee;

pub const upgradeStateToGloas = @import("slot/upgrade_state_to_gloas.zig").upgradeStateToGloas;
