//! Test-only allocators shared across module test suites.
const std = @import("std");

/// A failing allocator (via std.testing.FailingAllocator) that also catches double-frees. It fails
/// the Nth alloc to inject OOM, and resize_fail_index = 0 forces every growth through alloc so the
/// failure actually lands. Freeing an address that isn't live flags `double_free` instead of
/// forwarding to the GPA (which would panic), so a test can sweep OOM points in a loop without
/// crashing on the first double-free. Liveness is tracked by raw address.
pub const DoubleFreeDetectAllocator = struct {
    failing: std.testing.FailingAllocator,
    live: std.AutoHashMap(usize, void),
    double_free: bool = false,

    pub fn init(backing: std.mem.Allocator, fail_after: usize) DoubleFreeDetectAllocator {
        return .{
            .failing = std.testing.FailingAllocator.init(backing, .{ .fail_index = fail_after, .resize_fail_index = 0 }),
            .live = std.AutoHashMap(usize, void).init(std.heap.page_allocator),
        };
    }
    pub fn deinit(self: *DoubleFreeDetectAllocator) void {
        self.live.deinit();
    }
    pub fn allocator(self: *DoubleFreeDetectAllocator) std.mem.Allocator {
        return .{ .ptr = self, .vtable = &.{ .alloc = allocFn, .resize = resizeFn, .remap = remapFn, .free = freeFn } };
    }
    fn allocFn(ctx: *anyopaque, len: usize, a: std.mem.Alignment, ra: usize) ?[*]u8 {
        const self: *DoubleFreeDetectAllocator = @ptrCast(@alignCast(ctx));
        const p = self.failing.allocator().rawAlloc(len, a, ra) orelse return null;
        self.live.put(@intFromPtr(p), {}) catch {};
        return p;
    }
    fn resizeFn(ctx: *anyopaque, memory: []u8, a: std.mem.Alignment, new_len: usize, ra: usize) bool {
        const self: *DoubleFreeDetectAllocator = @ptrCast(@alignCast(ctx));
        return self.failing.allocator().rawResize(memory, a, new_len, ra);
    }
    fn remapFn(ctx: *anyopaque, memory: []u8, a: std.mem.Alignment, new_len: usize, ra: usize) ?[*]u8 {
        const self: *DoubleFreeDetectAllocator = @ptrCast(@alignCast(ctx));
        return self.failing.allocator().rawRemap(memory, a, new_len, ra);
    }
    fn freeFn(ctx: *anyopaque, memory: []u8, a: std.mem.Alignment, ra: usize) void {
        const self: *DoubleFreeDetectAllocator = @ptrCast(@alignCast(ctx));
        if (self.live.remove(@intFromPtr(memory.ptr))) {
            self.failing.allocator().rawFree(memory, a, ra);
        } else {
            self.double_free = true; // freeing memory that is not currently live
        }
    }
};
