const std = @import("std");

const max_depth = @import("hashing").max_depth;
const Depth = @import("hashing").Depth;

const Node = @import("Node.zig");
const Gindex = @import("gindex.zig").Gindex;
const ChunkedLeaf = @import("ChunkedLeaf.zig");

// Allocate until the fixed pool is full. Returns the filler nodes to the caller for cleanup.
fn fillPoolToCapacity(pool: *Node.Pool, out: *std.ArrayList(Node.Id)) !void {
    while (pool.createLeafFromUint(0)) |id| {
        try out.append(std.testing.allocator, id);
    } else |err| switch (err) {
        // Match exhaustively so a new error variant breaks the build instead of ending the drain.
        error.PoolExhausted => {},
    }
}

// When append's createBranch fails, both `left` (still in self.lefts) and `carry` must be
// reclaimed. Here they are two different nodes.
test "SubtreeBuilder - pool exhaustion with distinct nodes does not leak" {
    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 4 });
    defer pool.deinit();

    const baseline = pool.getNodesInUse();

    const a = try pool.createLeafFromUint(1);
    const b = try pool.createLeafFromUint(2);

    var drained: std.ArrayList(Node.Id) = .empty;
    defer drained.deinit(std.testing.allocator);
    try fillPoolToCapacity(&pool, &drained);

    var iter = Node.SubtreeBuilder.init(&pool, 1);
    try iter.append(a); // stored in lefts[0], no allocation
    try std.testing.expectError(error.PoolExhausted, iter.append(b));
    iter.deinit(); // must reclaim a (lefts[0]) and b (unref'd in append)

    for (drained.items) |id| pool.unref(id);
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}

// The all-default path pairs a node with itself (createBranch(X, X)). On failure append must not
// unref `carry` — it's the same node as `left`, which deinit reclaims; doing both double-frees.
test "SubtreeBuilder - pool exhaustion with aliased node does not double-free" {
    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 4 });
    defer pool.deinit();

    const baseline = pool.getNodesInUse();

    const x = try pool.createLeafFromUint(7);

    var drained: std.ArrayList(Node.Id) = .empty;
    defer drained.deinit(std.testing.allocator);
    try fillPoolToCapacity(&pool, &drained);

    var iter = Node.SubtreeBuilder.init(&pool, 1);
    try iter.append(x); // lefts[0] = x
    try std.testing.expectError(error.PoolExhausted, iter.append(x));
    iter.deinit(); // reclaims x exactly once (carry==left so append did not unref it)

    for (drained.items) |id| pool.unref(id);
    try std.testing.expectEqual(baseline, pool.getNodesInUse());
}

test "Node.State predicates" {
    // Exercises State predicates via `id.getState(pool)` over each variant:
    // zero sentinel, leaf, lazy/computed branch, free slot.
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4 });
    defer pool.deinit();
    const p = &pool;

    // Zero-node sentinel at index 0
    const zero0: Node.Id = @enumFromInt(0);
    const zero_state = zero0.getState(p);
    try std.testing.expect(zero_state.isZero());
    try std.testing.expect(!zero_state.isLeaf());
    try std.testing.expect(!zero_state.isBranch());
    try std.testing.expect(!zero0.isBranchLazy(p));
    try std.testing.expect(!zero0.isBranchComputed(p));
    try std.testing.expect(!zero_state.isFree());

    // Leaf
    const leaf = try pool.createLeafFromUint(42);
    const leaf_state = leaf.getState(p);
    try std.testing.expect(leaf_state.isLeaf());
    try std.testing.expect(!leaf_state.isZero());
    try std.testing.expect(!leaf_state.isBranch());
    try std.testing.expect(!leaf.isBranchLazy(p));
    try std.testing.expect(!leaf.isBranchComputed(p));
    try std.testing.expect(!leaf_state.isFree());

    // Lazy branch (root not yet computed)
    const branch = try pool.createBranch(leaf, leaf);
    defer pool.unref(branch);
    try std.testing.expect(branch.getState(p).isBranch());
    try std.testing.expect(branch.isBranchLazy(p));
    try std.testing.expect(!branch.isBranchComputed(p));
    try std.testing.expect(!branch.getState(p).isZero());
    try std.testing.expect(!branch.getState(p).isLeaf());
    try std.testing.expect(!branch.getState(p).isFree());

    // After computing the root the same slot reports computed.
    _ = branch.getRoot(p);
    try std.testing.expect(branch.getState(p).isBranch());
    try std.testing.expect(branch.isBranchComputed(p));
    try std.testing.expect(!branch.isBranchLazy(p));
    try std.testing.expect(!branch.getState(p).isZero());
    try std.testing.expect(!branch.getState(p).isLeaf());

    // Free slot: allocate, then unref so the slot is back on the free list.
    const transient = try pool.createLeafFromUint(7);
    pool.unref(transient);
    const free_state = transient.getState(p);
    try std.testing.expect(free_state.isFree());
    try std.testing.expect(!free_state.isLeaf());
    try std.testing.expect(!free_state.isZero());
    try std.testing.expect(!free_state.isBranch());
    // Free slots expose the next-free link via `state.nextFree()`.
    _ = free_state.nextFree();
}

test "chunked_leaf getRoot recomputes without touching the pool allocator" {
    var counter = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = std.math.maxInt(usize) });
    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = counter.allocator(), .pool_size = 16 });
    defer pool.deinit();

    var chunks: [ChunkedLeaf.K][32]u8 align(64) = undefined;
    for (&chunks, 0..) |*c, i| c.* = [_]u8{@intCast(i & 0xff)} ** 32;

    const node = try pool.createChunkedLeaf(&chunks, ChunkedLeaf.K);
    defer pool.unref(node);

    const allocs_before = counter.alloc_index;
    _ = node.getRoot(&pool); // root starts lazy → this recomputes
    try std.testing.expectEqual(allocs_before, counter.alloc_index);
}

