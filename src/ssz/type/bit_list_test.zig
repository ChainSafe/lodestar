//! Tests for `bit_list.zig`.

const std = @import("std");
const test_utils = @import("test_utils.zig");
const expectEqualRootsAlloc = test_utils.expectEqualRootsAlloc;
const expectEqualSerializedAlloc = test_utils.expectEqualSerializedAlloc;
const TypeTestCase = test_utils.TypeTestCase;
const Node = @import("persistent_merkle_tree").Node;
const BitListType = @import("bit_list.zig").BitListType;

test "BitListType - sanity" {
    const allocator = std.testing.allocator;
    const Bits = BitListType(40);
    var b: Bits.Type = try Bits.Type.fromBitLen(allocator, 30);
    defer b.deinit(allocator);

    b.setAssumeCapacity(2, true);

    const b_buf = try allocator.alloc(u8, Bits.serializedSize(&b));
    defer allocator.free(b_buf);

    _ = Bits.serializeIntoBytes(&b, b_buf);
    try Bits.deserializeFromBytes(allocator, b_buf, &b);

    try std.testing.expect(try b.get(0) == false);
}

test "clone" {
    const allocator = std.testing.allocator;

    const Bits = BitListType(40);
    var b: Bits.Type = try Bits.Type.fromBitLen(allocator, 30);
    defer b.deinit(allocator);

    var cloned = Bits.default_value;
    defer cloned.deinit(allocator);
    try Bits.clone(allocator, &b, &cloned);

    try std.testing.expect(&b != &cloned);
    try std.testing.expect(b.bit_len == cloned.bit_len);
    try std.testing.expect(std.mem.eql(u8, b.data.items, cloned.data.items));
    try expectEqualRootsAlloc(Bits, allocator, b, cloned);
    try expectEqualSerializedAlloc(Bits, allocator, b, cloned);
}

// Refer to https://github.com/ChainSafe/ssz/blob/f5ed0b457333749b5c3f49fa5eafa096a725f033/packages/ssz/test/unit/byType/bitList/valid.test.ts#L44-L69
test "BitListType serialized forms should enforce padding and limit" {
    const allocator = std.testing.allocator;

    const TestCase = struct {
        bools: []const bool,
        expected_hex: []const u8,
    };

    const test_cases = [_]TestCase{
        .{ .bools = &[_]bool{}, .expected_hex = &[_]u8{0b1} },
        .{ .bools = &[_]bool{true}, .expected_hex = &[_]u8{0b11} },
        .{ .bools = &[_]bool{false}, .expected_hex = &[_]u8{0b10} },
        .{ .bools = &[_]bool{ true, true, true }, .expected_hex = &[_]u8{0b1111} },
        .{ .bools = &[_]bool{ false, false, false }, .expected_hex = &[_]u8{0b1000} },
        .{ .bools = &[_]bool{ true, true, true, true, true, true, true, true }, .expected_hex = &[_]u8{ 0b11111111, 0b00000001 } },
        .{ .bools = &[_]bool{ false, false, false, false, false, false, false, false }, .expected_hex = &[_]u8{ 0b00000000, 0b00000001 } },
    };

    const Bits = BitListType(8);

    for (test_cases) |tc| {
        var b: Bits.Type = try Bits.Type.fromBoolSlice(allocator, tc.bools);
        defer b.deinit(allocator);

        const serialized = try allocator.alloc(u8, Bits.serializedSize(&b));
        defer allocator.free(serialized);
        _ = Bits.serializeIntoBytes(&b, serialized);
        try std.testing.expectEqualSlices(u8, tc.expected_hex, serialized);

        var deserialized: Bits.Type = Bits.default_value;
        defer deserialized.deinit(allocator);
        try Bits.deserializeFromBytes(allocator, serialized, &deserialized);

        var deserialized_bools = try allocator.alloc(bool, deserialized.bit_len);
        defer allocator.free(deserialized_bools);
        try deserialized.toBoolSlice(&deserialized_bools);
        try std.testing.expectEqualSlices(bool, tc.bools, deserialized_bools);
    }

    const over_limit = [_]u8{ 0x00, 0x02 };
    try std.testing.expectError(error.tooLarge, Bits.serialized.validate(&over_limit));
    try std.testing.expectError(error.tooLarge, Bits.serialized.length(&over_limit));

    var root: [32]u8 = undefined;
    try std.testing.expectError(
        error.tooLarge,
        Bits.serialized.hashTreeRoot(allocator, &over_limit, &root),
    );
}

