const std = @import("std");
const hashOne = @import("hashing").hashOne;
const Depth = @import("hashing").Depth;
const Node = @import("persistent_merkle_tree").Node;
const Gindex = @import("persistent_merkle_tree").Gindex;

const base_count = 1;
const scaling_factor = 4;

// Subtree i has 2*i edges below i+1 spine edges. Hashing retains roots without traversing that spine.
// Bound the full 3*i+1 tree path and the 2*i chunk-count shift.
const max_tree_subtrees = @min((@import("hashing").max_depth - 1) / 3, (@bitSizeOf(usize) - 1) / 2) + 1;
const max_tree_chunks = blk: {
    var total: usize = 0;
    for (0..max_tree_subtrees) |i| total += @as(usize, 1) << @intCast(2 * i);
    break :blk total;
};

pub fn chunkGindex(chunk_i: usize) Gindex {
    const subtree_i = subtreeIndex(chunk_i);
    var gindex: Gindex.Uint = 1;
    var subtree_starting_index = 0;
    for (0..subtree_i) |i| {
        gindex = gindex * 2 + 1;
        subtree_starting_index += subtreeLength(i);
    }

    gindex *= 2;
    gindex *= try std.math.powi(usize, 2, subtreeDepth(subtree_i));
    gindex += chunk_i - subtree_starting_index;
    return @enumFromInt(gindex);
}

pub fn subtreeIndex(chunk_i: usize) usize {
    return subtreeCount(chunk_i + 1) - 1;
}

pub fn subtreeCount(chunk_count: usize) usize {
    var left: usize = chunk_count;
    var subtree_length: usize = base_count;
    var subtree_i: usize = 0;
    while (left > 0) {
        left -|= subtree_length;
        subtree_length *= scaling_factor;
        subtree_i += 1;
    }
    return subtree_i;
}

pub fn subtreeLength(subtree_i: usize) usize {
    return std.math.pow(usize, scaling_factor, subtree_i);
}

pub fn subtreeDepth(subtree_i: usize) Depth {
    return @intCast(subtree_i * std.math.log2_int(usize, scaling_factor));
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
    subtree_remaining: usize = 0,
    subtree_index: usize = 0,
    iterator: Node.DepthIterator = undefined,

    pub fn init(pool: *Node.Pool, root: Node.Id, count: usize) !NodeIterator {
        if (count > max_tree_chunks) return error.InvalidSubtreeLength;
        return .{ .pool = pool, .spine = root, .remaining = count };
    }

    pub fn next(self: *NodeIterator) !?Node.Id {
        if (self.remaining == 0) {
            if (!std.mem.eql(u8, self.spine.getRoot(self.pool), &@as([32]u8, @splat(0)))) {
                return error.InvalidTerminatorNode;
            }
            return null;
        }
        if (self.subtree_remaining == 0) {
            const subtree_depth: Depth = @intCast(2 * self.subtree_index);
            const subtree_length = @as(usize, 1) << @intCast(subtree_depth);
            const subtree_root = if (@intFromEnum(self.spine) == 0)
                @as(Node.Id, @enumFromInt(subtree_depth))
            else blk: {
                const left = try self.spine.getLeft(self.pool);
                self.spine = try self.spine.getRight(self.pool);
                break :blk left;
            };
            self.iterator = Node.DepthIterator.init(self.pool, subtree_root, subtree_depth, 0);
            self.subtree_remaining = @min(subtree_length, self.remaining);
            self.subtree_index += 1;
        }
        const node = try self.iterator.next();
        self.subtree_remaining -= 1;
        self.remaining -= 1;
        return node;
    }
};

/// Builds progressive subtrees with bounded scratch.
/// Call `deinit` after success or failure; a successful `finish` transfers the root to the caller.
/// Abandon the builder if a pool operation fails.
pub const TreeBuilder = struct {
    pool: *Node.Pool,
    roots: [max_tree_subtrees]?Node.Id = @splat(null),
    subtree: Node.SubtreeBuilder,
    subtree_count: usize = 0,
    subtree_len: usize = 0,
    remaining: usize,
    finished: bool = false,

    pub fn init(pool: *Node.Pool, chunk_count: usize) !TreeBuilder {
        if (chunk_count > max_tree_chunks) return error.InputTooLong;
        return .{ .pool = pool, .subtree = Node.SubtreeBuilder.init(pool, 0), .remaining = chunk_count };
    }

    pub fn deinit(self: *TreeBuilder) void {
        self.subtree.deinit();
        for (self.roots) |root| if (root) |id| self.pool.unref(id);
    }

    /// Takes ownership of a fresh, unretained root or zero node on entry, including on error.
    pub fn appendOwned(self: *TreeBuilder, node: Node.Id) !void {
        std.debug.assert(node.getState(self.pool).refCount() == 0);
        if (self.finished or self.remaining == 0) {
            self.pool.unref(node);
            return error.InvalidLength;
        }
        std.debug.assert(self.subtree_count < max_tree_subtrees);
        try self.subtree.append(node);
        self.remaining -= 1;
        self.subtree_len += 1;
        if (self.subtree_len == @as(usize, 1) << @intCast(2 * self.subtree_count)) {
            try self.finishSubtree();
        }
    }

    fn finishSubtree(self: *TreeBuilder) !void {
        std.debug.assert(self.subtree_len > 0);
        self.roots[self.subtree_count] = try self.subtree.finish();
        self.subtree_count += 1;
        self.subtree_len = 0;
        self.subtree = Node.SubtreeBuilder.init(self.pool, @intCast(2 * self.subtree_count));
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
