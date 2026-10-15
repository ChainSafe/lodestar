//! Tests for `progressive_container.zig`.

const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const proof = @import("persistent_merkle_tree").proof;
const BoolType = @import("bool.zig").BoolType;
const ByteVectorType = @import("byte_vector.zig").ByteVectorType;
const FixedProgressiveListType = @import("progressive_list.zig").FixedProgressiveListType;
const UintType = @import("uint.zig").UintType;
const FixedListType = @import("list.zig").FixedListType;
const FixedProgressiveContainerType = @import("progressive_container.zig").FixedProgressiveContainerType;
const StructProgressiveContainerType = @import("progressive_container.zig").StructProgressiveContainerType;
const VariableProgressiveContainerType = @import("progressive_container.zig").VariableProgressiveContainerType;

test "ProgressiveContainerType " {
    // Square with active_fields=[1, 0, 1]
    const Square = FixedProgressiveContainerType(struct {
        side: UintType(16),
        color: UintType(8),
    }, &[_]u1{ 1, 0, 1 });

    // Circle with active_fields=[0, 1, 1]
    const Circle = FixedProgressiveContainerType(struct {
        radius: UintType(16),
        color: UintType(8),
    }, &[_]u1{ 0, 1, 1 });

    var square: Square.Type = undefined;
    square.side = 10;
    square.color = 5;

    var circle: Circle.Type = undefined;
    circle.radius = 7;
    circle.color = 5;

    // Test that both serialize correctly
    var square_buf: [Square.fixed_size]u8 = undefined;
    _ = Square.serializeIntoBytes(&square, &square_buf);

    var circle_buf: [Circle.fixed_size]u8 = undefined;
    _ = Circle.serializeIntoBytes(&circle, &circle_buf);

    // Test deserialization
    var square2: Square.Type = undefined;
    try Square.deserializeFromBytes(&square_buf, &square2);
    try std.testing.expectEqual(square.side, square2.side);
    try std.testing.expectEqual(square.color, square2.color);

    // Test hash tree root - color should be at the same gindex for both
    var square_root: [32]u8 = undefined;
    try Square.hashTreeRoot(&square, &square_root);

    var circle_root: [32]u8 = undefined;
    try Circle.hashTreeRoot(&circle, &circle_root);

    // The roots should be different since the structures are different
    try std.testing.expect(!std.mem.eql(u8, &square_root, &circle_root));
}

test "ProgressiveContainerType - variable" {
    const allocator = std.testing.allocator;
    const Foo = VariableProgressiveContainerType(struct {
        a: FixedListType(UintType(8), 32, .{}),
        b: FixedListType(UintType(8), 32, .{}),
        c: FixedListType(UintType(8), 32, .{}),
    }, &[_]u1{ 1, 1, 0, 1 });

    var f: Foo.Type = undefined;
    f.a = try std.ArrayList(u8).initCapacity(allocator, 10);
    f.b = try std.ArrayList(u8).initCapacity(allocator, 10);
    f.c = try std.ArrayList(u8).initCapacity(allocator, 10);
    defer f.a.deinit(allocator);
    defer f.b.deinit(allocator);
    defer f.c.deinit(allocator);
    f.a.expandToCapacity();
    f.b.expandToCapacity();
    f.c.expandToCapacity();

    const f_buf = try allocator.alloc(u8, Foo.serializedSize(&f));
    defer allocator.free(f_buf);
    _ = Foo.serializeIntoBytes(&f, f_buf);

    var f2: Foo.Type = Foo.default_value;
    defer Foo.deinit(allocator, &f2);
    try Foo.deserializeFromBytes(allocator, f_buf, &f2);
}

