const std = @import("std");
const Pool = @import("ServingPool.zig");
const Source = @import("admission.zig").Source;
const RequestHandle = @import("events.zig").RequestHandle;
const codec = @import("codec.zig");

test "serving capacity bounds independent sources and retained executions" {
    var pool = try Pool.init(std.testing.allocator, 32, 1, codec.frame_scratch_max);
    defer pool.deinit(std.testing.allocator);
    var sources: [33]Source = undefined;
    for (&sources, 0..) |*source, index| source.* = .{ .ip4 = .{ 192, 0, 2, @intCast(index) } };
    for (sources[0..32], 0..) |source, index| {
        const slot = pool.available(source).?;
        const scratch = pool.acquire(slot, .{ .index = @intCast(index), .generation = 1, .direction = .inbound }, source);
        try std.testing.expectEqual(@as(usize, codec.frame_scratch_max), scratch.len);
        try std.testing.expectEqual(@as(?u16, null), pool.available(source));
    }
    try std.testing.expectEqual(@as(?u16, null), pool.available(sources[32]));
    const retiring: RequestHandle = .{ .index = 0, .generation = 1, .direction = .inbound };
    const serving = pool.retain(retiring) orelse return error.TestUnexpectedResult;
    pool.retire(0);
    try std.testing.expectEqual(@as(?u16, null), pool.available(sources[0]));
    try std.testing.expectEqual(@as(?u16, null), pool.available(sources[32]));
    try std.testing.expect(pool.release(serving));
    try std.testing.expectEqual(@as(?u16, 0), pool.available(sources[32]));
    try std.testing.expectEqual(@as(usize, 32 * codec.frame_scratch_max), pool.scratch.len);
}

test "serving handles reject stale releases across retention and request reuse" {
    var pool = try Pool.init(std.testing.allocator, 1, 1, codec.frame_scratch_max);
    defer pool.deinit(std.testing.allocator);
    const source: Source = .{ .ip4 = .{ 192, 0, 2, 1 } };
    const request: RequestHandle = .{ .index = 0, .generation = 1, .direction = .inbound };
    _ = pool.acquire(0, request, source);
    const first = pool.retain(request).?;
    try std.testing.expect(pool.retain(request) == null);
    try std.testing.expect(pool.release(first));
    try std.testing.expect(!pool.release(first));
    const second = pool.retain(request).?;
    try std.testing.expect(!pool.release(first));
    pool.retire(0);
    try std.testing.expect(pool.available(source) == null);
    try std.testing.expect(pool.release(second));
    try std.testing.expectEqual(@as(?u16, 0), pool.available(source));
    _ = pool.acquire(0, .{ .index = 0, .generation = 2, .direction = .inbound }, source);
    const third = pool.retain(.{ .index = 0, .generation = 2, .direction = .inbound }).?;
    try std.testing.expect(!pool.release(second));
    try std.testing.expect(!pool.release(.{ .index = 1, .generation = third.generation }));
    try std.testing.expect(pool.release(third));
    pool.retire(0);
}

test "serving generations exhaust without wrapping" {
    var pool = try Pool.init(std.testing.allocator, 1, 1, codec.frame_scratch_max);
    defer pool.deinit(std.testing.allocator);
    const source: Source = .{ .ip4 = .{ 192, 0, 2, 1 } };
    const request: RequestHandle = .{ .index = 0, .generation = 1, .direction = .inbound };
    pool.entries[0].generation = std.math.maxInt(u64) - 1;
    _ = pool.acquire(0, request, source);
    const retained = pool.retain(request).?;
    try std.testing.expectEqual(std.math.maxInt(u64), retained.generation);
    try std.testing.expect(pool.release(retained));
    try std.testing.expect(pool.retain(request) == null);
    pool.retire(0);
    try std.testing.expect(pool.available(source) == null);
}
