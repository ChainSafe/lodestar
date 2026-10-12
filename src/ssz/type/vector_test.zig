//! Tests for `vector.zig`.

const std = @import("std");
const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const BoolType = @import("bool.zig").BoolType;
const UintType = @import("uint.zig").UintType;
const ByteVectorType = @import("byte_vector.zig").ByteVectorType;
const FixedContainerType = @import("container.zig").FixedContainerType;
const FixedListType = @import("list.zig").FixedListType;
const VariableContainerType = @import("container.zig").VariableContainerType;
const TypeTestCase = @import("test_utils.zig").TypeTestCase;
const FixedVectorType = @import("vector.zig").FixedVectorType;
const VariableVectorType = @import("vector.zig").VariableVectorType;
const ByteListType = @import("byte_list.zig").ByteListType;

test "FixedVectorType - canonical boolean tree deserialization" {
    const allocator = std.testing.allocator;
    const byte_count = @as(usize, pmt.ChunkedLeaf.K) * 32 + 1;

    inline for (.{ false, true }) |chunked_leaf| {
        const Vector = FixedVectorType(BoolType(), byte_count, .{ .chunked_leaf = chunked_leaf });
        var pool = try Node.Pool.init(.{
            .page_allocator = allocator,
            .allocator = allocator,
            .pool_size = 1024,
        });
        defer pool.deinit();

        var data: [byte_count]u8 = undefined;
        for (&data, 0..) |*byte, i| byte.* = @intCast(i % 2);

        const node = try Vector.tree.deserializeFromBytes(&pool, &data);
        defer pool.unref(node);
        const root = node.getRoot(&pool).*;

        var value: Vector.Type = undefined;
        try Vector.tree.toValue(node, &pool, &value);
        for (value, 0..) |item, i| try std.testing.expectEqual(i % 2 == 1, item);

        var serialized: [byte_count]u8 = undefined;
        const written = try Vector.tree.serializeIntoBytes(node, &pool, &serialized);
        try std.testing.expectEqual(byte_count, written);
        try std.testing.expectEqualSlices(u8, &data, &serialized);

        const nodes_in_use = pool.getNodesInUse();
        const next_free_node = pool.next_free_node;
        for ([_]usize{ 0, 31, 32, byte_count - 2, byte_count - 1 }) |index| {
            const original = data[index];
            defer data[index] = original;
            for ([_]u8{ 2, 0xff }) |invalid| {
                data[index] = invalid;
                try std.testing.expectError(
                    error.invalidBoolean,
                    Vector.tree.deserializeFromBytes(&pool, &data),
                );
                try std.testing.expectEqual(nodes_in_use, pool.getNodesInUse());
                try std.testing.expectEqual(next_free_node, pool.next_free_node);
                try std.testing.expectEqualSlices(u8, &root, node.getRoot(&pool));
            }
        }
    }
}

const testCases = [_]TypeTestCase{
    // refer to https://github.com/ChainSafe/ssz/blob/7f5580c2ea69f9307300ddb6010a8bc7ce2fc471/packages/ssz/test/unit/byType/vector/valid.test.ts#L20
    .{
        .id = "4 values",
        .serializedHex = "0xa086010000000000400d030000000000e093040000000000801a060000000000",
        .json =
        \\["100000","200000","300000","400000"]
        ,
        .rootHex = "0xa086010000000000400d030000000000e093040000000000801a060000000000",
    },
};

test "vector - sanity" {
    // create a fixed vector type and instance and round-trip serialize
    const Bytes32 = FixedVectorType(UintType(8), 32, .{});

    var b0: Bytes32.Type = undefined;
    var b0_buf: [Bytes32.fixed_size]u8 = undefined;
    _ = Bytes32.serializeIntoBytes(&b0, &b0_buf);
    try Bytes32.deserializeFromBytes(&b0_buf, &b0);
}

