const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const ssz = @import("../type/root.zig");
const List = ssz.FixedProgressiveListType(ssz.UintType(64), .{});
const allocator = std.testing.allocator;
const Allocator = std.mem.Allocator;
const zero_nodes = @import("hashing").max_depth;
const ChunkedList = ssz.FixedProgressiveListType(ssz.UintType(64), .{ .chunked_leaf = true });

fn expectRoot(comptime ST: type, view: *ST.TreeView, value: *const ST.Type) !void {
    var expected: [32]u8 = undefined;
    try ST.hashTreeRoot(allocator, value, &expected);
    try std.testing.expectEqualSlices(u8, &expected, try view.hashTreeRoot());
}

test "ProgressiveListBasicTreeView with chunked leaves should match value roots at subtree and leaf boundaries" {
    inline for (.{ ssz.BoolType(), ssz.UintType(8), ssz.UintType(16), ssz.UintType(32), ssz.UintType(64), ssz.UintType(128), ssz.UintType(256) }) |Element| {
        const ST = ssz.FixedProgressiveListType(Element, .{ .chunked_leaf = true });
        const per_chunk = 32 / Element.fixed_size;
        const len = 342 * per_chunk + 1;
        var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 4096 });
        defer pool.deinit();
        {
            var value: ST.Type = .empty;
            defer value.deinit(allocator);
            const view = try ST.TreeView.fromValue(allocator, &pool, &value);
            defer view.deinit();
            var empty_iterator = view.iteratorReadonly(0);
            try std.testing.expectEqual(null, try empty_iterator.next());
            for (0..len) |i| {
                const item: Element.Type = if (Element.Type == bool) i % 3 != 0 else @intCast(i % 251);
                try view.push(item);
                try value.append(allocator, item);
                if (i == 21 * per_chunk or i == 85 * per_chunk) try view.commit();
            }
            const output = try allocator.alloc(Element.Type, len);
            defer allocator.free(output);
            _ = try view.getAllInto(output);
            try std.testing.expectEqualSlices(Element.Type, value.items, output);
            try expectRoot(ST, view, &value);
            for ([_]usize{ 0, 1, 20 * per_chunk, 21 * per_chunk + 1, 84 * per_chunk, 85 * per_chunk + 1, 148 * per_chunk, 149 * per_chunk, len - 1, len }) |start| {
                var iterator = view.iteratorReadonly(start);
                for (value.items[start..]) |item| try std.testing.expectEqual(@as(?Element.Type, item), try iterator.next());
                try std.testing.expectEqual(null, try iterator.next());
                try std.testing.expectEqual(null, try iterator.next());
            }
            for ([_]usize{ 20 * per_chunk, 21 * per_chunk, 84 * per_chunk + 1, 85 * per_chunk, 148 * per_chunk + 1, 149 * per_chunk, 340 * per_chunk, 341 * per_chunk }) |index| {
                try view.set(index, Element.default_value);
                value.items[index] = Element.default_value;
                try std.testing.expectEqual(Element.default_value, try view.get(index));
            }
            _ = try view.getAllInto(output);
            try std.testing.expectEqualSlices(Element.Type, value.items, output);
            try expectRoot(ST, view, &value);
            const bytes = try allocator.alloc(u8, try view.serializedSize());
            defer allocator.free(bytes);
            _ = try view.serializeIntoBytes(bytes);
            const restored = try ST.TreeView.deserialize(allocator, &pool, bytes);
            defer restored.deinit();
            try expectRoot(ST, restored, &value);
            for ([_]usize{ 0, 20 * per_chunk, 21 * per_chunk + 1, 84 * per_chunk, 85 * per_chunk + 1, 148 * per_chunk, 149 * per_chunk + 1, 340 * per_chunk, 341 * per_chunk }) |cut| {
                const sliced = try view.sliceTo(cut);
                defer sliced.deinit();
                var expected: ST.Type = .empty;
                defer expected.deinit(allocator);
                try expected.appendSlice(allocator, value.items[0 .. cut + 1]);
                try expectRoot(ST, sliced, &expected);
                try sliced.growTo(len);
                try expected.resize(allocator, len);
                @memset(expected.items[cut + 1 ..], Element.default_value);
                try sliced.set(len - 1, Element.default_value);
                try expectRoot(ST, sliced, &expected);
                _ = try sliced.getAllInto(output);
                try std.testing.expectEqualSlices(Element.Type, expected.items, output);
            }
            try expectRoot(ST, view, &value);
        }
        try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
    }
}

