const std = @import("std");
const progressive = @import("progressive.zig");
const Node = @import("persistent_merkle_tree").Node;

test "progressive tree builder needs no scratch allocation" {
    const allocator = std.testing.allocator;
    inline for (.{ 0, 1, 2, 5, 6, 21, 22, 85, 86, 341, 342 }) |count| {
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = failing.allocator(), .pool_size = 2048 });
        defer pool.deinit();
        const baseline = pool.getNodesInUse();
        var chunks: [count][32]u8 = undefined;
        for (&chunks, 0..) |*chunk, i| chunk.* = @splat(@truncate(i));
        const tree = try buildProgressiveChunks(&pool, count);
        var expected: [32]u8 = undefined;
        try progressive.merkleizeChunks(allocator, &chunks, &expected);
        try std.testing.expectEqualSlices(u8, &expected, tree.getRoot(&pool));
        pool.unref(tree);
        try std.testing.expectEqual(baseline, pool.getNodesInUse());
        try std.testing.expect(!failing.has_induced_failure);
    }
}

test "progressive Merkleization matches tree roots without scratch allocation" {
    const allocator = std.testing.allocator;
    inline for (.{ 0, 1, 2, 5, 6, 21, 22, 85, 86, 341, 342, 1365, 1366 }) |count| {
        var chunks: [count][32]u8 = undefined;
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 8192 });
        defer pool.deinit();
        for (&chunks, 0..) |*chunk, i| chunk.* = @splat(@truncate(i));
        const tree = try buildProgressiveChunks(&pool, count);
        defer pool.unref(tree);
        var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
        var root: [32]u8 = undefined;
        try progressive.merkleizeChunks(failing.allocator(), &chunks, &root);
        try std.testing.expectEqualSlices(u8, tree.getRoot(&pool), &root);
        try progressive.merkleizeChunksComptime(count, &chunks, &root);
        try std.testing.expectEqualSlices(u8, tree.getRoot(&pool), &root);
        for (chunks, 0..) |chunk, i| try std.testing.expectEqual([_]u8{@truncate(i)} ** 32, chunk);
    }
}

test "progressive accumulator enforces length and finish state" {
    var accumulator = try progressive.MerkleAccumulator.init(2);
    var root: [32]u8 = undefined;
    try std.testing.expectError(error.InvalidLength, accumulator.finish(&root));
    try accumulator.append(&@as([32]u8, @splat(1)));
    try accumulator.append(&@as([32]u8, @splat(2)));
    try std.testing.expectError(error.InputTooLong, accumulator.append(&root));
    try accumulator.finish(&root);
    try std.testing.expectError(error.InvalidState, accumulator.finish(&root));
    try std.testing.expectError(error.InvalidState, accumulator.append(&root));
    try std.testing.expectError(error.InputTooLong, progressive.MerkleAccumulator.init(std.math.maxInt(usize)));
}

test "memory_safety: progressive streaming builder reclaims every partial tree" {
    const allocator = std.testing.allocator;
    for ([_]usize{ 0, 1, 2, 5, 6, 21, 22, 85, 86 }) |count| {
        var succeeded = false;
        for (0..256) |capacity| {
            var failing = std.testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
            var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = failing.allocator(), .pool_size = @intCast(capacity) });
            defer pool.deinit();
            const baseline = pool.getNodesInUse();
            const root = buildProgressiveChunks(&pool, count) catch |err| {
                try std.testing.expectEqual(error.PoolExhausted, err);
                try std.testing.expectEqual(baseline, pool.getNodesInUse());
                continue;
            };
            var chunks: [86][32]u8 = undefined;
            for (chunks[0..count], 0..) |*chunk, i| chunk.* = @splat(@truncate(i));
            var expected: [32]u8 = undefined;
            try progressive.merkleizeChunks(allocator, chunks[0..count], &expected);
            try std.testing.expectEqualSlices(u8, &expected, root.getRoot(&pool));
            pool.unref(root);
            try std.testing.expectEqual(baseline, pool.getNodesInUse());
            try std.testing.expect(!failing.has_induced_failure);
            succeeded = true;
            break;
        }
        try std.testing.expect(succeeded);
    }
}

fn buildProgressiveChunks(pool: *Node.Pool, count: usize) !Node.Id {
    var builder = try progressive.TreeBuilder.init(pool, count);
    defer builder.deinit();
    for (0..count) |i| {
        const chunk: [32]u8 = @splat(@truncate(i));
        try builder.appendOwned(try pool.createLeaf(&chunk));
    }
    return builder.finish();
}

test "progressive streaming builder rejects excess input and invalid finish" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 16 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    var builder = try progressive.TreeBuilder.init(&pool, 1);
    defer builder.deinit();
    try std.testing.expectError(error.InvalidLength, builder.finish());
    try builder.appendOwned(try pool.createLeafFromUint(7));
    try std.testing.expectError(error.InvalidLength, builder.appendOwned(try pool.createLeafFromUint(9)));
    const root = try builder.finish();
    pool.unref(root);
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
    try std.testing.expectError(error.InvalidState, builder.finish());
    const rejected = try pool.createLeafFromUint(11);
    try std.testing.expectError(error.InvalidLength, builder.appendOwned(rejected));
    try std.testing.expect(rejected.getState(&pool).isFree());
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
    try std.testing.expectError(error.InputTooLong, progressive.TreeBuilder.init(&pool, std.math.maxInt(usize)));
}

test "memory_safety: progressive appendOwned consumes its input on pool exhaustion" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 3 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    {
        var builder = try progressive.TreeBuilder.init(&pool, 3);
        defer builder.deinit();
        try builder.appendOwned(try pool.createLeafFromUint(1));
        try builder.appendOwned(try pool.createLeafFromUint(2));
        const incoming = try pool.createLeafFromUint(3);
        try std.testing.expectError(error.PoolExhausted, builder.appendOwned(incoming));
        try std.testing.expect(incoming.getState(&pool).isFree());
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}