test "clone FixedVectorType" {
    const Checkpoint = FixedContainerType(struct {
        epoch: UintType(8),
        root: ByteVectorType(32),
    });
    const CheckpointVector = FixedVectorType(Checkpoint, 4, .{});
    var vector: CheckpointVector.Type = CheckpointVector.default_value;
    vector[0].epoch = 42;

    var cloned: CheckpointVector.Type = undefined;
    try CheckpointVector.clone(&vector, &cloned);
    try std.testing.expect(&vector != &cloned);
    try std.testing.expect(CheckpointVector.equals(&vector, &cloned));

    // clone into another type
    const CheckpointHex = FixedContainerType(struct {
        epoch: UintType(8),
        root: ByteVectorType(32),
        root_hex: ByteVectorType(64),
    });
    const CheckpointHexVector = FixedVectorType(CheckpointHex, 4, .{});
    var cloned2: CheckpointHexVector.Type = undefined;
    try CheckpointVector.clone(&vector, &cloned2);
    try std.testing.expect(cloned2[0].epoch == 42);
}

test "clone VariableVectorType" {
    const allocator = std.testing.allocator;
    const FieldA = FixedListType(UintType(8), 32, .{});
    const Foo = VariableContainerType(struct {
        a: FieldA,
    });
    const FooVector = VariableVectorType(Foo, 4);
    var foo_vector: FooVector.Type = FooVector.default_value;
    defer FooVector.deinit(allocator, &foo_vector);
    try foo_vector[0].a.append(allocator, 100);

    var cloned = FooVector.default_value;
    defer FooVector.deinit(allocator, &cloned);
    try FooVector.clone(allocator, &foo_vector, &cloned);
    try std.testing.expect(&foo_vector != &cloned);
    try std.testing.expect(FooVector.equals(&foo_vector, &cloned));
    try std.testing.expect(cloned[0].a.items.len == 1);
    try std.testing.expect(cloned[0].a.items[0] == 100);

    // clone into another type
    const Bar = VariableContainerType(struct {
        a: FieldA,
        b: UintType(8),
    });
    const BarVector = VariableVectorType(Bar, 4);
    var cloned2 = BarVector.default_value;
    defer BarVector.deinit(allocator, &cloned2);
    try FooVector.cloneInto(BarVector, allocator, &foo_vector, &cloned2);
    try std.testing.expect(cloned2[0].a.items.len == 1);
    try std.testing.expect(cloned2[0].a.items[0] == 100);
}

// Refer to https://github.com/ChainSafe/ssz/blob/f5ed0b457333749b5c3f49fa5eafa096a725f033/packages/ssz/test/unit/byType/vector/valid.test.ts#L15-L85
test "FixedVectorType - serializeIntoBytes (VectorBasic uint64 - 4 values)" {
    const allocator = std.testing.allocator;
    const VectorU64 = FixedVectorType(UintType(64), 4, .{});

    const value: VectorU64.Type = [_]u64{ 100000, 200000, 300000, 400000 };

    // 0xa086010000000000400d030000000000e093040000000000801a060000000000
    const expected_serialized = [_]u8{
        0xa0, 0x86, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // 100000
        0x40, 0x0d, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, // 200000
        0xe0, 0x93, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, // 300000
        0x80, 0x1a, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, // 400000
    };
    const expected_root = expected_serialized;

    var serialized: [VectorU64.fixed_size]u8 = undefined;
    const written = VectorU64.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 32), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &serialized);

    var root: [32]u8 = undefined;
    try VectorU64.hashTreeRoot(&value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const node = try VectorU64.tree.fromValue(&pool, &value);
    var tree_serialized: [VectorU64.fixed_size]u8 = undefined;
    _ = try VectorU64.tree.serializeIntoBytes(node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &tree_serialized);
}

