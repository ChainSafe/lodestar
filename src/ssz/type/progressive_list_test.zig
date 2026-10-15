//! Tests for `progressive_list.zig`.

const std = @import("std");
const BoolType = @import("bool.zig").BoolType;
const ProgressiveBitListType = @import("progressive_bit_list.zig").ProgressiveBitListType;
const Node = @import("persistent_merkle_tree").Node;
const FixedProgressiveListType = @import("progressive_list.zig").FixedProgressiveListType;
const VariableProgressiveListType = @import("progressive_list.zig").VariableProgressiveListType;
const UintType = @import("uint.zig").UintType;
const FixedContainerType = @import("container.zig").FixedContainerType;

test "ListType - sanity" {
    const allocator = std.testing.allocator;

    const Bytes = FixedProgressiveListType(UintType(8));

    var b: Bytes.Type = Bytes.default_value;
    defer b.deinit(allocator);
    try b.append(allocator, 5);

    const b_buf = try allocator.alloc(u8, Bytes.serializedSize(&b));
    defer allocator.free(b_buf);

    _ = Bytes.serializeIntoBytes(&b, b_buf);

    var b_decoded: Bytes.Type = Bytes.default_value;
    defer b_decoded.deinit(allocator);

    try Bytes.deserializeFromBytes(allocator, b_buf, &b_decoded);
    try std.testing.expect(Bytes.equals(&b, &b_decoded));

    const BytesBytes = VariableProgressiveListType(Bytes);
    var b2: BytesBytes.Type = BytesBytes.default_value;
    defer b2.deinit(allocator);
    const b_elem: Bytes.Type = Bytes.default_value;
    try b2.append(allocator, b_elem);

    const b2_buf = try allocator.alloc(u8, BytesBytes.serializedSize(&b2));
    defer allocator.free(b2_buf);

    _ = BytesBytes.serializeIntoBytes(&b2, b2_buf);

    var b2_decoded: BytesBytes.Type = BytesBytes.default_value;
    defer BytesBytes.deinit(allocator, &b2_decoded);

    try BytesBytes.deserializeFromBytes(allocator, b2_buf, &b2_decoded);
    try std.testing.expect(BytesBytes.equals(&b2, &b2_decoded));
}

test "fixed progressive list tree size needs no allocation" {
    const allocator = std.testing.allocator;
    const Pair = FixedContainerType(struct { a: UintType(64), b: UintType(64) });
    inline for (.{ UintType(8), UintType(64), Pair }) |Element| {
        const List = FixedProgressiveListType(Element);
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var pool = try Node.Pool.init(.{
            .page_allocator = allocator,
            .allocator = failing.allocator(),
            .pool_size = 128,
        });
        defer pool.deinit();

        var value = List.default_value;
        defer List.deinit(allocator, &value);
        for ([_]usize{ 0, 1, 5, 21 }) |len| {
            try value.resize(allocator, len);
            @memset(value.items, Element.default_value);
            const root = try List.tree.fromValue(&pool, &value);
            defer pool.unref(root);

            failing.fail_index = failing.alloc_index;
            try std.testing.expectEqual(len * Element.fixed_size, try List.tree.serializedSize(root, &pool));
            try std.testing.expect(!failing.has_induced_failure);
            failing.fail_index = std.math.maxInt(usize);
        }
    }
}

test "fixed progressive list tree size rejects overflow" {
    const allocator = std.testing.allocator;
    const List = FixedProgressiveListType(UintType(64));
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 2,
    });
    defer pool.deinit();

    const length_leaf = try pool.createLeafFromUint(std.math.maxInt(usize) / 8 + 1);
    const root = try pool.createBranch(@enumFromInt(0), length_leaf);
    defer pool.unref(root);

    try std.testing.expectError(error.Overflow, List.tree.serializedSize(root, &pool));
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

test "memory_safety: progressive list tree.fromValue reclaims unpublished nodes on pool exhaustion" {
    const List = FixedProgressiveListType(UintType(64));
    var value: List.Type = .empty;
    defer value.deinit(std.testing.allocator);
    for (0..8) |i| try value.append(std.testing.allocator, @intCast(i));

    try expectProgressiveFromValuePoolExhaustionReclaimsNodes(List, &value, 32);
}

