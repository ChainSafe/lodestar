const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const Gindex = @import("persistent_merkle_tree").Gindex;
const UintType = @import("../type/uint.zig").UintType;
const FixedContainerType = @import("../type/container.zig").FixedContainerType;
const FixedVectorType = @import("../type/vector.zig").FixedVectorType;
const FixedListType = @import("../type/list.zig").FixedListType;

const Child = FixedContainerType(struct { value: UintType(64) });
const Vector = FixedVectorType(Child, 2, .{});

test "memory_safety: composite commit keeps cached roots when a later child fails and retries" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 7 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();

    {
        const view = try Vector.TreeView.fromValue(allocator, &pool, &.{ .{ .value = 1 }, .{ .value = 2 } });
        defer view.deinit();
        const original_root = view.getRoot();
        const first = try view.get(0);
        const second = try view.get(1);
        const first_root = first.getRoot();
        const second_root = second.getRoot();
        try first.set("value", 10);
        try second.set("value", 20);

        // Leave room for the first child, but not the second child or the parent.
        const blockers = [_]Node.Id{
            try pool.createLeafFromUint(0),
            try pool.createLeafFromUint(0),
            try pool.createLeafFromUint(0),
        };
        var blockers_live = true;
        defer if (blockers_live) for (blockers) |node| pool.unref(node);

        try std.testing.expectError(error.PoolExhausted, view.commit());
        try std.testing.expect(first_root != first.getRoot());
        try std.testing.expectEqual(second_root, second.getRoot());
        try std.testing.expectEqual(original_root, view.getRoot());
        try std.testing.expectEqual(first_root, view.chunks.state.children_nodes.get(@enumFromInt(2)).?);
        try std.testing.expectEqual(second_root, view.chunks.state.children_nodes.get(@enumFromInt(3)).?);
        try std.testing.expectEqual(@as(usize, 2), view.chunks.state.changed.count());

        for (blockers) |node| pool.unref(node);
        blockers_live = false;
        try view.commit();
        try std.testing.expectEqual(first.getRoot(), view.chunks.state.children_nodes.get(@enumFromInt(2)).?);
        try std.testing.expectEqual(second.getRoot(), view.chunks.state.children_nodes.get(@enumFromInt(3)).?);
        try std.testing.expectEqual(@as(usize, 0), view.chunks.state.changed.count());
        var value: Vector.Type = undefined;
        try view.toValue(allocator, &value);
        try std.testing.expectEqualDeep(Vector.Type{ .{ .value = 10 }, .{ .value = 20 } }, value);
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}

