//! Tests for `bool.zig`.

const std = @import("std");
const expectEqualSerialized = @import("test_utils.zig").expectEqualSerialized;
const expectEqualRoots = @import("test_utils.zig").expectEqualRoots;
const Node = @import("persistent_merkle_tree").Node;
const BoolType = @import("bool.zig").BoolType;

test "BoolType - sanity" {
    const Bool = BoolType();

    var b: Bool.Type = undefined;

    const input_json = "true";
    const allocator = std.testing.allocator;

    // Deserialize
    var json = std.json.Scanner.initCompleteInput(allocator, input_json);
    defer json.deinit();
    try Bool.deserializeFromJson(&json, &b);

    // Serialize
    var aw: std.Io.Writer.Allocating = .init(allocator);
    defer aw.deinit();
    var write_stream: std.json.Stringify = .{ .writer = &aw.writer };
    try Bool.serializeIntoJson(&write_stream, &b);

    var cloned: Bool.Type = undefined;
    try Bool.clone(&b, &cloned);

    try expectEqualRoots(Bool, b, cloned);
    const output = try aw.toOwnedSlice();
    defer allocator.free(output);
    try std.testing.expectEqualSlices(u8, input_json, output);
    try expectEqualSerialized(Bool, b, cloned);
}

// Refer to https://github.com/ChainSafe/ssz/blob/f5ed0b457333749b5c3f49fa5eafa096a725f033/packages/ssz/test/unit/byType/boolean/valid.test.ts#L4-L21
test "BoolType - serializeIntoBytes (false)" {
    const Bool = BoolType();
    const value: Bool.Type = false;

    var serialized: [1]u8 = undefined;
    const size = Bool.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 1), size);
    try std.testing.expectEqualSlices(u8, &[_]u8{0x00}, &serialized);

    var root: [32]u8 = undefined;
    try Bool.hashTreeRoot(&value, &root);
    const expected_root = [_]u8{0x00} ++ [_]u8{0x00} ** 31;
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 32 });
    defer pool.deinit();
    const tree_node = try Bool.tree.fromValue(&pool, &value);
    var tree_serialized: [1]u8 = undefined;
    _ = try Bool.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "BoolType - serializeIntoBytes (true)" {
    const Bool = BoolType();
    const value: Bool.Type = true;

    var serialized: [1]u8 = undefined;
    const size = Bool.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 1), size);
    try std.testing.expectEqualSlices(u8, &[_]u8{0x01}, &serialized);

    var root: [32]u8 = undefined;
    try Bool.hashTreeRoot(&value, &root);
    const expected_root = [_]u8{0x01} ++ [_]u8{0x00} ** 31;
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 32 });
    defer pool.deinit();
    const tree_node = try Bool.tree.fromValue(&pool, &value);
    var tree_serialized: [1]u8 = undefined;
    _ = try Bool.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, &serialized, &tree_serialized);
}

test "BoolType - tree.deserializeFromBytes" {
    const allocator = std.testing.allocator;
    const Bool = BoolType();

    const TestCase = struct {
        id: []const u8,
        serialized: [1]u8,
        expected_value: bool,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{ .id = "false", .serialized = [_]u8{0x00}, .expected_value = false, .expected_root = [_]u8{0x00} ++ [_]u8{0x00} ** 31 },
        .{ .id = "true", .serialized = [_]u8{0x01}, .expected_value = true, .expected_root = [_]u8{0x01} ++ [_]u8{0x00} ** 31 },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 32 });
    defer pool.deinit();

    for (test_cases) |tc| {
        const tree_node = try Bool.tree.deserializeFromBytes(&pool, &tc.serialized);

        const node_root = tree_node.getRoot(&pool);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, node_root);

        var value_from_tree: Bool.Type = undefined;
        try Bool.tree.toValue(tree_node, &pool, &value_from_tree);
        try std.testing.expectEqual(tc.expected_value, value_from_tree);

        var tree_serialized: [1]u8 = undefined;
        _ = try Bool.tree.serializeIntoBytes(tree_node, &pool, &tree_serialized);
        try std.testing.expectEqualSlices(u8, &tc.serialized, &tree_serialized);

        var hash_root: [32]u8 = undefined;
        try Bool.hashTreeRoot(&value_from_tree, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }

    try std.testing.expectError(error.invalidBoolean, Bool.tree.deserializeFromBytes(&pool, &[_]u8{0x02}));
    try std.testing.expectError(error.InvalidSize, Bool.tree.deserializeFromBytes(&pool, &[_]u8{}));
}

test "BoolType - default_root" {
    const Bool = BoolType();
    var expected_root: [32]u8 = undefined;

    try Bool.hashTreeRoot(&Bool.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &Bool.default_root);
}
