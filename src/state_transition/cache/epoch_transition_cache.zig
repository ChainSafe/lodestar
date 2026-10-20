const std = @import("std");
const types = @import("consensus_types");
const metrics = @import("../metrics.zig");
const time = @import("time");

const Allocator = std.mem.Allocator;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const ForkSeq = @import("config").ForkSeq;
const Epoch = types.primitive.Epoch.Type;
const preset = @import("preset").preset;
const BeaconConfig = @import("config").BeaconConfig;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const BeaconState = @import("fork_types").BeaconState;

const attester_status = @import("../utils/attester_status.zig");
const FLAG_CURR_HEAD_ATTESTER = attester_status.FLAG_CURR_HEAD_ATTESTER;
const FLAG_CURR_SOURCE_ATTESTER = attester_status.FLAG_CURR_SOURCE_ATTESTER;
const FLAG_CURR_TARGET_ATTESTER = attester_status.FLAG_CURR_TARGET_ATTESTER;
const FLAG_ELIGIBLE_ATTESTER = attester_status.FLAG_ELIGIBLE_ATTESTER;
const FLAG_PREV_HEAD_ATTESTER = attester_status.FLAG_PREV_HEAD_ATTESTER;
const FLAG_PREV_SOURCE_ATTESTER = attester_status.FLAG_PREV_SOURCE_ATTESTER;
const FLAG_PREV_TARGET_ATTESTER = attester_status.FLAG_PREV_TARGET_ATTESTER;
const FLAG_UNSLASHED = attester_status.FLAG_UNSLASHED;
const hasMarkers = attester_status.hasMarkers;

const c = @import("constants");
const FAR_FUTURE_EPOCH = c.FAR_FUTURE_EPOCH;
const MIN_ACTIVATION_BALANCE = preset.MIN_ACTIVATION_BALANCE;

const hasCompoundingWithdrawalCredential = @import("../utils/electra.zig").hasCompoundingWithdrawalCredential;
const computeBaseRewardPerIncrement = @import("../utils/sync_committee.zig").computeBaseRewardPerIncrement;
const processPendingAttestations = @import("../epoch/process_pending_attestations.zig").processPendingAttestations;
const Node = @import("persistent_merkle_tree").Node;
const vfc = @import("./validator_flat_cache.zig");
const ValidatorFlatCache = vfc.ValidatorFlatCache;
const EpochShufflingRc = @import("../utils/epoch_shuffling.zig").EpochShufflingRc;
const EpochShuffling = @import("../utils/epoch_shuffling.zig").EpochShuffling;

const BoolArray = std.ArrayList(bool);
const UsizeArray = std.ArrayList(usize);
const U8Array = std.ArrayList(u8);
const U64Array = std.ArrayList(u64);

/// A tail buffer data structure which provides a view on a borrowed base slice
/// and a fixed growable tail for validators added during epoch processing.
///
/// Provides validator-indexed compounding flags.
///
/// NOTE: This data structure is useful for views on large arrays with a small,
/// upper-limit on array growth. The tail avoids reallocating the process-global
/// reused cache.
const CompoundingValidatorFlags = struct {
    /// An immutable view on the base array.
    base: []const bool,
    /// Growth is bounded by `preset.MAX_PENDING_DEPOSITS_PER_EPOCH` = 16.
    tail: [preset.MAX_PENDING_DEPOSITS_PER_EPOCH]bool = undefined,
    tail_len: usize = 0,

    /// Appends the flag for a validator added during epoch processing.
    ///
    /// Asserts that the fixed tail has remaining capacity.
    fn append(self: *CompoundingValidatorFlags, value: bool) void {
        std.debug.assert(self.tail_len < self.tail.len);
        self.tail[self.tail_len] = value;
        self.tail_len += 1;
    }

    /// Returns a validator's flag from the borrowed base or fixed tail.
    ///
    /// The index must be within the combined logical length.
    fn get(self: *const CompoundingValidatorFlags, validator_index: usize) bool {
        if (validator_index < self.base.len) return self.base[validator_index];

        const tail_index = validator_index - self.base.len;
        std.debug.assert(tail_index < self.tail_len);
        return self.tail[tail_index];
    }
};

