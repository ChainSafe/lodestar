const std = @import("std");
const depth = @import("depth.zig");
const merkleize = @import("merkleize.zig").merkleize;
const hashOne = @import("sha256.zig").hashOne;
const getZeroHash = @import("zero_hash.zig").getZeroHash;

/// Accumulates chunks in order with bounded scratch and batched hashing.
/// `finish` consumes the accumulator. Padding extends to the configured tree depth.
pub const MerkleAccumulator = struct {
    chunks: [batch_size][32]u8 align(64) = undefined,
    branches: [depth.max_depth + 1][32]u8 = undefined,
    count: depth.GindexUint = 0,
    buffered: usize = 0,
    tree_depth: depth.Depth,
    finished: bool = false,

    const batch_depth = 6;
    const batch_size = 1 << batch_depth;

    pub fn init(tree_depth: depth.Depth) MerkleAccumulator {
        return .{ .tree_depth = tree_depth };
    }

    pub fn append(self: *MerkleAccumulator, chunk: *const [32]u8) !void {
        if (self.finished) return error.InvalidState;
        const capacity = @as(depth.GindexUint, 1) << self.tree_depth;
        if (self.count == capacity) return error.InputTooLong;
        std.debug.assert(self.count < capacity);
        std.debug.assert(self.buffered < batch_size);

        self.chunks[self.buffered] = chunk.*;
        self.buffered += 1;
        self.count += 1;
        if (self.buffered == batch_size) try self.flush();
    }

    pub fn finish(self: *MerkleAccumulator, out: *[32]u8) !void {
        if (self.finished) return error.InvalidState;
        if (self.count == 0) {
            if (self.tree_depth == depth.max_depth) {
                const child = getZeroHash(self.tree_depth - 1);
                hashOne(out, child, child);
            } else {
                out.* = getZeroHash(self.tree_depth).*;
            }
            self.finished = true;
            return;
        }
        const single_batch = self.count > 0 and self.count < batch_size;
        if (self.tree_depth < batch_depth or single_batch) {
            const paired_count = (self.buffered + 1) / 2 * 2;
            @memset(self.chunks[self.buffered..paired_count], @splat(0));
            try merkleize(@ptrCast(self.chunks[0..paired_count]), self.tree_depth, out);
        } else {
            if (self.buffered != 0) try self.flush();
            var batches = (self.count + batch_size - 1) >> batch_depth;
            var root = getZeroHash(batch_depth).*;
            for (batch_depth..self.tree_depth) |level| {
                if (batches & 1 != 0) {
                    hashOne(&root, &self.branches[level], &root);
                } else {
                    hashOne(&root, &root, getZeroHash(@intCast(level)));
                }
                batches >>= 1;
            }
            std.debug.assert(batches <= 1);
            out.* = if (batches == 1) self.branches[self.tree_depth] else root;
        }
        self.finished = true;
    }

    fn flush(self: *MerkleAccumulator) !void {
        std.debug.assert(self.tree_depth >= batch_depth);
        std.debug.assert(self.buffered > 0 and self.buffered <= batch_size);
        var siblings = (self.count - self.buffered) >> batch_depth;
        const paired_count = (self.buffered + 1) / 2 * 2;
        @memset(self.chunks[self.buffered..paired_count], @splat(0));
        var root: [32]u8 = undefined;
        try merkleize(@ptrCast(self.chunks[0..paired_count]), batch_depth, &root);

        // Binary carries combine completed left subtrees with this batch on the right.
        for (batch_depth..@as(usize, self.tree_depth) + 1) |level| {
            if (siblings & 1 == 0) {
                self.branches[level] = root;
                self.buffered = 0;
                return;
            }
            hashOne(&root, &self.branches[level], &root);
            siblings >>= 1;
        }
        unreachable;
    }
};

test {
    _ = @import("merkle_accumulator_test.zig");
}