test "memory_safety: progressive fixed list byte deserialization leaves default out on error" {
    const List = FixedProgressiveListType(BoolType());
    var out: List.Type = .empty;
    defer out.deinit(std.testing.allocator);

    try std.testing.expectError(
        error.invalidBoolean,
        List.deserializeFromBytes(std.testing.allocator, &.{ 1, 2 }, &out),
    );
    try std.testing.expectEqual(@as(usize, 0), out.items.len);
    try std.testing.expectEqual(@as(usize, 0), out.capacity);
}

test "memory_safety: progressive list tree.toValue preserves out on malformed tree" {
    const List = FixedProgressiveListType(UintType(64));
    var pool = try Node.Pool.init(.{
        .page_allocator = std.testing.allocator,
        .allocator = std.testing.allocator,
        .pool_size = 8,
    });
    defer pool.deinit();

    const invalid_contents = try pool.createLeaf(&([_]u8{0} ** 32));
    errdefer pool.unref(invalid_contents);
    const length = try pool.createLeafFromUint(2);
    errdefer pool.unref(length);
    const root = try pool.createBranch(invalid_contents, length);
    defer pool.unref(root);

    var out: List.Type = .empty;
    defer out.deinit(std.testing.allocator);

    try std.testing.expectError(
        error.InvalidNode,
        List.tree.toValue(std.testing.allocator, root, &pool, &out),
    );
    try std.testing.expectEqual(@as(usize, 0), out.items.len);
    try std.testing.expectEqual(@as(usize, 0), out.capacity);
}

test "memory_safety: variable progressive list byte deserialization leaves default out on OOM" {
    const Bits = ProgressiveBitListType();
    const List = VariableProgressiveListType(Bits);
    var source: List.Type = .empty;
    defer List.deinit(std.testing.allocator, &source);
    for (0..2) |i| {
        var bits = try Bits.Type.fromBitLen(std.testing.allocator, 16 + i);
        errdefer bits.deinit(std.testing.allocator);
        bits.setAssumeCapacity(i, true);
        try source.append(std.testing.allocator, bits);
    }

    const bytes = try std.testing.allocator.alloc(u8, List.serializedSize(&source));
    defer std.testing.allocator.free(bytes);
    _ = List.serializeIntoBytes(&source, bytes);

    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(
            allocator: std.mem.Allocator,
            serialized: []const u8,
            source_value: *const List.Type,
        ) !void {
            var out: List.Type = .empty;
            defer List.deinit(allocator, &out);

            List.deserializeFromBytes(allocator, serialized, &out) catch |err| {
                try std.testing.expectEqual(error.OutOfMemory, err);
                try std.testing.expectEqual(@as(usize, 0), out.items.len);
                try std.testing.expectEqual(@as(usize, 0), out.capacity);
                return err;
            };
            try std.testing.expect(List.equals(source_value, &out));
        }
    }.run, .{ bytes, &source });
}

test "memory_safety: variable progressive list tree.toValue leaves default out on OOM" {
    const Bits = ProgressiveBitListType();
    const List = VariableProgressiveListType(Bits);
    var source: List.Type = .empty;
    defer List.deinit(std.testing.allocator, &source);
    for (0..2) |i| {
        var bits = try Bits.Type.fromBitLen(std.testing.allocator, 300 + i);
        errdefer bits.deinit(std.testing.allocator);
        bits.setAssumeCapacity(i, true);
        try source.append(std.testing.allocator, bits);
    }

    var pool = try Node.Pool.init(.{
        .page_allocator = std.testing.allocator,
        .allocator = std.testing.allocator,
        .pool_size = 64,
    });
    defer pool.deinit();
    const root = try List.tree.fromValue(&pool, &source);
    defer pool.unref(root);

    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(
            allocator: std.mem.Allocator,
            input_pool: *Node.Pool,
            input_root: Node.Id,
            source_value: *const List.Type,
        ) !void {
            var out: List.Type = .empty;
            defer List.deinit(allocator, &out);

            List.tree.toValue(allocator, input_root, input_pool, &out) catch |err| {
                try std.testing.expectEqual(error.OutOfMemory, err);
                try std.testing.expectEqual(@as(usize, 0), out.items.len);
                try std.testing.expectEqual(@as(usize, 0), out.capacity);
                return err;
            };
            try std.testing.expect(List.equals(source_value, &out));
        }
    }.run, .{ &pool, root, &source });
}

