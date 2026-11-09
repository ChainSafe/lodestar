const std = @import("std");
const Allocator = std.mem.Allocator;
const Node = @import("persistent_merkle_tree").Node;
const Gindex = @import("persistent_merkle_tree").Gindex;
const ChunkedLeaf = @import("persistent_merkle_tree").ChunkedLeaf;
const CloneOpts = @import("clone_opts.zig").CloneOpts;

/// Common state for tree views that use runtime gindex-based child caching.
///
/// Used by list, array, bitvector, and bitlist views (chunk-based).
/// NOT used by ContainerTreeView (which uses comptime field-indexed tuples).
pub const TreeViewState = struct {
    allocator: Allocator,
    pool: *Node.Pool,
    root: Node.Id,

    /// Nodes borrowed from `root`, or owned rc-zero replacements staged by `setChildNode`.
    children_nodes: std.AutoHashMapUnmanaged(Gindex, Node.Id),

    /// whether the corresponding child node/data has changed since the last update of the root
    changed: std.array_hash_map.Auto(Gindex, void),

    pub fn init(self: *TreeViewState, allocator: Allocator, pool: *Node.Pool, root: Node.Id) !void {
        try pool.ref(root);
        self.* = .{
            .allocator = allocator,
            .pool = pool,
            .root = root,
            .children_nodes = .empty,
            .changed = .empty,
        };
    }

    pub fn deinit(self: *TreeViewState) void {
        self.clearChildrenNodesCache();
        self.children_nodes.deinit(self.allocator);
        self.changed.deinit(self.allocator);
        self.pool.unref(self.root);
    }

    pub fn getChildNode(self: *TreeViewState, gindex: Gindex) !Node.Id {
        if (self.children_nodes.get(gindex)) |child_node| {
            return child_node;
        }

        try self.children_nodes.ensureUnusedCapacity(self.allocator, 1);
        const child_node = try self.root.getNode(self.pool, gindex);
        self.children_nodes.putAssumeCapacityNoClobber(gindex, child_node);
        return child_node;
    }

    pub fn setChildNode(self: *TreeViewState, gindex: Gindex, node: Node.Id) !void {
        if (!self.changed.contains(gindex)) {
            try self.changed.ensureUnusedCapacity(self.allocator, 1);
        }
        if (!self.children_nodes.contains(gindex)) {
            try self.children_nodes.ensureUnusedCapacity(self.allocator, 1);
        }

        self.changed.putAssumeCapacity(gindex, {});
        const opt_old_node = self.children_nodes.fetchPutAssumeCapacity(gindex, node);
        if (opt_old_node) |old_node| {
            if (old_node.value.getState(self.pool).refCount() == 0) {
                self.pool.unref(old_node.value);
            }
        }
    }

    /// Stages a packed write for the next commit, copying shared leaves and reusing pending ones.
    /// `valid_chunks` must preserve or grow the length. `write` must not retain the chunk pointer
    /// or access the pool.
    pub fn editChunkedLeaf(
        self: *TreeViewState,
        gindex: Gindex,
        intra_chunk: u16,
        valid_chunks: u16,
        comptime T: type,
        index: usize,
        value: *const T,
        comptime write: fn (*[32]u8, usize, *const T) void,
    ) !void {
        std.debug.assert(intra_chunk < valid_chunks);
        std.debug.assert(valid_chunks <= ChunkedLeaf.K);
        var node = try self.getChildNode(gindex);
        const state = node.getState(self.pool);

        if (state.kind() == .chunked_leaf and state.refCount() == 0) {
            std.debug.assert(self.changed.contains(gindex));
        } else {
            const replacement = switch (state.kind()) {
                .zero => blk: {
                    std.debug.assert(node == @as(Node.Id, @enumFromInt(ChunkedLeaf.k_log2)));
                    break :blk try self.pool.createChunkedLeafEmpty(valid_chunks);
                },
                .chunked_leaf => try self.pool.createChunkedLeaf(
                    try node.getChunkedLeafChunks(self.pool),
                    try node.getChunkedLeafLen(self.pool),
                ),
                else => return error.InvalidNode,
            };
            errdefer self.pool.unref(replacement);

            try self.setChildNode(gindex, replacement);
            node = replacement;
        }

        try node.editChunkedLeaf(self.pool, intra_chunk, valid_chunks, T, index, value, write);
    }

    pub fn commitNodes(self: *TreeViewState) !void {
        if (self.changed.count() == 0) {
            return;
        }

        const nodes = try self.allocator.alloc(Node.Id, self.changed.count());
        defer self.allocator.free(nodes);

        for (self.sortedChangedGindices(), 0..) |gindex, i| {
            nodes[i] = self.children_nodes.get(gindex) orelse return error.ChildNotFound;
        }
        try self.commitStagedNodes(nodes);
    }

    pub fn sortedChangedGindices(self: *TreeViewState) []const Gindex {
        const SortContext = struct {
            keys: []const Gindex,

            pub fn lessThan(context: @This(), a: usize, b: usize) bool {
                return @intFromEnum(context.keys[a]) < @intFromEnum(context.keys[b]);
            }
        };
        self.changed.sortUnstable(SortContext{ .keys = self.changed.keys() });
        return self.changed.keys();
    }

    /// `nodes` must match `sortedChangedGindices()`. Publishes the root and cached nodes together;
    /// on failure, both stay unchanged and the dirty set remains available for retry.
    pub fn commitStagedNodes(self: *TreeViewState, nodes: []Node.Id) !void {
        const gindices = self.changed.keys();
        std.debug.assert(nodes.len == gindices.len);
        if (nodes.len == 0) return;

        // Failed tree rebuilds can reclaim their inputs. Keep pending nodes alive until
        // publication, then drop only these temporary references, even when their count reaches zero.
        var retained: usize = 0;
        defer for (nodes[0..retained]) |node| self.pool.unrefUnsafe(node);

        for (nodes) |node| {
            try self.pool.ref(node);
            retained += 1;
        }

        const new_root = try self.root.setNodesGrouped(self.pool, gindices, nodes);
        try self.pool.ref(new_root);
        for (gindices, nodes) |gindex, node| {
            if (self.children_nodes.getPtr(gindex)) |cached| cached.* = node;
        }
        self.pool.unref(self.root);
        self.root = new_root;

        self.changed.clearRetainingCapacity();
    }

    pub fn clearChildrenNodesCache(self: *TreeViewState) void {
        var value_iter = self.children_nodes.valueIterator();
        while (value_iter.next()) |node_id_ptr| {
            const node_id = node_id_ptr.*;
            const state = node_id.getState(self.pool);
            if (state.isFree()) continue;
            if (state.refCount() == 0) {
                self.pool.unref(node_id);
            }
        }
        self.children_nodes.clearRetainingCapacity();
    }

    pub fn clearCache(self: *TreeViewState) void {
        self.clearChildrenNodesCache();
        self.changed.clearRetainingCapacity();
    }

    pub fn clone(self: *TreeViewState, opts: CloneOpts, out: *TreeViewState) !void {
        try out.init(self.allocator, self.pool, self.root);

        if (!opts.transfer_cache) {
            return;
        }

        out.children_nodes = self.children_nodes;

        for (self.changed.keys()) |gindex| {
            if (out.children_nodes.fetchRemove(gindex)) |entry| {
                const state = entry.value.getState(self.pool);
                if (!state.isFree() and state.refCount() == 0) self.pool.unref(entry.value);
            }
        }

        self.children_nodes = .empty;
        self.changed.clearRetainingCapacity();
    }
};

test {
    _ = @import("tree_view_state_test.zig");
}
