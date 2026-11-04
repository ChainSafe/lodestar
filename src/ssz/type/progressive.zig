const std = @import("std");
const hashOne = @import("hashing").hashOne;
const Depth = @import("hashing").Depth;
const Node = @import("persistent_merkle_tree").Node;
const ChunkedLeaf = @import("persistent_merkle_tree").ChunkedLeaf;
const Gindex = @import("persistent_merkle_tree").Gindex;

const scaling_factor = 4;

/// Limits of a progressive tree stored as nodes. Subtree `i` holds `4^i` chunks at depth `2i`
/// below its root and hangs `i + 1` spine levels below the contents root, so its chunks sit at
/// depth `3i + 1`, which must stay addressable by a gindex. The chunk count `4^i` must also fit
/// in a `usize`.
pub const max_node_subtrees = @min(
    (@import("hashing").max_depth - 1) / 3,
    (@bitSizeOf(usize) - 1) / 2,
) + 1;
pub const max_node_chunks = blk: {
    var total: usize = 0;
    for (0..max_node_subtrees) |i| total += @as(usize, 1) << @intCast(2 * i);
    break :blk total;
};
pub const zero_leaf_bytes: [ChunkedLeaf.K * 32]u8 = @splat(0);

/// Returns the gindex of a chunk relative to the contents root, where the spine node above
/// subtree `i` is `2^(i + 1) - 1`.
pub fn chunkGindex(chunk_i: usize) Gindex {
    const subtree_i = subtreeIndex(chunk_i);
    const subtree_root = ((@as(Gindex.Uint, 1) << @intCast(subtree_i + 1)) - 1) * 2;
    const offset = chunk_i - subtreeStartChunk(subtree_i);
    return @enumFromInt((subtree_root << subtreeDepth(subtree_i)) + offset);
}

/// Returns the subtree holding a zero-based chunk index. Subtree `i` starts at chunk
/// `(4^i - 1) / 3`, so `i = floor(log4(3 * chunk_i + 1))`.
pub fn subtreeIndex(chunk_i: usize) usize {
    std.debug.assert(chunk_i < max_node_chunks);
    return std.math.log2_int(usize, 3 * chunk_i + 1) / 2;
}

pub fn subtreeCount(chunk_count: usize) usize {
    return if (chunk_count == 0) 0 else subtreeIndex(chunk_count - 1) + 1;
}

pub fn subtreeStartChunk(subtree_i: usize) usize {
    return ((@as(usize, 1) << @intCast(2 * subtree_i)) - 1) / 3;
}

/// Gindex of the spine node whose left child is subtree `i`, relative to the root of a
/// length-mixed progressive list or bitlist.
pub fn spineGindex(subtree_i: usize) Gindex {
    return @enumFromInt((@as(Gindex.Uint, 3) << @intCast(subtree_i)) - 1);
}

pub fn subtreeGindex(subtree_i: usize) Gindex {
    return @enumFromInt(@intFromEnum(spineGindex(subtree_i)) * 2);
}

/// Builds progressive contents from borrowed element roots; the caller keeps its references.
/// `nodes` is scratch and holds unspecified ids afterwards. The result is fresh.
pub fn contentsFromNodes(pool: *Node.Pool, nodes: []Node.Id) !Node.Id {
    if (nodes.len > max_node_chunks) return error.InputTooLong;
    var contents: Node.Id = @enumFromInt(0);
    errdefer pool.unref(contents);

    var subtree_i = subtreeCount(nodes.len);
    while (subtree_i > 0) {
        subtree_i -= 1;
        const start = subtreeStartChunk(subtree_i);
        const end = @min(start + subtreeLength(subtree_i), nodes.len);
        const depth = subtreeDepth(subtree_i);
        // Subtree 0 is a borrowed root itself. Deeper subtrees get fresh parents, and
        // `Node.fillWithContents` restores the borrowed slice if it fails.
        const subtree = if (depth == 0)
            nodes[start]
        else
            try Node.fillWithContents(pool, nodes[start..end], depth);
        contents = pool.createBranch(subtree, contents) catch |err| {
            if (depth != 0) pool.unref(subtree);
            return err;
        };
    }
    return contents;
}

