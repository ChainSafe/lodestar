//! Tracks live allocation bytes for V8 memory accounting.
//! Thread-safe when the backing allocator is thread-safe.

const std = @import("std");
const Allocator = std.mem.Allocator;
const Alignment = std.mem.Alignment;
const TrackedAllocator = @This();

backing: Allocator,
bytes_in_use: std.atomic.Value(usize) = .init(0),

pub fn bytesInUse(self: *const TrackedAllocator) usize {
    return self.bytes_in_use.load(.monotonic);
}

pub fn allocator(self: *TrackedAllocator) Allocator {
    return .{ .ptr = self, .vtable = &.{
        .alloc = alloc,
        .resize = resize,
        .remap = remap,
        .free = free,
    } };
}

fn alloc(ctx: *anyopaque, len: usize, alignment: Alignment, return_address: usize) ?[*]u8 {
    const self: *TrackedAllocator = @ptrCast(@alignCast(ctx));
    const result = self.backing.rawAlloc(len, alignment, return_address) orelse return null;
    _ = self.bytes_in_use.fetchAdd(len, .monotonic);
    return result;
}

fn resize(ctx: *anyopaque, memory: []u8, alignment: Alignment, new_len: usize, return_address: usize) bool {
    const self: *TrackedAllocator = @ptrCast(@alignCast(ctx));
    if (!self.backing.rawResize(memory, alignment, new_len, return_address)) return false;
    self.recordResize(memory.len, new_len);
    return true;
}

fn remap(ctx: *anyopaque, memory: []u8, alignment: Alignment, new_len: usize, return_address: usize) ?[*]u8 {
    const self: *TrackedAllocator = @ptrCast(@alignCast(ctx));
    const result = self.backing.rawRemap(memory, alignment, new_len, return_address) orelse return null;
    self.recordResize(memory.len, new_len);
    return result;
}

fn free(ctx: *anyopaque, memory: []u8, alignment: Alignment, return_address: usize) void {
    const self: *TrackedAllocator = @ptrCast(@alignCast(ctx));
    self.backing.rawFree(memory, alignment, return_address);
    const previous = self.bytes_in_use.fetchSub(memory.len, .monotonic);
    std.debug.assert(previous >= memory.len);
}

fn recordResize(self: *TrackedAllocator, old_len: usize, new_len: usize) void {
    if (new_len >= old_len) {
        _ = self.bytes_in_use.fetchAdd(new_len - old_len, .monotonic);
    } else {
        const previous = self.bytes_in_use.fetchSub(old_len - new_len, .monotonic);
        std.debug.assert(previous >= old_len - new_len);
    }
}

test {
    _ = @import("tracked_allocator_test.zig");
}