test "ProgressiveListBasicTreeView with chunked leaves should keep clones isolated across zero growth" {
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    {
        const view = try ChunkedList.TreeView.fromValue(allocator, &pool, &ChunkedList.default_value);
        defer view.deinit();
        try view.growTo(2048);
        try std.testing.expectEqual(@as(u64, 0), try view.get(1000));
        try view.commit();
        try std.testing.expectEqual(@as(u64, 0), try view.get(1000));
        try view.set(1000, 12);
        try view.set(1001, 13);
        const copy = try view.clone(.{ .transfer_cache = false });
        defer copy.deinit();
        try std.testing.expectEqual(@as(u64, 0), try copy.get(1000));
        try view.commit();
        try view.set(1000, 14);
        const transferred = try view.clone(.{ .transfer_cache = true });
        defer transferred.deinit();
        try std.testing.expectEqual(@as(u64, 12), try view.get(1000));
        try std.testing.expectEqual(@as(u64, 12), try transferred.get(1000));
        try transferred.set(1000, 99);
        transferred.clearCache();
        try std.testing.expectEqual(@as(u64, 12), try transferred.get(1000));
        const zero_slice = try copy.sliceTo(999);
        defer zero_slice.deinit();
        try zero_slice.growTo(2048);
        try std.testing.expectEqualSlices(u8, try copy.hashTreeRoot(), try zero_slice.hashTreeRoot());
        const used = pool.getNodesInUse();
        try view.set(1000, 15);
        const copied = pool.getNodesInUse();
        try std.testing.expect(copied == used + 1);
        for (1000..1010) |i| try view.set(i, @intCast(i));
        try std.testing.expectEqual(copied, pool.getNodesInUse());
        try view.commit();
        try std.testing.expectEqual(@as(u64, 12), try transferred.get(1000));
    }
    try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
}

test "ProgressiveListBasicTreeView with chunked leaves should prove chunks at canonical gindices" {
    const pmt = @import("persistent_merkle_tree");
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();
    {
        const view = try ChunkedList.TreeView.fromValue(allocator, &pool, &ChunkedList.default_value);
        defer view.deinit();
        try view.growTo(2048);
        try view.set(1000, 1234);
        const root = (try view.hashTreeRoot()).*;
        // Chunk 250 is offset 165 inside the 256-chunk subtree at spine index 4.
        const gindex: pmt.Gindex = @enumFromInt(((@as(u64, 3) << 4) - 1) * 2 * 256 + 165);
        var proof = try pmt.proof.createSingleProof(allocator, &pool, view.getRoot(), gindex);
        defer proof.deinit(allocator);
        const rebuilt = try pmt.proof.createNodeFromSingleProof(&pool, gindex, proof.leaf, proof.witnesses);
        defer pool.unref(rebuilt);
        try std.testing.expectEqualSlices(u8, &root, rebuilt.getRoot(&pool));
        try std.testing.expectEqual(@as(u64, 1234), std.mem.readInt(u64, proof.leaf[0..8], .little));
    }
    try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
}

