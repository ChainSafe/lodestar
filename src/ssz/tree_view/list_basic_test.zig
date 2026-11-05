//! Tests for `list_basic.zig`.

const std = @import("std");
const ArmOnSizeAllocator = @import("testing_allocators").ArmOnSizeAllocator;
const hashing = @import("hashing");
const Depth = hashing.Depth;
const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const Gindex = pmt.Gindex;
const proof = pmt.proof;
const UintType = @import("../type/uint.zig").UintType;
const FixedListType = @import("../type/list.zig").FixedListType;

// Aliased rather than named `ChunkedLeaf` to avoid shadowing the same-named
// binding inside `ListBasicTreeView`.
const ChunkedLeafType = pmt.ChunkedLeaf;

// Build a list root manually with chunked_leaf 0 real and chunked_leaf 1 forced to a
// zero sentinel; length spans into chunked_leaf 1. Used to exercise defensive
// `.zero` branches in iteratorReadonly and sliceTo that aren't reachable via
// `fromValue` / `push` (those materialize on first write).
fn buildChunkedLeafListWithZeroBoundary(
    pool: *Node.Pool,
    cl0_chunks: *align(64) const [ChunkedLeafType.K][32]u8,
    list_length: usize,
    chunked_leaf_subtree_depth: Depth,
) !Node.Id {
    const cl0_id = try pool.createChunkedLeaf(cl0_chunks, ChunkedLeafType.K);

    // Build chunks subtree: only append chunked_leaf 0; finish() pads remaining
    // positions at chunked_leaf level with ZeroHash[k_log2] sentinels.
    var fc_it = Node.SubtreeBuilder.initWithOffset(pool, chunked_leaf_subtree_depth, ChunkedLeafType.k_log2);
    errdefer fc_it.deinit();
    try fc_it.append(cl0_id);
    const chunks_root = try fc_it.finish();
    errdefer pool.unref(chunks_root);

    // Mix in length: list_root = hash(chunks_root, length_leaf).
    const length_leaf = try pool.createLeafFromUint(@intCast(list_length));
    errdefer pool.unref(length_leaf);

    var list_it = Node.SubtreeBuilder.init(pool, 1);
    errdefer list_it.deinit();
    try list_it.append(chunks_root);
    try list_it.append(length_leaf);
    return try list_it.finish();
}

test "TreeView list element roundtrip" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();

    const Uint32 = UintType(32);
    const ListType = FixedListType(Uint32, 16, .{});

    const base_values = [_]u32{ 5, 15, 25, 35, 45 };

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    try list.appendSlice(allocator, &base_values);

    var expected_list: ListType.Type = .empty;
    defer expected_list.deinit(allocator);
    try expected_list.appendSlice(allocator, &base_values);

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    try std.testing.expectEqual(@as(u32, 5), try view.get(0));
    try std.testing.expectEqual(@as(u32, 45), try view.get(4));

    try view.set(2, 99);
    try view.set(4, 123);

    try view.commit();

    expected_list.items[2] = 99;
    expected_list.items[4] = 123;

    var expected_root: [32]u8 = undefined;
    try ListType.hashTreeRoot(allocator, &expected_list, &expected_root);

    var actual_root: [32]u8 = undefined;
    try view.hashTreeRootInto(&actual_root);

    try std.testing.expectEqualSlices(u8, &expected_root, &actual_root);

    var roundtrip: ListType.Type = .empty;
    defer roundtrip.deinit(allocator);
    try ListType.tree.toValue(allocator, view.getRoot(), &pool, &roundtrip);
    try std.testing.expectEqual(roundtrip.items.len, expected_list.items.len);
    try std.testing.expectEqualSlices(u32, expected_list.items, roundtrip.items);
}

test "TreeView list push updates cached length" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();

    const Uint32 = UintType(32);
    const ListType = FixedListType(Uint32, 16, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    try list.appendSlice(allocator, &[_]u32{ 1, 2, 3 });

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    try std.testing.expectEqual(@as(usize, 3), try view.length());

    try view.push(@as(u32, 55));

    try std.testing.expectEqual(@as(usize, 4), try view.length());
    try std.testing.expectEqual(@as(u32, 55), try view.get(3));

    try view.commit();

    try std.testing.expectEqual(@as(usize, 4), try view.length());

    var expected: ListType.Type = .empty;
    defer expected.deinit(allocator);
    try expected.appendSlice(allocator, &[_]u32{ 1, 2, 3, 55 });

    var expected_root: [32]u8 = undefined;
    try ListType.hashTreeRoot(allocator, &expected, &expected_root);

    var actual_root: [32]u8 = undefined;
    try view.hashTreeRootInto(&actual_root);

    try std.testing.expectEqualSlices(u8, &expected_root, &actual_root);
}

test "TreeView list getAllAlloc handles zero length" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();

    const Uint8 = UintType(8);
    const ListType = FixedListType(Uint8, 4, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    const filled = try view.getAll(null);
    defer allocator.free(filled);

    try std.testing.expectEqual(@as(usize, 0), filled.len);
}

test "TreeView list getAllAlloc spans multiple chunks" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 512 });
    defer pool.deinit();

    const Uint16 = UintType(16);
    const ListType = FixedListType(Uint16, 64, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);

    var values: [20]u16 = undefined;
    for (&values, 0..) |*val, idx| {
        val.* = @intCast((idx * 3 + 1) % 17);
    }
    try list.appendSlice(allocator, &values);

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    const filled = try view.getAll(null);
    defer allocator.free(filled);

    try std.testing.expectEqualSlices(u16, values[0..], filled);
}

test "TreeView list push batches before commit" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();

    const Uint32 = UintType(32);
    const ListType = FixedListType(Uint32, 16, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    try list.appendSlice(allocator, &[_]u32{ 1, 2, 3, 4 });

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    try view.push(@as(u32, 5));
    try view.push(@as(u32, 6));
    try view.push(@as(u32, 7));
    try view.push(@as(u32, 8));
    try view.push(@as(u32, 9));

    try std.testing.expectEqual(@as(usize, 9), try view.length());
    try std.testing.expectEqual(@as(u32, 9), try view.get(8));

    try view.commit();

    try std.testing.expectEqual(@as(usize, 9), try view.length());
    try std.testing.expectEqual(@as(u32, 9), try view.get(8));

    var expected: ListType.Type = .empty;
    defer expected.deinit(allocator);
    try expected.appendSlice(allocator, &[_]u32{ 1, 2, 3, 4, 5, 6, 7, 8, 9 });

    var expected_root: [32]u8 = undefined;
    try ListType.hashTreeRoot(allocator, &expected, &expected_root);
    var actual_root: [32]u8 = undefined;
    try view.hashTreeRootInto(&actual_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &actual_root);
}

test "TreeView list push across chunk boundary resets prefetch" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();

    const Uint32 = UintType(32);
    const ListType = FixedListType(Uint32, 32, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    try list.appendSlice(allocator, &[_]u32{ 0, 1, 2, 3, 4, 5, 6, 7 });

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    const initial = try view.getAll(null);
    defer allocator.free(initial);
    try std.testing.expectEqual(@as(usize, 8), initial.len);

    try view.push(@as(u32, 8));
    try view.push(@as(u32, 9));

    try std.testing.expectEqual(@as(usize, 10), try view.length());
    try std.testing.expectEqual(@as(u32, 9), try view.get(9));

    const filled = try view.getAll(null);
    defer allocator.free(filled);
    var expected: [10]u32 = [_]u32{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 };
    try std.testing.expectEqualSlices(u32, expected[0..], filled);
}