test "Pool" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 10 });
    defer pool.deinit();
    const p = &pool;

    const hash1: [32]u8 = [_]u8{1} ** 32;
    const hash2: [32]u8 = [_]u8{2} ** 32;

    const leaf1_id = try pool.createLeaf(&hash1);
    const leaf2_id = try pool.createLeaf(&hash2);

    const branch1_id = try pool.createBranch(leaf1_id, leaf2_id);
    const branch2_id = try pool.createBranch(branch1_id, @enumFromInt(0));
    const branch3_id = try pool.createBranch(leaf2_id, @enumFromInt(0));

    // unrefing branch2 should unref all linked nodes except branch3 and leaf2 which is still refed by branch3
    pool.unref(branch2_id);

    try std.testing.expect(branch2_id.getState(p).isFree());
    try std.testing.expect(branch1_id.getState(p).isFree());
    try std.testing.expect(leaf1_id.getState(p).isFree());

    // unrefing branch3 should unref remaining linked nodes
    pool.unref(branch3_id);

    try std.testing.expect(leaf2_id.getState(p).isFree());
    try std.testing.expect(branch3_id.getState(p).isFree());

    // check if the free list is correct
    const next_free: Node.Id = pool.next_free_node;
    try std.testing.expectEqual(leaf2_id, next_free);
    try std.testing.expectEqual(branch3_id, next_free.getState(p).nextFree());
    try std.testing.expectEqual(leaf1_id, next_free.getState(p).nextFree().getState(p).nextFree());
    try std.testing.expectEqual(branch1_id, next_free.getState(p).nextFree().getState(p).nextFree().getState(p).nextFree());
    try std.testing.expectEqual(branch2_id, next_free.getState(p).nextFree().getState(p).nextFree().getState(p).nextFree().getState(p).nextFree());
}

test "Pool - fixed capacity exhausts, reuses slots, and keeps columns stable" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 3 });
    defer pool.deinit();

    // Keep the column addresses so the test can prove that using the fixed slots never moves them.
    const payloads_ptr = pool.nodes.items(.payload).ptr;
    const roots_ptr = pool.nodes.items(.root).ptr;
    const states_ptr = pool.nodes.items(.state).ptr;

    const first = try pool.createLeafFromUint(1);
    const second = try pool.createLeafFromUint(2);
    const third = try pool.createLeafFromUint(3);
    try std.testing.expectError(error.PoolExhausted, pool.createLeafFromUint(4));

    try std.testing.expectEqual(max_depth + 3, pool.nodes.len);
    try std.testing.expectEqual(pool.nodes.len, pool.nodes.capacity);
    try std.testing.expectEqual(payloads_ptr, pool.nodes.items(.payload).ptr);
    try std.testing.expectEqual(roots_ptr, pool.nodes.items(.root).ptr);
    try std.testing.expectEqual(states_ptr, pool.nodes.items(.state).ptr);
    try std.testing.expectEqual(max_depth + 3, pool.getNodesInUse());

    // Once the Pool is full, releasing one slot should make that exact ID available again.
    pool.unref(second);
    const replacement = try pool.createLeafFromUint(4);
    try std.testing.expectEqual(second, replacement);
    try std.testing.expectError(error.PoolExhausted, pool.createLeafFromUint(5));

    pool.unref(first);
    pool.unref(replacement);
    pool.unref(third);
    try std.testing.expectEqual(max_depth, pool.getNodesInUse());
}

test "Pool - live occupancy counts shared nodes and chunked payloads once" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4 });
    defer pool.deinit();

    const leaf = try pool.createChunkedLeafEmpty(1);
    const first = try pool.createBranch(leaf, leaf);
    const second = try pool.createBranch(leaf, leaf);
    try std.testing.expectEqual(max_depth + 3, pool.getNodesInUse());

    pool.unref(first);
    try std.testing.expectEqual(max_depth + 2, pool.getNodesInUse());
    pool.unref(first);
    pool.unref(@enumFromInt(0));
    try std.testing.expectEqual(max_depth + 2, pool.getNodesInUse());
    pool.unref(second);
    try std.testing.expectEqual(max_depth, pool.getNodesInUse());
}

test "Pool - invalid capacity fails before allocation" {
    for ([_]u32{
        Node.State.next_free_mask - max_depth + 1,
        std.math.maxInt(u32),
    }) |invalid_capacity| {
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
        try std.testing.expectError(error.InvalidPoolCapacity, Node.Pool.init(.{
            .page_allocator = failing.allocator(),
            .allocator = std.testing.allocator,
            .pool_size = invalid_capacity,
        }));
        try std.testing.expectEqual(0, failing.alloc_index);
    }
}

test "All zero hashes (depth>0) point both children to the previous depth" {
    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 1 });
    defer pool.deinit();
    const p = &pool;

    // depth i lives at Id i (0‑based)
    for (1..max_depth) |d| {
        const id: Node.Id = @enumFromInt(d);
        const prev: Node.Id = @enumFromInt(d - 1);

        try std.testing.expectEqual(prev, try id.getLeft(p));
        try std.testing.expectEqual(prev, try id.getRight(p));
    }
}

test "Navigation - invalid node access is rejected" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 8 });
    defer pool.deinit();
    const p = &pool;

    // A freshly‑minted leaf has no children
    const leaf = try pool.createLeafFromUint(42);
    defer pool.unref(leaf);
    try std.testing.expectError(error.InvalidNode, leaf.getLeft(p));
    try std.testing.expectError(error.InvalidNode, leaf.getRight(p));

    // The depth‑0 zero‑hash node (Id 0) likewise has no children
    const zero0: Node.Id = @enumFromInt(0);
    try std.testing.expectError(error.InvalidNode, zero0.getLeft(p));
    try std.testing.expectError(error.InvalidNode, zero0.getRight(p));
}

test "Pool.alloc returns unique nodes and restores partial allocations on exhaustion" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = max_depth });
    defer pool.deinit();
    const p = &pool;

    var nodes: [max_depth]Node.Id = undefined;
    try p.alloc(&nodes);
    defer p.free(&nodes);

    var node_set = std.AutoHashMap(Node.Id, void).init(allocator);
    defer node_set.deinit();

    for (nodes) |node| {
        try node_set.put(node, {});
    }

    try std.testing.expectEqual(nodes.len, node_set.count());

    // Leave one slot free and request two. The failed batch must put its temporary slot back.
    pool.unref(nodes[0]);
    const nodes_in_use = pool.getNodesInUse();
    var rejected: [2]Node.Id = undefined;
    try std.testing.expectError(error.PoolExhausted, pool.alloc(&rejected));
    try std.testing.expectEqual(nodes_in_use, pool.getNodesInUse());

    // Reusing the same ID proves that the failed batch left the free list intact.
    const reused = try pool.createLeafFromUint(1);
    try std.testing.expectEqual(nodes[0], reused);
    pool.unref(reused);
}

