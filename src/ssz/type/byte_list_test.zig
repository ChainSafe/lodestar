//! Tests for `byte_list.zig`.

const std = @import("std");
const test_utils = @import("test_utils.zig");
const expectEqualRootsAlloc = test_utils.expectEqualRootsAlloc;
const expectEqualSerializedAlloc = test_utils.expectEqualSerializedAlloc;
const Node = @import("persistent_merkle_tree").Node;
const TypeTestCase = test_utils.TypeTestCase;
const ByteListType = @import("byte_list.zig").ByteListType;

test "clone" {
    const allocator = std.testing.allocator;

    const length = 44;
    const Bits = ByteListType(length);
    var b = Bits.default_value;
    defer b.deinit(allocator);
    try b.append(allocator, 5);

    var cloned = Bits.default_value;
    defer cloned.deinit(allocator);
    try Bits.clone(allocator, &b, &cloned);
    try std.testing.expect(&b != &cloned);
    try std.testing.expect(std.mem.eql(u8, b.items, cloned.items));
    try expectEqualRootsAlloc(Bits, allocator, b, cloned);
    try expectEqualSerializedAlloc(Bits, allocator, b, cloned);
}

// Refer to https://github.com/ChainSafe/ssz/blob/f5ed0b457333749b5c3f49fa5eafa096a725f033/packages/ssz/test/unit/byType/byteList/valid.test.ts#L26-L77
test "ByteListType - serializeIntoBytes (empty)" {
    const allocator = std.testing.allocator;
    const ByteList256 = ByteListType(256);

    var value = ByteList256.default_value;
    defer value.deinit(allocator);

    const size = ByteList256.serializedSize(&value);
    try std.testing.expectEqual(@as(usize, 0), size);

    var root: [32]u8 = undefined;
    try ByteList256.hashTreeRoot(allocator, &value, &root);
    // 0xe8e527e84f666163a90ef900e013f56b0a4d020148b2224057b719f351b003a6
    const expected_root = [_]u8{ 0xe8, 0xe5, 0x27, 0xe8, 0x4f, 0x66, 0x61, 0x63, 0xa9, 0x0e, 0xf9, 0x00, 0xe0, 0x13, 0xf5, 0x6b, 0x0a, 0x4d, 0x02, 0x01, 0x48, 0xb2, 0x22, 0x40, 0x57, 0xb7, 0x19, 0xf3, 0x51, 0xb0, 0x03, 0xa6 };
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const tree_node = try ByteList256.tree.fromValue(&pool, &value);
    const tree_size = try ByteList256.tree.serializedSize(tree_node, &pool);
    try std.testing.expectEqual(@as(usize, 0), tree_size);
}

