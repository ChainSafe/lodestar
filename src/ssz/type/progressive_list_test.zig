//! Tests for `progressive_list.zig`.

const std = @import("std");
const BoolType = @import("bool.zig").BoolType;
const ProgressiveBitListType = @import("progressive_bit_list.zig").ProgressiveBitListType;
const Node = @import("persistent_merkle_tree").Node;
const progressive = @import("progressive.zig");
const FixedProgressiveListType = @import("progressive_list.zig").FixedProgressiveListType;
const VariableProgressiveListType = @import("progressive_list.zig").VariableProgressiveListType;
const UintType = @import("uint.zig").UintType;
const FixedContainerType = @import("container.zig").FixedContainerType;
const StructContainerType = @import("container.zig").StructContainerType;
const FixedProgressiveContainerType = @import("progressive_container.zig").FixedProgressiveContainerType;

test "chunked progressive type should round-trip subtree and payload boundaries" {
    const allocator = std.testing.allocator;
    inline for (.{
        BoolType(),
        UintType(8),
        UintType(16),
        UintType(32),
        UintType(64),
        UintType(128),
        UintType(256),
    }) |Element| {
        const List = FixedProgressiveListType(Element, .{ .chunked_leaf = true });
        const Plain = FixedProgressiveListType(Element, .{});
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var pool = try Node.Pool.init(.{
            .page_allocator = allocator,
            .allocator = failing.allocator(),
            .pool_size = 2048,
        });
        defer pool.deinit();
        const baseline = pool.getNodesInUse();
        var value: List.Type = .empty;
        defer value.deinit(allocator);
        const items_per_chunk = 32 / Element.fixed_size;
        for ([_]usize{ 0, 1, 5, 21, 22, 84, 85, 86, 149, 150, 341, 342 }) |chunks| {
            // Leave the last chunk one element short whenever a chunk holds more than one.
            const len = chunks * items_per_chunk - @intFromBool(chunks > 0 and items_per_chunk > 1);
            try value.resize(allocator, len);
            for (value.items, 0..) |*element, i| {
                element.* = if (Element.kind == .bool) i % 3 == 0 else @intCast(i % 251);
            }
            const expected = try allocator.alloc(u8, len * Element.fixed_size);
            defer allocator.free(expected);
            _ = List.serializeIntoBytes(&value, expected);
            const encoded = try allocator.alloc(u8, expected.len);
            defer allocator.free(encoded);
            const plain = try Plain.tree.fromValue(&pool, &value);
            defer pool.unref(plain);
            const root = try List.tree.fromValue(&pool, &value);
            defer pool.unref(root);
            const decoded = try List.tree.deserializeFromBytes(&pool, expected);
            defer pool.unref(decoded);
            try std.testing.expectEqualSlices(u8, plain.getRoot(&pool), root.getRoot(&pool));
            try std.testing.expectEqualSlices(u8, plain.getRoot(&pool), decoded.getRoot(&pool));
            var out: List.Type = .empty;
            defer out.deinit(allocator);
            try List.tree.toValue(allocator, root, &pool, &out);
            try std.testing.expect(List.equals(&value, &out));
            failing.fail_index = failing.alloc_index;
            const size = try List.tree.serializeIntoBytes(root, &pool, encoded);
            try std.testing.expectEqual(expected.len, size);
            try std.testing.expectEqualSlices(u8, expected, encoded);
            try std.testing.expect(!failing.has_induced_failure);
            failing.fail_index = std.math.maxInt(usize);
        }
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
    }
}

