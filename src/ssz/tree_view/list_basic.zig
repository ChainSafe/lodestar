const std = @import("std");
const Allocator = std.mem.Allocator;
const hashing = @import("hashing");
const Depth = hashing.Depth;
const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const isBasicType = @import("../type/type_kind.zig").isBasicType;

const type_root = @import("../type/root.zig");
const BYTES_PER_CHUNK = type_root.BYTES_PER_CHUNK;
const itemsPerChunk = type_root.itemsPerChunk;
const chunkDepth = type_root.chunkDepth;

const BasicPackedChunks = @import("chunks.zig").BasicPackedChunks;
const assertTreeViewType = @import("utils/assert.zig").assertTreeViewType;
const CloneOpts = @import("utils/clone_opts.zig").CloneOpts;

/// A specialized tree view for SSZ list types with basic element types.
/// Elements are packed into chunks (multiple elements per leaf node).
pub fn ListBasicTreeView(comptime ST: type) type {
    comptime {
        if (ST.kind != .list) {
            @compileError("ListBasicTreeView can only be used with List types");
        }
        if (!@hasDecl(ST, "Element") or !isBasicType(ST.Element)) {
            @compileError("ListBasicTreeView can only be used with List of basic element types");
        }
    }

    const TreeView = struct {
        allocator: Allocator,
        chunks: Chunks,
        // the original length, before any modifications
        _orig_len: usize,
        // the current length, may differ from original until committed
        _len: usize,

        pub const SszType = ST;
        pub const Element = ST.Element.Type;

        const Self = @This();

        const base_chunk_depth: Depth = @intCast(ST.chunk_depth);
        const chunk_depth: Depth = chunkDepth(Depth, base_chunk_depth, ST);
        const items_per_chunk: usize = itemsPerChunk(ST.Element);
        const Chunks = BasicPackedChunks(ST, chunk_depth, items_per_chunk, ST.opts.chunked_leaf);

        // ChunkedLeaf binding — only meaningful when `ST.opts.chunked_leaf = true`;
        // the empty-struct placeholder keeps symbols valid in non-chunked_leaf
        // instantiations.
        const ChunkedLeaf = if (ST.opts.chunked_leaf) pmt.ChunkedLeaf else struct {};
        const chunked_leaf_depth: Depth = if (ST.opts.chunked_leaf) chunk_depth - ChunkedLeaf.k_log2 else 0;

        pub fn init(allocator: Allocator, pool: *Node.Pool, root: Node.Id) !*Self {
            const ptr = try allocator.create(Self);
            errdefer allocator.destroy(ptr);

            ptr.allocator = allocator;
            ptr._orig_len = try ST.tree.length(root, pool);
            ptr._len = ptr._orig_len;
            try Chunks.init(&ptr.chunks, allocator, pool, root);
            return ptr;
        }

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

        /// Grows the list; new positions read as zero. Shrinking must go through sliceTo —
        /// a bare length cut would leave stale chunk data in the merkleized root.
        pub fn growTo(self: *Self, new_length: usize) !void {
            if (new_length < self._len) return error.InvalidLength;
            if (new_length > ST.limit) return error.LengthOverLimit;
            self._len = new_length;
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
            // Non-chunked_leaf state: cached current chunk Node.Id; cleared
            // when we cross a chunk boundary so the next call fetches anew.
            elem_node: ?Node.Id,
            // Chunked_leaf state: cached chunks pointer of the current
            // ChunkedLeaf, plus a flag for the all-zero (sparse) case where
            // no payload exists. Cleared when we cross a chunked_leaf
            // boundary so the next call fetches the next ChunkedLeaf.
            current_chunks: ?*align(64) const [if (ST.opts.chunked_leaf) ChunkedLeaf.K else 1][32]u8,
            current_is_zero: bool,
            last_chunked_leaf_idx: ?usize,

            pub fn init(tree_view: *const Self, start_index: usize) ReadonlyIterator {
                if (comptime ST.opts.chunked_leaf) {
                    const start_chunk = start_index / items_per_chunk;
                    const start_chunked_leaf = start_chunk / ChunkedLeaf.K;
                    return .{
                        .tree_view = tree_view,
                        .depth_iterator = Node.DepthIterator.init(
                            tree_view.chunks.state.pool,
                            tree_view.chunks.state.root,
                            chunked_leaf_depth,
                            start_chunked_leaf,
                        ),
                        .elem_index = start_index,
                        .elem_node = null,
                        .current_chunks = null,
                        .current_is_zero = false,
                        .last_chunked_leaf_idx = null,
                    };
                } else {
                    return .{
                        .tree_view = tree_view,
                        .depth_iterator = Node.DepthIterator.init(
                            tree_view.chunks.state.pool,
                            tree_view.chunks.state.root,
                            ST.chunk_depth + 1,
                            ST.chunkIndex(start_index),
                        ),
                        .elem_index = start_index,
                        .elem_node = null,
                        .current_chunks = null,
                        .current_is_zero = false,
                        .last_chunked_leaf_idx = null,
                    };
                }
            }

            pub fn next(self: *ReadonlyIterator) !Element {
                const elem_index = self.elem_index;
                const pool = self.tree_view.chunks.state.pool;

                if (comptime ST.opts.chunked_leaf) {
                    const chunk_idx = elem_index / items_per_chunk;
                    const chunked_leaf_idx = chunk_idx / ChunkedLeaf.K;
                    const chunked_leaf_offset = chunk_idx % ChunkedLeaf.K;

                    // Fetch ChunkedLeaf if first call or just crossed a
                    // chunked_leaf boundary.
                    if (self.last_chunked_leaf_idx == null or self.last_chunked_leaf_idx.? != chunked_leaf_idx) {
                        // Each reload advances `depth_iterator` by exactly one
                        // ChunkedLeaf, so forward iteration must cross at most
                        // one boundary per step.
                        std.debug.assert(self.last_chunked_leaf_idx == null or
                            chunked_leaf_idx == self.last_chunked_leaf_idx.? + 1);
                        const sid = try self.depth_iterator.next();
                        if (pool.nodes.items(.state)[@intFromEnum(sid)].kind() == .zero) {
                            self.current_chunks = null;
                            self.current_is_zero = true;
                        } else {
                            self.current_chunks = try sid.getChunkedLeafChunks(pool);
                            self.current_is_zero = false;
                        }
                        self.last_chunked_leaf_idx = chunked_leaf_idx;
                    }

                    var value: Element = undefined;
                    if (self.current_is_zero) {
                        value = std.mem.zeroes(Element);
                    } else {
                        ST.Element.tree.toValuePackedFromBytes(
                            &self.current_chunks.?[chunked_leaf_offset],
                            elem_index,
                            &value,
                        );
                    }
                    self.elem_index += 1;
                    return value;
                }

                const n = if (self.elem_node) |node|
                    node
                else
                    try self.depth_iterator.next();
                self.elem_node = n;
                var value: Element = undefined;
                try ST.Element.tree.toValuePacked(n, pool, elem_index, &value);
                self.elem_index += 1;
                if (self.elem_index % items_per_chunk == 0) {
                    self.elem_node = null;
                }
                return value;
            }
        };

        pub fn getRoot(self: *const Self) Node.Id {
            return self.chunks.state.root;
        }

        pub fn length(self: *const Self) !usize {
            return self._len;
        }

        pub fn get(self: *Self, index: usize) !Element {
            const list_length = try self.length();
            if (index >= list_length) return error.IndexOutOfBounds;
            return self.chunks.get(index);
        }

        pub fn set(self: *Self, index: usize, value: Element) !void {
            const list_length = try self.length();
            if (index >= list_length) return error.IndexOutOfBounds;
            try self.chunks.set(index, value, list_length);
        }

        /// Caller must free the returned slice with the same allocator.
        pub fn getAll(self: *Self, allocator: ?Allocator) ![]Element {
            const list_length = try self.length();
            return try self.chunks.getAll(allocator orelse self.allocator, list_length);
        }

        pub fn getAllInto(self: *Self, values: []Element) ![]Element {
            const list_length = try self.length();
            return self.chunks.getAllInto(list_length, values);
        }

        pub fn push(self: *Self, value: Element) !void {
            const list_length = try self.length();
            if (list_length >= ST.limit) {
                return error.LengthOverLimit;
            }

            self._len += 1;
            errdefer self._len -= 1;

            try self.set(list_length, value);
        }

        /// Return a new view containing all elements up to and including `index`.
        /// Caller must call `deinit()` on the returned view to avoid memory leaks.
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

            return if (comptime ST.opts.chunked_leaf)
                self.sliceToChunkedLeaf(index, new_length)
            else
                self.sliceToPlain(index, new_length);
        }

        /// `sliceTo` for chunked_leaf layouts. Trims the boundary chunked_leaf,
        /// truncates the chunked_leaves after it, and reinstalls the length.
        fn sliceToChunkedLeaf(self: *Self, index: usize, new_length: usize) !*Self {
            const pool = self.chunks.state.pool;
            const chunk_index = index / items_per_chunk;
            const chunk_offset = index % items_per_chunk;
            const keep_bytes = (chunk_offset + 1) * ST.Element.fixed_size;
            std.debug.assert(keep_bytes > 0);
            std.debug.assert(keep_bytes <= BYTES_PER_CHUNK);

            const chunked_leaf_idx = chunk_index / ChunkedLeaf.K;
            const chunked_leaf_offset: u16 = @intCast(chunk_index % ChunkedLeaf.K);
            std.debug.assert(chunked_leaf_offset < ChunkedLeaf.K);

            const boundary = try Node.Id.getNodeAtDepth(self.chunks.state.root, pool, chunked_leaf_depth, chunked_leaf_idx);
            const boundary_kind = pool.nodes.items(.state)[@intFromEnum(boundary)].kind();

            const truncate_input: Node.Id = blk: {
                if (boundary_kind == .zero) {
                    // The boundary chunked_leaf is an all-zero subtree, so
                    // the elements we keep from it are already zero. There
                    // is nothing to trim; truncate the original tree.
                    break :blk self.chunks.state.root;
                }
                // At chunked_leaf_depth a correctly built tree only ever
                // has chunked_leaf or zero nodes; anything else is corrupt.
                std.debug.assert(boundary_kind == .chunked_leaf);

                // The boundary chunked_leaf straddles the cut. Build a
                // trimmed copy: copy chunks 0 through chunked_leaf_offset, zero the
                // unused tail bytes of chunk chunked_leaf_offset, and leave the
                // chunks after it zero. Install it, then truncate the rest.
                var trimmed_boundary: ?Node.Id = try pool.createChunkedLeafEmpty(chunked_leaf_offset + 1);
                defer if (trimmed_boundary) |id| pool.unref(id);

                {
                    const old_chunks = try boundary.getChunkedLeafChunks(pool);
                    const new_leaf = try trimmed_boundary.?.getChunkedLeafPtr(pool);
                    @memcpy(new_leaf.chunks[0 .. chunked_leaf_offset + 1], old_chunks[0 .. chunked_leaf_offset + 1]);
                    if (keep_bytes < BYTES_PER_CHUNK) {
                        @memset(new_leaf.chunks[chunked_leaf_offset][keep_bytes..], 0);
                    }
                }

                const updated = try Node.Id.setNodeAtDepth(
                    self.chunks.state.root,
                    pool,
                    chunked_leaf_depth,
                    chunked_leaf_idx,
                    trimmed_boundary.?,
                );
                trimmed_boundary = null;
                break :blk updated;
            };
            // `truncate_input` is either the original root (boundary was
            // zero, nothing allocated) or the fresh tree built above. The
            // fresh tree has refcount 0 and belongs to us; truncate and
            // setNode below do not take a ref, so hold onto it and unref
            // it when this function returns.
            const truncate_input_handle: ?Node.Id = if (boundary_kind != .zero) truncate_input else null;
            defer if (truncate_input_handle) |id| pool.unref(id);

            // Zero every chunked_leaf after chunked_leaf_idx. A node at
            // chunked_leaf_depth stands for a k_log2-deep subtree, so
            // truncate needs the k_log2 offset to pick the right zero hash.
            const new_root = try Node.Id.truncateAfterIndexWithLeafOffset(truncate_input, pool, chunked_leaf_depth, chunked_leaf_idx, ChunkedLeaf.k_log2);
            defer pool.unref(new_root);

            // truncate also zeroed the length leaf (gindex 3); reinstall it.
            var length_node: ?Node.Id = try pool.createLeafFromUint(@intCast(new_length));
            defer if (length_node) |id| pool.unref(id);

            const root_with_length = try Node.Id.setNode(new_root, pool, @enumFromInt(3), length_node.?);
            errdefer pool.unref(root_with_length);
            length_node = null;

            return try Self.init(self.allocator, pool, root_with_length);
        }

        /// `sliceTo` for non-chunked_leaf layouts. Byte-masks the boundary
        /// chunk, truncates the chunks after it, and reinstalls the length.
        fn sliceToPlain(self: *Self, index: usize, new_length: usize) !*Self {
            const pool = self.chunks.state.pool;
            const chunk_index = index / items_per_chunk;
            const chunk_offset = index % items_per_chunk;
            const keep_bytes = (chunk_offset + 1) * ST.Element.fixed_size;
            std.debug.assert(keep_bytes > 0);
            std.debug.assert(keep_bytes <= BYTES_PER_CHUNK);

            const boundary = try Node.Id.getNodeAtDepth(self.chunks.state.root, pool, chunk_depth, chunk_index);

            var chunk_bytes = boundary.getRoot(pool).*;
            if (keep_bytes < BYTES_PER_CHUNK) {
                @memset(chunk_bytes[keep_bytes..], 0);
            }

            var trimmed_boundary: ?Node.Id = try pool.createLeaf(&chunk_bytes);
            defer if (trimmed_boundary) |id| pool.unref(id);

            const updated = try Node.Id.setNodeAtDepth(
                self.chunks.state.root,
                pool,
                chunk_depth,
                chunk_index,
                trimmed_boundary.?,
            );
            // `updated` is a fresh orphan root from setNodeAtDepth; we own it, so unref it.
            defer pool.unref(updated);
            trimmed_boundary = null;

            const new_root = try Node.Id.truncateAfterIndex(updated, pool, chunk_depth, chunk_index);
            // Likewise `new_root` is a fresh orphan from truncateAfterIndex; unref it.
            defer pool.unref(new_root);

            var length_node: ?Node.Id = try pool.createLeafFromUint(@intCast(new_length));
            defer if (length_node) |id| pool.unref(id);

            // setNode takes `length_node` into the tree, so null it below to keep the defer from
            // unref-ing what the tree now owns.
            const root_with_length = try Node.Id.setNode(new_root, pool, @enumFromInt(3), length_node.?);
            errdefer pool.unref(root_with_length);
            length_node = null;

            return try Self.init(self.allocator, pool, root_with_length);
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
    _ = @import("list_basic_test.zig");
}
