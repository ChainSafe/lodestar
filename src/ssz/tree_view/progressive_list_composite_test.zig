const std = @import("std");
const DoubleFreeDetectAllocator = @import("testing_allocators").DoubleFreeDetectAllocator;
const Node = @import("persistent_merkle_tree").Node;
const container = @import("../type/container.zig");
const FixedContainerType = container.FixedContainerType;
const VariableContainerType = container.VariableContainerType;
const StructContainerType = container.StructContainerType;
const UintType = @import("../type/uint.zig").UintType;
const ByteVectorType = @import("../type/byte_vector.zig").ByteVectorType;
const ByteListType = @import("../type/byte_list.zig").ByteListType;
const FixedProgressiveListType = @import("../type/progressive_list.zig").FixedProgressiveListType;
const VariableProgressiveListType = @import("../type/progressive_list.zig").VariableProgressiveListType;

const Checkpoint = FixedContainerType(struct {
    epoch: UintType(64),
    root: ByteVectorType(32),
});

test "ProgressiveListCompositeTreeView should read grown defaults without publishing them" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    {
        const List = FixedProgressiveListType(Checkpoint, .{});
        const view = try List.TreeView.fromValue(allocator, &pool, &List.default_value);
        defer view.deinit();
        const original = view.getRoot();
        try view.growTo(22);
        var value: Checkpoint.Type = undefined;
        try view.getValue(allocator, 2, &value);
        try std.testing.expect(Checkpoint.equals(&Checkpoint.default_value, &value));
        try std.testing.expectEqual(0, try (try view.getReadonly(20)).get("epoch"));
        try std.testing.expectEqualSlices(u8, &Checkpoint.default_root, try view.getFieldRoot(21));
        try std.testing.expectEqual(original, view.getRoot());
        // Clones snapshot committed data, and clearCache discards the growth and its defaults.
        const clone = try view.clone(.{});
        defer clone.deinit();
        try std.testing.expectEqual(0, try clone.length());
        view.clearCache();
        try std.testing.expectEqual(0, try view.length());
        try std.testing.expectEqual(original, view.getRoot());

        try view.growTo(22);
        _ = try view.getReadonly(20);
        try view.commit();
        var defaults: List.Type = .empty;
        defer defaults.deinit(allocator);
        try defaults.appendNTimes(allocator, Checkpoint.default_value, 22);
        var expected: [32]u8 = undefined;
        try List.hashTreeRoot(allocator, &defaults, &expected);
        try std.testing.expectEqualSlices(u8, &expected, try view.hashTreeRoot());
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}

test "ProgressiveListCompositeTreeView iteratorReadonly should walk struct elements across subtrees" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 512 });
    defer pool.deinit();

    const StructCheckpoint = StructContainerType(struct {
        epoch: UintType(64),
        root: ByteVectorType(32),
    });
    const ListType = FixedProgressiveListType(StructCheckpoint, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    for (0..5) |i| try list.append(allocator, .{ .epoch = @intCast(i + 1), .root = [_]u8{@intCast(i)} ** 32 });

    const root = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    var it = view.iteratorReadonly(0);
    for (0..5) |i| {
        const ptr = try it.nextValuePtr();
        try std.testing.expectEqual(@as(u64, @intCast(i + 1)), ptr.epoch);
        try std.testing.expectEqual(@as(u8, @intCast(i)), ptr.root[0]);
    }

    var it_offset = view.iteratorReadonly(3);
    try std.testing.expectEqual(@as(u64, 4), (try it_offset.nextValuePtr()).epoch);
    try std.testing.expectEqual(@as(u64, 5), (try it_offset.nextValuePtr()).epoch);
}

