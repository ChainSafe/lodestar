//! Tests for `bit_vector.zig`.

const std = @import("std");
const test_utils = @import("test_utils.zig");
const expectEqualRoots = test_utils.expectEqualRoots;
const expectEqualSerialized = test_utils.expectEqualSerialized;
const Node = @import("persistent_merkle_tree").Node;
const TypeTestCase = test_utils.TypeTestCase;
const BitVectorType = @import("bit_vector.zig").BitVectorType;

test "BitVectorType - sanity" {
    const length = 44;
    const Bits = BitVectorType(length);
    var b: Bits.Type = Bits.default_value;
    try b.set(0, true);
    try b.set(length - 1, true);

    try std.testing.expectEqual(true, try b.get(0));

    for (1..length - 1) |i| {
        try std.testing.expectEqual(false, try b.get(i));
    }
    try std.testing.expectEqual(true, try b.get(length - 1));

    var b_buf: [Bits.fixed_size]u8 = undefined;
    _ = Bits.serializeIntoBytes(&b, &b_buf);
    var b_decoded = Bits.default_value;
    try Bits.deserializeFromBytes(&b_buf, &b_decoded);
}

test "clone" {
    const length = 44;
    const Bits = BitVectorType(length);
    var b: Bits.Type = Bits.default_value;
    try b.set(0, true);
    try b.set(length - 1, true);

    var cloned: Bits.Type = undefined;
    try Bits.clone(&b, &cloned);
    try std.testing.expect(&b != &cloned);
    try std.testing.expect(std.mem.eql(u8, b.data[0..], cloned.data[0..]));

    try expectEqualRoots(Bits, b, cloned);
    try expectEqualSerialized(Bits, b, cloned);
}

