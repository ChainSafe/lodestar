const std = @import("std");
const CountingAllocator = @import("counting_allocator.zig").CountingAllocator;

test "reservation byte limit rejects growth without losing ownership" {
    var ledger: CountingAllocator = .{ .backing = std.testing.allocator, .byte_limit = 16 };
    const a = ledger.allocator();
    const bytes = try a.alloc(u8, 16);
    try std.testing.expectError(error.OutOfMemory, a.alloc(u8, 1));
    try std.testing.expect(!a.resize(bytes, 17));
    try std.testing.expect(a.remap(bytes, 17) == null);
    try std.testing.expectEqual(@as(usize, 16), ledger.bytes);
    a.free(bytes);
    try std.testing.expectEqual(@as(usize, 0), ledger.bytes);
}

test "reservation forwarding tracks resize remap and failure without ownership" {
    var buffer: [4096]u8 = undefined;
    var backing = std.heap.FixedBufferAllocator.init(&buffer);
    var reservation: CountingAllocator = .{ .backing = backing.allocator() };
    const allocator = reservation.allocator();
    var bytes = try allocator.alignedAlloc(u8, .@"16", 32);
    try std.testing.expectEqual(@as(usize, 32), reservation.bytes);
    try std.testing.expect(allocator.resize(bytes, 64));
    bytes = bytes.ptr[0..64];
    try std.testing.expectEqual(@as(usize, 64), reservation.bytes);
    bytes = allocator.remap(bytes, 128).?;
    try std.testing.expectEqual(@as(usize, 128), reservation.bytes);
    try std.testing.expect(!allocator.resize(bytes, 8192));
    try std.testing.expect(allocator.remap(bytes, 8192) == null);
    try std.testing.expectEqual(@as(usize, 128), reservation.bytes);
    allocator.free(bytes);
    try std.testing.expectEqual(@as(usize, 0), reservation.bytes);
}
