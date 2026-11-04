//! Tests for `byte_vector.zig`.

const std = @import("std");
const expectEqualRoots = @import("test_utils.zig").expectEqualRoots;
const expectEqualSerialized = @import("test_utils.zig").expectEqualSerialized;
const Node = @import("persistent_merkle_tree").Node;
const ByteVectorType = @import("byte_vector.zig").ByteVectorType;

test "clone" {
    const length = 44;
    const Bytes = ByteVectorType(length);

    var b = [_]u8{1} ** length;
    var cloned: [44]u8 = undefined;
    try Bytes.clone(&b, &cloned);
    try std.testing.expect(&b != &cloned);
    try std.testing.expect(std.mem.eql(u8, b[0..], cloned[0..]));
    try expectEqualRoots(Bytes, b, cloned);
    try expectEqualSerialized(Bytes, b, cloned);
}

// Refer to https://github.com/ChainSafe/ssz/blob/f5ed0b457333749b5c3f49fa5eafa096a725f033/packages/ssz/test/unit/byType/byteVector/valid.test.ts#L4-L61
test "ByteVectorType(4) - serializeIntoBytes (zero)" {
    const allocator = std.testing.allocator;
    const ByteVector4 = ByteVectorType(4);

    const value = [_]u8{ 0x00, 0x00, 0x00, 0x00 };

    var serialized: [4]u8 = undefined;
    const size = ByteVector4.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 4), size);
    try std.testing.expectEqualSlices(u8, &[_]u8{ 0x00, 0x00, 0x00, 0x00 }, &serialized);

    var root: [32]u8 = undefined;
    try ByteVector4.hashTreeRoot(&value, &root);
    // 0x0000000000000000000000000000000000000000000000000000000000000000
    const expected_root = [_]u8{0x00} ** 32;
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 32 });
    defer pool.deinit();
    const tree_node = try ByteVector4.tree.fromValue(&pool, &value);
    var tree_serialized: [4]u8 = undefined;
    _ = try ByteVector4.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "ByteVectorType(4) - serializeIntoBytes (some value)" {
    const allocator = std.testing.allocator;
    const ByteVector4 = ByteVectorType(4);

    // 0x0cb94737
    const value = [_]u8{ 0x0c, 0xb9, 0x47, 0x37 };

    var serialized: [4]u8 = undefined;
    const size = ByteVector4.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 4), size);
    try std.testing.expectEqualSlices(u8, &value, &serialized);

    var root: [32]u8 = undefined;
    try ByteVector4.hashTreeRoot(&value, &root);
    // 0x0cb9473700000000000000000000000000000000000000000000000000000000
    const expected_root = [_]u8{ 0x0c, 0xb9, 0x47, 0x37 } ++ [_]u8{0x00} ** 28;
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 32 });
    defer pool.deinit();
    const tree_node = try ByteVector4.tree.fromValue(&pool, &value);
    var tree_serialized: [4]u8 = undefined;
    _ = try ByteVector4.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "ByteVectorType(32) - serializeIntoBytes (zero)" {
    const allocator = std.testing.allocator;
    const ByteVector32 = ByteVectorType(32);

    const value = [_]u8{0x00} ** 32;

    var serialized: [32]u8 = undefined;
    const size = ByteVector32.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 32), size);
    try std.testing.expectEqualSlices(u8, &value, &serialized);

    var root: [32]u8 = undefined;
    try ByteVector32.hashTreeRoot(&value, &root);
    // 0x0000000000000000000000000000000000000000000000000000000000000000
    const expected_root = [_]u8{0x00} ** 32;
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 32 });
    defer pool.deinit();
    const tree_node = try ByteVector32.tree.fromValue(&pool, &value);
    var tree_serialized: [32]u8 = undefined;
    _ = try ByteVector32.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "ByteVectorType(32) - serializeIntoBytes (some value)" {
    const allocator = std.testing.allocator;
    const ByteVector32 = ByteVectorType(32);

    // 0x0cb947377e177f774719ead8d210af9c6461f41baf5b4082f86a3911454831b8
    const value = [_]u8{ 0x0c, 0xb9, 0x47, 0x37, 0x7e, 0x17, 0x7f, 0x77, 0x47, 0x19, 0xea, 0xd8, 0xd2, 0x10, 0xaf, 0x9c, 0x64, 0x61, 0xf4, 0x1b, 0xaf, 0x5b, 0x40, 0x82, 0xf8, 0x6a, 0x39, 0x11, 0x45, 0x48, 0x31, 0xb8 };

    var serialized: [32]u8 = undefined;
    const size = ByteVector32.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 32), size);
    try std.testing.expectEqualSlices(u8, &value, &serialized);

    var root: [32]u8 = undefined;
    try ByteVector32.hashTreeRoot(&value, &root);
    // root equals the value itself for 32-byte vector
    try std.testing.expectEqualSlices(u8, &value, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 32 });
    defer pool.deinit();
    const tree_node = try ByteVector32.tree.fromValue(&pool, &value);
    var tree_serialized: [32]u8 = undefined;
    _ = try ByteVector32.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "ByteVectorType(96) - serializeIntoBytes (zero)" {
    const allocator = std.testing.allocator;
    const ByteVector96 = ByteVectorType(96);

    const value = [_]u8{0x00} ** 96;

    var serialized: [96]u8 = undefined;
    const size = ByteVector96.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 96), size);
    try std.testing.expectEqualSlices(u8, &value, &serialized);

    var root: [32]u8 = undefined;
    try ByteVector96.hashTreeRoot(&value, &root);
    // 0xdb56114e00fdd4c1f85c892bf35ac9a89289aaecb1ebd0a96cde606a748b5d71
    const expected_root = [_]u8{ 0xdb, 0x56, 0x11, 0x4e, 0x00, 0xfd, 0xd4, 0xc1, 0xf8, 0x5c, 0x89, 0x2b, 0xf3, 0x5a, 0xc9, 0xa8, 0x92, 0x89, 0xaa, 0xec, 0xb1, 0xeb, 0xd0, 0xa9, 0x6c, 0xde, 0x60, 0x6a, 0x74, 0x8b, 0x5d, 0x71 };
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const tree_node = try ByteVector96.tree.fromValue(&pool, &value);
    var tree_serialized: [96]u8 = undefined;
    _ = try ByteVector96.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "ByteVectorType(96) - serializeIntoBytes (some value)" {
    const allocator = std.testing.allocator;
    const ByteVector96 = ByteVectorType(96);

    // 0xb55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1 repeated 3 times
    const chunk = [_]u8{ 0xb5, 0x5b, 0x85, 0x92, 0xbc, 0xac, 0x47, 0x59, 0x06, 0x63, 0x14, 0x81, 0xbb, 0xc7, 0x46, 0xbc, 0xa7, 0x33, 0x9d, 0x04, 0xab, 0x10, 0x85, 0xe8, 0x48, 0x84, 0xa7, 0x00, 0xc0, 0x3d, 0xe4, 0xb1 };
    const value = chunk ++ chunk ++ chunk;

    var serialized: [96]u8 = undefined;
    const size = ByteVector96.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 96), size);
    try std.testing.expectEqualSlices(u8, &value, &serialized);

    var root: [32]u8 = undefined;
    try ByteVector96.hashTreeRoot(&value, &root);
    // 0x032eecca637b67fd922e0e421b4be9c22948719ba02c6d03eb2c61cfdc4cb3e3
    const expected_root = [_]u8{ 0x03, 0x2e, 0xec, 0xca, 0x63, 0x7b, 0x67, 0xfd, 0x92, 0x2e, 0x0e, 0x42, 0x1b, 0x4b, 0xe9, 0xc2, 0x29, 0x48, 0x71, 0x9b, 0xa0, 0x2c, 0x6d, 0x03, 0xeb, 0x2c, 0x61, 0xcf, 0xdc, 0x4c, 0xb3, 0xe3 };
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const tree_node = try ByteVector96.tree.fromValue(&pool, &value);
    var tree_serialized: [96]u8 = undefined;
    _ = try ByteVector96.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "ByteVectorType(32) - tree.deserializeFromBytes" {
    const allocator = std.testing.allocator;
    const ByteVector32 = ByteVectorType(32);

    const TestCase = struct {
        id: []const u8,
        serialized: [32]u8,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "zero",
            .serialized = [_]u8{0x00} ** 32,
            .expected_root = [_]u8{0x00} ** 32,
        },
        .{
            .id = "some value",
            .serialized = [_]u8{ 0x0c, 0xb9, 0x47, 0x37, 0x7e, 0x17, 0x7f, 0x77, 0x47, 0x19, 0xea, 0xd8, 0xd2, 0x10, 0xaf, 0x9c, 0x64, 0x61, 0xf4, 0x1b, 0xaf, 0x5b, 0x40, 0x82, 0xf8, 0x6a, 0x39, 0x11, 0x45, 0x48, 0x31, 0xb8 },
            .expected_root = [_]u8{ 0x0c, 0xb9, 0x47, 0x37, 0x7e, 0x17, 0x7f, 0x77, 0x47, 0x19, 0xea, 0xd8, 0xd2, 0x10, 0xaf, 0x9c, 0x64, 0x61, 0xf4, 0x1b, 0xaf, 0x5b, 0x40, 0x82, 0xf8, 0x6a, 0x39, 0x11, 0x45, 0x48, 0x31, 0xb8 },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();

    for (test_cases) |tc| {
        const tree_node = try ByteVector32.tree.deserializeFromBytes(&pool, &tc.serialized);

        const node_root = tree_node.getRoot(&pool);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, node_root);

        var value_from_tree: ByteVector32.Type = undefined;
        try ByteVector32.tree.toValue(tree_node, &pool, &value_from_tree);

        var tree_serialized: [32]u8 = undefined;
        _ = try ByteVector32.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
        try std.testing.expectEqualSlices(u8, &tc.serialized, &tree_serialized);

        var hash_root: [32]u8 = undefined;
        try ByteVector32.hashTreeRoot(&value_from_tree, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "ByteVectorType(96) - tree.deserializeFromBytes" {
    const allocator = std.testing.allocator;
    const ByteVector96 = ByteVectorType(96);

    // 0xb55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1 repeated 3 times
    const chunk = [_]u8{ 0xb5, 0x5b, 0x85, 0x92, 0xbc, 0xac, 0x47, 0x59, 0x06, 0x63, 0x14, 0x81, 0xbb, 0xc7, 0x46, 0xbc, 0xa7, 0x33, 0x9d, 0x04, 0xab, 0x10, 0x85, 0xe8, 0x48, 0x84, 0xa7, 0x00, 0xc0, 0x3d, 0xe4, 0xb1 };
    const serialized = chunk ++ chunk ++ chunk;
    // 0x032eecca637b67fd922e0e421b4be9c22948719ba02c6d03eb2c61cfdc4cb3e3
    const expected_root = [_]u8{ 0x03, 0x2e, 0xec, 0xca, 0x63, 0x7b, 0x67, 0xfd, 0x92, 0x2e, 0x0e, 0x42, 0x1b, 0x4b, 0xe9, 0xc2, 0x29, 0x48, 0x71, 0x9b, 0xa0, 0x2c, 0x6d, 0x03, 0xeb, 0x2c, 0x61, 0xcf, 0xdc, 0x4c, 0xb3, 0xe3 };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();

    const tree_node = try ByteVector96.tree.deserializeFromBytes(&pool, &serialized);

    const node_root = tree_node.getRoot(&pool);
    try std.testing.expectEqualSlices(u8, &expected_root, node_root);

    var value_from_tree: ByteVector96.Type = undefined;
    try ByteVector96.tree.toValue(tree_node, &pool, &value_from_tree);

    var tree_serialized: [96]u8 = undefined;
    _ = try ByteVector96.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);

    var hash_root: [32]u8 = undefined;
    try ByteVector96.hashTreeRoot(&value_from_tree, &hash_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &hash_root);
}

test "ByteVectorType - default_root" {
    const ByteVector4 = ByteVectorType(4);
    var expected_root: [32]u8 = undefined;
    try ByteVector4.hashTreeRoot(&ByteVector4.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &ByteVector4.default_root);

    const ByteVector32 = ByteVectorType(32);
    try ByteVector32.hashTreeRoot(&ByteVector32.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &ByteVector32.default_root);

    const ByteVector96 = ByteVectorType(96);
    try ByteVector96.hashTreeRoot(&ByteVector96.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &ByteVector96.default_root);

    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1024 });
    defer pool.deinit();

    const node_4 = try ByteVector4.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &ByteVector4.default_root, node_4.getRoot(&pool));

    const node_32 = try ByteVector32.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &ByteVector32.default_root, node_32.getRoot(&pool));

    const node_96 = try ByteVector96.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &ByteVector96.default_root, node_96.getRoot(&pool));
}

test "memory_safety: ByteVector tree.deserializeFromBytes should reclaim partial leaves on pool exhaustion" {
    const VectorType = ByteVectorType(64);
    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1 });
    defer pool.deinit();

    const baseline = pool.getNodesInUse();
    const bytes = [_]u8{0} ** VectorType.fixed_size;

    try std.testing.expectError(
        error.PoolExhausted,
        VectorType.tree.deserializeFromBytes(&pool, &bytes),
    );
    // The first leaf must not remain in the pool after the second leaf allocation fails.
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}

test "memory_safety: ByteVector tree.fromValue should reclaim leaves when the pool is exhausted" {
    const VectorType = ByteVectorType(64);
    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 2 });
    defer pool.deinit();

    const baseline = pool.getNodesInUse();

    try std.testing.expectError(
        error.PoolExhausted,
        VectorType.tree.fromValue(&pool, &VectorType.default_value),
    );
    // The two leaves must not remain in the pool after parent construction fails.
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}
