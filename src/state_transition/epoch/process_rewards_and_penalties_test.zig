//! Tests for `process_rewards_and_penalties.zig`.

const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const processRewardsAndPenalties = @import("process_rewards_and_penalties.zig").processRewardsAndPenalties;

test "memory_safety: processRewardsAndPenalties - sanity" {
    const allocator = std.testing.allocator;
    const pool_size = 200_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 10_000);
    defer test_state.deinit();

    try processRewardsAndPenalties(
        .electra,
        test_state.cached_state.config,
        test_state.cached_state.epoch_cache,
        test_state.cached_state.state.castToFork(.electra),
        test_state.epoch_transition_cache,
        null,
    );

    // Verify replacing the old cached balances does not leak.
    try processRewardsAndPenalties(
        .electra,
        test_state.cached_state.config,
        test_state.cached_state.epoch_cache,
        test_state.cached_state.state.castToFork(.electra),
        test_state.epoch_transition_cache,
        null,
    );
}

test "processRewardsAndPenalties maps compact slashing penalties to validator indices" {
    const allocator = std.testing.allocator;
    const pool_size = 200_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    const validator_count = 256;
    const slashed_index = validator_count - 1;
    const slashing_penalty = 1;
    var test_state = try TestCachedBeaconState.init(allocator, &pool, validator_count);
    defer test_state.deinit();

    const state = test_state.cached_state.state.castToFork(.electra);
    var initial_balances = try state.balances();
    const initial_first_balance = try initial_balances.get(0);
    const initial_slashed_balance = try initial_balances.get(slashed_index);
    const cache = test_state.epoch_transition_cache;
    try cache.indices_to_slash.append(cache.allocator, slashed_index);

    try processRewardsAndPenalties(
        .electra,
        test_state.cached_state.config,
        test_state.cached_state.epoch_cache,
        state,
        cache,
        &.{slashing_penalty},
    );

    const first_balance_without_slashing =
        (try std.math.add(u64, initial_first_balance, cache.rewards[0])) -| cache.penalties[0];
    const slashed_balance_without_slashing =
        (try std.math.add(u64, initial_slashed_balance, cache.rewards[slashed_index])) -| cache.penalties[slashed_index];
    var updated_balances = try state.balances();
    try std.testing.expectEqual(first_balance_without_slashing, try updated_balances.get(0));
    try std.testing.expectEqual(slashed_balance_without_slashing - slashing_penalty, try updated_balances.get(slashed_index));
}
