const std = @import("std");
const Allocator = std.mem.Allocator;
const Node = @import("Node.zig");
const Gindex = @import("gindex.zig").Gindex;
const Depth = @import("hashing").Depth;

const View = @This();

root_node: Node.Id,
next_free: ?Id,
parent: ?Parent,

pub const Parent = struct {
    root_view: Id,
    child_gindex: Gindex,
};

pub const Pool = struct {
    allocator: Allocator,
    node_pool: *Node.Pool,

    views: std.ArrayList(View),
    next_free: Id,

    /// denormalized parent data: parent -> children
    parent_views: std.AutoHashMap(Id, std.array_hash_map.Auto(Id, void)),

    pub fn init(allocator: Allocator, initial_capacity: usize, node_pool: *Node.Pool) Allocator.Error!Pool {
        var pool = Pool{
            .allocator = allocator,
            .node_pool = node_pool,
            .views = std.ArrayList(View).empty,
            .next_free = @enumFromInt(0),
            .parent_views = std.AutoHashMap(Id, std.array_hash_map.Auto(Id, void)).init(allocator),
        };
        try pool.preheat(initial_capacity);
        return pool;
    }

    pub fn deinit(self: *Pool) void {
        self.views.deinit(self.allocator);
        var parents_iter = self.parent_views.valueIterator();
        while (parents_iter.next()) |children| {
            children.deinit(self.allocator);
        }
        self.parent_views.deinit();
        self.* = undefined;
    }

    pub fn preheat(self: *Pool, additional_size: usize) Allocator.Error!void {
        const old_size = self.views.items.len;
        const new_size = old_size + additional_size;

        try self.views.resize(self.allocator, new_size);

        for (old_size..new_size) |i| {
            self.views.items[i] = View{
                .root_node = @enumFromInt(0),
                .next_free = @enumFromInt(i + 1),
                .parent = null,
            };
        }
    }

    pub fn create(self: *Pool, root_node: Node.Id, parent: ?View.Parent) Node.Error!Id {
        std.debug.assert(@intFromEnum(self.next_free) <= self.views.items.len);

        const n = self.next_free;
        // allocate more view space if needed (reuse from the pool if possible)
        if (@intFromEnum(self.next_free) == self.views.items.len) {
            try self.preheat(1);
        }
        self.next_free = self.views.items[@intFromEnum(n)].next_free.?;

        // initialize the view
        try self.node_pool.ref(root_node);
        self.views.items[@intFromEnum(n)] = View{
            .root_node = root_node,
            .next_free = null,
            .parent = parent,
        };

        // add the child to the parent hashmap
        if (parent) |p| {
            const entry = try self.parent_views.getOrPut(p.root_view);
            if (!entry.found_existing) {
                entry.value_ptr.* = .empty;
            }
            try entry.value_ptr.put(self.allocator, n, {});
        }
        return n;
    }

    /// Destroy a view and return its slot to the free list. Destroy children before parents: a
    /// surviving child still points at this view's id, so once the slot is reused it would drive
    /// its writes into an unrelated view. The assert catches that early in safe builds.
    pub fn destroy(self: *Pool, view_id: View.Id) void {
        const view = &self.views.items[@intFromEnum(view_id)];
        // delink the view from its children and deinit the children hashmap
        if (self.parent_views.fetchRemove(view_id)) |kv| {
            var children = kv.value;
            std.debug.assert(children.count() == 0);
            children.deinit(self.allocator);
        }
        // delink the view from its parent
        if (view.parent) |parent| {
            if (self.parent_views.getPtr(parent.root_view)) |children| {
                _ = children.swapRemove(view_id);
            }
        }
        // unref the root node
        self.node_pool.unref(view.root_node);
        // Poison the slot so a later reuse can't mistake these leftover fields for a live view.
        view.parent = null;
        view.root_node = @enumFromInt(0);
        // push to the free list
        view.next_free = self.next_free;
        self.next_free = view_id;
    }
};

