//! Tests for `bit_vector.zig`.

const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const BitVectorType = @import("../type/bit_vector.zig").BitVectorType;

test "BitVectorTreeView get/set roundtrip" {
    const allocator = std.testing.allocator;
    const Bits = BitVectorType(44);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 2048 });
    defer pool.deinit();

    var expected: Bits.Type = Bits.default_value;
    try expected.set(1, true);
    try expected.set(7, true);
    try expected.set(31, true);
    try expected.set(Bits.length - 1, true);

    const root = try Bits.tree.fromValue(&pool, &expected);
    var view = try Bits.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    for (0..Bits.length) |i| {
        try std.testing.expectEqual(try expected.get(i), try view.get(i));
    }

    try view.set(0, true);
    try view.set(7, false);
    try view.set(12, true);

    try expected.set(0, true);
    try expected.set(7, false);
    try expected.set(12, true);

    var expected_root: [32]u8 = undefined;
    var view_root: [32]u8 = undefined;
    try Bits.hashTreeRoot(&expected, &expected_root);
    try view.hashTreeRoot(&view_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &view_root);
}

test "BitVectorTreeView clone(false) does not transfer cache" {
    const allocator = std.testing.allocator;
    const Bits = BitVectorType(44);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 2048 });
    defer pool.deinit();

    var value: Bits.Type = Bits.default_value;
    try value.set(1, true);
    try value.set(7, true);
    try value.set(31, true);

    const root = try Bits.tree.fromValue(&pool, &value);
    var view = try Bits.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    _ = try view.get(0);
    try std.testing.expect(view.data.state.children_nodes.count() > 0);

    var cloned_no_cache = try view.clone(.{ .transfer_cache = false });
    defer cloned_no_cache.deinit();

    try std.testing.expect(view.data.state.children_nodes.count() > 0);
    try std.testing.expectEqual(@as(usize, 0), cloned_no_cache.data.state.children_nodes.count());
}

test "BitVectorTreeView clone(true) transfers cache and clears source" {
    const allocator = std.testing.allocator;
    const Bits = BitVectorType(44);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 2048 });
    defer pool.deinit();

    var value: Bits.Type = Bits.default_value;
    try value.set(1, true);
    try value.set(7, true);
    try value.set(31, true);

    const root = try Bits.tree.fromValue(&pool, &value);
    var view = try Bits.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    _ = try view.get(0);
    try std.testing.expect(view.data.state.children_nodes.count() > 0);

    var cloned = try view.clone(.{});
    defer cloned.deinit();

    try std.testing.expectEqual(@as(usize, 0), view.data.state.children_nodes.count());
    try std.testing.expect(cloned.data.state.children_nodes.count() > 0);
}

test "BitVectorTreeView clone isolates updates" {
    const allocator = std.testing.allocator;
    const Bits = BitVectorType(44);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 2048 });
    defer pool.deinit();

    const root = try Bits.tree.fromValue(&pool, &Bits.default_value);
    var v1 = try Bits.TreeView.init(allocator, &pool, root);
    defer v1.deinit();

    var v2 = try v1.clone(.{});
    defer v2.deinit();

    try v2.set(0, true);
    try v2.commit();

    try std.testing.expect(!try v1.get(0));
    try std.testing.expect(try v2.get(0));
}

test "BitVectorTreeView clone reads committed state" {
    const allocator = std.testing.allocator;
    const Bits = BitVectorType(44);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 2048 });
    defer pool.deinit();

    const root = try Bits.tree.fromValue(&pool, &Bits.default_value);
    var v1 = try Bits.TreeView.init(allocator, &pool, root);
    defer v1.deinit();

    try v1.set(1, true);
    try v1.commit();

    var v2 = try v1.clone(.{});
    defer v2.deinit();

    try std.testing.expect(try v2.get(1));
}

test "BitVectorTreeView clone drops uncommitted changes" {
    const allocator = std.testing.allocator;
    const Bits = BitVectorType(44);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 2048 });
    defer pool.deinit();

    const root = try Bits.tree.fromValue(&pool, &Bits.default_value);
    var v = try Bits.TreeView.init(allocator, &pool, root);
    defer v.deinit();

    try v.set(2, true);
    try std.testing.expect(try v.get(2));

    var dropped = try v.clone(.{});
    defer dropped.deinit();

    try std.testing.expect(!try v.get(2));
    try std.testing.expect(!try dropped.get(2));
}

test "BitVectorTreeView toBoolArray roundtrip" {
    const allocator = std.testing.allocator;
    const Bits = BitVectorType(16);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const expected_bools = [_]bool{ true, false, true, true, false, true, false, true, true, false, true, true, false, false, true, false };
    const value = try Bits.Type.fromBoolArray(expected_bools);

    const root = try Bits.tree.fromValue(&pool, &value);
    var view = try Bits.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    const actual_bools = try view.toBoolArray(allocator);
    defer allocator.free(actual_bools);
    try std.testing.expectEqualSlices(bool, &expected_bools, actual_bools);
}

test "BitVectorTreeView toBoolArrayInto roundtrip" {
    const allocator = std.testing.allocator;
    const Bits = BitVectorType(12);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const expected_bools = [_]bool{ true, false, true, true, false, true, false, true, true, false, true, true };
    const value = try Bits.Type.fromBoolArray(expected_bools);

    const root = try Bits.tree.fromValue(&pool, &value);
    var view = try Bits.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    var out: [Bits.length]bool = undefined;
    try view.toBoolArrayInto(&out);
    try std.testing.expectEqualSlices(bool, &expected_bools, &out);
}