test "FixedVectorType - serializeIntoBytes (VectorComposite ByteVector32 - 4 roots)" {
    const allocator = std.testing.allocator;
    const ByteVector32 = ByteVectorType(32);
    const VectorBV32 = FixedVectorType(ByteVector32, 4, .{});

    const value: VectorBV32.Type = [_][32]u8{
        [_]u8{0xbb} ** 32,
        [_]u8{0xcc} ** 32,
        [_]u8{0xdd} ** 32,
        [_]u8{0xee} ** 32,
    };

    const expected_serialized = [_]u8{0xbb} ** 32 ++ [_]u8{0xcc} ** 32 ++ [_]u8{0xdd} ** 32 ++ [_]u8{0xee} ** 32;
    const expected_root = [_]u8{ 0x56, 0x01, 0x9b, 0xaf, 0xbc, 0x63, 0x46, 0x1b, 0x73, 0xe2, 0x1c, 0x6e, 0xae, 0x0c, 0x62, 0xe8, 0xd5, 0xb8, 0xe0, 0x5c, 0xb0, 0xac, 0x06, 0x57, 0x77, 0xdc, 0x23, 0x8f, 0xcf, 0x96, 0x04, 0xe6 };

    var serialized: [VectorBV32.fixed_size]u8 = undefined;
    const written = VectorBV32.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 128), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &serialized);

    var root: [32]u8 = undefined;
    try VectorBV32.hashTreeRoot(&value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const node = try VectorBV32.tree.fromValue(&pool, &value);
    var tree_serialized: [VectorBV32.fixed_size]u8 = undefined;
    _ = try VectorBV32.tree.serializeIntoBytes(node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &tree_serialized);
}

test "FixedVectorType - serializeIntoBytes (VectorComposite Container - 4 arrays)" {
    const allocator = std.testing.allocator;
    const Container = FixedContainerType(struct {
        a: UintType(64),
        b: UintType(64),
    });
    const VectorContainer = FixedVectorType(Container, 4, .{});

    const value: VectorContainer.Type = [_]Container.Type{
        .{ .a = 0, .b = 0 },
        .{ .a = 123456, .b = 654321 },
        .{ .a = 234567, .b = 765432 },
        .{ .a = 345678, .b = 876543 },
    };

    // 0x0000000000000000000000000000000040e2010000000000f1fb0900000000004794030000000000f8ad0b00000000004e46050000000000ff5f0d0000000000
    const expected_serialized = [_]u8{
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // a=0
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // b=0
        0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // a=123456
        0xf1, 0xfb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, // b=654321
        0x47, 0x94, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, // a=234567
        0xf8, 0xad, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x00, // b=765432
        0x4e, 0x46, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, // a=345678
        0xff, 0x5f, 0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, // b=876543
    };
    const expected_root = [_]u8{ 0xb1, 0xa7, 0x97, 0xeb, 0x50, 0x65, 0x47, 0x48, 0xba, 0x23, 0x90, 0x10, 0xed, 0xcc, 0xea, 0x7b, 0x46, 0xb5, 0x5b, 0xf7, 0x40, 0x73, 0x0b, 0x70, 0x06, 0x84, 0xf4, 0x8b, 0x0c, 0x47, 0x83, 0x72 };

    var serialized: [VectorContainer.fixed_size]u8 = undefined;
    const written = VectorContainer.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 64), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &serialized);

    var root: [32]u8 = undefined;
    try VectorContainer.hashTreeRoot(&value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const node = try VectorContainer.tree.fromValue(&pool, &value);
    var tree_serialized: [VectorContainer.fixed_size]u8 = undefined;
    _ = try VectorContainer.tree.serializeIntoBytes(node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &tree_serialized);
}

