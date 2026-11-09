const std = @import("std");
const Allocator = std.mem.Allocator;

const hashing = @import("hashing");
const Depth = hashing.Depth;

const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const Gindex = pmt.Gindex;

const isFixedType = @import("../type/type_kind.zig").isFixedType;
const progressive = @import("../type/progressive.zig");

const tree_view_root = @import("root.zig");
const TreeViewState = @import("utils/tree_view_state.zig").TreeViewState;
const CloneOpts = @import("utils/clone_opts.zig").CloneOpts;

/// Shared helpers for basic element types packed into chunks.
///
/// `use_chunked_leaf` selects between two leaf layouts:
///   * false (default) — one chunk per leaf, navigated by Node.Id.
///   * true — chunked_leaf-leaf navigation: the bottom `ChunkedLeaf.k_log2` levels of the
///     tree are folded into a single ChunkedLeaf Node, addressed at `chunked_leaf_depth =
///     chunk_depth - ChunkedLeaf.k_log2`. Reads borrow chunk bytes through
///     `Id.getChunkedLeafChunks`; writes use `TreeViewState.editChunkedLeaf`.
pub fn BasicPackedChunks(
    comptime ST: type,
    comptime chunk_depth: Depth,
    comptime items_per_chunk: usize,
    comptime use_chunked_leaf: bool,
) type {
    return struct {
        state: TreeViewState,

        pub const Element = ST.Element.Type;

        const Self = @This();

        // ChunkedLeaf-related comptime constants. Only meaningful when `use_chunked_leaf = true`.
        // The `else` placeholders keep the symbols valid in non-chunked_leaf instantiations
        // without referencing the ChunkedLeaf file.
        const ChunkedLeaf = if (use_chunked_leaf) pmt.ChunkedLeaf else struct {};
        const chunked_leaf_depth: Depth = if (use_chunked_leaf) chunk_depth - ChunkedLeaf.k_log2 else 0;

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

        pub fn get(self: *Self, index: usize) !Element {
            var value: Element = undefined;
            if (comptime use_chunked_leaf) {
                const chunk_idx = index / items_per_chunk;
                const chunked_leaf_idx = chunk_idx / ChunkedLeaf.K;
                const intra_chunk = chunk_idx % ChunkedLeaf.K;
                const chunked_leaf_id = try self.state.getChildNode(Gindex.fromDepth(chunked_leaf_depth, chunked_leaf_idx));
                // Navigation may land on a zero sentinel when the tree was built
                // empty or sparsely (early-return path in tree.fromValue, or
                // chunked_leaf_idx beyond filled chunked leaves). A zero subtree at the chunked_leaf
                // boundary is semantically an all-zero chunked_leaf; the decoded value
                // is therefore the element's zero value.
                if (self.state.pool.nodes.items(.state)[@intFromEnum(chunked_leaf_id)].kind() == .zero) {
                    return std.mem.zeroes(Element);
                }
                const chunks = try chunked_leaf_id.getChunkedLeafChunks(self.state.pool);
                ST.Element.tree.toValuePackedFromBytes(&chunks[intra_chunk], index, &value);
            } else {
                const child_node = try self.state.getChildNode(Gindex.fromDepth(chunk_depth, index / items_per_chunk));
                try ST.Element.tree.toValuePacked(child_node, self.state.pool, index, &value);
            }
            return value;
        }

        pub fn set(self: *Self, index: usize, value: Element, container_len: usize) !void {
            std.debug.assert(index < container_len);
            if (comptime use_chunked_leaf) {
                return self.setChunkedLeaf(index, value, container_len);
            }
            const gindex = Gindex.fromDepth(chunk_depth, index / items_per_chunk);
            const child_node = try self.state.getChildNode(gindex);

            const new_node = try ST.Element.tree.fromValuePacked(child_node, self.state.pool, index, &value);
            errdefer self.state.pool.unref(new_node);

            try self.state.setChildNode(gindex, new_node);
        }

        fn setChunkedLeaf(self: *Self, index: usize, value: Element, container_len: usize) !void {
            const chunk_idx = index / items_per_chunk;
            const chunked_leaf_idx = chunk_idx / ChunkedLeaf.K;
            const intra_chunk = chunk_idx % ChunkedLeaf.K;
            const intra_chunk_u16: u16 = @intCast(intra_chunk);
            const gindex = Gindex.fromDepth(chunked_leaf_depth, chunked_leaf_idx);

            // The container length determines valid chunks, including those beyond this write.
            const total_chunks = (container_len + items_per_chunk - 1) / items_per_chunk;
            const chunked_leaf_len: u16 = @intCast(@min(
                @as(usize, ChunkedLeaf.K),
                total_chunks - chunked_leaf_idx * @as(usize, ChunkedLeaf.K),
            ));

            try self.state.editChunkedLeaf(
                gindex,
                intra_chunk_u16,
                chunked_leaf_len,
                Element,
                index,
                &value,
                ST.Element.tree.fromValuePackedIntoChunk,
            );
        }

        pub fn getAll(
            self: *Self,
            allocator: Allocator,
            len: usize,
        ) ![]Element {
            const values = try allocator.alloc(Element, len);
            errdefer allocator.free(values);
            return try self.getAllInto(len, values);
        }

        pub fn getAllInto(
            self: *Self,
            len: usize,
            values: []Element,
        ) ![]Element {
            if (values.len != len) return error.InvalidSize;
            if (len == 0) return values;

            if (comptime use_chunked_leaf) {
                return self.getAllIntoChunkedLeaf(len, values);
            }

            const len_full_chunks = len / items_per_chunk;
            const remainder = len % items_per_chunk;
            const chunk_count = len_full_chunks + @intFromBool(remainder != 0);

            try self.populateAllNodes(chunk_count);

            for (0..len_full_chunks) |chunk_idx| {
                const leaf_node = try self.state.getChildNode(Gindex.fromDepth(chunk_depth, chunk_idx));
                for (0..items_per_chunk) |i| {
                    try ST.Element.tree.toValuePacked(
                        leaf_node,
                        self.state.pool,
                        i,
                        &values[chunk_idx * items_per_chunk + i],
                    );
                }
            }

            if (remainder > 0) {
                const leaf_node = try self.state.getChildNode(Gindex.fromDepth(chunk_depth, len_full_chunks));
                for (0..remainder) |i| {
                    try ST.Element.tree.toValuePacked(
                        leaf_node,
                        self.state.pool,
                        i,
                        &values[len_full_chunks * items_per_chunk + i],
                    );
                }
            }

            return values;
        }

        /// `getAllInto` for chunked_leaf layouts. `values` is caller-validated
        /// to be non-empty with `values.len == len`.
        fn getAllIntoChunkedLeaf(self: *Self, len: usize, values: []Element) ![]Element {
            const chunk_count = (len + items_per_chunk - 1) / items_per_chunk;
            const chunked_leaf_count = (chunk_count + ChunkedLeaf.K - 1) / ChunkedLeaf.K;
            const chunked_leaf_ids = try self.state.allocator.alloc(Node.Id, chunked_leaf_count);
            defer self.state.allocator.free(chunked_leaf_ids);

            try self.state.root.getNodesAtDepth(self.state.pool, chunked_leaf_depth, 0, chunked_leaf_ids);

            // Override with staged children_nodes entries so uncommitted
            // set/push are visible. The bulk root walk above sees only the
            // committed root.
            for (0..chunked_leaf_count) |i| {
                const gindex = Gindex.fromDepth(chunked_leaf_depth, i);
                if (self.state.children_nodes.get(gindex)) |staged| {
                    chunked_leaf_ids[i] = staged;
                }
            }

            var item_idx: usize = 0;
            outer: for (chunked_leaf_ids) |sid| {
                // ChunkedLeaf boundary may be a zero sentinel for sparsely-filled
                // trees (e.g. an empty list grown via push, or chunked_leaf slots
                // beyond the materialized range). A zero subtree is
                // semantically all-zero chunks; emit zero values without
                // touching the (non-existent) chunked_leaf payload.
                if (self.state.pool.nodes.items(.state)[@intFromEnum(sid)].kind() == .zero) {
                    const items_in_chunked_leaf = @min(ChunkedLeaf.K * items_per_chunk, len - item_idx);
                    @memset(values[item_idx..][0..items_in_chunked_leaf], std.mem.zeroes(Element));
                    item_idx += items_in_chunked_leaf;
                    if (item_idx >= len) break :outer;
                    continue;
                }
                const chunks_ptr = try sid.getChunkedLeafChunks(self.state.pool);
                for (0..ChunkedLeaf.K) |intra_chunk| {
                    if (item_idx >= len) break :outer;
                    const items_in_chunk = @min(items_per_chunk, len - item_idx);
                    for (0..items_in_chunk) |i| {
                        ST.Element.tree.toValuePackedFromBytes(
                            &chunks_ptr[intra_chunk],
                            item_idx + i,
                            &values[item_idx + i],
                        );
                    }
                    item_idx += items_in_chunk;
                }
            }
            return values;
        }

        fn populateAllNodes(self: *Self, chunk_count: usize) !void {
            // ChunkedLeaf path doesn't pre-populate per-chunk Ids; getAllInto walks chunked leaves
            // directly. No-op to keep external API stable.
            if (comptime use_chunked_leaf) return;

            if (chunk_count == 0) return;

            const nodes = try self.state.allocator.alloc(Node.Id, chunk_count);
            defer self.state.allocator.free(nodes);

            try self.state.root.getNodesAtDepth(self.state.pool, chunk_depth, 0, nodes);

            for (nodes, 0..) |node, chunk_idx| {
                const gindex = Gindex.fromDepth(chunk_depth, chunk_idx);
                const gop = try self.state.children_nodes.getOrPut(self.state.allocator, gindex);
                if (!gop.found_existing) {
                    gop.value_ptr.* = node;
                }
            }
        }

        pub fn getChildNode(self: *Self, gindex: Gindex) !Node.Id {
            return self.state.getChildNode(gindex);
        }

        pub fn setChildNode(self: *Self, gindex: Gindex, node: Node.Id) !void {
            try self.state.setChildNode(gindex, node);
        }

        pub fn setLength(self: *Self, length: usize) !void {
            const length_node = try self.state.pool.createLeafFromUint(@intCast(length));
            errdefer self.state.pool.unref(length_node);
            try self.state.setChildNode(@enumFromInt(3), length_node);
        }
    };
}

