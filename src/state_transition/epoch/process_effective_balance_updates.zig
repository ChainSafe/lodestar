const std = @import("std");
const Allocator = std.mem.Allocator;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const types = @import("consensus_types");
const preset = @import("preset").preset;
const c = @import("constants");
const ForkTypes = @import("fork_types").ForkTypes;
const validator_chunks = @import("../utils/validator_chunks.zig");

/// Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag
const TIMELY_TARGET = 1 << c.TIMELY_TARGET_FLAG_INDEX;

const HYSTERESIS_INCREMENT = preset.EFFECTIVE_BALANCE_INCREMENT / preset.HYSTERESIS_QUOTIENT;
const DOWNWARD_THRESHOLD = HYSTERESIS_INCREMENT * preset.HYSTERESIS_DOWNWARD_MULTIPLIER;
const UPWARD_THRESHOLD = HYSTERESIS_INCREMENT * preset.HYSTERESIS_UPWARD_MULTIPLIER;

/// Returns the hysteresis-adjusted effective balance of validator `i`, or null when it stays.
inline fn updatedEffectiveBalance(
    comptime fork: ForkSeq,
    cache: *const EpochTransitionCache,
    i: usize,
    balance: u64,
    effective_balance_increment: u16,
) ?u64 {
    const effective_balance = @as(u64, effective_balance_increment) * preset.EFFECTIVE_BALANCE_INCREMENT;
    const effective_balance_limit: u64 = if (comptime fork.lt(.electra))
        preset.MAX_EFFECTIVE_BALANCE
    else blk: {
        // from electra, effectiveBalanceLimit is per validator
        if (cache.isCompoundingValidator(i)) {
            break :blk preset.MAX_EFFECTIVE_BALANCE_ELECTRA;
        } else {
            break :blk preset.MIN_ACTIVATION_BALANCE;
        }
    };

    if (
    // too big
    effective_balance > balance + DOWNWARD_THRESHOLD or
        // too small. Check effective_balance < MAX_EFFECTIVE_BALANCE to prevent unnecessary updates
        (effective_balance < effective_balance_limit and effective_balance + UPWARD_THRESHOLD < balance))
    {
        return @min(balance - (balance % preset.EFFECTIVE_BALANCE_INCREMENT), effective_balance_limit);
    }
    return null;
}

const EffectiveBalanceChunk = struct {
    next_epoch_total_active_balance_by_increment: u64,
    update_count: usize,
};

fn EffectiveBalanceScan(comptime fork: ForkSeq) type {
    return struct {
        cache: *const EpochTransitionCache,
        balances: []const u64,
        effective_balance_increments: []const u16,
        /// A chunk writes the indices whose effective balance changes from its own start onward.
        updates: []u32,
        chunk_results: []EffectiveBalanceChunk,

        fn scanChunk(scan: *const @This(), chunk: validator_chunks.Chunk) void {
            const is_active_next_epoch = scan.cache.is_active_next_epoch;
            var next_epoch_total_active_balance_by_increment: u64 = 0;
            var update_count: usize = 0;
            for (
                scan.balances[chunk.start..chunk.end],
                scan.effective_balance_increments[chunk.start..chunk.end],
                chunk.start..,
            ) |balance, effective_balance_increment, i| {
                var next_increment = effective_balance_increment;
                if (updatedEffectiveBalance(fork, scan.cache, i, balance, effective_balance_increment)) |effective_balance| {
                    next_increment = @intCast(@divFloor(effective_balance, preset.EFFECTIVE_BALANCE_INCREMENT));
                    scan.updates[chunk.start + update_count] = @intCast(i);
                    update_count += 1;
                }

                // TODO: Do this in afterEpochTransitionCache, looping a Uint8Array should be very cheap
                // post-electra we may add new validator to registry in processPendingDeposits()
                // We track nextEpochTotalActiveBalanceByIncrement as ETH to fit total network balance in a JS number (53 bits).
                // The wrapping add cannot wrap: at most 2^32 validators of u16 increments sum below 2^48.
                const is_active_next = i < is_active_next_epoch.len and is_active_next_epoch[i];
                next_epoch_total_active_balance_by_increment +%= @as(u64, next_increment) * @intFromBool(is_active_next);
            }
            scan.chunk_results[chunk.index] = .{
                .next_epoch_total_active_balance_by_increment = next_epoch_total_active_balance_by_increment,
                .update_count = update_count,
            };
        }
    };
}