test "ListBasicTreeView push and growTo should enforce length bounds" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();

    const Uint32 = UintType(32);
    const ListType = FixedListType(Uint32, 2, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    try list.appendSlice(allocator, &[_]u32{ 1, 2 });

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    try std.testing.expectError(error.LengthOverLimit, view.push(@as(u32, 3)));
    try std.testing.expectError(error.InvalidLength, view.growTo(1));
    try std.testing.expectError(error.LengthOverLimit, view.growTo(ListType.limit + 1));
    try std.testing.expectEqual(@as(usize, 2), try view.length());
}

test "TreeView list basic clone isolates updates" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const Uint32 = UintType(32);
    const ListType = FixedListType(Uint32, 16, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    try list.appendSlice(allocator, &[_]u32{ 1, 2, 3 });

    const root = try ListType.tree.fromValue(&pool, &list);
    var v1 = try ListType.TreeView.init(allocator, &pool, root);
    defer v1.deinit();

    var v2 = try v1.clone(.{});
    defer v2.deinit();

    try v2.set(1, @as(u32, 99));
    try v2.commit();

    try std.testing.expectEqual(@as(u32, 2), try v1.get(1));
    try std.testing.expectEqual(@as(u32, 99), try v2.get(1));
}

test "TreeView list basic clone reads committed state" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const Uint32 = UintType(32);
    const ListType = FixedListType(Uint32, 16, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    try list.appendSlice(allocator, &[_]u32{ 1, 2, 3 });

    const root = try ListType.tree.fromValue(&pool, &list);
    var v1 = try ListType.TreeView.init(allocator, &pool, root);
    defer v1.deinit();

    try v1.set(0, @as(u32, 7));
    try v1.commit();

    var v2 = try v1.clone(.{});
    defer v2.deinit();

    try std.testing.expectEqual(@as(u32, 7), try v2.get(0));
}

test "TreeView list basic clone drops uncommitted changes" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const Uint32 = UintType(32);
    const ListType = FixedListType(Uint32, 16, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    try list.appendSlice(allocator, &[_]u32{ 1, 2, 3 });

    const root = try ListType.tree.fromValue(&pool, &list);
    var v = try ListType.TreeView.init(allocator, &pool, root);
    defer v.deinit();

    try v.set(0, @as(u32, 7));
    try std.testing.expectEqual(@as(u32, 7), try v.get(0));

    var dropped = try v.clone(.{});
    defer dropped.deinit();

    try std.testing.expectEqual(@as(u32, 1), try v.get(0));
    try std.testing.expectEqual(@as(u32, 1), try dropped.get(0));
}

test "TreeView list basic clone(false) does not transfer cache" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();

    const Uint32 = UintType(32);
    const ListType = FixedListType(Uint32, 16, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    try list.appendSlice(allocator, &[_]u32{ 1, 2, 3 });

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    _ = try view.get(0);
    try std.testing.expect(view.chunks.state.children_nodes.count() > 0);

    var cloned_no_cache = try view.clone(.{ .transfer_cache = false });
    defer cloned_no_cache.deinit();

    try std.testing.expect(view.chunks.state.children_nodes.count() > 0);
    try std.testing.expectEqual(@as(usize, 0), cloned_no_cache.chunks.state.children_nodes.count());
}

test "TreeView list basic clone(true) transfers cache and clears source" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();

    const Uint32 = UintType(32);
    const ListType = FixedListType(Uint32, 16, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    try list.appendSlice(allocator, &[_]u32{ 1, 2, 3 });

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    _ = try view.get(0);
    try std.testing.expect(view.chunks.state.children_nodes.count() > 0);

    var cloned = try view.clone(.{});
    defer cloned.deinit();

    try std.testing.expectEqual(@as(usize, 0), view.chunks.state.children_nodes.count());
    try std.testing.expect(cloned.chunks.state.children_nodes.count() > 0);
}

test "TreeView list basic clone(transfer_cache) drops an uncommitted push without _len skew" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();

    const ListType = FixedListType(UintType(32), 16, .{});
    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    for (0..4) |i| try list.append(allocator, @as(u32, @intCast(i + 1)));

    const root = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    try view.push(@as(u32, 99));

    var cloned = try view.clone(.{});
    defer cloned.deinit();
    try cloned.commit();

    var roundtrip: ListType.Type = .empty;
    defer roundtrip.deinit(allocator);
    try ListType.tree.toValue(allocator, cloned.getRoot(), &pool, &roundtrip);
    try std.testing.expectEqual(@as(usize, 4), roundtrip.items.len);
}

// Refer to https://github.com/ChainSafe/ssz/blob/7f5580c2ea69f9307300ddb6010a8bc7ce2fc471/packages/ssz/test/unit/byType/listBasic/tree.test.ts#L180-L203
test "TreeView basic list getAll reflects pushes" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();

    const list_limit = 32;
    const Uint64 = UintType(64);
    const ListType = FixedListType(Uint64, list_limit, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    var expected: [list_limit]u64 = undefined;
    for (&expected, 0..) |*slot, idx| {
        slot.* = @intCast(idx);
    }

    for (expected, 0..) |value, idx| {
        try view.push(value);
        try std.testing.expectEqual(value, try view.get(idx));
    }

    try std.testing.expectError(error.LengthOverLimit, view.push(@intCast(list_limit)));

    for (expected, 0..) |value, idx| {
        try std.testing.expectEqual(value, try view.get(idx));
    }

    try view.commit();
    const filled = try view.getAll(null);
    defer allocator.free(filled);
    try std.testing.expectEqualSlices(u64, expected[0..], filled);
}

test "TreeView list sliceTo returns original when truncation unnecessary" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();

    const Uint32 = UintType(32);
    const ListType = FixedListType(Uint32, 16, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    try list.appendSlice(allocator, &[_]u32{ 4, 5, 6, 7 });

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    try view.commit();

    var sliced = try view.sliceTo(100);
    defer sliced.deinit();

    try std.testing.expectEqual(try view.length(), try sliced.length());

    var expected_root: [32]u8 = undefined;
    try ListType.hashTreeRoot(allocator, &list, &expected_root);

    var actual_root: [32]u8 = undefined;
    try sliced.hashTreeRootInto(&actual_root);

    try std.testing.expectEqualSlices(u8, &expected_root, &actual_root);
}