test "VariableVectorType - serializeIntoBytes (VectorComposite ListBasic - [[1,2],[5,6]])" {
    const allocator = std.testing.allocator;
    const ListU64 = FixedListType(UintType(64), 8, .{});
    const VectorList = VariableVectorType(ListU64, 2);

    var value: VectorList.Type = VectorList.default_value;
    // [[1,2],[5,6]]
    try value[0].appendSlice(allocator, &[_]u64{ 1, 2 });
    try value[1].appendSlice(allocator, &[_]u64{ 5, 6 });
    defer VectorList.deinit(allocator, &value);

    // 0x08000000180000000100000000000000020000000000000005000000000000000600000000000000
    const expected_serialized = [_]u8{
        0x08, 0x00, 0x00, 0x00, // offset to first list = 8
        0x18, 0x00, 0x00, 0x00, // offset to second list = 24
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 1
        0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 2
        0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 5
        0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 6
    };
    const expected_root = [_]u8{ 0x00, 0x14, 0xc4, 0x85, 0xce, 0x39, 0xc8, 0x07, 0x1f, 0x69, 0x63, 0x15, 0x66, 0xb1, 0xd1, 0xad, 0x51, 0xe2, 0xb0, 0xb5, 0xab, 0xc3, 0xc7, 0xa2, 0x99, 0xa6, 0xfa, 0xc1, 0xab, 0xce, 0x9e, 0x49 };

    const size = VectorList.serializedSize(&value);
    try std.testing.expectEqual(@as(usize, 40), size);
    const serialized = try allocator.alloc(u8, size);
    defer allocator.free(serialized);
    const written = VectorList.serializeIntoBytes(&value, serialized);
    try std.testing.expectEqual(@as(usize, 40), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, serialized);

    var root: [32]u8 = undefined;
    try VectorList.hashTreeRoot(allocator, &value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const node = try VectorList.tree.fromValue(&pool, &value);
    const tree_size = try VectorList.tree.serializedSize(node, &pool);
    try std.testing.expectEqual(@as(usize, 40), tree_size);
    const tree_serialized = try allocator.alloc(u8, tree_size);
    defer allocator.free(tree_serialized);
    _ = try VectorList.tree.serializeIntoBytes(node, &pool, tree_serialized);
    try std.testing.expectEqualSlices(u8, &expected_serialized, tree_serialized);
}

test "FixedVectorType - tree.deserializeFromBytes (VectorBasic uint64)" {
    const allocator = std.testing.allocator;
    const VectorU64 = FixedVectorType(UintType(64), 4, .{});

    // 0xa086010000000000400d030000000000e093040000000000801a060000000000
    const serialized = [_]u8{
        0xa0, 0x86, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // 100000
        0x40, 0x0d, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, // 200000
        0xe0, 0x93, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, // 300000
        0x80, 0x1a, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, // 400000
    };
    const expected_values = [_]u64{ 100000, 200000, 300000, 400000 };
    const expected_root = serialized; // For VectorBasic with 4 uint64 values, root equals serialized

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const tree_node = try VectorU64.tree.deserializeFromBytes(&pool, &serialized);

    var value_from_tree: VectorU64.Type = undefined;
    try VectorU64.tree.toValue(tree_node, &pool, &value_from_tree);

    try std.testing.expectEqualSlices(u64, &expected_values, &value_from_tree);

    var tree_serialized: [VectorU64.fixed_size]u8 = undefined;
    _ = try VectorU64.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);

    var hash_root: [32]u8 = undefined;
    try VectorU64.hashTreeRoot(&value_from_tree, &hash_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &hash_root);
}

test "FixedVectorType - tree.deserializeFromBytes (VectorComposite ByteVector32)" {
    const allocator = std.testing.allocator;
    const ByteVector32 = ByteVectorType(32);
    const VectorBV32 = FixedVectorType(ByteVector32, 4, .{});

    // 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
    const serialized = [_]u8{0xbb} ** 32 ++ [_]u8{0xcc} ** 32 ++ [_]u8{0xdd} ** 32 ++ [_]u8{0xee} ** 32;
    const expected_values = [_][32]u8{
        [_]u8{0xbb} ** 32,
        [_]u8{0xcc} ** 32,
        [_]u8{0xdd} ** 32,
        [_]u8{0xee} ** 32,
    };
    // 0x56019bafbc63461b73e21c6eae0c62e8d5b8e05cb0ac065777dc238fcf9604e6
    const expected_root = [_]u8{ 0x56, 0x01, 0x9b, 0xaf, 0xbc, 0x63, 0x46, 0x1b, 0x73, 0xe2, 0x1c, 0x6e, 0xae, 0x0c, 0x62, 0xe8, 0xd5, 0xb8, 0xe0, 0x5c, 0xb0, 0xac, 0x06, 0x57, 0x77, 0xdc, 0x23, 0x8f, 0xcf, 0x96, 0x04, 0xe6 };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const tree_node = try VectorBV32.tree.deserializeFromBytes(&pool, &serialized);

    var value_from_tree: VectorBV32.Type = undefined;
    try VectorBV32.tree.toValue(tree_node, &pool, &value_from_tree);

    for (expected_values, 0..) |expected, i| {
        try std.testing.expectEqualSlices(u8, &expected, &value_from_tree[i]);
    }

    var tree_serialized: [VectorBV32.fixed_size]u8 = undefined;
    _ = try VectorBV32.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);

    var hash_root: [32]u8 = undefined;
    try VectorBV32.hashTreeRoot(&value_from_tree, &hash_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &hash_root);
}