const ValidatorActivation = struct {
    validator_index: ValidatorIndex,
    activation_eligibility_epoch: Epoch,
};

const ValidatorActivationList = std.ArrayList(ValidatorActivation);

const ShufflingJob = struct {
    const Error = Allocator.Error || @import("swap_or_not_shuffle").ShufflingError;

    io: std.Io,
    future: std.Io.Future(Error!Result),

    const Result = struct {
        shuffling: *EpochShuffling,
        duration: std.Io.Duration,
    };

    fn worker(allocator: Allocator, io: std.Io, seed: [32]u8, epoch: Epoch, active_indices: []ValidatorIndex) Error!Result {
        errdefer allocator.free(active_indices);

        const timer = time.start(io);
        const shuffling = try EpochShuffling.init(allocator, seed, epoch, active_indices);
        return .{ .shuffling = shuffling, .duration = time.since(io, timer) };
    }

    fn start(allocator: Allocator, io: std.Io, seed: [32]u8, epoch: Epoch, active_indices: []ValidatorIndex) @This() {
        return .{
            .io = io,
            .future = std.Io.async(io, worker, .{ allocator, io, seed, epoch, active_indices }),
        };
    }

    fn join(self: *@This()) !*EpochShuffling {
        const result = try self.future.await(self.io);
        metrics.state_transition.epoch_shuffling_job.observe(time.durationSeconds(result.duration));
        return result.shuffling;
    }

    fn cancel(self: *@This()) void {
        const result = self.future.cancel(self.io) catch return;
        metrics.state_transition.epoch_shuffling_job.observe(time.durationSeconds(result.duration));
        result.shuffling.deinit();
    }
};

/// this is a cache that's never gc'd, it is used to store data that is reused across multiple epochs
const ReusedEpochTransitionCache = struct {
    allocator: Allocator,
    is_active_prev_epoch: BoolArray,
    is_active_current_epoch: BoolArray,
    is_active_next_epoch: BoolArray,

    proposer_indices: UsizeArray,
    inclusion_delays: UsizeArray,

    flags: U8Array,

    next_epoch_shuffling_active_validator_indices: std.ArrayList(ValidatorIndex),

    is_compounding_validator_arr: BoolArray,

    previous_epoch_participation: U8Array,
    current_epoch_participation: U8Array,
    rewards: U64Array,
    penalties: U64Array,
    slashing_penalties: U64Array,

    /// Holds a ref into the node pool. Teardown this struct before the pool.
    validator_flat_cache: ValidatorFlatCache,

    pub fn init(self: *ReusedEpochTransitionCache, allocator: Allocator, pool: *Node.Pool, validator_count: usize) !void {
        self.allocator = allocator;
        self.validator_flat_cache = ValidatorFlatCache.init(allocator, pool);
        self.is_active_prev_epoch = try BoolArray.initCapacity(allocator, validator_count);
        errdefer self.is_active_prev_epoch.deinit(allocator);
        self.is_active_current_epoch = try BoolArray.initCapacity(allocator, validator_count);
        errdefer self.is_active_current_epoch.deinit(allocator);
        self.is_active_next_epoch = try BoolArray.initCapacity(allocator, validator_count);
        errdefer self.is_active_next_epoch.deinit(allocator);
        self.proposer_indices = .empty;
        self.inclusion_delays = .empty;
        self.flags = try U8Array.initCapacity(allocator, validator_count);
        errdefer self.flags.deinit(allocator);
        self.next_epoch_shuffling_active_validator_indices = try std.ArrayList(ValidatorIndex).initCapacity(allocator, validator_count);
        errdefer self.next_epoch_shuffling_active_validator_indices.deinit(allocator);
        self.is_compounding_validator_arr = .empty;
        self.previous_epoch_participation = .empty;
        self.current_epoch_participation = .empty;
        self.rewards = try U64Array.initCapacity(allocator, validator_count);
        errdefer self.rewards.deinit(allocator);
        self.penalties = try U64Array.initCapacity(allocator, validator_count);
        errdefer self.penalties.deinit(allocator);
        self.slashing_penalties = .empty;
    }

    pub fn resize(self: *ReusedEpochTransitionCache, validator_count: usize) !void {
        try self.is_active_prev_epoch.resize(self.allocator, validator_count);
        try self.is_active_current_epoch.resize(self.allocator, validator_count);
        try self.is_active_next_epoch.resize(self.allocator, validator_count);
        try self.flags.resize(self.allocator, validator_count);
        try self.next_epoch_shuffling_active_validator_indices.resize(self.allocator, validator_count);
        try self.rewards.resize(self.allocator, validator_count);
        try self.penalties.resize(self.allocator, validator_count);

        @memset(self.is_active_prev_epoch.items, true);
        @memset(self.is_active_current_epoch.items, true);
        @memset(self.is_active_next_epoch.items, true);
    }

    pub fn deinit(self: *ReusedEpochTransitionCache) void {
        self.validator_flat_cache.deinit();
        self.is_active_prev_epoch.deinit(self.allocator);
        self.is_active_current_epoch.deinit(self.allocator);
        self.is_active_next_epoch.deinit(self.allocator);
        self.proposer_indices.deinit(self.allocator);
        self.inclusion_delays.deinit(self.allocator);
        self.flags.deinit(self.allocator);
        self.next_epoch_shuffling_active_validator_indices.deinit(self.allocator);
        self.is_compounding_validator_arr.deinit(self.allocator);
        self.previous_epoch_participation.deinit(self.allocator);
        self.current_epoch_participation.deinit(self.allocator);
        self.rewards.deinit(self.allocator);
        self.penalties.deinit(self.allocator);
        self.slashing_penalties.deinit(self.allocator);
        self.* = undefined;
    }
};