// Refer to https://github.com/ChainSafe/ssz/blob/7f5580c2ea69f9307300ddb6010a8bc7ce2fc471/packages/ssz/test/unit/byType/listBasic/tree.test.ts#L219-L247
test "TreeView basic list sliceTo matches incremental snapshots" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 2048 });
    defer pool.deinit();

    const Uint64 = UintType(64);
    const ListType = FixedListType(Uint64, 1024, .{});
    const total_values: usize = 16;

    var base_values: [total_values]u64 = undefined;
    for (&base_values, 0..) |*value, idx| {
        value.* = @intCast(idx);
    }

    var empty_list: ListType.Type = .empty;
    defer empty_list.deinit(allocator);
    const root_node = try ListType.tree.fromValue(&pool, &empty_list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    for (base_values) |value| {
        try view.push(value);
    }
    try view.commit();

    for (base_values, 0..) |_, idx| {
        var sliced = try view.sliceTo(idx);
        defer sliced.deinit();

        const expected_len = idx + 1;
        try std.testing.expectEqual(expected_len, try sliced.length());

        var expected: ListType.Type = .empty;
        defer expected.deinit(allocator);
        try expected.appendSlice(allocator, base_values[0..expected_len]);

        var actual: ListType.Type = .empty;
        defer actual.deinit(allocator);
        try ListType.tree.toValue(allocator, sliced.getRoot(), &pool, &actual);

        try std.testing.expectEqual(expected_len, actual.items.len);
        try std.testing.expectEqualSlices(u64, expected.items, actual.items);

        const serialized_len = ListType.serializedSize(&expected);
        const expected_bytes = try allocator.alloc(u8, serialized_len);
        defer allocator.free(expected_bytes);
        const actual_bytes = try allocator.alloc(u8, serialized_len);
        defer allocator.free(actual_bytes);

        _ = ListType.serializeIntoBytes(&expected, expected_bytes);
        _ = ListType.serializeIntoBytes(&actual, actual_bytes);
        try std.testing.expectEqualSlices(u8, expected_bytes, actual_bytes);

        var expected_root: [32]u8 = undefined;
        try ListType.hashTreeRoot(allocator, &expected, &expected_root);

        var actual_root: [32]u8 = undefined;
        try sliced.hashTreeRootInto(&actual_root);

        try std.testing.expectEqualSlices(u8, &expected_root, &actual_root);
    }
}

test "TreeView list sliceTo truncates tail elements" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();

    const Uint32 = UintType(32);
    const ListType = FixedListType(Uint32, 32, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);

    const values = [_]u32{ 10, 20, 30, 40, 50 };
    try list.appendSlice(allocator, &values);

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    try view.commit();

    var sliced = try view.sliceTo(2);
    defer sliced.deinit();

    try std.testing.expectEqual(@as(usize, 3), try sliced.length());

    const filled = try sliced.getAll(null);
    defer allocator.free(filled);

    try std.testing.expectEqualSlices(u32, values[0..3], filled);

    var expected: ListType.Type = .empty;
    defer expected.deinit(allocator);
    try expected.appendSlice(allocator, values[0..3]);

    var expected_root: [32]u8 = undefined;
    try ListType.hashTreeRoot(allocator, &expected, &expected_root);

    var actual_root: [32]u8 = undefined;
    try sliced.hashTreeRootInto(&actual_root);

    try std.testing.expectEqualSlices(u8, &expected_root, &actual_root);
}