/// Returns a list root whose spine grows from `old_count` to `new_count` subtrees, with zero
/// subtrees appended. The caller owns one reference to the result; `root` is unchanged.
pub fn growSpine(pool: *Node.Pool, root: Node.Id, old_count: usize, new_count: usize) !Node.Id {
    std.debug.assert(new_count > old_count);
    var tail: Node.Id = @enumFromInt(0);
    defer pool.unref(tail);

    var i = new_count;
    while (i > old_count) {
        i -= 1;
        tail = try pool.createBranch(@enumFromInt(subtreeDepth(i)), tail);
    }
    // Retain the scaffold while setNode may partially build and reclaim ancestors.
    try pool.ref(tail);
    const expanded = try root.setNode(pool, spineGindex(old_count), tail);
    try pool.ref(expanded);
    return expanded;
}

pub fn subtreeLength(subtree_i: usize) usize {
    return std.math.pow(usize, scaling_factor, subtree_i);
}

pub fn subtreeDepth(subtree_i: usize) Depth {
    return @intCast(subtree_i * std.math.log2_int(usize, scaling_factor));
}

/// Returns how many bottom levels of the subtree a chunked list stores in one chunked leaf:
/// `ChunkedLeaf.k_log2` once the subtree can hold at least `ChunkedLeaf.K` chunks, else none.
pub fn chunkedLeafOffset(subtree_i: usize) Depth {
    return if (subtreeDepth(subtree_i) >= ChunkedLeaf.k_log2) ChunkedLeaf.k_log2 else 0;
}

pub fn merkleizeChunksComptime(comptime chunk_count: usize, chunks: *const [chunk_count][32]u8, out: *[32]u8) !void {
    return merkleizeChunksBounded(chunks, out);
}

pub fn merkleizeChunks(_: std.mem.Allocator, chunks: [][32]u8, out: *[32]u8) !void {
    return merkleizeChunksBounded(chunks, out);
}

fn merkleizeChunksBounded(chunks: []const [32]u8, out: *[32]u8) !void {
    var accumulator = try MerkleAccumulator.init(chunks.len);
    for (chunks) |*chunk| try accumulator.append(chunk);
    try accumulator.finish(out);
}

/// Accumulates progressive subtrees in order with bounded scratch. `finish` consumes the result.
pub const MerkleAccumulator = struct {
    const Subtree = @import("hashing").MerkleAccumulator;
    const max_subtrees = @min(@import("hashing").max_depth, @bitSizeOf(usize) - 1) / 2 + 1;
    const max_chunks = blk: {
        var count: usize = 0;
        for (0..max_subtrees) |i| count += @as(usize, 1) << @intCast(2 * i);
        break :blk count;
    };

    roots: [max_subtrees][32]u8 = undefined,
    subtree: Subtree = Subtree.init(0),
    subtree_count: usize = 0,
    remaining: usize,
    finished: bool = false,

    pub fn init(chunk_count: usize) !MerkleAccumulator {
        if (chunk_count > max_chunks) return error.InputTooLong;
        return .{ .remaining = chunk_count };
    }

    pub fn append(self: *MerkleAccumulator, chunk: *const [32]u8) !void {
        if (self.finished) return error.InvalidState;
        if (self.remaining == 0) return error.InputTooLong;
        std.debug.assert(self.subtree_count < max_subtrees);
        try self.subtree.append(chunk);
        self.remaining -= 1;
        if (self.subtree.count == @as(usize, 1) << @intCast(2 * self.subtree_count)) {
            try self.subtree.finish(&self.roots[self.subtree_count]);
            self.subtree_count += 1;
            if (self.subtree_count < max_subtrees) {
                self.subtree = Subtree.init(@intCast(2 * self.subtree_count));
            }
        }
    }

    pub fn finish(self: *MerkleAccumulator, out: *[32]u8) !void {
        if (self.finished) return error.InvalidState;
        if (self.remaining != 0) return error.InvalidLength;
        if (self.subtree_count < max_subtrees and self.subtree.count != 0) {
            try self.subtree.finish(&self.roots[self.subtree_count]);
            self.subtree_count += 1;
        }
        out.* = @splat(0);
        var i = self.subtree_count;
        while (i > 0) {
            i -= 1;
            hashOne(out, &self.roots[i], out);
        }
        self.finished = true;
    }
};

