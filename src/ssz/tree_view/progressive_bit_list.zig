const std = @import("std");
const Allocator = std.mem.Allocator;
const Node = @import("persistent_merkle_tree").Node;
const CloneOpts = @import("utils/clone_opts.zig").CloneOpts;
const assertTreeViewType = @import("utils/assert.zig").assertTreeViewType;

/// Mutable progressive bitlist with a lazy packed-byte cache. Borrowing a view allocates no bit
/// storage until the first read or write.
pub fn ProgressiveBitListTreeView(comptime ST: type) type {
    const TreeView = struct {
        allocator: Allocator,
        pool: *Node.Pool,
        root: Node.Id,
        value: ?ST.Type = null,
        dirty: bool = false,

        const Self = @This();
        pub const SszType = ST;

        pub fn init(allocator: Allocator, pool: *Node.Pool, root: Node.Id) !*Self {
            _ = try ST.tree.length(root, pool);
            const self = try allocator.create(Self);
            errdefer allocator.destroy(self);
            try pool.ref(root);
            self.* = .{ .allocator = allocator, .pool = pool, .root = root };
            return self;
        }

        pub fn deinit(self: *Self) void {
            self.clearCache();
            self.pool.unref(self.root);
            self.allocator.destroy(self);
        }

        pub fn clearCache(self: *Self) void {
            if (self.value) |*value| ST.deinit(self.allocator, value);
            self.value = null;
            self.dirty = false;
        }

        /// Clone the committed root; transferring the cache drops pending writes on both views.
        pub fn clone(self: *Self, opts: CloneOpts) !*Self {
            const copy = try init(self.allocator, self.pool, self.root);
            if (opts.transfer_cache) {
                if (self.dirty) self.clearCache();
                copy.value = self.value;
                self.value = null;
            }
            return copy;
        }

        fn getValue(self: *Self) !*ST.Type {
            if (self.value == null) {
                var value = ST.default_value;
                errdefer ST.deinit(self.allocator, &value);
                try ST.tree.toValue(self.allocator, self.root, self.pool, &value);
                self.value = value;
            }
            return &self.value.?;
        }

        pub fn length(self: *const Self) !usize {
            return if (self.value) |value| value.bit_len else ST.tree.length(self.root, self.pool);
        }

        pub fn get(self: *Self, index: usize) !bool {
            const value = try self.getValue();
            if (index >= value.bit_len) return error.IndexOutOfBounds;
            return value.get(index);
        }

        pub fn set(self: *Self, index: usize, bit: bool) !void {
            const value = try self.getValue();
            if (index >= value.bit_len) return error.IndexOutOfBounds;
            try value.set(self.allocator, index, bit);
            self.dirty = true;
        }

        pub fn commit(self: *Self) !void {
            if (!self.dirty) return;
            const root = try ST.tree.fromValue(self.pool, &self.value.?);
            errdefer self.pool.unref(root);
            try self.pool.ref(root);
            self.pool.unref(self.root);
            self.root = root;
            self.dirty = false;
        }

        pub fn getRoot(self: *const Self) Node.Id {
            return self.root;
        }

        pub fn hashTreeRoot(self: *Self) !*const [32]u8 {
            try self.commit();
            return self.root.getRoot(self.pool);
        }

        pub fn toBoolArrayInto(self: *Self, out: []bool) !void {
            const value = try self.getValue();
            if (out.len != value.bit_len) return error.InvalidSize;
            for (out, 0..) |*bit, i| bit.* = try value.get(i);
        }

        pub fn toBoolArray(self: *Self, allocator: Allocator) ![]bool {
            const out = try allocator.alloc(bool, try self.length());
            errdefer allocator.free(out);
            try self.toBoolArrayInto(out);
            return out;
        }

        pub fn fromValue(allocator: Allocator, pool: *Node.Pool, value: *const ST.Type) !*Self {
            const root = try ST.tree.fromValue(pool, value);
            errdefer pool.unref(root);
            return init(allocator, pool, root);
        }

        pub fn toValue(self: *Self, allocator: Allocator, out: *ST.Type) !void {
            try self.commit();
            try ST.tree.toValue(allocator, self.root, self.pool, out);
        }

        pub fn deserialize(allocator: Allocator, pool: *Node.Pool, bytes: []const u8) !*Self {
            const root = try ST.tree.deserializeFromBytes(pool, bytes);
            errdefer pool.unref(root);
            return init(allocator, pool, root);
        }

        pub fn serializeIntoBytes(self: *Self, out: []u8) !usize {
            try self.commit();
            return ST.tree.serializeIntoBytes(self.root, self.pool, out);
        }

        pub fn serializedSize(self: *Self) !usize {
            try self.commit();
            return ST.tree.serializedSize(self.root, self.pool);
        }
    };

    assertTreeViewType(TreeView);
    return TreeView;
}

test {
    _ = @import("progressive_bit_list_test.zig");
}
