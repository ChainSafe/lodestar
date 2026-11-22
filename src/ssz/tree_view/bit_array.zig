const std = @import("std");
const Allocator = std.mem.Allocator;

const hashing = @import("hashing");
const Depth = hashing.Depth;

const Node = @import("persistent_merkle_tree").Node;
const Gindex = @import("persistent_merkle_tree").Gindex;
const TreeViewState = @import("utils/tree_view_state.zig").TreeViewState;
const CloneOpts = @import("utils/clone_opts.zig").CloneOpts;

/// Provides common bit array operations for both BitVectorTreeView and BitListTreeView.
pub fn BitArray(comptime chunk_depth: Depth) type {
    return struct {
        const bits_per_chunk: usize = 256;
        state: TreeViewState,

        const Self = @This();

        pub fn init(self: *Self, allocator: Allocator, pool: *Node.Pool, root: Node.Id) !void {
            try self.state.init(allocator, pool, root);
        }

        pub fn clone(self: *Self, opts: CloneOpts, out: *Self) !void {
            try self.state.clone(opts, &out.state);
        }

        pub fn deinit(self: *Self) void {
            self.state.deinit();
        }

        pub fn commit(self: *Self) !void {
            try self.state.commitNodes();
        }

        pub fn clearCache(self: *Self) void {
            self.state.clearCache();
        }

        pub fn get(self: *Self, index: usize, len: usize) !bool {
            if (index >= len) return error.IndexOutOfBounds;

            const chunk_index = index / bits_per_chunk;
            const bit_in_chunk = index % bits_per_chunk;
            const byte_in_chunk = bit_in_chunk / 8;
            const bit_in_byte: u3 = @intCast(bit_in_chunk % 8);

            const leaf_node = try self.state.getChildNode(Gindex.fromDepth(chunk_depth, chunk_index));
            const leaf = leaf_node.getRoot(self.state.pool);
            const mask = @as(u8, 1) << bit_in_byte;
            return (leaf[byte_in_chunk] & mask) != 0;
        }

        pub fn set(self: *Self, index: usize, value: bool, len: usize) !void {
            if (index >= len) return error.IndexOutOfBounds;

            const chunk_index = index / bits_per_chunk;
            const bit_in_chunk = index % bits_per_chunk;
            const byte_in_chunk = bit_in_chunk / 8;
            const bit_in_byte: u3 = @intCast(bit_in_chunk % 8);

            const gindex = Gindex.fromDepth(chunk_depth, chunk_index);
            const leaf_node = try self.state.getChildNode(gindex);
            var leaf_bytes = leaf_node.getRoot(self.state.pool).*;

            const mask = @as(u8, 1) << bit_in_byte;
            if (value) {
                leaf_bytes[byte_in_chunk] |= mask;
            } else {
                leaf_bytes[byte_in_chunk] &= ~mask;
            }

            const new_leaf = try self.state.pool.createLeaf(&leaf_bytes);
            errdefer self.state.pool.unref(new_leaf);

            try self.state.setChildNode(gindex, new_leaf);
        }

        pub fn fillBools(self: *Self, values: []bool, len: usize) !void {
            if (values.len != len) return error.InvalidSize;
            if (len == 0) return;

            const full_chunks = len / bits_per_chunk;
            const remainder_bits = len % bits_per_chunk;
            var dest = values;

            for (0..full_chunks) |chunk_idx| {
                const leaf_node = try self.state.getChildNode(Gindex.fromDepth(chunk_depth, chunk_idx));
                const leaf = leaf_node.getRoot(self.state.pool);

                for (leaf) |b| {
                    inline for (0..8) |j| {
                        dest[j] = (b & (@as(u8, 1) << j)) != 0;
                    }
                    dest = dest[8..];
                }
            }

            if (remainder_bits != 0) {
                const leaf_node = try self.state.getChildNode(Gindex.fromDepth(chunk_depth, full_chunks));
                const leaf = leaf_node.getRoot(self.state.pool);

                const full_bytes = remainder_bits / 8;
                const tail_bits = remainder_bits % 8;

                for (leaf[0..full_bytes]) |b| {
                    inline for (0..8) |j| {
                        dest[j] = (b & (@as(u8, 1) << j)) != 0;
                    }
                    dest = dest[8..];
                }

                if (tail_bits > 0) {
                    const b = leaf[full_bytes];
                    for (0..tail_bits) |j| {
                        dest[j] = (b & (@as(u8, 1) << @intCast(j))) != 0;
                    }
                }
            }
        }

        pub fn getChildNode(self: *Self, gindex: Gindex) !Node.Id {
            return self.state.getChildNode(gindex);
        }

        pub fn setChildNode(self: *Self, gindex: Gindex, node: Node.Id) !void {
            try self.state.setChildNode(gindex, node);
        }

        pub fn clearChildrenNodesCache(self: *Self) void {
            self.state.clearChildrenNodesCache();
        }
    };
}
