const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const GENESIS_EPOCH = @import("preset").GENESIS_EPOCH;
const preset = @import("preset").preset;
const getAttestationDeltas = @import("./get_attestation_deltas.zig").getAttestationDeltas;
const getRewardsAndPenaltiesAltair = @import("./get_rewards_and_penalties.zig").getRewardsAndPenaltiesAltair;

pub fn processRewardsAndPenalties(
    comptime fork: ForkSeq,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    cache: *EpochTransitionCache,
    slashing_penalties: ?[]const u64,
) !void {
    // No rewards are applied at the end of `GENESIS_EPOCH` because rewards are for work done in the previous epoch
    if (cache.current_epoch == GENESIS_EPOCH) {
        return;
    }

    const rewards = cache.rewards;
    const penalties = cache.penalties;
    try getRewardsAndPenalties(fork, config, epoch_cache, state, cache, rewards, penalties);

    var balances_view = try state.balances();
    try balances_view.commit();
    const validator_count = try balances_view.length();

    // applyPendingDeposit appends with appendAssumeCapacity for each validator it adds, at most
    // MAX_PENDING_DEPOSITS_PER_EPOCH per epoch, so this headroom is required.
    var new_balances: std.ArrayList(u64) = try .initCapacity(
        cache.allocator,
        validator_count + preset.MAX_PENDING_DEPOSITS_PER_EPOCH,
    );
    errdefer new_balances.deinit(cache.allocator);

    const balances = new_balances.addManyAsSliceAssumeCapacity(validator_count);
    _ = try balances_view.getAllInto(balances);

    for (rewards, penalties, balances) |reward, penalty, *balance| {
        balance.* = (try std.math.add(u64, balance.*, reward)) -| penalty;
    }
    if (slashing_penalties) |slashings| {
        std.debug.assert(slashings.len == cache.indices_to_slash.items.len);
        for (cache.indices_to_slash.items, slashings) |index, slashing| {
            balances[index] -|= slashing;
        }
    }

    try state.setBalances(&new_balances);

    if (cache.balances) |*old_balances| {
        old_balances.deinit(cache.allocator);
    }
    // Populate cache.balances for reuse by the validator monitor and
    // more importantly processEffectiveBalanceUpdates() doesn't need to
    // get from tree view state which has to commit.
    cache.balances = new_balances;
}

pub fn getRewardsAndPenalties(
    comptime fork: ForkSeq,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    cache: *const EpochTransitionCache,
    rewards: []u64,
    penalties: []u64,
) !void {
    if (comptime fork == .phase0) {
        return try getAttestationDeltas(epoch_cache, cache, try state.finalizedEpoch(), rewards, penalties);
    }
    return try getRewardsAndPenaltiesAltair(fork, config, epoch_cache, state, cache, rewards, penalties);
}

test {
    _ = @import("process_rewards_and_penalties_test.zig");
}
