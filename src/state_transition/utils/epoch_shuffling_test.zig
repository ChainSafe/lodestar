//! Tests for `epoch_shuffling.zig`.

const std = @import("std");
const preset = @import("preset").preset;
const EpochShuffling = @import("epoch_shuffling.zig").EpochShuffling;
const computeEpochShuffling = @import("epoch_shuffling.zig").computeEpochShuffling;
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const innerShuffleList = @import("swap_or_not_shuffle").innerShuffleList;

test "memory_safety: computeEpochShuffling retains caller ownership on allocation failure" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    const input = try allocator.dupe(u32, &.{ 1, 7, 42 });
    defer allocator.free(input);

    var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    try std.testing.expectError(
        error.OutOfMemory,
        computeEpochShuffling(failing.allocator(), test_state.cached_state.state, input, test_state.cached_state.epoch_cache.epoch),
    );
    try std.testing.expect(failing.has_induced_failure);
    try std.testing.expectEqualSlices(u32, &.{ 1, 7, 42 }, input);
}

test "EpochShuffling matches u64 shuffling near the u32 index limit" {
    const allocator = std.testing.allocator;
    for ([_]usize{ 0, 1, 2, 3, 31, 255, 256, 257, 4097 }) |count| {
        for ([_]u8{ 0, 1, 255 }) |seed_byte| {
            const input = try allocator.alloc(u32, count);
            defer allocator.free(input);
            for (input, 0..) |*index, i| index.* = std.math.maxInt(u32) - @as(u32, @intCast(i * 17));
            const seed = [_]u8{seed_byte} ** 32;

            const expected = try allocator.alloc(u64, input.len);
            defer allocator.free(expected);
            for (input, expected) |index, *dest| dest.* = index;
            try innerShuffleList(u64, expected, &seed, preset.SHUFFLE_ROUND_COUNT, false);

            const actual = blk: {
                const active_indices = try allocator.dupe(u32, input);
                errdefer allocator.free(active_indices);
                break :blk try EpochShuffling.init(allocator, seed, 42, active_indices);
            };
            defer actual.deinit();

            try std.testing.expectEqualSlices(u32, input, actual.active_indices);
            for (expected, actual.shuffling) |want, actual_index| try std.testing.expectEqual(want, actual_index);
            var offset: usize = 0;
            for (actual.committees) |committees| {
                for (committees) |committee| {
                    for (expected[offset..][0..committee.len], committee) |want, actual_index| try std.testing.expectEqual(want, actual_index);
                    offset += committee.len;
                }
            }
            try std.testing.expectEqual(count, offset);
        }
    }
}

test "memory_safety: EpochShuffling.init frees output when committee allocation fails" {
    const allocator = std.testing.allocator;
    const active_indices = try allocator.dupe(u32, &.{ 1, 7, std.math.maxInt(u32) });
    defer allocator.free(active_indices);

    var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 1 });
    try std.testing.expectError(
        error.OutOfMemory,
        EpochShuffling.init(failing.allocator(), [_]u8{0} ** 32, 0, active_indices),
    );
    try std.testing.expect(failing.has_induced_failure);
    try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
    try std.testing.expectEqualSlices(u32, &.{ 1, 7, std.math.maxInt(u32) }, active_indices);
}

test "memory_safety: EpochShuffling.init should free partial allocations on OOM" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(allocator: std.mem.Allocator) !void {
            const active_indices = try allocator.alloc(u32, 256);
            errdefer allocator.free(active_indices);
            for (active_indices, 0..) |*index, i| index.* = @intCast(i);

            const shuffling = try EpochShuffling.init(allocator, [_]u8{0} ** 32, 0, active_indices);
            defer shuffling.deinit();
        }
    }.run, .{});
}
