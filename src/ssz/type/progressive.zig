const std = @import("std");
const hashOne = @import("hashing").hashOne;
const Depth = @import("hashing").Depth;
const Node = @import("persistent_merkle_tree").Node;
const Gindex = @import("persistent_merkle_tree").Gindex;

const base_count = 1;
const scaling_factor = 4;

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
        const max_subtrees = @min((@import("hashing").max_depth - 1) / 3, (@bitSizeOf(usize) - 1) / 2) + 1;
        const max_chunks = comptime blk: {
            var total: usize = 0;
            for (0..max_subtrees) |i| total += @as(usize, 1) << @intCast(2 * i);
            break :blk total;
        };
        if (count > max_chunks) return error.InvalidSubtreeLength;
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

pub fn getNodes(pool: *Node.Pool, root: Node.Id, out: []Node.Id) !void {
    const subtree_count = subtreeCount(out.len);
    var n = root;
    var l: usize = 0;
    for (0..subtree_count) |subtree_i| {
        const subtree_length = @min(subtreeLength(subtree_i), out.len - l);
        const subtree_depth = subtreeDepth(subtree_i);
        const subtree_root = n.getLeft(pool) catch |err| {
            if (@intFromEnum(n) == 0) {
                for (l..l + subtree_length) |pos| {
                    if (pos < out.len) {
                        out[pos] = @enumFromInt(0);
                    }
                }
                l += subtree_length;
                n = @enumFromInt(0);
                continue;
            }
            return err;
        };
        if (subtree_depth == 0) {
            if (subtree_length != 1) {
                return error.InvalidSubtreeLength;
            }
            out[l] = subtree_root;
        } else {
            try subtree_root.getNodesAtDepth(pool, subtree_depth, 0, out[l .. l + subtree_length]);
        }
        l += subtree_length;
        n = try n.getRight(pool);
    }

    if (!std.mem.eql(u8, &n.getRoot(pool).*, &[_]u8{0} ** 32)) {
        return error.InvalidTerminatorNode;
    }
}

pub fn fillWithContentsComptime(comptime node_count: usize, pool: *Node.Pool, nodes: *[node_count]Node.Id) !Node.Id {
    const subtree_count = comptime subtreeCount(node_count);
    var n: Node.Id = @enumFromInt(0);
    errdefer pool.unref(n);

    // Compute subtree starts at comptime
    comptime var subtree_starts: [subtree_count]usize = undefined;
    comptime {
        var pos: usize = 0;
        for (0..subtree_count) |subtree_i| {
            subtree_starts[subtree_i] = pos;
            pos += @min(subtreeLength(subtree_i), node_count - pos);
        }
    }

    // Process subtrees in reverse order
    comptime var i: usize = 0;
    inline while (i < subtree_count) : (i += 1) {
        const subtree_i = subtree_count - 1 - i;
        const st_depth = comptime subtreeDepth(subtree_i);
        const l = comptime subtree_starts[subtree_i];
        const st_length = comptime @min(subtreeLength(subtree_i), node_count - l);

        const subtree_root = try Node.fillWithContents(pool, nodes[l..][0..st_length], st_depth);
        n = try pool.createBranch(subtree_root, n);
    }

    return n;
}

pub fn fillWithContents(_: std.mem.Allocator, pool: *Node.Pool, nodes: []Node.Id) !Node.Id {
    const max_subtrees = @min((@import("hashing").max_depth - 1) / 3, (@bitSizeOf(usize) - 1) / 2) + 1;
    var subtree_starts: [max_subtrees]usize = undefined;
    var subtree_count: usize = 0;
    var pos: usize = 0;
    for (0..max_subtrees) |i| {
        if (pos == nodes.len) break;
        subtree_starts[i] = pos;
        pos += @min(@as(usize, 1) << @intCast(2 * i), nodes.len - pos);
        subtree_count += 1;
    }
    if (pos != nodes.len) return error.InputTooLong;

    var n: Node.Id = @enumFromInt(0);
    errdefer pool.unref(n);

    for (0..subtree_count) |i| {
        const subtree_i = subtree_count - 1 - i;
        const subtree_depth = subtreeDepth(subtree_i);
        const l = subtree_starts[subtree_i];
        const subtree_length = @min(subtreeLength(subtree_i), nodes.len - l);

        const subtree_root = try Node.fillWithContents(pool, nodes[l .. l + subtree_length], subtree_depth);
        n = try pool.createBranch(subtree_root, n);
    }

    return n;
}

test {
    _ = @import("progressive_test.zig");
}