test "get/setNode" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4 });
    defer pool.deinit();
    const p = &pool;

    const zero3: Node.Id = @enumFromInt(3);

    try std.testing.expectEqual(@as(Node.Id, @enumFromInt(0)), try zero3.getNode(p, Gindex.fromDepth(3, 0)));

    const leaf = try pool.createLeafFromUint(42);
    const new_node = try zero3.setNode(p, Gindex.fromDepth(3, 0), leaf);
    defer pool.unref(new_node);
    try std.testing.expectEqual(leaf, try new_node.getNode(p, Gindex.fromDepth(3, 0)));
}

test "setNodes for checkpoint tree" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 10 });
    defer pool.deinit();
    const p = &pool;

    const epoch_node = try pool.createLeafFromUint(42);
    const root = [_]u8{0} ** 32;
    const root_node = try pool.createLeaf(&root);
    const parent = try pool.createBranch(epoch_node, root_node);
    defer pool.unref(parent);

    const new_epoch_node = try pool.createLeafFromUint(100);
    const new_root_node = try pool.createLeaf(&root);

    var new_nodes = [_]Node.Id{ new_epoch_node, new_root_node };
    const new_parent = try parent.setNodes(p, &[_]Gindex{ Gindex.fromUint(2), Gindex.fromUint(3) }, &new_nodes);
    try std.testing.expectEqual(new_epoch_node, try new_parent.getNode(p, Gindex.fromDepth(1, 0)));

    var out: [2]Node.Id = undefined;
    try new_parent.getNodesAtDepth(p, 1, 0, &out);
    defer pool.unref(new_parent);
    try std.testing.expectEqual(new_epoch_node, out[0]);
    try std.testing.expectEqual(new_root_node, out[1]);
}

// Empty `indices` should return the root untouched, not panic on the `for (1..0)` assert.
test "setNodesAtDepth - empty indices returns root unchanged" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const p = &pool;

    const root = try pool.createBranch(@enumFromInt(1), @enumFromInt(1));
    defer pool.unref(root);

    const indices = [_]usize{};
    var nodes = [_]Node.Id{};
    const result = try root.setNodesAtDepth(p, 2, &indices, &nodes);
    try std.testing.expectEqual(root, result);
}

test "Depth helpers - round-trip setNodesAtDepth / getNodesAtDepth" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const p = &pool;

    // A ‘blank’ root: branch of two depth‑1 zero‑nodes ensures proper navigation
    const root = try pool.createBranch(@enumFromInt(1), @enumFromInt(1));
    defer pool.unref(root);
    // Four leaves to be inserted at depth 2 (gindexes 4-7)
    var leaves: [4]Node.Id = undefined;
    for (0..4) |i| {
        leaves[i] = try pool.createLeafFromUint(@intCast(i + 100));
    }

    const indices = [_]usize{ 0, 1, 2, 3 };
    const depth: u8 = 2;

    const new_root = try root.setNodesAtDepth(p, depth, &indices, &leaves);
    defer pool.unref(new_root);
    // Verify individual look‑ups
    for (indices, 0..) |idx, i| {
        const g = Gindex.fromDepth(depth, idx);
        try std.testing.expectEqual(leaves[i], try new_root.getNode(p, g));
    }

    // Verify bulk retrieval helper
    var out: [4]Node.Id = undefined;
    try new_root.getNodesAtDepth(p, depth, 0, &out);
    for (0..4) |i| try std.testing.expectEqual(leaves[i], out[i]);
}

// If an early iteration errors, the errdefer frees path_parents while its start is still unfilled;
// the zero-fill makes those frees no-ops instead of unref-ing garbage.
test "setNodesAtDepth - early-iteration error frees cleanly without leaking or corrupting" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const p = &pool;

    // A leaf root hits InvalidNode on the first index; {0,1} share a prefix, so path_parents[0]
    // hasn't been filled yet when the errdefer runs.
    const root = try pool.createLeafFromUint(42);
    defer pool.unref(root);

    const baseline = pool.getNodesInUse();

    var leaves = [_]Node.Id{ @enumFromInt(0), @enumFromInt(0) };
    const indices = [_]usize{ 0, 1 };
    try std.testing.expectError(
        error.InvalidNode,
        root.setNodesAtDepth(p, 2, &indices, &leaves),
    );

    // Nothing extra was freed: the in-use count is back where it started.
    try std.testing.expectEqual(baseline, pool.getNodesInUse());

    // The pool still works: a normal op round-trips (it would hit a freed slot if corrupted).
    const tree_root = try pool.createBranch(@enumFromInt(1), @enumFromInt(1));
    defer pool.unref(tree_root);
    const new_leaf = try pool.createLeafFromUint(7);
    var ok_leaves = [_]Node.Id{new_leaf};
    const ok_indices = [_]usize{0};
    const new_root = try tree_root.setNodesAtDepth(p, 1, &ok_indices, &ok_leaves);
    defer pool.unref(new_root);
    try std.testing.expectEqual(new_leaf, try new_root.getNode(p, Gindex.fromDepth(1, 0)));
}

// A later-index failure makes rollback double-unref the spine onto already-freed slots.
test "setNodesAtDepth - later pool exhaustion rolls back without panicking on a freed slot" {
    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 16 });
    defer pool.deinit();

    const p = &pool;

    // Navigable depth-2 tree: branch(branch(la, lb), branch(lc, ld)).
    const left = try pool.createBranch(try pool.createLeafFromUint(1), try pool.createLeafFromUint(2));
    const right = try pool.createBranch(try pool.createLeafFromUint(3), try pool.createLeafFromUint(4));
    const root = try pool.createBranch(left, right);
    defer pool.unref(root);

    const new0 = try pool.createLeafFromUint(100);
    const new3 = try pool.createLeafFromUint(103);

    // Fill to capacity, then free 2 for iteration 0's path. Iteration 1 exhausts the pool.

    var filler: std.ArrayList(Node.Id) = .empty;
    defer filler.deinit(std.testing.allocator);

    try fillPoolToCapacity(&pool, &filler);
    pool.unref(filler.pop().?);
    pool.unref(filler.pop().?);

    const in_use_before = pool.getNodesInUse();

    var nodes_in = [_]Node.Id{ new0, new3 };
    const indices = [_]usize{ 0, 3 };
    try std.testing.expectError(
        error.PoolExhausted,
        root.setNodesAtDepth(p, 2, &indices, &nodes_in),
    );

    // Only the one already-inserted input leaf (new0) was reclaimed with the
    // torn-down spine; the original tree is intact and nothing leaked.
    try std.testing.expectEqual(in_use_before - 1, pool.getNodesInUse());

    for (filler.items) |id| pool.unref(id);

    // Free list is uncorrupted: a fresh batch set round-trips.
    const ok_tree = try pool.createBranch(@enumFromInt(1), @enumFromInt(1));
    defer pool.unref(ok_tree);

    const fresh = try pool.createLeafFromUint(7);
    var ok_leaves = [_]Node.Id{fresh};
    const ok_indices = [_]usize{0};

    const ok_root = try ok_tree.setNodesAtDepth(p, 1, &ok_indices, &ok_leaves);
    defer pool.unref(ok_root);

    try std.testing.expectEqual(fresh, try ok_root.getNode(p, Gindex.fromDepth(1, 0)));
}