// Tests ported from TypeScript ssz packages/ssz/test/unit/byType/listBasic/tree.test.ts
test "ListBasicTreeView - serialize (uint8 list)" {
    const allocator = std.testing.allocator;

    const Uint8 = UintType(8);
    const ListU8Type = FixedListType(Uint8, 128, .{});

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const TestCase = struct {
        id: []const u8,
        values: []const u8,
        expected_serialized: []const u8,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty",
            .values = &[_]u8{},
            .expected_serialized = &[_]u8{},
            .expected_root = [_]u8{ 0x28, 0xba, 0x18, 0x34, 0xa3, 0xa7, 0xb6, 0x57, 0x46, 0x0c, 0xe7, 0x9f, 0xa3, 0xa1, 0xd9, 0x09, 0xab, 0x88, 0x28, 0xfd, 0x55, 0x76, 0x59, 0xd4, 0xd0, 0x55, 0x4a, 0x9b, 0xdb, 0xc0, 0xec, 0x30 },
        },
        .{
            .id = "4 values",
            .values = &[_]u8{ 1, 2, 3, 4 },
            .expected_serialized = &[_]u8{ 0x01, 0x02, 0x03, 0x04 },
            .expected_root = [_]u8{ 0xba, 0xc5, 0x11, 0xd1, 0xf6, 0x41, 0xd6, 0xb8, 0x82, 0x32, 0x00, 0xbb, 0x4b, 0x3c, 0xce, 0xd3, 0xbd, 0x47, 0x20, 0x70, 0x1f, 0x18, 0x57, 0x1d, 0xff, 0x35, 0xa5, 0xd2, 0xa4, 0x01, 0x90, 0xfa },
        },
    };

    for (test_cases) |tc| {
        var value: ListU8Type.Type = ListU8Type.default_value;
        defer value.deinit(allocator);
        for (tc.values) |v| {
            try value.append(allocator, v);
        }

        const value_serialized = try allocator.alloc(u8, ListU8Type.serializedSize(&value));
        defer allocator.free(value_serialized);
        _ = ListU8Type.serializeIntoBytes(&value, value_serialized);

        const tree_node = try ListU8Type.tree.fromValue(&pool, &value);
        var view = try ListU8Type.TreeView.init(allocator, &pool, tree_node);
        defer view.deinit();

        const view_size = try view.serializedSize();
        const view_serialized = try allocator.alloc(u8, view_size);
        defer allocator.free(view_serialized);
        const written = try view.serializeIntoBytes(view_serialized);
        try std.testing.expectEqual(view_size, written);

        try std.testing.expectEqualSlices(u8, tc.expected_serialized, view_serialized);
        try std.testing.expectEqualSlices(u8, value_serialized, view_serialized);

        try std.testing.expectEqual(tc.expected_serialized.len, view_size);

        var hash_root: [32]u8 = undefined;
        try view.hashTreeRootInto(&hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "ListBasicTreeView - serialize (uint64 list)" {
    const allocator = std.testing.allocator;

    const Uint64 = UintType(64);
    const ListU64Type = FixedListType(Uint64, 128, .{});

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const TestCase = struct {
        id: []const u8,
        values: []const u64,
        expected_serialized: []const u8,
        expected_root: [32]u8,
    };

    const test_cases = [_]TestCase{
        .{
            .id = "empty",
            .values = &[_]u64{},
            .expected_serialized = &[_]u8{},
            .expected_root = [_]u8{ 0x52, 0xe2, 0x64, 0x7a, 0xbc, 0x3d, 0x0c, 0x9d, 0x3b, 0xe0, 0x38, 0x7f, 0x3f, 0x0d, 0x92, 0x54, 0x22, 0xc7, 0xa4, 0xe9, 0x8c, 0xf4, 0x48, 0x90, 0x66, 0xf0, 0xf4, 0x32, 0x81, 0xa8, 0x99, 0xf3 },
        },
        .{
            .id = "4 values",
            .values = &[_]u64{ 100000, 200000, 300000, 400000 },
            // 0xa086010000000000400d030000000000e093040000000000801a060000000000
            .expected_serialized = &[_]u8{ 0xa0, 0x86, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x0d, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0xe0, 0x93, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x1a, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00 },
            .expected_root = [_]u8{ 0xd1, 0xda, 0xef, 0x21, 0x55, 0x02, 0xb7, 0x74, 0x6e, 0x5f, 0xf3, 0xe8, 0x83, 0x3e, 0x39, 0x9c, 0xb2, 0x49, 0xab, 0x3f, 0x81, 0xd8, 0x24, 0xbe, 0x60, 0xe1, 0x74, 0xff, 0x56, 0x33, 0xc1, 0xbf },
        },
    };

    for (test_cases) |tc| {
        var value: ListU64Type.Type = ListU64Type.default_value;
        defer value.deinit(allocator);
        for (tc.values) |v| {
            try value.append(allocator, v);
        }

        const value_serialized = try allocator.alloc(u8, ListU64Type.serializedSize(&value));
        defer allocator.free(value_serialized);
        _ = ListU64Type.serializeIntoBytes(&value, value_serialized);

        const tree_node = try ListU64Type.tree.fromValue(&pool, &value);
        var view = try ListU64Type.TreeView.init(allocator, &pool, tree_node);
        defer view.deinit();

        const view_size = try view.serializedSize();
        const view_serialized = try allocator.alloc(u8, view_size);
        defer allocator.free(view_serialized);
        const written = try view.serializeIntoBytes(view_serialized);
        try std.testing.expectEqual(view_size, written);

        try std.testing.expectEqualSlices(u8, tc.expected_serialized, view_serialized);
        try std.testing.expectEqualSlices(u8, value_serialized, view_serialized);

        try std.testing.expectEqual(tc.expected_serialized.len, view_size);

        var hash_root: [32]u8 = undefined;
        try view.hashTreeRootInto(&hash_root);
        try std.testing.expectEqualSlices(u8, &tc.expected_root, &hash_root);
    }
}

test "ListBasicTreeView - push and serialize" {
    const allocator = std.testing.allocator;

    const Uint8 = UintType(8);
    const ListU8Type = FixedListType(Uint8, 128, .{});

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    var value: ListU8Type.Type = ListU8Type.default_value;
    defer value.deinit(allocator);

    const tree_node = try ListU8Type.tree.fromValue(&pool, &value);
    var view = try ListU8Type.TreeView.init(allocator, &pool, tree_node);
    defer view.deinit();

    try view.push(1);
    try view.push(2);
    try view.push(3);
    try view.push(4);

    const size = try view.serializedSize();
    const serialized = try allocator.alloc(u8, size);
    defer allocator.free(serialized);
    const written = try view.serializeIntoBytes(serialized);
    try std.testing.expectEqual(size, written);

    try std.testing.expectEqualSlices(u8, &[_]u8{ 1, 2, 3, 4 }, serialized);

    const len = try view.length();
    try std.testing.expectEqual(@as(usize, 4), len);

    var hash_root: [32]u8 = undefined;
    try view.hashTreeRootInto(&hash_root);
    const expected_root = [_]u8{ 0xba, 0xc5, 0x11, 0xd1, 0xf6, 0x41, 0xd6, 0xb8, 0x82, 0x32, 0x00, 0xbb, 0x4b, 0x3c, 0xce, 0xd3, 0xbd, 0x47, 0x20, 0x70, 0x1f, 0x18, 0x57, 0x1d, 0xff, 0x35, 0xa5, 0xd2, 0xa4, 0x01, 0x90, 0xfa };
    try std.testing.expectEqualSlices(u8, &expected_root, &hash_root);
}

test "ListBasicTreeView - sliceTo and serialize" {
    const allocator = std.testing.allocator;

    const Uint8 = UintType(8);
    const ListU8Type = FixedListType(Uint8, 128, .{});

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    var value: ListU8Type.Type = ListU8Type.default_value;
    defer value.deinit(allocator);
    try value.append(allocator, 1);
    try value.append(allocator, 2);
    try value.append(allocator, 3);
    try value.append(allocator, 4);

    const tree_node = try ListU8Type.tree.fromValue(&pool, &value);
    var view = try ListU8Type.TreeView.init(allocator, &pool, tree_node);
    defer view.deinit();

    var sliced = try view.sliceTo(1);
    defer sliced.deinit();

    const size = try sliced.serializedSize();
    const serialized = try allocator.alloc(u8, size);
    defer allocator.free(serialized);
    const written = try sliced.serializeIntoBytes(serialized);
    try std.testing.expectEqual(size, written);

    try std.testing.expectEqualSlices(u8, &[_]u8{ 1, 2 }, serialized);
    try std.testing.expectEqual(@as(usize, 2), try sliced.length());
}

test "ListBasicTreeView chunked_leaf: iteratorReadonly within first chunked_leaf" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    const item_count: usize = 100;

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    for (0..item_count) |i| try src.append(allocator, @as(u64, @intCast(i * 7 + 3)));

    const root_id = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    var it = view.iteratorReadonly(0);
    for (0..item_count) |i| {
        const got = try it.next();
        try std.testing.expectEqual(src.items[i], got);
    }
}

test "ListBasicTreeView chunked_leaf: iteratorReadonly across chunked_leaf boundary" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    // Spans several ChunkedLeaves including a partial last one. items_per_chunk=4
    // for u64; one ChunkedLeaf holds K * items_per_chunk items.
    const item_count: usize = 2 * 4096 + 17;

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    try src.ensureTotalCapacity(allocator, item_count);
    for (0..item_count) |i| try src.append(allocator, @as(u64, @intCast(i * 31 + 1)));

    const root_id = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    var it = view.iteratorReadonly(0);
    for (0..item_count) |i| {
        const got = try it.next();
        try std.testing.expectEqual(src.items[i], got);
    }
}

// Pushing across chunk boundaries must keep each ChunkedLeaf's `len` (valid
// chunk count) in sync. Root-equivalence checks cannot catch a stale `len` —
// `ChunkedLeaf.computeRoot` hashes all K chunks and ignores `len` — so this
// asserts `getChunkedLeafLen` and the trailing-zero invariant directly.
test "ListBasicTreeView chunked_leaf: push keeps ChunkedLeaf.len in sync" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    const K: usize = ChunkedLeafType.K;
    const items_per_chunk: usize = 4; // 32 / @sizeOf(u64)
    // +1 for the list's length-mixin level above the data subtree.
    const cl_depth: Depth = ListT.chunk_depth + 1 - ChunkedLeafType.k_log2;

    // Fills ChunkedLeaf 0 completely (len must be K) and ChunkedLeaf 1
    // partially (3 chunks).
    const item_count: usize = K * items_per_chunk + 2 * items_per_chunk + 3;

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    const root0 = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root0);
    defer view.deinit();

    for (0..item_count) |i| try view.push(@as(u64, @intCast(i + 1)));
    try view.commit();

    const total_chunks = (item_count + items_per_chunk - 1) / items_per_chunk;
    const chunked_leaf_count = (total_chunks + K - 1) / K;
    const zero_chunk = [_]u8{0} ** 32;

    for (0..chunked_leaf_count) |cl_idx| {
        const cl = try view.chunks.state.root.getNodeAtDepth(&pool, cl_depth, cl_idx);
        const expected_len: usize = @min(K, total_chunks - cl_idx * K);
        try std.testing.expectEqual(@as(u16, @intCast(expected_len)), try cl.getChunkedLeafLen(&pool));

        // Trailing-zero invariant: chunks at indices >= len must be zero.
        const chunks = try cl.getChunkedLeafChunks(&pool);
        for (expected_len..K) |c| {
            try std.testing.expectEqualSlices(u8, &zero_chunk, &chunks[c]);
        }
    }
}