test "fixed progressive tree serialization streams without temporary allocations" {
    const allocator = std.testing.allocator;
    const Pair = FixedContainerType(struct { a: UintType(64), b: UintType(64) });
    inline for (.{ UintType(8), UintType(64), BoolType(), Pair }) |Element| {
        const List = FixedProgressiveListType(Element);
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = failing.allocator(), .pool_size = 8192 });
        defer pool.deinit();
        const per_chunk = if (Element.kind == .container) 1 else 32 / Element.fixed_size;
        for ([_]usize{ 0, 1, per_chunk, per_chunk + 1, 5 * per_chunk, 5 * per_chunk + 1, 21 * per_chunk, 21 * per_chunk + 1, 85 * per_chunk + 1 }) |len| {
            var value = List.default_value;
            defer List.deinit(allocator, &value);
            try value.resize(allocator, len);
            for (value.items, 0..) |*item, i| item.* = switch (Element.kind) {
                .uint => @truncate(i),
                .bool => i % 3 == 0,
                .container => .{ .a = i, .b = i + 1 },
                else => unreachable,
            };
            const node = try List.tree.fromValue(&pool, &value);
            defer pool.unref(node);
            const expected = try allocator.alloc(u8, List.serializedSize(&value));
            defer allocator.free(expected);
            const out = try allocator.alloc(u8, expected.len);
            defer allocator.free(out);
            _ = List.serializeIntoBytes(&value, expected);
            failing.fail_index = failing.alloc_index;
            defer failing.fail_index = std.math.maxInt(usize);
            try std.testing.expectEqual(expected.len, try List.tree.serializeIntoBytes(node, &pool, out));
            try std.testing.expectEqualSlices(u8, expected, out);
            if (out.len > 0) try std.testing.expectError(error.InvalidSize, List.tree.serializeIntoBytes(node, &pool, out[0 .. out.len - 1]));
        }
    }
}

test "fixed progressive tree serialization checks terminators and expands implicit zeros" {
    const allocator = std.testing.allocator;
    const List = FixedProgressiveListType(UintType(8));
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const length = try pool.createLeafFromUint(65);
    const root = try pool.createBranch(@enumFromInt(0), length);
    defer pool.unref(root);
    var out: [65]u8 = @splat(0xff);
    try std.testing.expectEqual(out.len, try List.tree.serializeIntoBytes(root, &pool, &out));
    try std.testing.expectEqual([_]u8{0} ** 65, out);

    const bad_terminator = try pool.createLeafFromUint(1);
    const contents = try pool.createBranch(@enumFromInt(0), bad_terminator);
    const bad_root = try pool.createBranch(contents, try pool.createLeafFromUint(1));
    defer pool.unref(bad_root);
    try std.testing.expectError(error.InvalidTerminatorNode, List.tree.serializeIntoBytes(bad_root, &pool, &out));
}

test "progressive list hashing streams packed and composite values without allocation" {
    const allocator = std.testing.allocator;
    const Pair = FixedContainerType(struct { a: UintType(64), b: UintType(64) });
    inline for (.{ UintType(8), UintType(64), BoolType(), Pair }) |Element| {
        const List = FixedProgressiveListType(Element);
        const per_chunk = if (Element.kind == .container) 1 else 32 / Element.fixed_size;
        for ([_]usize{ 0, 1, per_chunk, per_chunk + 1, 5 * per_chunk, 5 * per_chunk + 1, 21 * per_chunk, 21 * per_chunk + 1, 85 * per_chunk + 1, 341 * per_chunk + 1 }) |len| {
            var value = List.default_value;
            defer List.deinit(allocator, &value);
            try value.resize(allocator, len);
            for (value.items, 0..) |*item, i| item.* = switch (Element.kind) {
                .uint => @truncate(i),
                .bool => i % 3 == 0,
                .container => .{ .a = i, .b = i + 1 },
                else => unreachable,
            };
            try expectStreamingProgressiveHash(List, &value);
        }
    }
    const Inner = FixedProgressiveListType(UintType(8));
    const Outer = VariableProgressiveListType(Inner);
    var value = Outer.default_value;
    defer Outer.deinit(allocator, &value);
    for (0..86) |i| {
        try value.append(allocator, .empty);
        try value.items[i].appendNTimes(allocator, @truncate(i), i % 35);
    }
    try expectStreamingProgressiveHash(Outer, &value);
}

