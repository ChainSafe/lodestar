//! Chunked-leaf payload.
//!
//! Replaces K individual leaf Nodes with a single heap blob (chunk
//! array + length) referenced by one `.chunked_leaf` Node. Self-contained,
//! ref-counted via the Pool's Node ref count, copy-on-write on mutation.
const std = @import("std");
const hashing = @import("hashing");
const hash = hashing.hash;

// K = 2^k_log2 = 64 chunks per blob (2 KiB). Larger K folds more of the subtree
// (fewer Node.Ids, more SIMD lanes per root → faster bulk build/read) but copies the
// whole K × 32 B blob on every CoW write. Tuned with bench/ssz/list_chunked_leaf.zig
// plus the process_epoch/process_block benches: 64 wins the (bulk-read-bound, BLS-free)
// epoch ~5% over 32 and ties the BLS-dominated block; 128+ regress the CoW paths.
pub const k_log2: u8 = 6;
pub const K: u16 = 1 << k_log2;

const ChunkedLeaf = @This();

/// Chunk bytes, 64-byte aligned for cache-line locality. Chunks at indices
/// `>= len` MUST be zero-bytes — caller establishes this invariant when
/// populating `chunks`, and CoW writes preserve it. `chunks` is at offset
/// 0 within ChunkedLeaf.
chunks: [K][32]u8 align(64),
/// Number of valid chunks in this payload. The last chunked-leaf in a
/// list/vector may be partial (`len < K`); all earlier ones satisfy
/// `len == K`.
len: u16,

/// Compute the chunked_leaf subtree root: K-leaf perfect binary tree, no
/// padding. Each reduction is one batched `hash()` call so hashtree's
/// SIMD lanes stay saturated.
///
/// `scratch` is a caller-supplied K/2-element buffer, so root computation is allocation-free
/// and infallible.
///
/// First round reads `chunks` directly into `scratch` (avoids the
/// in-place mutation that `hashing.merkleize` would require on `*const
/// chunks`). Later rounds halve in-place on `scratch`.
pub fn computeRoot(self: *const ChunkedLeaf, scratch: *align(64) [K / 2][32]u8, out: *[32]u8) void {
    for (self.chunks[self.len..]) |*chunk| std.debug.assert(std.mem.allEqual(u8, chunk, 0));
    hash(scratch[0..], self.chunks[0..]) catch unreachable;

    var width: usize = K / 2;
    while (width > 1) : (width /= 2) {
        hash(scratch[0 .. width / 2], scratch[0..width]) catch unreachable;
    }

    out.* = scratch[0];
}

test {
    _ = @import("chunked_leaf_test.zig");
}