test "ListBasicTreeView chunked_leaf: u8 element width round-trips" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(8), 1 << 20, .{ .chunked_leaf = true });
    const K: usize = ChunkedLeafType.K;
    const items_per_chunk: usize = 32;
    const cl_depth: Depth = ListT.chunk_depth + 1 - ChunkedLeafType.k_log2;

    const item_count: usize = K * items_per_chunk + 2 * items_per_chunk + 5;

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    const root0 = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root0);
    defer view.deinit();

    for (0..item_count) |i| try view.push(@as(u8, @intCast(i % 256)));
    try view.commit();

    const total_chunks = (item_count + items_per_chunk - 1) / items_per_chunk;
    const chunked_leaf_count = (total_chunks + K - 1) / K;
    const zero_chunk = [_]u8{0} ** 32;
    for (0..chunked_leaf_count) |cl_idx| {
        const cl = try view.chunks.state.root.getNodeAtDepth(&pool, cl_depth, cl_idx);
        const expected_len: usize = @min(K, total_chunks - cl_idx * K);
        try std.testing.expectEqual(@as(u16, @intCast(expected_len)), try cl.getChunkedLeafLen(&pool));
        const chunks = try cl.getChunkedLeafChunks(&pool);
        for (expected_len..K) |c| try std.testing.expectEqualSlices(u8, &zero_chunk, &chunks[c]);
    }

    var roundtrip: ListT.Type = .empty;
    defer roundtrip.deinit(allocator);
    try ListT.tree.toValue(allocator, view.getRoot(), &pool, &roundtrip);
    try std.testing.expectEqual(item_count, roundtrip.items.len);
    for (0..item_count) |i| try std.testing.expectEqual(@as(u8, @intCast(i % 256)), roundtrip.items[i]);
}

test "ListBasicTreeView chunked_leaf: iteratorReadonly with start_index mid-chunked_leaf" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    const item_count: usize = 5000;

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    try src.ensureTotalCapacity(allocator, item_count);
    for (0..item_count) |i| try src.append(allocator, @as(u64, @intCast(i * 13 + 5)));

    const root_id = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    // Start in the second ChunkedLeaf (index >= 4096) and at non-chunk boundary.
    const start: usize = 4500;
    var it = view.iteratorReadonly(start);
    for (start..item_count) |i| {
        const got = try it.next();
        try std.testing.expectEqual(src.items[i], got);
    }
}

test "ListBasicTreeView chunked_leaf: iteratorReadonly on sparsely grown list" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    // Grow from empty via push so initial chunked_leaves are zero sentinels
    // until they get materialized. After pushing N elements, only the
    // ChunkedLeaves up to ceil(N / (K * items_per_chunk)) are real.
    const item_count: usize = 6000;

    var empty: ListT.Type = .empty;
    defer empty.deinit(allocator);
    const root_id = try ListT.tree.fromValue(&pool, &empty);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    for (0..item_count) |i| {
        try view.push(@as(u64, @intCast(i + 1)));
    }
    try view.commit();

    var it = view.iteratorReadonly(0);
    for (0..item_count) |i| {
        const got = try it.next();
        try std.testing.expectEqual(@as(u64, @intCast(i + 1)), got);
    }
}

test "ListBasicTreeView chunked_leaf: sliceTo within first chunked_leaf" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    const ListTLeaf = FixedListType(UintType(64), 1 << 20, .{});

    const item_count: usize = 50;

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    for (0..item_count) |i| try src.append(allocator, @as(u64, @intCast(i + 100)));

    const root_id = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    const cut: usize = 17;
    var sliced = try view.sliceTo(cut);
    defer sliced.deinit();

    try std.testing.expectEqual(@as(usize, cut + 1), try sliced.length());

    // Element-level equality.
    for (0..cut + 1) |i| {
        try std.testing.expectEqual(src.items[i], try sliced.get(i));
    }

    // Root matches the non-chunked_leaf reference at the same length.
    var ref: ListTLeaf.Type = .empty;
    defer ref.deinit(allocator);
    try ref.appendSlice(allocator, src.items[0 .. cut + 1]);
    var expected_root: [32]u8 = undefined;
    try ListTLeaf.hashTreeRoot(allocator, &ref, &expected_root);

    var actual_root: [32]u8 = undefined;
    try sliced.hashTreeRootInto(&actual_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &actual_root);
}

test "ListBasicTreeView chunked_leaf: sliceTo at chunked_leaf boundary" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    const ListTLeaf = FixedListType(UintType(64), 1 << 20, .{});
    const item_count: usize = 2 * 4096 + 100;

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    try src.ensureTotalCapacity(allocator, item_count);
    for (0..item_count) |i| try src.append(allocator, @as(u64, @intCast(i * 11 + 7)));

    const root_id = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    // Cut at the last index of the first ChunkedLeaf (4095). Boundary
    // exercises chunked_leaf_offset = K-1 and all chunks past it are zeroed.
    const cut: usize = 4095;
    var sliced = try view.sliceTo(cut);
    defer sliced.deinit();

    try std.testing.expectEqual(@as(usize, cut + 1), try sliced.length());

    var ref: ListTLeaf.Type = .empty;
    defer ref.deinit(allocator);
    try ref.appendSlice(allocator, src.items[0 .. cut + 1]);

    var expected_root: [32]u8 = undefined;
    try ListTLeaf.hashTreeRoot(allocator, &ref, &expected_root);
    var actual_root: [32]u8 = undefined;
    try sliced.hashTreeRootInto(&actual_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &actual_root);
}

test "ListBasicTreeView chunked_leaf: sliceTo across chunked_leaf boundary" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    const ListTLeaf = FixedListType(UintType(64), 1 << 20, .{});
    const item_count: usize = 3 * 4096 + 50;

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    try src.ensureTotalCapacity(allocator, item_count);
    for (0..item_count) |i| try src.append(allocator, @as(u64, @intCast(i * 23 + 9)));

    const root_id = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    // Cut in the middle of the second ChunkedLeaf.
    const cut: usize = 4096 + 1234;
    var sliced = try view.sliceTo(cut);
    defer sliced.deinit();

    try std.testing.expectEqual(@as(usize, cut + 1), try sliced.length());

    // toValue round-trip.
    var dst: ListT.Type = .empty;
    defer dst.deinit(allocator);
    try ListT.tree.toValue(allocator, sliced.getRoot(), &pool, &dst);
    try std.testing.expectEqual(@as(usize, cut + 1), dst.items.len);
    try std.testing.expectEqualSlices(u64, src.items[0 .. cut + 1], dst.items);

    // Root matches reference.
    var ref: ListTLeaf.Type = .empty;
    defer ref.deinit(allocator);
    try ref.appendSlice(allocator, src.items[0 .. cut + 1]);
    var expected_root: [32]u8 = undefined;
    try ListTLeaf.hashTreeRoot(allocator, &ref, &expected_root);
    var actual_root: [32]u8 = undefined;
    try sliced.hashTreeRootInto(&actual_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &actual_root);
}