fn expectStreamingProgressiveHash(comptime ST: type, value: *const ST.Type) !void {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 8192 });
    defer pool.deinit();
    const root = try ST.tree.fromValue(&pool, value);
    defer pool.unref(root);
    const bytes = try allocator.alloc(u8, ST.serializedSize(value));
    defer allocator.free(bytes);
    _ = ST.serializeIntoBytes(value, bytes);
    var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    var actual: [32]u8 = undefined;
    try ST.hashTreeRoot(failing.allocator(), value, &actual);
    try std.testing.expectEqualSlices(u8, root.getRoot(&pool), &actual);
    try ST.serialized.hashTreeRoot(failing.allocator(), bytes, &actual);
    try std.testing.expectEqualSlices(u8, root.getRoot(&pool), &actual);
    try std.testing.expect(!failing.has_induced_failure);
}

test "progressive tree construction streams packed and nested values" {
    const allocator = std.testing.allocator;
    const Pair = FixedContainerType(struct { a: UintType(64), b: BoolType() });
    inline for (.{ UintType(8), UintType(64), BoolType(), Pair }) |Element| {
        const List = FixedProgressiveListType(Element);
        const per_chunk = if (Element.kind == .container) 1 else 32 / Element.fixed_size;
        for ([_]usize{ 0, 1, per_chunk, per_chunk + 1, 5 * per_chunk, 5 * per_chunk + 1, 21 * per_chunk, 21 * per_chunk + 1, 85 * per_chunk + 1 }) |len| {
            var value = List.default_value;
            defer List.deinit(allocator, &value);
            try value.resize(allocator, len);
            for (value.items, 0..) |*item, i| item.* = switch (Element.kind) {
                .uint => @truncate(i),
                .bool => i % 3 == 0,
                .container => .{ .a = i, .b = i % 3 == 0 },
                else => unreachable,
            };
            try expectStreamingProgressiveConstruction(List, &value);
        }
    }
    const Inner = FixedProgressiveListType(UintType(8));
    const Outer = VariableProgressiveListType(Inner);
    var value = Outer.default_value;
    defer Outer.deinit(allocator, &value);
    for (0..22) |i| {
        try value.append(allocator, .empty);
        try value.items[i].appendNTimes(allocator, @truncate(i), i % 7);
    }
    try expectStreamingProgressiveConstruction(Outer, &value);
    try expectProgressiveFromValuePoolExhaustionReclaimsNodes(Outer, &value, 256);
}

fn expectStreamingProgressiveConstruction(comptime ST: type, value: *const ST.Type) !void {
    const allocator = std.testing.allocator;
    const bytes = try allocator.alloc(u8, ST.serializedSize(value));
    defer allocator.free(bytes);
    _ = ST.serializeIntoBytes(value, bytes);
    var expected: [32]u8 = undefined;
    try ST.hashTreeRoot(allocator, value, &expected);
    var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = failing.allocator(), .pool_size = 8192 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    const from_value = try ST.tree.fromValue(&pool, value);
    try std.testing.expectEqualSlices(u8, &expected, from_value.getRoot(&pool));
    pool.unref(from_value);
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
    const from_bytes = try ST.tree.deserializeFromBytes(&pool, bytes);
    try std.testing.expectEqualSlices(u8, &expected, from_bytes.getRoot(&pool));
    pool.unref(from_bytes);
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
    try std.testing.expect(!failing.has_induced_failure);
}

test "memory_safety: progressive streaming decoder cleans up malformed elements and offsets" {
    const allocator = std.testing.allocator;
    const Inner = FixedProgressiveListType(BoolType());
    const Outer = VariableProgressiveListType(Inner);
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    try std.testing.expectError(error.invalidBoolean, Inner.tree.deserializeFromBytes(&pool, &.{ 1, 2 }));
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
    var prng = std.Random.DefaultPrng.init(0x158);
    for (0..512) |i| {
        var bytes: [32]u8 = undefined;
        prng.random().bytes(&bytes);
        const len = i % (bytes.len + 1);
        if (len >= 8) {
            std.mem.writeInt(u32, bytes[0..4], 8, .little);
            std.mem.writeInt(u32, bytes[4..8], @intCast(8 + i % (len - 7)), .little);
            for (bytes[8..len]) |*byte| byte.* %= 3;
        }
        var value = Outer.default_value;
        defer Outer.deinit(allocator, &value);
        Outer.deserializeFromBytes(allocator, bytes[0..len], &value) catch |err| {
            try std.testing.expectError(err, Outer.tree.deserializeFromBytes(&pool, bytes[0..len]));
            try std.testing.expectEqual(baseline, pool.getNodesInUse());
            continue;
        };
        const root = try Outer.tree.deserializeFromBytes(&pool, bytes[0..len]);
        var expected: [32]u8 = undefined;
        try Outer.hashTreeRoot(allocator, &value, &expected);
        try std.testing.expectEqualSlices(u8, &expected, root.getRoot(&pool));
        pool.unref(root);
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
    }
    const data = [_]u8{ 8, 0, 0, 0, 10, 0, 0, 0, 1, 0, 1, 1 };
    var succeeded = false;
    for (0..64) |capacity| {
        var small_pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = @intCast(capacity) });
        defer small_pool.deinit();
        const before = small_pool.getNodesInUse();
        const root = Outer.tree.deserializeFromBytes(&small_pool, &data) catch |err| {
            try std.testing.expectEqual(error.PoolExhausted, err);
            try std.testing.expectEqual(before, small_pool.getNodesInUse());
            continue;
        };
        small_pool.unref(root);
        try std.testing.expectEqual(before, small_pool.getNodesInUse());
        succeeded = true;
        break;
    }
    try std.testing.expect(succeeded);
}