// Refer to https://github.com/ChainSafe/ssz/blob/f5ed0b457333749b5c3f49fa5eafa096a725f033/packages/ssz/test/unit/byType/bitList/valid.test.ts#L5-L41
test "BitListType - tree roundtrip" {
    const allocator = std.testing.allocator;

    const Bits = BitListType(2048);

    const TestCase = struct {
        id: []const u8,
        serialized: []const u8,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty",
            .serialized = &[_]u8{0x01},
            .expected_root = [_]u8{ 0xe8, 0xe5, 0x27, 0xe8, 0x4f, 0x66, 0x61, 0x63, 0xa9, 0x0e, 0xf9, 0x00, 0xe0, 0x13, 0xf5, 0x6b, 0x0a, 0x4d, 0x02, 0x01, 0x48, 0xb2, 0x22, 0x40, 0x57, 0xb7, 0x19, 0xf3, 0x51, 0xb0, 0x03, 0xa6 },
        },
        .{
            .id = "zero'ed 1 byte",
            .serialized = &[_]u8{ 0x00, 0x10 },
            .expected_root = [_]u8{ 0x07, 0xeb, 0x64, 0x02, 0x82, 0xe1, 0x6e, 0xea, 0x87, 0x30, 0x0c, 0x37, 0x4c, 0x48, 0x94, 0xad, 0x69, 0xb9, 0x48, 0xde, 0x92, 0x4a, 0x15, 0x8d, 0x2d, 0x18, 0x43, 0xb3, 0xcf, 0x01, 0x89, 0x8a },
        },
        .{
            .id = "zero'ed 8 bytes",
            .serialized = &[_]u8{ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10 },
            .expected_root = [_]u8{ 0x5c, 0x59, 0x7e, 0x77, 0xf8, 0x79, 0xe2, 0x49, 0xaf, 0x95, 0xfe, 0x54, 0x3c, 0xf5, 0xf4, 0xdd, 0x16, 0xb6, 0x86, 0x94, 0x8d, 0xc7, 0x19, 0x70, 0x74, 0x45, 0xa3, 0x2a, 0x77, 0xff, 0x62, 0x66 },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (test_cases) |tc| {
        var value: Bits.Type = Bits.default_value;
        defer value.deinit(allocator);
        try Bits.deserializeFromBytes(allocator, tc.serialized, &value);

        const tree_node = try Bits.tree.fromValue(&pool, &value);

        var value_from_tree: Bits.Type = Bits.default_value;
        defer value_from_tree.deinit(allocator);
        try Bits.tree.toValue(allocator, tree_node, &pool, &value_from_tree);

        try std.testing.expect(Bits.equals(&value, &value_from_tree));

        const tree_size = try Bits.tree.serializedSize(tree_node, &pool);
        try std.testing.expectEqual(tc.serialized.len, tree_size);

        const tree_serialized = try allocator.alloc(u8, tree_size);
        defer allocator.free(tree_serialized);
        _ = try Bits.tree.serializeIntoBytes(tree_node, &pool, tree_serialized);
        try std.testing.expectEqualSlices(u8, tc.serialized, tree_serialized);

        var hash_root: [32]u8 = undefined;
        try Bits.hashTreeRoot(allocator, &value, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "BitListType - tree.deserializeFromBytes" {
    const allocator = std.testing.allocator;

    const Bits = BitListType(2048);

    const TestCase = struct {
        id: []const u8,
        serialized: []const u8,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty",
            .serialized = &[_]u8{0x01},
            .expected_root = [_]u8{ 0xe8, 0xe5, 0x27, 0xe8, 0x4f, 0x66, 0x61, 0x63, 0xa9, 0x0e, 0xf9, 0x00, 0xe0, 0x13, 0xf5, 0x6b, 0x0a, 0x4d, 0x02, 0x01, 0x48, 0xb2, 0x22, 0x40, 0x57, 0xb7, 0x19, 0xf3, 0x51, 0xb0, 0x03, 0xa6 },
        },
        .{
            .id = "zero'ed 1 byte",
            .serialized = &[_]u8{ 0x00, 0x10 },
            .expected_root = [_]u8{ 0x07, 0xeb, 0x64, 0x02, 0x82, 0xe1, 0x6e, 0xea, 0x87, 0x30, 0x0c, 0x37, 0x4c, 0x48, 0x94, 0xad, 0x69, 0xb9, 0x48, 0xde, 0x92, 0x4a, 0x15, 0x8d, 0x2d, 0x18, 0x43, 0xb3, 0xcf, 0x01, 0x89, 0x8a },
        },
        .{
            .id = "zero'ed 8 bytes",
            .serialized = &[_]u8{ 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10 },
            .expected_root = [_]u8{ 0x5c, 0x59, 0x7e, 0x77, 0xf8, 0x79, 0xe2, 0x49, 0xaf, 0x95, 0xfe, 0x54, 0x3c, 0xf5, 0xf4, 0xdd, 0x16, 0xb6, 0x86, 0x94, 0x8d, 0xc7, 0x19, 0x70, 0x74, 0x45, 0xa3, 0x2a, 0x77, 0xff, 0x62, 0x66 },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (test_cases) |tc| {
        const tree_node = try Bits.tree.deserializeFromBytes(&pool, tc.serialized);

        const node_root = tree_node.getRoot(&pool);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, node_root);

        var value_from_tree: Bits.Type = Bits.default_value;
        defer value_from_tree.deinit(allocator);
        try Bits.tree.toValue(allocator, tree_node, &pool, &value_from_tree);

        const tree_size = try Bits.tree.serializedSize(tree_node, &pool);
        try std.testing.expectEqual(tc.serialized.len, tree_size);
        const tree_serialized = try allocator.alloc(u8, tree_size);
        defer allocator.free(tree_serialized);
        _ = try Bits.tree.serializeIntoBytes(tree_node, &pool, tree_serialized);
        try std.testing.expectEqualSlices(u8, tc.serialized, tree_serialized);

        var hash_root: [32]u8 = undefined;
        try Bits.hashTreeRoot(allocator, &value_from_tree, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "BitListType" {
    const test_cases = [_]TypeTestCase{
        .{
            .id = "empty",
            .serializedHex = "0x01",
            .json =
            \\"0x01"
            ,
            .rootHex = "0xe8e527e84f666163a90ef900e013f56b0a4d020148b2224057b719f351b003a6",
        },
        .{
            .id = "zero'ed 1 bytes",
            .serializedHex = "0x0010",
            .json =
            \\"0x10"
            ,
            .rootHex = "0x07eb640282e16eea87300c374c4894ad69b948de924a158d2d1843b3cf01898a",
        },
        .{
            .id = "zero'ed 8 bytes",
            .serializedHex = "0x000000000000000010",
            .json =
            \\"0x000000000000000010"
            ,
            .rootHex = "0x5c597e77f879e249af95fe543cf5f4dd16b686948dc719707445a32a77ff6266",
        },
        .{
            .id = "short value",
            .serializedHex = "0xb55b8592bcac475906631481bbc746bc",
            .json =
            \\"0xb55b8592bcac475906631481bbc746bc"
            ,
            .rootHex = "0x9ab378cfbd6ec502da1f9640fd956bbef1f9fcbc10725397805c948865384e77",
        },
        .{
            .id = "long value",
            .serializedHex = "0xb55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1b55b8592bc",
            .json =
            \\"0xb55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1b55b8592bc"
            ,
            .rootHex = "0x4b71a7de822d00a5ff8e7e18e13712a50424cbc0e18108ab1796e591136396a0",
        },
    };

    const allocator = std.testing.allocator;
    const List = BitListType(2048);

    const TypeTest = @import("test_utils.zig").typeTest(List);

    for (test_cases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "BitListType equals" {
    const allocator = std.testing.allocator;
    const BL = BitListType(32);

    var a = try BL.Type.fromBitLen(allocator, 8);
    var b = try BL.Type.fromBitLen(allocator, 8);
    var c = try BL.Type.fromBitLen(allocator, 7);

    defer a.deinit(allocator);
    defer b.deinit(allocator);
    defer c.deinit(allocator);

    try a.set(allocator, 0, true);
    try a.set(allocator, 3, true);

    try b.set(allocator, 0, true);
    try b.set(allocator, 3, true);

    try c.set(allocator, 0, true);

    try std.testing.expect(BL.equals(&a, &b));
    try std.testing.expect(!BL.equals(&a, &c));
}

test "BitListType - default_root" {
    const Bits2048 = BitListType(2048);
    var expected_root: [32]u8 = undefined;

    try Bits2048.hashTreeRoot(std.testing.allocator, &Bits2048.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &Bits2048.default_root);

    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1024 });
    defer pool.deinit();

    const node = try Bits2048.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &expected_root, node.getRoot(&pool));
}

test "BitListType - tree.zeros" {
    const allocator = std.testing.allocator;

    const Bits257 = BitListType(257);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (Bits257.limit / 2..Bits257.limit) |len| {
        const tree_node = try Bits257.tree.zeros(&pool, len);
        defer pool.unref(tree_node);

        var value = Bits257.default_value;
        defer Bits257.deinit(allocator, &value);
        // Implicitly set all bits to 0
        try value.resize(allocator, len);

        var expected_root: [32]u8 = undefined;
        try Bits257.hashTreeRoot(allocator, &value, &expected_root);

        try std.testing.expectEqualSlices(u8, &expected_root, tree_node.getRoot(&pool));
    }
}

test "memory_safety: BitList JSON rejection frees scratch once" {
    const Bits = BitListType(8);
    const cases = .{
        .{ "\"0xzz\"", error.InvalidCharacter },
        .{ "\"0x00\"", error.noPaddingBit },
        .{ "\"0x8002\"", error.tooLarge },
        .{ "\"0x000001\"", error.invalidLength },
    };
    inline for (cases) |case| {
        var scanner = std.json.Scanner.initCompleteInput(std.testing.allocator, case[0]);
        defer scanner.deinit();
        var out = Bits.default_value;
        defer Bits.deinit(std.testing.allocator, &out);
        try std.testing.expectError(case[1], Bits.deserializeFromJson(std.testing.allocator, &scanner, &out));
    }
}

test "memory_safety: BitList JSON allocation failures release scratch" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(allocator: std.mem.Allocator) !void {
            const Bits = BitListType(8);
            var scanner = std.json.Scanner.initCompleteInput(std.testing.allocator, "\"0xff01\"");
            defer scanner.deinit();
            var out = Bits.default_value;
            defer Bits.deinit(allocator, &out);
            try Bits.deserializeFromJson(allocator, &scanner, &out);
            try std.testing.expectEqual(@as(usize, 8), out.bit_len);
            try std.testing.expectEqualSlices(u8, &.{0xff}, out.data.items);
        }
    }.run, .{});
}

test "BitList hashing streams chunk and batch boundaries without allocation" {
    const allocator = std.testing.allocator;
    const Bits = BitListType(65 * 256 + 7);
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    for ([_]usize{
        0,        1,            7,        8,            9,
        247,      248,          249,      255,          256,
        257,      511,          512,      513,          63 * 256 - 1,
        63 * 256, 64 * 256 - 1, 64 * 256, 64 * 256 + 1, 65 * 256 - 1,
        65 * 256, Bits.limit,
    }) |len| {
        var value = try Bits.Type.fromBitLen(allocator, len);
        defer value.deinit(allocator);
        for (0..len) |i| value.setAssumeCapacity(i, i % 3 == 0);
        const node = try Bits.tree.fromValue(&pool, &value);
        defer pool.unref(node);
        const bytes = try allocator.alloc(u8, Bits.serializedSize(&value));
        defer allocator.free(bytes);
        _ = Bits.serializeIntoBytes(&value, bytes);
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
        var root: [32]u8 = undefined;
        try Bits.hashTreeRoot(failing.allocator(), &value, &root);
        try std.testing.expectEqualSlices(u8, node.getRoot(&pool), &root);
        try Bits.serialized.hashTreeRoot(failing.allocator(), bytes, &root);
        try std.testing.expectEqualSlices(u8, node.getRoot(&pool), &root);
    }
    var root: [32]u8 = undefined;
    var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    try std.testing.expectError(error.InvalidSize, Bits.serialized.hashTreeRoot(failing.allocator(), &.{}, &root));
    try std.testing.expectError(error.noPaddingBit, Bits.serialized.hashTreeRoot(failing.allocator(), &.{0}, &root));
    const Small = BitListType(1);
    try std.testing.expectError(error.tooLarge, Small.serialized.hashTreeRoot(failing.allocator(), &.{4}, &root));
}

test "memory_safety: BitListType tree reads need only output capacity" {
    const allocator = std.testing.allocator;
    const List = BitListType(1025);
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    for ([_]usize{ 0, 1, 7, 8, 31, 32, 33, 255, 256, 257, List.limit }) |len| {
        var value = List.default_value;
        defer List.deinit(allocator, &value);
        try value.resize(allocator, len);
        for (0..len) |i| value.setAssumeCapacity(i, i % 3 == 0);
        const node = try List.tree.fromValue(&pool, &value);
        defer pool.unref(node);
        const before = node.getRoot(&pool).*;
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var out = List.default_value;
        defer List.deinit(failing.allocator(), &out);
        try out.resize(failing.allocator(), List.limit);
        failing.fail_index = failing.alloc_index;
        failing.resize_fail_index = failing.resize_index;
        try List.tree.toValue(failing.allocator(), node, &pool, &out);
        try std.testing.expect(List.equals(&value, &out));
        try std.testing.expectEqualSlices(u8, &before, node.getRoot(&pool));
        const zero = try List.tree.zeros(&pool, len);
        defer pool.unref(zero);
        try List.tree.toValue(failing.allocator(), zero, &pool, &out);
        var root: [32]u8 = undefined;
        try List.hashTreeRoot(allocator, &out, &root);
        try std.testing.expectEqualSlices(u8, zero.getRoot(&pool), &root);
    }
}
