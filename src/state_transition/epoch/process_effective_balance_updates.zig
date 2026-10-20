const std = @import("std");
const Allocator = std.mem.Allocator;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const types = @import("consensus_types");
const preset = @import("preset").preset;
const c = @import("constants");
const Node = @import("persistent_merkle_tree").Node;
const ForkTypes = @import("fork_types").ForkTypes;

/// Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag
const TIMELY_TARGET = 1 << c.TIMELY_TARGET_FLAG_INDEX;

const HYSTERESIS_INCREMENT = preset.EFFECTIVE_BALANCE_INCREMENT / preset.HYSTERESIS_QUOTIENT;
const DOWNWARD_THRESHOLD = HYSTERESIS_INCREMENT * preset.HYSTERESIS_DOWNWARD_MULTIPLIER;
const UPWARD_THRESHOLD = HYSTERESIS_INCREMENT * preset.HYSTERESIS_UPWARD_MULTIPLIER;

/// this function also update EpochTransitionCache
pub fn processEffectiveBalanceUpdates(
    comptime fork: ForkSeq,
    allocator: Allocator,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    cache: *EpochTransitionCache,
) !usize {
    var validators = try state.validators();
    const effective_balance_increments = epoch_cache.getEffectiveBalanceIncrements().items;
    var next_epoch_total_active_balance_by_increment: u64 = 0;

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

    var num_update: usize = 0;
    for (balances, 0..) |balance, i| {
        var effective_balance_increment = effective_balance_increments[i];
        var effective_balance = @as(u64, effective_balance_increment) * preset.EFFECTIVE_BALANCE_INCREMENT;
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
            // Update the state tree
            // Should happen rarely, so it's fine to update the tree
            var validator = try validators.get(i);
            effective_balance = @min(
                balance - (balance % preset.EFFECTIVE_BALANCE_INCREMENT),
                effective_balance_limit,
            );
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

            effective_balance_increment = new_effective_balance_increment;
            effective_balance_increments[i] = effective_balance_increment;
            num_update += 1;
        }

        // TODO: Do this in afterEpochTransitionCache, looping a Uint8Array should be very cheap
        // post-electra we may add new validator to registry in processPendingDeposits()
        if (i < cache.is_active_next_epoch.len and cache.is_active_next_epoch[i]) {
            // We track nextEpochTotalActiveBalanceByIncrement as ETH to fit total network balance in a JS number (53 bits)
            next_epoch_total_active_balance_by_increment += effective_balance_increment;
        }
    }

    cache.next_epoch_total_active_balance_by_increment = next_epoch_total_active_balance_by_increment;
    return num_update;
}

const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;

test "processEffectiveBalanceUpdates - sanity" {
    const allocator = std.testing.allocator;
    const pool_size = 200_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 10_000);
    defer test_state.deinit();

    _ = try processEffectiveBalanceUpdates(
        .electra,
        allocator,
        test_state.cached_state.epoch_cache,
        test_state.cached_state.state.castToFork(.electra),
        test_state.epoch_transition_cache,
    );
}
