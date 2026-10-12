//! Tests for `progressive_bit_list.zig`.

const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const ProgressiveBitListType = @import("progressive_bit_list.zig").ProgressiveBitListType;

test "ProgressiveBitListType - sanity" {
    const allocator = std.testing.allocator;
    const Bits = ProgressiveBitListType();
    var b: Bits.Type = try Bits.Type.fromBitLen(allocator, 30);
    defer b.deinit(allocator);

    b.setAssumeCapacity(2, true);

    const b_buf = try allocator.alloc(u8, Bits.serializedSize(&b));
    defer allocator.free(b_buf);

    _ = Bits.serializeIntoBytes(&b, b_buf);
    var decoded = Bits.default_value;
    defer Bits.deinit(allocator, &decoded);
    try Bits.deserializeFromBytes(allocator, b_buf, &decoded);

    try std.testing.expect(try decoded.get(0) == false);
    try std.testing.expect(try decoded.get(2) == true);
}

test "ProgressiveBitListType - shrinking clears truncated bits" {
    const allocator = std.testing.allocator;
    const Bits = ProgressiveBitListType();
    var bits = try Bits.Type.fromBitLen(allocator, 8);
    defer bits.deinit(allocator);

    bits.setAssumeCapacity(7, true);
    try bits.resize(allocator, 1);

    var serialized: [1]u8 = undefined;
    _ = Bits.serializeIntoBytes(&bits, &serialized);

    var round_trip = Bits.default_value;
    defer round_trip.deinit(allocator);
    try Bits.deserializeFromBytes(allocator, &serialized, &round_trip);

    try std.testing.expectEqual(@as(usize, 1), round_trip.bit_len);
}

fn expectProgressiveFromValuePoolExhaustionReclaimsNodes(
    comptime ST: type,
    value: *const ST.Type,
    max_available_nodes: usize,
) !void {
    var saw_failure = false;

    // Start with no room and add one slot per attempt. This walks each partial build until the
    // first capacity that can finish the value.
    for (0..max_available_nodes + 1) |available_nodes| {
        var pool = try Node.Pool.init(.{
            .page_allocator = std.testing.allocator,
            .allocator = std.testing.allocator,
            .pool_size = @intCast(available_nodes),
        });
        defer pool.deinit();

        const baseline = pool.getNodesInUse();
        const root = ST.tree.fromValue(&pool, value) catch |err| {
            try std.testing.expectEqual(error.PoolExhausted, err);
            try std.testing.expectEqual(baseline, pool.getNodesInUse());
            saw_failure = true;
            continue;
        };
        pool.unref(root);
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
        try std.testing.expect(saw_failure);
        return;
    }
    return error.TestUnexpectedResult;
}

test "memory_safety: progressive bit list tree.fromValue reclaims unpublished nodes on pool exhaustion" {
    const Bits = ProgressiveBitListType();
    var value = try Bits.Type.fromBitLen(std.testing.allocator, 300);
    defer value.deinit(std.testing.allocator);

    try expectProgressiveFromValuePoolExhaustionReclaimsNodes(Bits, &value, 32);
}

test "progressive bitlist hashing streams delimiter boundaries without allocation" {
    const allocator = std.testing.allocator;
    const Bits = ProgressiveBitListType();
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 8192 });
    defer pool.deinit();
    for ([_]usize{ 0, 1, 7, 8, 255, 256, 257, 1279, 1280, 1281, 5376, 5377, 21760, 21761 }) |len| {
        var value = try Bits.Type.fromBitLen(allocator, len);
        defer value.deinit(allocator);
        for (0..len) |i| value.setAssumeCapacity(i, i % 3 == 0);
        const bytes = try allocator.alloc(u8, Bits.serializedSize(&value));
        defer allocator.free(bytes);
        _ = Bits.serializeIntoBytes(&value, bytes);
        const root = try Bits.tree.fromValue(&pool, &value);
        defer pool.unref(root);
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
        var actual: [32]u8 = undefined;
        try Bits.hashTreeRoot(failing.allocator(), &value, &actual);
        try std.testing.expectEqualSlices(u8, root.getRoot(&pool), &actual);
        try Bits.serialized.hashTreeRoot(failing.allocator(), bytes, &actual);
        try std.testing.expectEqualSlices(u8, root.getRoot(&pool), &actual);
        try std.testing.expect(!failing.has_induced_failure);
    }
    var actual: [32]u8 = undefined;
    try std.testing.expectError(error.InvalidSize, Bits.serialized.hashTreeRoot(allocator, &.{}, &actual));
    try std.testing.expectError(error.noPaddingBit, Bits.serialized.hashTreeRoot(allocator, &.{0}, &actual));
}