test "progressive container field gindices should address the field nodes" {
    const allocator = std.testing.allocator;
    const active_fields = [_]u1{ 1, 1, 0, 0, 1, 1 } ++ [_]u1{0} ** 15 ++ [_]u1{1};
    const Fixed = FixedProgressiveContainerType(struct {
        a: UintType(64),
        b: UintType(64),
        c: UintType(64),
        d: UintType(64),
        e: UintType(64),
    }, &active_fields);
    const Variable = VariableProgressiveContainerType(struct {
        a: UintType(64),
        b: UintType(64),
        c: UintType(64),
        d: FixedListType(UintType(8), 32, .{}),
        e: UintType(64),
    }, &active_fields);

    // Fields a, b, c, d, e are chunks 0, 1, 4, 5, 21. Contents is gindex 2. Each spine node holds
    // a subtree root on the left and the next spine node on the right, so the subtree roots are
    // 4, 10 (under 5), 22 (under 11) and 46 (under 23). Chunk 0 is subtree 0, so 4. Chunks 1 and
    // 4 are the first and last of the 4 leaves under 10, so 40 and 43. Chunk 5 is the first of
    // the 16 leaves under 22, so 352. Chunk 21 is the first of the 64 leaves under 46, so 2944.
    inline for (.{ Fixed, Variable }) |ST| {
        try std.testing.expectEqual(4, @intFromEnum(comptime ST.getFieldGindex("a")));
        try std.testing.expectEqual(40, @intFromEnum(comptime ST.getFieldGindex("b")));
        try std.testing.expectEqual(43, @intFromEnum(comptime ST.getFieldGindex("c")));
        try std.testing.expectEqual(352, @intFromEnum(comptime ST.getFieldGindex("d")));
        try std.testing.expectEqual(2944, @intFromEnum(comptime ST.getFieldGindex("e")));
    }

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 64,
    });
    defer pool.deinit();

    const value: Fixed.Type = .{ .a = 1, .b = 2, .c = 3, .d = 4, .e = 5 };

    const root = try Fixed.tree.fromValue(&pool, &value);
    defer pool.unref(root);

    inline for (.{ "a", "b", "c", "d", "e" }, .{ 1, 2, 3, 4, 5 }) |name, field_value| {
        const node = try root.getNode(&pool, comptime Fixed.getFieldGindex(name));
        var expected: [32]u8 = @splat(0);
        expected[0] = field_value;
        try std.testing.expectEqualSlices(u8, &expected, node.getRoot(&pool));
    }
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

test "memory_safety: progressive container tree.fromValue reclaims unpublished nodes on pool exhaustion" {
    const Container = FixedProgressiveContainerType(struct {
        a: UintType(64),
        b: ByteVectorType(32),
    }, &.{ 1, 1 });
    const value: Container.Type = .{ .a = 1, .b = [_]u8{2} ** 32 };

    try expectProgressiveFromValuePoolExhaustionReclaimsNodes(Container, &value, 32);
}

test "memory_safety: nested progressive tree.fromValue reclaims unpublished nodes on pool exhaustion" {
    const Items = FixedProgressiveListType(UintType(8));
    const Container = VariableProgressiveContainerType(struct {
        a: UintType(64),
        items: Items,
    }, &.{ 1, 1 });

    var value = Container.default_value;
    defer Container.deinit(std.testing.allocator, &value);
    try value.items.append(std.testing.allocator, 1);

    try expectProgressiveFromValuePoolExhaustionReclaimsNodes(Container, &value, 32);
}

test "memory_safety: variable progressive container clone preserves out on OOM" {
    const Items = FixedListType(UintType(8), 8, .{});
    const Container = VariableProgressiveContainerType(struct {
        a: Items,
        b: Items,
    }, &.{ 1, 1 });

    var value = Container.default_value;
    defer Container.deinit(std.testing.allocator, &value);
    try value.a.append(std.testing.allocator, 1);
    try value.b.append(std.testing.allocator, 2);

    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(allocator: std.mem.Allocator, input: *const Container.Type) !void {
            var out: Container.Type = Container.default_value;
            defer Container.deinit(allocator, &out);
            Container.clone(allocator, input, &out) catch |err| {
                try std.testing.expectEqual(@as(usize, 0), out.a.items.len);
                try std.testing.expectEqual(@as(usize, 0), out.b.items.len);
                return err;
            };
            try std.testing.expect(Container.equals(input, &out));
        }
    }.run, .{&value});
}

test "memory_safety: fixed progressive container byte deserialization preserves out on malformed input" {
    const Container = FixedProgressiveContainerType(struct {
        a: BoolType(),
        b: BoolType(),
    }, &.{ 1, 1 });
    var out: Container.Type = .{ .a = false, .b = false };

    try std.testing.expectError(
        error.invalidBoolean,
        Container.deserializeFromBytes(&.{ 1, 2 }, &out),
    );
    try std.testing.expect(!out.a);
    try std.testing.expect(!out.b);
}

