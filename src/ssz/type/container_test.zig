//! Tests for `container.zig`.

const std = @import("std");
const test_utils = @import("test_utils.zig");
const expectEqualRootsAlloc = test_utils.expectEqualRootsAlloc;
const expectEqualSerializedAlloc = test_utils.expectEqualSerializedAlloc;
const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const Gindex = pmt.Gindex;
const UintType = @import("uint.zig").UintType;
const BoolType = @import("bool.zig").BoolType;
const ByteVectorType = @import("byte_vector.zig").ByteVectorType;
const FixedListType = @import("list.zig").FixedListType;
const FixedVectorType = @import("vector.zig").FixedVectorType;
const proof = pmt.proof;
const TypeTestCase = test_utils.TypeTestCase;
const container = @import("container.zig");
const FixedContainerType = container.FixedContainerType;
const StructContainerType = container.StructContainerType;
const VariableContainerType = container.VariableContainerType;

test "ContainerType - sanity" {
    // create a fixed container type and instance and round-trip serialize
    const Checkpoint = FixedContainerType(struct {
        slot: UintType(8),
        root: ByteVectorType(32),
    });

    var c: Checkpoint.Type = undefined;
    var c_buf: [Checkpoint.fixed_size]u8 = undefined;

    _ = Checkpoint.serializeIntoBytes(&c, &c_buf);
    var c_decoded = Checkpoint.default_value;
    try Checkpoint.deserializeFromBytes(&c_buf, &c_decoded);

    // create a variable container type and instance and round-trip serialize
    const allocator = std.testing.allocator;
    const Foo = VariableContainerType(struct {
        a: FixedListType(UintType(8), 32, .{}),
        b: FixedListType(UintType(8), 32, .{}),
        c: FixedListType(UintType(8), 32, .{}),
    });
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
    var f_decoded = Foo.default_value;
    defer Foo.deinit(allocator, &f_decoded);
    try Foo.deserializeFromBytes(allocator, f_buf, &f_decoded);
}

test "clone FixedContainerType" {
    const Checkpoint = FixedContainerType(struct {
        epoch: UintType(8),
        root: ByteVectorType(32),
    });
    const CheckpointHex = FixedContainerType(struct {
        epoch: UintType(8),
        root: ByteVectorType(32),
        root_hex: ByteVectorType(64),
    });

    var c: Checkpoint.Type = Checkpoint.default_value;

    var cloned: Checkpoint.Type = undefined;
    try Checkpoint.clone(&c, &cloned);
    try std.testing.expect(&cloned != &c);
    try std.testing.expect(Checkpoint.equals(&cloned, &c));

    // clone into a larger container
    var cloned2: CheckpointHex.Type = undefined;
    cloned2.root_hex = ByteVectorType(64).default_value;
    try Checkpoint.clone(&c, &cloned2);
    try std.testing.expect(cloned2.epoch == c.epoch);
    try std.testing.expectEqualSlices(u8, &cloned2.root, &c.root);
    try std.testing.expectEqualSlices(u8, &cloned2.root_hex, &ByteVectorType(64).default_value);
}

test "clone VariableContainerType" {
    const allocator = std.testing.allocator;
    const FieldA = FixedListType(UintType(8), 32, .{});
    const FieldB = FixedListType(UintType(8), 32, .{});
    const Foo = VariableContainerType(struct {
        a: FieldA,
        b: FieldB,
    });
    var f = Foo.default_value;
    try f.a.append(allocator, 42);
    try f.b.append(allocator, 42);
    defer Foo.deinit(allocator, &f);
    var cloned_f = Foo.default_value;
    defer Foo.deinit(allocator, &cloned_f);
    try Foo.clone(allocator, &f, &cloned_f);
    try std.testing.expect(&cloned_f != &f);

    try expectEqualRootsAlloc(Foo, allocator, f, cloned_f);
    try expectEqualSerializedAlloc(Foo, allocator, f, cloned_f);
    try std.testing.expect(Foo.equals(&cloned_f, &f));

    // clone into a larger container
    const FieldC = FixedListType(UintType(8), 32, .{});
    const Foo2 = VariableContainerType(struct {
        a: FieldA,
        b: FieldB,
        // 1 additional field
        c: FieldC,
    });
    var cloned_f2 = Foo2.default_value;
    defer Foo2.deinit(allocator, &cloned_f2);
    try Foo.cloneInto(Foo2, allocator, &f, &cloned_f2);
    try std.testing.expectEqualSlices(u8, f.a.items, cloned_f2.a.items);
    try std.testing.expectEqualSlices(u8, f.b.items, cloned_f2.b.items);
}

