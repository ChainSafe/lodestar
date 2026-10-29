//! Bench comparing FixedListType(Uint64, 2^20) leaf-default vs opts.chunked_leaf=true
//! on representative balances-scale workloads.
//!
//! Run with:
//!   zig build run:bench_list_chunked_leaf -Doptimize=ReleaseSafe -Dcpu=baseline
//!
//! Every workload is registered as a pair — `... leaf` vs `... chunked_leaf` —
//! so each line in the output is a direct A/B comparison of the two layouts.
//!
//! Workloads (1M u64 items unless noted):
//!  - fromValue:        build tree from a populated value
//!  - getRoot:          compute root hash from a freshly built tree
//!  - toValue:          decode all items back from the tree (bulk read)
//!  - get:              single-item reads at scattered indices (point read)
//!  - sparseSet:        single-item set + commit + getRoot via TreeView (CoW
//!                      path), repeated `SparseSetIters` times per run —
//!                      a pessimistic commit-per-set extreme
//!  - batchedSparseSet: `BatchedSparseCount` scattered sets staged, then ONE
//!                      commit + getRoot — matches per-block balance updates
//!  - bulkSetAndRoot:   set every item then getRoot (epoch-rewards-shaped)
//!  - proof:            single-chunk Merkle proof for a fixed gindex
const std = @import("std");
const zbench = @import("zbench");

const pmt = @import("persistent_merkle_tree");
const Node = pmt.Node;
const ChunkedLeaf = pmt.ChunkedLeaf;
const Gindex = pmt.Gindex;
const proof = pmt.proof;

const ssz = @import("ssz");
const FixedListType = ssz.FixedListType;
const UintType = ssz.UintType;

const Limit: comptime_int = 1 << 20;
const ItemCount: usize = 1 << 20;

const ListLeaf = FixedListType(UintType(64), Limit, .{});
const ListChunkedLeaf = FixedListType(UintType(64), Limit, .{ .chunked_leaf = true });

// Scattered point reads per `get` run — enough to clear timer noise.
const ProbeCount: usize = 1024;
// set+commit+getRoot cycles per `sparseSet` run.
const SparseSetIters: usize = 100;
// Sparse sets per `batchedSparseSet` run — the per-block sync-committee count.
const BatchedSparseCount: usize = 512;
// Stride for scattered sets: 41 chunked_leaves apart (K * 4 u64 items each)
// so each consecutive set lands in a distinct chunked_leaf — worst case for
// the chunked_leaf CoW path. The +1 keeps it odd, hence coprime with the
// 2^20 ItemCount.
const ScatterStride: usize = ChunkedLeaf.K * 4 * 41 + 1;

fn scatterIndex(i: usize) usize {
    return (i *% ScatterStride) % ItemCount;
}

// Proof target chunk. Tree shape is layout-independent, so one gindex serves both.
const ProofChunkIndex: usize = (ItemCount / 2) / 4;
const proof_gindex: Gindex = Gindex.fromDepth(ListLeaf.chunk_depth + 1, ProofChunkIndex);

// Shared input value used by all build-side benches.
var input_value: ListLeaf.Type = ListLeaf.Type.empty;

fn populateInput(allocator: std.mem.Allocator) !void {
    try input_value.ensureTotalCapacity(allocator, ItemCount);
    for (0..ItemCount) |i| {
        try input_value.append(allocator, @as(u64, @intCast(i * 31 + 1)));
    }
}

const FromValueLeaf = struct {
    pool: *Node.Pool,
    pub fn run(self: *FromValueLeaf, allocator: std.mem.Allocator) void {
        _ = allocator;
        const id = ListLeaf.tree.fromValue(self.pool, &input_value) catch unreachable;
        self.pool.unref(id);
    }
};

const FromValueChunkedLeaf = struct {
    pool: *Node.Pool,
    pub fn run(self: *FromValueChunkedLeaf, allocator: std.mem.Allocator) void {
        _ = allocator;
        const id = ListChunkedLeaf.tree.fromValue(self.pool, &input_value) catch unreachable;
        self.pool.unref(id);
    }
};

const GetRootLeaf = struct {
    pool: *Node.Pool,
    pub fn run(self: *GetRootLeaf, allocator: std.mem.Allocator) void {
        _ = allocator;
        const id = ListLeaf.tree.fromValue(self.pool, &input_value) catch unreachable;
        const root = id.getRoot(self.pool);
        std.mem.doNotOptimizeAway(root);
        self.pool.unref(id);
    }
};