test "BitVectorTreeView set reflects in toBoolArray" {
    const allocator = std.testing.allocator;
    const Bits = BitVectorType(8);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const initial_bools = [_]bool{ false, false, false, false, false, false, false, false };
    const value = try Bits.Type.fromBoolArray(initial_bools);

    const root = try Bits.tree.fromValue(&pool, &value);
    var view = try Bits.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    try view.set(0, true);
    try view.set(3, true);
    try view.set(7, true);

    const expected_bools = [_]bool{ true, false, false, true, false, false, false, true };
    const actual_bools = try view.toBoolArray(allocator);
    defer allocator.free(actual_bools);
    try std.testing.expectEqualSlices(bool, &expected_bools, actual_bools);
}

test "BitVectorTreeView multi-chunk" {
    const allocator = std.testing.allocator;
    // 300 bits requires 2 chunks (256 bits per chunk)
    const Bits = BitVectorType(300);

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    var value: Bits.Type = Bits.default_value;
    try value.set(0, true);
    try value.set(255, true); // last bit of first chunk
    try value.set(256, true); // first bit of second chunk
    try value.set(299, true); // last bit

    const root = try Bits.tree.fromValue(&pool, &value);
    var view = try Bits.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    try std.testing.expect(try view.get(0));
    try std.testing.expect(try view.get(255));
    try std.testing.expect(try view.get(256));
    try std.testing.expect(try view.get(299));
    try std.testing.expect(!try view.get(1));
    try std.testing.expect(!try view.get(254));

    try view.set(255, false);
    try view.set(256, false);
    try view.set(128, true);
    try view.set(280, true);

    try std.testing.expect(!try view.get(255));
    try std.testing.expect(!try view.get(256));
    try std.testing.expect(try view.get(128));
    try std.testing.expect(try view.get(280));

    try value.set(255, false);
    try value.set(256, false);
    try value.set(128, true);
    try value.set(280, true);

    var expected_root: [32]u8 = undefined;
    var view_root: [32]u8 = undefined;
    try Bits.hashTreeRoot(&value, &expected_root);
    try view.hashTreeRoot(&view_root);
    try std.testing.expectEqualSlices(u8, &expected_root, &view_root);
}

test "BitVectorTreeView remainder edge cases (1 and 255)" {
    const allocator = std.testing.allocator;

    inline for ([_]usize{ 257, 511 }) |len| {
        const Bits = BitVectorType(len);

        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
        defer pool.deinit();

        var value: Bits.Type = Bits.default_value;
        try value.set(0, true);
        try value.set(255, true);
        try value.set(256, true);
        try value.set(len - 1, true);

        const root = try Bits.tree.fromValue(&pool, &value);
        var view = try Bits.TreeView.init(allocator, &pool, root);
        defer view.deinit();

        const bools = try view.toBoolArray(allocator);
        defer allocator.free(bools);
        try std.testing.expectEqual(len, bools.len);

        try std.testing.expect(bools[0]);
        try std.testing.expect(bools[255]);
        try std.testing.expect(bools[256]);
        try std.testing.expect(bools[len - 1]);

        if (len > 2) try std.testing.expect(!bools[1]);
        if (len > 258) try std.testing.expect(!bools[257]);
    }
}

test "BitVectorTreeView full-chunk edge cases (remainder=0)" {
    const allocator = std.testing.allocator;

    inline for ([_]usize{ 256, 512 }) |len| {
        const Bits = BitVectorType(len);

        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
        defer pool.deinit();

        var value: Bits.Type = Bits.default_value;
        try value.set(0, true);
        try value.set(255, true);
        if (len > 256) {
            try value.set(256, true);
            try value.set(511, true);
        }

        const root = try Bits.tree.fromValue(&pool, &value);
        var view = try Bits.TreeView.init(allocator, &pool, root);
        defer view.deinit();

        const bools = try view.toBoolArray(allocator);
        defer allocator.free(bools);
        try std.testing.expectEqual(len, bools.len);

        try std.testing.expect(bools[0]);
        try std.testing.expect(bools[255]);
        if (len > 256) {
            try std.testing.expect(bools[256]);
            try std.testing.expect(bools[511]);
        }

        if (len > 2) try std.testing.expect(!bools[1]);
        if (len > 258) try std.testing.expect(!bools[257]);
    }
}

test "memory_safety: BitVectorTreeView set should reclaim unpublished node on OOM" {
    const allocator = std.testing.allocator;
    var failing = std.testing.FailingAllocator.init(allocator, .{ .resize_fail_index = 0 });

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 128,
    });
    defer pool.deinit();

    const Bits = BitVectorType(44);
    const root = try Bits.tree.fromValue(&pool, &Bits.default_value);
    var view = try Bits.TreeView.init(failing.allocator(), &pool, root);
    defer view.deinit();

    try std.testing.expect(!try view.get(0));
    const nodes_in_use = pool.getNodesInUse();

    failing.fail_index = failing.alloc_index;
    try std.testing.expectError(error.OutOfMemory, view.set(0, true));
    failing.fail_index = std.math.maxInt(usize);

    // The failed update must not leave an extra in-use pool node.
    try std.testing.expectEqual(nodes_in_use, pool.getNodesInUse());
    try std.testing.expect(!try view.get(0));

    try view.set(0, true);
    try std.testing.expect(try view.get(0));
}