test "chunked progressive tree should store each run of chunks in one chunked leaf" {
    const allocator = std.testing.allocator;
    const List = FixedProgressiveListType(UintType(64), .{ .chunked_leaf = true });
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 128,
    });
    defer pool.deinit();

    var value: List.Type = .empty;
    defer value.deinit(allocator);
    // 150 chunks: 21 in plain leaves, 64 filling subtree 3, then 64 and 1 in subtree 4.
    try value.resize(allocator, 150 * 4);
    for (value.items, 0..) |*element, i| element.* = i;
    const bytes = try allocator.alloc(u8, List.serializedSize(&value));
    defer allocator.free(bytes);
    _ = List.serializeIntoBytes(&value, bytes);

    inline for (.{ false, true }) |from_bytes| {
        const root = try if (from_bytes)
            List.tree.deserializeFromBytes(&pool, bytes)
        else
            List.tree.fromValue(&pool, &value);
        defer pool.unref(root);

        var spine = try root.getLeft(&pool);
        const subtree_0 = try spine.getLeft(&pool);
        try std.testing.expect(subtree_0.getState(&pool).isLeaf());

        for (0..3) |_| spine = try spine.getRight(&pool);
        const subtree_3 = try spine.getLeft(&pool);
        try std.testing.expectEqual(64, try subtree_3.getChunkedLeafLen(&pool));

        spine = try spine.getRight(&pool);
        const subtree_4 = try spine.getLeft(&pool);
        var leaves: [4]Node.Id = undefined;
        try subtree_4.getNodesAtDepth(&pool, 2, 0, &leaves);
        try std.testing.expectEqual(64, try leaves[0].getChunkedLeafLen(&pool));
        try std.testing.expectEqual(1, try leaves[1].getChunkedLeafLen(&pool));
        try std.testing.expect(leaves[2].getState(&pool).isZero());
        try std.testing.expect(leaves[3].getState(&pool).isZero());
    }
}

test "chunked progressive tree reads should expand implicit zeros and reject plain leaf layouts" {
    const allocator = std.testing.allocator;
    const Plain = FixedProgressiveListType(UintType(64), .{});
    const Chunked = FixedProgressiveListType(UintType(64), .{ .chunked_leaf = true });
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 256,
    });
    defer pool.deinit();

    // 50 chunks reach subtree 3, which a zero contents root leaves implicit.
    const zeros = try pool.createBranch(@enumFromInt(0), try pool.createLeafFromUint(200));
    defer pool.unref(zeros);
    var out: Chunked.Type = .empty;
    defer out.deinit(allocator);
    try Chunked.tree.toValue(allocator, zeros, &pool, &out);
    try std.testing.expectEqualSlices(u64, &([_]u64{0} ** 200), out.items);
    var bytes: [1600]u8 = @splat(0xff);
    const size = try Chunked.tree.serializeIntoBytes(zeros, &pool, &bytes);
    try std.testing.expectEqual(bytes.len, size);
    try std.testing.expectEqualSlices(u8, &([_]u8{0} ** 1600), &bytes);

    var value: Plain.Type = .empty;
    defer value.deinit(allocator);
    try value.resize(allocator, 200);
    for (value.items, 0..) |*element, i| element.* = i + 1;
    const plain = try Plain.tree.fromValue(&pool, &value);
    defer pool.unref(plain);
    var rejected: Chunked.Type = .empty;
    defer rejected.deinit(allocator);
    try std.testing.expectError(
        error.InvalidNode,
        Chunked.tree.toValue(allocator, plain, &pool, &rejected),
    );
    try std.testing.expectError(
        error.InvalidNode,
        Chunked.tree.serializeIntoBytes(plain, &pool, &bytes),
    );
}

test "chunked progressive type should preserve malformed byte errors" {
    var pool = try Node.Pool.init(.{
        .page_allocator = std.testing.allocator,
        .allocator = std.testing.allocator,
        .pool_size = 128,
    });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    const Bools = FixedProgressiveListType(BoolType(), .{ .chunked_leaf = true });
    const Ints = FixedProgressiveListType(UintType(64), .{ .chunked_leaf = true });
    try std.testing.expectError(
        error.invalidBoolean,
        Bools.tree.deserializeFromBytes(&pool, &.{ 0, 1, 2 }),
    );
    try std.testing.expectError(
        error.InvalidSSZ,
        Ints.tree.deserializeFromBytes(&pool, &.{ 0, 1, 2 }),
    );
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}