test "ProgressiveListCompositeTreeView sliceFrom should match the value suffix at every start" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const ListType = FixedProgressiveListType(Checkpoint, .{});
    const list_length = 16;

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);

    var values: [list_length]Checkpoint.Type = undefined;
    for (&values, 0..) |*value, idx| {
        value.* = Checkpoint.Type{
            .epoch = @intCast(idx),
            .root = [_]u8{@as(u8, @intCast(idx))} ** 32,
        };
    }
    try list.appendSlice(allocator, values[0..list_length]);

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    const min_index: i32 = -@as(i32, list_length) - 1;
    const max_index: i32 = @as(i32, list_length) + 1;
    const signed_len = std.math.cast(i32, list_length) orelse @panic("slice length exceeds i32 range");

    var i = min_index;
    while (i < max_index) : (i += 1) {
        var start_i32 = i;
        if (start_i32 < 0) {
            start_i32 = signed_len + start_i32;
        }
        start_i32 = std.math.clamp(start_i32, 0, signed_len);
        const start_index: usize = @intCast(start_i32);
        const expected_len = list_length - start_index;

        {
            var sliced = try view.sliceFrom(start_index);
            defer sliced.deinit();

            try std.testing.expectEqual(expected_len, try sliced.length());

            var actual: ListType.Type = .empty;
            defer actual.deinit(allocator);
            try ListType.tree.toValue(allocator, sliced.getRoot(), &pool, &actual);

            var expected: ListType.Type = .empty;
            defer expected.deinit(allocator);
            try expected.appendSlice(allocator, values[start_index..list_length]);

            try std.testing.expectEqual(expected_len, actual.items.len);
            try std.testing.expectEqual(expected_len, expected.items.len);

            for (expected.items, 0..) |item, idx_item| {
                try std.testing.expectEqual(item.epoch, actual.items[idx_item].epoch);
                try std.testing.expectEqualSlices(u8, &item.root, &actual.items[idx_item].root);
            }

            const expected_node = try ListType.tree.fromValue(&pool, &expected);
            var expected_root: [32]u8 = expected_node.getRoot(&pool).*;
            defer pool.unref(expected_node);

            var actual_root: [32]u8 = undefined;
            try sliced.hashTreeRootInto(&actual_root);

            try std.testing.expectEqualSlices(u8, &expected_root, &actual_root);
        }
    }
}

test "ProgressiveListCompositeTreeView push and growTo should enforce length bounds" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 512 });
    defer pool.deinit();

    const ListType = FixedProgressiveListType(Checkpoint, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);

    const first = Checkpoint.Type{ .epoch = 9, .root = [_]u8{9} ** 32 };
    try list.append(allocator, first);

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    const next_checkpoint = Checkpoint.Type{ .epoch = 10, .root = [_]u8{10} ** 32 };
    const next_node = try Checkpoint.tree.fromValue(&pool, &next_checkpoint);
    var element_view = try Checkpoint.TreeView.init(allocator, &pool, next_node);
    var transferred = false;
    defer if (!transferred) element_view.deinit();

    try view.push(element_view);
    transferred = true;

    try std.testing.expectError(error.InvalidLength, view.growTo(1));
    try std.testing.expectError(error.LengthOverLimit, view.growTo(ListType.limit + 1));

    const length_node = try pool.createLeafFromUint(ListType.limit + 1);
    const oversized = try pool.createBranch(@enumFromInt(0), length_node);
    defer pool.unref(oversized);
    try std.testing.expectError(error.LengthOverLimit, ListType.TreeView.init(allocator, &pool, oversized));
    try std.testing.expectEqual(@as(usize, 2), try view.length());

    try view.commit();

    var roundtrip: ListType.Type = .empty;
    defer roundtrip.deinit(allocator);
    try ListType.tree.toValue(allocator, view.getRoot(), &pool, &roundtrip);

    try std.testing.expectEqual(@as(usize, 2), roundtrip.items.len);
    try std.testing.expectEqual(next_checkpoint.epoch, roundtrip.items[1].epoch);
}