// Same later-iteration rollback as above, through `setNodes` (gindex API).
test "setNodes - later pool exhaustion rolls back without panicking on a freed slot" {
    var pool = try Node.Pool.init(.{ .page_allocator = std.testing.allocator, .allocator = std.testing.allocator, .pool_size = 16 });
    defer pool.deinit();

    const p = &pool;

    const left = try pool.createBranch(try pool.createLeafFromUint(1), try pool.createLeafFromUint(2));
    const right = try pool.createBranch(try pool.createLeafFromUint(3), try pool.createLeafFromUint(4));
    const root = try pool.createBranch(left, right);
    defer pool.unref(root);

    const new0 = try pool.createLeafFromUint(100);
    const new3 = try pool.createLeafFromUint(103);

    // Same fill-to-capacity + free-2 setup as the setNodesAtDepth variant above.
    var filler: std.ArrayList(Node.Id) = .empty;
    defer filler.deinit(std.testing.allocator);

    try fillPoolToCapacity(&pool, &filler);
    pool.unref(filler.pop().?);
    pool.unref(filler.pop().?);

    const in_use_before = pool.getNodesInUse();

    var nodes_in = [_]Node.Id{ new0, new3 };
    const gindices = [_]Gindex{ Gindex.fromDepth(2, 0), Gindex.fromDepth(2, 3) };
    try std.testing.expectError(error.PoolExhausted, root.setNodes(p, &gindices, &nodes_in));
    try std.testing.expectEqual(in_use_before - 1, pool.getNodesInUse());

    for (filler.items) |id| pool.unref(id);

    const ok_tree = try pool.createBranch(@enumFromInt(1), @enumFromInt(1));
    defer pool.unref(ok_tree);

    const fresh = try pool.createLeafFromUint(7);
    var ok_leaves = [_]Node.Id{fresh};

    const ok_root = try ok_tree.setNodes(p, &[_]Gindex{Gindex.fromDepth(1, 0)}, &ok_leaves);
    defer pool.unref(ok_root);

    try std.testing.expectEqual(fresh, try ok_root.getNode(p, Gindex.fromDepth(1, 0)));
}

test "Node.State - refcount overflow saturates at rc_mask without corrupting kind" {
    var at_max = Node.State.initInUse(.leaf, Node.State.rc_mask);
    try std.testing.expectError(error.RefCountOverflow, at_max.incRefCount());
    try std.testing.expectEqual(Node.NodeKind.leaf, at_max.kind());
    try std.testing.expectEqual(Node.State.rc_mask, at_max.refCount());

    var near_max = Node.State.initInUse(.branch, Node.State.rc_mask - 1);
    try std.testing.expectEqual(Node.State.rc_mask, try near_max.incRefCount());
    try std.testing.expectEqual(Node.NodeKind.branch, near_max.kind());
}

test "Node.State - free-list link round-trips at the 31-bit boundary" {
    const max_link: Node.Id = @enumFromInt(Node.State.next_free_mask);
    const fs = Node.State.initFree(max_link);
    try std.testing.expect(fs.isFree());
    try std.testing.expectEqual(max_link, fs.nextFree());
}

const TestCase = struct {
    depth: u6,
    gindexes: []const usize,
    new_nodes: ?u8,
};

fn createTestCase(d: u6, gindexes: anytype, new_nodes: ?u8) TestCase {
    return .{
        .depth = d,
        .gindexes = &gindexes,
        .new_nodes = new_nodes,
    };
}

// refer to https://github.com/ChainSafe/ssz/blob/7f5580c2ea69f9307300ddb6010a8bc7ce2fc471/packages/persistent-merkle-tree/test/unit/tree.test.ts#L138
const test_cases = [_]TestCase{
    // depth 1
    createTestCase(1, [_]usize{2}, null),
    createTestCase(1, [_]usize{ 2, 3 }, null),
    // depth 2
    createTestCase(2, [_]usize{4}, null),
    createTestCase(2, [_]usize{6}, null),
    createTestCase(2, [_]usize{ 4, 6 }, null),
    // depth 3
    createTestCase(3, [_]usize{9}, null),
    createTestCase(3, [_]usize{12}, null),
    createTestCase(3, [_]usize{ 9, 10 }, null),
    createTestCase(3, [_]usize{ 13, 14 }, null),
    createTestCase(3, [_]usize{ 9, 10, 13, 14 }, null),
    createTestCase(3, [_]usize{ 8, 9, 10, 11, 12, 13, 14, 15 }, null),
    // depth 4
    createTestCase(4, [_]usize{16}, null),
    createTestCase(4, [_]usize{ 16, 17 }, null),
    createTestCase(4, [_]usize{ 16, 20 }, null),
    createTestCase(4, [_]usize{ 16, 20, 30 }, null),
    createTestCase(4, [_]usize{ 16, 20, 30, 31 }, null),
    // depth 5
    createTestCase(5, [_]usize{33}, null),
    createTestCase(5, [_]usize{ 33, 34 }, null),
    // depth 10
    createTestCase(10, [_]usize{ 1024, 1061, 1098, 1135, 1172, 1209, 1246, 1283 }, null),
    // depth 40
    createTestCase(40, [_]usize{ (2 << 39) + 1000, (2 << 39) + 1_000_000, (2 << 39) + 1_000_000_000 }, null),
    createTestCase(40, [_]usize{ 1157505940782, 1349082402477, 1759777921993 }, null),
    // new tests to also confirm the new nodes created to make sure there is no leaked/orphaned nodes during setNodes apis
    // set all leaves at depth 4, need 15 new branch nodes
    createTestCase(4, [_]usize{ 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31 }, 15),
    // set first and last leafs, need 7 new branch nodes
    createTestCase(4, [_]usize{ 16, 31 }, 7),
    // set first, second last and last leafs, need 7 new branch nodes
    createTestCase(4, [_]usize{ 16, 30, 31 }, 7),
    // same to above plus first node in the right branch, need 9 new branch nodes
    createTestCase(4, [_]usize{ 16, 24, 30, 31 }, 9),
    // same to above, 24 and 25 should need only 1 parent, still need 9 new branch nodes
    createTestCase(4, [_]usize{ 16, 24, 25, 30, 31 }, 9),
    // first node plus the whole right branch, need 11 new branch nodes
    createTestCase(4, [_]usize{ 16, 24, 25, 26, 27, 28, 29, 30, 31 }, 11),
    // first node plus even nodes in the right branch, need 11 new branch nodes
    createTestCase(4, [_]usize{ 16, 24, 26, 28, 30 }, 11),
    // first node plus odd nodes in the right branch, need 11 new branch nodes
    createTestCase(4, [_]usize{ 16, 25, 27, 29, 31 }, 11),
};