test "memory_safety: composite list commit preserves its pending length for retry" {
    const allocator = std.testing.allocator;
    const List = FixedListType(Child, 4, .{});
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 16 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();

    {
        const view = try List.TreeView.fromValue(allocator, &pool, &.empty);
        defer view.deinit();
        const original_root = view.getRoot();
        try view.growTo(1);
        try view.setValue(0, &.{ .value = 42 });

        // Allow the length leaf and the first group, then fail rebuilding the element path.
        var blockers: [16]Node.Id = undefined;
        var blocker_count: usize = 0;
        defer for (blockers[0..blocker_count]) |node| pool.unref(node);
        for (&blockers) |*node| {
            if (pool.getNodesInUse() == baseline + 14) break;
            node.* = try pool.createLeafFromUint(0);
            blocker_count += 1;
        }

        try std.testing.expectError(error.PoolExhausted, view.commit());
        try std.testing.expectEqual(original_root, view.getRoot());
        const pending_length = view.chunks.state.children_nodes.get(@enumFromInt(3)).?;
        try std.testing.expect(!pending_length.getState(&pool).isFree());
        try std.testing.expectEqual(@as(u32, 0), pending_length.getState(&pool).refCount());
        try std.testing.expectEqual(@as(usize, 2), view.chunks.state.changed.count());

        for (blockers[0..blocker_count]) |node| pool.unref(node);
        blocker_count = 0;
        try view.commit();
        var value: List.Type = .empty;
        defer value.deinit(allocator);
        try view.toValue(allocator, &value);
        try std.testing.expectEqual(@as(usize, 1), value.items.len);
        try std.testing.expectEqual(@as(u64, 42), value.items[0].value);
        try std.testing.expectEqual(@as(usize, 0), view.chunks.state.changed.count());
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}

test "memory_safety: composite commit allocation failures preserve cached roots and retry" {
    const allocator = std.testing.allocator;
    const Inner = FixedVectorType(UintType(64), 8, .{});
    const Outer = FixedVectorType(Inner, 2, .{});
    var saw_oom = false;
    var saw_committed_child = false;
    for (0..16) |fail_after| {
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
        defer pool.deinit();
        const baseline = pool.getNodesInUse();
        var succeeded = false;
        {
            const view = try Outer.TreeView.fromValue(failing.allocator(), &pool, &Outer.default_value);
            defer view.deinit();
            const original_root = view.getRoot();
            const first = try view.get(0);
            const second = try view.get(1);
            const original_children = [_]Node.Id{ first.getRoot(), second.getRoot() };
            try first.set(0, 10);
            try second.set(0, 20);

            failing.fail_index = failing.alloc_index + fail_after;
            if (view.commit()) |_| {
                succeeded = true;
            } else |err| {
                try std.testing.expectEqual(error.OutOfMemory, err);
                saw_oom = true;
                saw_committed_child = saw_committed_child or first.getRoot() != original_children[0];
                try std.testing.expectEqual(original_root, view.getRoot());
                for (original_children, 0..) |root, i| {
                    try std.testing.expectEqual(root, view.chunks.state.children_nodes.get(Gindex.fromDepth(1, i)).?);
                }
                try std.testing.expectEqual(@as(usize, 2), view.chunks.state.changed.count());
                failing.fail_index = std.math.maxInt(usize);
                try view.commit();
            }
            var value: Outer.Type = undefined;
            try view.toValue(allocator, &value);
            try std.testing.expectEqual(@as(u64, 10), value[0][0]);
            try std.testing.expectEqual(@as(u64, 20), value[1][0]);
        }
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
        if (succeeded) {
            try std.testing.expect(saw_oom);
            try std.testing.expect(saw_committed_child);
            return;
        }
    }
    return error.TestUnexpectedResult;
}

test "memory_safety: failed composite parent rebuild does not cache child-owned roots" {
    const allocator = std.testing.allocator;
    const Cleanup = enum { deinit, clear_cache, transfer_cache };
    for (std.enums.values(Cleanup)) |cleanup| {
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 6 });
        defer pool.deinit();
        const baseline = pool.getNodesInUse();

        {
            const view = try Vector.TreeView.fromValue(allocator, &pool, &.{ .{ .value = 1 }, .{ .value = 2 } });
            var view_live = true;
            defer if (view_live) view.deinit();
            const original_root = view.getRoot();
            const first = try view.get(0);
            const second = try view.get(1);
            try first.set("value", 10);
            try second.set("value", 20);
            const blocker = try pool.createLeafFromUint(0);
            var blocker_live = true;
            defer if (blocker_live) pool.unref(blocker);

            try std.testing.expectError(error.PoolExhausted, view.commit());
            try std.testing.expectEqual(original_root, view.getRoot());
            const discarded_root = first.getRoot();
            pool.unref(blocker);
            blocker_live = false;

            try view.setValue(0, &.{ .value = 30 });
            const unrelated = try pool.createLeafFromUint(99);
            defer if (!unrelated.getState(&pool).isFree()) pool.unref(unrelated);
            try std.testing.expectEqual(discarded_root, unrelated);

            switch (cleanup) {
                .deinit => {
                    view.deinit();
                    view_live = false;
                },
                .clear_cache => view.clearCache(),
                .transfer_cache => {
                    const clone = try view.clone(.{ .transfer_cache = true });
                    defer clone.deinit();
                    try std.testing.expectEqual(original_root, clone.getRoot());
                },
            }
            try std.testing.expect(!unrelated.getState(&pool).isFree());
            try std.testing.expectEqual(@as(u64, 99), std.mem.readInt(u64, unrelated.getRoot(&pool)[0..8], .little));
        }
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
    }
}