test "memory_safety: chunked progressive tree.toValue should reject malformed trees" {
    const allocator = std.testing.allocator;
    const List = FixedProgressiveListType(UintType(64), .{ .chunked_leaf = true });
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 16,
    });
    defer pool.deinit();

    const bad_terminator = try pool.createLeafFromUint(1);
    const contents = try pool.createBranch(@enumFromInt(0), bad_terminator);
    const bad_root = try pool.createBranch(contents, try pool.createLeafFromUint(1));
    defer pool.unref(bad_root);

    const huge_root = try pool.createBranch(
        @enumFromInt(0),
        try pool.createLeafFromUint(std.math.maxInt(usize)),
    );
    defer pool.unref(huge_root);

    var bad_out: List.Type = .empty;
    defer bad_out.deinit(allocator);
    try std.testing.expectError(
        error.InvalidTerminatorNode,
        List.tree.toValue(allocator, bad_root, &pool, &bad_out),
    );

    var huge_out: List.Type = .empty;
    defer huge_out.deinit(allocator);
    try std.testing.expectError(
        error.LengthOverLimit,
        List.tree.toValue(allocator, huge_root, &pool, &huge_out),
    );
}

test "memory_safety: chunked progressive type construction should release partial trees" {
    const List = FixedProgressiveListType(UintType(64), .{ .chunked_leaf = true });
    var value: List.Type = .empty;
    defer value.deinit(std.testing.allocator);
    try value.resize(std.testing.allocator, 600);
    for (value.items, 0..) |*element, i| element.* = i;

    try expectProgressiveFromValuePoolExhaustionReclaimsNodes(List, &value, 128);

    const bytes = try std.testing.allocator.alloc(u8, List.serializedSize(&value));
    defer std.testing.allocator.free(bytes);
    _ = List.serializeIntoBytes(&value, bytes);

    inline for (.{ false, true }) |from_bytes| {
        try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
            fn run(
                allocator: std.mem.Allocator,
                input: *const List.Type,
                serialized: []const u8,
            ) !void {
                var pool = try Node.Pool.init(.{
                    .page_allocator = std.testing.allocator,
                    .allocator = allocator,
                    .pool_size = 128,
                });
                defer pool.deinit();

                const baseline = pool.getNodesInUse();
                const result = if (from_bytes)
                    List.tree.deserializeFromBytes(&pool, serialized)
                else
                    List.tree.fromValue(&pool, input);
                const root = result catch |err| {
                    try std.testing.expectEqual(baseline, pool.getNodesInUse());
                    return err;
                };
                pool.unref(root);
                try std.testing.expectEqual(baseline, pool.getNodesInUse());
            }
        }.run, .{ &value, bytes });
    }
}

test "progressive list should store struct container elements as single nodes" {
    const allocator = std.testing.allocator;
    const fields = struct { a: UintType(64), b: UintType(8), c: UintType(64) };
    const List = FixedProgressiveListType(StructContainerType(fields), .{});
    const Plain = FixedProgressiveListType(FixedContainerType(fields), .{});
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 2048,
    });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();

    for ([_]usize{ 0, 1, 2, 5, 6, 21, 22, 85, 86 }) |len| {
        var value: List.Type = .empty;
        defer value.deinit(allocator);
        try value.resize(allocator, len);
        for (value.items, 0..) |*element, i| element.* = .{ .a = i, .b = @truncate(i), .c = i * 7 };

        const bytes = try allocator.alloc(u8, List.serializedSize(&value));
        defer allocator.free(bytes);
        _ = List.serializeIntoBytes(&value, bytes);

        const plain = try Plain.tree.fromValue(&pool, &value);
        defer pool.unref(plain);

        inline for (.{ false, true }) |from_bytes| {
            const root = try if (from_bytes)
                List.tree.deserializeFromBytes(&pool, bytes)
            else
                List.tree.fromValue(&pool, &value);
            defer pool.unref(root);
            try std.testing.expectEqualSlices(u8, plain.getRoot(&pool), root.getRoot(&pool));

            var it = try progressive.NodeIterator.init(&pool, try root.getLeft(&pool), len);
            while (try it.next()) |node| {
                try std.testing.expect(node.getState(&pool).isContainerStruct());
            }

            var out: List.Type = .empty;
            defer out.deinit(allocator);
            try List.tree.toValue(allocator, root, &pool, &out);
            try std.testing.expect(List.equals(&value, &out));

            const encoded = try allocator.alloc(u8, bytes.len);
            defer allocator.free(encoded);
            const size = try List.tree.serializeIntoBytes(root, &pool, encoded);
            try std.testing.expectEqual(bytes.len, size);
            try std.testing.expectEqualSlices(u8, bytes, encoded);
        }
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}

