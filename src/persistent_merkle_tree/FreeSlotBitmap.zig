//! Fixed-capacity hierarchical bitmap of free node-pool slots.
//!
//! Slot indexes are in `0..capacity`. A set level-0 bit means the slot is free;
//! a cleared bit means it is in use. `init` requires a nonzero capacity and
//! `first_free <= capacity`. It marks `0..first_free` in use and
//! `first_free..capacity` free. Padding bits remain clear.
//!
//! `lowest` returns the lowest free slot without changing the bitmap, or
//! `capacity` when no slot is free. `remove` marks a free slot in use;
//! `insert` marks an in-use slot free. Both require `slot < capacity`.
//!
//! Each word contains 64 bits. An upper-level bit summarizes one word in the
//! level below: 1 means that word is nonzero, so it contains a free slot or a
//! path to one. The top level contains one word.
//!
//! Example: capacity 192, with only slots 67, 70, and 130 free.
//! Columns below follow increasing indexes, not binary display order.
//!
//! ```text
//! Level 1 (top):  bit 0 = 0       bit 1 = 1       bit 2 = 1
//!                    |               |               |
//! Level 0:       word 0 = 0      word 1 != 0     word 2 != 0
//! Slot indexes:     0..63          64..127         128..191
//! Free slots:       none           67, 70            130
//! ```
//!
//! `lowest` selects the least significant set bit in the top word, then
//! repeats in the selected word below. It skips empty words without scanning
//! them. In this example:
//!
//! ```text
//! Level 1: first set bit = 1  -> select level-0 word 1
//! Level 0: first set bit = 3  -> slot = 1 * 64 + 3 = 67
//! ```
//!
//! Mutations update the summary bit only when a word becomes empty or stops
//! being empty. Starting from the same example, apply these operations in order:
//!
//! ```text
//! Operation    Set-bit positions in word 1    Level-1 summary bit 1
//! remove(67)   {3, 6} -> {6}                  1 -> 1 (no update)
//! remove(70)   {6}    -> {}                   1 -> 0
//! insert(67)   {}     -> {3}                  0 -> 1
//! ```
//!
//! The same rule applies at each higher level. Propagation stops when a word
//! stays nonzero. With u32 slot indexes, lookup and mutation visit at most six
//! levels, independent of the number of slots in use.
//!
//! `init` allocates one buffer for all levels. Lookup and mutation do not
//! allocate. `deinit` frees the buffer with the allocator passed to `init`.

const std = @import("std");
const Allocator = std.mem.Allocator;

const FreeSlotBitmap = @This();

/// 64^6 slots exceed the range of a u32 slot index.
const max_levels = 6;

words: []u64,
levels: [max_levels][]u64,
level_count: u8,
capacity: u32,

/// Creates the bitmap for slots `0..capacity`, with slots `first_free..capacity` free.
pub fn init(allocator: Allocator, capacity: u32, first_free: u32) Allocator.Error!FreeSlotBitmap {
    std.debug.assert(capacity > 0);
    std.debug.assert(first_free <= capacity);

    var lens: [max_levels]usize = undefined;
    var level_count: u8 = 0;
    var total: usize = 0;
    var bits: usize = capacity;
    while (true) {
        std.debug.assert(level_count < max_levels);
        const len = (bits + 63) / 64;
        lens[level_count] = len;
        total += len;
        level_count += 1;
        if (len == 1) break;
        bits = len;
    }

    const words = try allocator.alloc(u64, total);
    @memset(words, 0);
    var self: FreeSlotBitmap = .{ .words = words, .levels = undefined, .level_count = level_count, .capacity = capacity };
    var offset: usize = 0;
    for (lens[0..level_count], 0..) |len, level| {
        self.levels[level] = words[offset..][0..len];
        offset += len;
    }

    const level0 = self.levels[0];
    var slot: usize = first_free;
    while (slot < capacity and slot % 64 != 0) : (slot += 1) level0[slot / 64] |= bit(slot);
    while (slot + 64 <= capacity) : (slot += 64) level0[slot / 64] = std.math.maxInt(u64);
    while (slot < capacity) : (slot += 1) level0[slot / 64] |= bit(slot);
    for (1..level_count) |level| {
        for (self.levels[level - 1], 0..) |word, i| {
            if (word != 0) self.levels[level][i / 64] |= bit(i);
        }
    }
    return self;
}

pub fn deinit(self: *FreeSlotBitmap, allocator: Allocator) void {
    allocator.free(self.words);
    self.* = undefined;
}

/// Returns the lowest free slot, or `capacity` when no slot is free.
pub fn lowest(self: *const FreeSlotBitmap) u32 {
    var level: usize = self.level_count - 1;
    if (self.levels[level][0] == 0) return self.capacity;
    var index: usize = 0;
    while (true) : (level -= 1) {
        const word = self.levels[level][index];
        std.debug.assert(word != 0);
        index = index * 64 + @ctz(word);
        if (level == 0) return @intCast(index);
    }
}

/// Marks `slot` free. The slot must be in use.
pub fn insert(self: *FreeSlotBitmap, slot: u32) void {
    std.debug.assert(slot < self.capacity);
    var index: usize = slot;
    std.debug.assert(self.levels[0][index / 64] & bit(index) == 0);
    for (self.levels[0..self.level_count]) |level_words| {
        const word = &level_words[index / 64];
        const was_empty = word.* == 0;
        word.* |= bit(index);
        if (!was_empty) return;
        index /= 64;
    }
}

/// Marks `slot` in use. The slot must be free.
pub fn remove(self: *FreeSlotBitmap, slot: u32) void {
    std.debug.assert(slot < self.capacity);
    var index: usize = slot;
    std.debug.assert(self.levels[0][index / 64] & bit(index) != 0);
    for (self.levels[0..self.level_count]) |level_words| {
        const word = &level_words[index / 64];
        word.* &= ~bit(index);
        if (word.* != 0) return;
        index /= 64;
    }
}

inline fn bit(index: usize) u64 {
    return @as(u64, 1) << @intCast(index % 64);
}

test {
    _ = @import("free_slot_bitmap_test.zig");
}