/// Shared helpers for composite element types, where each element occupies its own subtree.
pub fn CompositeChunks(
    comptime ST: type,
    comptime chunk_depth: Depth,
) type {
    return struct {
        state: TreeViewState,

        /// cached data for faster access of already-visited children
        children_data: std.AutoHashMapUnmanaged(Gindex, ElementPtr),

        const Element = ST.Element.TreeView;
        pub const ElementPtr = *Element;

        const Self = @This();

        pub fn elementGindex(index: usize) Gindex {
            return if (comptime ST.kind == .progressive_list)
                Gindex.concat(&.{ @enumFromInt(2), progressive.chunkGindex(index) })
            else
                Gindex.fromDepth(chunk_depth, index);
        }

        pub fn init(self: *Self, allocator: Allocator, pool: *Node.Pool, root: Node.Id) !void {
            try self.state.init(allocator, pool, root);
            self.children_data = .empty;
        }

        /// Clone, optionally moving the child-view cache to `out`. With `transfer_cache = true`,
        /// any pointer from an earlier get()/getReadonly() is invalidated — cached `changed`
        /// children get deinited (and get() counts as a change even on a read).
        pub fn clone(self: *Self, opts: CloneOpts, out: *Self) !void {
            if (!opts.transfer_cache) {
                try self.state.clone(opts, &out.state);
                out.children_data = .empty;
                return;
            }

            // Trim self's own cache first (in place): if the state clone below fails, self stays
            // valid instead of pointing at a half-modified map.
            {
                const changed_keys = self.state.changed.keys();
                for (changed_keys) |gindex| {
                    if (self.children_data.fetchRemove(gindex)) |entry| {
                        entry.value.deinit();
                    }
                }
            }

            // Clone the state — the only step here that can fail.
            try self.state.clone(opts, &out.state);

            // Now move the cache over to the clone and empty self.
            out.children_data = self.children_data;
            self.children_data = .empty;
        }

        /// Deinitialize the Data and free all associated resources.
        /// This also deinits all child Data recursively.
        pub fn deinit(self: *Self) void {
            const allocator = self.state.allocator;
            self.clearChildrenDataCache();
            self.children_data.deinit(allocator);
            self.state.deinit();
        }

        pub fn commit(self: *Self) !void {
            if (self.state.changed.count() == 0) {
                return;
            }

            const nodes = try self.state.allocator.alloc(Node.Id, self.state.changed.count());
            defer self.state.allocator.free(nodes);

            // A child can commit before a later step fails. Keep its root local until the parent
            // owns it, so replacing that child cannot leave a dangling node in the parent cache.
            for (self.state.sortedChangedGindices(), 0..) |gindex, i| {
                if (self.children_data.get(gindex)) |child_ptr| {
                    try child_ptr.commit();
                    nodes[i] = child_ptr.getRoot();
                } else {
                    nodes[i] = self.state.children_nodes.get(gindex) orelse return error.ChildNotFound;
                }
            }

            try self.state.commitStagedNodes(nodes);
        }

        pub fn clearCache(self: *Self) void {
            self.state.clearCache();
            self.clearChildrenDataCache();
        }

        /// Returns a borrowed child view owned by this cache. A later set() on the same index or a
        /// clone(transfer_cache) invalidates it — re-get() after either, and don't deinit it.
        pub fn get(self: *Self, index: usize) !ElementPtr {
            const gindex = elementGindex(index);
            // A successful mutable get always marks the child as changed, including a child cached
            // by getReadonly(). Reserve first, then publish only after all fallible work succeeds.
            if (!self.state.changed.contains(gindex)) {
                try self.state.changed.ensureUnusedCapacity(self.state.allocator, 1);
            }
            if (self.children_data.get(gindex)) |child_ptr| {
                self.state.changed.putAssumeCapacity(gindex, {});
                return child_ptr;
            }

            try self.children_data.ensureUnusedCapacity(self.state.allocator, 1);

            const child_node = try self.state.getChildNode(gindex);
            const child_ptr = try Element.init(self.state.allocator, self.state.pool, child_node);

            self.state.changed.putAssumeCapacity(gindex, {});
            self.children_data.putAssumeCapacityNoClobber(gindex, child_ptr);
            return child_ptr;
        }

        /// Takes ownership of `value` only on success; on any error `value` is left untouched for
        /// the caller to free. Deinits whatever child was cached for `index`, so any earlier
        /// get()/getReadonly() of it is now invalid. Pass a view you own — never a
        /// get()/getReadonly() pointer for this same index, or the displaced-old deinit would free a
        /// view the cache still holds (double-free).
        pub fn set(self: *Self, index: usize, value: ElementPtr) !void {
            const gindex = elementGindex(index);
            // Reserve first so the commit below cannot fail.
            try self.state.changed.ensureUnusedCapacity(self.state.allocator, 1);
            try self.children_data.ensureUnusedCapacity(self.state.allocator, 1);
            self.state.changed.putAssumeCapacity(gindex, {});
            const opt_old_data = self.children_data.fetchPutAssumeCapacity(gindex, value);
            if (opt_old_data) |old_data_value| {
                var child_ptr: ElementPtr = @constCast(&old_data_value.value.*);
                if (child_ptr != value) {
                    child_ptr.deinit();
                }
            }
        }

        /// Like get() but doesn't mark the index changed. Same borrow rules: a later set() on this
        /// index or clone(transfer_cache) invalidates the pointer; don't deinit it.
        pub fn getReadonly(self: *Self, index: usize) !ElementPtr {
            const gindex = elementGindex(index);
            if (self.children_data.get(gindex)) |child_ptr| {
                return child_ptr;
            }
            const child_node = try self.state.getChildNode(gindex);

            const child_ptr = try Element.init(self.state.allocator, self.state.pool, child_node);
            errdefer child_ptr.deinit();

            // Readonly access publishes the child cache without marking the index as changed.
            try self.children_data.putNoClobber(self.state.allocator, gindex, child_ptr);
            return child_ptr;
        }

        pub const Value = ST.Element.Type;

        /// Get a child value as an SSZ value type.
        pub fn getValue(self: *Self, allocator: Allocator, index: usize, out: *Value) !void {
            var child_view = try self.getReadonly(index);
            if (comptime isFixedType(ST.Element)) {
                try child_view.toValue(undefined, out);
            } else {
                try child_view.toValue(allocator, out);
            }
        }

        /// Set a child from an SSZ value type.
        pub fn setValue(self: *Self, index: usize, value: *const Value) !void {
            const root = try ST.Element.tree.fromValue(self.state.pool, value);
            const child_view = Element.init(self.state.allocator, self.state.pool, root) catch |err| {
                self.state.pool.unref(root);
                return err;
            };
            errdefer child_view.deinit();
            try self.set(index, child_view);
        }

        /// Get all element values in a single traversal.
        /// Caller owns the returned slice and must free it with the same allocator.
        pub fn getAllValues(self: *Self, allocator: Allocator, len: usize) ![]Value {
            const values = try allocator.alloc(Value, len);
            errdefer allocator.free(values);
            return try self.getAllValuesInto(allocator, values);
        }

        /// Fills `values` with all element values.
        pub fn getAllValuesInto(self: *Self, allocator: Allocator, values: []Value) ![]Value {
            const len = values.len;
            if (len == 0) return values;

            if (self.state.changed.count() != 0) {
                return error.MustCommitBeforeBulkRead;
            }

            const nodes = try allocator.alloc(Node.Id, len);
            defer allocator.free(nodes);

            if (comptime ST.kind == .progressive_list) {
                const contents = try self.state.root.getLeft(self.state.pool);
                var it = try progressive.NodeIterator.init(self.state.pool, contents, len);
                for (nodes) |*node| node.* = (try it.next()).?;
            } else {
                try self.state.root.getNodesAtDepth(self.state.pool, chunk_depth, 0, nodes);
            }

            for (nodes, 0..) |node, i| {
                errdefer if (comptime @hasDecl(ST.Element, "deinit")) {
                    for (values[0..i]) |*v| {
                        ST.Element.deinit(allocator, v);
                    }
                };
                if (comptime isFixedType(ST.Element)) {
                    try ST.Element.tree.toValue(node, self.state.pool, &values[i]);
                } else {
                    // Initialize value to default before toValue for variable types
                    // (e.g. BitList fields need initialized ArrayList)
                    if (comptime @hasDecl(ST.Element, "default_value")) {
                        values[i] = ST.Element.default_value;
                    } else {
                        values[i] = std.mem.zeroes(Value);
                    }
                    errdefer if (comptime @hasDecl(ST.Element, "deinit")) {
                        ST.Element.deinit(allocator, &values[i]);
                    };

                    try ST.Element.tree.toValue(allocator, node, self.state.pool, &values[i]);
                }
            }

            return values;
        }

        pub fn getChildNode(self: *Self, gindex: Gindex) !Node.Id {
            return self.state.getChildNode(gindex);
        }

        pub fn setChildNode(self: *Self, gindex: Gindex, node: Node.Id) !void {
            try self.state.setChildNode(gindex, node);
        }

        pub fn setLength(self: *Self, length: usize) !void {
            const length_node = try self.state.pool.createLeafFromUint(@intCast(length));
            errdefer self.state.pool.unref(length_node);
            try self.state.setChildNode(@enumFromInt(3), length_node);
        }

        fn clearChildrenDataCache(self: *Self) void {
            var value_iter = self.children_data.valueIterator();
            while (value_iter.next()) |child_ptr| {
                child_ptr.*.deinit();
            }
            self.children_data.clearRetainingCapacity();
        }
    };
}

test {
    _ = @import("chunks_test.zig");
}
