//! Storage for the chunk blobs of `.chunked_leaf` nodes.
//!
//! A chunked leaf keeps its chunks in a blob of `@sizeOf(ChunkedLeaf)` bytes outside the node
//! pool, and its pool slot holds a pointer to the blob. A state transition does not edit a blob
//! in place, because other states may still read it. It takes a new blob, copies the old one
//! into it and changes the copy. Each block therefore takes a group of blobs and hashes them for
//! the state root. The blobs return to the slab when the states that use them are dropped.
//!
//! Rationale
//!
//! A general purpose allocator reuses freed blobs in an order unrelated to their address. The
//! blobs that one block takes then spread out in memory as the process ages, and the block steps
//! that copy and hash them get slower with uptime.
//!
//! The slab owns the memory of all blobs and always hands out the free blob with the lowest
//! index, same as the rule `Node.Pool` uses. Blobs taken one after another sit next to
//! each other in memory, whatever order earlier blobs were released in.
//!
//! Layout
//!
//! Memory comes from the page allocator in segments of `chunked_leaves_per_segment` blobs. A blob
//! has an index: it is in segment `index / chunked_leaves_per_segment` at position
//! `index % chunked_leaves_per_segment`. One `FreeSlotBitmap` covers every index in the slab's
//! capacity. A set bit means the blob is free. The indexes of a segment that is not allocated yet
//! are marked in use.
//!
//! Example with `chunked_leaves_per_segment` = 4 and two segments allocated:
//!
//! ```text
//!              segment 0                   segment 1             segment 2
//! Index:     0      1      2      3      4      5      6      7      8 ...
//! Blob:   [used] [used] [free] [used] [used] [free] [free] [free]   not allocated
//! Bit:       0      0      1      0      0      1      1      1      0 ...
//!                          ^
//!                          `alloc` returns this blob
//! ```
//!
//! Operations
//!
//! `alloc` takes the lowest free index from the bitmap. When no index is free, it allocates one
//! more segment, marks the indexes of that segment free and takes the first of them. `release`
//! finds the segment whose address range contains the blob, derives the index from the offset
//! and marks it free. Starting from the example, apply these operations in order:
//!
//! ```text
//! Operation          Free indexes before    Result
//! alloc              {2, 5, 6, 7}           returns blob 2
//! release(blob 0)    {5, 6, 7}              free indexes are {0, 5, 6, 7}
//! alloc              {0, 5, 6, 7}           returns blob 0
//! alloc (3 times)    {5, 6, 7}              returns blobs 5, 6, 7
//! alloc              {}                     allocates segment 2, returns blob 8
//! ```
//!
//! Segments are added on demand until the slab can hold the `max_chunked_leaves` passed to
//! `init`. After that `alloc` returns `error.OutOfMemory`. Segments are released only by `deinit`.
//! `rawAlloc` does not write to a new segment, so the operating system backs only the pages of
//! blobs that were written.

const std = @import("std");
const Allocator = std.mem.Allocator;
const ChunkedLeaf = @import("ChunkedLeaf.zig");
const FreeSlotBitmap = @import("FreeSlotBitmap.zig");
const expensive_safety_checks = @import("root.zig").expensive_safety_checks;

const ChunkedLeafSlab = @This();

/// How many chunked leaves one segment stores.
///
/// A segment is one contiguous piece of memory from the page allocator. It holds this many
/// `ChunkedLeaf` structs side by side:
/// 1 << 14 (= 16,384) * 2,112 bytes = 33 MiB.
///
/// NOTE: This value is arbitrarily based on loose benchmarks;
/// Replaying 3,192 mainnet blocks, the state transition took 4.72 ms
/// per block with 4,096 per segment (39 segments), 4.59 ms with 16,384 (10 segments) and
/// 4.58 ms with 65,536 (3 segments). 16,384 is the smallest size where the time stops improving.
pub const chunked_leaves_per_segment = 1 << 14;

/// 1 << 14 (= 16,384) * 2,112 bytes = 33 MiB.
const segment_bytes = chunked_leaves_per_segment * @sizeOf(ChunkedLeaf);

/// One entry per segment the slab may ever hold. The first `segment_count` are allocated.
segments: [][*]ChunkedLeaf,
segment_count: u32,
free_indexes: FreeSlotBitmap,
chunked_leaves_in_use: usize,

/// Creates an empty slab that can grow to at least `max_chunked_leaves` blobs.
pub fn init(allocator: Allocator, max_chunked_leaves: u32) Allocator.Error!ChunkedLeafSlab {
    std.debug.assert(max_chunked_leaves > 0);
    const max_segments =
        (@as(usize, max_chunked_leaves) + chunked_leaves_per_segment - 1) / chunked_leaves_per_segment;
    const capacity: u32 = @intCast(max_segments * chunked_leaves_per_segment);

    const segments = try allocator.alloc([*]ChunkedLeaf, max_segments);
    errdefer allocator.free(segments);
    const free_indexes = try FreeSlotBitmap.init(allocator, capacity, capacity);
    return .{
        .segments = segments,
        .segment_count = 0,
        .free_indexes = free_indexes,
        .chunked_leaves_in_use = 0,
    };
}

pub fn deinit(self: *ChunkedLeafSlab, allocator: Allocator) void {
    for (self.segments[0..self.segment_count]) |segment| {
        const bytes: [*]u8 = @ptrCast(segment);
        allocator.rawFree(bytes[0..segment_bytes], .of(ChunkedLeaf), @returnAddress());
    }
    self.free_indexes.deinit(allocator);
    allocator.free(self.segments);
    self.* = undefined;
}

/// Returns storage for one blob. The caller must write all chunks and `len` before reading.
/// `allocator` must be the allocator passed to `init`.
pub fn alloc(self: *ChunkedLeafSlab, allocator: Allocator) Allocator.Error!*ChunkedLeaf {
    var index = self.free_indexes.lowest();
    if (index == self.free_indexes.capacity) {
        try self.addSegment(allocator);
        index = self.free_indexes.lowest();
    }
    self.free_indexes.remove(index);
    self.chunked_leaves_in_use += 1;
    const storage = &self.segments[index / chunked_leaves_per_segment][index % chunked_leaves_per_segment];
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
        const index = segment_index * chunked_leaves_per_segment + (address - start) / @sizeOf(ChunkedLeaf);
        self.free_indexes.insert(@intCast(index));
        self.chunked_leaves_in_use -= 1;
        return;
    }
    unreachable;
}

pub fn bytesInUse(self: *const ChunkedLeafSlab) usize {
    return self.chunked_leaves_in_use * @sizeOf(ChunkedLeaf);
}

fn addSegment(self: *ChunkedLeafSlab, allocator: Allocator) Allocator.Error!void {
    if (self.segment_count == self.segments.len) return error.OutOfMemory;
    // rawAlloc does not write to the memory, so the page allocator backs only the blobs in use.
    const bytes = allocator.rawAlloc(segment_bytes, .of(ChunkedLeaf), @returnAddress()) orelse {
        return error.OutOfMemory;
    };
    self.segments[self.segment_count] = @ptrCast(@alignCast(bytes));
    const first = self.segment_count * chunked_leaves_per_segment;
    self.segment_count += 1;
    for (first..first + chunked_leaves_per_segment) |index| self.free_indexes.insert(@intCast(index));
}

test {
    _ = @import("chunked_leaf_slab_test.zig");
}