test "FixedVectorType - tree.deserializeFromBytes (VectorComposite Container)" {
    const allocator = std.testing.allocator;
    const Container = FixedContainerType(struct {
        a: UintType(64),
        b: UintType(64),
    });
    const VectorContainer = FixedVectorType(Container, 4, .{});

    // 0x0000000000000000000000000000000040e2010000000000f1fb0900000000004794030000000000f8ad0b00000000004e46050000000000ff5f0d0000000000
    const serialized = [_]u8{
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // a=0
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // b=0
        0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // a=123456
        0xf1, 0xfb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, // b=654321
        0x47, 0x94, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, // a=234567
        0xf8, 0xad, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x00, // b=765432
        0x4e, 0x46, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, // a=345678
        0xff, 0x5f, 0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, // b=876543
    };
    const expected_values = [_]Container.Type{
        .{ .a = 0, .b = 0 },
        .{ .a = 123456, .b = 654321 },
        .{ .a = 234567, .b = 765432 },
        .{ .a = 345678, .b = 876543 },
    };
    // 0xb1a797eb50654748ba239010edccea7b46b55bf740730b700684f48b0c478372
    const expected_root = [_]u8{ 0xb1, 0xa7, 0x97, 0xeb, 0x50, 0x65, 0x47, 0x48, 0xba, 0x23, 0x90, 0x10, 0xed, 0xcc, 0xea, 0x7b, 0x46, 0xb5, 0x5b, 0xf7, 0x40, 0x73, 0x0b, 0x70, 0x06, 0x84, 0xf4, 0x8b, 0x0c, 0x47, 0x83, 0x72 };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const tree_node = try VectorContainer.tree.deserializeFromBytes(&pool, &serialized);

    var value_from_tree: VectorContainer.Type = undefined;
    try VectorContainer.tree.toValue(tree_node, &pool, &value_from_tree);

    for (expected_values, 0..) |expected, i| {
        try std.testing.expectEqual(expected.a, value_from_tree[i].a);
        try std.testing.expectEqual(expected.b, value_from_tree[i].b);
    }

    var tree_serialized: [VectorContainer.fixed_size]u8 = undefined;
    _ = try VectorContainer.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);

    var hash_root: [32]u8 = undefined;
    try VectorContainer.hashTreeRoot(&value_from_tree, &hash_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &hash_root);
}

