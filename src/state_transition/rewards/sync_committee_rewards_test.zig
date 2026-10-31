const std = @import("std");
const types = @import("consensus_types");
const preset = @import("preset").preset;
const Node = @import("persistent_merkle_tree").Node;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const SyncCommitteeCache = @import("../cache/sync_committee_cache.zig").SyncCommitteeCache;
const SyncCommitteeCacheRc = @import("../cache/sync_committee_cache.zig").SyncCommitteeCacheRc;
const SyncCommitteeReward = @import("sync_committee_rewards.zig").SyncCommitteeReward;
const computeSyncCommitteeRewards = @import("sync_committee_rewards.zig").computeSyncCommitteeRewards;

test "computeSyncCommitteeRewards - signed deltas, duplicate positions, ordering and read-only state" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();
    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();
    const state = test_state.cached_state;

    var indices = [_]u64{2} ** preset.SYNC_COMMITTEE_SIZE;
    @memcpy(indices[0..4], &[_]u64{ 9, 3, 9, 1 });
    var committee = try SyncCommitteeCache.initValidatorIndices(allocator, &indices);
    const committee_rc = SyncCommitteeCacheRc.create(allocator, committee) catch |err| {
        committee.deinit();
        return err;
    };
    state.epoch_cache.current_sync_committee_indexed.unref();
    state.epoch_cache.current_sync_committee_indexed = committee_rc;
    state.epoch_cache.sync_participant_reward = 11;
    var aggregate = types.altair.SyncAggregate.default_value;
    try aggregate.sync_committee_bits.set(0, true);
    try aggregate.sync_committee_bits.set(3, true);
    const root_before = (try state.state.hashTreeRoot()).*;

    var failing_allocator = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    try std.testing.expectError(
        error.OutOfMemory,
        computeSyncCommitteeRewards(failing_allocator.allocator(), state, &aggregate),
    );
    try std.testing.expect(failing_allocator.has_induced_failure);
    try std.testing.expectEqual(root_before, (try state.state.hashTreeRoot()).*);

    const rewards = try computeSyncCommitteeRewards(allocator, state, &aggregate);
    defer allocator.free(rewards);
    const expected = [_]SyncCommitteeReward{
        .{ .validator_index = 9, .reward = 0 },
        .{ .validator_index = 3, .reward = -11 },
        .{ .validator_index = 1, .reward = 11 },
        .{ .validator_index = 2, .reward = -11 * (preset.SYNC_COMMITTEE_SIZE - 4) },
    };
    try std.testing.expectEqualDeep(&expected, rewards);
    try std.testing.expectEqual(root_before, (try state.state.hashTreeRoot()).*);
    try std.testing.expectEqual(committee_rc, state.epoch_cache.current_sync_committee_indexed);
}

test "computeSyncCommitteeRewards - phase0 unsupported" {
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

    try std.testing.expectError(
        error.SyncCommitteeRewardsUnsupportedFork,
        computeSyncCommitteeRewards(allocator, test_state.cached_state, &types.altair.SyncAggregate.default_value),
    );
}