const GetRootChunkedLeaf = struct {
    pool: *Node.Pool,
    pub fn run(self: *GetRootChunkedLeaf, allocator: std.mem.Allocator) void {
        _ = allocator;
        const id = ListChunkedLeaf.tree.fromValue(self.pool, &input_value) catch unreachable;
        const root = id.getRoot(self.pool);
        std.mem.doNotOptimizeAway(root);
        self.pool.unref(id);
    }
};

const ToValueLeaf = struct {
    pool: *Node.Pool,
    tree_id: Node.Id,
    pub fn run(self: *ToValueLeaf, allocator: std.mem.Allocator) void {
        var dst = ListLeaf.Type.empty;
        defer dst.deinit(allocator);
        ListLeaf.tree.toValue(allocator, self.tree_id, self.pool, &dst) catch unreachable;
        std.mem.doNotOptimizeAway(dst.items[0]);
    }
};

const ToValueChunkedLeaf = struct {
    pool: *Node.Pool,
    tree_id: Node.Id,
    pub fn run(self: *ToValueChunkedLeaf, allocator: std.mem.Allocator) void {
        var dst = ListChunkedLeaf.Type.empty;
        defer dst.deinit(allocator);
        ListChunkedLeaf.tree.toValue(allocator, self.tree_id, self.pool, &dst) catch unreachable;
        std.mem.doNotOptimizeAway(dst.items[0]);
    }
};

const GetLeaf = struct {
    view: *ListLeaf.TreeView,
    pub fn run(self: *GetLeaf, allocator: std.mem.Allocator) void {
        _ = allocator;
        var sum: u64 = 0;
        for (0..ProbeCount) |i| {
            sum +%= self.view.get(scatterIndex(i)) catch unreachable;
        }
        std.mem.doNotOptimizeAway(sum);
    }
};

const GetChunkedLeaf = struct {
    view: *ListChunkedLeaf.TreeView,
    pub fn run(self: *GetChunkedLeaf, allocator: std.mem.Allocator) void {
        _ = allocator;
        var sum: u64 = 0;
        for (0..ProbeCount) |i| {
            sum +%= self.view.get(scatterIndex(i)) catch unreachable;
        }
        std.mem.doNotOptimizeAway(sum);
    }
};

const SparseSetLeaf = struct {
    pool: *Node.Pool,
    base: Node.Id,
    pub fn run(self: *SparseSetLeaf, allocator: std.mem.Allocator) void {
        // `TreeView.init` consumes a ref; lend it one so `self.base` survives
        // for the next run.
        self.pool.ref(self.base) catch unreachable;
        const view = ListLeaf.TreeView.init(allocator, self.pool, self.base) catch unreachable;
        defer view.deinit();
        for (0..SparseSetIters) |iter| {
            view.set(scatterIndex(iter), @as(u64, @intCast(iter))) catch unreachable;
            view.commit() catch unreachable;
            std.mem.doNotOptimizeAway(view.getRoot().getRoot(self.pool));
        }
    }
};

const SparseSetChunkedLeaf = struct {
    pool: *Node.Pool,
    base: Node.Id,
    pub fn run(self: *SparseSetChunkedLeaf, allocator: std.mem.Allocator) void {
        // `TreeView.init` consumes a ref; lend it one so `self.base` survives
        // for the next run.
        self.pool.ref(self.base) catch unreachable;
        const view = ListChunkedLeaf.TreeView.init(allocator, self.pool, self.base) catch unreachable;
        defer view.deinit();
        for (0..SparseSetIters) |iter| {
            view.set(scatterIndex(iter), @as(u64, @intCast(iter))) catch unreachable;
            view.commit() catch unreachable;
            std.mem.doNotOptimizeAway(view.getRoot().getRoot(self.pool));
        }
    }
};