fn chunkedAllocationFailures(failing: Allocator) !void {
    var pool = try Node.Pool.init(.{ .allocator = failing, .page_allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();
    defer std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse()) catch @panic("leaked nodes");
    const view = try ChunkedList.TreeView.fromValue(failing, &pool, &ChunkedList.default_value);
    defer view.deinit();
    try view.growTo(1368);
    try view.set(84, 11);
    try view.set(600, 22);
    try view.set(1367, 33);
    try view.commit();
    const copy = try view.clone(.{ .transfer_cache = false });
    defer copy.deinit();
    try view.set(600, 44);
    try view.commit();
    const sliced = try view.sliceTo(600);
    defer sliced.deinit();
    try sliced.growTo(1368);
    try sliced.set(800, 55);
    try sliced.commit();
    var value: ChunkedList.Type = .empty;
    defer value.deinit(failing);
    try sliced.toValue(failing, &value);
    try std.testing.expectEqual(@as(u64, 44), value.items[600]);
    try std.testing.expectEqual(@as(u64, 0), value.items[601]);
    try std.testing.expectEqual(@as(u64, 55), value.items[800]);
    try std.testing.expectEqual(@as(u64, 22), try copy.get(600));
}

test "memory_safety: ProgressiveListBasicTreeView with chunked leaves should clean up on every allocation failure" {
    try std.testing.checkAllAllocationFailures(allocator, chunkedAllocationFailures, .{});
}

test "memory_safety: ProgressiveListBasicTreeView with chunked leaves should keep writes and reclaim nodes on pool exhaustion" {
    inline for (.{ false, true }) |slice| {
        var saw_failure = false;
        var saw_success = false;
        for (0..48) |available| {
            var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 256 });
            defer pool.deinit();
            {
                const view = try ChunkedList.TreeView.fromValue(allocator, &pool, &ChunkedList.default_value);
                defer view.deinit();
                try view.growTo(600);
                try view.set(100, 11);
                try view.set(500, 22);
                try view.commit();
                const original = view.getRoot();
                const root = (try view.hashTreeRoot()).*;
                if (!slice) {
                    try view.growTo(1400);
                    try view.set(500, 33);
                    try view.set(1399, 44);
                }
                var fillers: [256]Node.Id = undefined;
                var count: usize = 0;
                defer for (fillers[0..count]) |node| pool.unref(node);
                while (pool.nodes.len - pool.getNodesInUse() > available) {
                    fillers[count] = try pool.createLeafFromUint(0);
                    count += 1;
                }
                const before = pool.getNodesInUse();
                var expected_last: u64 = 44;
                if (slice) {
                    if (view.sliceTo(500)) |sliced| {
                        sliced.deinit();
                        saw_success = true;
                    } else |err| {
                        try std.testing.expectEqual(error.PoolExhausted, err);
                        saw_failure = true;
                    }
                    try std.testing.expectEqual(before, pool.getNodesInUse());
                } else {
                    view.commit() catch |err| {
                        try std.testing.expectEqual(error.PoolExhausted, err);
                        saw_failure = true;
                        try std.testing.expectEqual(original, view.getRoot());
                        try std.testing.expectEqualSlices(u8, &root, original.getRoot(&pool));
                        try std.testing.expectEqual(@as(u64, 33), try view.get(500));
                        try std.testing.expectEqual(@as(u64, 44), try view.get(1399));
                        try view.set(1399, 45);
                        expected_last = 45;
                        try std.testing.expectEqual(@as(u64, 45), try view.get(1399));
                        try std.testing.expectEqualSlices(u8, &root, original.getRoot(&pool));
                        for (fillers[0..count]) |node| pool.unref(node);
                        count = 0;
                        try view.commit();
                    };
                    if (count != 0) saw_success = true;
                    try std.testing.expectEqual(expected_last, try view.get(1399));
                }
            }
            try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
        }
        try std.testing.expect(saw_failure);
        try std.testing.expect(saw_success);
    }
}

test "ProgressiveListBasicTreeView with chunked leaves should not allocate for warmed writes and bulk reads" {
    var failing = std.testing.FailingAllocator.init(allocator, .{});
    var pool = try Node.Pool.init(.{ .allocator = failing.allocator(), .page_allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    {
        const view = try ChunkedList.TreeView.fromValue(failing.allocator(), &pool, &ChunkedList.default_value);
        defer view.deinit();
        try view.growTo(512);
        try view.set(400, 11);
        const used = pool.getNodesInUse();
        failing.fail_index = failing.alloc_index;
        for (400..420) |i| try view.set(i, i);
        var values: [512]u64 = undefined;
        _ = try view.getAllInto(&values);
        try std.testing.expectEqual(@as(u64, 419), values[419]);
        try std.testing.expect(!failing.has_induced_failure);
        try std.testing.expectEqual(used, pool.getNodesInUse());
        failing.fail_index = std.math.maxInt(usize);
        try view.commit();
        failing.fail_index = failing.alloc_index;
        var bytes: [4096]u8 = undefined;
        _ = try view.serializeIntoBytes(&bytes);
        var iterator = view.iteratorReadonly(400);
        for (400..420) |i| try std.testing.expectEqual(@as(?u64, i), try iterator.next());
        try std.testing.expect(!failing.has_induced_failure);
    }
    try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
}

test "ProgressiveListBasicTreeView should match value roots for every packed type" {
    inline for (.{ ssz.BoolType(), ssz.UintType(8), ssz.UintType(16), ssz.UintType(32), ssz.UintType(64), ssz.UintType(128), ssz.UintType(256) }) |Element| {
        const ST = ssz.FixedProgressiveListType(Element, .{});
        var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 2048 });
        defer pool.deinit();
        {
            var value: ST.Type = .empty;
            defer value.deinit(allocator);
            const view = try ST.TreeView.fromValue(allocator, &pool, &value);
            defer view.deinit();
            const count = 86 * (32 / Element.fixed_size) + 1;
            for (0..count) |i| {
                const item: Element.Type = if (Element.Type == bool) i % 3 != 0 else @intCast(i % 251);
                try view.push(item);
                try value.append(allocator, item);
                if (i % (32 / Element.fixed_size) == 0) {
                    try std.testing.expectEqual(item, try view.get(i));
                }
            }
            const output = try allocator.alloc(Element.Type, count);
            defer allocator.free(output);
            _ = try view.getAllInto(output);
            try std.testing.expectEqualSlices(Element.Type, value.items, output);
            try expectRoot(ST, view, &value);
            var iterator = view.iteratorReadonly(3);
            for (value.items[3..]) |item| try std.testing.expectEqual(@as(?Element.Type, item), try iterator.next());
            try std.testing.expectEqual(null, try iterator.next());
            try std.testing.expectError(error.IndexOutOfBounds, view.get(count));
            try std.testing.expectError(error.IndexOutOfBounds, view.set(count, Element.default_value));
            try std.testing.expectError(error.InvalidLength, view.growTo(count - 1));
            try std.testing.expectError(error.LengthOverLimit, view.growTo(ST.TreeView.max_length + 1));
        }
        try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
    }
}

