//! Tests for `uint.zig`.

const std = @import("std");
const expectEqualRoots = @import("test_utils.zig").expectEqualRoots;
const expectEqualSerialized = @import("test_utils.zig").expectEqualSerialized;
const Node = @import("persistent_merkle_tree").Node;
const UintType = @import("uint.zig").UintType;

fn testFixed(
    allocator: std.mem.Allocator,
    comptime ST: type,
    value: ST.Type,
    expected_serialized: []const u8,
    expected_root: []const u8,
) !void {
    var serialized: [ST.fixed_size]u8 = undefined;
    const written = ST.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(ST.fixed_size, written);
    try std.testing.expectEqualSlices(u8, expected_serialized, &serialized);

    var root: [32]u8 = undefined;
    try ST.hashTreeRoot(&value, &root);
    try std.testing.expectEqualSlices(u8, expected_root, &root);

    var value_from_serialized: ST.Type = undefined;
    try ST.deserializeFromBytes(&serialized, &value_from_serialized);
    try std.testing.expectEqual(value, value_from_serialized);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const tree_from_value = try ST.tree.fromValue(&pool, &value);
    try std.testing.expectEqualSlices(u8, expected_root, tree_from_value.getRoot(&pool));

    var value_from_tree: ST.Type = undefined;
    try ST.tree.toValue(tree_from_value, &pool, &value_from_tree);
    try std.testing.expectEqual(value, value_from_tree);

    var tree_serialized: [ST.fixed_size]u8 = undefined;
    _ = try ST.tree.serializeIntoBytes(tree_from_value, &pool, &tree_serialized);
    try std.testing.expectEqualSlices(u8, expected_serialized, &tree_serialized);

    const tree_from_serialized = try ST.tree.deserializeFromBytes(&pool, expected_serialized);
    try std.testing.expectEqualSlices(u8, expected_root, tree_from_serialized.getRoot(&pool));

    try std.testing.expectError(error.InvalidSize, ST.tree.deserializeFromBytes(&pool, &[_]u8{}));
}

test "UintType - sanity" {
    const Uint8 = UintType(8);

    var u: Uint8.Type = undefined;
    var u_buf: [Uint8.fixed_size]u8 = undefined;
    _ = Uint8.serializeIntoBytes(&u, &u_buf);
    var u_decoded = Uint8.default_value;
    try Uint8.deserializeFromBytes(&u_buf, &u_decoded);

    // Deserialize "255" into u;
    const input_json = "\"255\"";
    const allocator = std.testing.allocator;
    var json = std.json.Scanner.initCompleteInput(allocator, input_json);
    defer json.deinit();
    try Uint8.deserializeFromJson(&json, &u);

    // Serialize u into "255"
    var aw: std.Io.Writer.Allocating = .init(allocator);
    defer aw.deinit();
    var write_stream: std.json.Stringify = .{ .writer = &aw.writer };
    try Uint8.serializeIntoJson(&write_stream, &u);
    var cloned: Uint8.Type = undefined;
    try Uint8.clone(&u, &cloned);
    try expectEqualRoots(Uint8, u, cloned);
    try expectEqualSerialized(Uint8, u, cloned);

    const output = try aw.toOwnedSlice();
    defer allocator.free(output);
    try std.testing.expectEqualSlices(u8, input_json, output);
}

// Refer to https://github.com/ChainSafe/ssz/blob/f5ed0b457333749b5c3f49fa5eafa096a725f033/packages/ssz/test/unit/byType/uint/valid.test.ts#L4-L135
test "UintType(8) - 0x00" {
    try testFixed(
        std.testing.allocator,
        UintType(8),
        0,
        &[_]u8{0x00},
        &[_]u8{0x00} ++ [_]u8{0x00} ** 31,
    );
}

test "UintType(8) - 0xff" {
    try testFixed(
        std.testing.allocator,
        UintType(8),
        255,
        &[_]u8{0xff},
        &[_]u8{0xff} ++ [_]u8{0x00} ** 31,
    );
}

test "UintType(16) - 2^8" {
    try testFixed(
        std.testing.allocator,
        UintType(16),
        256,
        &[_]u8{ 0x00, 0x01 },
        &[_]u8{ 0x00, 0x01 } ++ [_]u8{0x00} ** 30,
    );
}

test "UintType(16) - 0xffff" {
    try testFixed(
        std.testing.allocator,
        UintType(16),
        65535,
        &[_]u8{ 0xff, 0xff },
        &[_]u8{ 0xff, 0xff } ++ [_]u8{0x00} ** 30,
    );
}

test "UintType(32) - 0x00000000" {
    try testFixed(
        std.testing.allocator,
        UintType(32),
        0,
        &[_]u8{ 0x00, 0x00, 0x00, 0x00 },
        &[_]u8{ 0x00, 0x00, 0x00, 0x00 } ++ [_]u8{0x00} ** 28,
    );
}

test "UintType(32) - 0xffffffff" {
    try testFixed(
        std.testing.allocator,
        UintType(32),
        4294967295,
        &[_]u8{ 0xff, 0xff, 0xff, 0xff },
        &[_]u8{ 0xff, 0xff, 0xff, 0xff } ++ [_]u8{0x00} ** 28,
    );
}

test "UintType(64) - 100000" {
    try testFixed(
        std.testing.allocator,
        UintType(64),
        100000,
        &[_]u8{ 0xa0, 0x86, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00 },
        &[_]u8{ 0xa0, 0x86, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00 } ++ [_]u8{0x00} ** 24,
    );
}

test "UintType(64) - max" {
    try testFixed(
        std.testing.allocator,
        UintType(64),
        18446744073709551615,
        &[_]u8{ 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff },
        &[_]u8{ 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff } ++ [_]u8{0x00} ** 24,
    );
}

test "UintType(128) - 0x01" {
    try testFixed(
        std.testing.allocator,
        UintType(128),
        0x01,
        &[_]u8{0x01} ++ [_]u8{0x00} ** 15,
        &[_]u8{0x01} ++ [_]u8{0x00} ** 31,
    );
}

test "UintType(128) - max" {
    try testFixed(
        std.testing.allocator,
        UintType(128),
        0xffffffffffffffffffffffffffffffff,
        &[_]u8{0xff} ** 16,
        &[_]u8{0xff} ** 16 ++ [_]u8{0x00} ** 16,
    );
}

test "UintType(256) - 0xaabb" {
    try testFixed(
        std.testing.allocator,
        UintType(256),
        0xaabb,
        &[_]u8{ 0xbb, 0xaa } ++ [_]u8{0x00} ** 30,
        &[_]u8{ 0xbb, 0xaa } ++ [_]u8{0x00} ** 30,
    );
}

test "UintType(256) - max" {
    try testFixed(
        std.testing.allocator,
        UintType(256),
        0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff,
        &[_]u8{0xff} ** 32,
        &[_]u8{0xff} ** 32,
    );
}

test "UintType - default_root" {
    const Uint16 = UintType(16);
    var expected_root: [32]u8 = undefined;

    try Uint16.hashTreeRoot(&Uint16.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &Uint16.default_root);
}
