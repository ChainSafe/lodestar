const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const ssz = @import("../type/root.zig");
const allocator = std.testing.allocator;

test "ProgressiveBitListTreeView should match value roots across subtree boundaries" {
    const ST = ssz.ProgressiveBitListType(.{});
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    {
        var expected = ST.default_value;
        defer ST.deinit(allocator, &expected);
        try expected.resize(allocator, 5500);
        const view = try ST.TreeView.fromValue(allocator, &pool, &expected);
        defer view.deinit();
        for ([_]usize{ 0, 7, 8, 255, 256, 1279, 1280, 5375, 5376, 5499 }) |i| {
            try view.set(i, true);
            try expected.set(allocator, i, true);
        }
        var root: [32]u8 = undefined;
        try ST.hashTreeRoot(allocator, &expected, &root);
        try std.testing.expectEqualSlices(u8, &root, try view.hashTreeRoot());
        const copy = try view.clone(.{});
        defer copy.deinit();
        try copy.set(0, false);
        try std.testing.expect(try view.get(0));
        const transferred = try copy.clone(.{ .transfer_cache = true });
        defer transferred.deinit();
        try std.testing.expect(try copy.get(0));
        try std.testing.expect(try transferred.get(0));
        const bytes = try allocator.alloc(u8, try view.serializedSize());
        defer allocator.free(bytes);
        _ = try view.serializeIntoBytes(bytes);
        const decoded = try ST.TreeView.deserialize(allocator, &pool, bytes);
        defer decoded.deinit();
        try std.testing.expectEqualSlices(u8, &root, try decoded.hashTreeRoot());
        try std.testing.expectError(error.IndexOutOfBounds, view.set(5500, true));
        try std.testing.expectError(error.IndexOutOfBounds, view.get(5500));
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}

test "memory_safety: ProgressiveBitListTreeView should release cached values and keep the old root on OOM" {
    try std.testing.checkAllAllocationFailures(allocator, struct {
        fn run(alloc: std.mem.Allocator) !void {
            const ST = ssz.ProgressiveBitListType(.{});
            var pool = try Node.Pool.init(.{ .allocator = alloc, .page_allocator = allocator, .pool_size = 128 });
            defer pool.deinit();
            const baseline = pool.getNodesInUse();
            defer std.debug.assert(pool.getNodesInUse() == baseline);
            var value = ST.default_value;
            defer ST.deinit(alloc, &value);
            try value.resize(alloc, 300);
            const view = try ST.TreeView.fromValue(alloc, &pool, &value);
            defer view.deinit();
            try view.set(299, true);
            const old_root = view.getRoot();
            view.commit() catch |err| {
                try std.testing.expectEqual(old_root, view.getRoot());
                return err;
            };
            const clone = try view.clone(.{ .transfer_cache = true });
            defer clone.deinit();
            try std.testing.expect(try clone.get(299));
        }
    }.run, .{});
}
