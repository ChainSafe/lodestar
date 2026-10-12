//! Tests for `list.zig`.

const std = @import("std");
const DoubleFreeDetectAllocator = @import("testing_allocators").DoubleFreeDetectAllocator;
const ByteListType = @import("byte_list.zig").ByteListType;
const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const BoolType = @import("bool.zig").BoolType;
const UintType = @import("uint.zig").UintType;
const ByteVectorType = @import("byte_vector.zig").ByteVectorType;
const FixedContainerType = @import("container.zig").FixedContainerType;
const VariableContainerType = @import("container.zig").VariableContainerType;
const TypeTestCase = @import("test_utils.zig").TypeTestCase;
const FixedListType = @import("list.zig").FixedListType;
const VariableListType = @import("list.zig").VariableListType;

const PoolExhaustionCheckpoint = FixedContainerType(struct {
    epoch: UintType(64),
    root: ByteVectorType(32),
});

test "FixedListType - canonical boolean tree deserialization" {
    const allocator = std.testing.allocator;
    const byte_count = @as(usize, pmt.ChunkedLeaf.K) * 32 + 1;

    inline for (.{ false, true }) |chunked_leaf| {
        const List = FixedListType(BoolType(), byte_count, .{ .chunked_leaf = chunked_leaf });
        var pool = try Node.Pool.init(.{
            .page_allocator = allocator,
            .allocator = allocator,
            .pool_size = 1024,
        });
        defer pool.deinit();

        var data: [byte_count]u8 = undefined;
        for (&data, 0..) |*byte, i| byte.* = @intCast(i % 2);

        const node = try List.tree.deserializeFromBytes(&pool, &data);
        defer pool.unref(node);
        const root = node.getRoot(&pool).*;

        var value = List.default_value;
        defer List.deinit(allocator, &value);
        try List.tree.toValue(allocator, node, &pool, &value);
        try std.testing.expectEqual(byte_count, value.items.len);
        for (value.items, 0..) |item, i| try std.testing.expectEqual(i % 2 == 1, item);

        var serialized: [byte_count]u8 = undefined;
        const written = try List.tree.serializeIntoBytes(node, &pool, &serialized);
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
                    List.tree.deserializeFromBytes(&pool, &data),
                );
                try std.testing.expectEqual(nodes_in_use, pool.getNodesInUse());
                try std.testing.expectEqual(next_free_node, pool.next_free_node);
                try std.testing.expectEqualSlices(u8, &root, node.getRoot(&pool));
            }
        }
    }
}

const testCases = [_]TypeTestCase{
    .{ .id = "empty", .serializedHex = "0x", .json = "[]", .rootHex = "0x52e2647abc3d0c9d3be0387f3f0d925422c7a4e98cf4489066f0f43281a899f3" },
    .{ .id = "4 values", .serializedHex = "0xa086010000000000400d030000000000e093040000000000801a060000000000a086010000000000400d030000000000e093040000000000801a060000000000", .json =
    \\["100000","200000","300000","400000","100000","200000","300000","400000"]
    , .rootHex = "0xb55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1" },
    .{
        .id = "8 values",
        .serializedHex = "0xa086010000000000400d030000000000e093040000000000801a060000000000a086010000000000400d030000000000e093040000000000801a060000000000",
        .json =
        \\["100000","200000","300000","400000","100000","200000","300000","400000"]
        ,
        .rootHex = "0xb55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1",
    },
};

test "memory_safety: list hashing bounds scratch independently of list length" {
    const allocator = std.testing.allocator;
    inline for (.{ UintType(64), BoolType(), PoolExhaustionCheckpoint }) |Element| {
        const List = FixedListType(Element, 4096, .{});
        for ([_]usize{ 0, 1, 3, 63, 64, 65, 127, 128, 129, 513 }) |len| {
            var value = List.default_value;
            defer List.deinit(allocator, &value);
            try value.resize(allocator, len);
            for (value.items, 0..) |*item, i| {
                item.* = switch (Element.kind) {
                    .uint => @intCast(i + 1),
                    .bool => i % 2 == 0,
                    .container => .{ .epoch = @intCast(i + 1), .root = @splat(@intCast(i % 256)) },
                    else => unreachable,
                };
            }
            var pool = try Node.Pool.init(.{
                .page_allocator = allocator,
                .allocator = allocator,
                .pool_size = 4096,
            });
            defer pool.deinit();
            const node = try List.tree.fromValue(&pool, &value);
            defer pool.unref(node);
            const expected = node.getRoot(&pool).*;
            const bytes = try allocator.alloc(u8, List.serializedSize(&value));
            defer allocator.free(bytes);
            _ = List.serializeIntoBytes(&value, bytes);

            var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
            var actual: [32]u8 = undefined;
            try List.hashTreeRoot(failing.allocator(), &value, &actual);
            try std.testing.expectEqualSlices(u8, &expected, &actual);
            try List.serialized.hashTreeRoot(failing.allocator(), bytes, &actual);
            try std.testing.expectEqualSlices(u8, &expected, &actual);
            try std.testing.expect(!failing.has_induced_failure);
        }
    }
}

test "memory_safety: nested list hashing streams variable element roots" {
    const allocator = std.testing.allocator;
    const Element = FixedListType(UintType(64), 8, .{});
    const List = VariableListType(Element, 256);
    var value = List.default_value;
    defer List.deinit(allocator, &value);
    try value.appendNTimes(allocator, Element.default_value, 129);
    for (value.items, 0..) |*item, i| {
        try item.appendNTimes(allocator, @as(u64, @intCast(i + 1)), i % 9);
    }
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 2048,
    });
    defer pool.deinit();
    const node = try List.tree.fromValue(&pool, &value);
    defer pool.unref(node);
    const expected = node.getRoot(&pool).*;
    const bytes = try allocator.alloc(u8, List.serializedSize(&value));
    defer allocator.free(bytes);
    _ = List.serializeIntoBytes(&value, bytes);

    var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    var actual: [32]u8 = undefined;
    try List.hashTreeRoot(failing.allocator(), &value, &actual);
    try std.testing.expectEqualSlices(u8, &expected, &actual);
    try List.serialized.hashTreeRoot(failing.allocator(), bytes, &actual);
    try std.testing.expectEqualSlices(u8, &expected, &actual);
    std.mem.writeInt(u32, bytes[4..8], 0, .little);
    try std.testing.expectError(error.offsetNotIncreasing, List.serialized.hashTreeRoot(failing.allocator(), bytes, &actual));
    try std.testing.expect(!failing.has_induced_failure);
}

test "list hashing rejects values beyond the declared limit before allocating" {
    inline for (.{ FixedListType(UintType(64), 2, .{}), VariableListType(ByteListType(8), 2) }) |List| {
        var items: [3]List.Element.Type = @splat(List.Element.default_value);
        const value: List.Type = .{ .items = &items, .capacity = items.len };
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
        var out: [32]u8 = undefined;
        try std.testing.expectError(error.gtLimit, List.hashTreeRoot(failing.allocator(), &value, &out));
        try std.testing.expect(!failing.has_induced_failure);
    }
}

test "ListType - sanity" {
    const allocator = std.testing.allocator;

    // create a fixed list type and instance and round-trip serialize
    const Bytes = FixedListType(UintType(8), 32, .{});

    var b: Bytes.Type = Bytes.default_value;
    defer b.deinit(allocator);
    try b.append(allocator, 5);

    const b_buf = try allocator.alloc(u8, Bytes.serializedSize(&b));
    defer allocator.free(b_buf);

    _ = Bytes.serializeIntoBytes(&b, b_buf);
    try Bytes.deserializeFromBytes(allocator, b_buf, &b);

    // create a variable list type and instance and round-trip serialize
    const BytesBytes = VariableListType(Bytes, 32);
    var bb: BytesBytes.Type = BytesBytes.default_value;
    defer bb.deinit(allocator);
    const b2: Bytes.Type = Bytes.default_value;
    try bb.append(allocator, b2);

    const bb_buf = try allocator.alloc(u8, BytesBytes.serializedSize(&bb));
    defer allocator.free(bb_buf);

    _ = BytesBytes.serializeIntoBytes(&bb, bb_buf);
    try BytesBytes.deserializeFromBytes(allocator, bb_buf, &bb);
}

