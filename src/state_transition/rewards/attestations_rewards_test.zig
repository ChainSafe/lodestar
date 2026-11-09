const std = @import("std");
const types = @import("consensus_types");
const preset = @import("preset").preset;
const Node = @import("persistent_merkle_tree").Node;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const computeAttestationsRewards = @import("attestations_rewards.zig").computeAttestationsRewards;

test "computeAttestationsRewards - participation, slashing, eligibility, filters and leak" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();
    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();
    const state = test_state.cached_state;
    var participation = try state.state.previousEpochParticipation();
    var current_participation = try state.state.currentEpochParticipation();
    for (0..256) |i| {
        try participation.set(i, 0b111);
        try current_participation.set(i, 0b111);
    }
    try participation.set(0, 0);
    try participation.set(1, 0b011);
    var inactivity = try state.state.inactivityScores();
    try inactivity.set(0, 1000);
    var validators = try state.state.validators();
    var slashed = try validators.get(3);
    try slashed.set("slashed", true);
    var inactive = try validators.get(4);
    try inactive.set("activation_epoch", state.epoch_cache.epoch + 1);
    try state.state.commit();
    const root_before = (try state.state.hashTreeRoot()).*;

    const rewards = try computeAttestationsRewards(allocator, state, null);
    defer rewards.deinit(allocator);
    try std.testing.expectEqual(preset.MAX_EFFECTIVE_BALANCE_ELECTRA / preset.EFFECTIVE_BALANCE_INCREMENT + 1, rewards.ideal_rewards.len);
    try std.testing.expectEqual(@as(u64, 0), rewards.ideal_rewards[0].effective_balance);
    try std.testing.expectEqual(@as(u64, 0), rewards.ideal_rewards[0].source);
    try std.testing.expectEqual(preset.MAX_EFFECTIVE_BALANCE_ELECTRA, rewards.ideal_rewards[rewards.ideal_rewards.len - 1].effective_balance);
    const base_reward = @import("../utils/sync_committee.zig").computeBaseRewardPerIncrement(255 * 32);
    const denominator = 255 * 32 * 64;
    for (rewards.ideal_rewards, 0..) |ideal, increment| {
        const numerator = increment * base_reward * 14 * (253 * 32);
        const expected = @divFloor(numerator, denominator);
        try std.testing.expectEqual(@as(u64, expected), ideal.source);
    }
    try std.testing.expectEqual(@as(usize, 255), rewards.total_rewards.len);
    try std.testing.expectEqual(@as(u64, 5), rewards.total_rewards[4].validator_index);
    const missed = rewards.total_rewards[0];
    try std.testing.expect(missed.source < 0);
    try std.testing.expect(missed.target < 0);
    try std.testing.expectEqual(@as(i64, 0), missed.head);
    const updated_score = 1000 + state.config.chain.INACTIVITY_SCORE_BIAS - state.config.chain.INACTIVITY_SCORE_RECOVERY_RATE;
    const expected_inactivity = @divFloor(@as(u64, 32_000_000_000) * updated_score, state.config.chain.INACTIVITY_SCORE_BIAS * preset.INACTIVITY_PENALTY_QUOTIENT_BELLATRIX);
    try std.testing.expectEqual(-@as(i64, @intCast(expected_inactivity)), missed.inactivity);
    try std.testing.expectEqual(@as(i64, 0), rewards.total_rewards[1].head);
    try std.testing.expect(rewards.total_rewards[1].source > 0);
    try std.testing.expect(rewards.total_rewards[2].head > 0);
    try std.testing.expectEqual(missed.source, rewards.total_rewards[3].source);
    try std.testing.expectEqual(missed.target, rewards.total_rewards[3].target);
    try std.testing.expectEqual(@as(i64, 0), rewards.total_rewards[3].head);
    try std.testing.expectEqual(root_before, (try state.state.hashTreeRoot()).*);

    const selected = try computeAttestationsRewards(allocator, state, &.{ 1, 1, 4, 255, 999 });
    defer selected.deinit(allocator);
    try std.testing.expectEqual(@as(usize, 2), selected.total_rewards.len);
    try std.testing.expectEqual(@as(u64, 1), selected.total_rewards[0].validator_index);
    try std.testing.expectEqual(@as(u64, 255), selected.total_rewards[1].validator_index);
    const empty = try computeAttestationsRewards(allocator, state, &.{});
    defer empty.deinit(allocator);
    try std.testing.expectEqual(@as(usize, 0), empty.total_rewards.len);
    try std.testing.expectEqualDeep(rewards.ideal_rewards, empty.ideal_rewards);

    try state.state.setFinalizedCheckpoint(&.{ .epoch = 0, .root = [_]u8{0} ** 32 });
    try state.state.setPreviousJustifiedCheckpoint(&.{ .epoch = 0, .root = [_]u8{0} ** 32 });
    try state.state.setCurrentJustifiedCheckpoint(&.{ .epoch = 0, .root = [_]u8{0} ** 32 });
    const leak = try computeAttestationsRewards(allocator, state, &.{ 0, 2 });
    defer leak.deinit(allocator);
    try std.testing.expectEqual(@as(u64, 0), leak.ideal_rewards[32].source);
    try std.testing.expectEqual(missed.source, leak.total_rewards[0].source);
    const leak_penalty = @divFloor(@as(u64, 32_000_000_000) * (1000 + state.config.chain.INACTIVITY_SCORE_BIAS), state.config.chain.INACTIVITY_SCORE_BIAS * preset.INACTIVITY_PENALTY_QUOTIENT_BELLATRIX);
    try std.testing.expectEqual(-@as(i64, @intCast(leak_penalty)), leak.total_rewards[0].inactivity);
    try std.testing.expectEqual(@as(i64, 0), leak.total_rewards[1].source);
    try std.testing.expectEqual(@as(i64, 0), leak.total_rewards[1].target);
    try std.testing.expectEqual(@as(i64, 0), leak.total_rewards[1].head);
}