test "ProgressiveListBasicTreeView should grow zero subtrees and slice shared prefixes" {
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();
    {
        var value: List.Type = .empty;
        defer value.deinit(allocator);
        const view = try List.TreeView.fromValue(allocator, &pool, &value);
        defer view.deinit();
        try view.growTo(345);
        try value.resize(allocator, 345);
        @memset(value.items, 0);
        for ([_]usize{ 0, 3, 4, 19, 20, 83, 84, 339, 340, 344 }) |i| {
            try view.set(i, i + 1);
            value.items[i] = i + 1;
        }
        var actual: [345]u64 = undefined;
        _ = try view.getAllInto(&actual);
        try std.testing.expectEqualSlices(u64, value.items, &actual);
        try expectRoot(List, view, &value);
        for ([_]usize{ 0, 2, 3, 4, 18, 19, 20, 82, 83, 84, 338, 339, 340, 344 }) |cut| {
            const sliced = try view.sliceTo(cut);
            defer sliced.deinit();
            var expected: List.Type = .empty;
            defer expected.deinit(allocator);
            try expected.appendSlice(allocator, value.items[0 .. cut + 1]);
            try expectRoot(List, sliced, &expected);
            try sliced.growTo(345);
            try expected.resize(allocator, 345);
            @memset(expected.items[cut + 1 ..], 0);
            try expectRoot(List, sliced, &expected);
        }
        try expectRoot(List, view, &value);
        try view.growTo(List.TreeView.max_length);
        try view.commit();
        try std.testing.expectEqual(@as(u64, 0), try view.get(List.TreeView.max_length - 1));
        try std.testing.expectError(error.LengthOverLimit, view.push(1));
        _ = try view.hashTreeRoot();
    }
    try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
}

test "ProgressiveListBasicTreeView clone should drop transferred writes" {
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    {
        var value: List.Type = .empty;
        defer value.deinit(allocator);
        try value.appendSlice(allocator, &.{ 1, 2, 3, 4, 5 });
        const view = try List.TreeView.fromValue(allocator, &pool, &value);
        defer view.deinit();
        try view.set(0, 10);
        try view.push(6);
        const copy = try view.clone(.{ .transfer_cache = false });
        defer copy.deinit();
        try std.testing.expectEqual(@as(u64, 1), try copy.get(0));
        try std.testing.expectEqual(@as(u64, 10), try view.get(0));
        try view.commit();
        try view.set(0, 20);
        const transferred = try view.clone(.{ .transfer_cache = true });
        defer transferred.deinit();
        try std.testing.expectEqual(@as(u64, 10), try transferred.get(0));
        try std.testing.expectEqual(@as(u64, 10), try view.get(0));
        try view.push(7);
        view.clearCache();
        try std.testing.expectEqual(@as(usize, 6), try view.length());
        try std.testing.expectEqual(@as(usize, 5), try copy.length());
        var bytes: [48]u8 = undefined;
        _ = try transferred.serializeIntoBytes(&bytes);
        const restored = try List.TreeView.deserialize(allocator, &pool, &bytes);
        defer restored.deinit();
        try std.testing.expectEqualSlices(u8, try transferred.hashTreeRoot(), try restored.hashTreeRoot());
        var out: List.Type = .empty;
        defer out.deinit(allocator);
        try restored.toValue(allocator, &out);
        try std.testing.expectEqual(@as(u64, 10), out.items[0]);
        try expectRoot(List, copy, &value);
    }
    try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
}

