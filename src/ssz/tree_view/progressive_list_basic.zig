const std = @import("std");
const Allocator = std.mem.Allocator;
const hashing = @import("hashing");
const Depth = hashing.Depth;
const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const ChunkedLeaf = pmt.ChunkedLeaf;
const Gindex = pmt.Gindex;
const isBasicType = @import("../type/type_kind.zig").isBasicType;
const progressive = @import("../type/progressive.zig");
const TreeViewState = @import("utils/tree_view_state.zig").TreeViewState;
const CloneOpts = @import("utils/clone_opts.zig").CloneOpts;
const assertTreeViewType = @import("utils/assert.zig").assertTreeViewType;

/// Packed basic elements with deferred writes over progressive subtrees of 1, 4, 16, ... chunks.
pub fn ProgressiveListBasicTreeView(comptime ST: type) type {
    comptime {
        if (ST.kind != .progressive_list or !isBasicType(ST.Element)) {
            @compileError(
                "ProgressiveListBasicTreeView requires a progressive list of basic elements",
            );
        }
    }

    const TreeView = struct {
        allocator: Allocator,
        state: TreeViewState,
        _orig_len: usize,
        _len: usize,
        // Point get/set pairs and sequential inactivity-score writes often reuse the same leaf.
        // Ownership still comes from the node's current reference count when writing.
        // TODO: Measure this against the real Gloas state-transition access pattern and drop it
        // if the hit rate does not justify keeping it in the struct.
        cached_leaf: ?struct { position: Position, node: Node.Id },

        pub const SszType = ST;
        pub const Element = ST.Element.Type;

        const Self = @This();
        const items_per_chunk = 32 / ST.Element.fixed_size;
        const use_chunked_leaf = ST.opts.chunked_leaf;
        const length_gindex: Gindex = @enumFromInt(3);
        pub const max_length: usize = ST.limit;

        pub fn init(allocator: Allocator, pool: *Node.Pool, root: Node.Id) !*Self {
            const len = try ST.tree.length(root, pool);
            if (len > max_length) return error.LengthOverLimit;

            const self = try allocator.create(Self);
            errdefer allocator.destroy(self);

            try self.state.init(allocator, pool, root);
            self.allocator = allocator;
            self._orig_len = len;
            self._len = len;
            self.cached_leaf = null;
            return self;
        }

        pub fn deinit(self: *Self) void {
            self.state.deinit();
            self.allocator.destroy(self);
        }

        /// Clones the committed root. Cache transfer also discards the source's pending writes.
        pub fn clone(self: *Self, opts: CloneOpts) !*Self {
            const copy = try self.allocator.create(Self);
            errdefer self.allocator.destroy(copy);

            try self.state.clone(opts, &copy.state);
            copy.allocator = self.allocator;
            copy._orig_len = self._orig_len;
            copy._len = self._orig_len;
            copy.cached_leaf = null;
            if (opts.transfer_cache) {
                self._len = self._orig_len;
                self.cached_leaf = null;
            }
            return copy;
        }

        /// Discards pending writes and growth, retaining the cache allocations.
        pub fn clearCache(self: *Self) void {
            self.state.clearCache();
            self._len = self._orig_len;
            self.cached_leaf = null;
        }

        pub fn fromValue(allocator: Allocator, pool: *Node.Pool, value: *const ST.Type) !*Self {
            if (value.items.len > max_length) return error.LengthOverLimit;
            const root = try ST.tree.fromValue(pool, value);
            errdefer pool.unref(root);
            return Self.init(allocator, pool, root);
        }

        pub fn deserialize(allocator: Allocator, pool: *Node.Pool, bytes: []const u8) !*Self {
            const root = try ST.tree.deserializeFromBytes(pool, bytes);
            errdefer pool.unref(root);
            return Self.init(allocator, pool, root);
        }

        pub fn getRoot(self: *const Self) Node.Id {
            return self.state.root;
        }

        pub fn length(self: *const Self) !usize {
            return self._len;
        }

        /// Extends with zeros. Use sliceTo to shrink and clear the truncated contents.
        pub fn growTo(self: *Self, new_length: usize) !void {
            if (new_length < self._len) return error.InvalidLength;
            if (new_length > max_length) return error.LengthOverLimit;
            self._len = new_length;
        }

        pub fn get(self: *Self, index: usize) !Element {
            if (index >= self._len) return error.IndexOutOfBounds;
            const chunk_index = index / items_per_chunk;
            const position = self.positionForChunk(chunk_index);
            const node = try self.getLeaf(position);
            var value: Element = undefined;
            if (position.folded_depth != 0) {
                if (node.getState(self.state.pool).isZero()) return std.mem.zeroes(Element);
                const chunks = try node.getChunkedLeafChunks(self.state.pool);
                ST.Element.tree.toValuePackedFromBytes(
                    &chunks[chunk_index - position.first_chunk],
                    index % items_per_chunk,
                    &value,
                );
            } else {
                try ST.Element.tree.toValuePacked(
                    node,
                    self.state.pool,
                    index % items_per_chunk,
                    &value,
                );
            }
            return value;
        }

        pub fn set(self: *Self, index: usize, value: Element) !void {
            if (index >= self._len) return error.IndexOutOfBounds;
            const chunk_index = index / items_per_chunk;
            const position = self.positionForChunk(chunk_index);
            const gindex = position.gindex;
            const node = try self.getLeaf(position);
            const state = node.getState(self.state.pool);
            if (position.folded_depth != 0) {
                const valid_chunks: u16 = @intCast(@min(
                    ChunkedLeaf.K,
                    chunkCount(self._len) - position.first_chunk,
                ));
                if (state.kind() == .chunked_leaf and state.refCount() == 0) {
                    try node.editChunkedLeaf(
                        self.state.pool,
                        @intCast(chunk_index - position.first_chunk),
                        valid_chunks,
                        Element,
                        index % items_per_chunk,
                        &value,
                        ST.Element.tree.fromValuePackedIntoChunk,
                    );
                } else {
                    // Growth can address a new subtree before commit installs its zero scaffold.
                    try self.state.children_nodes.put(self.allocator, gindex, node);
                    try self.state.editChunkedLeaf(
                        gindex,
                        @intCast(chunk_index - position.first_chunk),
                        valid_chunks,
                        Element,
                        index % items_per_chunk,
                        &value,
                        ST.Element.tree.fromValuePackedIntoChunk,
                    );
                    self.cached_leaf = .{
                        .position = position,
                        .node = self.state.children_nodes.get(gindex).?,
                    };
                }
                return;
            }
            // TODO: Share leaf copy-on-write logic with BasicPackedChunks.set via TreeViewState.editLeaf.
            if (state.isLeaf() and state.refCount() == 0) {
                ST.Element.tree.fromValuePackedIntoChunk(
                    &self.state.pool.nodes.items(.root)[@intFromEnum(node)],
                    index % items_per_chunk,
                    &value,
                );
                return;
            }

            const replacement = try ST.Element.tree.fromValuePacked(
                node,
                self.state.pool,
                index % items_per_chunk,
                &value,
            );
            errdefer self.state.pool.unref(replacement);

            try self.state.setChildNode(gindex, replacement);
            self.cached_leaf = .{ .position = position, .node = replacement };
        }

        pub fn push(self: *Self, value: Element) !void {
            if (self._len == max_length) return error.LengthOverLimit;
            const index = self._len;
            self._len += 1;
            errdefer self._len -= 1;
            try self.set(index, value);
        }

        /// On failure, the committed root stays unchanged and pending writes remain valid.
        pub fn commit(self: *Self) !void {
            const pool = self.state.pool;
            if (self._len != self._orig_len) {
                const length_node = try pool.createLeafFromUint(self._len);
                errdefer pool.unref(length_node);
                try self.state.setChildNode(length_gindex, length_node);
            }

            const old_count = progressive.subtreeCount(chunkCount(self._orig_len));
            const new_count = progressive.subtreeCount(chunkCount(self._len));
            if (old_count == new_count) {
                try self.state.commitNodes();
            } else {
                const expanded = try progressive.growSpine(pool, self.state.root, old_count, new_count);
                const original = self.state.root;
                self.state.root = expanded;
                errdefer {
                    pool.unref(self.state.root);
                    self.state.root = original;
                }
                try self.state.commitNodes();
                pool.unref(original);
            }
            self._orig_len = self._len;
            self.cached_leaf = null;
        }

        pub fn getAll(self: *Self, allocator: ?Allocator) ![]Element {
            const alloc = allocator orelse self.allocator;
            const values = try alloc.alloc(Element, self._len);
            errdefer alloc.free(values);
            return self.getAllInto(values);
        }

        pub fn getAllInto(self: *Self, values: []Element) ![]Element {
            if (values.len != self._len) return error.InvalidSize;
            var blocks = BlockIterator.init(self, 0);
            var index: usize = 0;
            while (index < values.len) {
                const block = try blocks.next();
                const count = @min(block.chunk_count * items_per_chunk, values.len - index);
                const pool = self.state.pool;
                if (block.node.getState(pool).isZero()) {
                    @memset(values[index..][0..count], std.mem.zeroes(Element));
                } else {
                    const bytes: []const u8 = if (block.folded_depth != 0)
                        std.mem.asBytes(try block.node.getChunkedLeafChunks(pool))
                    else
                        block.node.getRoot(pool);
                    ST.tree.toValuesPackedFromBytes(bytes, values[index..][0..count]);
                }
                index += count;
            }
            return values;
        }

        /// Reads committed elements. Commit before creating the iterator; do not mutate the view
        /// or pool while iterating, since the iterator borrows packed bytes.
        pub fn iteratorReadonly(self: *const Self, start_index: usize) ReadonlyIterator {
            std.debug.assert(self.state.changed.count() == 0);
            std.debug.assert(self._len == self._orig_len);
            return .{
                .blocks = BlockIterator.init(self, start_index / items_per_chunk),
                .index = start_index,
            };
        }

        pub const ReadonlyIterator = struct {
            blocks: BlockIterator,
            index: usize,
            block: ?Block = null,
            bytes: []const u8 = undefined,

            /// Returns null when exhausted.
            pub fn next(self: *ReadonlyIterator) !?Element {
                if (self.index >= self.blocks.view._orig_len) return null;
                const pool = self.blocks.view.state.pool;
                const block = self.block orelse blk: {
                    const next_block = try self.blocks.next();
                    self.bytes = if (next_block.node.getState(pool).isZero())
                        &progressive.zero_leaf_bytes
                    else if (next_block.folded_depth != 0)
                        std.mem.asBytes(try next_block.node.getChunkedLeafChunks(pool))
                    else
                        next_block.node.getRoot(pool);
                    self.block = next_block;
                    break :blk next_block;
                };
                var value: Element = undefined;
                const offset = (self.index / items_per_chunk - block.first_chunk) * 32;
                ST.Element.tree.toValuePackedFromBytes(
                    self.bytes[offset..][0..32],
                    self.index % items_per_chunk,
                    &value,
                );
                self.index += 1;
                if (self.index / items_per_chunk >= block.first_chunk + block.chunk_count) self.block = null;
                return value;
            }
        };

        const Block = struct {
            node: Node.Id,
            first_chunk: usize,
            chunk_count: usize,
            folded_depth: Depth,
        };

        const BlockIterator = struct {
            view: *const Self,
            index: usize,
            subtree_end: usize = 0,
            gindex: Gindex = @enumFromInt(0),
            folded_depth: Depth = 0,
            iterator: Node.DepthIterator = undefined,

            fn init(view: *const Self, start_index: usize) BlockIterator {
                return .{ .view = view, .index = start_index };
            }

            fn next(self: *BlockIterator) !Block {
                const pool = self.view.state.pool;
                if (self.index >= self.subtree_end) {
                    const subtree_index = progressive.subtreeIndex(self.index);
                    const start = progressive.subtreeStartChunk(subtree_index);
                    const depth: Depth = @intCast(2 * subtree_index);
                    self.folded_depth = foldedDepth(subtree_index);
                    const position = Position.init(self.index);
                    const root = if (subtree_index < progressive.subtreeCount(chunkCount(self.view._orig_len)))
                        try self.view.state.root.getNode(pool, progressive.subtreeGindex(subtree_index))
                    else
                        @as(Node.Id, @enumFromInt(depth));
                    self.iterator = Node.DepthIterator.init(
                        pool,
                        root,
                        depth - self.folded_depth,
                        (self.index - start) >> self.folded_depth,
                    );
                    self.subtree_end = start + (@as(usize, 1) << depth);
                    self.gindex = position.gindex;
                    self.index = position.first_chunk;
                }
                const committed = try self.iterator.next();
                const node = if (self.view.state.changed.count() == 0)
                    committed
                else
                    self.view.state.children_nodes.get(self.gindex) orelse committed;
                const block: Block = .{
                    .node = node,
                    .first_chunk = self.index,
                    .chunk_count = @as(usize, 1) << self.folded_depth,
                    .folded_depth = self.folded_depth,
                };
                self.index += block.chunk_count;
                self.gindex = @enumFromInt(@intFromEnum(self.gindex) + 1);
                return block;
            }
        };

        /// Returns a separately owned view containing elements through index, inclusive.
        pub fn sliceTo(self: *Self, index: usize) !*Self {
            try self.commit();
            if (self._len == 0 or index >= self._len - 1) {
                return Self.init(self.allocator, self.state.pool, self.state.root);
            }
            const pool = self.state.pool;
            const chunk_index = index / items_per_chunk;
            const subtree_index = progressive.subtreeIndex(chunk_index);
            const folded_depth = foldedDepth(subtree_index);
            const depth: Depth = @intCast(2 * subtree_index - folded_depth);
            const offset = (chunk_index - progressive.subtreeStartChunk(subtree_index)) >> folded_depth;
            var prefixes: [progressive.max_node_subtrees]Node.Id = undefined;
            var spine = try self.state.root.getLeft(pool);
            for (0..subtree_index) |i| {
                prefixes[i] = try spine.getLeft(pool);
                spine = try spine.getRight(pool);
            }
            const root = try spine.getLeft(pool);
            const boundary = try root.getNodeAtDepth(pool, depth, offset);
            const keep_bytes = (index % items_per_chunk + 1) * ST.Element.fixed_size;
            const leaf = if (folded_depth == 0) blk: {
                var bytes = boundary.getRoot(pool).*;
                @memset(bytes[keep_bytes..], 0);
                break :blk try pool.createLeaf(&bytes);
            } else if (boundary.getState(pool).isZero()) boundary else blk: {
                const intra_chunk = (chunk_index - progressive.subtreeStartChunk(subtree_index)) % ChunkedLeaf.K;
                const trimmed_leaf = try pool.createChunkedLeafEmpty(@intCast(intra_chunk + 1));
                errdefer pool.unref(trimmed_leaf);
                const old_chunks = try boundary.getChunkedLeafChunks(pool);
                const storage = try trimmed_leaf.getChunkedLeafPtr(pool);
                @memcpy(storage.chunks[0 .. intra_chunk + 1], old_chunks[0 .. intra_chunk + 1]);
                @memset(storage.chunks[intra_chunk][keep_bytes..], 0);
                break :blk trimmed_leaf;
            };
            try pool.ref(leaf);
            defer pool.unref(leaf);

            const updated = try root.setNodeAtDepth(pool, depth, offset, leaf);
            try pool.ref(updated);
            defer pool.unref(updated);

            const trimmed = try updated.truncateAfterIndexWithLeafOffset(
                pool,
                depth,
                offset,
                folded_depth,
            );
            try pool.ref(trimmed);
            defer pool.unref(trimmed);

            const sliced = blk: {
                var contents = try pool.createBranch(trimmed, @enumFromInt(0));
                errdefer pool.unref(contents);

                var i = subtree_index;
                while (i > 0) {
                    i -= 1;
                    contents = try pool.createBranch(prefixes[i], contents);
                }

                const length_node = try pool.createLeafFromUint(index + 1);
                errdefer pool.unref(length_node);

                break :blk try pool.createBranch(contents, length_node);
            };
            errdefer pool.unref(sliced);

            return Self.init(self.allocator, pool, sliced);
        }

        /// Fills `out` in place. The caller initializes `out` with `allocator` and keeps
        /// ownership; on error only its allocation stays valid.
        pub fn toValue(self: *Self, allocator: Allocator, out: *ST.Type) !void {
            try self.commit();
            try out.resize(allocator, self._len);
            _ = try self.getAllInto(out.items);
        }

        pub fn hashTreeRoot(self: *Self) !*const [32]u8 {
            try self.commit();
            return self.state.root.getRoot(self.state.pool);
        }

        pub fn hashTreeRootInto(self: *Self, out: *[32]u8) !void {
            out.* = (try self.hashTreeRoot()).*;
        }

        /// Commits, then hashes every ChunkedLeaf in parallel on `io` so `hashTreeRoot` only
        /// combines cached roots. No-op for lists without chunked leaves.
        pub fn hashChunkedLeaves(self: *Self, io: std.Io) !void {
            if (comptime !use_chunked_leaf) return;
            try self.commit();

            const chunk_count = chunkCount(self._len);

            var ids: std.ArrayList(Node.Id) = try .initCapacity(
                self.allocator,
                // Each ChunkedLeaf covers K chunks and starts below chunk_count, which bounds
                // their number.
                (chunk_count + ChunkedLeaf.K - 1) / ChunkedLeaf.K,
            );
            defer ids.deinit(self.allocator);

            var blocks = BlockIterator.init(self, 0);
            var chunk_index: usize = 0;
            while (chunk_index < chunk_count) {
                const block = try blocks.next();
                if (block.folded_depth != 0) ids.appendAssumeCapacity(block.node);
                chunk_index += block.chunk_count;
            }
            try Node.Id.computeChunkedLeafRoots(self.state.pool, io, ids.items);
        }

        pub fn serializedSize(self: *Self) !usize {
            return self._len * ST.Element.fixed_size;
        }

        pub fn serializeIntoBytes(self: *Self, out: []u8) !usize {
            try self.commit();
            return ST.tree.serializeIntoBytes(self.state.root, self.state.pool, out);
        }

        inline fn getLeaf(self: *Self, position: Position) !Node.Id {
            if (self.cached_leaf) |cached| {
                if (cached.position.first_chunk == position.first_chunk) return cached.node;
            }
            const gindex = position.gindex;
            const node = self.state.children_nodes.get(gindex) orelse
                if (position.first_chunk >= chunkCount(self._orig_len))
                    @as(Node.Id, @enumFromInt(position.folded_depth))
                else
                    try self.state.getChildNode(gindex);
            self.cached_leaf = .{ .position = position, .node = node };
            return node;
        }

        inline fn positionForChunk(self: *const Self, chunk_index: usize) Position {
            if (self.cached_leaf) |cached| {
                const position = cached.position;
                if (chunk_index >= position.first_chunk and
                    chunk_index - position.first_chunk < (@as(usize, 1) << position.folded_depth))
                {
                    return position;
                }
            }
            return Position.init(chunk_index);
        }

        fn chunkCount(len: usize) usize {
            return len / items_per_chunk + @intFromBool(len % items_per_chunk != 0);
        }

        fn foldedDepth(subtree_index: usize) Depth {
            return if (use_chunked_leaf) progressive.chunkedLeafOffset(subtree_index) else 0;
        }

        /// Subtree i covers 4^i SSZ chunks at logical depth 2*i. With chunked leaves enabled,
        /// sufficiently deep subtrees fold their bottom k_log2 levels into K-chunk nodes.
        /// Position identifies one such node (or an ordinary leaf) by its gindex and absolute
        /// first_chunk. Node boundaries align relative to the subtree's first chunk.
        const Position = struct {
            first_chunk: usize,
            folded_depth: Depth,
            gindex: Gindex,

            inline fn init(chunk_index: usize) Position {
                const subtree_index = progressive.subtreeIndex(chunk_index);
                const start = progressive.subtreeStartChunk(subtree_index);
                const folded_depth = foldedDepth(subtree_index);
                const leaf_index = (chunk_index - start) >> folded_depth;
                const prefix = @intFromEnum(progressive.subtreeGindex(subtree_index)) <<
                    @intCast(2 * subtree_index - folded_depth);
                return .{
                    .first_chunk = start + (leaf_index << folded_depth),
                    .folded_depth = folded_depth,
                    .gindex = @enumFromInt(prefix + leaf_index),
                };
            }
        };
    };

    assertTreeViewType(TreeView);
    return TreeView;
}

test {
    _ = @import("progressive_list_basic_test.zig");
}