test "memory_safety: variable progressive container byte deserialization leaves default out on error" {
    const Items = FixedProgressiveListType(BoolType());
    const Container = VariableProgressiveContainerType(struct {
        a: UintType(8),
        items: Items,
    }, &.{ 1, 1 });
    var out = Container.default_value;
    defer Container.deinit(std.testing.allocator, &out);

    try std.testing.expectError(
        error.invalidBoolean,
        Container.deserializeFromBytes(
            std.testing.allocator,
            &.{ 9, 5, 0, 0, 0, 1, 2 },
            &out,
        ),
    );
    try std.testing.expectEqual(@as(u8, 0), out.a);
    try std.testing.expectEqual(@as(usize, 0), out.items.items.len);
    try std.testing.expectEqual(@as(usize, 0), out.items.capacity);
}

test "progressive container hashing streams sparse fields without allocation" {
    const allocator = std.testing.allocator;
    const active = comptime blk: {
        var flags: [256]u1 = @splat(0);
        flags[0] = 1;
        flags[85] = 1;
        flags[255] = 1;
        break :blk flags;
    };
    const Fixed = FixedProgressiveContainerType(struct { a: UintType(64), b: BoolType(), c: UintType(8) }, &active);
    const Variable = VariableProgressiveContainerType(struct { a: UintType(64), b: FixedListType(UintType(8), 32, .{}), c: UintType(8) }, &active);
    inline for (.{ Fixed, Variable }) |ST| {
        var value = ST.default_value;
        defer if (ST == Variable) ST.deinit(allocator, &value);
        value.a = 123;
        value.c = 45;
        if (ST == Fixed) value.b = true else try value.b.appendSlice(allocator, &.{ 2, 3, 4 });
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 2048 });
        defer pool.deinit();
        const root = try ST.tree.fromValue(&pool, &value);
        defer pool.unref(root);
        const bytes = try allocator.alloc(u8, ST.serializedSize(&value));
        defer allocator.free(bytes);
        _ = ST.serializeIntoBytes(&value, bytes);
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
        var actual: [32]u8 = undefined;
        if (ST == Fixed) try ST.hashTreeRoot(&value, &actual) else try ST.hashTreeRoot(failing.allocator(), &value, &actual);
        try std.testing.expectEqualSlices(u8, root.getRoot(&pool), &actual);
        if (ST == Fixed) try ST.serialized.hashTreeRoot(bytes, &actual) else try ST.serialized.hashTreeRoot(failing.allocator(), bytes, &actual);
        try std.testing.expectEqualSlices(u8, root.getRoot(&pool), &actual);
        try std.testing.expect(!failing.has_induced_failure);
    }
}

test "struct progressive container should store the value in one node" {
    const allocator = std.testing.allocator;
    const fields = struct { a: UintType(64), b: ByteVectorType(32), c: BoolType() };
    const active_fields = [_]u1{ 1, 0, 1, 0, 0, 1 };
    const Plain = FixedProgressiveContainerType(fields, &active_fields);
    const Struct = StructProgressiveContainerType(fields, &active_fields);
    const value: Struct.Type = .{ .a = 7, .b = @splat(9), .c = true };
    var bytes: [Struct.fixed_size]u8 = undefined;
    _ = Struct.serializeIntoBytes(&value, &bytes);

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 64,
    });
    defer pool.deinit();

    const plain = try Plain.tree.fromValue(&pool, &value);
    defer pool.unref(plain);

    inline for (.{ false, true }) |from_bytes| {
        const nodes_before = pool.getNodesInUse();

        const node = try if (from_bytes)
            Struct.tree.deserializeFromBytes(&pool, &bytes)
        else
            Struct.tree.fromValue(&pool, &value);
        defer pool.unref(node);

        try std.testing.expectEqual(nodes_before + 1, pool.getNodesInUse());
        try std.testing.expect(node.getState(&pool).isContainerStruct());
        try std.testing.expectEqualSlices(u8, plain.getRoot(&pool), node.getRoot(&pool));

        var out = Struct.default_value;
        try Struct.tree.toValue(node, &pool, &out);
        try std.testing.expect(Struct.equals(&value, &out));
        try std.testing.expect(Struct.equals(&value, try Struct.tree.getValuePtr(node, &pool)));

        var encoded: [Struct.fixed_size]u8 = undefined;
        const size = try Struct.tree.serializeIntoBytes(node, &pool, &encoded);
        try std.testing.expectEqual(try Struct.tree.serializedSize(node, &pool), size);
        try std.testing.expectEqualSlices(u8, &bytes, &encoded);
    }
}