// Refer to https://github.com/ChainSafe/ssz/blob/f5ed0b457333749b5c3f49fa5eafa096a725f033/packages/ssz/test/unit/byType/container/valid.test.ts#L9-L64
test "FixedContainerType - serializeIntoBytes (zero)" {
    const allocator = std.testing.allocator;
    const Container = FixedContainerType(struct {
        a: UintType(64),
        b: UintType(64),
    });

    const value: Container.Type = .{ .a = 0, .b = 0 };
    const expected_serialized = [_]u8{0} ** 16;
    const expected_root = [_]u8{ 0xf5, 0xa5, 0xfd, 0x42, 0xd1, 0x6a, 0x20, 0x30, 0x27, 0x98, 0xef, 0x6e, 0xd3, 0x09, 0x97, 0x9b, 0x43, 0x00, 0x3d, 0x23, 0x20, 0xd9, 0xf0, 0xe8, 0xea, 0x98, 0x31, 0xa9, 0x27, 0x59, 0xfb, 0x4b };

    var serialized: [Container.fixed_size]u8 = undefined;
    const written = Container.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 16), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &serialized);

    var root: [32]u8 = undefined;
    try Container.hashTreeRoot(&value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const node = try Container.tree.fromValue(&pool, &value);
    var tree_serialized: [Container.fixed_size]u8 = undefined;
    const tree_written = Container.tree.serializeIntoBytes(node, &pool, &tree_serialized);
    const tree_written_val = if (@typeInfo(@TypeOf(tree_written)) == .error_union) try tree_written else tree_written;
    try std.testing.expectEqual(@as(usize, 16), tree_written_val);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &tree_serialized);
}

test "FixedContainerType - serializeIntoBytes (some value)" {
    const allocator = std.testing.allocator;
    const Container = FixedContainerType(struct {
        a: UintType(64),
        b: UintType(64),
    });

    const value: Container.Type = .{ .a = 123456, .b = 654321 };
    // 0x40e2010000000000f1fb090000000000
    const expected_serialized = [_]u8{ 0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf1, 0xfb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00 };
    const expected_root = [_]u8{ 0x53, 0xb3, 0x8a, 0xff, 0x7b, 0xf2, 0xdd, 0x1a, 0x49, 0x90, 0x3d, 0x07, 0xa3, 0x35, 0x09, 0xb9, 0x80, 0xc6, 0xac, 0xc9, 0xf2, 0x23, 0x5a, 0x45, 0xaa, 0xc3, 0x42, 0xb0, 0xa9, 0x52, 0x8c, 0x22 };

    var serialized: [Container.fixed_size]u8 = undefined;
    const written = Container.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 16), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &serialized);

    var root: [32]u8 = undefined;
    try Container.hashTreeRoot(&value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const node = try Container.tree.fromValue(&pool, &value);
    var tree_serialized: [Container.fixed_size]u8 = undefined;
    const tree_written = Container.tree.serializeIntoBytes(node, &pool, &tree_serialized);
    const tree_written_val = if (@typeInfo(@TypeOf(tree_written)) == .error_union) try tree_written else tree_written;
    try std.testing.expectEqual(@as(usize, 16), tree_written_val);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &tree_serialized);
}