/// Visits progressive content chunks in order. Exhaustion validates the right-spine terminator.
pub const NodeIterator = struct {
    pool: *Node.Pool,
    spine: Node.Id,
    remaining: usize,
    chunked_leaf: bool = false,
    subtree_remaining: usize = 0,
    subtree_index: usize = 0,
    leaf_offset: Depth = 0,
    iterator: Node.DepthIterator = undefined,

    pub fn init(pool: *Node.Pool, root: Node.Id, count: usize) !NodeIterator {
        if (count > max_node_chunks) return error.InvalidSubtreeLength;
        return .{ .pool = pool, .spine = root, .remaining = count };
    }

    /// Subtrees of at least `ChunkedLeaf.K` chunks store each run of K chunks in one chunked leaf.
    pub fn initChunkedLeaf(pool: *Node.Pool, root: Node.Id, count: usize) !NodeIterator {
        var it = try init(pool, root, count);
        it.chunked_leaf = true;
        return it;
    }

    pub fn next(self: *NodeIterator) !?Node.Id {
        std.debug.assert(!self.chunked_leaf);
        if (self.remaining == 0) {
            try self.checkTerminator();
            return null;
        }
        if (self.subtree_remaining == 0) try self.enterSubtree();
        const node = try self.iterator.next();
        self.subtree_remaining -= 1;
        self.remaining -= 1;
        return node;
    }

    /// Borrows the packed bytes of the next leaf. Pool mutations invalidate the slice.
    pub fn nextBytes(self: *NodeIterator) !?[]const u8 {
        if (self.remaining == 0) {
            try self.checkTerminator();
            return null;
        }
        if (self.subtree_remaining == 0) try self.enterSubtree();
        const node = try self.iterator.next();
        if (self.leaf_offset == 0) {
            self.subtree_remaining -= 1;
            self.remaining -= 1;
            return node.getRoot(self.pool);
        }
        const chunk_count: usize = @min(ChunkedLeaf.K, self.subtree_remaining);
        self.subtree_remaining -= chunk_count;
        self.remaining -= chunk_count;
        const len = chunk_count * 32;
        if (node.getState(self.pool).isZero()) return zero_leaf_bytes[0..len];
        return std.mem.asBytes(try node.getChunkedLeafChunks(self.pool))[0..len];
    }

    fn checkTerminator(self: *const NodeIterator) !void {
        if (!std.mem.eql(u8, self.spine.getRoot(self.pool), zero_leaf_bytes[0..32])) {
            return error.InvalidTerminatorNode;
        }
    }

    fn enterSubtree(self: *NodeIterator) !void {
        const subtree_depth: Depth = @intCast(2 * self.subtree_index);
        const subtree_length = @as(usize, 1) << @intCast(subtree_depth);
        self.leaf_offset = if (self.chunked_leaf) chunkedLeafOffset(self.subtree_index) else 0;
        const subtree_root = if (@intFromEnum(self.spine) == 0)
            @as(Node.Id, @enumFromInt(subtree_depth))
        else blk: {
            const left = try self.spine.getLeft(self.pool);
            self.spine = try self.spine.getRight(self.pool);
            break :blk left;
        };
        self.iterator = Node.DepthIterator.init(
            self.pool,
            subtree_root,
            subtree_depth - self.leaf_offset,
            0,
        );
        self.subtree_remaining = @min(subtree_length, self.remaining);
        self.subtree_index += 1;
    }
};