test "ListBasicTreeView chunked_leaf: sliceTo returns clone when index >= length-1" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    const item_count: usize = 100;

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    for (0..item_count) |i| try src.append(allocator, @as(u64, @intCast(i)));

    const root_id = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    var sliced = try view.sliceTo(item_count - 1);
    defer sliced.deinit();

    try std.testing.expectEqual(item_count, try sliced.length());
    try std.testing.expectEqualSlices(u8, view.getRoot().getRoot(&pool), sliced.getRoot().getRoot(&pool));
}

test "ListBasicTreeView chunked_leaf: iteratorReadonly handles zero-sentinel chunked_leaf" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });

    // Fill chunked_leaf 0 with deterministic non-zero u64 data: chunk i has u256 = i + 1.
    var raw: [ChunkedLeafType.K][32]u8 align(64) = undefined;
    @memset(std.mem.asBytes(&raw), 0);
    for (0..ChunkedLeafType.K) |i| {
        std.mem.writeInt(u256, &raw[i], @as(u256, @intCast(i + 1)), .little);
    }

    // length spans into chunked_leaf 1 (zero sentinel) — last 100 items live in
    // the sparse region where iteratorReadonly hits its `.zero` branch.
    const items_in_cl0: usize = ChunkedLeafType.K * 4; // 4096 (items_per_chunk = 4 for u64)
    const items_in_cl1: usize = 100;
    const item_count = items_in_cl0 + items_in_cl1;
    const chunked_leaf_subtree_depth: Depth = @intCast(ListT.chunk_depth - ChunkedLeafType.k_log2);

    const list_root = try buildChunkedLeafListWithZeroBoundary(&pool, &raw, item_count, chunked_leaf_subtree_depth);
    var view = try ListT.TreeView.init(allocator, &pool, list_root);
    defer view.deinit();

    try std.testing.expectEqual(item_count, try view.length());

    var it = view.iteratorReadonly(0);

    // First chunked_leaf: real data. Each chunk holds u256 (chunk_idx + 1) = 4
    // little-endian u64s, so item j in chunk c has value = (c+1) >> (j%4 * 64).
    for (0..items_in_cl0) |item_idx| {
        const got = try it.next();
        const chunk_idx = item_idx / 4;
        const u64_idx = item_idx % 4;
        const u256_val: u256 = @intCast(chunk_idx + 1);
        const expected: u64 = @truncate(u256_val >> @intCast(u64_idx * 64));
        try std.testing.expectEqual(expected, got);
    }

    // Crossed into chunked_leaf 1 — zero sentinel. Iterator's `.zero` branch
    // should yield zero values without dereferencing payload.
    for (0..items_in_cl1) |_| {
        const got = try it.next();
        try std.testing.expectEqual(@as(u64, 0), got);
    }
}

test "ListBasicTreeView chunked_leaf: sliceTo handles zero-sentinel boundary" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    const ListTLeaf = FixedListType(UintType(64), 1 << 20, .{});

    var raw: [ChunkedLeafType.K][32]u8 align(64) = undefined;
    @memset(std.mem.asBytes(&raw), 0);
    for (0..ChunkedLeafType.K) |i| {
        std.mem.writeInt(u256, &raw[i], @as(u256, @intCast(i * 7 + 13)), .little);
    }

    const items_in_cl0: usize = ChunkedLeafType.K * 4;
    const items_in_cl1: usize = 200;
    const item_count = items_in_cl0 + items_in_cl1;
    const chunked_leaf_subtree_depth: Depth = @intCast(ListT.chunk_depth - ChunkedLeafType.k_log2);

    const list_root = try buildChunkedLeafListWithZeroBoundary(&pool, &raw, item_count, chunked_leaf_subtree_depth);
    var view = try ListT.TreeView.init(allocator, &pool, list_root);
    defer view.deinit();

    // Cut at index 4150 — boundary chunked_leaf is the zero-sentinel chunked_leaf 1.
    const cut: usize = items_in_cl0 + 50;
    var sliced = try view.sliceTo(cut);
    defer sliced.deinit();

    try std.testing.expectEqual(@as(usize, cut + 1), try sliced.length());

    // The first 4096 items come from chunked_leaf 0 (real data); items 4096..cut
    // come from the zero sentinel (zeros).
    var ref_items = try allocator.alloc(u64, cut + 1);
    defer allocator.free(ref_items);
    for (0..items_in_cl0) |item_idx| {
        const chunk_idx = item_idx / 4;
        const u64_idx = item_idx % 4;
        const u256_val: u256 = @intCast(chunk_idx * 7 + 13);
        ref_items[item_idx] = @truncate(u256_val >> @intCast(u64_idx * 64));
    }
    @memset(ref_items[items_in_cl0..], 0);

    var ref: ListTLeaf.Type = .empty;
    defer ref.deinit(allocator);
    try ref.appendSlice(allocator, ref_items);

    var expected_root: [32]u8 = undefined;
    try ListTLeaf.hashTreeRoot(allocator, &ref, &expected_root);

    var actual_root: [32]u8 = undefined;
    try sliced.hashTreeRootInto(&actual_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &actual_root);
}

test "ListBasicTreeView chunked_leaf: getAllInto sees uncommitted set" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    const item_count: usize = 5000;

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    try src.ensureTotalCapacity(allocator, item_count);
    for (0..item_count) |i| try src.append(allocator, @as(u64, @intCast(i)));

    const root_id = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    // Stage writes spanning two chunked_leaves (boundary at 4096 for u64).
    try view.set(7, 9001);
    try view.set(4500, 9002);

    const out = try allocator.alloc(u64, item_count);
    defer allocator.free(out);
    _ = try view.getAllInto(out);

    try std.testing.expectEqual(@as(u64, 9001), out[7]);
    try std.testing.expectEqual(@as(u64, 9002), out[4500]);
    try std.testing.expectEqual(@as(u64, 6), out[6]);
    try std.testing.expectEqual(@as(u64, 4499), out[4499]);
}

