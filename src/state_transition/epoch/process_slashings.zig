const std = @import("std");
const preset = @import("preset").preset;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const decreaseBalance = @import("../utils//balance.zig").decreaseBalance;
const EFFECTIVE_BALANCE_INCREMENT = preset.EFFECTIVE_BALANCE_INCREMENT;
const PROPORTIONAL_SLASHING_MULTIPLIER = preset.PROPORTIONAL_SLASHING_MULTIPLIER;
const PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR = preset.PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR;
const PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX = preset.PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX;
const Node = @import("persistent_merkle_tree").Node;

pub fn processSlashings(
    comptime fork: ForkSeq,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    cache: *const EpochTransitionCache,
    update_balance: bool,
) ![]const u64 {
    const slashing_penalties = cache.slashing_penalties;
    const empty_penalties = &[_]u64{};
    if (cache.indices_to_slash.items.len == 0) {
        return empty_penalties;
    }
    std.debug.assert(slashing_penalties.len == cache.indices_to_slash.items.len);
    const total_balance_by_increment = cache.total_active_stake_by_increment;
    const proportional_slashing_multiplier: u64 =
        if (comptime fork == .phase0)
            PROPORTIONAL_SLASHING_MULTIPLIER
        else if (comptime fork == .altair)
            PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR
        else
            PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX;

    const effective_balance_increments = epoch_cache.getEffectiveBalanceIncrements().items;
    const adjusted_total_slashing_balance_by_increment = @min(epoch_cache.total_slashings_by_increment * proportional_slashing_multiplier, total_balance_by_increment);
    const increment = EFFECTIVE_BALANCE_INCREMENT;

    const penalty_per_effective_balance_increment = @divFloor((adjusted_total_slashing_balance_by_increment * increment), total_balance_by_increment);

    // effective_balance_increment is bounded by max effective balance (32 pre-Electra, 2048 post-Electra).
    const max_effective = comptime if (fork.gte(.electra)) preset.MAX_EFFECTIVE_BALANCE_ELECTRA else preset.MAX_EFFECTIVE_BALANCE;
    const max_increment = comptime max_effective / EFFECTIVE_BALANCE_INCREMENT + 1;
    var penalties_by_effective_balance_increment: [max_increment]?u64 = .{null} ** max_increment;

    for (cache.indices_to_slash.items, 0..) |index, penalty_index| {
        const effective_balance_increment = effective_balance_increments[index];
        const penalty: u64 = if (penalties_by_effective_balance_increment[effective_balance_increment]) |penalty| penalty else blk: {
            const p = if (comptime fork.gte(.electra))
                penalty_per_effective_balance_increment * effective_balance_increment
            else
                @divFloor(effective_balance_increment * adjusted_total_slashing_balance_by_increment, total_balance_by_increment) * increment;
            penalties_by_effective_balance_increment[effective_balance_increment] = p;
            break :blk p;
        };
        if (update_balance) {
            try decreaseBalance(fork, state, index, penalty);
        } else {
            slashing_penalties[penalty_index] = penalty;
        }
    }

    return if (update_balance) empty_penalties else slashing_penalties;
}

pub fn getTotalSlashingsByIncrement(
    comptime fork: ForkSeq,
    state: *BeaconState(fork),
) !u64 {
    var total_slashings_by_increment: u64 = 0;
    var slashings = try state.slashings();
    const slashings_len = @TypeOf(slashings.*).length;
    for (0..slashings_len) |i| {
        const slashing = try slashings.get(i);
        total_slashings_by_increment += @divFloor(slashing, preset.EFFECTIVE_BALANCE_INCREMENT);
    }

    return total_slashings_by_increment;
}

test {
    _ = @import("./process_slashings_test.zig");
}