test "ProgressiveListBasicTreeView toValue should fill caller-owned out in place" {
    var pool = try Node.Pool.init(.{
        .allocator = allocator,
        .page_allocator = allocator,
        .pool_size = 1024,
    });
    defer pool.deinit();
    inline for (.{ List, ChunkedList }) |ST| {
        var value: ST.Type = .empty;
        defer value.deinit(allocator);
        try value.resize(allocator, 100);
        for (value.items, 0..) |*element, i| element.* = i;
        const view = try ST.TreeView.fromValue(allocator, &pool, &value);
        defer view.deinit();
        try view.set(99, 7);
        value.items[99] = 7;

        var out: ST.Type = .empty;
        defer out.deinit(allocator);
        try out.resize(allocator, 200);
        @memset(out.items, 0xff);
        const storage = out.items.ptr;
        try view.toValue(allocator, &out);
        try std.testing.expectEqual(storage, out.items.ptr);
        try std.testing.expectEqualSlices(u64, value.items, out.items);
    }
    try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
}

test "ProgressiveListBasicTreeView should work as an ordinary container field" {
    inline for (.{ List, ChunkedList }) |ST| {
        const Container = ssz.VariableContainerType(struct { values: ST });
        var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 1024 });
        defer pool.deinit();
        {
            const parent = try Container.TreeView.fromValue(allocator, &pool, &Container.default_value);
            defer parent.deinit();
            const child = try parent.get("values");
            try child.growTo(601);
            try child.set(600, 11);
            try parent.commit();
            try child.set(600, 22);
            const copy = try parent.clone(.{ .transfer_cache = false });
            defer copy.deinit();
            try std.testing.expectEqual(@as(u64, 11), try (try copy.get("values")).get(600));
            var bytes: [4 + 601 * 8]u8 = undefined;
            _ = try copy.serializeIntoBytes(&bytes);
            try std.testing.expectEqual(@as(u64, 11), std.mem.readInt(u64, bytes[4 + 600 * 8 ..][0..8], .little));
            try std.testing.expectEqual(@as(u64, 22), try child.get(600));
        }
        try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
    }
}

test "memory_safety: ProgressiveListBasicTreeView commit should keep writes on pool exhaustion" {
    var failures: usize = 0;
    var successes: usize = 0;
    for ([_]usize{ 4, 20 }) |new_length| {
        for (0..28) |available| {
            var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 128 });
            defer pool.deinit();
            {
                const view = try List.TreeView.fromValue(allocator, &pool, &List.default_value);
                defer view.deinit();
                try view.growTo(new_length);
                try view.set(0, 12);
                try view.set(new_length - 1, 34);
                const original = view.getRoot();
                var fillers: [128]Node.Id = undefined;
                var count: usize = 0;
                defer for (fillers[0..count]) |node| pool.unref(node);
                while (pool.nodes.len - pool.getNodesInUse() > available) {
                    fillers[count] = try pool.createLeafFromUint(0);
                    count += 1;
                }
                var expected_last: u64 = 34;
                view.commit() catch |err| {
                    failures += 1;
                    try std.testing.expectEqual(error.PoolExhausted, err);
                    try std.testing.expectEqual(original, view.getRoot());
                    try std.testing.expectEqual(@as(u64, 12), try view.get(0));
                    try std.testing.expectEqual(@as(u64, 34), try view.get(new_length - 1));
                    try view.set(new_length - 1, 35);
                    expected_last = 35;
                    try std.testing.expectEqual(@as(u64, 35), try view.get(new_length - 1));
                    for (fillers[0..count]) |node| pool.unref(node);
                    count = 0;
                    try view.commit();
                };
                successes += 1;
                var expected: List.Type = .empty;
                defer expected.deinit(allocator);
                try expected.resize(allocator, new_length);
                @memset(expected.items, 0);
                expected.items[0] = 12;
                expected.items[new_length - 1] = expected_last;
                try expectRoot(List, view, &expected);
            }
            try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
        }
    }
    try std.testing.expect(failures > 0);
    try std.testing.expect(successes > failures);
}

