//! Storage for the chunk blobs of `.chunked_leaf` nodes.
//!
//! Blobs live in segments taken from the page allocator, and an allocation takes the free blob with
//! the lowest index. Blobs that a block copies and reads together then stay close together in
//! memory. A general purpose allocator reuses freed blobs in an order unrelated to their address,
//! which spreads them out as the process ages and slows down the block steps that touch them.
//!
//! Segments are added on demand and released only by `deinit`.

const std = @import("std");
const Allocator = std.mem.Allocator;
const ChunkedLeaf = @import("ChunkedLeaf.zig");
const FreeSlotBitmap = @import("FreeSlotBitmap.zig");
const expensive_safety_checks = @import("root.zig").expensive_safety_checks;

const ChunkedLeafSlab = @This();

pub const segment_blocks = 1 << 14;
const segment_bytes = segment_blocks * @sizeOf(ChunkedLeaf);

/// One entry per segment the slab may ever hold. The first `segment_count` are allocated.
segments: [][*]ChunkedLeaf,
segment_count: u32,
free_blocks: FreeSlotBitmap,
blocks_in_use: usize,

/// Creates an empty slab that can grow to at least `max_blocks` blobs.
pub fn init(allocator: Allocator, max_blocks: u32) Allocator.Error!ChunkedLeafSlab {
    std.debug.assert(max_blocks > 0);
    const max_segments = (@as(usize, max_blocks) + segment_blocks - 1) / segment_blocks;
    const capacity: u32 = @intCast(max_segments * segment_blocks);

    const segments = try allocator.alloc([*]ChunkedLeaf, max_segments);
    errdefer allocator.free(segments);
    const free_blocks = try FreeSlotBitmap.init(allocator, capacity, capacity);
    return .{ .segments = segments, .segment_count = 0, .free_blocks = free_blocks, .blocks_in_use = 0 };
}

pub fn deinit(self: *ChunkedLeafSlab, allocator: Allocator) void {
    for (self.segments[0..self.segment_count]) |segment| {
        const bytes: [*]u8 = @ptrCast(segment);
        allocator.rawFree(bytes[0..segment_bytes], .of(ChunkedLeaf), @returnAddress());
    }
    self.free_blocks.deinit(allocator);
    allocator.free(self.segments);
    self.* = undefined;
}

/// Returns storage for one blob. The caller must write all chunks and `len` before reading.
/// `allocator` must be the allocator passed to `init`.
pub fn alloc(self: *ChunkedLeafSlab, allocator: Allocator) Allocator.Error!*ChunkedLeaf {
    var index = self.free_blocks.lowest();
    if (index == self.free_blocks.capacity) {
        try self.addSegment(allocator);
        index = self.free_blocks.lowest();
    }
    self.free_blocks.remove(index);
    self.blocks_in_use += 1;
    const storage = &self.segments[index / segment_blocks][index % segment_blocks];
    // Exposes a read before write, as `Allocator.create` does.
    if (expensive_safety_checks) @memset(std.mem.asBytes(storage), 0xaa);
    return storage;
}

/// Returns `storage` to the slab. `storage` must come from `alloc` and not be released yet.
pub fn release(self: *ChunkedLeafSlab, storage: *const ChunkedLeaf) void {
    const address = @intFromPtr(storage);
    for (self.segments[0..self.segment_count], 0..) |segment, segment_index| {
        const start = @intFromPtr(segment);
        if (address < start or address >= start + segment_bytes) continue;
        const index = segment_index * segment_blocks + (address - start) / @sizeOf(ChunkedLeaf);
        self.free_blocks.insert(@intCast(index));
        self.blocks_in_use -= 1;
        return;
    }
    unreachable;
}

pub fn bytesInUse(self: *const ChunkedLeafSlab) usize {
    return self.blocks_in_use * @sizeOf(ChunkedLeaf);
}

fn addSegment(self: *ChunkedLeafSlab, allocator: Allocator) Allocator.Error!void {
    if (self.segment_count == self.segments.len) return error.OutOfMemory;
    // rawAlloc does not write to the memory, so the page allocator backs only the blobs in use.
    const bytes = allocator.rawAlloc(segment_bytes, .of(ChunkedLeaf), @returnAddress()) orelse {
        return error.OutOfMemory;
    };
    self.segments[self.segment_count] = @ptrCast(@alignCast(bytes));
    const first = self.segment_count * segment_blocks;
    self.segment_count += 1;
    for (first..first + segment_blocks) |index| self.free_blocks.insert(@intCast(index));
}

test {
    _ = @import("chunked_leaf_slab_test.zig");
}
