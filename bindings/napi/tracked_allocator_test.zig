const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const TrackedAllocator = @import("tracked_allocator.zig");

const AllocationBatch = struct {
    allocator: std.mem.Allocator,
    buffers: [256][]u8 = @splat(&.{}),
    failure: ?std.mem.Allocator.Error = null,

    fn allocate(self: *AllocationBatch) void {
        for (&self.buffers) |*buffer| {
            buffer.* = self.allocator.alloc(u8, 128) catch |err| {
                self.failure = err;
                return;
            };
            buffer.* = self.allocator.realloc(buffer.*, 64) catch |err| {
                self.failure = err;
                return;
            };
        }
    }

    fn free(self: *AllocationBatch) void {
        for (&self.buffers) |*buffer| {
            self.allocator.free(buffer.*);
            buffer.* = &.{};
        }
    }
};

test "tracks live bytes across concurrent allocations and frees" {
    const io = std.testing.io;
    var tracked: TrackedAllocator = .{ .backing = std.testing.allocator };
    var batches: [4]AllocationBatch = @splat(.{ .allocator = tracked.allocator() });
    defer for (&batches) |*batch| batch.free();

    var group: std.Io.Group = .init;
    defer group.cancel(io);

    for (&batches) |*batch| try group.concurrent(io, AllocationBatch.allocate, .{batch});
    try group.await(io);
    for (batches) |batch| if (batch.failure) |err| return err;
    try std.testing.expectEqual(4 * 256 * 64, tracked.bytesInUse());

    for (&batches) |*batch| try group.concurrent(io, AllocationBatch.free, .{batch});
    try group.await(io);
    try std.testing.expectEqual(0, tracked.bytesInUse());
}

test "tracks live bytes through allocation, resize, remap, failures, and free" {
    var buffer: [1024]u8 = undefined;
    var fixed = std.heap.FixedBufferAllocator.init(&buffer);
    var failing = std.testing.FailingAllocator.init(fixed.allocator(), .{});
    var tracked: TrackedAllocator = .{ .backing = failing.allocator() };
    const allocator = tracked.allocator();

    var bytes = try allocator.alloc(u8, 128);
    try std.testing.expectEqual(128, tracked.bytesInUse());
    const other = try allocator.alloc(u8, 32);
    try std.testing.expectEqual(160, tracked.bytesInUse());
    allocator.free(other);
    try std.testing.expectEqual(128, tracked.bytesInUse());
    try std.testing.expect(allocator.resize(bytes, 256));
    bytes = bytes.ptr[0..256];
    try std.testing.expectEqual(256, tracked.bytesInUse());
    bytes = allocator.remap(bytes, 64).?;
    try std.testing.expectEqual(64, tracked.bytesInUse());

    failing.fail_index = failing.alloc_index;
    failing.resize_fail_index = failing.resize_index;
    try std.testing.expectError(error.OutOfMemory, allocator.alloc(u8, 1));
    try std.testing.expect(!allocator.resize(bytes, 128));
    try std.testing.expectEqual(null, allocator.remap(bytes, 128));
    try std.testing.expectEqual(64, tracked.bytesInUse());

    allocator.free(bytes);
    try std.testing.expectEqual(0, tracked.bytesInUse());
}

test "shared pool payload stays charged until its last parent is released" {
    var tracked: TrackedAllocator = .{ .backing = std.testing.allocator };
    var pool = try Node.Pool.init(.{
        .allocator = tracked.allocator(),
        .page_allocator = std.testing.allocator,
        .pool_size = 3,
    });
    defer pool.deinit();
    const baseline_nodes = pool.getNodesInUse();

    const leaf = try pool.createChunkedLeafEmpty(1);
    const payload_bytes = tracked.bytesInUse();
    try std.testing.expect(payload_bytes > 0);
    const first = try pool.createBranch(leaf, leaf);
    const second = try pool.createBranch(leaf, leaf);
    try std.testing.expectEqual(payload_bytes, tracked.bytesInUse());
    try std.testing.expectEqual(baseline_nodes + 3, pool.getNodesInUse());

    pool.unref(first);
    try std.testing.expectEqual(payload_bytes, tracked.bytesInUse());
    pool.unref(second);
    try std.testing.expectEqual(0, tracked.bytesInUse());
    try std.testing.expectEqual(baseline_nodes, pool.getNodesInUse());
}