const BatchedSparseSetLeaf = struct {
    pool: *Node.Pool,
    base: Node.Id,
    pub fn run(self: *BatchedSparseSetLeaf, allocator: std.mem.Allocator) void {
        self.pool.ref(self.base) catch unreachable;
        const view = ListLeaf.TreeView.init(allocator, self.pool, self.base) catch unreachable;
        defer view.deinit();
        for (0..BatchedSparseCount) |i| {
            view.set(scatterIndex(i), @as(u64, @intCast(i))) catch unreachable;
        }
        view.commit() catch unreachable;
        std.mem.doNotOptimizeAway(view.getRoot().getRoot(self.pool));
    }
};

const BatchedSparseSetChunkedLeaf = struct {
    pool: *Node.Pool,
    base: Node.Id,
    pub fn run(self: *BatchedSparseSetChunkedLeaf, allocator: std.mem.Allocator) void {
        self.pool.ref(self.base) catch unreachable;
        const view = ListChunkedLeaf.TreeView.init(allocator, self.pool, self.base) catch unreachable;
        defer view.deinit();
        for (0..BatchedSparseCount) |i| {
            view.set(scatterIndex(i), @as(u64, @intCast(i))) catch unreachable;
        }
        view.commit() catch unreachable;
        std.mem.doNotOptimizeAway(view.getRoot().getRoot(self.pool));
    }
};

const BulkSetAndRootLeaf = struct {
    pool: *Node.Pool,
    mutated: *ListLeaf.Type,
    pub fn run(self: *BulkSetAndRootLeaf, allocator: std.mem.Allocator) void {
        _ = allocator;
        const id = ListLeaf.tree.fromValue(self.pool, self.mutated) catch unreachable;
        const root = id.getRoot(self.pool);
        std.mem.doNotOptimizeAway(root);
        self.pool.unref(id);
    }
};

const BulkSetAndRootChunkedLeaf = struct {
    pool: *Node.Pool,
    mutated: *ListChunkedLeaf.Type,
    pub fn run(self: *BulkSetAndRootChunkedLeaf, allocator: std.mem.Allocator) void {
        _ = allocator;
        const id = ListChunkedLeaf.tree.fromValue(self.pool, self.mutated) catch unreachable;
        const root = id.getRoot(self.pool);
        std.mem.doNotOptimizeAway(root);
        self.pool.unref(id);
    }
};

const ProofLeaf = struct {
    pool: *Node.Pool,
    root: Node.Id,
    pub fn run(self: *ProofLeaf, allocator: std.mem.Allocator) void {
        var single = proof.createSingleProof(allocator, self.pool, self.root, proof_gindex) catch unreachable;
        defer single.deinit(allocator);
        std.mem.doNotOptimizeAway(single.leaf[0]);
    }
};

