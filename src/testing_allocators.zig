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

/// OOM-injects a specific deep allocation without relying on an allocation count.
/// `FailingAllocator`'s count-based `fail_index` is brittle here — you'd have to know
/// exactly how many allocations run before the target, which shifts with internal
/// data-structure growth. Instead, route an allocation with a recognizable size
/// through this: once `armed`, the first alloc of >= `trigger_len` bytes arms
/// `target` to fail its next alloc — i.e. "fail the allocation right after this
/// distinctively-sized one" (e.g. setChildNode right after a CoW ChunkedLeaf blob).
pub const ArmOnSizeAllocator = struct {
    backing: std.mem.Allocator,
    target: *std.testing.FailingAllocator,
    trigger_len: usize,
    armed: bool = false,

    pub fn allocator(self: *ArmOnSizeAllocator) std.mem.Allocator {
        return .{ .ptr = self, .vtable = &.{ .alloc = allocFn, .resize = resizeFn, .remap = remapFn, .free = freeFn } };
    }
    fn allocFn(ctx: *anyopaque, len: usize, a: std.mem.Alignment, ra: usize) ?[*]u8 {
        const self: *ArmOnSizeAllocator = @ptrCast(@alignCast(ctx));
        const p = self.backing.rawAlloc(len, a, ra);
        if (self.armed and p != null and len >= self.trigger_len) {
            self.target.fail_index = self.target.alloc_index;
        }
        return p;
    }
    fn resizeFn(ctx: *anyopaque, memory: []u8, a: std.mem.Alignment, new_len: usize, ra: usize) bool {
        const self: *ArmOnSizeAllocator = @ptrCast(@alignCast(ctx));
        return self.backing.rawResize(memory, a, new_len, ra);
    }
    fn remapFn(ctx: *anyopaque, memory: []u8, a: std.mem.Alignment, new_len: usize, ra: usize) ?[*]u8 {
        const self: *ArmOnSizeAllocator = @ptrCast(@alignCast(ctx));
        return self.backing.rawRemap(memory, a, new_len, ra);
    }
    fn freeFn(ctx: *anyopaque, memory: []u8, a: std.mem.Alignment, ra: usize) void {
        const self: *ArmOnSizeAllocator = @ptrCast(@alignCast(ctx));
        self.backing.rawFree(memory, a, ra);
    }
};