test "VariableVectorType - tree.deserializeFromBytes (VectorComposite ListBasic)" {
    const allocator = std.testing.allocator;
    const ListU64 = FixedListType(UintType(64), 8, .{});
    const VectorList = VariableVectorType(ListU64, 2);

    // 0x08000000180000000100000000000000020000000000000005000000000000000600000000000000
    const serialized = [_]u8{
        0x08, 0x00, 0x00, 0x00, // offset to first list = 8
        0x18, 0x00, 0x00, 0x00, // offset to second list = 24
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 1
        0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 2
        0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 5
        0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // 6
    };
    // 0x0014c485ce39c8071f69631566b1d1ad51e2b0b5abc3c7a299a6fac1abce9e49
    const expected_root = [_]u8{ 0x00, 0x14, 0xc4, 0x85, 0xce, 0x39, 0xc8, 0x07, 0x1f, 0x69, 0x63, 0x15, 0x66, 0xb1, 0xd1, 0xad, 0x51, 0xe2, 0xb0, 0xb5, 0xab, 0xc3, 0xc7, 0xa2, 0x99, 0xa6, 0xfa, 0xc1, 0xab, 0xce, 0x9e, 0x49 };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const tree_node = try VectorList.tree.deserializeFromBytes(&pool, &serialized);

    var value_from_tree: VectorList.Type = VectorList.default_value;
    defer VectorList.deinit(allocator, &value_from_tree);
    try VectorList.tree.toValue(allocator, tree_node, &pool, &value_from_tree);

    try std.testing.expectEqual(@as(usize, 2), value_from_tree[0].items.len);
    try std.testing.expectEqual(@as(u64, 1), value_from_tree[0].items[0]);
    try std.testing.expectEqual(@as(u64, 2), value_from_tree[0].items[1]);
    try std.testing.expectEqual(@as(usize, 2), value_from_tree[1].items.len);
    try std.testing.expectEqual(@as(u64, 5), value_from_tree[1].items[0]);
    try std.testing.expectEqual(@as(u64, 6), value_from_tree[1].items[1]);

    const tree_size = try VectorList.tree.serializedSize(tree_node, &pool);
    try std.testing.expectEqual(@as(usize, 40), tree_size);
    const tree_serialized = try allocator.alloc(u8, tree_size);
    defer allocator.free(tree_serialized);
    _ = try VectorList.tree.serializeIntoBytes(tree_node, &pool, tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, tree_serialized);

    var hash_root: [32]u8 = undefined;
    try VectorList.hashTreeRoot(allocator, &value_from_tree, &hash_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &hash_root);
}