threadlocal var _reused_cache: ?*ReusedEpochTransitionCache = null;

fn getReusedEpochTransitionCache(
    allocator: Allocator,
    pool: *Node.Pool,
    validator_count: usize,
) !*ReusedEpochTransitionCache {
    if (_reused_cache) |cache| {
        std.debug.assert(cache.validator_flat_cache.pool == pool);
        try cache.resize(validator_count);
        return cache;
    }
    _reused_cache = try allocator.create(ReusedEpochTransitionCache);
    errdefer {
        allocator.destroy(_reused_cache.?);
        _reused_cache = null;
    }
    try _reused_cache.?.init(allocator, pool, validator_count);
    try _reused_cache.?.resize(validator_count);
    return _reused_cache.?;
}

/// Callers must exclude cache initialization and use until teardown returns.
pub fn deinitReusedEpochTransitionCache() void {
    if (_reused_cache) |cache| {
        const allocator = cache.allocator;
        cache.deinit();
        allocator.destroy(cache);
        _reused_cache = null;
    }
}

/// Borrows thread-local buffers. Callers must serialize cache lifetimes within each thread from
/// `init` through `deinit` and exclude `deinitReusedEpochTransitionCache` throughout.
pub const EpochTransitionCache = struct {
    /// Allocator used for cache-owned lists.
    allocator: Allocator,
    prev_epoch: Epoch,
    current_epoch: Epoch,
    total_active_stake_by_increment: u64,
    base_reward_per_increment: u64,
    prev_epoch_unslashed_stake_source_by_increment: u64,
    prev_epoch_unslashed_stake_target_by_increment: u64,
    prev_epoch_unslashed_stake_head_by_increment: u64,
    curr_epoch_unslashed_target_stake_by_increment: u64,
    indices_to_slash: std.ArrayList(ValidatorIndex),
    indices_eligible_for_activation_queue: std.ArrayList(ValidatorIndex),
    indices_eligible_for_activation: std.ArrayList(ValidatorIndex),
    indices_to_eject: std.ArrayList(ValidatorIndex),
    // this is borrowed from ReusedEpochTransitionCache
    proposer_indices: []const usize,
    // phase0 only
    inclusion_delays: []const usize,
    // this is borrowed from ReusedEpochTransitionCache
    flags: []const u8,
    compounding_validator_flags: CompoundingValidatorFlags,
    rewards: []u64,
    penalties: []u64,
    slashing_penalties: []u64,
    balances: ?U64Array,
    next_shuffling_active_indices: []const ValidatorIndex,
    next_shuffling: ?*EpochShufflingRc,
    shuffling_job: ?ShufflingJob,
    next_epoch_total_active_balance_by_increment: u64,
    // these are borrowed from ReusedEpochTransitionCache
    is_active_prev_epoch: []const bool,
    is_active_curr_epoch: []const bool,
    is_active_next_epoch: []const bool,

    pub fn appendCompoundingValidatorFlag(self: *EpochTransitionCache, value: bool) void {
        self.compounding_validator_flags.append(value);
    }

    pub fn isCompoundingValidator(self: *const EpochTransitionCache, validator_index: usize) bool {
        return self.compounding_validator_flags.get(validator_index);
    }

    // this is the same to beforeProcessEpoch in typesript version
    pub fn init(
        allocator: Allocator,
        config: *const BeaconConfig,
        epoch_cache: *EpochCache,
        state: *AnyBeaconState,
    ) !EpochTransitionCache {
        const fork_seq = state.forkSeq();
        const current_epoch = epoch_cache.epoch;
        const prev_epoch = epoch_cache.getPreviousShuffling().epoch;
        const next_epoch = current_epoch + 1;
        // active validator indices for nextShuffling is ready, we want to precalculate for the one after that
        const next_epoch_2 = current_epoch + 2;

        const slashings_epoch = current_epoch + @divFloor(preset.EPOCHS_PER_SLASHINGS_VECTOR, 2);

        var indices_to_slash: std.ArrayList(ValidatorIndex) = .empty;
        errdefer indices_to_slash.deinit(allocator);

        var indices_eligible_for_activation_queue: std.ArrayList(ValidatorIndex) = .empty;
        errdefer indices_eligible_for_activation_queue.deinit(allocator);

        // we will extract indices_eligible_for_activation from validator_activation_list later
        var validator_activation_list: ValidatorActivationList = .empty;
        defer validator_activation_list.deinit(allocator);

        var indices_to_eject: std.ArrayList(ValidatorIndex) = .empty;
        errdefer indices_to_eject.deinit(allocator);

        var total_active_stake_by_increment: u64 = 0;
        var validators_view = try state.validators();
        try validators_view.commit();
        const validator_count = try validators_view.length();

        var reused_cache = try getReusedEpochTransitionCache(
            allocator,
            state.nodePool(),
            validator_count,
        );
        const validator_flat_cache = &reused_cache.validator_flat_cache;
        switch (validators_view.inner) {
            inline else => |view| try validator_flat_cache.sync(@TypeOf(view.*).SszType, view.getRoot(), validator_count),
        }

        // Clone before being mutated in processEffectiveBalanceUpdates
        try epoch_cache.beforeEpochTransition();

        const effective_balances_by_increments = epoch_cache.getEffectiveBalanceIncrements().items;

        var next_epoch_shuffling_active_indices_length: usize = 0;

        if (fork_seq.gte(.electra)) {
            try reused_cache.is_compounding_validator_arr.resize(reused_cache.allocator, validator_count);
        }
        const cached_fields = validator_flat_cache.fields.slice();
        for (0..validator_count) |i| {
            const validator = cached_fields.get(i);
            var flag: u8 = 0;

            if (validator.bits.slashed) {
                if (slashings_epoch == validator.withdrawable_epoch) {
                    try indices_to_slash.append(allocator, i);
                }
            } else {
                flag |= FLAG_UNSLASHED;
            }

            const activation_epoch = validator.activation_epoch;
            const exit_epoch = validator.exit_epoch;
            const is_active_prev: bool = activation_epoch <= prev_epoch and prev_epoch < exit_epoch;
            const is_active_curr: bool = activation_epoch <= current_epoch and current_epoch < exit_epoch;
            const is_active_next: bool = activation_epoch <= next_epoch and next_epoch < exit_epoch;
            const is_active_next_2: bool = activation_epoch <= next_epoch_2 and next_epoch_2 < exit_epoch;

            if (!is_active_prev) {
                reused_cache.is_active_prev_epoch.items[i] = false;
            }

            // Both active validators and slashed-but-not-yet-withdrawn validators are eligible to receive penalties.
            // This is done to prevent self-slashing from being a way to escape inactivity leaks.
            // TODO: Consider using an array of `eligible ValidatorIndex: number[]`
            if (is_active_prev or (validator.bits.slashed and prev_epoch + 1 < validator.withdrawable_epoch)) {
                flag |= FLAG_ELIGIBLE_ATTESTER;
            }

            reused_cache.flags.items[i] = flag;

            if (fork_seq.gte(.electra)) {
                reused_cache.is_compounding_validator_arr.items[i] = validator.bits.compounding;
            }

            if (is_active_curr) {
                total_active_stake_by_increment += effective_balances_by_increments[i];
            } else {
                reused_cache.is_active_current_epoch.items[i] = false;
            }

            // To optimize process_registry_updates():
            // ```python
            // def is_eligible_for_activation_queue(validator: Validator) -> bool:
            //   return (
            //     validator.activation_eligibility_epoch == FAR_FUTURE_EPOCH
            //     and validator.effective_balance >= MAX_EFFECTIVE_BALANCE # [Modified in Electra]
            //   )
            // ```
            if (validator.activation_eligibility_epoch == FAR_FUTURE_EPOCH and validator.effective_balance >= MIN_ACTIVATION_BALANCE) {
                try indices_eligible_for_activation_queue.append(allocator, i);
            }

            // To optimize process_registry_updates():
            // ```python
            // def is_eligible_for_activation(state: BeaconState, validator: Validator) -> bool:
            //   return (
            //     validator.activation_eligibility_epoch <= state.finalized_checkpoint.epoch  # Placement in queue is finalized
            //     and validator.activation_epoch == FAR_FUTURE_EPOCH                          # Has not yet been activated
            //   )
            // ```
            // Here we have to check if `activationEligibilityEpoch <= currentEpoch` instead of finalized checkpoint, because the finalized
            // checkpoint may change during epoch processing at processJustificationAndFinalization(), which is called before processRegistryUpdates().
            // Then in processRegistryUpdates() we will check `activationEligibilityEpoch <= finalityEpoch`. This is to keep the array small.
            //
            // Use `else` since indicesEligibleForActivationQueue + indicesEligibleForActivation are mutually exclusive
            else if (validator.activation_epoch == FAR_FUTURE_EPOCH and validator.activation_eligibility_epoch <= current_epoch) {
                try validator_activation_list.append(allocator, .{
                    .validator_index = i,
                    .activation_eligibility_epoch = validator.activation_eligibility_epoch,
                });
            }

            // To optimize process_registry_updates():
            // ```python
            // if is_active_validator(validator, get_current_epoch(state)) and validator.effective_balance <= EJECTION_BALANCE:
            // ```
            // Adding extra condition `exitEpoch === FAR_FUTURE_EPOCH` to keep the array as small as possible. initiateValidatorExit() will ignore them anyway
            //
            // Use `else` since indicesEligibleForActivationQueue + indicesEligibleForActivation + indicesToEject are mutually exclusive
            else if (is_active_curr and validator.exit_epoch == FAR_FUTURE_EPOCH and validator.effective_balance <= config.chain.EJECTION_BALANCE) {
                try indices_to_eject.append(allocator, i);
            }

            if (!is_active_next) {
                reused_cache.is_active_next_epoch.items[i] = false;
            }

            if (is_active_next_2) {
                reused_cache.next_epoch_shuffling_active_validator_indices.items[next_epoch_shuffling_active_indices_length] = i;
                next_epoch_shuffling_active_indices_length += 1;
            }
        } // end validator loop

        // no need to trigger async build as zig should be fast enough

        // typescript: only the first `activeValidatorCount` elements are copied to `activeIndices`
        // here in zig we simply return a slice, consumer only borrows this slice and need to allocate a separate array for the next shuffling computation
        const next_shuffling_active_indices = reused_cache.next_epoch_shuffling_active_validator_indices.items[0..next_epoch_shuffling_active_indices_length];

        if (total_active_stake_by_increment < 1) {
            total_active_stake_by_increment = 1;
        }

        // SPEC: function getBaseRewardPerIncrement()
        const base_reward_per_increment = computeBaseRewardPerIncrement(total_active_stake_by_increment);

        // To optimize process_registry_updates():
        // order by sequence of activationEligibilityEpoch setting and then index
        const sort_fn = struct {
            pub fn sort(_: void, a: ValidatorActivation, b: ValidatorActivation) bool {
                // sort by activationEligibilityEpoch first, then by index
                if (a.activation_eligibility_epoch != b.activation_eligibility_epoch) {
                    return a.activation_eligibility_epoch < b.activation_eligibility_epoch;
                }
                return a.validator_index < b.validator_index;
            }
        }.sort;
        std.mem.sort(ValidatorActivation, validator_activation_list.items, {}, sort_fn);

        if (fork_seq == ForkSeq.phase0) {
            const fork_state = try state.tryCastToFork(.phase0);
            try reused_cache.proposer_indices.resize(reused_cache.allocator, validator_count);
            // in typescript we prefill with -1 as unset value, in zig we use  validator_count
            @memset(reused_cache.proposer_indices.items, validator_count);
            try reused_cache.inclusion_delays.resize(reused_cache.allocator, validator_count);
            @memset(reused_cache.inclusion_delays.items, 0);

            var previous_epoch_pending_attestations_view = try state.previousEpochPendingAttestations();
            const previous_epoch_pending_attestations = try previous_epoch_pending_attestations_view.getAllReadonlyValues(allocator);
            defer {
                for (previous_epoch_pending_attestations) |*att| {
                    types.phase0.PendingAttestation.deinit(allocator, att);
                }
                allocator.free(previous_epoch_pending_attestations);
            }
            var current_epoch_pending_attestations_view = try state.currentEpochPendingAttestations();
            const current_epoch_pending_attestations = try current_epoch_pending_attestations_view.getAllReadonlyValues(allocator);
            defer {
                for (current_epoch_pending_attestations) |*att| {
                    types.phase0.PendingAttestation.deinit(allocator, att);
                }
                allocator.free(current_epoch_pending_attestations);
            }

            try processPendingAttestations(
                .phase0,
                allocator,
                epoch_cache,
                fork_state,
                reused_cache.proposer_indices.items,
                validator_count,
                reused_cache.inclusion_delays.items,
                reused_cache.flags.items,
                previous_epoch_pending_attestations,
                prev_epoch,
                FLAG_PREV_SOURCE_ATTESTER,
                FLAG_PREV_TARGET_ATTESTER,
                FLAG_PREV_HEAD_ATTESTER,
            );
            try processPendingAttestations(
                .phase0,
                allocator,
                epoch_cache,
                fork_state,
                reused_cache.proposer_indices.items,
                validator_count,
                reused_cache.inclusion_delays.items,
                reused_cache.flags.items,
                current_epoch_pending_attestations,
                current_epoch,
                FLAG_CURR_SOURCE_ATTESTER,
                FLAG_CURR_TARGET_ATTESTER,
                FLAG_CURR_HEAD_ATTESTER,
            );
        } else {
            try reused_cache.previous_epoch_participation.resize(reused_cache.allocator, validator_count);
            try reused_cache.current_epoch_participation.resize(reused_cache.allocator, validator_count);

            var previous_epoch_participation_view = try state.previousEpochParticipation();
            _ = try previous_epoch_participation_view.getAllInto(reused_cache.previous_epoch_participation.items);
            var current_epoch_participation_view = try state.currentEpochParticipation();
            _ = try current_epoch_participation_view.getAllInto(reused_cache.current_epoch_participation.items);

            for (0..validator_count) |i| {
                reused_cache.flags.items[i] |=
                    // checking active status first is required to pass random spec tests in altair
                    // in practice, inactive validators will have 0 participation
                    // FLAG_PREV are indexes [0,1,2]
                    (if (reused_cache.is_active_prev_epoch.items[i]) reused_cache.previous_epoch_participation.items[i] else 0) |
                    // FLAG_CURR are indexes [3,4,5], so shift by 3
                    (if (reused_cache.is_active_current_epoch.items[i]) reused_cache.current_epoch_participation.items[i] << 3 else 0);
            }
        }

        var prev_source_unsl_stake: u64 = 0;
        var prev_target_unsl_stake: u64 = 0;
        var prev_head_unsl_stake: u64 = 0;

        var curr_target_unsl_stake: u64 = 0;

        const FLAG_PREV_SOURCE_ATTESTER_UNSLASHED = FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED;
        const FLAG_PREV_TARGET_ATTESTER_UNSLASHED = FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED;
        const FLAG_PREV_HEAD_ATTESTER_UNSLASHED = FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED;
        const FLAG_CURR_TARGET_UNSLASHED = FLAG_CURR_TARGET_ATTESTER | FLAG_UNSLASHED;

        for (0..validator_count) |i| {
            const effective_balance_by_increment = effective_balances_by_increments[i];
            const flag = reused_cache.flags.items[i];
            if (hasMarkers(flag, FLAG_PREV_SOURCE_ATTESTER_UNSLASHED)) {
                prev_source_unsl_stake += effective_balance_by_increment;
            }
            if (hasMarkers(flag, FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
                prev_target_unsl_stake += effective_balance_by_increment;
            }
            if (hasMarkers(flag, FLAG_PREV_HEAD_ATTESTER_UNSLASHED)) {
                prev_head_unsl_stake += effective_balance_by_increment;
            }
            if (hasMarkers(flag, FLAG_CURR_TARGET_UNSLASHED)) {
                curr_target_unsl_stake += effective_balance_by_increment;
            }
        }

        if (fork_seq.gte(.altair)) {
            if (epoch_cache.current_target_unslashed_balance_increments != curr_target_unsl_stake) {
                try metrics.state_transition.progressive_balances_mismatches.incr(.{ .target = .current });
                epoch_cache.current_target_unslashed_balance_increments = curr_target_unsl_stake;
            }
            if (epoch_cache.previous_target_unslashed_balance_increments != prev_target_unsl_stake) {
                try metrics.state_transition.progressive_balances_mismatches.incr(.{ .target = .previous });
                epoch_cache.previous_target_unslashed_balance_increments = prev_target_unsl_stake;
            }
        }

        // As per spec of `get_total_balance`:
        // EFFECTIVE_BALANCE_INCREMENT Gwei minimum to avoid divisions by zero.
        // Math safe up to ~10B ETH, afterwhich this overflows uint64.
        if (prev_source_unsl_stake < 1) {
            prev_source_unsl_stake = 1;
        }
        if (prev_target_unsl_stake < 1) {
            prev_target_unsl_stake = 1;
        }
        if (prev_head_unsl_stake < 1) {
            prev_head_unsl_stake = 1;
        }
        if (curr_target_unsl_stake < 1) {
            curr_target_unsl_stake = 1;
        }

        // zig specific map function similar to "indicesEligibleForActivation.map(({validatorIndex}) => validatorIndex)"
        var indices_eligible_for_activation = try std.ArrayList(ValidatorIndex).initCapacity(allocator, validator_activation_list.items.len);
        errdefer indices_eligible_for_activation.deinit(allocator);
        for (validator_activation_list.items) |activation| {
            try indices_eligible_for_activation.append(allocator, activation.validator_index);
        }

        // Resizing to zero clears the previous epoch's length while retaining capacity.
        try reused_cache.slashing_penalties.resize(reused_cache.allocator, indices_to_slash.items.len);

        return .{
            .allocator = allocator,
            .prev_epoch = prev_epoch,
            .current_epoch = current_epoch,
            .total_active_stake_by_increment = total_active_stake_by_increment,
            .base_reward_per_increment = base_reward_per_increment,
            .prev_epoch_unslashed_stake_source_by_increment = prev_source_unsl_stake,
            .prev_epoch_unslashed_stake_target_by_increment = prev_target_unsl_stake,
            .prev_epoch_unslashed_stake_head_by_increment = prev_head_unsl_stake,
            .curr_epoch_unslashed_target_stake_by_increment = curr_target_unsl_stake,
            .indices_to_slash = indices_to_slash,
            .indices_eligible_for_activation_queue = indices_eligible_for_activation_queue,
            .indices_eligible_for_activation = indices_eligible_for_activation,
            .indices_to_eject = indices_to_eject,
            .next_shuffling_active_indices = next_shuffling_active_indices,
            .next_shuffling = null,
            .shuffling_job = null,
            // to be updated in processEffectiveBalanceUpdates
            .next_epoch_total_active_balance_by_increment = 0,
            .is_active_prev_epoch = reused_cache.is_active_prev_epoch.items,
            .is_active_curr_epoch = reused_cache.is_active_current_epoch.items,
            .is_active_next_epoch = reused_cache.is_active_next_epoch.items,
            .proposer_indices = reused_cache.proposer_indices.items,
            .inclusion_delays = reused_cache.inclusion_delays.items,
            .flags = reused_cache.flags.items,
            .compounding_validator_flags = .{ .base = reused_cache.is_compounding_validator_arr.items },
            .rewards = reused_cache.rewards.items,
            .penalties = reused_cache.penalties.items,
            .slashing_penalties = reused_cache.slashing_penalties.items,
            // Will be assigned in processRewardsAndPenalties()
            .balances = null,
        };
    }

    pub fn startShuffling(self: *EpochTransitionCache, allocator: Allocator, io: std.Io, seed: [32]u8, epoch: Epoch) !void {
        std.debug.assert(self.shuffling_job == null);
        const active_indices = try allocator.alloc(ValidatorIndex, self.next_shuffling_active_indices.len);
        std.mem.copyForwards(ValidatorIndex, active_indices, self.next_shuffling_active_indices);
        self.shuffling_job = ShufflingJob.start(allocator, io, seed, epoch, active_indices);
    }

    pub fn joinShuffling(self: *EpochTransitionCache) !*EpochShuffling {
        var job = self.shuffling_job orelse return error.ShufflingJobNotStarted;
        self.shuffling_job = null;
        return job.join();
    }

    pub fn deinit(self: *EpochTransitionCache) void {
        if (self.next_shuffling) |next_shuffling| next_shuffling.unref();
        if (self.shuffling_job) |*job| job.cancel();
        // no need to deinit proposer_indices and inclusion_delays as they are from reused_cache
        // no need to deinit below as they are from reused_cache
        // self.flags.deinit();
        // self.is_active_prev_epoch.deinit();
        // self.is_active_curr_epoch.deinit();
        // self.is_active_next_epoch.deinit();
        self.indices_to_slash.deinit(self.allocator);
        self.indices_eligible_for_activation_queue.deinit(self.allocator);
        self.indices_eligible_for_activation.deinit(self.allocator);
        self.indices_to_eject.deinit(self.allocator);
        // rewards and penalties are from reused_cache
        if (self.balances) |*balances| {
            balances.deinit(self.allocator);
        }
    }
};

test {
    _ = @import("epoch_transition_cache_test.zig");
    _ = @import("validator_flat_cache.zig");
}