test "setNodesAtDepth, setNodes vs setNode multiple times" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 1024 });
    defer pool.deinit();
    const p = &pool;

    for (test_cases) |tc| {
        const depth = tc.depth;
        const base_gindex = Gindex.fromDepth(depth, 0);
        var gindexes = try allocator.alloc(Gindex, tc.gindexes.len);
        defer allocator.free(gindexes);
        var indexes = try allocator.alloc(usize, gindexes.len);
        defer allocator.free(indexes);
        var leaves = try allocator.alloc(Node.Id, gindexes.len);
        defer allocator.free(leaves);
        var root_ok: Node.Id = @enumFromInt(depth);
        defer pool.unref(root_ok);
        var root: Node.Id = @enumFromInt(depth);
        defer pool.unref(root);
        var root2: Node.Id = @enumFromInt(depth);
        defer pool.unref(root2);

        for (tc.gindexes, 0..) |gindex, i| {
            gindexes[i] = Gindex.fromUint(@intCast(gindex));
            indexes[i] = gindex - @intFromEnum(base_gindex);
            const leaf = try pool.createLeafFromUint(@intCast(gindex));
            leaves[i] = leaf;
            const old_root_ok = root_ok;
            root_ok = try root_ok.setNode(p, gindexes[i], leaf);
            // Unref the old root after setNode creates a new one
            if (old_root_ok != @as(Node.Id, @enumFromInt(depth))) {
                pool.unref(old_root_ok);
            }
        }

        var old_nodes = pool.getNodesInUse();
        root = try root.setNodesAtDepth(p, depth, indexes, leaves);
        if (tc.new_nodes) |n| {
            const new_nodes = pool.getNodesInUse() - old_nodes;
            try std.testing.expectEqual(n, new_nodes);
        }
        old_nodes = pool.getNodesInUse();
        root2 = try root.setNodes(p, gindexes, leaves);
        if (tc.new_nodes) |n| {
            const new_nodes = pool.getNodesInUse() - old_nodes;
            try std.testing.expectEqual(n, new_nodes);
        }

        const hash_ok = root_ok.getRoot(p);

        const hash = root.getRoot(p);
        try std.testing.expectEqualSlices(u8, hash_ok, hash);

        const hash2 = root2.getRoot(p);
        try std.testing.expectEqualSlices(u8, hash_ok, hash2);
    }
}

test "truncateAfterIndex zeros nodes after index" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 128 });
    defer pool.deinit();
    const p = &pool;

    const depth: Depth = 4;
    const max_length = @as(usize, 1) << depth;

    var leaves = try allocator.alloc(Node.Id, max_length);
    defer allocator.free(leaves);
    var original_leaves = try allocator.alloc(Node.Id, max_length);
    defer allocator.free(original_leaves);
    for (0..max_length) |i| {
        const leaf = try pool.createLeafFromUint(@intCast(i + 1));
        leaves[i] = leaf;
        original_leaves[i] = leaf;
    }

    const base_root = try Node.fillWithContents(p, leaves, depth);
    defer p.unref(base_root);

    const out_leaves = try allocator.alloc(Node.Id, max_length);
    defer allocator.free(out_leaves);

    const zero_leaf: Node.Id = @enumFromInt(0);

    for (0..max_length - 1) |idx| {
        const truncated = try Node.Id.truncateAfterIndex(base_root, p, depth, idx);
        defer p.unref(truncated);

        try truncated.getNodesAtDepth(p, depth, 0, out_leaves);

        for (0..max_length) |leaf_idx| {
            const expected = if (leaf_idx <= idx)
                original_leaves[leaf_idx]
            else
                zero_leaf;
            try std.testing.expectEqual(expected, out_leaves[leaf_idx]);
        }
    }
}

test "hashing sanity check" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 10 });
    defer pool.deinit();
    const p = &pool;

    const leaf = try pool.createLeafFromUint(0);
    const zero0: Node.Id = @enumFromInt(0);

    // sanity check that a manually zeroed node is actually zero
    try std.testing.expectEqualSlices(u8, zero0.getRoot(p), leaf.getRoot(p));

    const branch1 = try pool.createBranch(leaf, leaf);
    const branch2 = try pool.createBranch(branch1, branch1);
    defer pool.unref(branch2);
    const zero2: Node.Id = @enumFromInt(2);

    try std.testing.expectEqualSlices(u8, zero2.getRoot(p), branch2.getRoot(p));
}