test "FixedContainerType - tree.deserializeFromBytes" {
    const allocator = std.testing.allocator;
    const Container = FixedContainerType(struct {
        a: UintType(64),
        b: UintType(64),
    });

    const value: Container.Type = .{ .a = 123456, .b = 654321 };
    const expected_serialized = [_]u8{ 0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf1, 0xfb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00 };
    const expected_root = [_]u8{ 0x53, 0xb3, 0x8a, 0xff, 0x7b, 0xf2, 0xdd, 0x1a, 0x49, 0x90, 0x3d, 0x07, 0xa3, 0x35, 0x09, 0xb9, 0x80, 0xc6, 0xac, 0xc9, 0xf2, 0x23, 0x5a, 0x45, 0xaa, 0xc3, 0x42, 0xb0, 0xa9, 0x52, 0x8c, 0x22 };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();

    const node = try Container.tree.deserializeFromBytes(&pool, &expected_serialized);
    try std.testing.expectEqualSlices(u8, &expected_root, node.getRoot(&pool));

    var roundtrip: [Container.fixed_size]u8 = undefined;
    const written = Container.tree.serializeIntoBytes(node, &pool, &roundtrip);
    const written_val = if (@typeInfo(@TypeOf(written)) == .error_union) try written else written;
    try std.testing.expectEqual(@as(usize, Container.fixed_size), written_val);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &roundtrip);

    // sanity: same root as fromValue
    const node2 = try Container.tree.fromValue(&pool, &value);
    try std.testing.expectEqualSlices(u8, node2.getRoot(&pool), node.getRoot(&pool));
}