test "memory_safety: fixed list tree reads reuse output capacity without traversal allocations" {
    const allocator = std.testing.allocator;
    inline for (.{ UintType(64), BoolType(), PoolExhaustionCheckpoint }) |Element| {
        inline for (.{ false, true }) |chunked| {
            if (!chunked or Element.kind != .container) {
                const List = FixedListType(Element, pmt.ChunkedLeaf.K * 64, .{ .chunked_leaf = chunked });
                var failing = std.testing.FailingAllocator.init(allocator, .{});
                var pool = try Node.Pool.init(.{
                    .page_allocator = allocator,
                    .allocator = failing.allocator(),
                    .pool_size = 16384,
                });
                defer pool.deinit();

                inline for (.{ 0, 1, 31, 32, 33, pmt.ChunkedLeaf.K * 32 + 1 }) |len| {
                    var value = List.default_value;
                    defer List.deinit(allocator, &value);
                    try value.resize(allocator, len);
                    for (value.items, 0..) |*item, i| {
                        item.* = switch (Element.kind) {
                            .uint => @intCast(i + 1),
                            .bool => i % 2 == 0,
                            .container => .{ .epoch = @intCast(i + 1), .root = @splat(@intCast(i % 256)) },
                            else => unreachable,
                        };
                    }
                    const node = try List.tree.fromValue(&pool, &value);
                    defer pool.unref(node);
                    const before = node.getRoot(&pool).*;
                    const zero = try List.tree.zeros(&pool, len);
                    defer pool.unref(zero);

                    var out = List.default_value;
                    defer List.deinit(failing.allocator(), &out);
                    try out.ensureTotalCapacity(failing.allocator(), len);
                    failing.fail_index = failing.alloc_index;
                    failing.resize_fail_index = failing.resize_index;
                    defer {
                        failing.fail_index = std.math.maxInt(usize);
                        failing.resize_fail_index = std.math.maxInt(usize);
                    }

                    try List.tree.toValue(failing.allocator(), node, &pool, &out);
                    try std.testing.expect(List.equals(&value, &out));
                    try std.testing.expectEqualSlices(u8, &before, node.getRoot(&pool));
                    try List.tree.toValue(failing.allocator(), zero, &pool, &out);
                    for (out.items) |item| {
                        try std.testing.expect(Element.equals(&Element.default_value, &item));
                    }
                    try std.testing.expect(!failing.has_induced_failure);
                }
            }
        }
    }
}

test "memory_safety: variable list tree reads allocate only materialized values" {
    const allocator = std.testing.allocator;
    const Element = ByteListType(8);
    const List = VariableListType(Element, 8);
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 64,
    });
    defer pool.deinit();
    var value = List.default_value;
    defer List.deinit(allocator, &value);
    try value.appendNTimes(allocator, Element.default_value, 3);
    const node = try List.tree.fromValue(&pool, &value);
    defer pool.unref(node);

    var failing = std.testing.FailingAllocator.init(allocator, .{});
    var out = List.default_value;
    defer List.deinit(failing.allocator(), &out);
    try out.ensureTotalCapacity(failing.allocator(), value.items.len);
    failing.fail_index = failing.alloc_index;
    failing.resize_fail_index = failing.resize_index;

    try List.tree.toValue(failing.allocator(), node, &pool, &out);
    try std.testing.expect(List.equals(&value, &out));
    try std.testing.expect(!failing.has_induced_failure);
}

test "memory_safety: variable list tree reads leave partial values deinit-safe" {
    const allocator = std.testing.allocator;
    const Element = ByteListType(8);
    const List = VariableListType(Element, 8);
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 64,
    });
    defer pool.deinit();
    var value = List.default_value;
    defer List.deinit(allocator, &value);
    try value.appendNTimes(allocator, Element.default_value, 3);
    for (value.items, 0..) |*item, i| try item.append(allocator, @intCast(i + 1));
    const node = try List.tree.fromValue(&pool, &value);
    defer pool.unref(node);
    const before = node.getRoot(&pool).*;

    try std.testing.checkAllAllocationFailures(allocator, struct {
        fn run(failing: std.mem.Allocator, source: Node.Id, source_pool: *Node.Pool, expected: *const List.Type) !void {
            var out = List.default_value;
            defer List.deinit(failing, &out);
            try List.tree.toValue(failing, source, source_pool, &out);
            try std.testing.expect(List.equals(expected, &out));
        }
    }.run, .{ node, &pool, &value });
    try std.testing.expectEqualSlices(u8, &before, node.getRoot(&pool));
}

test "clone FixedListType" {
    const allocator = std.testing.allocator;
    const Checkpoint = FixedContainerType(struct {
        epoch: UintType(8),
        root: ByteVectorType(32),
    });
    const CheckpointList = FixedListType(Checkpoint, 8, .{});
    var list: CheckpointList.Type = CheckpointList.default_value;
    defer CheckpointList.deinit(allocator, &list);
    const cp: Checkpoint.Type = .{
        .epoch = 41,
        .root = [_]u8{1} ** 32,
    };
    try list.append(allocator, cp);
    var cloned: CheckpointList.Type = CheckpointList.default_value;
    defer cloned.deinit(allocator);
    try CheckpointList.clone(allocator, &list, &cloned);
    try std.testing.expect(&list != &cloned);
    try std.testing.expect(CheckpointList.equals(&list, &cloned));

    // clone to a list of a different type
    const CheckpointHex = FixedContainerType(struct {
        epoch: UintType(8),
        root: ByteVectorType(32),
        root_hex: ByteVectorType(64),
    });
    const CheckpointHexList = FixedListType(CheckpointHex, 8, .{});
    var list_hex: CheckpointHexList.Type = CheckpointHexList.default_value;
    defer list_hex.deinit(allocator);
    try CheckpointList.cloneInto(CheckpointHexList, allocator, &list, &list_hex);
    try std.testing.expect(list_hex.items.len == 1);
    try std.testing.expect(list_hex.items[0].epoch == cp.epoch);
    try std.testing.expectEqualSlices(u8, &list_hex.items[0].root, &cp.root);
}

test "clone VariableListType" {
    const allocator = std.testing.allocator;
    const FieldA = FixedListType(UintType(8), 32, .{});
    const Foo = VariableContainerType(struct {
        a: FieldA,
    });
    const ListFoo = VariableListType(Foo, 8);
    var list = ListFoo.default_value;
    defer ListFoo.deinit(allocator, &list);
    var fielda = FieldA.default_value;
    try fielda.append(allocator, 100);
    try list.append(allocator, .{ .a = fielda });

    var cloned: ListFoo.Type = ListFoo.default_value;
    defer ListFoo.deinit(allocator, &cloned);
    try ListFoo.clone(allocator, &list, &cloned);
    try std.testing.expect(&list != &cloned);
    try std.testing.expect(cloned.items.len == 1);
    try std.testing.expect(ListFoo.equals(&list, &cloned));

    // clone to a list of a different type
    const Bar = VariableContainerType(struct {
        a: FieldA,
        b: UintType(8),
    });
    const ListBar = VariableListType(Bar, 8);
    var list_bar: ListBar.Type = ListBar.default_value;
    defer ListBar.deinit(allocator, &list_bar);
    try ListFoo.cloneInto(ListBar, allocator, &list, &list_bar);
    try std.testing.expect(list_bar.items.len == 1);
    try std.testing.expect(FieldA.equals(&list_bar.items[0].a, &fielda));
}