/// this function also update EpochTransitionCache
pub fn processEffectiveBalanceUpdates(
    comptime fork: ForkSeq,
    allocator: Allocator,
    io: std.Io,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    cache: *EpochTransitionCache,
) !usize {
    var validators = try state.validators();
    const effective_balance_increments = epoch_cache.getEffectiveBalanceIncrements().items;

    // update effective balances with hysteresis

    // epochTransitionCache.balances is initialized in processRewardsAndPenalties()
    // and updated in processPendingDeposits() and processPendingConsolidations()
    // so it's recycled here for performance.
    const balances = if (cache.balances) |balances_arr|
        balances_arr.items
    else
        try state.balancesSlice(allocator);
    defer if (cache.balances == null) {
        allocator.free(balances);
    };
    var previous_epoch_participation: *ForkTypes(if (fork.gte(.altair)) fork else .altair).BeaconState.getFieldType("previous_epoch_participation").TreeView = undefined;
    var current_epoch_participation: *ForkTypes(if (fork.gte(.altair)) fork else .altair).BeaconState.getFieldType("current_epoch_participation").TreeView = undefined;
    if (comptime fork.gte(.altair)) {
        previous_epoch_participation = try state.previousEpochParticipation();
        current_epoch_participation = try state.currentEpochParticipation();
    }

    const chunk_results = try allocator.alloc(EffectiveBalanceChunk, validator_chunks.count(balances.len));
    defer allocator.free(chunk_results);

    const scan: EffectiveBalanceScan(fork) = .{
        .cache = cache,
        .balances = balances,
        .effective_balance_increments = effective_balance_increments[0..balances.len],
        .updates = cache.index_scratch[0..balances.len],
        .chunk_results = chunk_results,
    };
    try validator_chunks.run(io, balances.len, &scan, EffectiveBalanceScan(fork).scanChunk);

    // Tree views are not thread-safe, so the changed effective balances are written on this
    // thread, in validator index order.
    var next_epoch_total_active_balance_by_increment: u64 = 0;
    var num_update: usize = 0;
    for (chunk_results, 0..) |result, chunk_index| {
        next_epoch_total_active_balance_by_increment +%= result.next_epoch_total_active_balance_by_increment;
        const chunk = validator_chunks.at(balances.len, chunk_index);
        for (scan.updates[chunk.start..][0..result.update_count]) |i| {
            const effective_balance_increment = effective_balance_increments[i];
            const effective_balance = updatedEffectiveBalance(fork, cache, i, balances[i], effective_balance_increment).?;

            var validator = try validators.get(i);
            try validator.set("effective_balance", effective_balance);
            // Also update the fast cached version
            const new_effective_balance_increment: u16 = @intCast(@divFloor(effective_balance, preset.EFFECTIVE_BALANCE_INCREMENT));

            // TODO: describe issue. Compute progressive target balances
            // Must update target balances for consistency, see comments below
            if (comptime fork.gte(.altair)) {
                const slashed = try validator.get("slashed");
                if (!slashed) {
                    if ((try previous_epoch_participation.get(i)) & TIMELY_TARGET == TIMELY_TARGET) {
                        // Use += then -= to avoid underflow when new_effective_balance_increment < effective_balance_increment
                        epoch_cache.previous_target_unslashed_balance_increments += new_effective_balance_increment;
                        epoch_cache.previous_target_unslashed_balance_increments -= effective_balance_increment;
                    }
                    // currentTargetUnslashedBalanceIncrements is transferred to previousTargetUnslashedBalanceIncrements in afterEpochTransitionCache
                    // at epoch transition of next epoch (in EpochTransitionCache), prevTargetUnslStake is calculated based on newEffectiveBalanceIncrement
                    if ((try current_epoch_participation.get(i)) & TIMELY_TARGET == TIMELY_TARGET) {
                        // Use += then -= to avoid underflow when new_effective_balance_increment < effective_balance_increment
                        epoch_cache.current_target_unslashed_balance_increments += new_effective_balance_increment;
                        epoch_cache.current_target_unslashed_balance_increments -= effective_balance_increment;
                    }
                }
            }

            effective_balance_increments[i] = new_effective_balance_increment;
            num_update += 1;
        }
    }

    cache.next_epoch_total_active_balance_by_increment = next_epoch_total_active_balance_by_increment;
    return num_update;
}