test "valid test for VectorBasicType" {
    const allocator = std.testing.allocator;

    // uint of 8 bytes = u64
    const Uint = UintType(64);
    const Vector = FixedVectorType(Uint, 4, .{});

    const TypeTest = @import("test_utils.zig").typeTest(Vector);

    for (testCases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "FixedVectorType equals" {
    const Vec = FixedVectorType(UintType(8), 4, .{});

    var a: Vec.Type = [_]u8{ 1, 2, 3, 4 };
    var b: Vec.Type = [_]u8{ 1, 2, 3, 4 };
    var c: Vec.Type = [_]u8{ 1, 2, 3, 5 };

    try std.testing.expect(Vec.equals(&a, &b));
    try std.testing.expect(!Vec.equals(&a, &c));
}

test "VectorCompositeType of Root" {
    const test_cases = [_]TypeTestCase{
        .{
            .id = "4 roots",
            .serializedHex = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            .json =
            \\["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]
            ,
            .rootHex = "0x56019bafbc63461b73e21c6eae0c62e8d5b8e05cb0ac065777dc238fcf9604e6",
        },
    };

    const allocator = std.testing.allocator;
    const ByteVector = ByteVectorType(32);
    const Vector = FixedVectorType(ByteVector, 4, .{});

    const TypeTest = @import("test_utils.zig").typeTest(Vector);

    for (test_cases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "VectorCompositeType of Container" {
    const test_cases = [_]TypeTestCase{
        .{
            .id = "4 containers",
            .serializedHex = "0x01000000000000000200000000000000030000000000000004000000000000000500000000000000060000000000000007000000000000000800000000000000",
            .json =
            \\[{"a":"1","b":"2"},{"a":"3","b":"4"},{"a":"5","b":"6"},{"a":"7","b":"8"}]
            ,
            .rootHex = "0x99cb728885028dc2c35af59794139055007536d3ed8efb214db6b8798fcc8480",
        },
    };

    const allocator = std.testing.allocator;
    const Uint = UintType(64);
    const Container = FixedContainerType(struct {
        a: Uint,
        b: Uint,
    });
    const Vector = FixedVectorType(Container, 4, .{});

    const TypeTest = @import("test_utils.zig").typeTest(Vector);

    for (test_cases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "FixedVectorType - default_root" {
    const VectorU64 = FixedVectorType(UintType(64), 4, .{});
    var expected_root: [32]u8 = undefined;

    try VectorU64.hashTreeRoot(&VectorU64.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &VectorU64.default_root);

    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1024 });
    defer pool.deinit();

    const node = try VectorU64.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &expected_root, node.getRoot(&pool));
}

test "VariableVectorType - default_root" {
    const ListU64 = FixedListType(UintType(64), 8, .{});
    const VectorList = VariableVectorType(ListU64, 2);
    var expected_root: [32]u8 = undefined;

    try VectorList.hashTreeRoot(std.testing.allocator, &VectorList.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &VectorList.default_root);

    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1024 });
    defer pool.deinit();

    const node = try VectorList.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &expected_root, node.getRoot(&pool));
}

test "FixedVectorType opts.chunked_leaf=true: round-trip fromValue -> tree -> toValue" {
    const allocator = std.testing.allocator;
    const ChunkedLeaf = pmt.ChunkedLeaf;
    const length: usize = 2 * @as(usize, ChunkedLeaf.K) * 4 + 7;
    const VecT = FixedVectorType(UintType(64), length, .{ .chunked_leaf = true });

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    var src: VecT.Type = undefined;
    for (0..length) |i| src[i] = @as(u64, @intCast(i * 31 + 1));

    const tree_id = try VecT.tree.fromValue(&pool, &src);
    defer pool.unref(tree_id);

    var dst: VecT.Type = undefined;
    try VecT.tree.toValue(tree_id, &pool, &dst);
    for (src, dst) |a, b| try std.testing.expectEqual(a, b);

    // Hash matches the leaf-path (non-chunked_leaf) reference root.
    const VecLeafT = FixedVectorType(UintType(64), length, .{});
    const leaf_tree_id = try VecLeafT.tree.fromValue(&pool, &src);
    defer pool.unref(leaf_tree_id);
    try std.testing.expectEqualSlices(u8, leaf_tree_id.getRoot(&pool), tree_id.getRoot(&pool));
}

test "FixedVectorType opts.chunked_leaf=true: serialize -> deserialize round-trip" {
    const allocator = std.testing.allocator;
    const ChunkedLeaf = pmt.ChunkedLeaf;
    const length: usize = 2 * @as(usize, ChunkedLeaf.K) * 4;
    const VecT = FixedVectorType(UintType(64), length, .{ .chunked_leaf = true });

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    var src: VecT.Type = undefined;
    for (0..length) |i| src[i] = @as(u64, @intCast(i));

    const tree_id = try VecT.tree.fromValue(&pool, &src);
    defer pool.unref(tree_id);

    const buf = try allocator.alloc(u8, length * @sizeOf(u64));
    defer allocator.free(buf);
    const written = try VecT.tree.serializeIntoBytes(tree_id, &pool, buf);
    try std.testing.expectEqual(length * @sizeOf(u64), written);

    const round_id = try VecT.tree.deserializeFromBytes(&pool, buf);
    defer pool.unref(round_id);
    try std.testing.expectEqualSlices(u8, tree_id.getRoot(&pool), round_id.getRoot(&pool));
}

test "fixed vector streaming hashes match trees across packed batch boundaries" {
    const allocator = std.testing.allocator;
    inline for (.{ UintType(64), BoolType() }) |Element| {
        const per_chunk = 32 / Element.fixed_size;
        inline for (.{ 1, per_chunk - 1, per_chunk, per_chunk + 1, 63 * per_chunk, 64 * per_chunk, 65 * per_chunk + 1 }) |len| {
            const Vector = FixedVectorType(Element, len, .{});
            var value: Vector.Type = undefined;
            for (&value, 0..) |*item, i| item.* = if (Element.kind == .bool) i % 3 == 0 else @intCast(i * 17);
            var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
            defer pool.deinit();
            const node = try Vector.tree.fromValue(&pool, &value);
            defer pool.unref(node);
            var root: [32]u8 = undefined;
            try Vector.hashTreeRoot(&value, &root);
            try std.testing.expectEqualSlices(u8, node.getRoot(&pool), &root);
            var bytes: [Vector.fixed_size]u8 = undefined;
            _ = Vector.serializeIntoBytes(&value, &bytes);
            try Vector.serialized.hashTreeRoot(&bytes, &root);
            try std.testing.expectEqualSlices(u8, node.getRoot(&pool), &root);
            try std.testing.expectError(error.InvalidSize, Vector.serialized.hashTreeRoot(bytes[0 .. bytes.len - 1], &root));
        }
    }
}

test "fixed composite vector streaming hashes match tree roots" {
    const Element = FixedContainerType(struct { number: UintType(64), root: ByteVectorType(32) });
    const Vector = FixedVectorType(Element, 65, .{});
    var value = Vector.default_value;
    for (&value, 0..) |*item, i| item.* = .{ .number = i, .root = @splat(@intCast(i)) };
    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1024 });
    defer pool.deinit();
    const node = try Vector.tree.fromValue(&pool, &value);
    defer pool.unref(node);
    var root: [32]u8 = undefined;
    try Vector.hashTreeRoot(&value, &root);
    try std.testing.expectEqualSlices(u8, node.getRoot(&pool), &root);
    var bytes: [Vector.fixed_size]u8 = undefined;
    _ = Vector.serializeIntoBytes(&value, &bytes);
    try Vector.serialized.hashTreeRoot(&bytes, &root);
    try std.testing.expectEqualSlices(u8, node.getRoot(&pool), &root);
}