test "struct progressive container should reject malformed bytes and plain layout nodes" {
    const allocator = std.testing.allocator;
    const fields = struct { a: UintType(8), b: BoolType() };
    const Plain = FixedProgressiveContainerType(fields, &.{ 1, 1 });
    const Struct = StructProgressiveContainerType(fields, &.{ 1, 1 });

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 16,
    });
    defer pool.deinit();

    const baseline = pool.getNodesInUse();
    try std.testing.expectError(
        error.invalidBoolean,
        Struct.tree.deserializeFromBytes(&pool, &.{ 1, 2 }),
    );
    try std.testing.expectEqual(baseline, pool.getNodesInUse());

    const plain = try Plain.tree.fromValue(&pool, &.{ .a = 1, .b = true });
    defer pool.unref(plain);

    try std.testing.expectError(error.InvalidNode, Struct.tree.getValuePtr(plain, &pool));
}

test "memory_safety: struct progressive container should free its payload on pool exhaustion" {
    const Container = StructProgressiveContainerType(struct {
        a: UintType(64),
        b: ByteVectorType(32),
    }, &.{ 1, 1 });
    const value: Container.Type = .{ .a = 1, .b = @splat(2) };

    try expectProgressiveFromValuePoolExhaustionReclaimsNodes(Container, &value, 1);
}

test "proofs should materialize a struct progressive container" {
    const allocator = std.testing.allocator;
    const fields = struct { a: UintType(64), b: UintType(64) };
    const Plain = FixedProgressiveContainerType(fields, &.{ 1, 1 });
    const Struct = StructProgressiveContainerType(fields, &.{ 1, 1 });
    const value: Struct.Type = .{ .a = 5, .b = 4 };

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 64,
    });
    defer pool.deinit();

    const plain = try Plain.tree.fromValue(&pool, &value);
    defer pool.unref(plain);

    const node = try Struct.tree.fromValue(&pool, &value);
    defer pool.unref(node);

    const gindex = comptime Struct.getFieldGindex("b");

    var expected = try proof.createSingleProof(allocator, &pool, plain, gindex);
    defer expected.deinit(allocator);

    const nodes_before = pool.getNodesInUse();

    var actual = try proof.createSingleProof(allocator, &pool, node, gindex);
    defer actual.deinit(allocator);

    try std.testing.expectEqual(nodes_before, pool.getNodesInUse());
    try std.testing.expectEqual(@as(u64, 4), std.mem.readInt(u64, actual.leaf[0..8], .little));
    try std.testing.expectEqualSlices(u8, &expected.leaf, &actual.leaf);
    try std.testing.expectEqualSlices([32]u8, expected.witnesses, actual.witnesses);
}

test "progressive list should round-trip struct progressive container elements" {
    const allocator = std.testing.allocator;
    const fields = struct { a: UintType(64), b: UintType(8) };
    const Plain = FixedProgressiveListType(FixedProgressiveContainerType(fields, &.{ 1, 0, 1 }));
    const List = FixedProgressiveListType(StructProgressiveContainerType(fields, &.{ 1, 0, 1 }));

    var value: List.Type = .empty;
    defer value.deinit(allocator);

    try value.resize(allocator, 6);
    for (value.items, 0..) |*element, i| element.* = .{ .a = i + 1, .b = @intCast(i * 2) };

    const bytes = try allocator.alloc(u8, List.serializedSize(&value));
    defer allocator.free(bytes);

    _ = List.serializeIntoBytes(&value, bytes);

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 256,
    });
    defer pool.deinit();

    const plain = try Plain.tree.fromValue(&pool, &value);
    defer pool.unref(plain);

    const root = try List.tree.deserializeFromBytes(&pool, bytes);
    defer pool.unref(root);

    try std.testing.expectEqualSlices(u8, plain.getRoot(&pool), root.getRoot(&pool));

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