test "ByteListType - serializeIntoBytes (4 bytes zero)" {
    const allocator = std.testing.allocator;
    const ByteList256 = ByteListType(256);

    var value = ByteList256.default_value;
    defer value.deinit(allocator);
    try value.appendSlice(allocator, &[_]u8{ 0x00, 0x00, 0x00, 0x00 });

    var serialized: [4]u8 = undefined;
    const size = ByteList256.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 4), size);
    try std.testing.expectEqualSlices(u8, &[_]u8{ 0x00, 0x00, 0x00, 0x00 }, &serialized);

    var root: [32]u8 = undefined;
    try ByteList256.hashTreeRoot(allocator, &value, &root);
    // 0xa39babe565305429771fc596a639d6e05b2d0304297986cdd2ef388c1936885e
    const expected_root = [_]u8{ 0xa3, 0x9b, 0xab, 0xe5, 0x65, 0x30, 0x54, 0x29, 0x77, 0x1f, 0xc5, 0x96, 0xa6, 0x39, 0xd6, 0xe0, 0x5b, 0x2d, 0x03, 0x04, 0x29, 0x79, 0x86, 0xcd, 0xd2, 0xef, 0x38, 0x8c, 0x19, 0x36, 0x88, 0x5e };
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const tree_node = try ByteList256.tree.fromValue(&pool, &value);
    var tree_serialized: [4]u8 = undefined;
    _ = try ByteList256.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "ByteListType - serializeIntoBytes (4 bytes some value)" {
    const allocator = std.testing.allocator;
    const ByteList256 = ByteListType(256);

    var value = ByteList256.default_value;
    defer value.deinit(allocator);
    // 0x0cb94737
    try value.appendSlice(allocator, &[_]u8{ 0x0c, 0xb9, 0x47, 0x37 });

    var serialized: [4]u8 = undefined;
    const size = ByteList256.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 4), size);
    try std.testing.expectEqualSlices(u8, &[_]u8{ 0x0c, 0xb9, 0x47, 0x37 }, &serialized);

    var root: [32]u8 = undefined;
    try ByteList256.hashTreeRoot(allocator, &value, &root);
    // 0x2e14da116ecbec4c8d693656fb5b69bb0ea9e84ecdd15aba7be1c008633f2885
    const expected_root = [_]u8{ 0x2e, 0x14, 0xda, 0x11, 0x6e, 0xcb, 0xec, 0x4c, 0x8d, 0x69, 0x36, 0x56, 0xfb, 0x5b, 0x69, 0xbb, 0x0e, 0xa9, 0xe8, 0x4e, 0xcd, 0xd1, 0x5a, 0xba, 0x7b, 0xe1, 0xc0, 0x08, 0x63, 0x3f, 0x28, 0x85 };
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const tree_node = try ByteList256.tree.fromValue(&pool, &value);
    var tree_serialized: [4]u8 = undefined;
    _ = try ByteList256.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "ByteListType - serializeIntoBytes (32 bytes zero)" {
    const allocator = std.testing.allocator;
    const ByteList256 = ByteListType(256);

    var value = ByteList256.default_value;
    defer value.deinit(allocator);
    try value.appendSlice(allocator, &([_]u8{0x00} ** 32));

    var serialized: [32]u8 = undefined;
    const size = ByteList256.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 32), size);
    try std.testing.expectEqualSlices(u8, &([_]u8{0x00} ** 32), &serialized);

    var root: [32]u8 = undefined;
    try ByteList256.hashTreeRoot(allocator, &value, &root);
    // 0xbae146b221eca758702e29b45ee7f7dc3eea17d119dd0a3094481e3f94706c96
    const expected_root = [_]u8{ 0xba, 0xe1, 0x46, 0xb2, 0x21, 0xec, 0xa7, 0x58, 0x70, 0x2e, 0x29, 0xb4, 0x5e, 0xe7, 0xf7, 0xdc, 0x3e, 0xea, 0x17, 0xd1, 0x19, 0xdd, 0x0a, 0x30, 0x94, 0x48, 0x1e, 0x3f, 0x94, 0x70, 0x6c, 0x96 };
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const tree_node = try ByteList256.tree.fromValue(&pool, &value);
    var tree_serialized: [32]u8 = undefined;
    _ = try ByteList256.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "ByteListType - serializeIntoBytes (32 bytes some value)" {
    const allocator = std.testing.allocator;
    const ByteList256 = ByteListType(256);

    var value = ByteList256.default_value;
    defer value.deinit(allocator);
    // 0x0cb947377e177f774719ead8d210af9c6461f41baf5b4082f86a3911454831b8
    const data = [_]u8{ 0x0c, 0xb9, 0x47, 0x37, 0x7e, 0x17, 0x7f, 0x77, 0x47, 0x19, 0xea, 0xd8, 0xd2, 0x10, 0xaf, 0x9c, 0x64, 0x61, 0xf4, 0x1b, 0xaf, 0x5b, 0x40, 0x82, 0xf8, 0x6a, 0x39, 0x11, 0x45, 0x48, 0x31, 0xb8 };
    try value.appendSlice(allocator, &data);

    var serialized: [32]u8 = undefined;
    const size = ByteList256.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 32), size);
    try std.testing.expectEqualSlices(u8, &data, &serialized);

    var root: [32]u8 = undefined;
    try ByteList256.hashTreeRoot(allocator, &value, &root);
    // 0x50425dbd7a34b50b20916e965ce5c060abe6516ac71bb00a4afebe5d5c4568b8
    const expected_root = [_]u8{ 0x50, 0x42, 0x5d, 0xbd, 0x7a, 0x34, 0xb5, 0x0b, 0x20, 0x91, 0x6e, 0x96, 0x5c, 0xe5, 0xc0, 0x60, 0xab, 0xe6, 0x51, 0x6a, 0xc7, 0x1b, 0xb0, 0x0a, 0x4a, 0xfe, 0xbe, 0x5d, 0x5c, 0x45, 0x68, 0xb8 };
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const tree_node = try ByteList256.tree.fromValue(&pool, &value);
    var tree_serialized: [32]u8 = undefined;
    _ = try ByteList256.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "ByteListType - serializeIntoBytes (96 bytes some value)" {
    const allocator = std.testing.allocator;
    const ByteList256 = ByteListType(256);

    var value = ByteList256.default_value;
    defer value.deinit(allocator);
    // 0xb55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1 repeated 3 times
    const chunk = [_]u8{ 0xb5, 0x5b, 0x85, 0x92, 0xbc, 0xac, 0x47, 0x59, 0x06, 0x63, 0x14, 0x81, 0xbb, 0xc7, 0x46, 0xbc, 0xa7, 0x33, 0x9d, 0x04, 0xab, 0x10, 0x85, 0xe8, 0x48, 0x84, 0xa7, 0x00, 0xc0, 0x3d, 0xe4, 0xb1 };
    try value.appendSlice(allocator, &chunk);
    try value.appendSlice(allocator, &chunk);
    try value.appendSlice(allocator, &chunk);

    var serialized: [96]u8 = undefined;
    const size = ByteList256.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 96), size);
    try std.testing.expectEqualSlices(u8, &chunk, serialized[0..32]);
    try std.testing.expectEqualSlices(u8, &chunk, serialized[32..64]);
    try std.testing.expectEqualSlices(u8, &chunk, serialized[64..96]);

    var root: [32]u8 = undefined;
    try ByteList256.hashTreeRoot(allocator, &value, &root);
    // 0x5d3ae4b886c241ffe8dc7ae1b5f0e2fb9b682e1eac2ddea292ef02cc179e6903
    const expected_root = [_]u8{ 0x5d, 0x3a, 0xe4, 0xb8, 0x86, 0xc2, 0x41, 0xff, 0xe8, 0xdc, 0x7a, 0xe1, 0xb5, 0xf0, 0xe2, 0xfb, 0x9b, 0x68, 0x2e, 0x1e, 0xac, 0x2d, 0xde, 0xa2, 0x92, 0xef, 0x02, 0xcc, 0x17, 0x9e, 0x69, 0x03 };
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const tree_node = try ByteList256.tree.fromValue(&pool, &value);
    var tree_serialized: [96]u8 = undefined;
    _ = try ByteList256.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "ByteListType - tree.deserializeFromBytes (32 bytes)" {
    const allocator = std.testing.allocator;
    const ByteList256 = ByteListType(256);

    // 0x0cb947377e177f774719ead8d210af9c6461f41baf5b4082f86a3911454831b8
    const serialized = [_]u8{ 0x0c, 0xb9, 0x47, 0x37, 0x7e, 0x17, 0x7f, 0x77, 0x47, 0x19, 0xea, 0xd8, 0xd2, 0x10, 0xaf, 0x9c, 0x64, 0x61, 0xf4, 0x1b, 0xaf, 0x5b, 0x40, 0x82, 0xf8, 0x6a, 0x39, 0x11, 0x45, 0x48, 0x31, 0xb8 };
    // 0x50425dbd7a34b50b20916e965ce5c060abe6516ac71bb00a4afebe5d5c4568b8
    const expected_root = [_]u8{ 0x50, 0x42, 0x5d, 0xbd, 0x7a, 0x34, 0xb5, 0x0b, 0x20, 0x91, 0x6e, 0x96, 0x5c, 0xe5, 0xc0, 0x60, 0xab, 0xe6, 0x51, 0x6a, 0xc7, 0x1b, 0xb0, 0x0a, 0x4a, 0xfe, 0xbe, 0x5d, 0x5c, 0x45, 0x68, 0xb8 };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();

    const tree_node = try ByteList256.tree.deserializeFromBytes(&pool, &serialized);

    const node_root = tree_node.getRoot(&pool);
    try std.testing.expectEqualSlices(u8, &expected_root, node_root);

    var value_from_tree: ByteList256.Type = ByteList256.default_value;
    defer value_from_tree.deinit(allocator);
    try ByteList256.tree.toValue(allocator, tree_node, &pool, &value_from_tree);

    var tree_serialized: [32]u8 = undefined;
    _ = try ByteList256.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);

    var hash_root: [32]u8 = undefined;
    try ByteList256.hashTreeRoot(allocator, &value_from_tree, &hash_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &hash_root);
}