/// Builds progressive subtrees with bounded scratch.
/// Call `deinit` after success or failure; a successful `finish` transfers the root to the caller.
/// Abandon the builder if a pool operation fails.
pub const TreeBuilder = struct {
    pool: *Node.Pool,
    roots: [max_node_subtrees]?Node.Id = @splat(null),
    subtree: Node.SubtreeBuilder,
    subtree_count: usize = 0,
    subtree_len: usize = 0,
    remaining: usize,
    chunked_leaf: bool = false,
    finished: bool = false,

    pub fn init(pool: *Node.Pool, chunk_count: usize) !TreeBuilder {
        if (chunk_count > max_node_chunks) return error.InputTooLong;
        return .{ .pool = pool, .subtree = Node.SubtreeBuilder.init(pool, 0), .remaining = chunk_count };
    }

    /// Subtrees of at least `ChunkedLeaf.K` chunks store each run of K chunks in one chunked leaf.
    /// Append through `appendPacked`.
    pub fn initChunkedLeaf(pool: *Node.Pool, chunk_count: usize) !TreeBuilder {
        var builder = try init(pool, chunk_count);
        builder.chunked_leaf = true;
        return builder;
    }

    pub fn deinit(self: *TreeBuilder) void {
        self.subtree.deinit();
        for (self.roots) |root| if (root) |id| self.pool.unref(id);
    }

    /// Takes ownership of a fresh, unretained root or zero node on entry, including on error.
    /// Builders from `initChunkedLeaf` take `appendPacked` instead.
    pub fn appendOwned(self: *TreeBuilder, node: Node.Id) !void {
        std.debug.assert(node.getState(self.pool).refCount() == 0);
        std.debug.assert(!self.chunked_leaf);
        if (self.finished or self.remaining == 0) {
            self.pool.unref(node);
            return error.InvalidLength;
        }
        try self.appendChunks(node, 1);
    }

    /// Returns how many chunks the next node holds, or zero once every chunk is appended.
    pub fn nextNodeChunks(self: *const TreeBuilder) usize {
        return @min(@as(usize, 1) << @intCast(self.leafOffset()), self.remaining);
    }

    /// Stores the packed bytes of the next node, `nextNodeChunks()` chunks long. Only the last
    /// node may end in a partial chunk.
    pub fn appendPacked(self: *TreeBuilder, bytes: []const u8) !void {
        const chunk_count = (bytes.len + 31) / 32;
        if (chunk_count == 0 or chunk_count != self.nextNodeChunks()) return error.InvalidLength;
        if (bytes.len % 32 != 0 and chunk_count != self.remaining) return error.InvalidLength;
        try self.appendChunks(try self.createPackedLeaf(bytes), chunk_count);
    }

    fn createPackedLeaf(self: *TreeBuilder, bytes: []const u8) !Node.Id {
        if (self.leafOffset() == 0) {
            var chunk: [32]u8 = @splat(0);
            @memcpy(chunk[0..bytes.len], bytes);
            return self.pool.createLeaf(&chunk);
        }

        const leaf = try self.pool.createChunkedLeafEmpty(@intCast((bytes.len + 31) / 32));
        errdefer self.pool.unref(leaf);

        const storage = try leaf.getChunkedLeafPtr(self.pool);
        @memcpy(std.mem.asBytes(&storage.chunks)[0..bytes.len], bytes);
        return leaf;
    }

    fn appendChunks(self: *TreeBuilder, node: Node.Id, chunk_count: usize) !void {
        std.debug.assert(self.subtree_count < max_node_subtrees);
        try self.subtree.append(node);
        self.remaining -= chunk_count;
        self.subtree_len += chunk_count;
        if (self.subtree_len == @as(usize, 1) << @intCast(2 * self.subtree_count)) {
            try self.finishSubtree();
        }
    }

    fn finishSubtree(self: *TreeBuilder) !void {
        std.debug.assert(self.subtree_len > 0);
        self.roots[self.subtree_count] = try self.subtree.finish();
        self.subtree_count += 1;
        self.subtree_len = 0;
        const leaf_offset = self.leafOffset();
        self.subtree = Node.SubtreeBuilder.initWithOffset(
            self.pool,
            @intCast(2 * self.subtree_count - leaf_offset),
            leaf_offset,
        );
    }

    fn leafOffset(self: *const TreeBuilder) Depth {
        return if (self.chunked_leaf) chunkedLeafOffset(self.subtree_count) else 0;
    }

    pub fn finish(self: *TreeBuilder) !Node.Id {
        if (self.finished) return error.InvalidState;
        if (self.remaining != 0) return error.InvalidLength;
        if (self.subtree_len != 0) try self.finishSubtree();
        var root: Node.Id = @enumFromInt(0);
        errdefer self.pool.unref(root);
        for (0..self.subtree_count) |_| {
            const i = self.subtree_count - 1;
            root = try self.pool.createBranch(self.roots[i].?, root);
            self.roots[i] = null;
            self.subtree_count -= 1;
        }
        self.finished = true;
        return root;
    }
};

test {
    _ = @import("progressive_test.zig");
}