// Refer to https://github.com/ChainSafe/ssz/blob/f5ed0b457333749b5c3f49fa5eafa096a725f033/packages/ssz/test/unit/byType/bitVector/valid.test.ts#L4-L21
test "BitVectorType - tree roundtrip 128 bits" {
    const allocator = std.testing.allocator;

    const Bits = BitVectorType(128);

    const TestCase = struct {
        id: []const u8,
        serialized: [16]u8,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty (one bit set)",
            .serialized = [_]u8{ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01 },
            // root is padded serialized (16 bytes -> 32 bytes)
            .expected_root = [_]u8{ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 },
        },
        .{
            .id = "some value",
            .serialized = [_]u8{ 0xb5, 0x5b, 0x85, 0x92, 0xbc, 0xac, 0x47, 0x59, 0x06, 0x63, 0x14, 0x81, 0xbb, 0xc7, 0x46, 0xbc },
            .expected_root = [_]u8{ 0xb5, 0x5b, 0x85, 0x92, 0xbc, 0xac, 0x47, 0x59, 0x06, 0x63, 0x14, 0x81, 0xbb, 0xc7, 0x46, 0xbc, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (test_cases) |tc| {
        var value: Bits.Type = undefined;
        try Bits.deserializeFromBytes(&tc.serialized, &value);

        const tree_node = try Bits.tree.fromValue(&pool, &value);

        var value_from_tree: Bits.Type = undefined;
        try Bits.tree.toValue(tree_node, &pool, &value_from_tree);

        try std.testing.expect(Bits.equals(&value, &value_from_tree));

        const tree_size = Bits.fixed_size;
        try std.testing.expectEqual(tc.serialized.len, tree_size);

        var tree_serialized: [Bits.fixed_size]u8 = undefined;
        _ = try Bits.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
        try std.testing.expectEqualSlices(u8, &tc.serialized, &tree_serialized);

        var hash_root: [32]u8 = undefined;
        try Bits.hashTreeRoot(&value, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

// Refer to https://github.com/ChainSafe/ssz/blob/f5ed0b457333749b5c3f49fa5eafa096a725f033/packages/ssz/test/unit/byType/bitVector/valid.test.ts#L23-L42
test "BitVectorType - tree roundtrip 512 bits" {
    const allocator = std.testing.allocator;

    const Bits = BitVectorType(512);

    const TestCase = struct {
        id: []const u8,
        serialized: [64]u8,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty (one bit set)",
            // 0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001
            .serialized = [_]u8{ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01 },
            // 0x90f4b39548df55ad6187a1d20d731ecee78c545b94afd16f42ef7592d99cd365
            .expected_root = [_]u8{ 0x90, 0xf4, 0xb3, 0x95, 0x48, 0xdf, 0x55, 0xad, 0x61, 0x87, 0xa1, 0xd2, 0x0d, 0x73, 0x1e, 0xce, 0xe7, 0x8c, 0x54, 0x5b, 0x94, 0xaf, 0xd1, 0x6f, 0x42, 0xef, 0x75, 0x92, 0xd9, 0x9c, 0xd3, 0x65 },
        },
        .{
            .id = "some value",
            // 0xb55b8592bcac475906631481bbc746bccb647cbb184136609574cacb2958b55bb55b8592bcac475906631481bbc746bccb647cbb184136609574cacb2958b55b
            .serialized = [_]u8{ 0xb5, 0x5b, 0x85, 0x92, 0xbc, 0xac, 0x47, 0x59, 0x06, 0x63, 0x14, 0x81, 0xbb, 0xc7, 0x46, 0xbc, 0xcb, 0x64, 0x7c, 0xbb, 0x18, 0x41, 0x36, 0x60, 0x95, 0x74, 0xca, 0xcb, 0x29, 0x58, 0xb5, 0x5b, 0xb5, 0x5b, 0x85, 0x92, 0xbc, 0xac, 0x47, 0x59, 0x06, 0x63, 0x14, 0x81, 0xbb, 0xc7, 0x46, 0xbc, 0xcb, 0x64, 0x7c, 0xbb, 0x18, 0x41, 0x36, 0x60, 0x95, 0x74, 0xca, 0xcb, 0x29, 0x58, 0xb5, 0x5b },
            // 0xf5619a9b3c6831a68fdbd1b30b69843c778b9d36ed1ff6831339ba0f723dbea0
            .expected_root = [_]u8{ 0xf5, 0x61, 0x9a, 0x9b, 0x3c, 0x68, 0x31, 0xa6, 0x8f, 0xdb, 0xd1, 0xb3, 0x0b, 0x69, 0x84, 0x3c, 0x77, 0x8b, 0x9d, 0x36, 0xed, 0x1f, 0xf6, 0x83, 0x13, 0x39, 0xba, 0x0f, 0x72, 0x3d, 0xbe, 0xa0 },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (test_cases) |tc| {
        var value: Bits.Type = undefined;
        try Bits.deserializeFromBytes(&tc.serialized, &value);

        const tree_node = try Bits.tree.fromValue(&pool, &value);

        var value_from_tree: Bits.Type = undefined;
        try Bits.tree.toValue(tree_node, &pool, &value_from_tree);

        try std.testing.expect(Bits.equals(&value, &value_from_tree));

        const tree_size = Bits.fixed_size;
        try std.testing.expectEqual(tc.serialized.len, tree_size);

        var tree_serialized: [Bits.fixed_size]u8 = undefined;
        _ = try Bits.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
        try std.testing.expectEqualSlices(u8, &tc.serialized, &tree_serialized);

        var hash_root: [32]u8 = undefined;
        try Bits.hashTreeRoot(&value, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "BitVectorType - tree.deserializeFromBytes 128 bits" {
    const allocator = std.testing.allocator;

    const Bits = BitVectorType(128);

    const TestCase = struct {
        id: []const u8,
        serialized: [16]u8,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty (one bit set)",
            .serialized = [_]u8{ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01 },
            .expected_root = [_]u8{ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 },
        },
        .{
            .id = "some value",
            .serialized = [_]u8{ 0xb5, 0x5b, 0x85, 0x92, 0xbc, 0xac, 0x47, 0x59, 0x06, 0x63, 0x14, 0x81, 0xbb, 0xc7, 0x46, 0xbc },
            .expected_root = [_]u8{ 0xb5, 0x5b, 0x85, 0x92, 0xbc, 0xac, 0x47, 0x59, 0x06, 0x63, 0x14, 0x81, 0xbb, 0xc7, 0x46, 0xbc, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (test_cases) |tc| {
        const tree_node = try Bits.tree.deserializeFromBytes(&pool, &tc.serialized);

        const node_root = tree_node.getRoot(&pool);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, node_root);

        var value_from_tree: Bits.Type = undefined;
        try Bits.tree.toValue(tree_node, &pool, &value_from_tree);

        var tree_serialized: [Bits.fixed_size]u8 = undefined;
        _ = try Bits.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
        try std.testing.expectEqualSlices(u8, &tc.serialized, &tree_serialized);

        var hash_root: [32]u8 = undefined;
        try Bits.hashTreeRoot(&value_from_tree, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "BitVectorType of 128 bits" {
    const testCases = [_]TypeTestCase{
        .{
            .id = "empty",
            .serializedHex = "0x00000000000000000000000000000001",
            .json =
            \\"0x00000000000000000000000000000001"
            ,
            .rootHex = "0x0000000000000000000000000000000100000000000000000000000000000000",
        },
        .{
            .id = "some value",
            .serializedHex = "0xb55b8592bcac475906631481bbc746bc",
            .json =
            \\"0xb55b8592bcac475906631481bbc746bc"
            ,
            .rootHex = "0xb55b8592bcac475906631481bbc746bc00000000000000000000000000000000",
        },
    };

    const allocator = std.testing.allocator;
    const BV = BitVectorType(128);
    const TypeTest = @import("test_utils.zig").typeTest(BV);

    for (testCases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "BitVectorType of 512 bits" {
    const testCases = [_]TypeTestCase{
        .{
            .id = "empty",
            .serializedHex = "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001",
            .json =
            \\"0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
            ,
            .rootHex = "0x90f4b39548df55ad6187a1d20d731ecee78c545b94afd16f42ef7592d99cd365",
        },
        .{
            .id = "some value",
            .serializedHex = "0xb55b8592bcac475906631481bbc746bccb647cbb184136609574cacb2958b55bb55b8592bcac475906631481bbc746bccb647cbb184136609574cacb2958b55b",
            .json =
            \\"0xb55b8592bcac475906631481bbc746bccb647cbb184136609574cacb2958b55bb55b8592bcac475906631481bbc746bccb647cbb184136609574cacb2958b55b"
            ,
            .rootHex = "0xf5619a9b3c6831a68fdbd1b30b69843c778b9d36ed1ff6831339ba0f723dbea0",
        },
    };

    const allocator = std.testing.allocator;
    const BV = BitVectorType(512);
    const TypeTest = @import("test_utils.zig").typeTest(BV);

    for (testCases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "BitVectorType equals" {
    const BV = BitVectorType(16);

    var a = BV.Type.empty;
    var b = BV.Type.empty;
    var c = BV.Type.empty;

    try a.set(0, true);
    try a.set(5, true);
    try a.set(15, true);

    try b.set(0, true);
    try b.set(5, true);
    try b.set(15, true);

    try c.set(0, true);
    try c.set(5, true);
    try c.set(14, true);

    try std.testing.expect(BV.equals(&a, &b));
    try std.testing.expect(!BV.equals(&a, &c));
}

test "BitVectorType - default_root" {
    const Bits128 = BitVectorType(128);
    var expected_root: [32]u8 = undefined;
    try Bits128.hashTreeRoot(&Bits128.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &Bits128.default_root, &expected_root);

    const Bits513 = BitVectorType(513);
    try Bits513.hashTreeRoot(&Bits513.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &Bits513.default_root, &expected_root);

    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1024 });
    defer pool.deinit();

    const node_128 = try Bits128.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &Bits128.default_root, node_128.getRoot(&pool));

    const node_513 = try Bits513.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &Bits513.default_root, node_513.getRoot(&pool));
}

test "memory_safety: BitVector tree.deserializeFromBytes should reclaim partial leaves on pool exhaustion" {
    const VectorType = BitVectorType(512);
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

test "memory_safety: BitVector tree.fromValue should reclaim leaves when the pool is exhausted" {
    const VectorType = BitVectorType(512);
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