// Refer to https://github.com/ChainSafe/ssz/blob/7f5580c2ea69f9307300ddb6010a8bc7ce2fc471/packages/persistent-merkle-tree/test/unit/tree/zeroAfterIndex.test.ts#L4-L39
test "truncateAfterIndex matches zeroAfterIndex test suite" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 8192 });
    defer pool.deinit();
    const p = &pool;

    const max_test_depth: usize = 6;

    for (0..max_test_depth) |depth_usize| {
        const depth: Depth = @intCast(depth_usize);
        const max_length = @as(usize, 1) << @intCast(depth);

        for (0..max_length) |length| {
            if (length == 0) continue;

            var leaves = try allocator.alloc(Node.Id, length);
            defer allocator.free(leaves);

            var roots_at_index = try allocator.alloc(Node.Id, length);
            defer allocator.free(roots_at_index);
            defer {
                for (roots_at_index) |root_id| {
                    pool.unref(root_id);
                }
            }

            var root: Node.Id = @enumFromInt(depth);
            try pool.ref(root);
            defer pool.unref(root);

            for (0..length) |i| {
                var hash = [_]u8{0} ** 32;
                const fill_value: u8 = @intCast(i + 16);
                @memset(hash[0..], fill_value);

                const leaf = try pool.createLeaf(&hash);
                leaves[i] = leaf;

                const gindex = Gindex.fromDepth(depth, i);
                const new_root = try root.setNode(p, gindex, leaf);
                try pool.ref(new_root);
                pool.unref(root);
                root = new_root;

                roots_at_index[i] = new_root;
                try pool.ref(roots_at_index[i]);
            }

            for (0..length) |idx| {
                const naive_root = try treeZeroAfterIndexNaive(p, allocator, depth, leaves, length, idx);
                defer pool.unref(naive_root);

                const truncated_root = try Node.Id.truncateAfterIndex(root, p, depth, idx);
                defer pool.unref(truncated_root);

                const expected_hash = roots_at_index[idx].getRoot(p);
                try std.testing.expectEqualSlices(u8, expected_hash, naive_root.getRoot(p));
                try std.testing.expectEqualSlices(u8, expected_hash, truncated_root.getRoot(p));
            }
        }
    }
}

fn treeZeroAfterIndexNaive(
    pool: *Node.Pool,
    allocator: std.mem.Allocator,
    depth: Depth,
    leaves: []const Node.Id,
    length: usize,
    index: usize,
) !Node.Id {
    std.debug.assert(length <= leaves.len);
    std.debug.assert(index < length);

    var contents = try allocator.alloc(Node.Id, length);
    defer allocator.free(contents);

    for (0..length) |i| {
        contents[i] = if (i <= index)
            leaves[i]
        else
            @enumFromInt(0);
    }

    return try Node.fillWithContents(pool, contents, depth);
}

test "DepthIterator matches getNodesAtDepth" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 64 });
    defer pool.deinit();
    const p = &pool;

    const depth: Depth = 2;
    const start_index: usize = 0;
    const count: usize = 4;

    // Create a root that is navigable to depth=2, then set all leaves at depth 2.
    const root = try pool.createBranch(@enumFromInt(1), @enumFromInt(1));
    defer pool.unref(root);

    var leaves: [count]Node.Id = undefined;
    for (0..count) |i| leaves[i] = try pool.createLeafFromUint(@intCast(i + 1000));

    const indices = [_]usize{ 0, 1, 2, 3 };
    const new_root = try root.setNodesAtDepth(p, depth, &indices, &leaves);
    defer pool.unref(new_root);

    // Baseline: bulk helper
    var bulk: [count]Node.Id = undefined;
    try new_root.getNodesAtDepth(p, depth, start_index, &bulk);

    // Iterator: one-by-one
    var it = Node.DepthIterator.init(p, new_root, depth, start_index);
    var iter: [count]Node.Id = undefined;
    for (0..count) |i| {
        iter[i] = try it.next();
    }
    try std.testing.expectError(error.InvalidLength, it.next());

    for (0..count) |j| {
        try std.testing.expectEqual(bulk[j], iter[j]);
    }
}

test "SubtreeBuilder matches fillWithContents" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 128 });
    defer pool.deinit();
    const p = &pool;

    const depth: Depth = 3;
    const count: usize = 5; // intentionally not a power of two

    var leaves = try allocator.alloc(Node.Id, count);
    defer allocator.free(leaves);

    for (0..count) |i| {
        leaves[i] = try pool.createLeafFromUint(@intCast(i + 1));
        try pool.ref(leaves[i]);
    }
    defer {
        for (leaves) |leaf| pool.unref(leaf);
    }

    // Batch
    for (1..count) |i| {
        // create a copy since fillWithContents mutates the input slice :(
        const leaves_copy = try allocator.dupe(Node.Id, leaves[0..i]);
        defer allocator.free(leaves_copy);

        const root_batch = try Node.fillWithContents(p, leaves_copy, depth);
        defer p.unref(root_batch);

        // Incremental
        var it = Node.SubtreeBuilder.init(p, depth);
        for (leaves[0..i]) |leaf| try it.append(leaf);
        const root_iter = try it.finish();
        defer p.unref(root_iter);

        try std.testing.expectEqualSlices(u8, root_batch.getRoot(p), root_iter.getRoot(p));
    }

    // Empty case should match `fillWithContents` behavior (returns zero-node at depth)
    var empty_it = Node.SubtreeBuilder.init(p, depth);
    errdefer empty_it.deinit();

    const empty_root_iter = try empty_it.finish();
    try std.testing.expectEqual(@as(Node.Id, @enumFromInt(depth)), empty_root_iter);
}