test "ListType - sanity" {
    const allocator = std.testing.allocator;

    const Bytes = FixedProgressiveListType(UintType(8), .{});

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

    const BytesBytes = VariableProgressiveListType(Bytes, .{});
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
        const List = FixedProgressiveListType(Element, .{});
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

test "fixed progressive list tree size should reject a length over the limit" {
    const allocator = std.testing.allocator;
    const List = FixedProgressiveListType(UintType(64), .{});
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 2,
    });
    defer pool.deinit();

    const length_leaf = try pool.createLeafFromUint(std.math.maxInt(usize) / 8 + 1);
    const root = try pool.createBranch(@enumFromInt(0), length_leaf);
    defer pool.unref(root);

    try std.testing.expectError(error.LengthOverLimit, List.tree.serializedSize(root, &pool));
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
    const List = FixedProgressiveListType(UintType(64), .{});
    var value: List.Type = .empty;
    defer value.deinit(std.testing.allocator);
    for (0..8) |i| try value.append(std.testing.allocator, @intCast(i));

    try expectProgressiveFromValuePoolExhaustionReclaimsNodes(List, &value, 32);
}

test "progressive fixed list byte deserialization should reject a malformed element" {
    const List = FixedProgressiveListType(BoolType(), .{});
    var out: List.Type = .empty;
    defer out.deinit(std.testing.allocator);

    try std.testing.expectError(
        error.invalidBoolean,
        List.deserializeFromBytes(std.testing.allocator, &.{ 1, 2 }, &out),
    );
}

test "memory_safety: progressive list tree.toValue should reject a leaf contents root" {
    const List = FixedProgressiveListType(UintType(64), .{});
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
}

test "memory_safety: variable progressive list byte deserialization should leave a failed decode for the caller to free on OOM" {
    const Bits = ProgressiveBitListType(.{});
    const List = VariableProgressiveListType(Bits, .{});
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

            try List.deserializeFromBytes(allocator, serialized, &out);
            try std.testing.expect(List.equals(source_value, &out));
        }
    }.run, .{ bytes, &source });
}

test "memory_safety: variable progressive list tree.toValue should leave a failed read for the caller to free on OOM" {
    const Bits = ProgressiveBitListType(.{});
    const List = VariableProgressiveListType(Bits, .{});
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

            try List.tree.toValue(allocator, input_root, input_pool, &out);
            try std.testing.expect(List.equals(source_value, &out));
        }
    }.run, .{ &pool, root, &source });
}

