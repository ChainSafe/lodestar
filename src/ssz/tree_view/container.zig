const std = @import("std");
const Allocator = std.mem.Allocator;
const Node = @import("persistent_merkle_tree").Node;
const Gindex = @import("persistent_merkle_tree").Gindex;
const isBasicType = @import("../type/type_kind.zig").isBasicType;
const assertTreeViewType = @import("utils/assert.zig").assertTreeViewType;
const isFixedType = @import("../type/type_kind.zig").isFixedType;
const CloneOpts = @import("utils/clone_opts.zig").CloneOpts;

/// A specialized tree view for SSZ container types, enabling efficient access and modification of container fields, given a backing merkle tree.
///
/// This struct stores a tuples of either reference to child TreeView or basic type and provides methods to get and set fields by name.
///
/// For basic-type fields, it returns or accepts values directly; for complex fields, it returns or accepts corresponding tree view references.
pub fn ContainerTreeView(comptime ST: type) type {
    comptime var opt_treeview_types: [ST.fields.len]type = undefined;
    inline for (ST.fields, 0..) |field, i| {
        opt_treeview_types[i] = if (isBasicType(field.type))
            ?field.type.Type
        else blk: {
            assertTreeViewType(field.type.TreeView);
            break :blk ?*field.type.TreeView;
        };
    }

    const TreeViewData = @Tuple(&opt_treeview_types);

    const TreeView = struct {
        allocator: Allocator,
        pool: *Node.Pool,
        root: Node.Id,

        /// specific fields for this TreeView
        /// a tuple of either Optional(Value) for basic type or Optional(ChildTreeView) for composite type
        child_data: TreeViewData,
        /// whether the corresponding child node/data has changed since the last update of the root
        changed: std.StaticBitSet(ST.fields.len),
        original_nodes: [ST.fields.len]?Node.Id,
        /// View-owned backing for `getFieldRoot` snapshots of dirty basic fields.
        field_root_cache: [ST.fields.len][32]u8,
        pub const SszType = ST;

        const Self = @This();

        pub fn init(allocator: Allocator, pool: *Node.Pool, root: Node.Id) !*Self {
            const ptr = try allocator.create(Self);
            errdefer allocator.destroy(ptr);

            ptr.* = .{
                .allocator = allocator,
                .pool = pool,
                .child_data = .{null} ** ST.fields.len,
                .original_nodes = .{null} ** ST.fields.len,
                .root = root,
                .changed = std.StaticBitSet(ST.fields.len).empty,
                .field_root_cache = undefined,
            };
            try pool.ref(root);
            return ptr;
        }

        /// Clone this view, optionally moving its child-view cache to the clone.
        /// `transfer_cache = true` invalidates any pointer from an earlier get()/getReadonly():
        /// cached `changed` children get deinited (and get() counts as a change even on a read).
        /// Re-fetch from whichever view you keep.
        pub fn clone(self: *Self, opts: CloneOpts) !*Self {
            const ptr = try init(self.allocator, self.pool, self.root);
            if (!opts.transfer_cache) {
                return ptr;
            }

            ptr.child_data = self.child_data;
            ptr.original_nodes = self.original_nodes;

            inline for (0..ST.fields.len) |i| {
                if (self.changed.isSet(i)) {
                    if (ptr.child_data[i]) |child_view_ptr| {
                        if (!comptime isBasicType(ST.fields[i].type)) {
                            @constCast(child_view_ptr).deinit();
                        }
                    }
                    ptr.child_data[i] = null;
                }
            }

            // clear self's caches
            self.child_data = .{null} ** ST.fields.len;
            self.original_nodes = .{null} ** ST.fields.len;
            self.changed = std.StaticBitSet(ST.fields.len).empty;

            return ptr;
        }

        pub fn deinit(self: *Self) void {
            self.clearChildrenDataCache();
            self.pool.unref(self.root);
            self.allocator.destroy(self);
        }

        fn clearChildrenDataCache(self: *Self) void {
            inline for (self.child_data, 0..) |child_opt, i| {
                if (child_opt) |child| {
                    if (!comptime isBasicType(ST.fields[i].type)) {
                        @constCast(child).deinit();
                    }
                    self.child_data[i] = null;
                }
            }
            inline for (0..ST.fields.len) |i| {
                // these nodes are unref by root
                self.original_nodes[i] = null;
            }
            self.changed = std.StaticBitSet(ST.fields.len).empty;
        }

        pub fn commit(self: *Self) !void {
            if (self.changed.count() == 0) {
                return;
            }

            var nodes: [ST.fields.len]Node.Id = undefined;
            var indices: [ST.fields.len]usize = undefined;
            // Only basic nodes created by this commit need direct cleanup. Composite roots are
            // borrowed from their child views and must not be released here.
            var fresh_basic_nodes: [ST.fields.len]Node.Id = undefined;
            var fresh_basic_count: usize = 0;
            errdefer self.pool.free(fresh_basic_nodes[0..fresh_basic_count]);

            var changed_idx: usize = 0;
            inline for (ST.fields, 0..) |field, i| {
                if (self.changed.isSet(i)) {
                    const ChildST = ST.getFieldType(field.name);
                    if (comptime isBasicType(ChildST)) {
                        const child_value = self.child_data[i] orelse return error.MissingChildValue;
                        const child_node = try ChildST.tree.fromValue(
                            self.pool,
                            &child_value,
                        );
                        fresh_basic_nodes[fresh_basic_count] = child_node;
                        fresh_basic_count += 1;
                        nodes[changed_idx] = child_node;
                        indices[changed_idx] = i;
                        changed_idx += 1;
                    } else {
                        var child_view = self.child_data[i] orelse return error.MissingChildView;
                        try child_view.commit();
                        const child_changed = if (self.original_nodes[i]) |orig_node| blk: {
                            break :blk orig_node != child_view.getRoot();
                        } else true;
                        if (child_changed) {
                            nodes[changed_idx] = child_view.getRoot();
                            indices[changed_idx] = i;
                            changed_idx += 1;
                        }
                        // else child_view is not changed
                    }
                }
            }

            if (changed_idx == 0) {
                self.changed = std.StaticBitSet(ST.fields.len).empty;
                return;
            }
            const new_root = if (comptime ST.kind == .progressive_container) blk: {
                // Different-depth updates can reclaim intermediate parents on failure. Retain the
                // inputs until the rebuilt root owns them; basic-node cleanup stays armed.
                var retained: usize = 0;
                defer for (nodes[0..retained]) |node| self.pool.unrefUnsafe(node);

                const field_gindices = comptime gindices_blk: {
                    var out: [ST.fields.len]Gindex = undefined;
                    for (ST.fields, 0..) |field, i| out[i] = ST.getFieldGindex(field.name);
                    break :gindices_blk out;
                };
                var gindices: [ST.fields.len]Gindex = undefined;
                for (indices[0..changed_idx], nodes[0..changed_idx], 0..) |index, node, i| {
                    gindices[i] = field_gindices[index];
                    try self.pool.ref(node);
                    retained += 1;
                }
                break :blk try self.root.setNodesGrouped(self.pool, gindices[0..changed_idx], nodes[0..changed_idx]);
            } else try self.root.setNodesAtDepth(
                self.pool,
                ST.chunk_depth,
                indices[0..changed_idx],
                nodes[0..changed_idx],
            );
            // The rebuilt parent now owns the fresh basic nodes, so disarm their errdefer
            // cleanup. At depth zero there is no parent, so keep cleanup armed until the
            // view takes its own reference.
            if (comptime ST.kind == .progressive_container or ST.chunk_depth > 0) {
                fresh_basic_count = 0;
            }
            // This scope disarms the rollback once the view acquires its reference. The
            // remaining publication steps cannot fail.
            {
                errdefer if (comptime ST.kind == .progressive_container or ST.chunk_depth > 0) self.pool.unref(new_root);
                try self.pool.ref(new_root);
            }
            fresh_basic_count = 0;

            self.pool.unref(self.root);
            self.root = new_root;
            for (indices[0..changed_idx], nodes[0..changed_idx]) |index, node| {
                self.original_nodes[index] = node;
            }
            self.changed = std.StaticBitSet(ST.fields.len).empty;
        }

        pub fn getRoot(self: *const Self) Node.Id {
            return self.root;
        }

        pub fn hashTreeRootInto(self: *Self, out: *[32]u8) !void {
            try self.commit();
            out.* = self.root.getRoot(self.pool).*;
        }

        pub fn getRootNode(self: *Self, comptime field_name: []const u8) !Node.Id {
            const field_index = comptime ST.getFieldIndex(field_name);
            const existing = self.original_nodes[field_index];
            if (existing) |node| {
                return node;
            } else {
                const node = try self.root.getNode(self.pool, comptime ST.getFieldGindex(field_name));
                self.original_nodes[field_index] = node;
                return node;
            }
        }

        pub fn setRootNode(self: *Self, comptime field_name: []const u8, root: Node.Id) !void {
            const ChildST = ST.getFieldType(field_name);
            if (comptime isBasicType(ChildST)) {
                // TODO: should support this? in this implement it uses value for basic type
                return error.InvalidRootNodeForBasicType;
            }

            const field_data = try ChildST.TreeView.init(self.allocator, self.pool, root);
            try self.set(field_name, field_data);
        }

        pub fn Field(comptime field_name: []const u8) type {
            const ChildST = ST.getFieldType(field_name);
            if (comptime isBasicType(ChildST)) {
                return ChildST.Type;
            } else {
                return *ChildST.TreeView;
            }
        }

        /// Get a field by name. If the field is a basic type, returns the value directly.
        /// Caller borrows a reference to child value so there is no need to deinit it.
        ///
        /// A composite field returns a borrowed *TreeView owned by this parent. A later set() on
        /// the field or a clone(transfer_cache) invalidates it — re-get() instead. (This also
        /// marks the field changed, even though it's a read.)
        pub fn get(self: *Self, comptime field_name: []const u8) !Field(field_name) {
            const field_index = comptime ST.getFieldIndex(field_name);
            const ChildST = ST.getFieldType(field_name);
            if (comptime isBasicType(ChildST)) {
                const existing = self.child_data[field_index];
                if (existing) |child_value| {
                    return child_value;
                } else {
                    const node = try self.root.getNode(self.pool, comptime ST.getFieldGindex(field_name));
                    var child_value: ChildST.Type = undefined;
                    try ChildST.tree.toValue(node, self.pool, &child_value);
                    self.original_nodes[field_index] = node;
                    self.child_data[field_index] = child_value;
                    return child_value;
                }
            } else {
                const existing_ptr = self.child_data[field_index];
                if (existing_ptr) |child_view_ptr| {
                    self.changed.set(field_index);
                    return child_view_ptr;
                } else {
                    const node = try self.root.getNode(self.pool, comptime ST.getFieldGindex(field_name));
                    const child_view = try ChildST.TreeView.init(self.allocator, self.pool, node);
                    self.original_nodes[field_index] = node;
                    self.child_data[field_index] = child_view;
                    self.changed.set(field_index);
                    return child_view;
                }
            }
        }

        /// Set a field by name. If the field is a basic type, pass the value directly.
        /// If the field is a complex type, pass a TreeView of the corresponding type.
        /// The caller transfers ownership of the `value` TreeView to this parent view.
        /// Deinits the field's existing TreeView, so any earlier get()/getReadonly() of it is now
        /// invalid. Keep `value`, or re-get() the field, to use the new view.
        pub fn set(self: *Self, comptime field_name: []const u8, value: Field(field_name)) !void {
            const field_index = comptime ST.getFieldIndex(field_name);
            const ChildST = ST.getFieldType(field_name);

            if (comptime isBasicType(ChildST)) {
                const existing = self.child_data[field_index];
                if (existing) |child_value| {
                    if (child_value == value) {
                        // if consumer keeps setting a new value, do nothing
                        return;
                    }
                }

                self.child_data[field_index] = value;
            } else {
                const existing_ptr = self.child_data[field_index];
                if (existing_ptr) |old_ptr| {
                    if (old_ptr != value) {
                        old_ptr.deinit();
                    }
                }

                self.child_data[field_index] = value;
            }

            self.changed.set(field_index);
        }

        /// Serialize the tree view into a provided buffer.
        /// Returns the number of bytes written.
        pub fn serializeIntoBytes(self: *Self, out: []u8) !usize {
            try self.commit();
            return try ST.tree.serializeIntoBytes(self.root, self.pool, out);
        }

        /// Get the serialized size of this tree view.
        pub fn serializedSize(self: *Self) !usize {
            try self.commit();
            if (comptime isFixedType(ST)) {
                return ST.fixed_size;
            } else {
                return ST.tree.serializedSize(self.root, self.pool);
            }
        }

        pub fn deserialize(allocator: Allocator, pool: *Node.Pool, bytes: []const u8) !*Self {
            const root = try ST.tree.deserializeFromBytes(pool, bytes);
            errdefer pool.unref(root);
            return try Self.init(allocator, pool, root);
        }

        pub fn fromValue(allocator: Allocator, pool: *Node.Pool, value: *const ST.Type) !*Self {
            const root = try ST.tree.fromValue(pool, value);
            errdefer pool.unref(root);
            const self = try Self.init(allocator, pool, root);
            return self;
        }

        pub fn toValue(self: *Self, allocator: Allocator, out: *ST.Type) !void {
            try self.commit();
            if (comptime isFixedType(ST)) {
                try ST.tree.toValue(self.root, self.pool, out);
            } else {
                try ST.tree.toValue(allocator, self.root, self.pool, out);
            }
        }

        /// Return the SSZ value type for a given field name.
        pub fn FieldValue(comptime field_name: []const u8) type {
            const ChildST = ST.getFieldType(field_name);
            return ChildST.Type;
        }

        /// Return the root hash of the tree.
        /// The returned array is owned by the internal pool and must not be modified.
        pub fn hashTreeRoot(self: *Self) !*const [32]u8 {
            try self.commit();
            return self.root.getRoot(self.pool);
        }

        /// Get the hash tree root of a specific field by name.
        /// For composite fields, commits the child view first if it has changes.
        pub fn getFieldRoot(self: *Self, comptime field_name: []const u8) !*const [32]u8 {
            comptime {
                @setEvalBranchQuota(20000);
            }
            const field_index = comptime ST.getFieldIndex(field_name);
            const ChildST = ST.getFieldType(field_name);
            if (comptime isBasicType(ChildST)) {
                if (self.child_data[field_index]) |child_value| {
                    try ChildST.hashTreeRoot(&child_value, &self.field_root_cache[field_index]);
                    return &self.field_root_cache[field_index];
                }
                const node = try self.root.getNode(self.pool, comptime ST.getFieldGindex(field_name));
                return node.getRoot(self.pool);
            } else {
                // For composite types, if we have a cached view, commit it and return its root
                if (self.child_data[field_index]) |child_view_ptr| {
                    try child_view_ptr.commit();
                    return child_view_ptr.getRoot().getRoot(self.pool);
                } else {
                    const node = try self.root.getNode(self.pool, comptime ST.getFieldGindex(field_name));
                    return node.getRoot(self.pool);
                }
            }
        }

        /// Like get() but doesn't mark the field changed. A composite field returns a borrowed
        /// *TreeView owned by this parent; a later set() on the field or clone(transfer_cache)
        /// invalidates it. Don't deinit it.
        pub fn getReadonly(self: *Self, comptime field_name: []const u8) !Field(field_name) {
            comptime {
                @setEvalBranchQuota(20000);
            }
            const field_index = comptime ST.getFieldIndex(field_name);
            const ChildST = ST.getFieldType(field_name);
            if (comptime isBasicType(ChildST)) {
                const existing = self.child_data[field_index];
                if (existing) |child_value| {
                    return child_value;
                } else {
                    const node = try self.root.getNode(self.pool, comptime ST.getFieldGindex(field_name));
                    var child_value: ChildST.Type = undefined;
                    try ChildST.tree.toValue(node, self.pool, &child_value);
                    return child_value;
                }
            } else {
                // Unlike get(), do NOT add to self.changed
                const existing_ptr = self.child_data[field_index];
                if (existing_ptr) |child_view_ptr| {
                    return child_view_ptr;
                } else {
                    const node = try self.root.getNode(self.pool, comptime ST.getFieldGindex(field_name));
                    const child_view = try ChildST.TreeView.init(self.allocator, self.pool, node);
                    self.child_data[field_index] = child_view;
                    return child_view;
                }
            }
        }

        /// Get a field value as an SSZ value type (copied out).
        pub fn getValue(self: *Self, allocator: Allocator, comptime field_name: []const u8, out: *FieldValue(field_name)) !void {
            comptime {
                @setEvalBranchQuota(20000);
            }
            const ChildST = ST.getFieldType(field_name);
            if (comptime isBasicType(ChildST)) {
                out.* = try self.getReadonly(field_name);
            } else {
                var child_view = try self.getReadonly(field_name);
                try child_view.toValue(allocator, out);
            }
        }

        /// Set a field from an SSZ value type.
        /// For basic types, sets the value directly. For composite types, creates a TreeView from the value.
        pub fn setValue(self: *Self, comptime field_name: []const u8, value: *const FieldValue(field_name)) !void {
            comptime {
                @setEvalBranchQuota(20000);
            }
            const ChildST = ST.getFieldType(field_name);
            if (comptime isBasicType(ChildST)) {
                try self.set(field_name, value.*);
            } else {
                const child_view = try ChildST.TreeView.fromValue(self.allocator, self.pool, value);
                errdefer child_view.deinit();
                try self.set(field_name, child_view);
            }
        }
    };

    assertTreeViewType(TreeView);
    return TreeView;
}