// Tests ported from TypeScript ssz packages/ssz/test/unit/byType/listBasic/valid.test.ts
test "FixedListType - tree roundtrip (ListBasic uint8)" {
    const allocator = std.testing.allocator;

    const ListU8 = FixedListType(UintType(8), 128, .{});

    const TestCase = struct {
        id: []const u8,
        values: []const u8,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty",
            .values = &[_]u8{},
            // 0x28ba1834a3a7b657460ce79fa3a1d909ab8828fd557659d4d0554a9bdbc0ec30
            .expected_root = [_]u8{ 0x28, 0xba, 0x18, 0x34, 0xa3, 0xa7, 0xb6, 0x57, 0x46, 0x0c, 0xe7, 0x9f, 0xa3, 0xa1, 0xd9, 0x09, 0xab, 0x88, 0x28, 0xfd, 0x55, 0x76, 0x59, 0xd4, 0xd0, 0x55, 0x4a, 0x9b, 0xdb, 0xc0, 0xec, 0x30 },
        },
        .{
            .id = "4 values",
            .values = &[_]u8{ 1, 2, 3, 4 },
            // 0xbac511d1f641d6b8823200bb4b3cced3bd4720701f18571dff35a5d2a40190fa
            .expected_root = [_]u8{ 0xba, 0xc5, 0x11, 0xd1, 0xf6, 0x41, 0xd6, 0xb8, 0x82, 0x32, 0x00, 0xbb, 0x4b, 0x3c, 0xce, 0xd3, 0xbd, 0x47, 0x20, 0x70, 0x1f, 0x18, 0x57, 0x1d, 0xff, 0x35, 0xa5, 0xd2, 0xa4, 0x01, 0x90, 0xfa },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (test_cases) |tc| {
        var value: ListU8.Type = ListU8.default_value;
        defer value.deinit(allocator);
        for (tc.values) |v| {
            try value.append(allocator, v);
        }

        const serialized = try allocator.alloc(u8, ListU8.serializedSize(&value));
        defer allocator.free(serialized);
        _ = ListU8.serializeIntoBytes(&value, serialized);

        const tree_node = try ListU8.tree.fromValue(&pool, &value);

        var value_from_tree: ListU8.Type = ListU8.default_value;
        defer value_from_tree.deinit(allocator);
        try ListU8.tree.toValue(allocator, tree_node, &pool, &value_from_tree);

        try std.testing.expectEqual(value.items.len, value_from_tree.items.len);
        try std.testing.expectEqualSlices(u8, value.items, value_from_tree.items);

        const tree_size = try ListU8.tree.serializedSize(tree_node, &pool);
        try std.testing.expectEqual(serialized.len, tree_size);

        const tree_serialized = try allocator.alloc(u8, tree_size);
        defer allocator.free(tree_serialized);
        _ = try ListU8.tree.serializeIntoBytes(tree_node, &pool, tree_serialized);
        try std.testing.expectEqualSlices(u8, serialized, tree_serialized);

        var hash_root: [32]u8 = undefined;
        try ListU8.hashTreeRoot(allocator, &value, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "FixedListType - tree roundtrip (ListBasic uint64)" {
    const allocator = std.testing.allocator;

    const ListU64 = FixedListType(UintType(64), 128, .{});

    const TestCase = struct {
        id: []const u8,
        values: []const u64,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty",
            .values = &[_]u64{},
            // 0x52e2647abc3d0c9d3be0387f3f0d925422c7a4e98cf4489066f0f43281a899f3
            .expected_root = [_]u8{ 0x52, 0xe2, 0x64, 0x7a, 0xbc, 0x3d, 0x0c, 0x9d, 0x3b, 0xe0, 0x38, 0x7f, 0x3f, 0x0d, 0x92, 0x54, 0x22, 0xc7, 0xa4, 0xe9, 0x8c, 0xf4, 0x48, 0x90, 0x66, 0xf0, 0xf4, 0x32, 0x81, 0xa8, 0x99, 0xf3 },
        },
        .{
            .id = "4 values",
            .values = &[_]u64{ 100000, 200000, 300000, 400000 },
            // 0xd1daef215502b7746e5ff3e8833e399cb249ab3f81d824be60e174ff5633c1bf
            .expected_root = [_]u8{ 0xd1, 0xda, 0xef, 0x21, 0x55, 0x02, 0xb7, 0x74, 0x6e, 0x5f, 0xf3, 0xe8, 0x83, 0x3e, 0x39, 0x9c, 0xb2, 0x49, 0xab, 0x3f, 0x81, 0xd8, 0x24, 0xbe, 0x60, 0xe1, 0x74, 0xff, 0x56, 0x33, 0xc1, 0xbf },
        },
        .{
            .id = "8 values",
            .values = &[_]u64{ 100000, 200000, 300000, 400000, 100000, 200000, 300000, 400000 },
            // 0xb55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1
            .expected_root = [_]u8{ 0xb5, 0x5b, 0x85, 0x92, 0xbc, 0xac, 0x47, 0x59, 0x06, 0x63, 0x14, 0x81, 0xbb, 0xc7, 0x46, 0xbc, 0xa7, 0x33, 0x9d, 0x04, 0xab, 0x10, 0x85, 0xe8, 0x48, 0x84, 0xa7, 0x00, 0xc0, 0x3d, 0xe4, 0xb1 },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (test_cases) |tc| {
        var value: ListU64.Type = ListU64.default_value;
        defer value.deinit(allocator);
        for (tc.values) |v| {
            try value.append(allocator, v);
        }

        const serialized = try allocator.alloc(u8, ListU64.serializedSize(&value));
        defer allocator.free(serialized);
        _ = ListU64.serializeIntoBytes(&value, serialized);

        const tree_node = try ListU64.tree.fromValue(&pool, &value);

        var value_from_tree: ListU64.Type = ListU64.default_value;
        defer value_from_tree.deinit(allocator);
        try ListU64.tree.toValue(allocator, tree_node, &pool, &value_from_tree);

        try std.testing.expectEqual(value.items.len, value_from_tree.items.len);
        try std.testing.expectEqualSlices(u64, value.items, value_from_tree.items);

        const tree_size = try ListU64.tree.serializedSize(tree_node, &pool);
        const tree_serialized = try allocator.alloc(u8, tree_size);
        defer allocator.free(tree_serialized);
        _ = try ListU64.tree.serializeIntoBytes(tree_node, &pool, tree_serialized);
        try std.testing.expectEqualSlices(u8, serialized, tree_serialized);

        var hash_root: [32]u8 = undefined;
        try ListU64.hashTreeRoot(allocator, &value, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "FixedListType - serializeIntoBytes (ListComposite ByteVector32 - empty)" {
    const allocator = std.testing.allocator;
    const ByteVector32 = ByteVectorType(32);
    const ListBV32 = FixedListType(ByteVector32, 128, .{});

    var value: ListBV32.Type = ListBV32.default_value;

    const expected_serialized = [_]u8{};
    const expected_root = [_]u8{ 0x96, 0x55, 0x96, 0x74, 0xa7, 0x96, 0x56, 0xe5, 0x40, 0x87, 0x1e, 0x1f, 0x39, 0xc9, 0xb9, 0x1e, 0x15, 0x2a, 0xa8, 0xcd, 0xdb, 0x71, 0x49, 0x3e, 0x75, 0x48, 0x27, 0xc4, 0xcc, 0x80, 0x9d, 0x57 };

    const size = ListBV32.serializedSize(&value);
    try std.testing.expectEqual(@as(usize, 0), size);
    const serialized = try allocator.alloc(u8, size);
    defer allocator.free(serialized);
    const written = ListBV32.serializeIntoBytes(&value, serialized);
    try std.testing.expectEqual(@as(usize, 0), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, serialized);

    var root: [32]u8 = undefined;
    try ListBV32.hashTreeRoot(allocator, &value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const node = try ListBV32.tree.fromValue(&pool, &value);
    const tree_size = try ListBV32.tree.serializedSize(node, &pool);
    try std.testing.expectEqual(@as(usize, 0), tree_size);
    const tree_serialized = try allocator.alloc(u8, tree_size);
    defer allocator.free(tree_serialized);
    _ = try ListBV32.tree.serializeIntoBytes(node, &pool, tree_serialized);
    try std.testing.expectEqualSlices(u8, &expected_serialized, tree_serialized);
}

test "FixedListType - serializeIntoBytes (ListComposite ByteVector32 - 2 roots)" {
    const allocator = std.testing.allocator;
    const ByteVector32 = ByteVectorType(32);
    const ListBV32 = FixedListType(ByteVector32, 128, .{});

    var value: ListBV32.Type = ListBV32.default_value;
    defer value.deinit(allocator);
    // [0xdddd...dd, 0xeeee...ee]
    try value.append(allocator, [_]u8{0xdd} ** 32);
    try value.append(allocator, [_]u8{0xee} ** 32);

    // 0xddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
    const expected_serialized = [_]u8{0xdd} ** 32 ++ [_]u8{0xee} ** 32;
    const expected_root = [_]u8{ 0x0c, 0xb9, 0x47, 0x37, 0x7e, 0x17, 0x7f, 0x77, 0x47, 0x19, 0xea, 0xd8, 0xd2, 0x10, 0xaf, 0x9c, 0x64, 0x61, 0xf4, 0x1b, 0xaf, 0x5b, 0x40, 0x82, 0xf8, 0x6a, 0x39, 0x11, 0x45, 0x48, 0x31, 0xb8 };

    const size = ListBV32.serializedSize(&value);
    try std.testing.expectEqual(@as(usize, 64), size);
    const serialized = try allocator.alloc(u8, size);
    defer allocator.free(serialized);
    const written = ListBV32.serializeIntoBytes(&value, serialized);
    try std.testing.expectEqual(@as(usize, 64), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, serialized);

    var root: [32]u8 = undefined;
    try ListBV32.hashTreeRoot(allocator, &value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const node = try ListBV32.tree.fromValue(&pool, &value);
    const tree_size = try ListBV32.tree.serializedSize(node, &pool);
    try std.testing.expectEqual(@as(usize, 64), tree_size);
    const tree_serialized = try allocator.alloc(u8, tree_size);
    defer allocator.free(tree_serialized);
    _ = try ListBV32.tree.serializeIntoBytes(node, &pool, tree_serialized);
    try std.testing.expectEqualSlices(u8, &expected_serialized, tree_serialized);
}

test "FixedListType - serializeIntoBytes (ListComposite Container - empty)" {
    const allocator = std.testing.allocator;
    const Container = FixedContainerType(struct {
        a: UintType(64),
        b: UintType(64),
    });
    const ListContainer = FixedListType(Container, 128, .{});

    var value: ListContainer.Type = ListContainer.default_value;

    const expected_serialized = [_]u8{};
    const expected_root = [_]u8{ 0x96, 0x55, 0x96, 0x74, 0xa7, 0x96, 0x56, 0xe5, 0x40, 0x87, 0x1e, 0x1f, 0x39, 0xc9, 0xb9, 0x1e, 0x15, 0x2a, 0xa8, 0xcd, 0xdb, 0x71, 0x49, 0x3e, 0x75, 0x48, 0x27, 0xc4, 0xcc, 0x80, 0x9d, 0x57 };

    const size = ListContainer.serializedSize(&value);
    try std.testing.expectEqual(@as(usize, 0), size);
    const serialized = try allocator.alloc(u8, size);
    defer allocator.free(serialized);
    const written = ListContainer.serializeIntoBytes(&value, serialized);
    try std.testing.expectEqual(@as(usize, 0), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, serialized);

    var root: [32]u8 = undefined;
    try ListContainer.hashTreeRoot(allocator, &value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const node = try ListContainer.tree.fromValue(&pool, &value);
    const tree_size = try ListContainer.tree.serializedSize(node, &pool);
    try std.testing.expectEqual(@as(usize, 0), tree_size);
    const tree_serialized = try allocator.alloc(u8, tree_size);
    defer allocator.free(tree_serialized);
    _ = try ListContainer.tree.serializeIntoBytes(node, &pool, tree_serialized);
    try std.testing.expectEqualSlices(u8, &expected_serialized, tree_serialized);
}

test "FixedListType - serializeIntoBytes (ListComposite Container - 2 values)" {
    const allocator = std.testing.allocator;
    const Container = FixedContainerType(struct {
        a: UintType(64),
        b: UintType(64),
    });
    const ListContainer = FixedListType(Container, 128, .{});

    var value: ListContainer.Type = ListContainer.default_value;
    defer value.deinit(allocator);
    // [{a: 0, b: 0}, {a: 123456, b: 654321}]
    try value.append(allocator, .{ .a = 0, .b = 0 });
    try value.append(allocator, .{ .a = 123456, .b = 654321 });

    // 0x0000000000000000000000000000000040e2010000000000f1fb090000000000
    const expected_serialized = [_]u8{
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // a = 0
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // b = 0
        0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // a = 123456
        0xf1, 0xfb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, // b = 654321
    };
    const expected_root = [_]u8{ 0x8f, 0xf9, 0x4c, 0x10, 0xd3, 0x9f, 0xfa, 0x84, 0xaa, 0x93, 0x7e, 0x2a, 0x07, 0x72, 0x39, 0xc2, 0x74, 0x2c, 0xb4, 0x25, 0xa2, 0xa1, 0x61, 0x74, 0x4a, 0x3e, 0x98, 0x76, 0xeb, 0x3c, 0x72, 0x10 };

    const size = ListContainer.serializedSize(&value);
    try std.testing.expectEqual(@as(usize, 32), size);
    const serialized = try allocator.alloc(u8, size);
    defer allocator.free(serialized);
    const written = ListContainer.serializeIntoBytes(&value, serialized);
    try std.testing.expectEqual(@as(usize, 32), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, serialized);

    var root: [32]u8 = undefined;
    try ListContainer.hashTreeRoot(allocator, &value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const node = try ListContainer.tree.fromValue(&pool, &value);
    const tree_size = try ListContainer.tree.serializedSize(node, &pool);
    try std.testing.expectEqual(@as(usize, 32), tree_size);
    const tree_serialized = try allocator.alloc(u8, tree_size);
    defer allocator.free(tree_serialized);
    _ = try ListContainer.tree.serializeIntoBytes(node, &pool, tree_serialized);
    try std.testing.expectEqualSlices(u8, &expected_serialized, tree_serialized);
}

test "VariableListType - serializeIntoBytes (List<List<uint16>> - empty)" {
    const allocator = std.testing.allocator;
    const InnerList = FixedListType(UintType(16), 2, .{});
    const OuterList = VariableListType(InnerList, 2);

    var value: OuterList.Type = OuterList.default_value;

    // empty list
    const expected_serialized = [_]u8{};
    const expected_root = [_]u8{ 0x7a, 0x05, 0x01, 0xf5, 0x95, 0x7b, 0xdf, 0x9c, 0xb3, 0xa8, 0xff, 0x49, 0x66, 0xf0, 0x22, 0x65, 0xf9, 0x68, 0x65, 0x8b, 0x7a, 0x9c, 0x62, 0x64, 0x2c, 0xba, 0x11, 0x65, 0xe8, 0x66, 0x42, 0xf5 };

    const size = OuterList.serializedSize(&value);
    try std.testing.expectEqual(@as(usize, 0), size);
    const serialized = try allocator.alloc(u8, size);
    defer allocator.free(serialized);
    const written = OuterList.serializeIntoBytes(&value, serialized);
    try std.testing.expectEqual(@as(usize, 0), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, serialized);

    var root: [32]u8 = undefined;
    try OuterList.hashTreeRoot(allocator, &value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const node = try OuterList.tree.fromValue(&pool, &value);
    const tree_size = try OuterList.tree.serializedSize(node, &pool);
    try std.testing.expectEqual(@as(usize, 0), tree_size);
    const tree_serialized = try allocator.alloc(u8, tree_size);
    defer allocator.free(tree_serialized);
    _ = try OuterList.tree.serializeIntoBytes(node, &pool, tree_serialized);
    try std.testing.expectEqualSlices(u8, &expected_serialized, tree_serialized);
}

test "VariableListType - serializeIntoBytes (List<List<uint16>> - 2 full values)" {
    const allocator = std.testing.allocator;
    const InnerList = FixedListType(UintType(16), 2, .{});
    const OuterList = VariableListType(InnerList, 2);

    var value: OuterList.Type = OuterList.default_value;
    defer OuterList.deinit(allocator, &value);
    // [[1, 2], [3, 4]]
    var inner1: InnerList.Type = InnerList.default_value;
    try inner1.appendSlice(allocator, &[_]u16{ 1, 2 });
    var inner2: InnerList.Type = InnerList.default_value;
    try inner2.appendSlice(allocator, &[_]u16{ 3, 4 });
    try value.append(allocator, inner1);
    try value.append(allocator, inner2);

    // 0x080000000c0000000100020003000400
    const expected_serialized = [_]u8{
        0x08, 0x00, 0x00, 0x00, // offset to inner1 (8)
        0x0c, 0x00, 0x00, 0x00, // offset to inner2 (12)
        0x01, 0x00, // 1
        0x02, 0x00, // 2
        0x03, 0x00, // 3
        0x04, 0x00, // 4
    };
    const expected_root = [_]u8{ 0x58, 0x14, 0x0d, 0x48, 0xf9, 0xc2, 0x45, 0x45, 0xc1, 0xe3, 0xa5, 0x0f, 0x1e, 0xbc, 0xca, 0x85, 0xfd, 0x40, 0x43, 0x3c, 0x98, 0x59, 0xc0, 0xac, 0x34, 0x34, 0x2f, 0xc8, 0xe0, 0xa8, 0x00, 0xb8 };

    const size = OuterList.serializedSize(&value);
    try std.testing.expectEqual(@as(usize, 16), size);
    const serialized = try allocator.alloc(u8, size);
    defer allocator.free(serialized);
    const written = OuterList.serializeIntoBytes(&value, serialized);
    try std.testing.expectEqual(@as(usize, 16), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, serialized);

    var root: [32]u8 = undefined;
    try OuterList.hashTreeRoot(allocator, &value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const node = try OuterList.tree.fromValue(&pool, &value);
    const tree_size = try OuterList.tree.serializedSize(node, &pool);
    try std.testing.expectEqual(@as(usize, 16), tree_size);
    const tree_serialized = try allocator.alloc(u8, tree_size);
    defer allocator.free(tree_serialized);
    _ = try OuterList.tree.serializeIntoBytes(node, &pool, tree_serialized);
    try std.testing.expectEqualSlices(u8, &expected_serialized, tree_serialized);
}

test "VariableListType - serializeIntoBytes (List<List<uint16>> - 2 empty values)" {
    const allocator = std.testing.allocator;
    const InnerList = FixedListType(UintType(16), 2, .{});
    const OuterList = VariableListType(InnerList, 2);

    var value: OuterList.Type = OuterList.default_value;
    defer OuterList.deinit(allocator, &value);
    // [[], []]
    const inner1: InnerList.Type = InnerList.default_value;
    const inner2: InnerList.Type = InnerList.default_value;
    try value.append(allocator, inner1);
    try value.append(allocator, inner2);

    // 0x0800000008000000
    const expected_serialized = [_]u8{
        0x08, 0x00, 0x00, 0x00, // offset to inner1 (8)
        0x08, 0x00, 0x00, 0x00, // offset to inner2 (8) - same offset since inner1 is empty
    };
    const expected_root = [_]u8{ 0xe8, 0x39, 0xa2, 0x27, 0x14, 0xbd, 0xa0, 0x59, 0x23, 0xb6, 0x11, 0xd0, 0x7b, 0xe9, 0x3b, 0x4d, 0x70, 0x70, 0x27, 0xd2, 0x9f, 0xd9, 0xee, 0xf7, 0xaa, 0x86, 0x4e, 0xd5, 0x87, 0xe4, 0x62, 0xec };

    const size = OuterList.serializedSize(&value);
    try std.testing.expectEqual(@as(usize, 8), size);
    const serialized = try allocator.alloc(u8, size);
    defer allocator.free(serialized);
    const written = OuterList.serializeIntoBytes(&value, serialized);
    try std.testing.expectEqual(@as(usize, 8), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, serialized);

    var root: [32]u8 = undefined;
    try OuterList.hashTreeRoot(allocator, &value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const node = try OuterList.tree.fromValue(&pool, &value);
    const tree_size = try OuterList.tree.serializedSize(node, &pool);
    try std.testing.expectEqual(@as(usize, 8), tree_size);
    const tree_serialized = try allocator.alloc(u8, tree_size);
    defer allocator.free(tree_serialized);
    _ = try OuterList.tree.serializeIntoBytes(node, &pool, tree_serialized);
    try std.testing.expectEqualSlices(u8, &expected_serialized, tree_serialized);
}

test "FixedListType - tree.deserializeFromBytes (ListBasic uint8)" {
    const allocator = std.testing.allocator;

    const ListU8 = FixedListType(UintType(8), 128, .{});

    const TestCase = struct {
        id: []const u8,
        serialized: []const u8,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty",
            .serialized = &[_]u8{},
            // 0x28ba1834a3a7b657460ce79fa3a1d909ab8828fd557659d4d0554a9bdbc0ec30
            .expected_root = [_]u8{ 0x28, 0xba, 0x18, 0x34, 0xa3, 0xa7, 0xb6, 0x57, 0x46, 0x0c, 0xe7, 0x9f, 0xa3, 0xa1, 0xd9, 0x09, 0xab, 0x88, 0x28, 0xfd, 0x55, 0x76, 0x59, 0xd4, 0xd0, 0x55, 0x4a, 0x9b, 0xdb, 0xc0, 0xec, 0x30 },
        },
        .{
            .id = "4 values",
            .serialized = &[_]u8{ 0x01, 0x02, 0x03, 0x04 },
            // 0xbac511d1f641d6b8823200bb4b3cced3bd4720701f18571dff35a5d2a40190fa
            .expected_root = [_]u8{ 0xba, 0xc5, 0x11, 0xd1, 0xf6, 0x41, 0xd6, 0xb8, 0x82, 0x32, 0x00, 0xbb, 0x4b, 0x3c, 0xce, 0xd3, 0xbd, 0x47, 0x20, 0x70, 0x1f, 0x18, 0x57, 0x1d, 0xff, 0x35, 0xa5, 0xd2, 0xa4, 0x01, 0x90, 0xfa },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (test_cases) |tc| {
        const tree_node = try ListU8.tree.deserializeFromBytes(&pool, tc.serialized);

        var value_from_tree: ListU8.Type = ListU8.default_value;
        defer value_from_tree.deinit(allocator);
        try ListU8.tree.toValue(allocator, tree_node, &pool, &value_from_tree);

        try std.testing.expectEqual(tc.serialized.len, value_from_tree.items.len);
        try std.testing.expectEqualSlices(u8, tc.serialized, value_from_tree.items);

        const tree_size = try ListU8.tree.serializedSize(tree_node, &pool);
        try std.testing.expectEqual(tc.serialized.len, tree_size);
        const tree_serialized = try allocator.alloc(u8, tree_size);
        defer allocator.free(tree_serialized);
        _ = try ListU8.tree.serializeIntoBytes(tree_node, &pool, tree_serialized);
        try std.testing.expectEqualSlices(u8, tc.serialized, tree_serialized);

        var hash_root: [32]u8 = undefined;
        try ListU8.hashTreeRoot(allocator, &value_from_tree, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "FixedListType - tree.deserializeFromBytes (ListBasic uint64)" {
    const allocator = std.testing.allocator;

    const ListU64 = FixedListType(UintType(64), 128, .{});

    const TestCase = struct {
        id: []const u8,
        serialized: []const u8,
        expected_values: []const u64,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty",
            .serialized = &[_]u8{},
            .expected_values = &[_]u64{},
            // 0x52e2647abc3d0c9d3be0387f3f0d925422c7a4e98cf4489066f0f43281a899f3
            .expected_root = [_]u8{ 0x52, 0xe2, 0x64, 0x7a, 0xbc, 0x3d, 0x0c, 0x9d, 0x3b, 0xe0, 0x38, 0x7f, 0x3f, 0x0d, 0x92, 0x54, 0x22, 0xc7, 0xa4, 0xe9, 0x8c, 0xf4, 0x48, 0x90, 0x66, 0xf0, 0xf4, 0x32, 0x81, 0xa8, 0x99, 0xf3 },
        },
        .{
            .id = "4 values",
            // 0xa086010000000000400d030000000000e093040000000000801a060000000000
            .serialized = &[_]u8{
                0xa0, 0x86, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // 100000
                0x40, 0x0d, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, // 200000
                0xe0, 0x93, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, // 300000
                0x80, 0x1a, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, // 400000
            },
            .expected_values = &[_]u64{ 100000, 200000, 300000, 400000 },
            // 0xd1daef215502b7746e5ff3e8833e399cb249ab3f81d824be60e174ff5633c1bf
            .expected_root = [_]u8{ 0xd1, 0xda, 0xef, 0x21, 0x55, 0x02, 0xb7, 0x74, 0x6e, 0x5f, 0xf3, 0xe8, 0x83, 0x3e, 0x39, 0x9c, 0xb2, 0x49, 0xab, 0x3f, 0x81, 0xd8, 0x24, 0xbe, 0x60, 0xe1, 0x74, 0xff, 0x56, 0x33, 0xc1, 0xbf },
        },
        .{
            .id = "8 values",
            // 0xa086010000000000400d030000000000e093040000000000801a060000000000a086010000000000400d030000000000e093040000000000801a060000000000
            .serialized = &[_]u8{
                0xa0, 0x86, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // 100000
                0x40, 0x0d, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, // 200000
                0xe0, 0x93, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, // 300000
                0x80, 0x1a, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, // 400000
                0xa0, 0x86, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // 100000
                0x40, 0x0d, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, // 200000
                0xe0, 0x93, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, // 300000
                0x80, 0x1a, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, // 400000
            },
            .expected_values = &[_]u64{ 100000, 200000, 300000, 400000, 100000, 200000, 300000, 400000 },
            // 0xb55b8592bcac475906631481bbc746bca7339d04ab1085e84884a700c03de4b1
            .expected_root = [_]u8{ 0xb5, 0x5b, 0x85, 0x92, 0xbc, 0xac, 0x47, 0x59, 0x06, 0x63, 0x14, 0x81, 0xbb, 0xc7, 0x46, 0xbc, 0xa7, 0x33, 0x9d, 0x04, 0xab, 0x10, 0x85, 0xe8, 0x48, 0x84, 0xa7, 0x00, 0xc0, 0x3d, 0xe4, 0xb1 },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (test_cases) |tc| {
        const tree_node = try ListU64.tree.deserializeFromBytes(&pool, tc.serialized);

        var value_from_tree: ListU64.Type = ListU64.default_value;
        defer value_from_tree.deinit(allocator);
        try ListU64.tree.toValue(allocator, tree_node, &pool, &value_from_tree);

        try std.testing.expectEqual(tc.expected_values.len, value_from_tree.items.len);
        try std.testing.expectEqualSlices(u64, tc.expected_values, value_from_tree.items);

        const tree_size = try ListU64.tree.serializedSize(tree_node, &pool);
        try std.testing.expectEqual(tc.serialized.len, tree_size);
        const tree_serialized = try allocator.alloc(u8, tree_size);
        defer allocator.free(tree_serialized);
        _ = try ListU64.tree.serializeIntoBytes(tree_node, &pool, tree_serialized);
        try std.testing.expectEqualSlices(u8, tc.serialized, tree_serialized);

        var hash_root: [32]u8 = undefined;
        try ListU64.hashTreeRoot(allocator, &value_from_tree, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "FixedListType - tree.deserializeFromBytes (ListComposite ByteVector32)" {
    const allocator = std.testing.allocator;
    const ByteVector32 = ByteVectorType(32);
    const ListBV32 = FixedListType(ByteVector32, 128, .{});

    const TestCase = struct {
        id: []const u8,
        serialized: []const u8,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty",
            .serialized = &[_]u8{},
            // 0x96559674a79656e540871e1f39c9b91e152aa8cddb71493e754827c4cc809d57
            .expected_root = [_]u8{ 0x96, 0x55, 0x96, 0x74, 0xa7, 0x96, 0x56, 0xe5, 0x40, 0x87, 0x1e, 0x1f, 0x39, 0xc9, 0xb9, 0x1e, 0x15, 0x2a, 0xa8, 0xcd, 0xdb, 0x71, 0x49, 0x3e, 0x75, 0x48, 0x27, 0xc4, 0xcc, 0x80, 0x9d, 0x57 },
        },
        .{
            .id = "2 roots",
            // 0xddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
            .serialized = &([_]u8{0xdd} ** 32 ++ [_]u8{0xee} ** 32),
            // 0x0cb947377e177f774719ead8d210af9c6461f41baf5b4082f86a3911454831b8
            .expected_root = [_]u8{ 0x0c, 0xb9, 0x47, 0x37, 0x7e, 0x17, 0x7f, 0x77, 0x47, 0x19, 0xea, 0xd8, 0xd2, 0x10, 0xaf, 0x9c, 0x64, 0x61, 0xf4, 0x1b, 0xaf, 0x5b, 0x40, 0x82, 0xf8, 0x6a, 0x39, 0x11, 0x45, 0x48, 0x31, 0xb8 },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (test_cases) |tc| {
        const tree_node = try ListBV32.tree.deserializeFromBytes(&pool, tc.serialized);

        var value_from_tree: ListBV32.Type = ListBV32.default_value;
        defer value_from_tree.deinit(allocator);
        try ListBV32.tree.toValue(allocator, tree_node, &pool, &value_from_tree);

        try std.testing.expectEqual(tc.serialized.len / 32, value_from_tree.items.len);

        const tree_size = try ListBV32.tree.serializedSize(tree_node, &pool);
        try std.testing.expectEqual(tc.serialized.len, tree_size);
        const tree_serialized = try allocator.alloc(u8, tree_size);
        defer allocator.free(tree_serialized);
        _ = try ListBV32.tree.serializeIntoBytes(tree_node, &pool, tree_serialized);
        try std.testing.expectEqualSlices(u8, tc.serialized, tree_serialized);

        var hash_root: [32]u8 = undefined;
        try ListBV32.hashTreeRoot(allocator, &value_from_tree, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "FixedListType - tree.deserializeFromBytes (ListComposite Container)" {
    const allocator = std.testing.allocator;
    const Container = FixedContainerType(struct {
        a: UintType(64),
        b: UintType(64),
    });
    const ListContainer = FixedListType(Container, 128, .{});

    const TestCase = struct {
        id: []const u8,
        serialized: []const u8,
        expected_values: []const Container.Type,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty",
            .serialized = &[_]u8{},
            .expected_values = &[_]Container.Type{},
            // 0x96559674a79656e540871e1f39c9b91e152aa8cddb71493e754827c4cc809d57
            .expected_root = [_]u8{ 0x96, 0x55, 0x96, 0x74, 0xa7, 0x96, 0x56, 0xe5, 0x40, 0x87, 0x1e, 0x1f, 0x39, 0xc9, 0xb9, 0x1e, 0x15, 0x2a, 0xa8, 0xcd, 0xdb, 0x71, 0x49, 0x3e, 0x75, 0x48, 0x27, 0xc4, 0xcc, 0x80, 0x9d, 0x57 },
        },
        .{
            .id = "2 values",
            // 0x0000000000000000000000000000000040e2010000000000f1fb090000000000
            .serialized = &[_]u8{
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // a = 0
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // b = 0
                0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // a = 123456
                0xf1, 0xfb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, // b = 654321
            },
            .expected_values = &[_]Container.Type{
                .{ .a = 0, .b = 0 },
                .{ .a = 123456, .b = 654321 },
            },
            // 0x8ff94c10d39ffa84aa937e2a077239c2742cb425a2a161744a3e9876eb3c7210
            .expected_root = [_]u8{ 0x8f, 0xf9, 0x4c, 0x10, 0xd3, 0x9f, 0xfa, 0x84, 0xaa, 0x93, 0x7e, 0x2a, 0x07, 0x72, 0x39, 0xc2, 0x74, 0x2c, 0xb4, 0x25, 0xa2, 0xa1, 0x61, 0x74, 0x4a, 0x3e, 0x98, 0x76, 0xeb, 0x3c, 0x72, 0x10 },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (test_cases) |tc| {
        const tree_node = try ListContainer.tree.deserializeFromBytes(&pool, tc.serialized);

        var value_from_tree: ListContainer.Type = ListContainer.default_value;
        defer value_from_tree.deinit(allocator);
        try ListContainer.tree.toValue(allocator, tree_node, &pool, &value_from_tree);

        try std.testing.expectEqual(tc.expected_values.len, value_from_tree.items.len);
        for (tc.expected_values, 0..) |expected, i| {
            try std.testing.expectEqual(expected.a, value_from_tree.items[i].a);
            try std.testing.expectEqual(expected.b, value_from_tree.items[i].b);
        }

        const tree_size = try ListContainer.tree.serializedSize(tree_node, &pool);
        try std.testing.expectEqual(tc.serialized.len, tree_size);
        const tree_serialized = try allocator.alloc(u8, tree_size);
        defer allocator.free(tree_serialized);
        _ = try ListContainer.tree.serializeIntoBytes(tree_node, &pool, tree_serialized);
        try std.testing.expectEqualSlices(u8, tc.serialized, tree_serialized);

        var hash_root: [32]u8 = undefined;
        try ListContainer.hashTreeRoot(allocator, &value_from_tree, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "VariableListType - tree.deserializeFromBytes (List<List<uint16>>)" {
    const allocator = std.testing.allocator;
    const InnerList = FixedListType(UintType(16), 2, .{});
    const OuterList = VariableListType(InnerList, 2);

    const TestCase = struct {
        id: []const u8,
        serialized: []const u8,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty",
            .serialized = &[_]u8{},
            // 0x7a0501f5957bdf9cb3a8ff4966f02265f968658b7a9c62642cba1165e86642f5
            .expected_root = [_]u8{ 0x7a, 0x05, 0x01, 0xf5, 0x95, 0x7b, 0xdf, 0x9c, 0xb3, 0xa8, 0xff, 0x49, 0x66, 0xf0, 0x22, 0x65, 0xf9, 0x68, 0x65, 0x8b, 0x7a, 0x9c, 0x62, 0x64, 0x2c, 0xba, 0x11, 0x65, 0xe8, 0x66, 0x42, 0xf5 },
        },
        .{
            .id = "2 full values",
            // 0x080000000c0000000100020003000400
            .serialized = &[_]u8{
                0x08, 0x00, 0x00, 0x00, // offset to inner1 (8)
                0x0c, 0x00, 0x00, 0x00, // offset to inner2 (12)
                0x01, 0x00, // 1
                0x02, 0x00, // 2
                0x03, 0x00, // 3
                0x04, 0x00, // 4
            },
            // 0x58140d48f9c24545c1e3a50f1ebcca85fd40433c9859c0ac34342fc8e0a800b8
            .expected_root = [_]u8{ 0x58, 0x14, 0x0d, 0x48, 0xf9, 0xc2, 0x45, 0x45, 0xc1, 0xe3, 0xa5, 0x0f, 0x1e, 0xbc, 0xca, 0x85, 0xfd, 0x40, 0x43, 0x3c, 0x98, 0x59, 0xc0, 0xac, 0x34, 0x34, 0x2f, 0xc8, 0xe0, 0xa8, 0x00, 0xb8 },
        },
        .{
            .id = "2 empty values",
            // 0x0800000008000000
            .serialized = &[_]u8{
                0x08, 0x00, 0x00, 0x00, // offset to inner1 (8)
                0x08, 0x00, 0x00, 0x00, // offset to inner2 (8) - same offset since inner1 is empty
            },
            // 0xe839a22714bda05923b611d07be93b4d707027d29fd9eef7aa864ed587e462ec
            .expected_root = [_]u8{ 0xe8, 0x39, 0xa2, 0x27, 0x14, 0xbd, 0xa0, 0x59, 0x23, 0xb6, 0x11, 0xd0, 0x7b, 0xe9, 0x3b, 0x4d, 0x70, 0x70, 0x27, 0xd2, 0x9f, 0xd9, 0xee, 0xf7, 0xaa, 0x86, 0x4e, 0xd5, 0x87, 0xe4, 0x62, 0xec },
        },
    };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (test_cases) |tc| {
        const tree_node = try OuterList.tree.deserializeFromBytes(&pool, tc.serialized);

        var value_from_tree: OuterList.Type = OuterList.default_value;
        defer OuterList.deinit(allocator, &value_from_tree);
        try OuterList.tree.toValue(allocator, tree_node, &pool, &value_from_tree);

        const tree_size = try OuterList.tree.serializedSize(tree_node, &pool);
        try std.testing.expectEqual(tc.serialized.len, tree_size);
        const tree_serialized = try allocator.alloc(u8, tree_size);
        defer allocator.free(tree_serialized);
        _ = try OuterList.tree.serializeIntoBytes(tree_node, &pool, tree_serialized);
        try std.testing.expectEqualSlices(u8, tc.serialized, tree_serialized);

        var hash_root: [32]u8 = undefined;
        try OuterList.hashTreeRoot(allocator, &value_from_tree, &hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "valid test for ListBasicType" {
    const allocator = std.testing.allocator;

    // uint of 8 bytes = u64
    const Uint = UintType(64);
    const List = FixedListType(Uint, 128, .{});

    const TypeTest = @import("test_utils.zig").typeTest(List);

    for (testCases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "FixedListType equals" {
    const allocator = std.testing.allocator;
    const List = FixedListType(UintType(8), 32, .{});

    var a: List.Type = List.Type.empty;
    var b: List.Type = List.Type.empty;
    var c: List.Type = List.Type.empty;

    defer a.deinit(allocator);
    defer b.deinit(allocator);
    defer c.deinit(allocator);

    try a.appendSlice(allocator, &[_]u8{ 1, 2, 3 });
    try b.appendSlice(allocator, &[_]u8{ 1, 2, 3 });
    try c.appendSlice(allocator, &[_]u8{ 1, 2 });

    try std.testing.expect(List.equals(&a, &b));
    try std.testing.expect(!List.equals(&a, &c));
}

test "ListCompositeType of Root" {
    const test_cases = [_]TypeTestCase{
        // refer to https://github.com/ChainSafe/ssz/blob/7f5580c2ea69f9307300ddb6010a8bc7ce2fc471/packages/ssz/test/unit/byType/listComposite/valid.test.ts#L23
        .{
            .id = "2 roots",
            .serializedHex = "0xddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            .json =
            \\["0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]
            ,
            .rootHex = "0x0cb947377e177f774719ead8d210af9c6461f41baf5b4082f86a3911454831b8",
        },
    };

    const allocator = std.testing.allocator;
    const ByteVector = ByteVectorType(32);
    const List = FixedListType(ByteVector, 128, .{});

    const TypeTest = @import("test_utils.zig").typeTest(List);

    for (test_cases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "ListCompositeType of Container" {
    const test_cases = [_]TypeTestCase{
        // refer to https://github.com/ChainSafe/ssz/blob/7f5580c2ea69f9307300ddb6010a8bc7ce2fc471/packages/ssz/test/unit/byType/listComposite/valid.test.ts#L46
        .{
            .id = "2 values",
            .serializedHex = "0x0000000000000000000000000000000040e2010000000000f1fb090000000000",
            .json =
            \\[{"a":"0","b":"0"},{"a":"123456","b":"654321"}]
            ,
            .rootHex = "0x8ff94c10d39ffa84aa937e2a077239c2742cb425a2a161744a3e9876eb3c7210",
        },
    };

    const allocator = std.testing.allocator;
    const Uint = UintType(64);
    const Container = FixedContainerType(struct {
        a: Uint,
        b: Uint,
    });
    const List = FixedListType(Container, 128, .{});

    const TypeTest = @import("test_utils.zig").typeTest(List);

    for (test_cases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "VariableListType of FixedList" {
    // refer to https://github.com/ChainSafe/ssz/blob/7f5580c2ea69f9307300ddb6010a8bc7ce2fc471/packages/ssz/test/unit/byType/listComposite/valid.test.ts#L59
    const test_cases = [_]TypeTestCase{
        .{
            .id = "empty",
            .serializedHex = "0x",
            .json =
            \\[]
            ,
            .rootHex = "0x7a0501f5957bdf9cb3a8ff4966f02265f968658b7a9c62642cba1165e86642f5",
        },
        .{
            .id = "2 full values",
            .serializedHex = "0x080000000c0000000100020003000400",
            .json =
            \\[["1","2"],["3","4"]]
            ,
            .rootHex = "0x58140d48f9c24545c1e3a50f1ebcca85fd40433c9859c0ac34342fc8e0a800b8",
        },
        .{
            .id = "2 empty values",
            .serializedHex = "0x0800000008000000",
            .json =
            \\[[],[]]
            ,
            .rootHex = "0xe839a22714bda05923b611d07be93b4d707027d29fd9eef7aa864ed587e462ec",
        },
    };

    const allocator = std.testing.allocator;
    const FixedList = FixedListType(UintType(16), 2, .{});
    const List = VariableListType(FixedList, 2);

    const TypeTest = @import("test_utils.zig").typeTest(List);

    for (test_cases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "FixedListType - default_root" {
    const ListU32 = FixedListType(UintType(32), 16, .{});
    var expected_root: [32]u8 = undefined;

    try ListU32.hashTreeRoot(std.testing.allocator, &ListU32.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &ListU32.default_root);

    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1024 });
    defer pool.deinit();

    const node = try ListU32.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &expected_root, node.getRoot(&pool));
}

test "VariableListType - default_root" {
    const ListU32 = FixedListType(UintType(32), 16, .{});
    const ListListU32 = VariableListType(ListU32, 16);
    var expected_root: [32]u8 = undefined;

    try ListListU32.hashTreeRoot(std.testing.allocator, &ListListU32.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &ListListU32.default_root);

    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1024 });
    defer pool.deinit();

    const node = try ListListU32.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &expected_root, node.getRoot(&pool));
}

test "FixedListType - tree.zeros" {
    const allocator = std.testing.allocator;

    const ListU16 = FixedListType(UintType(16), 8, .{});

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (0..ListU16.limit) |len| {
        const tree_node = try ListU16.tree.zeros(&pool, len);
        defer pool.unref(tree_node);

        var value = ListU16.default_value;
        defer ListU16.deinit(allocator, &value);
        try value.resize(allocator, len);
        @memset(value.items, 0);

        var expected_root: [32]u8 = undefined;
        try ListU16.hashTreeRoot(allocator, &value, &expected_root);

        try std.testing.expectEqualSlices(u8, &expected_root, tree_node.getRoot(&pool));
    }
}

test "VariableListType - tree.zeros" {
    const allocator = std.testing.allocator;

    const ListU32 = FixedListType(UintType(32), 16, .{});
    const ListListU32 = VariableListType(ListU32, 16);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    for (0..ListListU32.limit) |len| {
        const tree_node = try ListListU32.tree.zeros(&pool, len);
        defer pool.unref(tree_node);

        var value = ListListU32.default_value;
        defer ListListU32.deinit(allocator, &value);
        try value.resize(allocator, len);
        @memset(value.items, ListListU32.Element.default_value);

        var expected_root: [32]u8 = undefined;
        try ListListU32.hashTreeRoot(allocator, &value, &expected_root);

        try std.testing.expectEqualSlices(u8, &expected_root, tree_node.getRoot(&pool));
    }
}

test "FixedListType opts.chunked_leaf=true: round-trip fromValue -> tree -> toValue" {
    const allocator = std.testing.allocator;
    const ChunkedLeaf = pmt.ChunkedLeaf;
    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    var src = ListT.Type.empty;
    defer src.deinit(allocator);
    const item_count: usize = 2 * @as(usize, ChunkedLeaf.K) * 4 + 7; // odd tail to stress partial chunked_leaf
    try src.ensureTotalCapacity(allocator, item_count);
    for (0..item_count) |i| try src.append(allocator, @as(u64, @intCast(i * 31 + 1)));

    const tree_id = try ListT.tree.fromValue(&pool, &src);
    defer pool.unref(tree_id);

    var dst = ListT.Type.empty;
    defer dst.deinit(allocator);
    try ListT.tree.toValue(allocator, tree_id, &pool, &dst);
    try std.testing.expectEqual(src.items.len, dst.items.len);
    for (src.items, dst.items) |a, b| try std.testing.expectEqual(a, b);

    // Hash matches the leaf-path (non-chunked_leaf) reference root.
    const ListLeafT = FixedListType(UintType(64), 1 << 20, .{});
    const leaf_tree_id = try ListLeafT.tree.fromValue(&pool, &src);
    defer pool.unref(leaf_tree_id);
    try std.testing.expectEqualSlices(u8, leaf_tree_id.getRoot(&pool), tree_id.getRoot(&pool));
}

test "FixedListType opts.chunked_leaf=true: serialize -> deserialize round-trip" {
    const allocator = std.testing.allocator;
    const ChunkedLeaf = pmt.ChunkedLeaf;
    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    var src = ListT.Type.empty;
    defer src.deinit(allocator);
    const item_count: usize = 2 * @as(usize, ChunkedLeaf.K) * 4;
    try src.ensureTotalCapacity(allocator, item_count);
    for (0..item_count) |i| try src.append(allocator, @as(u64, @intCast(i)));

    const tree_id = try ListT.tree.fromValue(&pool, &src);
    defer pool.unref(tree_id);

    const buf = try allocator.alloc(u8, item_count * @sizeOf(u64));
    defer allocator.free(buf);
    const written = try ListT.tree.serializeIntoBytes(tree_id, &pool, buf);
    try std.testing.expectEqual(item_count * @sizeOf(u64), written);

    const round_id = try ListT.tree.deserializeFromBytes(&pool, buf);
    defer pool.unref(round_id);
    try std.testing.expectEqualSlices(u8, tree_id.getRoot(&pool), round_id.getRoot(&pool));
}

test "FixedListType chunked serialization needs no scratch allocation" {
    const allocator = std.testing.allocator;
    const items_per_chunked_leaf = @as(usize, pmt.ChunkedLeaf.K) * 4;

    inline for (.{ items_per_chunked_leaf, 4 * items_per_chunked_leaf }) |limit| {
        const List = FixedListType(UintType(64), limit, .{ .chunked_leaf = true });
        const lengths = [_]usize{
            0,
            1,
            3,
            4,
            5,
            items_per_chunked_leaf - 1,
            items_per_chunked_leaf,
            items_per_chunked_leaf + 1,
            2 * items_per_chunked_leaf + 7,
            limit,
        };
        for (lengths) |len| {
            if (len > limit) continue;

            var failing = std.testing.FailingAllocator.init(allocator, .{});
            var pool = try Node.Pool.init(.{
                .page_allocator = failing.allocator(),
                .allocator = failing.allocator(),
                .pool_size = 64,
            });
            defer pool.deinit();

            var value = List.default_value;
            defer List.deinit(allocator, &value);
            try value.resize(allocator, len);
            for (value.items, 0..) |*item, i| item.* = @as(u64, @intCast(i + 1)) * 0x01020304050607;

            const root = try List.tree.fromValue(&pool, &value);
            defer pool.unref(root);
            const zero_root = try List.tree.zeros(&pool, len);
            defer pool.unref(zero_root);

            const expected = try allocator.alloc(u8, List.serializedSize(&value));
            defer allocator.free(expected);
            _ = List.serializeIntoBytes(&value, expected);

            const out = try allocator.alloc(u8, expected.len + 8);
            defer allocator.free(out);

            failing.fail_index = failing.alloc_index;
            failing.resize_fail_index = failing.resize_index;
            @memset(out, 0xaa);
            try std.testing.expectEqual(
                expected.len,
                try List.tree.serializeIntoBytes(root, &pool, out),
            );
            try std.testing.expectEqualSlices(u8, expected, out[0..expected.len]);
            try std.testing.expect(std.mem.allEqual(u8, out[expected.len..], 0xaa));

            @memset(expected, 0);
            @memset(out, 0xaa);
            try std.testing.expectEqual(
                expected.len,
                try List.tree.serializeIntoBytes(zero_root, &pool, out),
            );
            try std.testing.expectEqualSlices(u8, expected, out[0..expected.len]);
            try std.testing.expect(std.mem.allEqual(u8, out[expected.len..], 0xaa));
            try std.testing.expect(!failing.has_induced_failure);
        }
    }
}

test "FixedListType chunked serialization preserves mixed zero subtrees without allocating" {
    const allocator = std.testing.allocator;
    const bytes_per_chunked_leaf = @as(usize, pmt.ChunkedLeaf.K) * 32;
    const List = FixedListType(UintType(8), 4 * bytes_per_chunked_leaf, .{ .chunked_leaf = true });
    var failing = std.testing.FailingAllocator.init(allocator, .{});
    var pool = try Node.Pool.init(.{
        .page_allocator = failing.allocator(),
        .allocator = failing.allocator(),
        .pool_size = 64,
    });
    defer pool.deinit();

    var expected: [2 * bytes_per_chunked_leaf + 7]u8 = undefined;
    for (&expected, 0..) |*byte, i| byte.* = @truncate(i + 1);
    @memset(expected[bytes_per_chunked_leaf..][0..bytes_per_chunked_leaf], 0);

    const root = try List.tree.deserializeFromBytes(&pool, &expected);
    defer pool.unref(root);
    const mixed_root = try root.setNodeAtDepth(
        &pool,
        List.chunk_depth + 1 - pmt.ChunkedLeaf.k_log2,
        1,
        @enumFromInt(pmt.ChunkedLeaf.k_log2),
    );
    defer pool.unref(mixed_root);

    failing.fail_index = failing.alloc_index;
    failing.resize_fail_index = failing.resize_index;
    var out: [expected.len + 8]u8 = @splat(0xaa);
    try std.testing.expectEqual(
        expected.len,
        try List.tree.serializeIntoBytes(mixed_root, &pool, &out),
    );
    try std.testing.expectEqualSlices(u8, &expected, out[0..expected.len]);
    try std.testing.expect(std.mem.allEqual(u8, out[expected.len..], 0xaa));
    try std.testing.expect(!failing.has_induced_failure);
}

test "memory_safety: VariableList clone should keep destination deinit-safe on allocation failure" {
    const Bytes = ByteListType(8);
    const ListType = VariableListType(Bytes, 2);

    var source = ListType.default_value;
    defer ListType.deinit(std.testing.allocator, &source);
    try source.append(std.testing.allocator, Bytes.default_value);
    try source.items[0].append(std.testing.allocator, 1);
    try source.append(std.testing.allocator, Bytes.default_value);
    try source.items[1].append(std.testing.allocator, 2);

    var backing = DoubleFreeDetectAllocator.init(std.testing.allocator, std.math.maxInt(usize));
    defer backing.deinit();

    try std.testing.checkAllAllocationFailures(backing.allocator(), struct {
        fn run(allocator: std.mem.Allocator, input: *const ListType.Type) !void {
            var cloned = ListType.default_value;
            defer ListType.deinit(allocator, &cloned);
            try ListType.clone(allocator, input, &cloned);
            try std.testing.expect(ListType.equals(input, &cloned));
        }
    }.run, .{&source});
    try std.testing.expect(!backing.double_free);
    try std.testing.expectEqual(@as(usize, 0), backing.live.count());
}

test "memory_safety: VariableList deserializeFromBytes leaves out deinit-safe on malformed input" {
    const List = VariableListType(ByteListType(2), 4);
    const cases = .{
        // Offset 8 declares two elements, so `out` is resized before offset 4 moves backward.
        .{ &[_]u8{ 8, 0, 0, 0, 4, 0, 0, 0 }, error.offsetNotIncreasing },
        // Element 0 decodes into an allocation; element 1 holds three bytes, over its limit of two.
        .{ &[_]u8{ 8, 0, 0, 0, 9, 0, 0, 0, 1, 2, 3, 4 }, error.invalidLength },
    };
    inline for (cases) |case| {
        var out = List.default_value;
        defer List.deinit(std.testing.allocator, &out);
        try std.testing.expectError(
            case[1],
            List.deserializeFromBytes(std.testing.allocator, case[0], &out),
        );
    }
}

test "memory_safety: VariableList deserializeFromBytes leaves out deinit-safe on OOM" {
    const List = VariableListType(ByteListType(2), 4);
    const serialized = [_]u8{ 8, 0, 0, 0, 9, 0, 0, 0, 1, 2, 3 };

    try std.testing.checkAllAllocationFailures(std.testing.allocator, struct {
        fn run(allocator: std.mem.Allocator, bytes: []const u8) !void {
            var out = List.default_value;
            defer List.deinit(allocator, &out);
            try List.deserializeFromBytes(allocator, bytes, &out);
            try std.testing.expectEqualSlices(u8, &.{1}, out.items[0].items);
            try std.testing.expectEqualSlices(u8, &.{ 2, 3 }, out.items[1].items);
        }
    }.run, .{&serialized});
}

test "memory_safety: TreeView composite list fromValue - pool exhaustion leaves no orphan nodes" {
    const ListType = FixedListType(PoolExhaustionCheckpoint, 16, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(std.testing.allocator);
    for (0..6) |i| try list.append(std.testing.allocator, .{ .epoch = @intCast(i), .root = [_]u8{@intCast(i)} ** 32 });

    var saw_exhaustion = false;
    // Adding one slot per attempt moves the failure through element construction and then the
    // list parents.
    for (0..64) |pool_size| {
        var pool = try Node.Pool.init(.{
            .page_allocator = std.testing.allocator,
            .allocator = std.testing.allocator,
            .pool_size = @intCast(pool_size),
        });
        defer pool.deinit();

        const baseline = pool.getNodesInUse();
        const root = ListType.tree.fromValue(&pool, &list) catch |err| switch (err) {
            error.PoolExhausted => {
                saw_exhaustion = true;
                try std.testing.expectEqual(baseline, pool.getNodesInUse());
                continue;
            },
            else => return err,
        };
        pool.unref(root);
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
        try std.testing.expect(saw_exhaustion);
        return;
    }
    return error.TestUnexpectedResult;
}

test "memory_safety: TreeView composite list deserializeFromBytes - pool exhaustion leaves no orphan nodes" {
    const ListType = FixedListType(PoolExhaustionCheckpoint, 16, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(std.testing.allocator);
    for (0..6) |i| try list.append(std.testing.allocator, .{ .epoch = @intCast(i), .root = [_]u8{@intCast(i)} ** 32 });

    const bytes = try std.testing.allocator.alloc(u8, ListType.serializedSize(&list));
    defer std.testing.allocator.free(bytes);
    _ = ListType.serializeIntoBytes(&list, bytes);

    var saw_exhaustion = false;
    // Adding one slot per attempt moves the failure through element parsing and then the list
    // parents.
    for (0..64) |pool_size| {
        var pool = try Node.Pool.init(.{
            .page_allocator = std.testing.allocator,
            .allocator = std.testing.allocator,
            .pool_size = @intCast(pool_size),
        });
        defer pool.deinit();

        const baseline = pool.getNodesInUse();
        const root = ListType.tree.deserializeFromBytes(&pool, bytes) catch |err| switch (err) {
            error.PoolExhausted => {
                saw_exhaustion = true;
                try std.testing.expectEqual(baseline, pool.getNodesInUse());
                continue;
            },
            else => return err,
        };
        pool.unref(root);
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
        try std.testing.expect(saw_exhaustion);
        return;
    }
    return error.TestUnexpectedResult;
}

test "memory_safety: TreeView composite list deserializeFromBytes - malformed input errors without leaking" {
    const ListType = FixedListType(PoolExhaustionCheckpoint, 16, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(std.testing.allocator);
    for (0..6) |i| try list.append(std.testing.allocator, .{ .epoch = @intCast(i), .root = [_]u8{@intCast(i)} ** 32 });

    const bytes = try std.testing.allocator.alloc(u8, ListType.serializedSize(&list));
    defer std.testing.allocator.free(bytes);
    _ = ListType.serializeIntoBytes(&list, bytes);

    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 512 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();

    // Every truncated prefix must either parse cleanly (a shorter valid list) or error, and
    // never leak pool nodes either way.
    var len: usize = 0;
    while (len <= bytes.len) : (len += 1) {
        const root = ListType.tree.deserializeFromBytes(&pool, bytes[0..len]) catch {
            try std.testing.expectEqual(baseline, pool.getNodesInUse());
            continue;
        };
        pool.unref(root);
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
    }
}