test "ListBasicTreeView chunked_leaf: property test cross-commit set + push sequences" {
    // Randomized set/push/commit cycles exercising Path 1/2/3. Root
    // equivalence is blind to ChunkedLeaf.len (computeRoot hashes all K
    // chunks and ignores it), so this also asserts every ChunkedLeaf.len and
    // the trailing-zero invariant after each commit — covering the push-grow
    // path that drifts `len`.
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 16384 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    const K: usize = ChunkedLeafType.K;
    const items_per_chunk: usize = 4; // 32 / @sizeOf(u64)
    // +1 for the list length-mixin level above the data subtree.
    const cl_depth: Depth = ListT.chunk_depth + 1 - ChunkedLeafType.k_log2;
    // Grows past several ChunkedLeaves, last one partial.
    const cap: usize = 3 * K * items_per_chunk + 50;

    var prng = std.Random.DefaultPrng.init(0xCAFE_BEEF_DEAD_BABE);
    const rand = prng.random();

    var reference: std.ArrayList(u64) = .empty;
    defer reference.deinit(allocator);
    for (0..K * items_per_chunk + 7) |i| try reference.append(allocator, @as(u64, @intCast(i * 31 + 7)));

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    for (reference.items) |v| try src.append(allocator, v);

    const root_id = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    const zero_chunk = [_]u8{0} ** 32;

    for (0..20) |_| {
        const n_writes = rand.intRangeAtMost(usize, 5, 30);
        for (0..n_writes) |_| {
            if (reference.items.len < cap and rand.boolean()) {
                const val = rand.int(u64);
                try reference.append(allocator, val);
                try view.push(val);
            } else {
                const idx = rand.intRangeLessThan(usize, 0, reference.items.len);
                const val = rand.int(u64);
                reference.items[idx] = val;
                try view.set(idx, val);
            }
        }

        // Root equivalence to a freshly built reference tree.
        var ref_src: ListT.Type = .empty;
        defer ref_src.deinit(allocator);
        for (reference.items) |v| try ref_src.append(allocator, v);
        const ref_root_id = try ListT.tree.fromValue(&pool, &ref_src);
        defer pool.unref(ref_root_id);
        const view_root = (try view.hashTreeRoot()).*;
        try std.testing.expectEqualSlices(u8, ref_root_id.getRoot(&pool), &view_root);

        // Every ChunkedLeaf.len tracks the list length; chunks >= len are zero.
        const total_chunks = (reference.items.len + items_per_chunk - 1) / items_per_chunk;
        const cl_count = (total_chunks + K - 1) / K;
        for (0..cl_count) |cl_idx| {
            const cl = try view.chunks.state.root.getNodeAtDepth(&pool, cl_depth, cl_idx);
            const expected: usize = @min(K, total_chunks - cl_idx * K);
            try std.testing.expectEqual(@as(u16, @intCast(expected)), try cl.getChunkedLeafLen(&pool));
            const chunks = try cl.getChunkedLeafChunks(&pool);
            for (expected..K) |c| try std.testing.expectEqualSlices(u8, &zero_chunk, &chunks[c]);
        }

        // A single proof on the grown/mutated chunked_leaf list rebuilds to
        // the same root — exercises proof through a push-grown ChunkedLeaf.
        {
            const elem = rand.intRangeLessThan(usize, 0, reference.items.len);
            const gindex = Gindex.fromDepth(ListT.chunk_depth + 1, elem / items_per_chunk);
            var single = try proof.createSingleProof(allocator, &pool, view.chunks.state.root, gindex);
            defer single.deinit(allocator);

            var proof_pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
            defer proof_pool.deinit();
            const rebuilt = try proof.createNodeFromSingleProof(&proof_pool, gindex, single.leaf, single.witnesses);
            defer proof_pool.unref(rebuilt);
            try std.testing.expectEqualSlices(u8, &view_root, rebuilt.getRoot(&proof_pool));
        }

        // Point reads stay correct.
        for (0..16) |_| {
            const i = rand.intRangeLessThan(usize, 0, reference.items.len);
            try std.testing.expectEqual(reference.items[i], try view.get(i));
        }
    }

    const final = try allocator.alloc(u64, reference.items.len);
    defer allocator.free(final);
    _ = try view.getAllInto(final);
    try std.testing.expectEqualSlices(u64, reference.items, final);
}

test "ListBasicTreeView chunked_leaf: getAllInto sees uncommitted push" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    try src.append(allocator, 10);
    try src.append(allocator, 20);

    const root_id = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    try view.push(30);
    try view.push(40);

    const out = try allocator.alloc(u64, 4);
    defer allocator.free(out);
    _ = try view.getAllInto(out);

    try std.testing.expectEqualSlices(u64, &.{ 10, 20, 30, 40 }, out);
}

test "memory_safety: TreeView list basic clone(transfer_cache) on a dirty view leaves no orphan pool nodes" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();

    const ListType = FixedListType(UintType(32), 16, .{});
    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    for (0..4) |i| try list.append(allocator, @as(u32, @intCast(i + 1)));

    const baseline = pool.getNodesInUse();
    {
        const root = try ListType.tree.fromValue(&pool, &list);
        var view = try ListType.TreeView.init(allocator, &pool, root);
        try view.set(0, @as(u32, 42));
        var cloned = try view.clone(.{});
        cloned.deinit();
        view.deinit();
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}

// std.testing.allocator can't see pool-slot leaks, so check getNodesInUse() against a baseline.
test "memory_safety: TreeView basic list sliceTo does not leak pool nodes" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 2048 });
    defer pool.deinit();

    const Uint64 = UintType(64);
    const ListType = FixedListType(Uint64, 1024, .{});

    var empty_list: ListType.Type = .empty;
    defer empty_list.deinit(allocator);
    const root_node = try ListType.tree.fromValue(&pool, &empty_list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    for (0..16) |i| try view.push(@intCast(i));
    try view.commit();

    const baseline = pool.getNodesInUse();
    for (0..15) |idx| {
        var sliced = try view.sliceTo(idx);
        sliced.deinit();
        // Any difference means an intermediate orphan root leaked.
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
    }
}

test "memory_safety: ListBasicTreeView chunked_leaf: sliceTo doesn't leak pool nodes" {
    // sliceTo allocates transient roots via setNodeAtDepth / truncate /
    // setNode. Those calls don't consume their input root_node, so the
    // caller must unref the intermediates. The test asserts node count
    // returns to baseline after repeated sliceTo+deinit.
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });
    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    for (0..100) |i| try src.append(allocator, @as(u64, @intCast(i)));

    const root_id = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    // One warmup so any one-time lazy initialization isn't counted.
    {
        var w = try view.sliceTo(50);
        w.deinit();
    }

    const before = pool.getNodesInUse();
    for (0..50) |_| {
        var s = try view.sliceTo(50);
        s.deinit();
    }
    const after = pool.getNodesInUse();

    try std.testing.expectEqual(before, after);
}

test "memory_safety: ListBasicTreeView non-chunked_leaf: sliceTo doesn't leak pool nodes" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{});
    var src: ListT.Type = .empty;
    defer src.deinit(allocator);
    for (0..100) |i| try src.append(allocator, @as(u64, @intCast(i)));

    const root_id = try ListT.tree.fromValue(&pool, &src);
    var view = try ListT.TreeView.init(allocator, &pool, root_id);
    defer view.deinit();

    {
        var w = try view.sliceTo(50);
        w.deinit();
    }

    const before = pool.getNodesInUse();
    for (0..50) |_| {
        var s = try view.sliceTo(50);
        s.deinit();
    }
    const after = pool.getNodesInUse();

    try std.testing.expectEqual(before, after);
}