test "FixedContainerType - serializeIntoBytes (uint64 + ByteVector32)" {
    const allocator = std.testing.allocator;
    const Container = FixedContainerType(struct {
        a: UintType(64),
        b: ByteVectorType(32),
    });

    const value: Container.Type = .{ .a = 123456, .b = [_]u8{0x0a} ** 32 };
    // 0x40e20100000000000a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a
    const expected_serialized = [_]u8{ 0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00 } ++ [_]u8{0x0a} ** 32;
    const expected_root = [_]u8{ 0x97, 0xb6, 0x2a, 0xdf, 0x79, 0xc8, 0x23, 0xff, 0x07, 0xc5, 0xe7, 0xba, 0x80, 0xb9, 0x12, 0x05, 0x9f, 0x6f, 0x0f, 0x40, 0xba, 0xd5, 0xf2, 0x67, 0xd4, 0x74, 0x7b, 0x21, 0xea, 0xfb, 0x77, 0x58 };

    var serialized: [Container.fixed_size]u8 = undefined;
    const written = Container.serializeIntoBytes(&value, &serialized);
    try std.testing.expectEqual(@as(usize, 40), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &serialized);

    var root: [32]u8 = undefined;
    try Container.hashTreeRoot(&value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const node = try Container.tree.fromValue(&pool, &value);
    var tree_serialized: [Container.fixed_size]u8 = undefined;
    const tree_written = Container.tree.serializeIntoBytes(node, &pool, &tree_serialized);
    const tree_written_val = if (@typeInfo(@TypeOf(tree_written)) == .error_union) try tree_written else tree_written;
    try std.testing.expectEqual(@as(usize, 40), tree_written_val);
    try std.testing.expectEqualSlices(u8, &expected_serialized, &tree_serialized);
}

test "VariableContainerType - serializeIntoBytes (zero)" {
    const allocator = std.testing.allocator;
    const Container = VariableContainerType(struct {
        a: FixedListType(UintType(64), 128, .{}),
        b: UintType(64),
    });

    var value: Container.Type = Container.default_value;
    // a = [], b = 0
    // 0x0c0000000000000000000000
    const expected_serialized = [_]u8{ 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 };
    const expected_root = [_]u8{ 0xdc, 0x36, 0x19, 0xcb, 0xbc, 0x5e, 0xf0, 0xe0, 0xa3, 0xb3, 0x8e, 0x3c, 0xa5, 0xd3, 0x1c, 0x2b, 0x16, 0x86, 0x8e, 0xac, 0xb6, 0xe4, 0xbc, 0xf8, 0xb4, 0x51, 0x09, 0x63, 0x35, 0x43, 0x15, 0xf5 };

    const size = Container.serializedSize(&value);
    try std.testing.expectEqual(@as(usize, 12), size);
    const serialized = try allocator.alloc(u8, size);
    defer allocator.free(serialized);
    const written = Container.serializeIntoBytes(&value, serialized);
    try std.testing.expectEqual(@as(usize, 12), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, serialized);

    var root: [32]u8 = undefined;
    try Container.hashTreeRoot(allocator, &value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const node = try Container.tree.fromValue(&pool, &value);
    const tree_size = try Container.tree.serializedSize(node, &pool);
    try std.testing.expectEqual(@as(usize, 12), tree_size);
    const tree_serialized = try allocator.alloc(u8, tree_size);
    defer allocator.free(tree_serialized);
    const tree_written = try Container.tree.serializeIntoBytes(node, &pool, tree_serialized);
    try std.testing.expectEqual(@as(usize, 12), tree_written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, tree_serialized);
}

test "VariableContainerType - serializeIntoBytes (some value)" {
    const allocator = std.testing.allocator;
    const Container = VariableContainerType(struct {
        a: FixedListType(UintType(64), 128, .{}),
        b: UintType(64),
    });

    var value: Container.Type = Container.default_value;
    // a = [123456, 654321, 123456, 654321, 123456], b = 654321
    try value.a.appendSlice(allocator, &[_]u64{ 123456, 654321, 123456, 654321, 123456 });
    value.b = 654321;
    defer value.a.deinit(allocator);

    // 0x0c000000f1fb09000000000040e2010000000000f1fb09000000000040e2010000000000f1fb09000000000040e2010000000000
    const expected_serialized = [_]u8{
        0x0c, 0x00, 0x00, 0x00, // offset to a (12)
        0xf1, 0xfb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, // b = 654321
        0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // a[0] = 123456
        0xf1, 0xfb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, // a[1] = 654321
        0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // a[2] = 123456
        0xf1, 0xfb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, // a[3] = 654321
        0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // a[4] = 123456
    };
    const expected_root = [_]u8{ 0x5f, 0xf1, 0xb9, 0x2b, 0x2f, 0xa5, 0x5e, 0xea, 0x1a, 0x14, 0xb2, 0x65, 0x47, 0x03, 0x5b, 0x2f, 0x54, 0x37, 0x81, 0x4b, 0x34, 0x36, 0x17, 0x22, 0x05, 0xfa, 0x7d, 0x6a, 0xf4, 0x09, 0x17, 0x48 };

    const size = Container.serializedSize(&value);
    try std.testing.expectEqual(@as(usize, 52), size);
    const serialized = try allocator.alloc(u8, size);
    defer allocator.free(serialized);
    const written = Container.serializeIntoBytes(&value, serialized);
    try std.testing.expectEqual(@as(usize, 52), written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, serialized);

    var root: [32]u8 = undefined;
    try Container.hashTreeRoot(allocator, &value, &root);
    try std.testing.expectEqualSlices(u8, &expected_root, &root);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 128 });
    defer pool.deinit();
    const node = try Container.tree.fromValue(&pool, &value);
    const tree_size = try Container.tree.serializedSize(node, &pool);
    try std.testing.expectEqual(@as(usize, 52), tree_size);
    const tree_serialized = try allocator.alloc(u8, tree_size);
    defer allocator.free(tree_serialized);
    const tree_written = try Container.tree.serializeIntoBytes(node, &pool, tree_serialized);
    try std.testing.expectEqual(@as(usize, 52), tree_written);
    try std.testing.expectEqualSlices(u8, &expected_serialized, tree_serialized);
}

