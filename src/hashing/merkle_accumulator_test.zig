const std = @import("std");
const MerkleAccumulator = @import("merkle_accumulator.zig").MerkleAccumulator;
const merkleize = @import("merkleize.zig").merkleize;
const depth = @import("depth.zig");

test "MerkleAccumulator matches merkleize across batches and padding depths" {
    var source: [256][32]u8 = undefined;
    for (&source, 0..) |*chunk, i| {
        chunk.* = @splat(@truncate(i));
        std.mem.writeInt(u64, chunk[0..8], i + 1, .little);
    }
    for (0..10) |tree_depth| {
        const capacity = @as(usize, 1) << @intCast(tree_depth);
        for (0..@min(capacity, source.len) + 1) |count| {
            var scratch: [source.len][32]u8 = @splat(@splat(0));
            @memcpy(scratch[0..count], source[0..count]);
            var expected: [32]u8 = undefined;
            try merkleize(@ptrCast(scratch[0 .. (count + 1) / 2 * 2]), @intCast(tree_depth), &expected);

            var accumulator = MerkleAccumulator.init(@intCast(tree_depth));
            for (source[0..count]) |*chunk| try accumulator.append(chunk);
            var actual: [32]u8 = undefined;
            try accumulator.finish(&actual);
            try std.testing.expectEqualSlices(u8, &expected, &actual);
        }
    }
}

test "MerkleAccumulator bounds input and consumes its state on finish" {
    const chunk: [32]u8 = @splat(1);
    inline for (.{ 0, 1, 6, 7 }) |tree_depth| {
        var accumulator = MerkleAccumulator.init(tree_depth);
        for (0..@as(usize, 1) << tree_depth) |_| try accumulator.append(&chunk);
        try std.testing.expectError(error.InputTooLong, accumulator.append(&chunk));
        var out: [32]u8 = undefined;
        try accumulator.finish(&out);
        try std.testing.expectError(error.InvalidState, accumulator.append(&chunk));
        try std.testing.expectError(error.InvalidState, accumulator.finish(&out));
    }
}

test "MerkleAccumulator supports the maximum tree depth with bounded scratch" {
    var chunks: [4][32]u8 = .{ @splat(1), @splat(2), @splat(3), @splat(0) };
    var accumulator = MerkleAccumulator.init(depth.max_depth);
    for (chunks[0..3]) |*chunk| try accumulator.append(chunk);
    var actual: [32]u8 = undefined;
    try accumulator.finish(&actual);
    var expected: [32]u8 = undefined;
    try merkleize(@ptrCast(&chunks), depth.max_depth, &expected);
    try std.testing.expectEqualSlices(u8, &expected, &actual);
}

test "MerkleAccumulator pads an empty tree at the maximum depth" {
    const hashOne = @import("sha256.zig").hashOne;
    const getZeroHash = @import("zero_hash.zig").getZeroHash;
    var expected: [32]u8 = undefined;
    hashOne(&expected, getZeroHash(depth.max_depth - 1), getZeroHash(depth.max_depth - 1));
    var accumulator = MerkleAccumulator.init(depth.max_depth);
    var actual: [32]u8 = undefined;
    try accumulator.finish(&actual);
    try std.testing.expectEqualSlices(u8, &expected, &actual);
}

test "MerkleAccumulator carries across many complete batches" {
    const allocator = std.testing.allocator;
    const chunks = try allocator.alloc([32]u8, 8194);
    defer allocator.free(chunks);
    for ([_]usize{ 511, 512, 513, 4095, 4096, 4097, 8191, 8192, 8193 }) |count| {
        @memset(chunks, @splat(0));
        for (chunks[0..count], 0..) |*chunk, i| {
            std.mem.writeInt(u64, chunk[0..8], i + 1, .little);
        }
        var accumulator = MerkleAccumulator.init(14);
        for (chunks[0..count]) |*chunk| try accumulator.append(chunk);
        var actual: [32]u8 = undefined;
        try accumulator.finish(&actual);
        var expected: [32]u8 = undefined;
        try merkleize(@ptrCast(chunks[0 .. (count + 1) / 2 * 2]), 14, &expected);
        try std.testing.expectEqualSlices(u8, &expected, &actual);
    }
}