// A shared chunked_leaf needs a fresh node + 2KB blob; if setChildNode OOMs
// it must be reclaimed. Leak shows as getNodesInUse (slot) + testing.allocator (blob).
test "memory_safety: ListBasicTreeView chunked_leaf: set OOM in setChildNode reclaims the CoW chunked_leaf (no leak)" {
    const allocator = std.testing.allocator;
    var view_failing = std.testing.FailingAllocator.init(allocator, .{});
    // Arm the view allocator to OOM on the CoW blob alloc → fails setChildNode's changed.put.
    var armer = ArmOnSizeAllocator{ .backing = allocator, .target = &view_failing, .trigger_len = @sizeOf(ChunkedLeafType) };

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = armer.allocator(), .pool_size = 4096 });
    defer pool.deinit();

    const ListT = FixedListType(UintType(64), 1 << 20, .{ .chunked_leaf = true });

    var src: ListT.Type = .empty;
    defer src.deinit(allocator);

    for (0..100) |i| try src.append(allocator, @as(u64, @intCast(i)));
    const root_id = try ListT.tree.fromValue(&pool, &src);

    var view = try ListT.TreeView.init(view_failing.allocator(), &pool, root_id);
    defer view.deinit();

    const baseline = pool.getNodesInUse();

    // The first set copies the committed chunked_leaf (shared, rc>=1).
    armer.armed = true;
    try std.testing.expectError(error.OutOfMemory, view.set(0, 999));
    view_failing.fail_index = std.math.maxInt(usize); // disarm for cleanup
    armer.armed = false;

    // The freshly-CoW'd node + its 2KB blob were reclaimed, not leaked.
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}

test "ListBasicTreeView chunked_leaf: packed edits agree with plain trees for every basic type" {
    const BoolType = @import("../type/bool.zig").BoolType;
    const allocator = std.testing.allocator;
    inline for (.{ BoolType(), UintType(8), UintType(16), UintType(32), UintType(64), UintType(128), UintType(256) }) |ST| {
        const items_per_chunk = 32 / ST.fixed_size;
        const boundary = ChunkedLeafType.K * items_per_chunk;
        const ListT = FixedListType(ST, boundary * 2, .{ .chunked_leaf = true });
        const PlainList = FixedListType(ST, boundary * 2, .{});
        const nonzero: ST.Type = if (ST.Type == bool) true else std.math.maxInt(ST.Type);
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 32 });
        defer pool.deinit();

        var expected: ListT.Type = .empty;
        defer expected.deinit(allocator);
        try expected.resize(allocator, boundary + 1);
        @memset(expected.items, ST.default_value);
        expected.items[0] = nonzero;
        const view = try ListT.TreeView.fromValue(allocator, &pool, &expected);
        defer view.deinit();
        const snapshot = try view.clone(.{ .transfer_cache = false });
        defer snapshot.deinit();
        var original_hash: [32]u8 = undefined;
        try snapshot.hashTreeRootInto(&original_hash);

        for ([_]usize{ 1, items_per_chunk - 1, items_per_chunk, boundary - 1, boundary }) |index| {
            try view.set(index, nonzero);
            expected.items[index] = nonzero;
            try std.testing.expectEqual(nonzero, try view.get(index));
        }
        try view.push(nonzero);
        try expected.append(allocator, nonzero);
        var expected_hash: [32]u8 = undefined;
        try PlainList.hashTreeRoot(allocator, &expected, &expected_hash);
        var actual_hash: [32]u8 = undefined;
        try view.hashTreeRootInto(&actual_hash);
        try std.testing.expectEqualSlices(u8, &expected_hash, &actual_hash);

        try view.set(0, ST.default_value);
        expected.items[0] = ST.default_value;
        try PlainList.hashTreeRoot(allocator, &expected, &expected_hash);
        try view.hashTreeRootInto(&actual_hash);
        try std.testing.expectEqualSlices(u8, &expected_hash, &actual_hash);
        var decoded: ListT.Type = .empty;
        defer decoded.deinit(allocator);
        try view.toValue(allocator, &decoded);
        try std.testing.expectEqualSlices(ST.Type, expected.items, decoded.items);
        try snapshot.hashTreeRootInto(&actual_hash);
        try std.testing.expectEqualSlices(u8, &original_hash, &actual_hash);
        try std.testing.expectEqual(nonzero, try snapshot.get(0));
        try std.testing.expectEqual(ST.default_value, try snapshot.get(boundary));
    }
}

test "memory_safety: list_basic init only allocates the view and preserves caller ownership on OOM" {
    const allocator = std.testing.allocator;
    const ListType = FixedListType(UintType(64), 16, .{});
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 32 });
    defer pool.deinit();

    var value: ListType.Type = .empty;
    defer value.deinit(allocator);
    try value.append(allocator, 7);

    const root = try ListType.tree.fromValue(&pool, &value);
    try pool.ref(root);
    defer pool.unref(root);

    var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    try std.testing.expectError(error.OutOfMemory, ListType.TreeView.init(failing.allocator(), &pool, root));
    try std.testing.expectEqual(@as(u32, 1), root.getState(&pool).refCount());

    failing.fail_index = 1;
    {
        const view = try ListType.TreeView.init(failing.allocator(), &pool, root);
        defer view.deinit();
        try std.testing.expectEqual(@as(usize, 1), try view.length());
        try std.testing.expectEqual(@as(usize, 1), failing.alloc_index);
        try std.testing.expectEqual(@as(u32, 2), root.getState(&pool).refCount());
    }
    try std.testing.expectEqual(@as(u32, 1), root.getState(&pool).refCount());
}

test "memory_safety: failed list commit preserves unrelated reused pool slots" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4 });
    defer pool.deinit();

    const List = FixedListType(UintType(64), 8, .{});
    const view = try List.TreeView.fromValue(allocator, &pool, &.empty);
    var view_live = true;
    defer if (view_live) view.deinit();
    const original_root = view.getRoot();
    try view.push(42);
    try std.testing.expectError(error.PoolExhausted, view.commit());
    try std.testing.expectEqual(original_root, view.getRoot());

    const unrelated = try pool.createLeafFromUint(99);
    defer pool.unref(unrelated);
    view.deinit();
    view_live = false;
    try std.testing.expect(!unrelated.getState(&pool).isFree());
    try std.testing.expectEqual(@as(u64, 99), std.mem.readInt(u64, unrelated.getRoot(&pool)[0..8], .little));
}

test "memory_safety: failed list commit preserves pending edits for retry" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 6 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();

    {
        const List = FixedListType(UintType(64), 8, .{});
        const view = try List.TreeView.fromValue(allocator, &pool, &.empty);
        defer view.deinit();
        const original_root = view.getRoot();
        const blockers = [_]Node.Id{ try pool.createLeafFromUint(0), try pool.createLeafFromUint(0) };
        var blockers_live = true;
        defer if (blockers_live) for (blockers) |node| pool.unref(node);

        try view.push(42);
        try std.testing.expectError(error.PoolExhausted, view.commit());
        try std.testing.expectEqual(original_root, view.getRoot());
        try std.testing.expectEqual(@as(u64, 42), try view.get(0));
        for (blockers) |node| pool.unref(node);
        blockers_live = false;

        try view.set(0, 43);
        try view.commit();
        var value: List.Type = .empty;
        defer value.deinit(allocator);
        try view.toValue(allocator, &value);
        try std.testing.expectEqualSlices(u64, &.{43}, value.items);
        var expected_root: [32]u8 = undefined;
        try List.hashTreeRoot(allocator, &value, &expected_root);
        try std.testing.expectEqualSlices(u8, &expected_root, try view.hashTreeRoot());
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}