const ProofChunkedLeaf = struct {
    pool: *Node.Pool,
    root: Node.Id,
    pub fn run(self: *ProofChunkedLeaf, allocator: std.mem.Allocator) void {
        var single = proof.createSingleProof(allocator, self.pool, self.root, proof_gindex) catch unreachable;
        defer single.deinit(allocator);
        std.mem.doNotOptimizeAway(single.leaf[0]);
    }
};

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    const allocator = std.heap.page_allocator;
    var bench = zbench.Benchmark.init(allocator, .{});
    defer bench.deinit();

    // Pin c_allocator for the small-object lane, like the production bindings.
    var pool = try Node.Pool.init(.{ .allocator = std.heap.c_allocator, .pool_size = 8_000_000 });
    defer pool.deinit();

    try populateInput(allocator);
    defer input_value.deinit(allocator);

    // Build per-layout reference trees once for the read-side benches.
    const tree_leaf = try ListLeaf.tree.fromValue(&pool, &input_value);
    defer pool.unref(tree_leaf);
    _ = tree_leaf.getRoot(&pool); // warm

    const tree_chunked_leaf = try ListChunkedLeaf.tree.fromValue(&pool, &input_value);
    defer pool.unref(tree_chunked_leaf);
    _ = tree_chunked_leaf.getRoot(&pool); // warm

    // Read-only views for `get`. `TreeView.init` takes the root ref, so lend
    // it a fresh one — `tree_*` stay owned for the other benches.
    try pool.ref(tree_leaf);
    const view_leaf = try ListLeaf.TreeView.init(allocator, &pool, tree_leaf);
    defer view_leaf.deinit();

    try pool.ref(tree_chunked_leaf);
    const view_chunked_leaf = try ListChunkedLeaf.TreeView.init(allocator, &pool, tree_chunked_leaf);
    defer view_chunked_leaf.deinit();

    // bulkSet input: each iteration rebuilds tree.fromValue on this value;
    // matches the shape of "epoch rewards rewrite all balances + recompute root".
    var mutated_leaf: ListLeaf.Type = ListLeaf.Type.empty;
    defer mutated_leaf.deinit(allocator);
    try mutated_leaf.ensureTotalCapacity(allocator, ItemCount);
    for (0..ItemCount) |i| {
        try mutated_leaf.append(allocator, @as(u64, @intCast(i * 17 + 3)));
    }

    var mutated_chunked_leaf: ListChunkedLeaf.Type = ListChunkedLeaf.Type.empty;
    defer mutated_chunked_leaf.deinit(allocator);
    try mutated_chunked_leaf.ensureTotalCapacity(allocator, ItemCount);
    for (0..ItemCount) |i| {
        try mutated_chunked_leaf.append(allocator, @as(u64, @intCast(i * 17 + 3)));
    }

    const fv_leaf = FromValueLeaf{ .pool = &pool };
    const fv_chunked_leaf = FromValueChunkedLeaf{ .pool = &pool };
    try bench.addParam("fromValue 1M leaf", &fv_leaf, .{});
    try bench.addParam("fromValue 1M chunked_leaf", &fv_chunked_leaf, .{});

    const gr_leaf = GetRootLeaf{ .pool = &pool };
    const gr_chunked_leaf = GetRootChunkedLeaf{ .pool = &pool };
    try bench.addParam("fromValue+getRoot 1M leaf", &gr_leaf, .{});
    try bench.addParam("fromValue+getRoot 1M chunked_leaf", &gr_chunked_leaf, .{});

    const tv_leaf = ToValueLeaf{ .pool = &pool, .tree_id = tree_leaf };
    const tv_chunked_leaf = ToValueChunkedLeaf{ .pool = &pool, .tree_id = tree_chunked_leaf };
    try bench.addParam("toValue 1M leaf", &tv_leaf, .{});
    try bench.addParam("toValue 1M chunked_leaf", &tv_chunked_leaf, .{});

    const get_leaf = GetLeaf{ .view = view_leaf };
    const get_chunked_leaf = GetChunkedLeaf{ .view = view_chunked_leaf };
    try bench.addParam("get 1K-scattered leaf", &get_leaf, .{});
    try bench.addParam("get 1K-scattered chunked_leaf", &get_chunked_leaf, .{});

    const ss_leaf = SparseSetLeaf{ .pool = &pool, .base = tree_leaf };
    const ss_chunked_leaf = SparseSetChunkedLeaf{ .pool = &pool, .base = tree_chunked_leaf };
    try bench.addParam("sparseSet 100x leaf", &ss_leaf, .{});
    try bench.addParam("sparseSet 100x chunked_leaf", &ss_chunked_leaf, .{});

    const bss_leaf = BatchedSparseSetLeaf{ .pool = &pool, .base = tree_leaf };
    const bss_chunked_leaf = BatchedSparseSetChunkedLeaf{ .pool = &pool, .base = tree_chunked_leaf };
    try bench.addParam("batchedSparseSet 512 leaf", &bss_leaf, .{});
    try bench.addParam("batchedSparseSet 512 chunked_leaf", &bss_chunked_leaf, .{});

    const bs_leaf = BulkSetAndRootLeaf{ .pool = &pool, .mutated = &mutated_leaf };
    const bs_chunked_leaf = BulkSetAndRootChunkedLeaf{ .pool = &pool, .mutated = &mutated_chunked_leaf };
    try bench.addParam("bulkSet+getRoot 1M leaf", &bs_leaf, .{});
    try bench.addParam("bulkSet+getRoot 1M chunked_leaf", &bs_chunked_leaf, .{});

    const proof_leaf = ProofLeaf{ .pool = &pool, .root = tree_leaf };
    const proof_chunked_leaf = ProofChunkedLeaf{ .pool = &pool, .root = tree_chunked_leaf };
    try bench.addParam("proof single-chunk leaf", &proof_leaf, .{});
    try bench.addParam("proof single-chunk chunked_leaf", &proof_chunked_leaf, .{});

    try bench.run(io, std.Io.File.stdout());

    _ = ChunkedLeaf; // silence unused if chunked_leaf code path proves unreachable in some build mode
}
