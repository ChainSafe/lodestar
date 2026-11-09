const std = @import("std");
const Allocator = std.mem.Allocator;
const preset = @import("preset").preset;
const GENESIS_EPOCH = @import("preset").GENESIS_EPOCH;
const types = @import("consensus_types");
const c = @import("constants");
const Epoch = types.primitive.Epoch.Type;
const Slot = types.primitive.Slot.Type;
const BLSSignature = types.primitive.BLSSignature.Type;
const SyncPeriod = types.primitive.SyncPeriod.Type;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const CommitteeIndex = types.primitive.CommitteeIndex.Type;
const BeaconConfig = @import("config").BeaconConfig;
const PubkeyCache = @import("./pubkey_cache.zig").PubkeyCache;
const EpochShuffling = @import("../utils//epoch_shuffling.zig").EpochShuffling;
const EpochShufflingRc = @import("../utils/epoch_shuffling.zig").EpochShufflingRc;
const EffectiveBalanceIncrementsRc = @import("./effective_balance_increments.zig").EffectiveBalanceIncrementsRc;
const EffectiveBalanceIncrements = @import("./effective_balance_increments.zig").EffectiveBalanceIncrements;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const CachedBeaconState = @import("../cache/state_cache.zig").CachedBeaconState;
const BeaconState = @import("fork_types").BeaconState;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const computePreviousEpoch = @import("../utils/epoch.zig").computePreviousEpoch;
const computeActivationExitEpoch = @import("../utils/epoch.zig").computeActivationExitEpoch;
const effectiveBalanceIncrementsInit = @import("./effective_balance_increments.zig").effectiveBalanceIncrementsInit;
const getTotalSlashingsByIncrement = @import("../epoch/process_slashings.zig").getTotalSlashingsByIncrement;
const computeEpochShuffling = @import("../utils/epoch_shuffling.zig").computeEpochShuffling;
const getSeed = @import("../utils/seed.zig").getSeed;
const computeProposers = @import("../utils/seed.zig").computeProposers;
const SyncCommitteeCacheRc = @import("./sync_committee_cache.zig").SyncCommitteeCacheRc;
const SyncCommitteeCacheAllForks = @import("./sync_committee_cache.zig").SyncCommitteeCache;
const computeSyncParticipantReward = @import("../utils/sync_committee.zig").computeSyncParticipantReward;
const computeBaseRewardPerIncrement = @import("../utils/sync_committee.zig").computeBaseRewardPerIncrement;
const computeSyncPeriodAtEpoch = @import("../utils/epoch.zig").computeSyncPeriodAtEpoch;
const isAggregatorFromCommitteeLength = @import("../utils/aggregator.zig").isAggregatorFromCommitteeLength;
const calculateShufflingDecisionRoot = @import("../utils/epoch_shuffling.zig").calculateShufflingDecisionRoot;

const sumTargetUnslashedBalanceIncrements = @import("../utils/target_unslashed_balance.zig").sumTargetUnslashedBalanceIncrements;

const isActiveValidator = @import("../utils/validator.zig").isActiveValidator;
const getChurnLimit = @import("../utils/validator.zig").getChurnLimit;
const getActivationChurnLimit = @import("../utils/validator.zig").getActivationChurnLimit;

const ForkSeq = @import("config").ForkSeq;
const ForkTypes = @import("fork_types").ForkTypes;

pub const EpochCacheImmutableData = struct {
    config: *const BeaconConfig,
    pubkey_cache: *PubkeyCache,
};

pub const EpochCacheOpts = struct {
    skip_sync_committee_cache: bool,
    skip_sync_pubkeys: bool,
};

const proposer_weight: f64 = @floatFromInt(c.PROPOSER_WEIGHT);
const weight_denominator: f64 = @floatFromInt(c.WEIGHT_DENOMINATOR);

pub const proposer_weight_factor: f64 = proposer_weight / (weight_denominator - proposer_weight);

