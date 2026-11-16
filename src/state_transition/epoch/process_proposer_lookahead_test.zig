const std = @import("std");
const preset = @import("preset").preset;
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const upgradeStateToFulu = @import("../slot/upgrade_state_to_fulu.zig").upgradeStateToFulu;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const computeEpochShufflingForFork = @import("../utils/epoch_shuffling.zig").computeEpochShufflingForFork;
const process_proposer_lookahead = @import("process_proposer_lookahead.zig");
const processProposerLookahead = process_proposer_lookahead.processProposerLookahead;
const startProposerLookaheadShuffling = process_proposer_lookahead.startProposerLookaheadShuffling;

test "memory_safety: proposer lookahead shuffling belongs to the epoch cache allocator" {
    const allocator = std.testing.allocator;
    inline for (.{ true, false }) |start_async| {
        const pool_size = 375_000;
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
        defer pool.deinit();

        var test_state = try TestCachedBeaconState.init(allocator, &pool, 10_000);
        defer test_state.deinit();

        const fulu_state = try upgradeStateToFulu(
            allocator,
            test_state.cached_state.config,
            test_state.cached_state.epoch_cache,
            try test_state.cached_state.state.tryCastToFork(.electra),
        );
        test_state.cached_state.state.* = .{ .fulu = fulu_state.inner };

        const current_epoch = computeEpochAtSlot(try test_state.cached_state.state.slot());
        const new_epoch = current_epoch + preset.MIN_SEED_LOOKAHEAD + 1;
        const fulu = test_state.cached_state.state.castToFork(.fulu);
        const expected_shuffling = blk: {
            const expected_indices = try allocator.dupe(u32, test_state.epoch_transition_cache.next_shuffling_active_indices);
            errdefer allocator.free(expected_indices);
            break :blk try computeEpochShufflingForFork(.fulu, allocator, fulu, expected_indices, new_epoch);
        };
        defer expected_shuffling.deinit();

        if (start_async) {
            try startProposerLookaheadShuffling(
                .fulu,
                std.testing.io,
                test_state.cached_state.epoch_cache,
                fulu,
                test_state.epoch_transition_cache,
            );
        }

        var caller_allocator_state = std.testing.FailingAllocator.init(allocator, .{});

        try processProposerLookahead(
            .fulu,
            caller_allocator_state.allocator(),
            test_state.cached_state.epoch_cache,
            test_state.cached_state.state.castToFork(.fulu),
            test_state.epoch_transition_cache,
        );

        const next_shuffling = test_state.epoch_transition_cache.next_shuffling.?;
        try std.testing.expectEqual(caller_allocator_state.allocated_bytes, caller_allocator_state.freed_bytes);
        try std.testing.expectEqual(allocator.ptr, next_shuffling.allocator.ptr);

        const actual_shuffling = next_shuffling.get();
        try std.testing.expectEqual(allocator.ptr, actual_shuffling.allocator.ptr);
        try std.testing.expectEqualSlices(u32, expected_shuffling.active_indices, actual_shuffling.active_indices);
        try std.testing.expectEqualSlices(u32, expected_shuffling.shuffling, actual_shuffling.shuffling);
    }
}

test "memory_safety: proposer lookahead should leave the shuffle job for deinit on selection OOM" {
    const allocator = std.testing.allocator;
    const pool_size = 375_000;
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
    const fulu = test_state.cached_state.state.castToFork(.fulu);

    try startProposerLookaheadShuffling(
        .fulu,
        std.testing.io,
        epoch_cache,
        fulu,
        test_state.epoch_transition_cache,
    );

    var caller_allocator_state = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });

    try std.testing.expectError(error.OutOfMemory, processProposerLookahead(
        .fulu,
        caller_allocator_state.allocator(),
        epoch_cache,
        fulu,
        test_state.epoch_transition_cache,
    ));

    try std.testing.expect(test_state.epoch_transition_cache.shuffling_job != null);
    try std.testing.expect(test_state.epoch_transition_cache.next_shuffling == null);
}
