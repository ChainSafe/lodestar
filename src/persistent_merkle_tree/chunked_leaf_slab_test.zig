const std = @import("std");
const ChunkedLeaf = @import("ChunkedLeaf.zig");
const ChunkedLeafSlab = @import("ChunkedLeafSlab.zig");

test "ChunkedLeafSlab - reuses the lowest released blob first" {
    const allocator = std.testing.allocator;
    var slab = try ChunkedLeafSlab.init(allocator, 100);
    defer slab.deinit(allocator);

    var blobs: [6]*ChunkedLeaf = undefined;
    for (&blobs, 0..) |*blob, i| {
        blob.* = try slab.alloc(allocator);
        try std.testing.expect(std.mem.isAligned(@intFromPtr(blob.*), @alignOf(ChunkedLeaf)));
        if (i > 0) try std.testing.expectEqual(@intFromPtr(blobs[i - 1]) + @sizeOf(ChunkedLeaf), @intFromPtr(blob.*));
    }
    try std.testing.expectEqual(6 * @sizeOf(ChunkedLeaf), slab.bytesInUse());

    // released out of address order, handed out again in address order
    for ([_]usize{ 4, 1, 3 }) |i| slab.release(blobs[i]);
    try std.testing.expectEqual(3 * @sizeOf(ChunkedLeaf), slab.bytesInUse());
    for ([_]usize{ 1, 3, 4 }) |i| try std.testing.expectEqual(blobs[i], try slab.alloc(allocator));

    for (blobs) |blob| slab.release(blob);
    try std.testing.expectEqual(0, slab.bytesInUse());
}

test "ChunkedLeafSlab - adds a segment when the current ones are full" {
    const allocator = std.testing.allocator;
    const count = ChunkedLeafSlab.chunked_leaves_per_segment + 2;
    var slab = try ChunkedLeafSlab.init(allocator, 2 * ChunkedLeafSlab.chunked_leaves_per_segment);
    defer slab.deinit(allocator);

    const blobs = try allocator.alloc(*ChunkedLeaf, count);
    defer allocator.free(blobs);
    for (blobs) |*blob| blob.* = try slab.alloc(allocator);
    try std.testing.expectEqual(2, slab.segment_count);

    // a blob of the first segment is preferred over the free ones of the second
    slab.release(blobs[count - 1]);
    slab.release(blobs[7]);
    try std.testing.expectEqual(blobs[7], try slab.alloc(allocator));
    try std.testing.expectEqual(blobs[count - 1], try slab.alloc(allocator));

    for (blobs) |blob| slab.release(blob);
    try std.testing.expectEqual(0, slab.bytesInUse());
}

test "ChunkedLeafSlab - fails when it cannot grow" {
    const allocator = std.testing.allocator;
    var slab = try ChunkedLeafSlab.init(allocator, 1);
    defer slab.deinit(allocator);

    for (0..ChunkedLeafSlab.chunked_leaves_per_segment) |_| _ = try slab.alloc(allocator);
    try std.testing.expectError(error.OutOfMemory, slab.alloc(allocator));
}
