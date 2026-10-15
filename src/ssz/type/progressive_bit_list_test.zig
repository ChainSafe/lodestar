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
    for ([_]usize{ 0, 1, 7, 8, 248, 255, 256, 257, 504, 511, 512, 513, 1279, 1280, 1281, 5376, 5377, 21760, 21761 }) |len| {
        var value = try Bits.Type.fromBitLen(allocator, len);
        defer value.deinit(allocator);
        for (0..len) |i| value.setAssumeCapacity(i, i % 3 == 0);
        const bytes = try allocator.alloc(u8, Bits.serializedSize(&value));
        defer allocator.free(bytes);
        _ = Bits.serializeIntoBytes(&value, bytes);
        const bytes_before = try allocator.dupe(u8, bytes);
        defer allocator.free(bytes_before);
        const root = try Bits.tree.fromValue(&pool, &value);
        defer pool.unref(root);
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
        var actual: [32]u8 = undefined;
        try Bits.hashTreeRoot(failing.allocator(), &value, &actual);
        try std.testing.expectEqualSlices(u8, root.getRoot(&pool), &actual);
        try Bits.serialized.hashTreeRoot(failing.allocator(), bytes, &actual);
        try std.testing.expectEqualSlices(u8, root.getRoot(&pool), &actual);
        try std.testing.expectEqualSlices(u8, bytes_before, bytes);
        try std.testing.expect(!failing.has_induced_failure);
    }
    var actual: [32]u8 = undefined;
    try std.testing.expectError(error.InvalidSize, Bits.serialized.hashTreeRoot(allocator, &.{}, &actual));
    try std.testing.expectError(error.noPaddingBit, Bits.serialized.hashTreeRoot(allocator, &.{0}, &actual));
}

test "progressive bitlist tree construction streams delimiter boundaries" {
    const allocator = std.testing.allocator;
    const Bits = ProgressiveBitListType();
    for ([_]usize{ 0, 1, 7, 8, 248, 255, 256, 257, 504, 511, 512, 513, 1279, 1280, 1281, 5376, 5377, 21760, 21761 }) |len| {
        var value = try Bits.Type.fromBitLen(allocator, len);
        defer value.deinit(allocator);
        for (0..len) |i| value.setAssumeCapacity(i, i % 3 == 0);
        const bytes = try allocator.alloc(u8, Bits.serializedSize(&value));
        defer allocator.free(bytes);
        _ = Bits.serializeIntoBytes(&value, bytes);
        const bytes_before = try allocator.dupe(u8, bytes);
        defer allocator.free(bytes_before);
        var expected: [32]u8 = undefined;
        try Bits.hashTreeRoot(allocator, &value, &expected);
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = failing.allocator(), .pool_size = 8192 });
        defer pool.deinit();
        const baseline = pool.getNodesInUse();
        const from_value = try Bits.tree.fromValue(&pool, &value);
        try std.testing.expectEqualSlices(u8, &expected, from_value.getRoot(&pool));
        pool.unref(from_value);
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
        const from_bytes = try Bits.tree.deserializeFromBytes(&pool, bytes);
        try std.testing.expectEqualSlices(u8, &expected, from_bytes.getRoot(&pool));
        try std.testing.expectEqualSlices(u8, bytes_before, bytes);
        pool.unref(from_bytes);
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
        try std.testing.expectError(error.InvalidSize, Bits.tree.deserializeFromBytes(&pool, &.{}));
        try std.testing.expectError(error.noPaddingBit, Bits.tree.deserializeFromBytes(&pool, &.{0}));
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
        try std.testing.expect(!failing.has_induced_failure);
    }
}