pub const EpochCache = struct {
    allocator: Allocator,

    config: *const BeaconConfig,

    /// Application-wide pubkey cache; EpochCache does not own it.
    pubkey_cache: *PubkeyCache,

    proposers: [preset.SLOTS_PER_EPOCH]ValidatorIndex,

    proposers_prev_epoch: ?[preset.SLOTS_PER_EPOCH]ValidatorIndex,

    /// Deterministic Proposer Lookahead was introduced as part of Fulu,
    /// in [EIP-7917](https://eips.ethereum.org/EIPS/eip-7917).
    ///
    /// Thus, post-Fulu, this is populated from proposer lookahead, but
    /// is null pre-Fulu.
    proposers_next_epoch: ?[preset.SLOTS_PER_EPOCH]ValidatorIndex,

    /// Epoch decision roots to look up correct shuffling from the Shuffling Cache
    previous_decision_root: [32]u8,
    current_decision_root: [32]u8,
    next_decision_root: [32]u8,

    // EpochCache does not take ownership of EpochShuffling, it is shared across EpochCache instances
    previous_shuffling: *EpochShufflingRc,

    current_shuffling: *EpochShufflingRc,

    next_shuffling: *EpochShufflingRc,

    // EpochCache does not take ownership of EffectiveBalanceIncrements, it is shared across EpochCache instances
    effective_balance_increments: *EffectiveBalanceIncrementsRc,

    total_slashings_by_increment: u64,

    sync_participant_reward: u64,

    sync_proposer_reward: u64,

    base_reward_per_increment: u64,

    total_active_balance_increments: u64,

    churn_limit: u64,

    activation_churn_limit: u64,

    exit_queue_epoch: Epoch,

    exit_queue_churn: u64,

    current_target_unslashed_balance_increments: u64,

    previous_target_unslashed_balance_increments: u64,

    // EpochCache does not take ownership of SyncCommitteeCache, it is shared across EpochCache instances
    current_sync_committee_indexed: *SyncCommitteeCacheRc,

    next_sync_committee_indexed: *SyncCommitteeCacheRc,

    sync_period: SyncPeriod,

    epoch: Epoch,

    fn initEffectiveBalanceIncrementsRc(allocator: Allocator, validator_count: usize) !*EffectiveBalanceIncrementsRc {
        var effective_balance_increments = try effectiveBalanceIncrementsInit(allocator, validator_count);
        errdefer effective_balance_increments.deinit(allocator);

        return try EffectiveBalanceIncrementsRc.create(allocator, effective_balance_increments);
    }

    /// Takes ownership of `active_indices` on success; the caller retains ownership on failure.
    fn initEpochShufflingRc(
        allocator: Allocator,
        state: *AnyBeaconState,
        active_indices: []u32,
        epoch: Epoch,
    ) !*EpochShufflingRc {
        const rc = try allocator.create(EpochShufflingRc);
        errdefer allocator.destroy(rc);

        const epoch_shuffling = try computeEpochShuffling(allocator, state, active_indices, epoch);
        rc.init(allocator, epoch_shuffling);
        return rc;
    }

    fn initCurrentSyncCommitteeCacheRc(
        allocator: Allocator,
        state: *AnyBeaconState,
        pubkey_cache: *const PubkeyCache,
        io: std.Io,
        skip_sync_committee_cache: bool,
    ) !*SyncCommitteeCacheRc {
        var sync_committee_cache = blk: {
            if (skip_sync_committee_cache) break :blk SyncCommitteeCacheAllForks.initEmpty();
            var sync_committee_view = try state.currentSyncCommittee();
            var sync_committee: types.altair.SyncCommittee.Type = undefined;
            try sync_committee_view.toValue(allocator, &sync_committee);
            break :blk try SyncCommitteeCacheAllForks.initSyncCommittee(allocator, &sync_committee, pubkey_cache, io);
        };
        errdefer sync_committee_cache.deinit();

        return try SyncCommitteeCacheRc.create(allocator, sync_committee_cache);
    }

    fn initNextSyncCommitteeCacheRc(
        allocator: Allocator,
        state: *AnyBeaconState,
        pubkey_cache: *const PubkeyCache,
        io: std.Io,
        skip_sync_committee_cache: bool,
    ) !*SyncCommitteeCacheRc {
        var sync_committee_cache = blk: {
            if (skip_sync_committee_cache) break :blk SyncCommitteeCacheAllForks.initEmpty();
            var sync_committee_view = try state.nextSyncCommittee();
            var sync_committee: types.altair.SyncCommittee.Type = undefined;
            try sync_committee_view.toValue(allocator, &sync_committee);
            break :blk try SyncCommitteeCacheAllForks.initSyncCommittee(allocator, &sync_committee, pubkey_cache, io);
        };
        errdefer sync_committee_cache.deinit();

        return try SyncCommitteeCacheRc.create(allocator, sync_committee_cache);
    }

    /// Native index caches support at most maxInt(u32) validators, matching PubkeyCache.
    pub fn createFromState(
        allocator: Allocator,
        io: std.Io,
        state: *AnyBeaconState,
        immutable_data: EpochCacheImmutableData,
        option: ?EpochCacheOpts,
    ) !*EpochCache {
        const config = immutable_data.config;
        const pubkey_cache = immutable_data.pubkey_cache;

        const current_epoch = computeEpochAtSlot(try state.slot());
        const is_genesis = current_epoch == GENESIS_EPOCH;
        const previous_epoch = if (is_genesis) GENESIS_EPOCH else current_epoch - 1;
        const next_epoch = current_epoch + 1;

        var total_active_balance_increments: u64 = 0;
        var exit_queue_epoch = computeActivationExitEpoch(current_epoch);
        var exit_queue_churn: u64 = 0;

        const validator_count = try state.validatorsCount();
        if (validator_count > std.math.maxInt(u32)) return error.InvalidValidatorCount;

        const validators = try state.validatorsPtrSlice(allocator);
        defer allocator.free(validators);

        // Sync before computing the remaining caches: sync committee indexing
        // needs a fully populated pubkey cache.
        const skip_sync_pubkeys = if (option) |opt| opt.skip_sync_pubkeys else false;
        if (!skip_sync_pubkeys) {
            try pubkey_cache.syncPubkeys(io, validators);
        }

        const effective_balance_increments_rc = try initEffectiveBalanceIncrementsRc(allocator, validator_count);
        errdefer effective_balance_increments_rc.unref();

        const effective_balance_increments = effective_balance_increments_rc.get();
        const state_fork_seq = state.forkSeq();
        const total_slashings_by_increment = switch (state_fork_seq) {
            inline else => |f| try getTotalSlashingsByIncrement(f, state.castToFork(f)),
        };
        var previous_active_indices_array_list: std.ArrayList(u32) = .empty;
        errdefer previous_active_indices_array_list.deinit(allocator);
        try previous_active_indices_array_list.ensureTotalCapacity(allocator, validator_count);

        var current_active_indices_array_list: std.ArrayList(u32) = .empty;
        errdefer current_active_indices_array_list.deinit(allocator);
        try current_active_indices_array_list.ensureTotalCapacity(allocator, validator_count);

        var next_active_indices_array_list: std.ArrayList(u32) = .empty;
        errdefer next_active_indices_array_list.deinit(allocator);
        try next_active_indices_array_list.ensureTotalCapacity(allocator, validator_count);

        for (0..validator_count) |i| {
            const validator = validators[i];

            effective_balance_increments.items[i] = @intCast(@divFloor(validator.effective_balance, preset.EFFECTIVE_BALANCE_INCREMENT));

            if (isActiveValidator(validator, previous_epoch)) {
                try previous_active_indices_array_list.append(allocator, @intCast(i));
            }

            if (isActiveValidator(validator, current_epoch)) {
                try current_active_indices_array_list.append(allocator, @intCast(i));
                total_active_balance_increments += effective_balance_increments.items[i];
            }

            if (isActiveValidator(validator, next_epoch)) {
                try next_active_indices_array_list.append(allocator, @intCast(i));
            }

            const exit_epoch = validator.exit_epoch;
            if (exit_epoch != c.FAR_FUTURE_EPOCH) {
                if (exit_epoch > exit_queue_epoch) {
                    exit_queue_epoch = exit_epoch;
                    exit_queue_churn = 1;
                } else if (exit_epoch == exit_queue_epoch) {
                    exit_queue_churn += 1;
                }
            }
        }

        // Spec: `EFFECTIVE_BALANCE_INCREMENT` Gwei minimum to avoid divisions by zero
        // 1 = 1 unit of EFFECTIVE_BALANCE_INCREMENT
        if (total_active_balance_increments < 1) {
            total_active_balance_increments = 1;
        }

        const previous_shuffling_rc = blk: {
            const active_indices = try previous_active_indices_array_list.toOwnedSlice(allocator);
            errdefer allocator.free(active_indices);

            break :blk try initEpochShufflingRc(allocator, state, active_indices, previous_epoch);
        };
        errdefer previous_shuffling_rc.unref();

        const current_shuffling_rc = blk: {
            const active_indices = try current_active_indices_array_list.toOwnedSlice(allocator);
            errdefer allocator.free(active_indices);

            break :blk try initEpochShufflingRc(allocator, state, active_indices, current_epoch);
        };
        errdefer current_shuffling_rc.unref();

        const next_shuffling_rc = blk: {
            const active_indices = try next_active_indices_array_list.toOwnedSlice(allocator);
            errdefer allocator.free(active_indices);

            break :blk try initEpochShufflingRc(allocator, state, active_indices, next_epoch);
        };
        errdefer next_shuffling_rc.unref();

        const fork_seq = config.forkSeqAtEpoch(current_epoch);
        var proposers = [_]ValidatorIndex{0} ** preset.SLOTS_PER_EPOCH;
        var next_proposers: ?[preset.SLOTS_PER_EPOCH]ValidatorIndex = null;

        // Post-Fulu (EIP-7917): proposer_lookahead is the source of truth for proposers.
        // Both current and next epoch proposers are read from it directly.
        if (fork_seq.gte(.fulu)) {
            switch (fork_seq) {
                inline else => |f| {
                    var proposer_lookahead = try state.castToFork(f).proposerLookahead();
                    next_proposers = undefined;
                    for (0..preset.SLOTS_PER_EPOCH) |i| {
                        proposers[i] = @intCast(try proposer_lookahead.get(i));
                        next_proposers.?[i] = @intCast(try proposer_lookahead.get(preset.SLOTS_PER_EPOCH + i));
                    }
                },
            }
        }
        // Pre-Fulu: compute current and next epoch proposers
        else {
            if (current_shuffling_rc.get().active_indices.len > 0) {
                var current_proposer_seed: [32]u8 = undefined;
                switch (state.forkSeq()) {
                    inline else => |f| try getSeed(f, state.castToFork(f), current_epoch, c.DOMAIN_BEACON_PROPOSER, &current_proposer_seed),
                }
                switch (fork_seq) {
                    inline else => |f| try computeProposers(
                        f,
                        allocator,
                        current_proposer_seed,
                        current_epoch,
                        current_shuffling_rc.get().active_indices,
                        effective_balance_increments,
                        &proposers,
                    ),
                }
            }
            if (next_shuffling_rc.get().active_indices.len > 0) {
                var next_proposer_seed: [32]u8 = undefined;
                switch (state.forkSeq()) {
                    inline else => |f| try getSeed(
                        f,
                        state.castToFork(f),
                        next_epoch,
                        c.DOMAIN_BEACON_PROPOSER,
                        &next_proposer_seed,
                    ),
                }
                next_proposers = undefined;
                const next_fork_seq = config.forkSeqAtEpoch(next_epoch);
                switch (next_fork_seq) {
                    inline else => |f| try computeProposers(
                        f,
                        allocator,
                        next_proposer_seed,
                        next_epoch,
                        next_shuffling_rc.get().active_indices,
                        effective_balance_increments,
                        &next_proposers.?,
                    ),
                }
            }
        }

        // Only after altair, compute the indices of the current sync committee
        const after_altair_fork = current_epoch >= config.chain.ALTAIR_FORK_EPOCH;

        // Values syncParticipantReward, syncProposerReward, baseRewardPerIncrement are only used after altair.
        // However, since they are very cheap to compute they are computed always to simplify upgradeState function.
        const sync_participant_reward = computeSyncParticipantReward(total_active_balance_increments);
        const sync_participant_reward_f64: f64 = @floatFromInt(sync_participant_reward);
        const sync_proposer_reward: u64 = @intFromFloat(std.math.floor(sync_participant_reward_f64 * proposer_weight_factor));
        const base_reward_pre_increment = computeBaseRewardPerIncrement(total_active_balance_increments);
        const skip_sync_committee_cache = if (option) |opt| opt.skip_sync_committee_cache else !after_altair_fork;
        const current_sync_committee_indexed = try initCurrentSyncCommitteeCacheRc(
            allocator,
            state,
            pubkey_cache,
            io,
            skip_sync_committee_cache,
        );
        errdefer current_sync_committee_indexed.unref();

        const next_sync_committee_indexed = try initNextSyncCommitteeCacheRc(
            allocator,
            state,
            pubkey_cache,
            io,
            skip_sync_committee_cache,
        );
        errdefer next_sync_committee_indexed.unref();

        // Precompute churnLimit for efficient initiateValidatorExit() during block proposing MUST be recompute everytime the
        // active validator indices set changes in size. Validators change active status only when:
        // - validator.activation_epoch is set. Only changes in process_registry_updates() if validator can be activated. If
        //   the value changes it will be set to `epoch + 1 + MAX_SEED_LOOKAHEAD`.
        // - validator.exit_epoch is set. Only changes in initiate_validator_exit() if validator exits. If the value changes,
        //   it will be set to at least `epoch + 1 + MAX_SEED_LOOKAHEAD`.
        // ```
        // is_active_validator = validator.activation_epoch <= epoch < validator.exit_epoch
        // ```
        // So the returned value of is_active_validator(epoch) is guaranteed to not change during `MAX_SEED_LOOKAHEAD` epochs.
        //
        // activeIndices size is dependent on the state epoch. The epoch is advanced after running the epoch transition, and
        // the first block of the epoch process_block() call. So churnLimit must be computed at the end of the before epoch
        // transition and the result is valid until the end of the next epoch transition
        const churn_limit = getChurnLimit(config, current_shuffling_rc.get().active_indices.len);
        const activation_churn_limit = getActivationChurnLimit(config, fork_seq, current_shuffling_rc.get().active_indices.len);

        if (exit_queue_churn >= churn_limit) {
            exit_queue_epoch += 1;
            exit_queue_churn = 0;
        }

        // TODO: describe issue. Compute progressive target balances
        // Compute balances from zero, note this state could be mid-epoch so target balances != 0
        var previous_target_unslashed_balance_increments: u64 = 0;
        var current_target_unslashed_balance_increments: u64 = 0;

        if (fork_seq.gte(.altair)) {
            var previous_epoch_participation_view = try state.previousEpochParticipation();
            const previous_epoch_participation = try previous_epoch_participation_view.getAll(allocator);
            defer allocator.free(previous_epoch_participation);

            var current_epoch_participation_view = try state.currentEpochParticipation();
            const current_epoch_participation = try current_epoch_participation_view.getAll(allocator);
            defer allocator.free(current_epoch_participation);

            previous_target_unslashed_balance_increments = sumTargetUnslashedBalanceIncrements(previous_epoch_participation, previous_epoch, validators);
            current_target_unslashed_balance_increments = sumTargetUnslashedBalanceIncrements(current_epoch_participation, current_epoch, validators);
        }

        // Calculate decision roots for shuffling cache lookups
        const previous_decision_root = try calculateShufflingDecisionRoot(state, previous_epoch);
        const current_decision_root = try calculateShufflingDecisionRoot(state, current_epoch);
        const next_decision_root = try calculateShufflingDecisionRoot(state, next_epoch);

        const epoch_cache_ptr = try allocator.create(EpochCache);
        errdefer allocator.destroy(epoch_cache_ptr);

        epoch_cache_ptr.* = .{
            .allocator = allocator,
            .config = config,
            .pubkey_cache = pubkey_cache,
            .proposers = proposers,
            // On first epoch, set to null to prevent unnecessary work since this is only used for metrics
            .proposers_prev_epoch = null,
            .proposers_next_epoch = next_proposers,
            .previous_decision_root = previous_decision_root,
            .current_decision_root = current_decision_root,
            .next_decision_root = next_decision_root,
            .previous_shuffling = previous_shuffling_rc,
            .current_shuffling = current_shuffling_rc,
            .next_shuffling = next_shuffling_rc,
            .effective_balance_increments = effective_balance_increments_rc,
            .total_slashings_by_increment = total_slashings_by_increment,
            .sync_participant_reward = sync_participant_reward,
            .sync_proposer_reward = sync_proposer_reward,
            .base_reward_per_increment = base_reward_pre_increment,
            .total_active_balance_increments = total_active_balance_increments,
            .churn_limit = churn_limit,
            .activation_churn_limit = activation_churn_limit,
            .exit_queue_epoch = exit_queue_epoch,
            .exit_queue_churn = exit_queue_churn,
            .current_target_unslashed_balance_increments = current_target_unslashed_balance_increments,
            .previous_target_unslashed_balance_increments = previous_target_unslashed_balance_increments,
            .current_sync_committee_indexed = current_sync_committee_indexed,
            .next_sync_committee_indexed = next_sync_committee_indexed,
            .sync_period = computeSyncPeriodAtEpoch(current_epoch),
            .epoch = current_epoch,
        };

        return epoch_cache_ptr;
    }

    pub fn deinit(self: *EpochCache) void {
        // EpochCache does not own the application-wide pubkey cache.

        // unref the epoch shufflings
        self.previous_shuffling.unref();
        self.current_shuffling.unref();
        self.next_shuffling.unref();

        // unref the effective balance increments
        self.effective_balance_increments.unref();

        // unref the sync committee caches
        self.current_sync_committee_indexed.unref();
        self.next_sync_committee_indexed.unref();
        self.allocator.destroy(self);
    }

    pub fn clone(self: *const EpochCache, allocator: Allocator) !*EpochCache {
        const epoch_cache_ptr = try allocator.create(EpochCache);

        epoch_cache_ptr.* = .{
            .allocator = allocator,
            .config = self.config,
            // Common append-only structures shared with all states, no need to clone
            .pubkey_cache = self.pubkey_cache,
            // Immutable data
            .proposers = self.proposers,
            .proposers_prev_epoch = self.proposers_prev_epoch,
            .proposers_next_epoch = self.proposers_next_epoch,
            .previous_decision_root = self.previous_decision_root,
            .current_decision_root = self.current_decision_root,
            .next_decision_root = self.next_decision_root,
            // reuse the same instances, increase reference count
            .previous_shuffling = self.previous_shuffling.ref(),
            .current_shuffling = self.current_shuffling.ref(),
            .next_shuffling = self.next_shuffling.ref(),
            // reuse the same instances, increase reference count, cloned only when necessary before an epoch transition
            .effective_balance_increments = self.effective_balance_increments.ref(),
            .total_slashings_by_increment = self.total_slashings_by_increment,
            // Basic types (numbers) cloned implicitly
            .sync_participant_reward = self.sync_participant_reward,
            .sync_proposer_reward = self.sync_proposer_reward,
            .base_reward_per_increment = self.base_reward_per_increment,
            .total_active_balance_increments = self.total_active_balance_increments,
            .churn_limit = self.churn_limit,
            .activation_churn_limit = self.activation_churn_limit,
            .exit_queue_epoch = self.exit_queue_epoch,
            .exit_queue_churn = self.exit_queue_churn,
            .current_target_unslashed_balance_increments = self.current_target_unslashed_balance_increments,
            .previous_target_unslashed_balance_increments = self.previous_target_unslashed_balance_increments,
            // reuse the same instances, increase reference count
            .current_sync_committee_indexed = self.current_sync_committee_indexed.ref(),
            .next_sync_committee_indexed = self.next_sync_committee_indexed.ref(),
            .sync_period = self.sync_period,
            .epoch = self.epoch,
        };

        return epoch_cache_ptr;
    }

    /// Utility method to return EpochShuffling so that consumers don't have to deal with ".get()" call
    /// Consumers borrow value, so they must not either modify or deinit it.
    /// TODO: @spiral-ladder prefer `self.previous_shuffling.get()` pattern instead, same to below
    pub fn getPreviousShuffling(self: *const EpochCache) *const EpochShuffling {
        return self.previous_shuffling.get();
    }

    /// Utility method to return EpochShuffling so that consumers don't have to deal with ".get()" call
    /// Consumers borrow value, so they must not either modify or deinit it.
    pub fn getCurrentShuffling(self: *const EpochCache) *const EpochShuffling {
        return self.current_shuffling.get();
    }

    /// Utility method to return EpochShuffling so that consumers don't have to deal with ".get()" call
    /// Consumers borrow value, so they must not either modify or deinit it.
    pub fn getNextEpochShuffling(self: *const EpochCache) *const EpochShuffling {
        return self.next_shuffling.get();
    }

    /// Utility method to return SyncCommitteeCache so that consumers don't have to deal with ".get()" call
    pub fn getEffectiveBalanceIncrements(self: *const EpochCache) EffectiveBalanceIncrements {
        return self.effective_balance_increments.get();
    }

    pub fn afterProcessEpoch(self: *EpochCache, state: *AnyBeaconState, epoch_transition_cache: *const EpochTransitionCache) !void {
        const upcoming_epoch = self.epoch + 1;
        const epoch_after_upcoming = upcoming_epoch + 1;
        const slot = try state.slot();

        const next_shuffling_rc = if (epoch_transition_cache.next_shuffling) |next_shuffling| blk: {
            break :blk next_shuffling.ref();
        } else blk: {
            const next_shuffling_active_indices = try self.allocator.alloc(u32, epoch_transition_cache.next_shuffling_active_indices.len);
            errdefer self.allocator.free(next_shuffling_active_indices);

            std.mem.copyForwards(u32, next_shuffling_active_indices, epoch_transition_cache.next_shuffling_active_indices);

            break :blk try initEpochShufflingRc(
                self.allocator,
                state,
                next_shuffling_active_indices,
                epoch_after_upcoming,
            );
        };
        errdefer next_shuffling_rc.unref();

        const next_decision_root = try calculateShufflingDecisionRoot(state, epoch_after_upcoming);

        self.previous_shuffling.unref();
        self.previous_shuffling = self.current_shuffling;
        self.previous_decision_root = self.current_decision_root;

        self.current_shuffling = self.next_shuffling;
        self.current_decision_root = self.next_decision_root;

        self.next_shuffling = next_shuffling_rc;
        self.next_decision_root = next_decision_root;

        self.churn_limit = getChurnLimit(self.config, self.current_shuffling.get().active_indices.len);
        self.activation_churn_limit = getActivationChurnLimit(self.config, self.config.forkSeq(slot), self.current_shuffling.get().active_indices.len);

        const exit_queue_epoch = computeActivationExitEpoch(upcoming_epoch);
        if (exit_queue_epoch > self.exit_queue_epoch) {
            self.exit_queue_epoch = exit_queue_epoch;
            self.exit_queue_churn = 0;
        }

        self.total_active_balance_increments = epoch_transition_cache.next_epoch_total_active_balance_by_increment;
        if (upcoming_epoch >= self.config.chain.ALTAIR_FORK_EPOCH) {
            self.sync_participant_reward = computeSyncParticipantReward(self.total_active_balance_increments);
            const sync_participant_reward_f64: f64 = @floatFromInt(self.sync_participant_reward);
            self.sync_proposer_reward = @intFromFloat(std.math.floor(sync_participant_reward_f64 * proposer_weight_factor));
            self.base_reward_per_increment = computeBaseRewardPerIncrement(self.total_active_balance_increments);
        }

        self.previous_target_unslashed_balance_increments = self.current_target_unslashed_balance_increments;
        self.current_target_unslashed_balance_increments = 0;
        self.epoch = computeEpochAtSlot(slot);
        self.sync_period = computeSyncPeriodAtEpoch(self.epoch);
    }

    /// At fork boundary, this runs post-fork logic and after `upgradeState*`.
    pub fn finalProcessEpoch(self: *EpochCache, state: *AnyBeaconState) !void {
        self.proposers_prev_epoch = self.proposers;
        switch (state.forkSeq()) {
            inline else => |fork| {
                const fork_state = state.castToFork(fork);
                if (comptime fork.gte(.fulu)) {
                    // Post-Fulu, EIP-7917 introduced the `proposer_lookahead`
                    // field which we already processed in `processProposerLookahead`.
                    // Proposers are to be computed pre-fulu to be cached within `self`.
                    var proposer_lookahead = try fork_state.proposerLookahead();
                    self.proposers_next_epoch = undefined;
                    for (0..preset.SLOTS_PER_EPOCH) |i| {
                        self.proposers[i] = @intCast(try proposer_lookahead.get(i));
                        self.proposers_next_epoch.?[i] = @intCast(try proposer_lookahead.get(preset.SLOTS_PER_EPOCH + i));
                    }
                } else {
                    var upcoming_proposer_seed: [32]u8 = undefined;
                    try getSeed(
                        fork,
                        fork_state,
                        self.epoch,
                        c.DOMAIN_BEACON_PROPOSER,
                        &upcoming_proposer_seed,
                    );
                    try computeProposers(
                        fork,
                        self.allocator,
                        upcoming_proposer_seed,
                        self.epoch,
                        self.current_shuffling.get().active_indices,
                        self.effective_balance_increments.get(),
                        &self.proposers,
                    );
                    const next_epoch_indices = self.next_shuffling.get().active_indices;
                    if (next_epoch_indices.len > 0) {
                        var next_proposer_seed: [32]u8 = undefined;
                        try getSeed(fork, fork_state, self.epoch + 1, c.DOMAIN_BEACON_PROPOSER, &next_proposer_seed);
                        self.proposers_next_epoch = undefined;
                        const next_fork_seq = self.config.forkSeqAtEpoch(self.epoch + 1);
                        switch (next_fork_seq) {
                            inline else => |f| try computeProposers(
                                f,
                                self.allocator,
                                next_proposer_seed,
                                self.epoch + 1,
                                next_epoch_indices,
                                self.effective_balance_increments.get(),
                                &self.proposers_next_epoch.?,
                            ),
                        }
                    } else {
                        self.proposers_next_epoch = null;
                    }
                }
            },
        }
    }

    pub fn beforeEpochTransition(self: *EpochCache) !void {
        var effective_balance_increments = try self.effective_balance_increments.get().clone(self.allocator);
        errdefer effective_balance_increments.deinit(self.allocator);

        const new_rc = try EffectiveBalanceIncrementsRc.create(self.allocator, effective_balance_increments);

        self.effective_balance_increments.unref();
        self.effective_balance_increments = new_rc;
    }

    /// Consumer borrows the returned slice
    pub fn getBeaconCommittee(self: *const EpochCache, slot: Slot, index: CommitteeIndex) ![]const u32 {
        const shuffling = self.getShufflingAtSlotOrNull(slot) orelse return error.EpochShufflingNotFound;
        const slot_committees = shuffling.committees[slot % preset.SLOTS_PER_EPOCH];
        if (index >= slot_committees.len) {
            return error.CommitteeIndexOutOfBounds;
        }
        return slot_committees[index];
    }

    pub fn getCommitteeCountPerSlot(self: *const EpochCache, epoch: Epoch) !usize {
        if (self.getShufflingAtEpochOrNull(epoch)) |s| return s.committees_per_slot;

        return error.EpochShufflingNotFound;
    }

    pub fn computeSubnetForSlot(self: *const EpochCache, slot: Slot, committee_index: CommitteeIndex) !u8 {
        const slots_since_epoch_start = slot % preset.SLOTS_PER_EPOCH;
        const committees_per_slot = try self.getCommitteeCountPerSlot(computeEpochAtSlot(slot));
        const committees_since_epoch_start = committees_per_slot * slots_since_epoch_start;
        return @intCast((committees_since_epoch_start + committee_index) % c.ATTESTATION_SUBNET_COUNT);
    }

    /// Gets the beacon proposer for a slot.
    ///
    /// Slot should be either part of the current or next epoch.
    pub fn getBeaconProposer(self: *const EpochCache, slot: Slot) !ValidatorIndex {
        const epoch = computeEpochAtSlot(slot);
        if (epoch == self.epoch)
            return self.proposers[slot % preset.SLOTS_PER_EPOCH];
        if (epoch == self.epoch + 1) {
            if (self.proposers_next_epoch) |next_proposers|
                return next_proposers[slot % preset.SLOTS_PER_EPOCH];

            // if this is somehow empty at epoch + 1, we return a
            // less ambiguous error.
            return error.NullNextProposersPreFulu;
        }

        return error.EpochTooFar;
    }

    /// Consumer takes ownership of the returned indexed attestation and must deinit
    /// its `attesting_indices` with `allocator`.
    pub fn computeIndexedAttestationPhase0(self: *const EpochCache, allocator: Allocator, attestation: *const types.phase0.Attestation.Type, out: *types.phase0.IndexedAttestation.Type) !void {
        const attesting_indices = try self.getAttestingIndicesPhase0(allocator, attestation);
        const sort_fn = struct {
            pub fn sort(_: void, a: ValidatorIndex, b: ValidatorIndex) bool {
                return a < b;
            }
        }.sort;
        std.mem.sort(ValidatorIndex, attesting_indices.items, {}, sort_fn);

        out.attesting_indices = attesting_indices;
        out.data = attestation.data;
        out.signature = attestation.signature;
        out.* = .{
            .attesting_indices = attesting_indices,
            .data = attestation.data,
            .signature = attestation.signature,
        };
    }

    /// Consumer takes ownership of the returned indexed attestation and must deinit
    /// its `attesting_indices` with `allocator`.
    pub fn computeIndexedAttestationElectra(self: *const EpochCache, allocator: Allocator, attestation: *const types.electra.Attestation.Type, out: *types.electra.IndexedAttestation.Type) !void {
        const attesting_indices = try self.getAttestingIndicesElectra(allocator, attestation);
        const sort_fn = struct {
            pub fn sort(_: void, a: ValidatorIndex, b: ValidatorIndex) bool {
                return a < b;
            }
        }.sort;
        std.mem.sort(ValidatorIndex, attesting_indices.items, {}, sort_fn);

        out.attesting_indices = attesting_indices;
        out.data = attestation.data;
        out.signature = attestation.signature;
        out.* = .{
            .attesting_indices = attesting_indices,
            .data = attestation.data,
            .signature = attestation.signature,
        };
    }

    pub fn getAttestingIndices(
        self: *const EpochCache,
        comptime fork: ForkSeq,
        allocator: Allocator,
        attestation: *const ForkTypes(fork).Attestation.Type,
    ) !std.ArrayList(ValidatorIndex) {
        return if (comptime fork.lt(.electra))
            self.getAttestingIndicesPhase0(allocator, attestation)
        else
            self.getAttestingIndicesPostElectra(fork, allocator, attestation);
    }

    /// Consumer takes ownership of the returned array and must free it with `allocator`.
    pub fn getAttestingIndicesPhase0(self: *const EpochCache, allocator: Allocator, attestation: *const types.phase0.Attestation.Type) !std.ArrayList(ValidatorIndex) {
        const aggregation_bits = attestation.aggregation_bits;
        const data = attestation.data;
        const validator_indices = try self.getBeaconCommittee(data.slot, data.index);
        return try aggregation_bits.intersectValues(ValidatorIndex, u32, allocator, validator_indices);
    }

    /// Consumer takes ownership of the returned array and must free it with `allocator`.
    pub fn getAttestingIndicesElectra(self: *const EpochCache, allocator: Allocator, attestation: *const types.electra.Attestation.Type) !std.ArrayList(ValidatorIndex) {
        return self.getAttestingIndicesPostElectra(.electra, allocator, attestation);
    }

    pub fn getAttestingIndicesPostElectra(self: *const EpochCache, comptime fork: ForkSeq, allocator: Allocator, attestation: *const ForkTypes(fork).Attestation.Type) !std.ArrayList(ValidatorIndex) {
        const aggregation_bits = attestation.aggregation_bits;
        const committee_bits = attestation.committee_bits;
        const data = attestation.data;

        // There is a naming conflict on the term `committeeIndices`
        // In Lodestar it usually means a list of validator indices of participants in a committee
        // In the spec it means a list of committee indices according to committeeBits
        // This `committeeIndices` refers to the latter
        // TODO Electra: resolve the naming conflicts
        var committee_indices_buffer: [preset.MAX_COMMITTEES_PER_SLOT]usize = undefined;
        const committee_indices_len = try committee_bits.getTrueBitIndexes(committee_indices_buffer[0..]);
        const committee_indices = committee_indices_buffer[0..committee_indices_len];

        var total_len: usize = 0;
        for (committee_indices) |committee_index| {
            const committee = try self.getBeaconCommittee(data.slot, committee_index);
            total_len += committee.len;
        }

        var committee_validators = try allocator.alloc(ValidatorIndex, total_len);
        defer allocator.free(committee_validators);

        var offset: usize = 0;
        for (committee_indices) |committee_index| {
            const committee = try self.getBeaconCommittee(data.slot, committee_index);
            for (committee, committee_validators[offset..][0..committee.len]) |index, *dest| dest.* = index;
            offset += committee.len;
        }

        return try aggregation_bits.intersectValues(ValidatorIndex, ValidatorIndex, allocator, committee_validators);
    }

    // TODO: getCommitteeAssignments

    // TODO: getCommitteeAssignment

    pub fn isAggregator(self: *const EpochCache, slot: Slot, index: CommitteeIndex, slot_signature: BLSSignature) !bool {
        const committee = try self.getBeaconCommittee(slot, index);
        return isAggregatorFromCommitteeLength(committee.length, slot_signature);
    }

    pub fn getShufflingAtSlotOrNull(self: *const EpochCache, slot: Slot) ?*const EpochShuffling {
        const epoch = computeEpochAtSlot(slot);
        return self.getShufflingAtEpochOrNull(epoch);
    }

    pub fn getShufflingAtEpochOrNull(self: *const EpochCache, epoch: Epoch) ?*const EpochShuffling {
        const previous_epoch = computePreviousEpoch(self.epoch);
        const shuffling = if (epoch == previous_epoch)
            self.getPreviousShuffling()
        else if (epoch == self.epoch) self.getCurrentShuffling() else if (epoch == self.epoch + 1)
            self.getNextEpochShuffling()
        else
            null;

        return shuffling;
    }

    /// Returns the active validator indices for the given epoch from the cached shuffling.
    /// Returns null if the epoch is not covered by the cached shufflings.
    pub fn getActiveIndicesAtEpoch(self: *const EpochCache, epoch: Epoch) ?[]const u32 {
        const shuffling = self.getShufflingAtEpochOrNull(epoch) orelse return null;
        return shuffling.active_indices;
    }

    /// Note: The range of slots a validator has to perform duties is off by one.
    /// The previous slot wording means that if your validator is in a sync committee for a period that runs from slot
    /// 100 to 200,then you would actually produce signatures in slot 99 - 199.
    pub fn getIndexedSyncCommittee(self: *const EpochCache, slot: Slot) !SyncCommitteeCacheAllForks {
        // See note above for the +1 offset
        return self.getIndexedSyncCommitteeAtEpoch(computeEpochAtSlot(slot + 1));
    }

    pub fn getIndexedSyncCommitteeAtEpoch(self: *const EpochCache, epoch: Epoch) !SyncCommitteeCacheAllForks {
        const sync_period = computeSyncPeriodAtEpoch(epoch);
        if (sync_period == self.sync_period) {
            return self.current_sync_committee_indexed.get();
        } else if (sync_period == self.sync_period + 1) {
            return self.next_sync_committee_indexed.get();
        } else {
            return error.SyncCommitteeNotFound;
        }
    }

    pub fn rotateSyncCommitteeIndexed(self: *EpochCache, next_sync_committee_indices: []const ValidatorIndex) !void {
        var next_sync_committee_indexed = try SyncCommitteeCacheAllForks.initValidatorIndices(self.allocator, next_sync_committee_indices);
        errdefer next_sync_committee_indexed.deinit();

        const next_sync_committee_indexed_rc = try SyncCommitteeCacheRc.create(self.allocator, next_sync_committee_indexed);

        // unref the old instance
        self.current_sync_committee_indexed.unref();
        // this is the transfer of reference count
        // should not do an unref() then ref() here as it may trigger a deinit()
        self.current_sync_committee_indexed = self.next_sync_committee_indexed;
        self.next_sync_committee_indexed = next_sync_committee_indexed_rc;
    }

    /// this is used at fork boundary from phase0 to altair
    pub fn setSyncCommitteesIndexed(self: *EpochCache, next_sync_committee_indices: []const ValidatorIndex) !void {
        // both current and next sync committee are set to the same value at fork boundary
        const next_sync_committee_indexed_rc = blk: {
            var next_sync_committee_indexed = try SyncCommitteeCacheAllForks.initValidatorIndices(self.allocator, next_sync_committee_indices);
            errdefer next_sync_committee_indexed.deinit();

            break :blk try SyncCommitteeCacheRc.create(self.allocator, next_sync_committee_indexed);
        };
        errdefer next_sync_committee_indexed_rc.unref();

        const current_sync_committee_indexed_rc = blk: {
            var current_sync_committee_indexed = try SyncCommitteeCacheAllForks.initValidatorIndices(self.allocator, next_sync_committee_indices);
            errdefer current_sync_committee_indexed.deinit();

            break :blk try SyncCommitteeCacheRc.create(self.allocator, current_sync_committee_indexed);
        };

        self.next_sync_committee_indexed.unref();
        self.next_sync_committee_indexed = next_sync_committee_indexed_rc;
        self.current_sync_committee_indexed.unref();
        self.current_sync_committee_indexed = current_sync_committee_indexed_rc;
    }

    /// Append an `effective_balance`, extending the arraylist if necessary
    /// and detach it when shared.
    ///
    /// We directly write to indices (without extending the arraylist) in two places:
    /// 1) process_effective_balance_updates.zig
    /// 2) upgrade_state_to_electra.zig
    ///
    /// These calls never grow the arraylist, which makes direct writes safe.
    ///
    /// SAFETY: `index` must equal the current effective-balance-increments length.
    pub fn effectiveBalanceIncrementsAppend(
        self: *EpochCache,
        index: usize,
        effective_balance: u64,
    ) !void {
        const old = self.effective_balance_increments.get();
        std.debug.assert(index == old.items.len);

        grow: {
            if (index < old.capacity) {
                // Fast path: allow `self.effective_balance_increments` to grow
                // in-place while this is the only reference.
                // Avoids up to `preset.MAX_PENDING_DEPOSITS_PER_EPOCH`
                // full-array copies of `effective_balance_increments`
                // (which is a function of validator count) every epoch.
                //
                // NOTE: We run `beforeEpochTransition()` before this,
                // which guarantees a ref count of 1 since we init a new
                // rc prior to processing pending deposits.
                if (self.effective_balance_increments.getMutIfUnique()) |increments| {
                    increments.items.len = index + 1;
                    @memset(increments.items[old.items.len..], 0);
                    break :grow;
                }
            }

            const new_len = index + 1;
            const capacity = 1024 * @divFloor(new_len + 1024, 1024);

            var new_increments = try EffectiveBalanceIncrements.initCapacity(self.allocator, capacity);
            errdefer new_increments.deinit(self.allocator);

            try new_increments.resize(self.allocator, new_len);
            @memcpy(new_increments.items[0..old.items.len], old.items);
            @memset(new_increments.items[old.items.len..new_len], 0);

            const new_rc = try EffectiveBalanceIncrementsRc.create(self.allocator, new_increments);
            self.effective_balance_increments.unref();
            self.effective_balance_increments = new_rc;
        }
        self.effective_balance_increments.get().items[index] = @intCast(@divFloor(effective_balance, preset.EFFECTIVE_BALANCE_INCREMENT));
    }

    pub fn isPostElectra(self: *const EpochCache) bool {
        return self.epoch >= self.config.chain.ELECTRA_FORK_EPOCH;
    }
};

test {
    _ = @import("epoch_cache_test.zig");
}