fn allocationFailures(failing: Allocator) !void {
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 2048 });
    defer pool.deinit();
    defer std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse()) catch @panic("leaked pool nodes");
    {
        const view = try List.TreeView.fromValue(failing, &pool, &List.default_value);
        defer view.deinit();
        try view.growTo(96);
        try view.set(0, 11);
        try view.set(95, 22);
        try view.commit();
        const copy = try view.clone(.{ .transfer_cache = true });
        defer copy.deinit();
        const sliced = try copy.sliceTo(7);
        defer sliced.deinit();
        var values: List.Type = .empty;
        defer values.deinit(failing);
        try copy.toValue(failing, &values);
        try std.testing.expectEqual(@as(u64, 22), values.items[95]);
    }
    try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
}

test "memory_safety: ProgressiveListBasicTreeView should clean up on every allocation failure" {
    try std.testing.checkAllAllocationFailures(allocator, allocationFailures, .{});
}

test "memory_safety: ProgressiveListBasicTreeView commit should keep the old root on OOM" {
    for ([_]usize{ 4, 96 }) |len| {
        var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 2048 });
        defer pool.deinit();
        {
            var failing = std.testing.FailingAllocator.init(allocator, .{});
            const view = try List.TreeView.fromValue(failing.allocator(), &pool, &List.default_value);
            defer view.deinit();
            try view.push(1);
            try view.commit();
            const original = view.getRoot();
            try view.growTo(len);
            try view.set(len - 1, 2);
            failing.fail_index = failing.alloc_index;
            try std.testing.expectError(error.OutOfMemory, view.commit());
            try std.testing.expect(failing.has_induced_failure);
            try std.testing.expectEqual(original, view.getRoot());
            try std.testing.expectEqual(@as(u64, 2), try view.get(len - 1));
            failing.fail_index = std.math.maxInt(usize);
            try view.commit();
            try std.testing.expectEqual(@as(u64, 2), try view.get(len - 1));
        }
        try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
    }
}

test "ProgressiveListBasicTreeView should reuse one pending leaf for repeated writes" {
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 128 });
    defer pool.deinit();
    {
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        const view = try List.TreeView.fromValue(failing.allocator(), &pool, &List.default_value);
        defer view.deinit();
        try view.growTo(4);
        try view.set(0, 1);
        const nodes = pool.getNodesInUse();
        failing.fail_index = failing.alloc_index;
        for (0..32) |i| try view.set(i % 4, i);
        try std.testing.expectEqual(nodes, pool.getNodesInUse());
        try std.testing.expect(!failing.has_induced_failure);
        failing.fail_index = std.math.maxInt(usize);
        try view.commit();
        for (0..4) |i| try std.testing.expectEqual(@as(u64, 28 + i), try view.get(i));
    }
    try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
}

test "ProgressiveListBasicTreeView should read, write and grow a zeros tree" {
    inline for (.{ List, ChunkedList }) |ST| {
        var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 1024 });
        defer pool.deinit();
        {
            const root = try ST.tree.zeros(&pool, 1400);
            const view = ST.TreeView.init(allocator, &pool, root) catch |err| {
                pool.unref(root);
                return err;
            };
            defer view.deinit();

            try std.testing.expectEqual(@as(u64, 0), try view.get(1399));
            try view.set(600, 6);
            try view.push(7);

            var expected: ST.Type = .empty;
            defer expected.deinit(allocator);
            try expected.resize(allocator, 1401);
            @memset(expected.items, 0);
            expected.items[600] = 6;
            expected.items[1400] = 7;
            try expectRoot(ST, view, &expected);
            var it = view.iteratorReadonly(1398);
            for (expected.items[1398..]) |item| try std.testing.expectEqual(@as(?u64, item), try it.next());
        }
        try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
    }
}

test "ProgressiveListBasicTreeView push and growTo should respect the type limit" {
    const ST = ssz.FixedProgressiveListType(ssz.UintType(64), .{ .limit = 3 });
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    {
        const view = try ST.TreeView.fromValue(allocator, &pool, &ST.default_value);
        defer view.deinit();
        try view.growTo(2);
        try view.push(7);
        try std.testing.expectError(error.LengthOverLimit, view.push(8));
        try std.testing.expectError(error.LengthOverLimit, view.growTo(4));
        try std.testing.expectEqual(@as(u64, 7), try view.get(2));
    }
    try std.testing.expectEqual(@as(usize, zero_nodes), pool.getNodesInUse());
}