/// TreeView companion to `StructContainerType`.
///
/// The backing Node is a single `.container_struct` slot whose payload is the
/// fully-decoded struct value. This view caches a copy of that value and
/// re-creates a new container_struct Node on `commit` if any field was mutated.
///
/// Field reads/writes are O(1) (direct struct access) — there is no per-field
/// child TreeView and no per-field merkle navigation.
pub fn StructContainerTreeView(comptime ST: type) type {
    const T = ST.Type;

    const TreeView = struct {
        allocator: Allocator,
        pool: *Node.Pool,
        root: Node.Id,
        /// Cached copy of the deserialized struct. Mutated in place by `set`.
        value: T,
        /// Bit per field; tracks whether `value` diverges from `root`.
        changed: std.StaticBitSet(ST.chunk_count),
        /// Stable backing store for `getFieldRoot` return pointers. The hash
        /// is computed in place here so we can return `*const [32]u8` without
        /// allocating a temporary PMT slot per call (which previously leaked).
        field_root_cache: [ST.chunk_count][32]u8,

        pub const SszType = ST;

        const Self = @This();

        pub fn init(allocator: Allocator, pool: *Node.Pool, root: Node.Id) !*Self {
            const ptr = try allocator.create(Self);
            errdefer allocator.destroy(ptr);

            try ST.tree.toValue(root, pool, &ptr.value);

            ptr.allocator = allocator;
            ptr.pool = pool;
            ptr.root = root;
            ptr.changed = std.StaticBitSet(ST.chunk_count).empty;
            ptr.field_root_cache = undefined;
            try pool.ref(root);
            return ptr;
        }

        /// Clones the committed state; uncommitted writes are dropped (from the source too on
        /// transfer), matching the other tree views.
        pub fn clone(self: *Self, opts: CloneOpts) !*Self {
            try self.pool.ref(self.root);
            errdefer self.pool.unref(self.root);

            const ptr = try self.allocator.create(Self);
            errdefer self.allocator.destroy(ptr);

            ptr.allocator = self.allocator;
            ptr.pool = self.pool;
            ptr.root = self.root;
            ptr.changed = std.StaticBitSet(ST.chunk_count).empty;

            if (opts.transfer_cache and self.changed.count() == 0) {
                ptr.value = self.value;
            } else {
                try ST.tree.toValue(self.root, self.pool, &ptr.value);
            }
            if (opts.transfer_cache and self.changed.count() != 0) {
                self.value = ptr.value;
                self.changed = std.StaticBitSet(ST.chunk_count).empty;
            }

            return ptr;
        }

        pub fn deinit(self: *Self) void {
            self.pool.unref(self.root);
            self.allocator.destroy(self);
        }

        pub fn commit(self: *Self) !void {
            if (self.changed.count() == 0) return;

            const new_root = try ST.tree.fromValue(self.pool, &self.value);
            try self.pool.ref(new_root);
            self.pool.unref(self.root);
            self.root = new_root;
            self.changed = std.StaticBitSet(ST.chunk_count).empty;
        }

        pub fn getRoot(self: *const Self) Node.Id {
            return self.root;
        }

        pub fn hashTreeRootInto(self: *Self, out: *[32]u8) !void {
            try self.commit();
            out.* = self.root.getRoot(self.pool).*;
        }

        pub fn hashTreeRoot(self: *Self) !*const [32]u8 {
            try self.commit();
            return self.root.getRoot(self.pool);
        }

        pub fn getFieldRoot(self: *Self, comptime field_name: []const u8) !*const [32]u8 {
            const ChildST = ST.getFieldType(field_name);
            const field_index = comptime ST.getFieldIndex(field_name);
            const field_value = try self.get(field_name);
            // Materialize a temporary PMT subtree just to compute the cached
            // root, then unref it immediately. The hash bytes are copied into
            // `field_root_cache` so the returned pointer remains valid for the
            // view's lifetime — without leaking a Pool slot per call.
            const node = try ChildST.tree.fromValue(self.pool, &field_value);
            defer self.pool.unref(node);
            self.field_root_cache[field_index] = node.getRoot(self.pool).*;
            return &self.field_root_cache[field_index];
        }

        pub fn deserialize(allocator: Allocator, pool: *Node.Pool, bytes: []const u8) !*Self {
            const root = try ST.tree.deserializeFromBytes(pool, bytes);
            errdefer pool.unref(root);
            return try Self.init(allocator, pool, root);
        }

        pub fn fromValue(allocator: Allocator, pool: *Node.Pool, value: *const ST.Type) !*Self {
            const root = try ST.tree.fromValue(pool, value);
            errdefer pool.unref(root);
            return try Self.init(allocator, pool, root);
        }

        pub fn toValue(self: *Self, allocator: Allocator, out: *ST.Type) !void {
            _ = allocator;
            try self.commit();
            try ST.clone(&self.value, out);
        }

        pub fn Field(comptime field_name: []const u8) type {
            const ChildST = ST.getFieldType(field_name);
            return ChildST.Type;
        }

        pub fn FieldValue(comptime field_name: []const u8) type {
            const ChildST = ST.getFieldType(field_name);
            return ChildST.Type;
        }

        pub fn get(self: *Self, comptime field_name: []const u8) !Field(field_name) {
            return @field(self.value, field_name);
        }

        pub fn getReadonly(self: *Self, comptime field_name: []const u8) !Field(field_name) {
            return @field(self.value, field_name);
        }

        pub fn set(self: *Self, comptime field_name: []const u8, value: Field(field_name)) !void {
            @field(self.value, field_name) = value;
            const idx = comptime ST.getFieldIndex(field_name);
            self.changed.set(idx);
        }

        pub fn getValue(self: *Self, allocator: Allocator, comptime field_name: []const u8, out: *FieldValue(field_name)) !void {
            _ = allocator;
            out.* = try self.get(field_name);
        }

        pub fn setValue(self: *Self, comptime field_name: []const u8, value: *const FieldValue(field_name)) !void {
            try self.set(field_name, value.*);
        }

        pub fn serializeIntoBytes(self: *Self, out: []u8) !usize {
            try self.commit();
            return ST.serializeIntoBytes(&self.value, out);
        }

        pub fn serializedSize(_: *const Self) usize {
            return ST.fixed_size;
        }
    };

    assertTreeViewType(TreeView);
    return TreeView;
}

test {
    _ = @import("container_test.zig");
}
