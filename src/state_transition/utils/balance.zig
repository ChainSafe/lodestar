const std = @import("std");
const Allocator = std.mem.Allocator;
const ForkSeq = @import("config").ForkSeq;
const CachedBeaconState = @import("../cache/state_cache.zig").CachedBeaconState;
const EffectiveBalanceIncrements = @import("../cache/effective_balance_increments.zig").EffectiveBalanceIncrements;
const BeaconState = @import("fork_types").BeaconState;
const ValidatorIndex = @import("consensus_types").primitive.ValidatorIndex.Type;

/// Increase the balance for a validator with the given ``index`` by ``delta``.
pub fn increaseBalance(comptime fork: ForkSeq, state: *BeaconState(fork), index: ValidatorIndex, delta: u64) !void {
    var balances = try state.balances();
    const current = try balances.get(index);
    const next = try std.math.add(u64, current, delta);
    try balances.set(index, next);
}

/// Decrease the balance for a validator with the given ``index`` by ``delta``.
/// Set to 0 when underflow.
pub fn decreaseBalance(comptime fork: ForkSeq, state: *BeaconState(fork), index: ValidatorIndex, delta: u64) !void {
    var balances = try state.balances();
    const current = try balances.get(index);
    const next = if (current > delta) current - delta else 0;
    try balances.set(index, next);
}

pub fn getEffectiveBalanceIncrementsZeroInactive(allocator: Allocator, cached_state: *CachedBeaconState) !EffectiveBalanceIncrements {
    const active_indices = cached_state.epoch_cache.getCurrentShuffling().active_indices;

    var validators_view = try cached_state.state.validators();
    try validators_view.commit();
    const validator_count = try validators_view.length();
    var validators_it = validators_view.iteratorReadonly(0);

    const effective_balance_increments = cached_state.epoch_cache.getEffectiveBalanceIncrements();
    var effective_balance_increments_zero_inactive = try EffectiveBalanceIncrements.initCapacity(allocator, validator_count);
    effective_balance_increments_zero_inactive.appendSliceAssumeCapacity(effective_balance_increments.items[0..validator_count]);

    var j: usize = 0;
    for (0..validator_count) |i| {
        const validator = try validators_it.nextValuePtr();
        const slashed = validator.slashed;
        if (j < active_indices.len and i == active_indices[j]) {
            j += 1;
            if (slashed) {
                effective_balance_increments_zero_inactive.items[i] = 0;
            }
        } else {
            effective_balance_increments_zero_inactive.items[i] = 0;
        }
    }

    return effective_balance_increments_zero_inactive;
}