test "fixed progressive tree serialization streams without temporary allocations" {
    const allocator = std.testing.allocator;
    const Pair = FixedContainerType(struct { a: UintType(64), b: UintType(64) });
    inline for (.{ UintType(8), UintType(64), BoolType(), Pair }) |Element| {
        const List = FixedProgressiveListType(Element, .{});
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
    const List = FixedProgressiveListType(UintType(8), .{});
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
        const List = FixedProgressiveListType(Element, .{});
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
    const Inner = FixedProgressiveListType(UintType(8), .{});
    const Outer = VariableProgressiveListType(Inner, .{});
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
        const List = FixedProgressiveListType(Element, .{});
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
    const Inner = FixedProgressiveListType(UintType(8), .{});
    const Outer = VariableProgressiveListType(Inner, .{});
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
    const Inner = FixedProgressiveListType(BoolType(), .{});
    const Outer = VariableProgressiveListType(Inner, .{});
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
    const Bytes = FixedProgressiveListType(UintType(8), .{});
    inline for (.{ UintType(8), UintType(64), BoolType(), Pair, Bytes }) |Element| {
        const variable = Element == Bytes;
        const List = if (variable) VariableProgressiveListType(Element, .{}) else FixedProgressiveListType(Element, .{});
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

test "progressive tree reads should reject a nonzero terminator" {
    const allocator = std.testing.allocator;
    const Inner = FixedProgressiveListType(UintType(8), .{});
    inline for (.{ FixedProgressiveListType(UintType(64), .{}), VariableProgressiveListType(Inner, .{}) }) |List| {
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
        var bytes: [16]u8 = undefined;
        try std.testing.expectError(error.InvalidTerminatorNode, List.tree.serializeIntoBytes(bad, &pool, &bytes));
    }
}

test "fixed progressive list should clone into its own and a wider list type" {
    const allocator = std.testing.allocator;
    const Pair = FixedProgressiveContainerType(struct {
        a: UintType(8),
        b: UintType(64),
    }, &.{ 1, 1 });
    const WidePair = FixedProgressiveContainerType(struct {
        a: UintType(8),
        b: UintType(64),
        c: UintType(16),
    }, &.{ 1, 1, 1 });
    const List = FixedProgressiveListType(Pair, .{});
    const WideList = FixedProgressiveListType(WidePair, .{});

    var list = List.default_value;
    defer List.deinit(allocator, &list);
    try list.appendSlice(allocator, &.{ .{ .a = 1, .b = 2 }, .{ .a = 3, .b = 4 } });

    var cloned = List.default_value;
    defer List.deinit(allocator, &cloned);
    try List.clone(allocator, &list, &cloned);
    try std.testing.expect(cloned.items.ptr != list.items.ptr);
    try std.testing.expect(List.equals(&list, &cloned));

    var wide = WideList.default_value;
    defer WideList.deinit(allocator, &wide);
    try List.cloneInto(WideList, allocator, &list, &wide);
    try std.testing.expectEqual(2, wide.items.len);
    try std.testing.expectEqual(3, wide.items[1].a);
    try std.testing.expectEqual(4, wide.items[1].b);
    try std.testing.expectEqual(0, wide.items[1].c);
}

test "variable progressive list cloneInto should widen nested elements" {
    const allocator = std.testing.allocator;
    const Pair = FixedContainerType(struct {
        a: UintType(8),
        b: UintType(64),
    });
    const WidePair = FixedContainerType(struct {
        a: UintType(8),
        b: UintType(64),
        c: UintType(16),
    });
    const Inner = FixedProgressiveListType(Pair, .{});
    const List = VariableProgressiveListType(Inner, .{});
    const WideList = VariableProgressiveListType(FixedProgressiveListType(WidePair, .{}), .{});

    var list = List.default_value;
    defer List.deinit(allocator, &list);
    try list.append(allocator, Inner.default_value);
    try list.items[0].appendSlice(allocator, &.{ .{ .a = 1, .b = 2 }, .{ .a = 3, .b = 4 } });
    try list.append(allocator, Inner.default_value);

    var wide = WideList.default_value;
    defer WideList.deinit(allocator, &wide);
    try List.cloneInto(WideList, allocator, &list, &wide);
    try std.testing.expectEqual(2, wide.items.len);
    try std.testing.expectEqual(2, wide.items[0].items.len);
    try std.testing.expectEqual(4, wide.items[0].items[1].b);
    try std.testing.expectEqual(0, wide.items[0].items[1].c);
    try std.testing.expectEqual(0, wide.items[1].items.len);
}

test "memory_safety: variable progressive list clone should leave a failed clone for the caller to free on OOM" {
    const Inner = FixedProgressiveListType(UintType(16), .{});
    const List = VariableProgressiveListType(Inner, .{});

    var value = List.default_value;
    defer List.deinit(std.testing.allocator, &value);
    for (0..3) |i| {
        try value.append(std.testing.allocator, Inner.default_value);
        try value.items[i].append(std.testing.allocator, @intCast(i));
    }

    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(allocator: std.mem.Allocator, input: *const List.Type) !void {
            var out = List.default_value;
            defer List.deinit(allocator, &out);
            try List.clone(allocator, input, &out);
            try std.testing.expect(List.equals(input, &out));
        }
    }.run, .{&value});
}

test "FixedProgressiveListType zeros should build a canonical sparse spine without element allocation" {
    const allocator = std.testing.allocator;
    inline for (.{ false, true }) |chunked| {
        const List = FixedProgressiveListType(UintType(8), .{ .chunked_leaf = chunked });
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
        var pool = try Node.Pool.init(.{ .allocator = failing.allocator(), .page_allocator = allocator, .pool_size = 64 });
        defer pool.deinit();
        const baseline = pool.getNodesInUse();
        for ([_]usize{ 0, 1, 32, 33, 160, 161, 672, 673, 2721 }) |len| {
            const root = try List.tree.zeros(&pool, len);
            var expected: List.Type = .empty;
            defer expected.deinit(allocator);
            try expected.resize(allocator, len);
            @memset(expected.items, 0);
            var hash: [32]u8 = undefined;
            try List.hashTreeRoot(allocator, &expected, &hash);
            try std.testing.expectEqualSlices(u8, &hash, root.getRoot(&pool));
            try std.testing.expectEqual(len, try List.tree.length(root, &pool));
            pool.unref(root);
            try std.testing.expectEqual(baseline, pool.getNodesInUse());
        }
        try std.testing.expect(!failing.has_induced_failure);
    }
}

test "memory_safety: FixedProgressiveListType fromNodes should borrow element roots and keep the source on pool exhaustion" {
    const allocator = std.testing.allocator;
    const ByteVectorType = @import("byte_vector.zig").ByteVectorType;
    const Entry = StructContainerType(struct { epoch: UintType(64), root: ByteVectorType(32) });
    const Before = @import("list.zig").FixedListType(Entry, 128, .{});
    const After = FixedProgressiveListType(Entry, .{});
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    {
        var value = Before.default_value;
        defer value.deinit(allocator);
        for (0..86) |i| try value.append(allocator, .{ .epoch = i, .root = @splat(@truncate(i)) });
        const source = try Before.TreeView.fromValue(allocator, &pool, &value);
        defer source.deinit();
        const source_root = (try source.hashTreeRoot()).*;
        var expected_root: [32]u8 = undefined;
        try After.hashTreeRoot(allocator, &value, &expected_root);
        const source_count = pool.getNodesInUse();
        var saw_failure = false;
        for (0..130) |available| {
            var nodes: [86]Node.Id = undefined;
            try source.getRoot().getNodesAtDepth(&pool, Before.chunk_depth + 1, 0, &nodes);
            const first = nodes[0];
            var held: std.ArrayList(Node.Id) = .empty;
            defer held.deinit(allocator);
            while (pool.nodes.len - pool.getNodesInUse() > available) try held.append(allocator, try pool.createLeafFromUint(0));
            const root = After.tree.fromNodes(&pool, &nodes) catch |err| {
                try std.testing.expectEqual(error.PoolExhausted, err);
                pool.free(held.items);
                try std.testing.expectEqual(source_count, pool.getNodesInUse());
                try std.testing.expectEqualSlices(u8, &source_root, try source.hashTreeRoot());
                saw_failure = true;
                continue;
            };
            pool.free(held.items);
            const migrated = try After.TreeView.init(allocator, &pool, root);
            try std.testing.expectEqualSlices(u8, &expected_root, try migrated.hashTreeRoot());
            try std.testing.expectEqual(first, try root.getNode(&pool, @enumFromInt(4)));
            migrated.deinit();
            try std.testing.expectEqual(source_count, pool.getNodesInUse());
            try std.testing.expect(saw_failure);
            break;
        } else return error.TestUnexpectedResult;
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}

test "progressive limits should reject longer inputs before allocating" {
    const Fixed = FixedProgressiveListType(UintType(64), .{ .limit = 1 });
    const Variable = VariableProgressiveListType(Fixed, .{ .limit = 1 });
    const Bits = ProgressiveBitListType(.{ .limit = 8 });
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    var fixed = Fixed.default_value;
    var variable = Variable.default_value;
    var bits = Bits.default_value;
    try std.testing.expectError(error.LengthOverLimit, Fixed.deserializeFromBytes(failing.allocator(), &@as([16]u8, @splat(0)), &fixed));
    try std.testing.expectError(error.invalidOffsetCount, Variable.deserializeFromBytes(failing.allocator(), &.{ 8, 0, 0, 0, 8, 0, 0, 0 }, &variable));
    try std.testing.expectError(error.LengthOverLimit, Bits.deserializeFromBytes(failing.allocator(), &.{ 0xff, 3 }, &bits));
    try std.testing.expect(!failing.has_induced_failure);

    const Bytes = @import("progressive_byte_list.zig").ProgressiveByteListType(.{ .limit = 1 });
    // The unbounded field keeps the parent's `max_size` open, so validation reaches `fixed`.
    const Parent = @import("container.zig").VariableContainerType(struct {
        fixed: Fixed,
        rest: FixedProgressiveListType(UintType(8), .{}),
    });
    try std.testing.expectError(error.LengthOverLimit, Fixed.serialized.validate(&@as([16]u8, @splat(0))));
    try std.testing.expectError(error.LengthOverLimit, Bytes.serialized.validate(&.{ 1, 2 }));
    // Two 8-byte elements in `fixed` exceed its limit of 1; `rest` is empty.
    const parent_bytes = [_]u8{ 8, 0, 0, 0, 24, 0, 0, 0 } ++ @as([16]u8, @splat(0));
    try std.testing.expectError(error.LengthOverLimit, Parent.serialized.validate(&parent_bytes));

    var pool = try Node.Pool.init(.{ .allocator = std.testing.allocator, .page_allocator = std.testing.allocator, .pool_size = 16 });
    defer pool.deinit();
    const leaf = try pool.createLeafFromUint(2);
    const root = try pool.createBranch(@enumFromInt(0), leaf);
    defer pool.unref(root);
    inline for (.{ Fixed, Variable }) |ST| try std.testing.expectError(error.LengthOverLimit, ST.tree.length(root, &pool));

    var scanner = std.json.Scanner.initCompleteInput(std.testing.allocator, "[\"1\", \"2\"]");
    defer scanner.deinit();
    var json_out = Fixed.default_value;
    defer json_out.deinit(std.testing.allocator);
    try std.testing.expectError(error.LengthOverLimit, Fixed.deserializeFromJson(std.testing.allocator, &scanner, &json_out));
}

test "progressive limits should not change merkleization or serialization" {
    const allocator = std.testing.allocator;
    const Limited = FixedProgressiveListType(UintType(8), .{ .limit = 2 });
    const Unlimited = FixedProgressiveListType(UintType(8), .{});
    try std.testing.expectEqual(@as(usize, 2), Limited.limit);
    try std.testing.expectEqual(@as(usize, 2), Limited.max_size);
    try std.testing.expectEqual(std.math.maxInt(usize), Unlimited.max_size);

    var value: Limited.Type = .empty;
    defer value.deinit(allocator);
    try value.appendSlice(allocator, &.{ 1, 2, 3 });
    var limited_root: [32]u8 = undefined;
    var unlimited_root: [32]u8 = undefined;
    try Limited.hashTreeRoot(allocator, &value, &limited_root);
    try Unlimited.hashTreeRoot(allocator, &value, &unlimited_root);
    try std.testing.expectEqualSlices(u8, &unlimited_root, &limited_root);

    var bytes: [3]u8 = undefined;
    _ = Limited.serializeIntoBytes(&value, &bytes);
    try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3 }, &bytes);
    var decoded = Limited.default_value;
    defer decoded.deinit(allocator);
    try std.testing.expectError(error.LengthOverLimit, Limited.deserializeFromBytes(allocator, &bytes, &decoded));
}