pub const Id = enum(u32) {
    _,

    pub fn clone(view_id: View.Id, pool: *Pool) Node.Error!View.Id {
        const view = &pool.views.items[@intFromEnum(view_id)];
        return try pool.create(view.root_node, view.parent);
    }

    pub fn createSubview(view_id: View.Id, pool: *Pool, gindex: Gindex) Node.Error!View.Id {
        const node_id = try view_id.getNode(pool, gindex);
        return try pool.create(node_id, .{
            .root_view = view_id,
            .child_gindex = gindex,
        });
    }

    pub fn getRootNode(self: View.Id, pool: *Pool) Node.Id {
        return pool.views.items[@intFromEnum(self)].root_node;
    }

    pub fn getParent(self: View.Id, pool: *Pool) ?View.Parent {
        return pool.views.items[@intFromEnum(self)].parent;
    }

    /// Set the root node of the view without updating the parent.
    fn setRootNodeUnsafe(self: View.Id, pool: *Pool, root_node: Node.Id) Node.Error!void {
        const view = &pool.views.items[@intFromEnum(self)];
        try pool.node_pool.ref(root_node);
        pool.node_pool.unref(view.root_node);
        view.root_node = root_node;
    }

    /// Update the linked parent
    fn updateParentUnsafe(pool: *Pool, parent: Parent, root_node: Node.Id) Node.Error!void {
        try parent.root_view.setNode(pool, parent.child_gindex, root_node);
    }

    /// Update linked children of the view affected by a change at gindex
    fn updateChildrenUnsafe(pool: *Pool, root_node: Node.Id, children: std.array_hash_map.Auto(View.Id, void), gindex: Gindex) Node.Error!void {
        // update linked children that were affected
        for (children.keys()) |child_id| {
            // self + gindex
            const parent = child_id.getParent(pool);
            std.debug.assert(parent != null);

            // if the child was not affected by this update, skip it
            if (!gindex.isPrefixPath(parent.?.child_gindex)) continue;

            const child_gindex = parent.?.child_gindex;
            const child_root_node = try root_node.getNode(pool.node_pool, child_gindex);
            try child_id.setRootNodeUnsafe(pool, child_root_node);

            // recursively update the children of this child
            if (pool.parent_views.get(child_id)) |children_of_child| {
                try updateChildrenUnsafe(pool, child_root_node, children_of_child, gindex.getChildGindex(child_gindex));
            }
        }
    }

    /// Set the root node of the view and update the parent if necessary.
    pub fn setRootNode(self: View.Id, pool: *Pool, new_root: Node.Id) Node.Error!void {
        if (self.getParent(pool)) |parent| {
            // if the view has a parent, update the parent, which will in turn update self and self's children
            try updateParentUnsafe(pool, parent, new_root);
        } else {
            try self.setRootNodeUnsafe(pool, new_root);
            if (pool.parent_views.get(self)) |children| {
                try updateChildrenUnsafe(pool, new_root, children, @enumFromInt(1));
            }
        }
    }

    pub fn getNode(self: View.Id, pool: *Pool, gindex: Gindex) !Node.Id {
        return pool.views.items[@intFromEnum(self)].root_node.getNode(pool.node_pool, gindex);
    }

    pub fn setNode(self: View.Id, pool: *Pool, gindex: Gindex, node: Node.Id) Node.Error!void {
        const view = &pool.views.items[@intFromEnum(self)];
        const new_root = try view.root_node.setNode(pool.node_pool, gindex, node);

        if (self.getParent(pool)) |parent| {
            // if the view has a parent, update the parent, which will in turn update self and self's children
            try updateParentUnsafe(pool, parent, new_root);
        } else {
            // if the view has no parent, just set the root node
            try self.setRootNodeUnsafe(pool, new_root);
            if (pool.parent_views.get(self)) |children| {
                // update the children of this view
                try updateChildrenUnsafe(pool, new_root, children, gindex);
            }
        }
    }

    pub fn getNodeAtDepth(self: View.Id, pool: *Pool, depth: Depth, index: usize) Node.Error!Node.Id {
        return pool.views.items[@intFromEnum(self)].root_node.getNodeAtDepth(pool.node_pool, depth, index);
    }

    pub fn setNodeAtDepth(self: View.Id, pool: *Pool, depth: Depth, index: usize, node: Node.Id) Node.Error!void {
        const view = &pool.views.items[@intFromEnum(self)];
        const new_root = try view.root_node.setNodeAtDepth(pool.node_pool, depth, index, node);

        if (self.getParent(pool)) |parent| {
            // if the view has a parent, update the parent, which will in turn update self and self's children
            try updateParentUnsafe(pool, parent, new_root);
        } else {
            // if the view has no parent, just set the root node
            try self.setRootNodeUnsafe(pool, new_root);
            if (pool.parent_views.get(self)) |children| {
                // update the children of this view
                try updateChildrenUnsafe(pool, new_root, children, Gindex.fromDepth(depth, index));
            }
        }
    }

    pub fn getNodesAtDepth(self: View.Id, pool: *Pool, depth: Depth, start_index: usize, out: []Node.Id) Node.Error!void {
        try pool.views.items[@intFromEnum(self)].root_node.getNodesAtDepth(pool.node_pool, depth, start_index, out);
    }

    pub fn setNodesAtDepth(self: View.Id, pool: *Pool, depth: Depth, indices: []usize, nodes: []Node.Id) Node.Error!void {
        const view = &pool.views.items[@intFromEnum(self)];
        const new_root = try view.root_node.setNodesAtDepth(pool.node_pool, depth, indices, nodes);

        if (self.getParent(pool)) |parent| {
            // if the view has a parent, update the parent, which will in turn update self and self's children
            try updateParentUnsafe(pool, parent, new_root);
        } else {
            // if the view has no parent, just set the root node
            try self.setRootNodeUnsafe(pool, new_root);
            if (pool.parent_views.get(self)) |children| {
                // update the children of this view
                for (indices) |index| {
                    try updateChildrenUnsafe(pool, new_root, children, Gindex.fromDepth(depth, index));
                }
            }
        }
    }
};

test {
    _ = @import("view_test.zig");
}
