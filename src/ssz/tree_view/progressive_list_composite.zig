const std = @import("std");
const Allocator = std.mem.Allocator;
const Node = @import("persistent_merkle_tree").Node;
const isBasicType = @import("../type/type_kind.zig").isBasicType;
const isFixedType = @import("../type/type_kind.zig").isFixedType;
const initValue = @import("../type/value_init.zig").initValue;

const progressive = @import("../type/progressive.zig");
const CompositeChunks = @import("chunks.zig").CompositeChunks;
const assertTreeViewType = @import("utils/assert.zig").assertTreeViewType;
const CloneOpts = @import("utils/clone_opts.zig").CloneOpts;

/// A specialized tree view for SSZ list types with composite element types.
/// Each element occupies its own subtree.
pub fn ProgressiveListCompositeTreeView(comptime ST: type) type {
    comptime {
        if (ST.kind != .progressive_list) {
            @compileError("ProgressiveListCompositeTreeView can only be used with List types");
        }
        if (!@hasDecl(ST, "Element") or isBasicType(ST.Element)) {
            @compileError("ProgressiveListCompositeTreeView can only be used with List of composite element types");
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

        const Chunks = CompositeChunks(ST, 0);

        // A newly grown composite position must contain the element's default root, which
        // need not be the zero chunk (notably packed validators and variable containers).
        fn ensureDefault(self: *Self, index: usize) !void {
            if (index < self._orig_len) return;
            const gindex = Chunks.elementGindex(index);
            if (self.chunks.children_data.contains(gindex) or self.chunks.state.children_nodes.contains(gindex)) return;
            try self.chunks.setValue(index, &ST.Element.default_value);
        }

        pub fn init(allocator: Allocator, pool: *Node.Pool, root: Node.Id) !*Self {
            const len = try ST.tree.length(root, pool);
            if (len > ST.limit) return error.LengthOverLimit;

            const ptr = try allocator.create(Self);
            errdefer allocator.destroy(ptr);

            ptr.allocator = allocator;
            ptr._orig_len = len;
            ptr._len = len;
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

        /// Publishes growth and child changes together. A failed commit retains the old root
        /// and all staged children so callers can retry or clear the cache safely.
        pub fn commit(self: *Self) !void {
            for (self._orig_len..self._len) |index| try self.ensureDefault(index);
            try self.updateListLength();
            const pool = self.chunks.state.pool;
            const old_count = progressive.subtreeCount(self._orig_len);
            const new_count = progressive.subtreeCount(self._len);
            if (old_count == new_count) {
                try self.chunks.commit();
            } else {
                const expanded = try progressive.growSpine(pool, self.chunks.state.root, old_count, new_count);
                const original = self.chunks.state.root;
                self.chunks.state.root = expanded;
                errdefer {
                    pool.unref(self.chunks.state.root);
                    self.chunks.state.root = original;
                }
                try self.chunks.commit();
                pool.unref(original);
            }
            self._orig_len = self._len;
        }

        pub fn clearCache(self: *Self) void {
            self.chunks.clearCache();
            self._len = self._orig_len;
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

        /// Grows the list; new positions read as the element's default value. Shrinking uses sliceTo:
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
            try self.ensureDefault(index);
            return self.chunks.get(index);
        }

        /// Read-only variant of `get`; same borrow/invalidation rules apply. Reading a newly
        /// grown position can cache its default value, but does not publish the staged growth.
        pub fn getReadonly(self: *Self, index: usize) !Element {
            const list_length = try self.length();
            if (index >= list_length) return error.IndexOutOfBounds;
            try self.ensureDefault(index);
            return self.chunks.getReadonly(index);
        }

        pub fn getValue(self: *Self, allocator: Allocator, index: usize, out: *ST.Element.Type) !void {
            const list_length = try self.length();
            if (index >= list_length) return error.IndexOutOfBounds;
            try self.ensureDefault(index);
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
            try self.ensureDefault(index);
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
            if (self._len != self._orig_len) return error.MustCommitBeforeBulkRead;
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

        /// Read-only iterator over committed elements. Commit first; pending writes are not
        /// visible.
        pub fn iteratorReadonly(self: *const Self, start_index: usize) ReadonlyIterator {
            std.debug.assert(self.chunks.state.changed.count() == 0);
            return ReadonlyIterator.init(self, start_index);
        }

        pub const ReadonlyIterator = struct {
            tree_view: *const Self,
            depth_iterator: ?Node.DepthIterator = null,
            subtree_end: usize = 0,
            elem_index: usize,

            pub fn init(tree_view: *const Self, start_index: usize) ReadonlyIterator {
                return .{
                    .tree_view = tree_view,
                    .elem_index = start_index,
                };
            }

            fn nextNode(self: *ReadonlyIterator) !Node.Id {
                if (self.elem_index >= self.tree_view._orig_len) return error.IndexOutOfBounds;
                if (self.depth_iterator == null or self.elem_index == self.subtree_end) {
                    const subtree = progressive.subtreeIndex(self.elem_index);
                    const start = progressive.subtreeStartChunk(subtree);
                    const gindex = progressive.subtreeGindex(subtree);
                    const root = try self.tree_view.getRoot().getNode(self.tree_view.chunks.state.pool, gindex);
                    self.depth_iterator = Node.DepthIterator.init(self.tree_view.chunks.state.pool, root, progressive.subtreeDepth(subtree), self.elem_index - start);
                    self.subtree_end = start + progressive.subtreeLength(subtree);
                }
                const node = try self.depth_iterator.?.next();
                self.elem_index += 1;
                return node;
            }

            /// Get the hash tree root of the next element without constructing a TreeView.
            pub fn nextRoot(self: *ReadonlyIterator) !*const [32]u8 {
                const node = try self.nextNode();
                return node.getRoot(self.tree_view.chunks.state.pool);
            }

            /// Variable-size elements take an allocator for `toValue`.
            pub const nextValue = if (isFixedType(ST.Element))
                nextValueFixed
            else
                nextValueAlloc;

            fn nextValueFixed(self: *ReadonlyIterator) !ST.Element.Type {
                const node = try self.nextNode();
                var value: ST.Element.Type = undefined;
                try ST.Element.tree.toValue(node, self.tree_view.chunks.state.pool, &value);
                return value;
            }

            fn nextValueAlloc(self: *ReadonlyIterator, allocator: Allocator) !ST.Element.Type {
                const node = try self.nextNode();
                // Variable-size elements: toValue reads `out` (it resizes embedded ArrayLists),
                // so initialize it before the call.
                var value = initValue(ST.Element);
                errdefer if (comptime @hasDecl(ST.Element, "deinit")) {
                    ST.Element.deinit(allocator, &value);
                };

                try ST.Element.tree.toValue(allocator, node, self.tree_view.chunks.state.pool, &value);
                return value;
            }

            /// Borrows the value stored inline in a `StructContainerType` element node. Mutating
            /// the list or freeing the node invalidates the pointer.
            pub fn nextValuePtr(self: *ReadonlyIterator) !*const ST.Element.Type {
                if (comptime !@hasDecl(ST.Element.tree, "getValuePtr")) {
                    @compileError("nextValuePtr requires ST.Element to be a StructContainerType");
                }
                const node = try self.nextNode();
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
            const pool = self.chunks.state.pool;
            const last_subtree = progressive.subtreeIndex(index);
            const last_gindex = progressive.subtreeGindex(last_subtree);
            const last_root = try self.getRoot().getNode(pool, last_gindex);
            const truncated = try last_root.truncateAfterIndex(pool, progressive.subtreeDepth(last_subtree), index - progressive.subtreeStartChunk(last_subtree));
            try pool.ref(truncated);
            defer pool.unref(truncated);

            var contents = try pool.createBranch(truncated, @enumFromInt(0));
            try pool.ref(contents);
            defer pool.unref(contents);
            var i = last_subtree;
            while (i > 0) {
                i -= 1;
                const gindex = progressive.subtreeGindex(i);
                const subtree = try self.getRoot().getNode(pool, gindex);
                const next = try pool.createBranch(subtree, contents);
                try pool.ref(next);
                pool.unref(contents);
                contents = next;
            }
            const length_node = try pool.createLeafFromUint(new_length);
            try pool.ref(length_node);
            defer pool.unref(length_node);
            const root = try pool.createBranch(contents, length_node);
            errdefer pool.unref(root);
            return Self.init(self.allocator, pool, root);
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

            const pool = self.chunks.state.pool;

            const nodes = try self.allocator.alloc(Node.Id, target_length);
            defer self.allocator.free(nodes);

            var iterator = self.iteratorReadonly(@min(index, list_length));
            for (nodes) |*node| node.* = try iterator.nextNode();

            const root = try ST.tree.fromNodes(pool, nodes);
            errdefer pool.unref(root);

            return Self.init(self.allocator, pool, root);
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

        pub fn deserialize(allocator: Allocator, pool: *Node.Pool, bytes: []const u8) !*Self {
            const root = try ST.tree.deserializeFromBytes(pool, bytes);
            errdefer pool.unref(root);
            return Self.init(allocator, pool, root);
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
    _ = @import("progressive_list_composite_test.zig");
}
