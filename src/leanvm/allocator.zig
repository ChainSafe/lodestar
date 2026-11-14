//! The allocator behind everything leanVM allocates: `rust/leanvm` makes these two functions
//! Rust's global allocator.
//!
//! A proof allocates and frees gigabytes of large buffers. Returned to the kernel, they are
//! faulted in page by page again by the next proof, so large blocks are kept here instead, up
//! to `max_retained` bytes. Small allocations go to libc.

const std = @import("std");

/// The smallest block that is kept.
const min_pooled = 1 << 18;
/// Bytes of freed blocks kept for reuse. A block freed beyond this is unmapped.
const max_retained: usize = 4 << 30;

const Block = struct { next: ?*Block };

// libc's, as the aggregate mutex in `root.zig`.
var mutex: std.c.pthread_mutex_t = std.c.PTHREAD_MUTEX_INITIALIZER;
/// Indexed by `Class.index`.
var free_blocks: [@bitSizeOf(usize)]?*Block = @splat(null);
var retained: usize = 0;

/// A pooled block's size class, or null for a block that goes to libc. Blocks are sized up to
/// a power of two.
const Class = struct {
    index: usize,
    len: usize,

    fn of(size: usize, alignment: usize) ?Class {
        if (size < min_pooled or alignment > std.heap.page_size_min) return null;
        const index: usize = std.math.log2_int_ceil(usize, size);
        return .{ .index = index, .len = @as(usize, 1) << @intCast(index) };
    }
};

pub fn alloc(size: usize, alignment: usize) callconv(.c) ?[*]u8 {
    const class = Class.of(size, alignment) orelse
        return std.heap.c_allocator.rawAlloc(size, .fromByteUnits(alignment), @returnAddress());
    const len = class.len;
    {
        _ = std.c.pthread_mutex_lock(&mutex);
        defer _ = std.c.pthread_mutex_unlock(&mutex);
        if (free_blocks[class.index]) |block| {
            free_blocks[class.index] = block.next;
            retained -= len;
            return @ptrCast(block);
        }
    }
    const memory = std.posix.mmap(
        null,
        len,
        .{ .READ = true, .WRITE = true },
        .{ .TYPE = .PRIVATE, .ANONYMOUS = true },
        -1,
        0,
    ) catch return null;
    return memory.ptr;
}

pub fn free(ptr: [*]u8, size: usize, alignment: usize) callconv(.c) void {
    const class = Class.of(size, alignment) orelse
        return std.heap.c_allocator.rawFree(ptr[0..size], .fromByteUnits(alignment), @returnAddress());
    const len = class.len;
    {
        _ = std.c.pthread_mutex_lock(&mutex);
        defer _ = std.c.pthread_mutex_unlock(&mutex);
        if (retained + len <= max_retained) {
            const block: *Block = @ptrCast(@alignCast(ptr));
            block.next = free_blocks[class.index];
            free_blocks[class.index] = block;
            retained += len;
            return;
        }
    }
    std.posix.munmap(@alignCast(ptr[0..len]));
}