test "ByteListType - tree.deserializeFromBytes (96 bytes)" {
    const allocator = std.testing.allocator;
    const ByteList256 = ByteListType(256);

    // 0xb55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1 repeated 3 times
    const chunk = [_]u8{ 0xb5, 0x5b, 0x85, 0x92, 0xbc, 0xac, 0x47, 0x59, 0x06, 0x63, 0x14, 0x81, 0xbb, 0xc7, 0x46, 0xbc, 0xa7, 0x33, 0x9d, 0x04, 0xab, 0x10, 0x85, 0xe8, 0x48, 0x84, 0xa7, 0x00, 0xc0, 0x3d, 0xe4, 0xb1 };
    const serialized = chunk ++ chunk ++ chunk;
    // 0x5d3ae4b886c241ffe8dc7ae1b5f0e2fb9b682e1eac2ddea292ef02cc179e6903
    const expected_root = [_]u8{ 0x5d, 0x3a, 0xe4, 0xb8, 0x86, 0xc2, 0x41, 0xff, 0xe8, 0xdc, 0x7a, 0xe1, 0xb5, 0xf0, 0xe2, 0xfb, 0x9b, 0x68, 0x2e, 0x1e, 0xac, 0x2d, 0xde, 0xa2, 0x92, 0xef, 0x02, 0xcc, 0x17, 0x9e, 0x69, 0x03 };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();

    const tree_node = try ByteList256.tree.deserializeFromBytes(&pool, &serialized);

    const node_root = tree_node.getRoot(&pool);
    try std.testing.expectEqualSlices(u8, &expected_root, node_root);

    var value_from_tree: ByteList256.Type = ByteList256.default_value;
    defer value_from_tree.deinit(allocator);
    try ByteList256.tree.toValue(allocator, tree_node, &pool, &value_from_tree);

    var tree_serialized: [96]u8 = undefined;
    _ = try ByteList256.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);

    var hash_root: [32]u8 = undefined;
    try ByteList256.hashTreeRoot(allocator, &value_from_tree, &hash_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &hash_root);
}