test "memory_safety: setNodesGrouped should release an intermediate root when a later group exhausts the pool" {
    var pool = try Node.Pool.init(.{
        .page_allocator = std.testing.allocator,
        .allocator = std.testing.allocator,
        .pool_size = 16,
    });
    defer pool.deinit();

    // A list tree stores its content on the left and its length on the right.
    const content_root = try pool.createBranch(
        try pool.createLeafFromUint(1),
        try pool.createLeafFromUint(2),
    );
    const original_length_node = try pool.createLeafFromUint(2);
    const root = try pool.createBranch(content_root, original_length_node);
    defer pool.unref(root);

    // The length update runs first. Once it succeeds, its temporary root owns this node.
    const replacement_length_node = try pool.createLeafFromUint(100);
    defer if (!replacement_length_node.getState(&pool).isFree()) {
        pool.unref(replacement_length_node);
    };

    // The data update runs second, and the test fails before this node is attached.
    const replacement_data_node = try pool.createLeafFromUint(101);
    defer pool.unref(replacement_data_node);

    var capacity_fill_nodes: std.ArrayList(Node.Id) = .empty;
    defer capacity_fill_nodes.deinit(std.testing.allocator);

    // Fill the pool, then give one slot back. The length update needs that one slot; the data
    // update needs more space and exhausts the fixed pool.
    while (pool.createLeafFromUint(0)) |id| {
        try capacity_fill_nodes.append(std.testing.allocator, id);
    } else |err| switch (err) {
        error.PoolExhausted => {},
    }
    pool.unref(capacity_fill_nodes.pop().?);

    const nodes_in_use_before_update = pool.getNodesInUse();
    // A list commit updates the length at depth 1 and the first data leaf at depth 2.
    const replacement_length_gindex = Gindex.fromDepth(1, 1);
    const replacement_data_gindex = Gindex.fromDepth(2, 0);
    const replacement_gindices = [_]Gindex{
        replacement_length_gindex,
        replacement_data_gindex,
    };
    var replacement_nodes = [_]Node.Id{ replacement_length_node, replacement_data_node };

    try std.testing.expectError(
        error.PoolExhausted,
        root.setNodesGrouped(&pool, &replacement_gindices, &replacement_nodes),
    );

    // The first update put the replacement length under the intermediate root. When the second
    // update fails, rolling back that root frees the length with it.
    try std.testing.expect(replacement_length_node.getState(&pool).isFree());

    // The original root was never consumed, and the failed second update never attached the data.
    try std.testing.expect(!root.getState(&pool).isFree());
    try std.testing.expect(!replacement_data_node.getState(&pool).isFree());

    // The intermediate root adds one node and rollback removes it again. The baseline already
    // counted the replacement length, so freeing that node is the only net change.
    try std.testing.expectEqual(nodes_in_use_before_update - 1, pool.getNodesInUse());

    for (capacity_fill_nodes.items) |id| pool.unref(id);
}

test "memory_safety: createChunkedLeafEmpty should not consume slots or leak payloads on allocation failure" {
    var failing = std.testing.FailingAllocator.init(
        std.testing.allocator,
        .{ .fail_index = 0 },
    );
    var pool = try Node.Pool.init(.{
        .page_allocator = std.testing.allocator,
        .allocator = failing.allocator(),
        .pool_size = 1,
    });
    defer pool.deinit();

    // The first call fails before it can take a Pool slot.
    const baseline = pool.getNodesInUse();
    try std.testing.expectError(error.OutOfMemory, pool.createChunkedLeafEmpty(1));
    try std.testing.expectEqual(baseline, pool.getNodesInUse());

    // With the only slot occupied, the next call allocates its payload and then fails to attach
    // it. The payload must be freed on the way out.
    failing.fail_index = std.math.maxInt(usize);
    const leaf = try pool.createLeafFromUint(1);
    defer pool.unref(leaf);

    try std.testing.expectError(error.PoolExhausted, pool.createChunkedLeafEmpty(1));
    try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
}

test "memory_safety: fillWithContents exhaustion should preserve inputs and restore pool slots" {
    const pool_exhaustion_cases = [_]struct {
        contents_len: usize,
        pool_size: u32,
        aliased: bool,
    }{
        // Aliased inputs with a partially built level above one completed level.
        .{ .contents_len = 8, .pool_size = 6, .aliased = true },
        // Distinct inputs with no parent in the failing level above two completed levels.
        .{ .contents_len = 8, .pool_size = 14, .aliased = false },
        // Distinct inputs with an odd completed level whose last parent includes a zero child.
        .{ .contents_len = 5, .pool_size = 9, .aliased = false },
    };

    for (pool_exhaustion_cases) |test_case| {
        var pool = try Node.Pool.init(.{
            .page_allocator = std.testing.allocator,
            .allocator = std.testing.allocator,
            .pool_size = test_case.pool_size,
        });
        defer pool.deinit();

        var contents: [8]Node.Id = undefined;
        var initialized_count: usize = 0;
        defer if (test_case.aliased) {
            if (initialized_count == 1) pool.unref(contents[0]);
        } else {
            pool.free(contents[0..initialized_count]);
        };

        // Aliased IDs stress refcount rollback; distinct IDs make a bad restoration order visible.
        if (test_case.aliased) {
            contents[0] = try pool.createLeafFromUint(1);
            initialized_count = 1;
            @memset(contents[0..test_case.contents_len], contents[0]);
        } else {
            for (0..test_case.contents_len) |i| {
                contents[i] = try pool.createLeafFromUint(i + 1);
                initialized_count += 1;
            }
        }

        var contents_before: [8]Node.Id = undefined;
        @memcpy(
            contents_before[0..test_case.contents_len],
            contents[0..test_case.contents_len],
        );
        var states_before: [8]Node.State = undefined;
        for (contents[0..test_case.contents_len], 0..) |node, i| {
            states_before[i] = node.getState(&pool);
        }
        const nodes_in_use_before = pool.getNodesInUse();

        // Each pool size runs out at the parent-building stage described by the case above.
        try std.testing.expectError(
            error.PoolExhausted,
            Node.fillWithContents(&pool, contents[0..test_case.contents_len], 3),
        );

        // A failed build must leave every caller-owned ID, refcount, and Pool slot unchanged.
        try std.testing.expectEqualSlices(
            Node.Id,
            contents_before[0..test_case.contents_len],
            contents[0..test_case.contents_len],
        );
        try std.testing.expectEqual(nodes_in_use_before, pool.getNodesInUse());
        for (contents[0..test_case.contents_len], 0..) |node, i| {
            try std.testing.expectEqual(states_before[i], node.getState(&pool));
        }
    }
}

test "getRoot hashes both spine directions at the maximum supported depth" {
    const hashing = @import("hashing");
    const allocator = std.testing.allocator;
    for ([_]bool{ false, true }) |left_spine| {
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var pool = try Node.Pool.init(.{
            .page_allocator = failing.allocator(),
            .allocator = failing.allocator(),
            .pool_size = max_depth + 1,
        });
        defer pool.deinit();

        var expected = [_]u8{0x12} ** 32;
        var root = try pool.createLeaf(&expected);
        defer pool.unref(root);
        for (0..max_depth) |depth| {
            const zero: Node.Id = @enumFromInt(depth);
            const child_root = expected;
            const zero_root = hashing.getZeroHash(@intCast(depth));
            if (left_spine) {
                root = try pool.createBranch(root, zero);
                hashing.hashOne(&expected, &child_root, zero_root);
            } else {
                root = try pool.createBranch(zero, root);
                hashing.hashOne(&expected, zero_root, &child_root);
            }
        }

        failing.fail_index = failing.alloc_index;
        failing.resize_fail_index = failing.resize_index;
        try std.testing.expectEqualSlices(u8, &expected, root.getRoot(&pool));
        try std.testing.expect(root.isBranchComputed(&pool));
        try std.testing.expectEqualSlices(u8, &expected, root.getRoot(&pool));
        try std.testing.expect(!failing.has_induced_failure);
    }
}

