//! Tests for `ssz_container.zig`.

const std = @import("std");
const ssz = @import("ssz");
const Node = @import("persistent_merkle_tree").Node;
const deserializeContainerOverrideFieldsWithRanges = @import("ssz_container.zig").deserializeContainerOverrideFieldsWithRanges;

test "memory_safety: deserializeContainerOverrideFields... cleans up pool nodes on error" {
    const allocator = std.testing.allocator;

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();

    const U64 = ssz.UintType(64);
    const U64List = ssz.FixedListType(U64, 4, .{});
    const Fields = struct {
        a: U64,
        b: U64List,
    };
    // Valid offsets for `b`, but `b` payload length is 1 which is not divisible by 8.
    var bytes: [13]u8 = undefined;
    @memset(&bytes, 0);
    std.mem.writeInt(u32, bytes[8..12], 12, .little);

    const baseline_in_use = pool.getNodesInUse();
    inline for (.{
        ssz.VariableContainerType(Fields),
        ssz.VariableProgressiveContainerType(Fields, &.{ 1, 0, 1 }),
    }) |ContainerST| {
        const ranges = try ContainerST.readFieldRanges(bytes[0..]);
        try std.testing.expectError(
            error.UnexpectedRemainder,
            deserializeContainerOverrideFieldsWithRanges(
                allocator,
                &pool,
                ContainerST,
                bytes[0..],
                &ranges,
                .{},
            ),
        );
        try std.testing.expectEqual(baseline_in_use, pool.getNodesInUse());
    }
}

test "memory_safety: container overrides survive partial builds and view allocation failure" {
    const allocator = std.testing.allocator;
    const Items = ssz.FixedListType(ssz.UintType(64), 4, .{});
    const Fields = struct { a: ssz.UintType(64), items: Items, c: ssz.UintType(64) };
    const active = [_]u1{1} ++ [_]u1{0} ** 4 ++ [_]u1{1} ++ [_]u1{0} ** 15 ++ [_]u1{1};

    inline for (.{
        ssz.VariableContainerType(Fields),
        ssz.VariableProgressiveContainerType(Fields, &active),
        ssz.VariableContainerType(struct { items: Items }),
    }) |ST| {
        var value = ST.default_value;
        defer ST.deinit(allocator, &value);
        if (@hasField(ST.Type, "a")) value.a = 11;
        if (@hasField(ST.Type, "c")) value.c = 17;
        try value.items.appendSlice(allocator, &.{ 4, 9 });
        const bytes = try allocator.alloc(u8, ST.serializedSize(&value));
        defer allocator.free(bytes);
        _ = ST.serializeIntoBytes(&value, bytes);
        const ranges = try ST.readFieldRanges(bytes);
        var expected_root: [32]u8 = undefined;
        try ST.hashTreeRoot(allocator, &value, &expected_root);

        var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 128 });
        defer pool.deinit();
        const initial_nodes = pool.getNodesInUse();
        {
            const items = try Items.TreeView.fromValue(allocator, &pool, &value.items);
            defer items.deinit();
            const borrowed = items.getRoot();
            const borrowed_hash = borrowed.getRoot(&pool).*;
            const borrowed_refs = borrowed.getState(&pool).refCount();
            const baseline = pool.getNodesInUse();

            var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
            try std.testing.expectError(error.OutOfMemory, deserializeContainerOverrideFieldsWithRanges(
                failing.allocator(),
                &pool,
                ST,
                bytes,
                &ranges,
                .{ .items = borrowed },
            ));
            try std.testing.expectEqual(baseline, pool.getNodesInUse());
            try std.testing.expectEqual(borrowed_refs, borrowed.getState(&pool).refCount());

            var saw_failure = false;
            var saw_success = false;
            for (0..64) |available| {
                var held: [128]Node.Id = undefined;
                var held_len: usize = 0;
                while (pool.nodes.len - pool.getNodesInUse() > available) : (held_len += 1) {
                    std.debug.assert(held_len < held.len);
                    held[held_len] = try pool.createLeafFromUint(0);
                }
                defer pool.free(held[0..held_len]);
                const before = pool.getNodesInUse();

                if (deserializeContainerOverrideFieldsWithRanges(allocator, &pool, ST, bytes, &ranges, .{ .items = borrowed })) |view| {
                    defer view.deinit();
                    try std.testing.expectEqualSlices(u8, &expected_root, try view.hashTreeRoot());
                    try std.testing.expectEqual(borrowed, try view.getRoot().getNode(&pool, comptime ST.getFieldGindex("items")));
                    saw_success = true;
                } else |err| {
                    try std.testing.expectEqual(error.PoolExhausted, err);
                    saw_failure = true;
                }
                try std.testing.expectEqual(before, pool.getNodesInUse());
                try std.testing.expectEqual(borrowed_refs, borrowed.getState(&pool).refCount());
                try std.testing.expectEqualSlices(u8, &borrowed_hash, borrowed.getRoot(&pool));
                if (saw_success) break;
            }
            if (ST.fields.len > 1) try std.testing.expect(saw_failure);
            try std.testing.expect(saw_success);
            try std.testing.expectEqual(baseline, pool.getNodesInUse());
        }
        try std.testing.expectEqual(initial_nodes, pool.getNodesInUse());
    }
}