test "ProgressiveListCompositeTreeView should commit nested list length updates" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();

    const Numbers = FixedProgressiveListType(UintType(32), .{});
    const Element = VariableContainerType(struct {
        id: UintType(32),
        numbers: Numbers,
    });
    const Inner = VariableProgressiveListType(Element, .{});
    const Outer = VariableProgressiveListType(Inner, .{});

    const outer = try Outer.TreeView.fromValue(allocator, &pool, &Outer.default_value);
    defer outer.deinit();

    var inner: ?*Inner.TreeView = try Inner.TreeView.fromValue(allocator, &pool, &Inner.default_value);
    defer if (inner) |view| view.deinit();

    var first: ?*Element.TreeView = try Element.TreeView.fromValue(allocator, &pool, &Element.default_value);
    defer if (first) |view| view.deinit();
    try first.?.set("id", @as(u32, 11));
    const numbers = try first.?.get("numbers");
    try numbers.push(1);
    try numbers.push(2);
    try numbers.set(0, 3);
    try inner.?.push(first.?);
    first = null;

    try inner.?.pushValue(&.{ .id = 22, .numbers = .empty });
    try outer.push(inner.?);
    inner = null;
    try outer.commit();

    var actual: Outer.Type = .empty;
    defer Outer.deinit(allocator, &actual);
    try outer.toValue(allocator, &actual);
    try std.testing.expectEqual(@as(usize, 1), actual.items.len);
    try std.testing.expectEqual(@as(usize, 2), actual.items[0].items.len);
    try std.testing.expectEqual(@as(u32, 11), actual.items[0].items[0].id);
    try std.testing.expectEqualSlices(u32, &.{ 3, 2 }, actual.items[0].items[0].numbers.items);
    try std.testing.expectEqual(@as(u32, 22), actual.items[0].items[1].id);

    var expected: [32]u8 = undefined;
    try Outer.hashTreeRoot(allocator, &actual, &expected);
    try std.testing.expectEqualSlices(u8, &expected, try outer.hashTreeRoot());
}

test "ProgressiveListCompositeTreeView sliceTo should match incremental snapshots" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 2048 });
    defer pool.deinit();

    const ListType = FixedProgressiveListType(Checkpoint, .{});
    const total_values: usize = 16;

    var values: [total_values]Checkpoint.Type = undefined;
    for (&values, 0..) |*value, idx| {
        value.* = Checkpoint.Type{
            .epoch = @intCast(idx + 1),
            .root = [_]u8{@as(u8, @intCast(idx + 1))} ** 32,
        };
    }

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    try list.appendSlice(allocator, values[0..]);

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    try view.commit();

    var i: usize = 0;
    while (i < total_values) : (i += 1) {
        var sliced = try view.sliceTo(i);
        defer sliced.deinit();

        const expected_len = i + 1;
        try std.testing.expectEqual(expected_len, try sliced.length());

        var actual: ListType.Type = .empty;
        defer actual.deinit(allocator);
        try ListType.tree.toValue(allocator, sliced.getRoot(), &pool, &actual);

        var expected: ListType.Type = .empty;
        defer expected.deinit(allocator);
        try expected.appendSlice(allocator, values[0..expected_len]);

        try std.testing.expectEqual(expected_len, actual.items.len);
        for (expected.items, 0..) |item, idx_item| {
            try std.testing.expectEqual(item.epoch, actual.items[idx_item].epoch);
            try std.testing.expectEqualSlices(u8, &item.root, &actual.items[idx_item].root);
        }

        var expected_root: [32]u8 = undefined;
        try ListType.hashTreeRoot(allocator, &expected, &expected_root);

        var actual_root: [32]u8 = undefined;
        try sliced.hashTreeRootInto(&actual_root);

        try std.testing.expectEqualSlices(u8, &expected_root, &actual_root);

        const serialized_len = ListType.serializedSize(&expected);
        const expected_bytes = try allocator.alloc(u8, serialized_len);
        defer allocator.free(expected_bytes);
        const actual_bytes = try allocator.alloc(u8, serialized_len);
        defer allocator.free(actual_bytes);

        _ = ListType.serializeIntoBytes(&expected, expected_bytes);
        _ = ListType.serializeIntoBytes(&actual, actual_bytes);

        try std.testing.expectEqualSlices(u8, expected_bytes, actual_bytes);
    }
}