test "ByteListType" {
    const test_cases = [_]TypeTestCase{
        .{ .id = "empty", .serializedHex = "0x", .json =
        \\"0x"
        , .rootHex = "0xe8e527e84f666163a90ef900e013f56b0a4d020148b2224057b719f351b003a6" },
        .{ .id = "4 bytes zero", .serializedHex = "0x00000000", .json =
        \\"0x00000000"
        , .rootHex = "0xa39babe565305429771fc596a639d6e05b2d0304297986cdd2ef388c1936885e" },
        .{
            .id = "4 bytes some value",
            .serializedHex = "0x0cb94737",
            .json =
            \\"0x0cb94737"
            ,
            .rootHex = "0x2e14da116ecbec4c8d693656fb5b69bb0ea9e84ecdd15aba7be1c008633f2885",
        },
        .{
            .id = "32 bytes zero",
            .serializedHex = "0x0000000000000000000000000000000000000000000000000000000000000000",
            .json =
            \\"0x0000000000000000000000000000000000000000000000000000000000000000"
            ,
            .rootHex = "0xbae146b221eca758702e29b45ee7f7dc3eea17d119dd0a3094481e3f94706c96",
        },
        .{
            .id = "32 bytes some value",
            .serializedHex = "0x0cb947377e177f774719ead8d210af9c6461f41baf5b4082f86a3911454831b8",
            .json =
            \\"0x0cb947377e177f774719ead8d210af9c6461f41baf5b4082f86a3911454831b8"
            ,
            .rootHex = "0x50425dbd7a34b50b20916e965ce5c060abe6516ac71bb00a4afebe5d5c4568b8",
        },
        .{
            .id = "96 bytes zero",
            .serializedHex = "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
            .json =
            \\"0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
            ,
            .rootHex = "0xcd09661f4b2109fb26decd60c004444ea5308a304203412280bd2af3ace306bf",
        },
        .{
            .id = "96 bytes some value",
            .serializedHex = "0xb55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1b55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1b55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1",
            .json =
            \\"0xb55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1b55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1b55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1"
            ,
            .rootHex = "0x5d3ae4b886c241ffe8dc7ae1b5f0e2fb9b682e1eac2ddea292ef02cc179e6903",
        },
    };
    const allocator = std.testing.allocator;
    const List = ByteListType(256);

    const TypeTest = @import("test_utils.zig").typeTest(List);

    for (test_cases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "ByteListType - default_root" {
    const ByteList256 = ByteListType(256);
    var expected_root: [32]u8 = undefined;

    try ByteList256.hashTreeRoot(std.testing.allocator, &ByteList256.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &ByteList256.default_root);

    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1024 });
    defer pool.deinit();

    const node = try ByteList256.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &expected_root, node.getRoot(&pool));
}

