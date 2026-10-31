const std = @import("std");
const Allocator = std.mem.Allocator;
const hashing = @import("hashing");
const Depth = hashing.Depth;
const Node = @import("persistent_merkle_tree").Node;
const Gindex = @import("persistent_merkle_tree").Gindex;
const isBasicType = @import("../type/type_kind.zig").isBasicType;
const isFixedType = @import("../type/type_kind.zig").isFixedType;

const type_root = @import("../type/root.zig");
const chunkDepth = type_root.chunkDepth;

const tree_view_root = @import("root.zig");
const CompositeChunks = @import("chunks.zig").CompositeChunks;
const assertTreeViewType = @import("utils/assert.zig").assertTreeViewType;
const CloneOpts = @import("utils/clone_opts.zig").CloneOpts;

/// A specialized tree view for SSZ list types with composite element types.
/// Each element occupies its own subtree.
pub fn ListCompositeTreeView(comptime ST: type) type {
    comptime {
        if (ST.kind != .list) {
            @compileError("ListCompositeTreeView can only be used with List types");
        }
        if (!@hasDecl(ST, "Element") or isBasicType(ST.Element)) {
            @compileError("ListCompositeTreeView can only be used with List of composite element types");
        }
        assertTreeViewType(ST.Element.TreeView);
    }

    const TreeView = struct {
        allocator: Allocator,
        chunks: Chunks,
        // the original length, before any modifications
        _orig_len: usize,
        // the current length, may differ from original until committed
        _len: usize,

        pub const SszType = ST;
        pub const Element = *ST.Element.TreeView;

        const Self = @This();

        const base_chunk_depth: Depth = @intCast(ST.chunk_depth);
        const chunk_depth: Depth = chunkDepth(Depth, base_chunk_depth, ST);
        const Chunks = CompositeChunks(ST, chunk_depth);

        pub fn init(allocator: Allocator, pool: *Node.Pool, root: Node.Id) !*Self {
            const ptr = try allocator.create(Self);
            errdefer allocator.destroy(ptr);

            ptr.allocator = allocator;
            ptr._orig_len = try ST.tree.length(root, pool);
            ptr._len = ptr._orig_len;
            try Chunks.init(&ptr.chunks, allocator, pool, root);
            return ptr;
        }

        /// Clone this list view, optionally moving its element-view cache to the clone.
        /// `transfer_cache = true` invalidates any pointer from an earlier get()/getReadonly():
        /// cached `changed` elements get deinited (and get() counts as a change even on a read).
        pub fn clone(self: *Self, opts: CloneOpts) !*Self {
            const ptr = try self.allocator.create(Self);
            errdefer self.allocator.destroy(ptr);

            try self.chunks.clone(opts, &ptr.chunks);
            ptr.allocator = self.allocator;
            ptr._orig_len = self._orig_len;
            // Uncommitted writes are dropped (from the source too on transfer), so length = committed.
            ptr._len = self._orig_len;
            if (opts.transfer_cache) self._len = self._orig_len;
            return ptr;
        }

        pub fn deinit(self: *Self) void {
            self.chunks.deinit();
            self.allocator.destroy(self);
        }

        pub fn commit(self: *Self) !void {
            try self.updateListLength();
            try self.chunks.commit();
            self._orig_len = self._len;
        }

        pub fn clearCache(self: *Self) void {
            self.chunks.clearCache();
        }

        pub fn hashTreeRootInto(self: *Self, out: *[32]u8) !void {
            try self.commit();
            out.* = self.chunks.state.root.getRoot(self.chunks.state.pool).*;
        }

        pub fn hashTreeRoot(self: *Self) !*const [32]u8 {
            try self.commit();
            return self.chunks.state.root.getRoot(self.chunks.state.pool);
        }

        pub fn fromValue(allocator: Allocator, pool: *Node.Pool, value: *const ST.Type) !*Self {
            const root = try ST.tree.fromValue(pool, value);
            errdefer pool.unref(root);
            return try Self.init(allocator, pool, root);
        }

        pub fn toValue(self: *Self, allocator: Allocator, out: *ST.Type) !void {
            try self.commit();
            try ST.tree.toValue(allocator, self.chunks.state.root, self.chunks.state.pool, out);
        }

        /// Grows the list; new positions read as zero. Shrinking must go through sliceTo —
        /// a bare length cut would leave stale chunk data in the merkleized root.
        pub fn growTo(self: *Self, new_length: usize) !void {
            if (new_length < self._len) return error.InvalidLength;
            if (new_length > ST.limit) return error.LengthOverLimit;
            self._len = new_length;
        }

        pub fn getRoot(self: *const Self) Node.Id {
            return self.chunks.state.root;
        }

        pub fn length(self: *const Self) !usize {
            return self._len;
        }

        /// Returns a borrowed element view owned by this list view. A later set() on the same index
        /// or a clone(transfer_cache) invalidates it; re-get() after either, and don't deinit it.
        pub fn get(self: *Self, index: usize) !Element {
            const list_length = try self.length();
            if (index >= list_length) return error.IndexOutOfBounds;
            return self.chunks.get(index);
        }

        /// Read-only variant of `get`; same borrow/invalidation rules apply.
        pub fn getReadonly(self: *Self, index: usize) !Element {
            const list_length = try self.length();
            if (index >= list_length) return error.IndexOutOfBounds;
            return self.chunks.getReadonly(index);
        }

        pub fn getValue(self: *Self, allocator: Allocator, index: usize, out: *ST.Element.Type) !void {
            const list_length = try self.length();
            if (index >= list_length) return error.IndexOutOfBounds;
            return self.chunks.getValue(allocator, index, out);
        }

        pub fn setValue(self: *Self, index: usize, value: *const ST.Element.Type) !void {
            const list_length = try self.length();
            if (index >= list_length) return error.IndexOutOfBounds;
            try self.chunks.setValue(index, value);
        }

        pub fn getFieldRoot(self: *Self, index: usize) !*const [32]u8 {
            const list_length = try self.length();
            if (index >= list_length) return error.IndexOutOfBounds;
            const elem = try self.chunks.get(index);
            try elem.commit();
            return elem.getRoot().getRoot(self.chunks.state.pool);
        }

        /// On success takes ownership of `value` and deinits the element cached for `index`, so any
        /// earlier get()/getReadonly() of it is now invalid. On any error (IndexOutOfBounds or a
        /// backing-store OOM) the caller keeps `value` and must free it.
        pub fn set(self: *Self, index: usize, value: Element) !void {
            const list_length = try self.length();
            if (index >= list_length) return error.IndexOutOfBounds;
            try self.chunks.set(index, value);
        }

        pub fn getAllReadonlyValues(self: *Self, allocator: Allocator) ![]ST.Element.Type {
            const list_length = try self.length();
            return self.chunks.getAllValues(allocator, list_length);
        }

        /// Appends an element to the end of the list.
        ///
        /// Ownership of the `value` TreeView transfers to the list view on success. After a
        /// successful call the caller must not deinit or use `value`; on any error the caller keeps
        /// `value` and must free it.
        pub fn push(self: *Self, value: Element) !void {
            const list_length = try self.length();
            if (list_length >= ST.limit) {
                return error.LengthOverLimit;
            }

            self._len += 1;
            errdefer self._len -= 1;

            try self.set(list_length, value);
        }

        /// Push an SSZ value type, creating a TreeView internally.
        pub fn pushValue(self: *Self, value: *const ST.Element.Type) !void {
            if ((try self.length()) >= ST.limit) return error.LengthOverLimit;

            const root = try ST.Element.tree.fromValue(self.chunks.state.pool, value);
            const child_view = ST.Element.TreeView.init(self.allocator, self.chunks.state.pool, root) catch |err| {
                self.chunks.state.pool.unref(root);
                return err;
            };
            errdefer child_view.deinit();
            try self.push(child_view);
        }

        /// Read-only iterator over committed elements. Pending `set`/`push`
        /// writes are not visible — call `commit()` first if they matter.
        pub fn iteratorReadonly(self: *const Self, start_index: usize) ReadonlyIterator {
            std.debug.assert(self.chunks.state.changed.count() == 0);
            return ReadonlyIterator.init(self, start_index);
        }

        pub const ReadonlyIterator = struct {
            tree_view: *const Self,
            depth_iterator: Node.DepthIterator,
            elem_index: usize,

            pub fn init(tree_view: *const Self, start_index: usize) ReadonlyIterator {
                return .{
                    .tree_view = tree_view,
                    .depth_iterator = Node.DepthIterator.init(
                        tree_view.chunks.state.pool,
                        tree_view.chunks.state.root,
                        chunk_depth,
                        start_index,
                    ),
                    .elem_index = start_index,
                };
            }

            /// Get the hash tree root of the next element without constructing a TreeView.
            pub fn nextRoot(self: *ReadonlyIterator) !*const [32]u8 {
                const node = try self.depth_iterator.next();
                self.elem_index += 1;
                return node.getRoot(self.tree_view.chunks.state.pool);
            }

            /// Get the next element as an SSZ value type.
            /// Picks between the non-allocating version for fixed types or
            /// the allocating version for variable-length types.
            pub const nextValue = if (isFixedType(ST.Element))
                nextValueFixed
            else
                nextValueAlloc;

            /// Inner function to get the next element as an SSZ value type.
            fn nextValueFixed(self: *ReadonlyIterator) !ST.Element.Type {
                const node = try self.depth_iterator.next();
                var value: ST.Element.Type = undefined;
                try ST.Element.tree.toValue(node, self.tree_view.chunks.state.pool, &value);
                self.elem_index += 1;
                return value;
            }

            /// Inner function to get the next element as an SSZ value type.
            ///
            /// Requires an allocator for `toValue`.
            fn nextValueAlloc(self: *ReadonlyIterator, allocator: Allocator) !ST.Element.Type {
                const node = try self.depth_iterator.next();
                // Variable-size elements: toValue reads `out` (it resizes embedded ArrayLists),
                // so initialize it before the call.
                var value: ST.Element.Type = if (comptime @hasDecl(ST.Element, "default_value"))
                    ST.Element.default_value
                else
                    std.mem.zeroes(ST.Element.Type);
                errdefer if (comptime @hasDecl(ST.Element, "deinit")) {
                    ST.Element.deinit(allocator, &value);
                };

                try ST.Element.tree.toValue(allocator, node, self.tree_view.chunks.state.pool, &value);
                self.elem_index += 1;
                return value;
            }

            /// Read-only pointer to the next element's value without copying.
            /// Only available when `ST.Element` is a `StructContainerType` —
            /// the underlying `container_struct` node already holds the value
            /// inline, so we can hand back a `*const T` directly.
            ///
            /// The pointer is valid as long as the iterator's pool retains
            /// the node (CoW mutation invalidates it). Use only for
            /// transient read passes that don't mutate the list.
            pub fn nextValuePtr(self: *ReadonlyIterator) !*const ST.Element.Type {
                if (comptime !@hasDecl(ST.Element.tree, "getValuePtr")) {
                    @compileError("nextValuePtr requires ST.Element to be a StructContainerType");
                }
                const node = try self.depth_iterator.next();
                self.elem_index += 1;
                return ST.Element.tree.getValuePtr(node, self.tree_view.chunks.state.pool);
            }
        };

        /// Return a new view containing all elements up to and including `index`.
        /// The caller **must** call `deinit()` on the returned view to avoid memory leaks.
        pub fn sliceTo(self: *Self, index: usize) !*Self {
            try self.commit();

            const list_length = try self.length();
            if (list_length == 0 or index >= list_length - 1) {
                return try Self.init(self.allocator, self.chunks.state.pool, self.chunks.state.root);
            }

            const new_length = index + 1;
            if (new_length > ST.limit) {
                return error.LengthOverLimit;
            }

            // `chunk_root` is a fresh orphan root from truncateAfterIndex; we own it, so unref it.
            const chunk_root = try Node.Id.truncateAfterIndex(self.chunks.state.root, self.chunks.state.pool, chunk_depth, index);
            defer self.chunks.state.pool.unref(chunk_root);

            var length_node: ?Node.Id = try self.chunks.state.pool.createLeafFromUint(@intCast(new_length));
            defer if (length_node) |id| self.chunks.state.pool.unref(id);

            // setNode takes `length_node` into the tree, so null it to keep the defer from
            // unref-ing what the tree now owns.
            const root_with_length = try Node.Id.setNode(chunk_root, self.chunks.state.pool, @enumFromInt(3), length_node.?);
            errdefer self.chunks.state.pool.unref(root_with_length);
            length_node = null;

            return try Self.init(self.allocator, self.chunks.state.pool, root_with_length);
        }

        /// Return a new view containing all elements from `index` to the end.
        /// The returned view must be deinitialized by the caller using `deinit()` to avoid memory leaks.
        pub fn sliceFrom(self: *Self, index: usize) !*Self {
            try self.commit();

            const list_length = try self.length();
            if (index == 0) {
                return try Self.init(self.allocator, self.chunks.state.pool, self.chunks.state.root);
            }

            const target_length = if (index >= list_length) 0 else list_length - index;

            var chunk_root: ?Node.Id = null;
            defer if (chunk_root) |id| self.chunks.state.pool.unref(id);

            if (target_length == 0) {
                chunk_root = @enumFromInt(base_chunk_depth);
            } else {
                const nodes = try self.allocator.alloc(Node.Id, target_length);
                defer self.allocator.free(nodes);
                try self.chunks.state.root.getNodesAtDepth(self.chunks.state.pool, chunk_depth, index, nodes);

                chunk_root = try Node.fillWithContents(self.chunks.state.pool, nodes, base_chunk_depth);
            }

            var length_node: ?Node.Id = try self.chunks.state.pool.createLeafFromUint(@intCast(target_length));
            defer if (length_node) |id| self.chunks.state.pool.unref(id);

            const new_root = try self.chunks.state.pool.createBranch(chunk_root.?, length_node.?);
            errdefer self.chunks.state.pool.unref(new_root);
            length_node = null;
            chunk_root = null;

            return try Self.init(self.allocator, self.chunks.state.pool, new_root);
        }

        /// Serialize the tree view into a provided buffer.
        /// Returns the number of bytes written.
        pub fn serializeIntoBytes(self: *Self, out: []u8) !usize {
            try self.commit();
            return try ST.tree.serializeIntoBytes(self.chunks.state.root, self.chunks.state.pool, out);
        }

        /// Get the serialized size of this tree view.
        pub fn serializedSize(self: *Self) !usize {
            try self.commit();
            return try ST.tree.serializedSize(self.chunks.state.root, self.chunks.state.pool);
        }

        fn updateListLength(self: *Self) !void {
            if (self._len == self._orig_len) {
                return;
            }

            std.debug.assert(self._len <= ST.limit);

            try self.chunks.setLength(self._len);
        }
    };

    assertTreeViewType(TreeView);
    return TreeView;
}

test {
    _ = @import("list_composite_test.zig");
}