test "VariableContainerType - tree.deserializeFromBytes" {
    const allocator = std.testing.allocator;
    const Container = VariableContainerType(struct {
        a: FixedListType(UintType(64), 128, .{}),
        b: UintType(64),
    });

    const serialized = [_]u8{
        0x0c, 0x00, 0x00, 0x00, // offset to a (12)
        0xf1, 0xfb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, // b = 654321
        0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // a[0] = 123456
        0xf1, 0xfb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, // a[1] = 654321
        0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // a[2] = 123456
        0xf1, 0xfb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, // a[3] = 654321
        0x40, 0xe2, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, // a[4] = 123456
    };
    const expected_root = [_]u8{ 0x5f, 0xf1, 0xb9, 0x2b, 0x2f, 0xa5, 0x5e, 0xea, 0x1a, 0x14, 0xb2, 0x65, 0x47, 0x03, 0x5b, 0x2f, 0x54, 0x37, 0x81, 0x4b, 0x34, 0x36, 0x17, 0x22, 0x05, 0xfa, 0x7d, 0x6a, 0xf4, 0x09, 0x17, 0x48 };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 128 });
    defer pool.deinit();

    const node = try Container.tree.deserializeFromBytes(&pool, &serialized);
    try std.testing.expectEqualSlices(u8, &expected_root, node.getRoot(&pool));

    const roundtrip_size = try Container.tree.serializedSize(node, &pool);
    try std.testing.expectEqual(@as(usize, serialized.len), roundtrip_size);

    const out = try allocator.alloc(u8, roundtrip_size);
    defer allocator.free(out);
    const written = try Container.tree.serializeIntoBytes(node, &pool, out);
    try std.testing.expectEqual(@as(usize, serialized.len), written);
    try std.testing.expectEqualSlices(u8, &serialized, out);
}