test "ByteListType - tree.zeros" {
    const allocator = std.testing.allocator;

    const ByteList256 = ByteListType(256);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (0..ByteList256.limit) |len| {
        const tree_node = try ByteList256.tree.zeros(&pool, len);
        defer pool.unref(tree_node);

        var value = ByteList256.default_value;
        defer ByteList256.deinit(allocator, &value);
        try value.resize(allocator, len);
        @memset(value.items, 0);

        var expected_root: [32]u8 = undefined;
        try ByteList256.hashTreeRoot(allocator, &value, &expected_root);

        try std.testing.expectEqualSlices(u8, &expected_root, tree_node.getRoot(&pool));
    }
}

test "memory_safety: ByteListType tree reads allocate only fresh output" {
    const allocator = std.testing.allocator;
    const List = ByteListType(1025);
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    for ([_]usize{ 0, 1, 7, 8, 31, 32, 33, 255, 256, 257, List.limit }) |len| {
        var value = List.default_value;
        defer List.deinit(allocator, &value);
        try value.resize(allocator, len);
        for (value.items, 0..) |*byte, i| byte.* = @truncate(i);
        const node = try List.tree.fromValue(&pool, &value);
        defer pool.unref(node);
        const before = node.getRoot(&pool).*;
        const zero = try List.tree.zeros(&pool, len);
        defer pool.unref(zero);
        for ([_]Node.Id{ node, zero }, 0..) |input, input_index| {
            var failing = std.testing.FailingAllocator.init(allocator, .{
                .fail_index = @intFromBool(len != 0),
                .resize_fail_index = 0,
            });
            var out = List.default_value;
            defer List.deinit(failing.allocator(), &out);
            try List.tree.toValue(failing.allocator(), input, &pool, &out);
            if (input_index == 0) {
                try std.testing.expect(List.equals(&value, &out));
                try std.testing.expectEqualSlices(u8, &before, node.getRoot(&pool));
            } else {
                var root: [32]u8 = undefined;
                try List.hashTreeRoot(allocator, &out, &root);
                try std.testing.expectEqualSlices(u8, zero.getRoot(&pool), &root);
            }
            try std.testing.expect(!failing.has_induced_failure);
        }
    }
}