test "progressive bitlist tree reads stream data and delimiters" {
    const allocator = std.testing.allocator;
    const Bits = ProgressiveBitListType();
    for ([_]usize{ 0, 1, 7, 8, 255, 256, 257, 1279, 1280, 1281, 5376, 5377, 21760, 21761 }) |len| {
        var value = try Bits.Type.fromBitLen(allocator, len);
        defer value.deinit(allocator);
        for (0..len) |i| value.setAssumeCapacity(i, i % 3 == 0);
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = failing.allocator(), .pool_size = 8192 });
        defer pool.deinit();
        const root = try Bits.tree.fromValue(&pool, &value);
        defer pool.unref(root);
        failing.fail_index = failing.alloc_index;
        var output_allocator = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 1 });
        var actual = Bits.default_value;
        defer actual.deinit(output_allocator.allocator());
        try Bits.tree.toValue(output_allocator.allocator(), root, &pool, &actual);
        try std.testing.expect(Bits.equals(&value, &actual));
        try std.testing.expect(!output_allocator.has_induced_failure);
        const size = Bits.serializedSize(&value);
        try std.testing.expectEqual(size, try Bits.tree.serializedSize(root, &pool));
        const expected = try allocator.alloc(u8, size);
        defer allocator.free(expected);
        const bytes = try allocator.alloc(u8, size);
        defer allocator.free(bytes);
        _ = Bits.serializeIntoBytes(&value, expected);
        try std.testing.expectEqual(size, try Bits.tree.serializeIntoBytes(root, &pool, bytes));
        try std.testing.expectEqualSlices(u8, expected, bytes);
        try std.testing.expectError(error.InvalidSize, Bits.tree.serializeIntoBytes(root, &pool, bytes[0 .. size - 1]));
        try std.testing.expect(!failing.has_induced_failure);
    }
}

test "memory_safety: progressive bitlist tree reads preserve output on malformed terminators" {
    const allocator = std.testing.allocator;
    const Bits = ProgressiveBitListType();
    for ([_]usize{ 0, 1, 257 }) |len| {
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 128 });
        defer pool.deinit();
        var source = try Bits.Type.fromBitLen(allocator, len);
        defer source.deinit(allocator);
        const good = try Bits.tree.fromValue(&pool, &source);
        defer pool.unref(good);
        const bad_leaf = try pool.createLeafFromUint(1);
        const terminator: @import("persistent_merkle_tree").Gindex = @enumFromInt(@as(u64, if (len == 0) 2 else if (len <= 256) 5 else 11));
        const bad = try good.setNode(&pool, terminator, bad_leaf);
        defer pool.unref(bad);
        var out = Bits.default_value;
        defer out.deinit(allocator);
        try std.testing.expectError(error.InvalidTerminatorNode, Bits.tree.toValue(allocator, bad, &pool, &out));
        try std.testing.expectEqual(@as(usize, 0), out.bit_len);
        try std.testing.expectEqual(@as(usize, 0), out.data.capacity);
        var bytes: [33]u8 = undefined;
        try std.testing.expectError(error.InvalidTerminatorNode, Bits.tree.serializeIntoBytes(bad, &pool, &bytes));
    }
}

test "memory_safety: progressive bitlist tree.toValue leaves default out on OOM" {
    const allocator = std.testing.allocator;
    const Bits = ProgressiveBitListType();
    var source = try Bits.Type.fromBitLen(allocator, 257);
    defer source.deinit(allocator);
    source.setAssumeCapacity(256, true);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 32 });
    defer pool.deinit();
    const root = try Bits.tree.fromValue(&pool, &source);
    defer pool.unref(root);

    try std.testing.checkAllAllocationFailures(allocator, struct {
        fn run(output_allocator: std.mem.Allocator, input_pool: *Node.Pool, input_root: Node.Id, expected: *const Bits.Type) !void {
            var out = Bits.default_value;
            defer out.deinit(output_allocator);
            Bits.tree.toValue(output_allocator, input_root, input_pool, &out) catch |err| {
                try std.testing.expectEqual(error.OutOfMemory, err);
                try std.testing.expectEqual(@as(usize, 0), out.bit_len);
                try std.testing.expectEqual(@as(usize, 0), out.data.capacity);
                return err;
            };
            try std.testing.expect(Bits.equals(expected, &out));
        }
    }.run, .{ &pool, root, &source });
}