test "memory_safety: computeAttestationsRewards releases scratch state and rewards on allocation failure" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();
    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();
    const state = test_state.cached_state;
    const root_before = (try state.state.hashTreeRoot()).*;

    var counting_allocator = std.testing.FailingAllocator.init(allocator, .{});
    const rewards = try computeAttestationsRewards(counting_allocator.allocator(), state, null);
    rewards.deinit(counting_allocator.allocator());
    try std.testing.expectEqual(counting_allocator.allocated_bytes, counting_allocator.freed_bytes);
    try std.testing.expect(counting_allocator.alloc_index >= 2);

    for (0..counting_allocator.alloc_index) |fail_index| {
        var failing_allocator = std.testing.FailingAllocator.init(allocator, .{ .fail_index = fail_index });
        try std.testing.expectError(error.OutOfMemory, computeAttestationsRewards(failing_allocator.allocator(), state, null));
        try std.testing.expect(failing_allocator.has_induced_failure);
        try std.testing.expectEqual(failing_allocator.allocated_bytes, failing_allocator.freed_bytes);
        try std.testing.expectEqual(root_before, (try state.state.hashTreeRoot()).*);
    }

    const retry = try computeAttestationsRewards(allocator, state, null);
    defer retry.deinit(allocator);
    try std.testing.expectEqual(@as(usize, 256), retry.total_rewards.len);
}

test "computeAttestationsRewards - phase0 unsupported" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();
    var test_state = blk: {
        const state = try allocator.create(AnyBeaconState);
        errdefer allocator.destroy(state);
        state.* = try AnyBeaconState.fromValue(allocator, &pool, .phase0, &types.phase0.BeaconState.default_value);
        errdefer state.deinit();
        break :blk try TestCachedBeaconState.initFromState(allocator, &pool, state, .phase0, 0);
    };
    defer test_state.deinit();
    try std.testing.expectError(error.AttestationsRewardsUnsupportedFork, computeAttestationsRewards(allocator, test_state.cached_state, null));
}

test "computeAttestationsRewards - finalization ends leak before inactivity updates" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();
    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();
    const state = test_state.cached_state;
    try state.state.setFinalizedCheckpoint(&.{ .epoch = 0, .root = [_]u8{0} ** 32 });
    var participation = try state.state.previousEpochParticipation();
    try participation.set(0, 0);
    var inactivity = try state.state.inactivityScores();
    try inactivity.set(0, 1000);
    const root_before = (try state.state.hashTreeRoot()).*;

    const rewards = try computeAttestationsRewards(allocator, state, &.{ 0, 1 });
    defer rewards.deinit(allocator);
    try std.testing.expect(rewards.ideal_rewards[32].source > 0);
    try std.testing.expect(rewards.total_rewards[1].source > 0);
    const updated_score = 1000 + state.config.chain.INACTIVITY_SCORE_BIAS - state.config.chain.INACTIVITY_SCORE_RECOVERY_RATE;
    const penalty = @divFloor(@as(u64, 32_000_000_000) * updated_score, state.config.chain.INACTIVITY_SCORE_BIAS * preset.INACTIVITY_PENALTY_QUOTIENT_BELLATRIX);
    try std.testing.expectEqual(-@as(i64, @intCast(penalty)), rewards.total_rewards[0].inactivity);
    try std.testing.expectEqual(root_before, (try state.state.hashTreeRoot()).*);
    try std.testing.expectEqual(@as(u64, 0), try state.state.finalizedEpoch());
    try std.testing.expectEqual(@as(u64, 1000), try inactivity.get(0));
}