test "ContainerType" {
    const test_cases = [_]TypeTestCase{
        .{
            .id = "empty",
            .serializedHex = "0x00000000000000000000000000000000",
            .json =
            \\{"a":"0","b":"0"}
            ,
            .rootHex = "0xf5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b",
        },
        // refer to https://github.com/ChainSafe/ssz/blob/7f5580c2ea69f9307300ddb6010a8bc7ce2fc471/packages/ssz/test/unit/byType/container/valid.test.ts#L22
        .{
            .id = "some value",
            .serializedHex = "0x40e2010000000000f1fb090000000000",
            .json =
            \\{"a":"123456","b":"654321"}
            ,
            .rootHex = "0x53b38aff7bf2dd1a49903d07a33509b980c6acc9f2235a45aac342b0a9528c22",
        },
    };

    const allocator = std.testing.allocator;

    const Container = FixedContainerType(struct {
        a: UintType(64),
        b: UintType(64),
    });

    const TypeTest = @import("test_utils.zig").typeTest(Container);

    for (test_cases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "ContainerType with FixedListType(uint64, 128, .{}) and uint64" {
    const allocator = std.testing.allocator;

    const Container = VariableContainerType(struct {
        a: FixedListType(UintType(64), 128, .{}),
        b: UintType(64),
    });

    const TypeTest = @import("test_utils.zig").typeTest(Container);

    const test_cases = [_]TypeTestCase{
        // refer to https://github.com/ChainSafe/ssz/blob/7f5580c2ea69f9307300ddb6010a8bc7ce2fc471/packages/ssz/test/unit/byType/container/valid.test.ts#L51
        .{
            .id = "zero",
            .serializedHex = "0x0c0000000000000000000000",
            .json =
            \\{"a":[],"b":"0"}
            ,
            .rootHex = "0xdc3619cbbc5ef0e0a3b38e3ca5d31c2b16868eacb6e4bcf8b4510963354315f5",
        },
        // refer to https://github.com/ChainSafe/ssz/blob/7f5580c2ea69f9307300ddb6010a8bc7ce2fc471/packages/ssz/test/unit/byType/container/valid.test.ts#L57
        .{
            .id = "some value",
            .serializedHex = "0x0c000000f1fb09000000000040e2010000000000f1fb09000000000040e2010000000000f1fb09000000000040e2010000000000",
            .json =
            \\{"a":["123456","654321","123456","654321","123456"],"b":"654321"}
            ,
            .rootHex = "0x5ff1b92b2fa55eea1a14b26547035b2f5437814b3436172205fa7d6af4091748",
        },
    };

    for (test_cases[0..]) |*tc| {
        try TypeTest.run(allocator, tc);
    }
}

test "FixedContainerType equals" {
    const Container = FixedContainerType(struct {
        slot: UintType(64),
        root: ByteVectorType(32),
        active: BoolType(),
    });

    var a: Container.Type = undefined;
    var b: Container.Type = undefined;
    var c: Container.Type = undefined;

    a.slot = 42;
    a.root = [_]u8{1} ** 32;
    a.active = true;

    b.slot = 42;
    b.root = [_]u8{1} ** 32;
    b.active = true;

    c.slot = 43; // Different slot
    c.root = [_]u8{1} ** 32;
    c.active = true;

    try std.testing.expect(Container.equals(&a, &b));
    try std.testing.expect(!Container.equals(&a, &c));
}

test "VariableContainerType equals" {
    const allocator = std.testing.allocator;
    const Container = VariableContainerType(struct {
        list1: FixedListType(UintType(8), 32, .{}),
        list2: FixedListType(UintType(8), 32, .{}),
        value: UintType(64),
    });

    var a: Container.Type = undefined;
    var b: Container.Type = undefined;
    var c: Container.Type = undefined;

    a.list1 = FixedListType(UintType(8), 32, .{}).Type.empty;
    a.list2 = FixedListType(UintType(8), 32, .{}).Type.empty;
    a.value = 100;

    b.list1 = FixedListType(UintType(8), 32, .{}).Type.empty;
    b.list2 = FixedListType(UintType(8), 32, .{}).Type.empty;
    b.value = 100;

    c.list1 = FixedListType(UintType(8), 32, .{}).Type.empty;
    c.list2 = FixedListType(UintType(8), 32, .{}).Type.empty;
    c.value = 101; // Different value

    defer a.list1.deinit(allocator);
    defer a.list2.deinit(allocator);
    defer b.list1.deinit(allocator);
    defer b.list2.deinit(allocator);
    defer c.list1.deinit(allocator);
    defer c.list2.deinit(allocator);

    try a.list1.appendSlice(allocator, &[_]u8{ 1, 2, 3 });
    try a.list2.appendSlice(allocator, &[_]u8{ 4, 5, 6 });

    try b.list1.appendSlice(allocator, &[_]u8{ 1, 2, 3 });
    try b.list2.appendSlice(allocator, &[_]u8{ 4, 5, 6 });

    try c.list1.appendSlice(allocator, &[_]u8{ 1, 2, 3 });
    try c.list2.appendSlice(allocator, &[_]u8{ 4, 5, 6 });

    try std.testing.expect(Container.equals(&a, &b));
    try std.testing.expect(!Container.equals(&a, &c));
}

test "FixedContainerType - default_root" {
    const Container = FixedContainerType(struct {
        a: UintType(64),
        b: UintType(64),
        c: UintType(16),
    });
    var expected_root: [32]u8 = undefined;

    try Container.hashTreeRoot(&Container.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &Container.default_root);

    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1024 });
    defer pool.deinit();

    const node = try Container.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &expected_root, node.getRoot(&pool));
}

test "VariableContainerType - default_root" {
    var expected_root: [32]u8 = undefined;
    const Container = VariableContainerType(struct {
        a: FixedListType(UintType(64), 128, .{}),
        b: UintType(64),
    });

    try Container.hashTreeRoot(std.testing.allocator, &Container.default_value, &expected_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &Container.default_root);

    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1024 });
    defer pool.deinit();

    const node = try Container.tree.default(&pool);
    try std.testing.expectEqualSlices(u8, &expected_root, node.getRoot(&pool));
}