test "variable vector streaming hashes need no scratch allocation" {
    const allocator = std.testing.allocator;
    const Element = @import("byte_list.zig").ByteListType(33);
    inline for (.{ 1, 63, 64, 65, 129 }) |len| {
        const Vector = VariableVectorType(Element, len);
        var value = Vector.default_value;
        defer Vector.deinit(allocator, &value);
        for (&value, 0..) |*item, i| {
            try item.resize(allocator, i % 34);
            @memset(item.items, @truncate(i));
        }
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 2048 });
        defer pool.deinit();
        const node = try Vector.tree.fromValue(&pool, &value);
        defer pool.unref(node);
        const bytes = try allocator.alloc(u8, Vector.serializedSize(&value));
        defer allocator.free(bytes);
        _ = Vector.serializeIntoBytes(&value, bytes);
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
        var root: [32]u8 = undefined;
        try Vector.hashTreeRoot(failing.allocator(), &value, &root);
        try std.testing.expectEqualSlices(u8, node.getRoot(&pool), &root);
        try Vector.serialized.hashTreeRoot(failing.allocator(), bytes, &root);
        try std.testing.expectEqualSlices(u8, node.getRoot(&pool), &root);
        std.mem.writeInt(u32, bytes[0..4], 0, .little);
        try std.testing.expectError(error.zeroOffset, Vector.serialized.hashTreeRoot(failing.allocator(), bytes, &root));
    }
}

test "memory_safety: VariableVector deserializeFromBytes leaves out deinit-safe on malformed input" {
    const Vector = VariableVectorType(ByteListType(2), 3);
    const cases = .{
        // Element 0 decodes into an allocation before the third offset (12) falls below the
        // second (13).
        .{ &[_]u8{ 12, 0, 0, 0, 13, 0, 0, 0, 12, 0, 0, 0, 1 }, error.offsetNotIncreasing },
        // Element 0 decodes into an allocation; element 1 holds three bytes, over its limit of two.
        .{ &[_]u8{ 12, 0, 0, 0, 13, 0, 0, 0, 16, 0, 0, 0, 1, 2, 3, 4 }, error.invalidLength },
    };
    inline for (cases) |case| {
        var out = Vector.default_value;
        defer Vector.deinit(std.testing.allocator, &out);
        try std.testing.expectError(
            case[1],
            Vector.deserializeFromBytes(std.testing.allocator, case[0], &out),
        );
    }
}

test "memory_safety: VariableVector deserializeFromBytes leaves out deinit-safe on OOM" {
    const Vector = VariableVectorType(ByteListType(2), 2);
    const serialized = [_]u8{ 8, 0, 0, 0, 9, 0, 0, 0, 1, 2, 3 };

    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(allocator: std.mem.Allocator, bytes: []const u8) !void {
            var out = Vector.default_value;
            defer Vector.deinit(allocator, &out);
            try Vector.deserializeFromBytes(allocator, bytes, &out);
            try std.testing.expectEqualSlices(u8, &.{1}, out[0].items);
            try std.testing.expectEqualSlices(u8, &.{ 2, 3 }, out[1].items);
        }
    }.run, .{&serialized});
}
