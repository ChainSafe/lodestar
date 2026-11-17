//! Tests for `epoch_transition_cache.zig`.

const std = @import("std");
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const upgradeStateToFulu = @import("../slot/upgrade_state_to_fulu.zig").upgradeStateToFulu;
const Node = @import("persistent_merkle_tree").Node;
const EpochTransitionCache = @import("epoch_transition_cache.zig").EpochTransitionCache;
const deinitReusedEpochTransitionCache = @import("epoch_transition_cache.zig").deinitReusedEpochTransitionCache;
const metrics = @import("../metrics.zig");
const preset = @import("preset").preset;

test "shuffling job records completed builds" {
    const allocator = std.testing.allocator;
    try metrics.init(allocator, std.testing.io, .{});
    defer metrics.deinit();

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 200_000 });
    defer pool.deinit();

    {
        var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
        defer test_state.deinit();

        const cache = test_state.epoch_transition_cache;
        const seed = [_]u8{0} ** 32;
        const epoch = cache.current_epoch + 2;
        try cache.startShuffling(allocator, std.testing.io, seed, epoch);
        const shuffling = try cache.joinShuffling();
        shuffling.deinit();

        try cache.startShuffling(allocator, std.testing.io, seed, epoch);
    }

    var aw: std.Io.Writer.Allocating = .init(allocator);
    defer aw.deinit();
    try metrics.write(&aw.writer);
    try std.testing.expect(std.mem.find(u8, aw.written(), "lodestar_stfn_epoch_shuffling_job_seconds_count 2\n") != null);
}

test "EpochTransitionCache - finalProcessEpoch" {
    const allocator = std.testing.allocator;
    const pool_size = 350_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    const fulu_state = try upgradeStateToFulu(
        allocator,
        test_state.cached_state.config,
        test_state.cached_state.epoch_cache,
        try test_state.cached_state.state.tryCastToFork(.electra),
    );
    test_state.cached_state.state.* = .{ .fulu = fulu_state.inner };

    const epoch_cache = test_state.cached_state.epoch_cache;
    try epoch_cache.finalProcessEpoch(test_state.cached_state.state);
}

test "EpochTransitionCache stores added compounding flags in a fixed tail" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 200_000 });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    const cache = test_state.epoch_transition_cache;
    const initial_validator_count = try test_state.cached_state.state.validatorsCount();
    for (0..preset.MAX_PENDING_DEPOSITS_PER_EPOCH) |i| {
        cache.appendCompoundingValidatorFlag(i % 2 == 0);
    }
    for (0..preset.MAX_PENDING_DEPOSITS_PER_EPOCH) |i| {
        try std.testing.expectEqual(i % 2 == 0, cache.isCompoundingValidator(initial_validator_count + i));
    }
}

test "EpochTransitionCache.beforeProcessEpoch" {
    const allocator = std.testing.allocator;
    const validator_count_arr = &.{ 256, 10_000 };

    inline for (validator_count_arr) |validator_count| {
        const pool_size = 200_000;
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
        defer pool.deinit();

        var test_state = try TestCachedBeaconState.init(allocator, &pool, validator_count);
        defer test_state.deinit();

        var epoch_transition_cache = try EpochTransitionCache.init(
            allocator,
            test_state.cached_state.config,
            test_state.cached_state.epoch_cache,
            test_state.cached_state.state,
        );
        defer epoch_transition_cache.deinit();
    }

    deinitReusedEpochTransitionCache();
}

test "memory_safety: fixed compounding flag tail does not allocate for sequential callers" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 200_000 });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    test_state.epoch_transition_cache.deinit();
    allocator.destroy(test_state.epoch_transition_cache);
    defer {
        test_state.cached_state.deinit();
        allocator.destroy(test_state.cached_state);
        test_state.pubkey_cache.deinit();
        allocator.destroy(test_state.pubkey_cache);
        deinitReusedEpochTransitionCache();
        allocator.destroy(test_state.config);
        allocator.free(test_state.owned_blob_schedule);
        allocator.free(test_state.owned_config_name);
    }

    var second_caller = std.testing.FailingAllocator.init(allocator, .{});

    var cache = try EpochTransitionCache.init(
        second_caller.allocator(),
        test_state.cached_state.config,
        test_state.cached_state.epoch_cache,
        test_state.cached_state.state,
    );
    defer cache.deinit();

    const initial_validator_count = try test_state.cached_state.state.validatorsCount();
    const bytes_before = second_caller.allocated_bytes;
    for (0..preset.MAX_PENDING_DEPOSITS_PER_EPOCH) |i| {
        cache.appendCompoundingValidatorFlag(i % 2 == 0);
    }

    try std.testing.expectEqual(bytes_before, second_caller.allocated_bytes);
    for (0..preset.MAX_PENDING_DEPOSITS_PER_EPOCH) |i| {
        try std.testing.expectEqual(i % 2 == 0, cache.isCompoundingValidator(initial_validator_count + i));
    }
}

test "native progressive balance mismatch negative control reaches scraped counters" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 200_000 });
    defer pool.deinit();
    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    try metrics.init(allocator, std.testing.io, .{});
    defer metrics.deinit();
    const name = "lodestar_stfn_progressive_balances_mismatches_total";
    {
        var before: std.Io.Writer.Allocating = .init(allocator);
        defer before.deinit();
        try metrics.write(&before.writer);
        try std.testing.expect(std.mem.find(u8, before.written(), "# TYPE " ++ name ++ " counter\n") != null);
        try std.testing.expect(std.mem.find(u8, before.written(), name ++ "{") == null);
    }

    // Corrupt the actual cache, not the metric or its output. Epoch processing must
    // independently recompute both totals, observe the mismatch, and repair the cache.
    const epoch_cache = test_state.cached_state.epoch_cache;
    const current = epoch_cache.current_target_unslashed_balance_increments;
    const previous = epoch_cache.previous_target_unslashed_balance_increments;
    epoch_cache.current_target_unslashed_balance_increments += 1;
    epoch_cache.previous_target_unslashed_balance_increments += 2;
    for (0..2) |_| {
        var cache = try EpochTransitionCache.init(
            allocator,
            test_state.cached_state.config,
            epoch_cache,
            test_state.cached_state.state,
        );
        defer cache.deinit();
        try std.testing.expectEqual(current, epoch_cache.current_target_unslashed_balance_increments);
        try std.testing.expectEqual(previous, epoch_cache.previous_target_unslashed_balance_increments);

        // metrics.write is the same registry scrape used by the NAPI metrics bridge.
        // The second, uncorrupted pass must leave each counter at exactly one.
        var after: std.Io.Writer.Allocating = .init(allocator);
        defer after.deinit();
        try metrics.write(&after.writer);
        try std.testing.expect(std.mem.find(u8, after.written(), name ++ "{target=\"current\"} 1\n") != null);
        try std.testing.expect(std.mem.find(u8, after.written(), name ++ "{target=\"previous\"} 1\n") != null);
    }
}
