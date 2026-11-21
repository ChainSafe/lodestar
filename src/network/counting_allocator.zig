const std = @import("std");

/// Counts requested bytes through the caller allocator, including dependency-owned tables.
/// Keep this owner stationary until every allocation has been returned.
pub const CountingAllocator = struct {
    backing: std.mem.Allocator,
    bytes: usize = 0,
    byte_limit: ?usize = null,

    pub fn allocator(self: *CountingAllocator) std.mem.Allocator {
        return .{ .ptr = self, .vtable = &.{
            .alloc = allocate,
            .resize = resize,
            .remap = remap,
            .free = free,
        } };
    }
    fn allocate(context: *anyopaque, len: usize, alignment: std.mem.Alignment, ret: usize) ?[*]u8 {
        const self: *CountingAllocator = @ptrCast(@alignCast(context));
        const total = std.math.add(usize, self.bytes, len) catch return null;
        if (self.byte_limit) |limit| if (total > limit) return null;
        const result = self.backing.rawAlloc(len, alignment, ret) orelse return null;
        self.bytes = total;
        return result;
    }
    fn resize(context: *anyopaque, memory: []u8, alignment: std.mem.Alignment, len: usize, ret: usize) bool {
        const self: *CountingAllocator = @ptrCast(@alignCast(context));
        std.debug.assert(self.bytes >= memory.len);
        const total = std.math.add(usize, self.bytes - memory.len, len) catch return false;
        if (self.byte_limit) |limit| if (total > limit) return false;
        if (!self.backing.rawResize(memory, alignment, len, ret)) return false;
        self.bytes = total;
        return true;
    }
    fn remap(context: *anyopaque, memory: []u8, alignment: std.mem.Alignment, len: usize, ret: usize) ?[*]u8 {
        const self: *CountingAllocator = @ptrCast(@alignCast(context));
        std.debug.assert(self.bytes >= memory.len);
        const total = std.math.add(usize, self.bytes - memory.len, len) catch return null;
        if (self.byte_limit) |limit| if (total > limit) return null;
        const result = self.backing.rawRemap(memory, alignment, len, ret) orelse return null;
        self.bytes = total;
        return result;
    }
    fn free(context: *anyopaque, memory: []u8, alignment: std.mem.Alignment, ret: usize) void {
        const self: *CountingAllocator = @ptrCast(@alignCast(context));
        std.debug.assert(self.bytes >= memory.len);
        self.backing.rawFree(memory, alignment, ret);
        self.bytes -= memory.len;
    }
};

test {
    _ = @import("counting_allocator_test.zig");
}