test "progressive container tree construction streams sparse fields" {
    const allocator = std.testing.allocator;
    const active = comptime blk: {
        var flags: [256]u1 = @splat(0);
        flags[0] = 1;
        flags[85] = 1;
        flags[255] = 1;
        break :blk flags;
    };
    const Fixed = FixedProgressiveContainerType(struct { a: UintType(64), b: BoolType(), c: UintType(8) }, &active);
    const Variable = VariableProgressiveContainerType(struct { a: UintType(64), b: FixedProgressiveListType(UintType(8)), c: UintType(8) }, &active);
    inline for (.{ Fixed, Variable }) |ST| {
        var value = ST.default_value;
        defer if (ST == Variable) ST.deinit(allocator, &value);
        value.a = 123;
        value.c = 45;
        if (ST == Fixed) value.b = true else try value.b.appendSlice(allocator, &.{ 2, 3, 4 });
        const bytes = try allocator.alloc(u8, ST.serializedSize(&value));
        defer allocator.free(bytes);
        _ = ST.serializeIntoBytes(&value, bytes);
        var expected: [32]u8 = undefined;
        if (ST == Fixed) try ST.hashTreeRoot(&value, &expected) else try ST.hashTreeRoot(allocator, &value, &expected);
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = failing.allocator(), .pool_size = 2048 });
        defer pool.deinit();
        const baseline = pool.getNodesInUse();
        const from_value = try ST.tree.fromValue(&pool, &value);
        try std.testing.expectEqualSlices(u8, &expected, from_value.getRoot(&pool));
        pool.unref(from_value);
        const from_bytes = try ST.tree.deserializeFromBytes(&pool, bytes);
        try std.testing.expectEqualSlices(u8, &expected, from_bytes.getRoot(&pool));
        pool.unref(from_bytes);
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
        try std.testing.expect(!failing.has_induced_failure);
    }
}

test "memory_safety: progressive container decoding reclaims partially built fields" {
    const allocator = std.testing.allocator;
    const Container = VariableProgressiveContainerType(struct {
        a: FixedProgressiveListType(BoolType()),
        b: UintType(64),
        c: BoolType(),
    }, &.{ 1, 0, 1, 0, 0, 1 });
    var value = Container.default_value;
    defer Container.deinit(allocator, &value);
    try value.a.appendSlice(allocator, &.{ true, false });
    value.b = 9;
    value.c = true;
    var bytes: [15]u8 = undefined;
    try std.testing.expectEqual(bytes.len, Container.serializeIntoBytes(&value, &bytes));
    var succeeded = false;
    for (0..128) |capacity| {
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = @intCast(capacity) });
        defer pool.deinit();
        const baseline = pool.getNodesInUse();
        const root = Container.tree.deserializeFromBytes(&pool, &bytes) catch |err| {
            try std.testing.expectEqual(error.PoolExhausted, err);
            try std.testing.expectEqual(baseline, pool.getNodesInUse());
            continue;
        };
        pool.unref(root);
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
        bytes[12] = 2;
        try std.testing.expectError(error.invalidBoolean, Container.tree.deserializeFromBytes(&pool, &bytes));
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
        succeeded = true;
        break;
    }
    try std.testing.expect(succeeded);
}