test "memory_safety: ProgressiveListCompositeTreeView getAllReadonlyValues should deinit completed prefix and current value on conversion OOM" {
    const allocator = std.testing.allocator;
    const Bytes = ByteListType(32);
    const Element = VariableContainerType(struct {
        first: Bytes,
        second: Bytes,
    });
    const ListType = VariableProgressiveListType(Element, .{});

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 256,
    });
    defer pool.deinit();

    var source: ListType.Type = .empty;
    defer ListType.deinit(allocator, &source);

    try source.append(allocator, Element.default_value);
    try source.append(allocator, Element.default_value);
    try source.items[0].first.appendSlice(allocator, &.{1});
    try source.items[0].second.appendSlice(allocator, &.{2});
    try source.items[1].first.appendSlice(allocator, &.{3});
    try source.items[1].second.appendSlice(allocator, &.{4});

    const root = try ListType.tree.fromValue(&pool, &source);
    var view = try ListType.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    var backing = std.testing.FailingAllocator.init(allocator, .{ .resize_fail_index = 0 });
    try std.testing.checkAllAllocationFailures(backing.allocator(), struct {
        fn run(
            output_allocator: std.mem.Allocator,
            input: *ListType.TreeView,
        ) !void {
            const values = try input.getAllReadonlyValues(output_allocator);
            defer output_allocator.free(values);
            defer for (values) |*value| Element.deinit(output_allocator, value);
            try std.testing.expectEqual(@as(usize, 2), values.len);
        }
    }.run, .{view});
}

test "memory_safety: ProgressiveListCompositeTreeView iterator nextValue should deinit current value on conversion OOM" {
    const allocator = std.testing.allocator;
    const Bytes = ByteListType(32);
    const Element = VariableContainerType(struct {
        first: Bytes,
        second: Bytes,
    });
    const ListType = VariableProgressiveListType(Element, .{});

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 256,
    });
    defer pool.deinit();

    var source: ListType.Type = .empty;
    defer ListType.deinit(allocator, &source);

    try source.append(allocator, Element.default_value);
    try source.items[0].first.appendSlice(allocator, &.{1});
    try source.items[0].second.appendSlice(allocator, &.{2});

    const root = try ListType.tree.fromValue(&pool, &source);
    var view = try ListType.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    var backing = std.testing.FailingAllocator.init(allocator, .{ .resize_fail_index = 0 });
    try std.testing.checkAllAllocationFailures(backing.allocator(), struct {
        fn run(
            output_allocator: std.mem.Allocator,
            input: *ListType.TreeView,
        ) !void {
            var iterator = input.iteratorReadonly(0);
            var value = try iterator.nextValue(output_allocator);
            defer Element.deinit(output_allocator, &value);
            try std.testing.expectEqualSlices(u8, &.{1}, value.first.items);
            try std.testing.expectEqualSlices(u8, &.{2}, value.second.items);
        }
    }.run, .{view});
}

// std.testing.allocator can't see pool-slot leaks, so check getNodesInUse() against a baseline.
test "memory_safety: ProgressiveListCompositeTreeView sliceTo should not leak pool nodes" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 512 });
    defer pool.deinit();

    const ListType = FixedProgressiveListType(Checkpoint, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(allocator);
    for (0..8) |i| try list.append(allocator, .{ .epoch = @intCast(i), .root = [_]u8{@intCast(i)} ** 32 });

    const root_node = try ListType.tree.fromValue(&pool, &list);
    var view = try ListType.TreeView.init(allocator, &pool, root_node);
    defer view.deinit();

    const baseline = pool.getNodesInUse();
    for (0..7) |idx| {
        var sliced = try view.sliceTo(idx);
        sliced.deinit();
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
    }
}

