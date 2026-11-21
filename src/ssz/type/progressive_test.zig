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

test "chunked progressive tree builder should size nodes by subtree and reject other sizes" {
    const allocator = std.testing.allocator;

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 128,
    });
    defer pool.deinit();

    const baseline = pool.getNodesInUse();
    const bytes: [64 * 32]u8 = @splat(7);

    var builder = try progressive.TreeBuilder.initChunkedLeaf(&pool, 86);
    defer builder.deinit();

    // Subtrees 0 to 2 hold 21 single-chunk leaves. Subtree 3 is one 64-chunk leaf. The last chunk
    // starts subtree 4.
    for (0..21) |_| {
        try std.testing.expectEqual(1, builder.nextNodeChunks());
        try builder.appendPacked(bytes[0..32]);
    }
    try std.testing.expectEqual(64, builder.nextNodeChunks());
    try std.testing.expectError(error.InvalidLength, builder.appendPacked(bytes[0..32]));
    const partial = bytes[0 .. bytes.len - 1];
    try std.testing.expectError(error.InvalidLength, builder.appendPacked(partial));
    try builder.appendPacked(&bytes);
    try std.testing.expectEqual(1, builder.nextNodeChunks());
    try builder.appendPacked(bytes[0..1]);
    try std.testing.expectEqual(0, builder.nextNodeChunks());
    try std.testing.expectError(error.InvalidLength, builder.appendPacked(&.{}));
    try std.testing.expectError(error.InvalidLength, builder.appendPacked(bytes[0..32]));

    const root = try builder.finish();
    pool.unref(root);
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
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

test "progressive chunkGindex and subtreeIndex should follow subtree boundaries at runtime" {
    for (0..31) |index| {
        const expected: u64 = if (index == 0) 2 else if (index < 5) 24 + index - 1 else if (index < 21) 224 + index - 5 else 1920 + index - 21;
        try std.testing.expectEqual(expected, @intFromEnum(progressive.chunkGindex(index)));
    }
    try std.testing.expectEqual(0, progressive.subtreeCount(0));
    try std.testing.expectEqual(1, progressive.subtreeCount(1));
    try std.testing.expectEqual(1, progressive.subtreeIndex(2));
    try std.testing.expectEqual(2, progressive.subtreeCount(2));
    try std.testing.expectEqual(2, progressive.subtreeIndex(20));
    try std.testing.expectEqual(3, progressive.subtreeCount(21));
    const Gindex = @import("persistent_merkle_tree").Gindex;
    // Gloas `finalized_checkpoint.root`: contents root, active field 20, then the `root` chunk.
    try std.testing.expectEqual(735, @intFromEnum(Gindex.concat(&.{ @enumFromInt(2), progressive.chunkGindex(20), @enumFromInt(3) })));
}

test "progressive types should derive default roots and trees from their default values" {
    const allocator = std.testing.allocator;
    const UintType = @import("uint.zig").UintType;
    const ByteVectorType = @import("byte_vector.zig").ByteVectorType;
    const Bits = @import("progressive_bit_list.zig").ProgressiveBitListType(.{});
    const Numbers = @import("progressive_list.zig").FixedProgressiveListType(UintType(64), .{});
    const Fixed = @import("progressive_container.zig").FixedProgressiveContainerType(struct {
        a: UintType(64),
        b: ByteVectorType(32),
    }, &.{ 1, 0, 1 });
    const Variable = @import("progressive_container.zig").VariableProgressiveContainerType(struct {
        a: UintType(64),
        numbers: Numbers,
        bits: Bits,
    }, &.{ 1, 0, 0, 0, 0, 1, 1 });
    const Nested = @import("progressive_list.zig").VariableProgressiveListType(Variable, .{});

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 256 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    inline for (.{ Bits, Numbers, Fixed, Variable, Nested }) |ST| {
        const expected = try ST.tree.fromValue(&pool, &ST.default_value);
        defer pool.unref(expected);
        try std.testing.expectEqualSlices(u8, expected.getRoot(&pool), &ST.default_root);

        const node = try ST.tree.default(&pool);
        defer pool.unref(node);
        try std.testing.expectEqualSlices(u8, expected.getRoot(&pool), node.getRoot(&pool));
    }
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}
