const std = @import("std");
const Allocator = std.mem.Allocator;

const hashing = @import("hashing");
const Depth = hashing.Depth;

const Node = @import("persistent_merkle_tree").Node;

const type_root = @import("../type/root.zig");
const chunkDepth = type_root.chunkDepth;

const BitArray = @import("bit_array.zig").BitArray;
const assertTreeViewType = @import("utils/assert.zig").assertTreeViewType;
const CloneOpts = @import("utils/clone_opts.zig").CloneOpts;

pub fn BitListTreeView(comptime ST: type) type {
    comptime {
        if (ST.kind != .list) {
            @compileError("BitListTreeView can only be used with List types");
        }
        if (!@hasDecl(ST, "Element") or ST.Element.kind != .bool) {
            @compileError("BitListTreeView can only be used with BitList (List of bool)");
        }
    }

    const TreeView = struct {
        allocator: Allocator,
        data: BitOps,

        pub const SszType = ST;
        pub const Element = bool;

        const Self = @This();

        const base_chunk_depth: Depth = @intCast(ST.chunk_depth);
        const chunk_depth: Depth = chunkDepth(Depth, base_chunk_depth, ST);
        const BitOps = BitArray(chunk_depth);

        pub fn init(allocator: Allocator, pool: *Node.Pool, root: Node.Id) !*Self {
            const ptr = try allocator.create(Self);
            errdefer allocator.destroy(ptr);

            try BitOps.init(&ptr.data, allocator, pool, root);
            ptr.allocator = allocator;
            return ptr;
        }

        pub fn clone(self: *Self, opts: CloneOpts) !*Self {
            const ptr = try self.allocator.create(Self);
            errdefer self.allocator.destroy(ptr);

            try self.data.clone(opts, &ptr.data);
            ptr.allocator = self.allocator;
            return ptr;
        }

        pub fn deinit(self: *Self) void {
            self.data.deinit();
            self.allocator.destroy(self);
        }

        pub fn commit(self: *Self) !void {
            try self.data.commit();
        }

        pub fn clearCache(self: *Self) void {
            self.data.clearCache();
        }

        pub fn hashTreeRoot(self: *Self, out: *[32]u8) !void {
            try self.commit();
            out.* = self.data.state.root.getRoot(self.data.state.pool).*;
        }

        pub fn getRoot(self: *const Self) Node.Id {
            return self.data.state.root;
        }

        fn readLength(self: *Self) !usize {
            const length_node = try self.data.getChildNode(@enumFromInt(3));
            const length_chunk = length_node.getRoot(self.data.state.pool);
            return std.mem.readInt(usize, length_chunk[0..@sizeOf(usize)], .little);
        }

        pub fn get(self: *Self, index: usize) !Element {
            const list_length = try self.readLength();
            return try self.data.get(index, list_length);
        }

        pub fn set(self: *Self, index: usize, value: Element) !void {
            const list_length = try self.readLength();
            try self.data.set(index, value, list_length);
        }

        /// Caller must free the returned slice.
        pub fn toBoolArray(self: *Self, allocator: Allocator) ![]bool {
            const list_length = try self.readLength();
            const values = try allocator.alloc(bool, list_length);
            errdefer allocator.free(values);
            try self.data.fillBools(values, list_length);
            return values;
        }

        pub fn toBoolArrayInto(self: *Self, out: []bool) !void {
            const list_length = try self.readLength();
            if (out.len != list_length) return error.InvalidSize;
            try self.data.fillBools(out, list_length);
        }
    };

    assertTreeViewType(TreeView);
    return TreeView;
}

test {
    _ = @import("bit_list_test.zig");
}