test "progressive container tree reads stream sparse fields" {
    const allocator = std.testing.allocator;
    const active = comptime blk: {
        var flags: [256]u1 = @splat(0);
        flags[0] = 1;
        flags[85] = 1;
        flags[255] = 1;
        break :blk flags;
    };
    const Fixed = FixedProgressiveContainerType(struct { a: UintType(64), b: BoolType(), c: UintType(8) }, &active);
    const Variable = VariableProgressiveContainerType(struct { a: UintType(64), b: FixedProgressiveListType(UintType(8)), c: UintType(8) }, &active);
    inline for (.{ Fixed, Variable }) |ST| {
        var value = ST.default_value;
        defer if (ST == Variable) ST.deinit(allocator, &value);
        value.a = 123;
        value.c = 45;
        if (ST == Fixed) value.b = true else try value.b.appendSlice(allocator, &.{ 2, 3, 4 });
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = failing.allocator(), .pool_size = 2048 });
        defer pool.deinit();
        const root = try ST.tree.fromValue(&pool, &value);
        defer pool.unref(root);
        failing.fail_index = failing.alloc_index;
        var output_allocator = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 1 });
        var actual = ST.default_value;
        defer if (ST == Variable) ST.deinit(output_allocator.allocator(), &actual);
        if (ST == Fixed) try ST.tree.toValue(root, &pool, &actual) else try ST.tree.toValue(output_allocator.allocator(), root, &pool, &actual);
        try std.testing.expect(ST.equals(&value, &actual));
        try std.testing.expect(!output_allocator.has_induced_failure);
        const size = ST.serializedSize(&value);
        try std.testing.expectEqual(size, try ST.tree.serializedSize(root, &pool));
        const bytes = try allocator.alloc(u8, size);
        defer allocator.free(bytes);
        const expected = try allocator.alloc(u8, size);
        defer allocator.free(expected);
        _ = ST.serializeIntoBytes(&value, expected);
        try std.testing.expectEqual(size, try ST.tree.serializeIntoBytes(root, &pool, bytes));
        try std.testing.expectEqualSlices(u8, expected, bytes);
        try std.testing.expectError(error.InvalidSize, ST.tree.serializeIntoBytes(root, &pool, bytes[0 .. size - 1]));
        try std.testing.expect(!failing.has_induced_failure);
    }
}

test "memory_safety: progressive container tree.toValue cleans partial values on OOM" {
    const allocator = std.testing.allocator;
    const Container = VariableProgressiveContainerType(struct {
        a: FixedProgressiveListType(UintType(8)),
        b: FixedListType(UintType(8), 8, .{}),
    }, &.{ 1, 0, 1 });
    var source = Container.default_value;
    defer Container.deinit(allocator, &source);
    try source.a.appendSlice(allocator, &.{ 1, 2, 3 });
    try source.b.appendSlice(allocator, &.{ 4, 5 });

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const root = try Container.tree.fromValue(&pool, &source);
    defer pool.unref(root);

    var saw_failure = false;
    var saw_success = false;
    for (0..8) |fail_after| {
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = fail_after });
        var out = Container.default_value;
        defer Container.deinit(failing.allocator(), &out);
        Container.tree.toValue(failing.allocator(), root, &pool, &out) catch |err| {
            try std.testing.expectEqual(error.OutOfMemory, err);
            try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
            saw_failure = true;
            continue;
        };
        try std.testing.expect(Container.equals(&source, &out));
        saw_success = true;
        break;
    }
    try std.testing.expect(saw_failure);
    try std.testing.expect(saw_success);
}

test "memory_safety: progressive container tree reads validate terminators before publishing values" {
    const allocator = std.testing.allocator;
    const Fixed = FixedProgressiveContainerType(struct { a: UintType(64), b: UintType(8) }, &.{ 1, 0, 1 });
    const Variable = VariableProgressiveContainerType(struct {
        a: UintType(64),
        b: FixedProgressiveListType(UintType(8)),
    }, &.{ 1, 0, 1 });
    inline for (.{ Fixed, Variable }) |ST| {
        var source = ST.default_value;
        defer if (ST == Variable) ST.deinit(allocator, &source);
        source.a = 123;
        if (ST == Fixed) source.b = 45 else try source.b.appendSlice(allocator, &.{ 4, 5 });
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
        defer pool.deinit();
        const good = try ST.tree.fromValue(&pool, &source);
        defer pool.unref(good);
        const bad_leaf = try pool.createLeafFromUint(1);
        const bad = try good.setNode(&pool, @enumFromInt(11), bad_leaf);
        defer pool.unref(bad);

        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var out = ST.default_value;
        defer if (ST == Variable) ST.deinit(failing.allocator(), &out);
        if (ST == Fixed) {
            try std.testing.expectError(error.InvalidTerminatorNode, ST.tree.toValue(bad, &pool, &out));
        } else {
            try std.testing.expectError(error.InvalidTerminatorNode, ST.tree.toValue(failing.allocator(), bad, &pool, &out));
            try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
        }
        try std.testing.expect(ST.equals(&ST.default_value, &out));
        var bytes: [16]u8 = undefined;
        try std.testing.expectError(error.InvalidTerminatorNode, ST.tree.serializeIntoBytes(bad, &pool, &bytes));
    }
}
