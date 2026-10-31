const std = @import("std");
const Allocator = std.mem.Allocator;
const hashing = @import("hashing");
const Depth = hashing.Depth;
const Node = @import("persistent_merkle_tree").Node;
const isBasicType = @import("../type/type_kind.zig").isBasicType;

const type_root = @import("../type/root.zig");
const itemsPerChunk = type_root.itemsPerChunk;
const chunkDepth = type_root.chunkDepth;

const BasicPackedChunks = @import("chunks.zig").BasicPackedChunks;
const assertTreeViewType = @import("utils/assert.zig").assertTreeViewType;
const CloneOpts = @import("utils/clone_opts.zig").CloneOpts;

/// A specialized tree view for SSZ vector types with basic element types.
/// Elements are packed into chunks (multiple elements per leaf node).
pub fn ArrayBasicTreeView(comptime ST: type) type {
    comptime {
        if (ST.kind != .vector) {
            @compileError("ArrayBasicTreeView can only be used with Vector types");
        }
        if (!@hasDecl(ST, "Element") or !isBasicType(ST.Element)) {
            @compileError("ArrayBasicTreeView can only be used with Vector of basic element types");
        }
    }

    const TreeView = struct {
        allocator: Allocator,
        chunks: Chunks,

        pub const SszType = ST;
        pub const Element = ST.Element.Type;
        pub const length = ST.length;

        const Self = @This();

        const base_chunk_depth: Depth = @intCast(ST.chunk_depth);
        const chunk_depth: Depth = chunkDepth(Depth, base_chunk_depth, ST);
        const items_per_chunk: usize = itemsPerChunk(ST.Element);
        const Chunks = BasicPackedChunks(ST, chunk_depth, items_per_chunk, ST.opts.chunked_leaf);

        pub fn init(allocator: Allocator, pool: *Node.Pool, root: Node.Id) !*Self {
            const ptr = try allocator.create(Self);
            errdefer allocator.destroy(ptr);

            try Chunks.init(&ptr.chunks, allocator, pool, root);
            ptr.allocator = allocator;
            return ptr;
        }

        pub fn clone(self: *Self, opts: CloneOpts) !*Self {
            const ptr = try self.allocator.create(Self);
            errdefer self.allocator.destroy(ptr);

            try Chunks.clone(&self.chunks, opts, &ptr.chunks);
            ptr.allocator = self.allocator;
            return ptr;
        }

        pub fn deinit(self: *Self) void {
            self.chunks.deinit();
            self.allocator.destroy(self);
        }

        pub fn commit(self: *Self) !void {
            try self.chunks.commit();
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

        pub fn toValue(self: *Self, _: Allocator, out: *ST.Type) !void {
            try self.commit();
            try ST.tree.toValue(self.chunks.state.root, self.chunks.state.pool, out);
        }

        pub fn getRoot(self: *const Self) Node.Id {
            return self.chunks.state.root;
        }

        pub fn get(self: *Self, index: usize) !Element {
            if (index >= length) return error.IndexOutOfBounds;
            return self.chunks.get(index);
        }

        pub fn set(self: *Self, index: usize, value: Element) !void {
            if (index >= length) return error.IndexOutOfBounds;
            try self.chunks.set(index, value, length);
        }

        /// Caller is responsible for freeing the returned slice using the same allocator.
        pub fn getAll(self: *Self, allocator: Allocator) ![]Element {
            return try self.chunks.getAll(allocator, length);
        }

        pub fn getAllInto(self: *Self, values: []Element) ![]Element {
            return try self.chunks.getAllInto(length, values);
        }

        /// Serialize the tree view into a provided buffer.
        /// Returns the number of bytes written.
        pub fn serializeIntoBytes(self: *Self, out: []u8) !usize {
            try self.commit();
            return try ST.tree.serializeIntoBytes(self.chunks.state.root, self.chunks.state.pool, out);
        }

        /// Get the serialized size of this tree view.
        pub fn serializedSize(_: *Self) usize {
            return ST.fixed_size;
        }
    };

    assertTreeViewType(TreeView);
    return TreeView;
}

test {
    _ = @import("array_basic_test.zig");
}