test "getRoot preserves shared branches and mixed cached payload roots" {
    const hashing = @import("hashing");
    const Payload = struct {
        calls: *usize,
        root: [32]u8,

        pub fn init(allocator: std.mem.Allocator, value: *const @This()) !*const @This() {
            const ptr = try allocator.create(@This());
            ptr.* = value.*;
            return ptr;
        }

        pub fn deinit(self: *@This(), allocator: std.mem.Allocator) void {
            allocator.destroy(self);
        }

        pub fn getRoot(self: *const @This(), out: *[32]u8) void {
            self.calls.* += 1;
            out.* = self.root;
        }

        pub fn toTree(self: *const @This(), pool: *Node.Pool) !Node.Id {
            return pool.createLeaf(&self.root);
        }
    };
    const allocator = std.testing.allocator;
    var failing = std.testing.FailingAllocator.init(allocator, .{});
    var pool = try Node.Pool.init(.{
        .page_allocator = failing.allocator(),
        .allocator = failing.allocator(),
        .pool_size = 16,
    });
    defer pool.deinit();

    var chunks: [ChunkedLeaf.K][32]u8 align(64) = undefined;
    for (&chunks, 0..) |*chunk, index| chunk.* = @splat(@as(u8, @intCast(index)));
    const chunked = try pool.createChunkedLeaf(&chunks, ChunkedLeaf.K);
    var chunked_root: [32]u8 = undefined;
    try hashing.merkleize(@ptrCast(&chunks), ChunkedLeaf.k_log2, &chunked_root);

    var calls: usize = 0;
    const payload = Payload{ .calls = &calls, .root = @splat(0x34) };
    const opaque_node = try pool.createContainerStruct(Payload, &payload);
    const leaf_value: [32]u8 = @splat(0xff);
    const leaf = try pool.createLeaf(&leaf_value);
    const zero: Node.Id = @enumFromInt(0);
    const shared = try pool.createBranch(chunked, opaque_node);
    const left = try pool.createBranch(shared, leaf);
    const right = try pool.createBranch(shared, zero);
    var root = try pool.createBranch(left, right);
    defer pool.unref(root);

    var shared_root: [32]u8 = undefined;
    var left_root: [32]u8 = undefined;
    var right_root: [32]u8 = undefined;
    var expected: [32]u8 = undefined;
    hashing.hashOne(&shared_root, &chunked_root, &payload.root);
    hashing.hashOne(&left_root, &shared_root, &leaf_value);
    hashing.hashOne(&right_root, &shared_root, hashing.getZeroHash(0));
    hashing.hashOne(&expected, &left_root, &right_root);

    failing.fail_index = failing.alloc_index;
    failing.resize_fail_index = failing.resize_index;
    try std.testing.expectEqualSlices(u8, &expected, root.getRoot(&pool));
    try std.testing.expectEqual(@as(usize, 1), calls);
    for ([_]Node.Id{ root, left, right, shared }) |branch| {
        try std.testing.expect(branch.isBranchComputed(&pool));
    }
    try std.testing.expectEqualSlices(u8, &leaf_value, leaf.getRoot(&pool));
    try std.testing.expectEqualSlices(u8, &chunked_root, chunked.getRoot(&pool));
    try std.testing.expectEqualSlices(u8, &payload.root, opaque_node.getRoot(&pool));

    const previous_root = expected;
    root = try pool.createBranch(root, shared);
    hashing.hashOne(&expected, &previous_root, &shared_root);
    try std.testing.expectEqualSlices(u8, &expected, root.getRoot(&pool));
    try std.testing.expectEqualSlices(u8, &expected, root.getRoot(&pool));
    try std.testing.expectEqual(@as(usize, 1), calls);
    try std.testing.expect(!failing.has_induced_failure);
}

test "editChunkedLeaf invalidates computed roots without allocating" {
    const Writer = struct {
        fn write(chunk: *[32]u8, _: usize, value: *const u256) void {
            std.mem.writeInt(u256, chunk, value.*, .little);
        }
    };
    const allocator = std.testing.allocator;
    var counter = std.testing.FailingAllocator.init(allocator, .{});
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = counter.allocator(), .pool_size = 3 });
    defer pool.deinit();

    const node = try pool.createChunkedLeafEmpty(0);
    defer pool.unref(node);
    const original_hash = node.getRoot(&pool).*;
    const allocations_before = counter.alloc_index;
    try node.editChunkedLeaf(&pool, ChunkedLeaf.K - 1, ChunkedLeaf.K, u256, 0, &std.math.maxInt(u256), Writer.write);
    try std.testing.expectEqual(allocations_before, counter.alloc_index);
    try std.testing.expectEqual(ChunkedLeaf.K, try node.getChunkedLeafLen(&pool));
    const first_hash = node.getRoot(&pool).*;
    try std.testing.expect(!std.mem.eql(u8, &original_hash, &first_hash));

    try node.editChunkedLeaf(&pool, 0, ChunkedLeaf.K, u256, 0, &42, Writer.write);
    try std.testing.expectEqual(allocations_before, counter.alloc_index);
    try std.testing.expect(!std.mem.eql(u8, &first_hash, node.getRoot(&pool)));

    var expected_chunks: [ChunkedLeaf.K][32]u8 align(64) = @splat(@splat(0));
    expected_chunks[0][0] = 42;
    expected_chunks[ChunkedLeaf.K - 1] = @splat(255);
    const expected = try pool.createChunkedLeaf(&expected_chunks, ChunkedLeaf.K);
    defer pool.unref(expected);
    try std.testing.expectEqualSlices(u8, expected.getRoot(&pool), node.getRoot(&pool));

    const leaf = try pool.createLeafFromUint(7);
    defer pool.unref(leaf);
    const leaf_hash = leaf.getRoot(&pool).*;
    try std.testing.expectError(error.InvalidNode, leaf.editChunkedLeaf(&pool, 0, 1, u256, 0, &42, Writer.write));
    try std.testing.expectEqualSlices(u8, &leaf_hash, leaf.getRoot(&pool));
}