// set takes ownership only on success; setValue/push errdefer the view for the OOM path.
test "memory_safety: ProgressiveListCompositeTreeView pushValue should not double-free on OOM" {
    const ListType = FixedProgressiveListType(Checkpoint, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(std.testing.allocator);
    for (0..3) |i| try list.append(std.testing.allocator, .{ .epoch = @intCast(i), .root = [_]u8{@intCast(i)} ** 32 });
    const newval: Checkpoint.Type = .{ .epoch = 99, .root = [_]u8{0xee} ** 32 };

    var backing = DoubleFreeDetectAllocator.init(std.testing.allocator, std.math.maxInt(usize));
    defer backing.deinit();

    try std.testing.checkAllAllocationFailures(backing.allocator(), struct {
        fn run(allocator: std.mem.Allocator, value: *const ListType.Type) !void {
            var pool = try Node.Pool.init(.{
                .page_allocator = std.testing.allocator,
                .allocator = allocator,
                .pool_size = 256,
            });
            defer pool.deinit();

            var view = try ListType.TreeView.fromValue(allocator, &pool, value);
            defer view.deinit();

            try view.pushValue(&newval);
        }
    }.run, .{&list});
    try std.testing.expect(!backing.double_free);
    try std.testing.expectEqual(@as(usize, 0), backing.live.count());
}

test "memory_safety: ProgressiveListCompositeTreeView growing commit should not double-free on OOM" {
    const ListType = FixedProgressiveListType(Checkpoint, .{});

    var list: ListType.Type = .empty;
    defer list.deinit(std.testing.allocator);
    // Five elements fill subtrees 0 and 1, so the push makes commit extend the spine.
    for (0..5) |i| try list.append(std.testing.allocator, .{ .epoch = @intCast(i), .root = [_]u8{@intCast(i)} ** 32 });
    const newval: Checkpoint.Type = .{ .epoch = 99, .root = [_]u8{0xee} ** 32 };

    var backing = DoubleFreeDetectAllocator.init(std.testing.allocator, std.math.maxInt(usize));
    defer backing.deinit();

    try std.testing.checkAllAllocationFailures(backing.allocator(), struct {
        fn run(allocator: std.mem.Allocator, value: *const ListType.Type) !void {
            var pool = try Node.Pool.init(.{
                .page_allocator = std.testing.allocator,
                .allocator = allocator,
                .pool_size = 256,
            });
            defer pool.deinit();

            var view = try ListType.TreeView.fromValue(allocator, &pool, value);
            defer view.deinit();

            try view.pushValue(&newval);
            try view.commit();
        }
    }.run, .{&list});
    try std.testing.expect(!backing.double_free);
    try std.testing.expectEqual(@as(usize, 0), backing.live.count());
}

test "memory_safety: ProgressiveListCompositeTreeView sliceFrom should restore borrowed nodes on pool exhaustion" {
    const allocator = std.testing.allocator;
    const ListType = FixedProgressiveListType(Checkpoint, .{});
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    {
        // 87 elements reach subtree 4, so the 86-element suffix spans five subtrees.
        var list: ListType.Type = .empty;
        defer list.deinit(allocator);
        for (0..87) |i| try list.append(allocator, .{ .epoch = i, .root = @splat(@truncate(i)) });

        var suffix: ListType.Type = .empty;
        defer suffix.deinit(allocator);
        try suffix.appendSlice(allocator, list.items[1..]);
        var expected_root: [32]u8 = undefined;
        try ListType.hashTreeRoot(allocator, &suffix, &expected_root);

        const view = try ListType.TreeView.fromValue(allocator, &pool, &list);
        defer view.deinit();
        const source_root = (try view.hashTreeRoot()).*;
        const source_count = pool.getNodesInUse();

        var saw_failure = false;
        for (0..256) |available| {
            var held: std.ArrayList(Node.Id) = .empty;
            defer held.deinit(allocator);
            while (pool.nodes.len - pool.getNodesInUse() > available) {
                try held.append(allocator, try pool.createLeafFromUint(0));
            }

            const sliced = view.sliceFrom(1) catch |err| {
                try std.testing.expectEqual(error.PoolExhausted, err);
                pool.free(held.items);
                try std.testing.expectEqual(source_count, pool.getNodesInUse());
                try std.testing.expectEqualSlices(u8, &source_root, try view.hashTreeRoot());
                saw_failure = true;
                continue;
            };
            pool.free(held.items);
            try std.testing.expectEqualSlices(u8, &expected_root, try sliced.hashTreeRoot());
            sliced.deinit();
            try std.testing.expectEqual(source_count, pool.getNodesInUse());
            try std.testing.expect(saw_failure);
            break;
        } else return error.TestUnexpectedResult;
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}