test "progressive tree reads allocate only output values" {
    const allocator = std.testing.allocator;
    const Pair = FixedContainerType(struct { a: UintType(64), b: UintType(64) });
    const Bytes = FixedProgressiveListType(UintType(8));
    inline for (.{ UintType(8), UintType(64), BoolType(), Pair, Bytes }) |Element| {
        const variable = Element == Bytes;
        const List = if (variable) VariableProgressiveListType(Element) else FixedProgressiveListType(Element);
        for ([_]usize{ 0, 1, 2, 5, 6, 21, 22, 85, 86, 341, 342 }) |len| {
            var value = List.default_value;
            defer List.deinit(allocator, &value);
            try value.resize(allocator, len);
            for (value.items, 0..) |*item, i| item.* = if (variable) .empty else switch (Element.kind) {
                .uint => @truncate(i),
                .bool => i % 3 == 0,
                .container => .{ .a = i, .b = i + 1 },
                else => unreachable,
            };
            var pool_failing = std.testing.FailingAllocator.init(allocator, .{});
            var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = pool_failing.allocator(), .pool_size = 8192 });
            defer pool.deinit();
            const root = try List.tree.fromValue(&pool, &value);
            defer pool.unref(root);
            pool_failing.fail_index = pool_failing.alloc_index;
            var output_allocator = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 1 });
            var actual = List.default_value;
            defer List.deinit(output_allocator.allocator(), &actual);
            try List.tree.toValue(output_allocator.allocator(), root, &pool, &actual);
            try std.testing.expect(List.equals(&value, &actual));
            try std.testing.expect(!output_allocator.has_induced_failure);
            const size = List.serializedSize(&value);
            try std.testing.expectEqual(size, try List.tree.serializedSize(root, &pool));
            const expected = try allocator.alloc(u8, size);
            defer allocator.free(expected);
            const bytes = try allocator.alloc(u8, size);
            defer allocator.free(bytes);
            _ = List.serializeIntoBytes(&value, expected);
            try std.testing.expectEqual(size, try List.tree.serializeIntoBytes(root, &pool, bytes));
            try std.testing.expectEqualSlices(u8, expected, bytes);
            if (size != 0) try std.testing.expectError(error.InvalidSize, List.tree.serializeIntoBytes(root, &pool, bytes[0 .. size - 1]));
            try std.testing.expect(!pool_failing.has_induced_failure);
        }
    }
}

test "progressive tree reads validate terminators before publishing values" {
    const allocator = std.testing.allocator;
    const Inner = FixedProgressiveListType(UintType(8));
    inline for (.{ FixedProgressiveListType(UintType(64)), VariableProgressiveListType(Inner) }) |List| {
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 128 });
        defer pool.deinit();
        var value = List.default_value;
        defer List.deinit(allocator, &value);
        try value.append(allocator, List.Element.default_value);
        const good = try List.tree.fromValue(&pool, &value);
        defer pool.unref(good);
        const bad_leaf = try pool.createLeafFromUint(1);
        const bad = try good.setNode(&pool, @enumFromInt(5), bad_leaf);
        defer pool.unref(bad);
        var out = List.default_value;
        defer List.deinit(allocator, &out);
        try std.testing.expectError(error.InvalidTerminatorNode, List.tree.toValue(allocator, bad, &pool, &out));
        try std.testing.expectEqual(@as(usize, 0), out.items.len);
        try std.testing.expectEqual(@as(usize, 0), out.capacity);
        var bytes: [16]u8 = undefined;
        try std.testing.expectError(error.InvalidTerminatorNode, List.tree.serializeIntoBytes(bad, &pool, &bytes));
    }
}