// StructContainerType makes the root a `.container_struct` opaque, and
// FixedVectorType(.{.chunked_leaf=true}) builds the field from `.chunked_leaf`
// nodes. A single-proof path descending through the chunked vector crosses
// both opaque kinds — proof traversal materializes each in turn.
test "createSingleProof through StructContainer with chunked_leaf vector field" {
    const allocator = std.testing.allocator;
    const Vec = FixedVectorType(UintType(64), 4096, .{ .chunked_leaf = true });
    const Outer = StructContainerType(struct {
        vec: Vec,
        tag: UintType(64),
    });

    var value: Outer.Type = .{
        .vec = Vec.default_value,
        .tag = 0x1234_5678_9abc_def0,
    };
    for (0..16) |i| value.vec[i] = (@as(u64, @intCast(i)) + 1) *% 0x0101_0101_0101_0101;

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 8192,
    });
    defer pool.deinit();

    const root = try Outer.tree.fromValue(&pool, &value);
    defer pool.unref(root);

    // gindex 2048 = outer.vec field (gindex 2 of the materialized container)
    // → chunk 0 of the chunked vector (relative gindex 1024 in its 1024-chunk
    // subtree). Traversal crosses the container_struct root and the
    // chunked_leaf node(s) of the vec field — the nested-opaque case
    // single-proof traversal must handle.
    const gindex = Gindex.fromUint(2048);

    var single_proof = try proof.createSingleProof(allocator, &pool, root, gindex);
    defer single_proof.deinit(allocator);

    var pool2 = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 256,
    });
    defer pool2.deinit();

    const rebuilt = try proof.createNodeFromSingleProof(&pool2, gindex, single_proof.leaf, single_proof.witnesses);
    defer pool2.unref(rebuilt);

    const original = root.getRoot(&pool).*;
    const rebuilt_root = rebuilt.getRoot(&pool2).*;
    try std.testing.expectEqualSlices(u8, &original, &rebuilt_root);
}

// A 1-field StructContainerType has `chunk_depth = 0`, so its `toTree`
// returns the single field's tree directly with no enclosing branch. The
// vector below is sized to exactly one chunked_leaf, so materializing the
// container hands back another opaque node — `materializeIfOpaque` must
// keep materializing until the result is navigable.
test "createSingleProof through single-field StructContainer with chunked_leaf vector" {
    const allocator = std.testing.allocator;
    const ChunkedLeaf = pmt.ChunkedLeaf;
    // Exactly K chunks (4 u64 per chunk) → the vector is one chunked_leaf.
    const Vec = FixedVectorType(UintType(64), ChunkedLeaf.K * 4, .{ .chunked_leaf = true });
    const Outer = StructContainerType(struct {
        only: Vec,
    });

    var value: Outer.Type = .{ .only = Vec.default_value };
    for (0..8) |i| value.only[i] = (@as(u64, @intCast(i)) +% 1) *% 0x7777_7777_7777_7777;

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 8192,
    });
    defer pool.deinit();

    const root = try Outer.tree.fromValue(&pool, &value);
    defer pool.unref(root);

    // Single field → the container's tree at gindex 1 IS the field's tree;
    // the K-chunk vector puts chunk 0 at gindex 1<<k_log2. Traversal crosses
    // the container_struct, then the chunked_leaf, in back-to-back
    // materializations.
    const gindex = Gindex.fromDepth(ChunkedLeaf.k_log2, 0);

    var single_proof = try proof.createSingleProof(allocator, &pool, root, gindex);
    defer single_proof.deinit(allocator);

    var pool2 = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 256,
    });
    defer pool2.deinit();

    const rebuilt = try proof.createNodeFromSingleProof(&pool2, gindex, single_proof.leaf, single_proof.witnesses);
    defer pool2.unref(rebuilt);

    const original = root.getRoot(&pool).*;
    const rebuilt_root = rebuilt.getRoot(&pool2).*;
    try std.testing.expectEqualSlices(u8, &original, &rebuilt_root);
}
