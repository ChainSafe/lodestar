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

/// A specialized tree view for SSZ vector types with composite element types.
/// Each element occupies its own subtree.
pub fn ArrayCompositeTreeView(comptime ST: type) type {
    comptime {
        if (ST.kind != .vector) {
            @compileError("ArrayCompositeTreeView can only be used with Vector types");
        }
        if (!@hasDecl(ST, "Element") or isBasicType(ST.Element)) {
            @compileError("ArrayCompositeTreeView can only be used with Vector of composite element types");
        }

        assertTreeViewType(ST.Element.TreeView);
    }

    const TreeView = struct {
        allocator: Allocator,
        chunks: Chunks,

        pub const SszType = ST;
        pub const Element = *ST.Element.TreeView;
        pub const length = ST.length;

        const Self = @This();

        const base_chunk_depth: Depth = @intCast(ST.chunk_depth);
        const chunk_depth: Depth = chunkDepth(Depth, base_chunk_depth, ST);
        const Chunks = CompositeChunks(ST, chunk_depth);

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

        pub fn toValue(self: *Self, allocator: Allocator, out: *ST.Type) !void {
            try self.commit();
            if (comptime isFixedType(ST)) {
                try ST.tree.toValue(self.chunks.state.root, self.chunks.state.pool, out);
            } else {
                try ST.tree.toValue(allocator, self.chunks.state.root, self.chunks.state.pool, out);
            }
        }

        pub fn getRoot(self: *const Self) Node.Id {
            return self.chunks.state.root;
        }

        pub fn get(self: *Self, index: usize) !Element {
            if (index >= length) return error.IndexOutOfBounds;
            return self.chunks.get(index);
        }

        pub fn getReadonly(self: *Self, index: usize) !Element {
            if (index >= length) return error.IndexOutOfBounds;
            return self.chunks.getReadonly(index);
        }

        pub fn getValue(self: *Self, allocator: Allocator, index: usize, out: *ST.Element.Type) !void {
            if (index >= length) return error.IndexOutOfBounds;
            return self.chunks.getValue(allocator, index, out);
        }

        pub fn setValue(self: *Self, index: usize, value: *const ST.Element.Type) !void {
            if (index >= length) return error.IndexOutOfBounds;
            try self.chunks.setValue(index, value);
        }

        pub fn getFieldRoot(self: *Self, index: usize) !*const [32]u8 {
            if (index >= length) return error.IndexOutOfBounds;
            const elem = try self.chunks.get(index);
            try elem.commit();
            return elem.getRoot().getRoot(self.chunks.state.pool);
        }

        /// Takes ownership of `value` on success. On error.IndexOutOfBounds it does not — the
        /// caller keeps `value` and must deinit it.
        pub fn set(self: *Self, index: usize, value: Element) !void {
            if (index >= length) return error.IndexOutOfBounds;
            try self.chunks.set(index, value);
        }

        pub fn getAllReadonlyValues(self: *Self, allocator: Allocator) ![]ST.Element.Type {
            return self.chunks.getAllValues(allocator, length);
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
            if (comptime isFixedType(ST)) {
                return ST.fixed_size;
            } else {
                return ST.tree.serializedSize(self.chunks.state.root, self.chunks.state.pool);
            }
        }
    };

    assertTreeViewType(TreeView);
    return TreeView;
}

test {
    _ = @import("array_composite_test.zig");
}
