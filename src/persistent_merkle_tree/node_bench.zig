const std = @import("std");
const zbench = @import("zbench");

const Depth = @import("hashing").Depth;
const Node = @import("Node.zig");
const Pool = Node.Pool;

var pool: Pool = undefined;

const GetNodeRandomly = struct {
    depth: Depth,
    length: usize,
    root: Node.Id,
    num_iterations: usize,
    random: std.Random,

    pub fn init(
        depth: Depth,
        length: usize,
        pct: f32,
        root: Node.Id,
        seed: u64,
    ) !GetNodeRandomly {
        var random_impl = std.Random.DefaultPrng.init(seed);
        const random = random_impl.random();
        return GetNodeRandomly{
            .depth = depth,
            .length = length,
            .root = root,
            .num_iterations = @intFromFloat(@as(f32, @floatFromInt(length)) * pct),
            .random = random,
        };
    }

    pub fn run(self: *GetNodeRandomly, allocator: std.mem.Allocator) void {
        _ = allocator;
        for (0..self.num_iterations) |_| {
            const index = self.random.uintLessThanBiased(usize, self.length);
            std.mem.doNotOptimizeAway(
                self.root.getNodeAtDepth(&pool, self.depth, index) catch unreachable,
            );
        }
    }
};

const SetNodeRandomly = struct {
    depth: Depth,
    length: usize,
    root: *Node.Id,
    num_iterations: usize,
    random: std.Random,

    pub fn init(
        depth: Depth,
        length: usize,
        pct: f32,
        root: *Node.Id,
        seed: u64,
    ) !SetNodeRandomly {
        var random_impl = std.Random.DefaultPrng.init(seed);
        const random = random_impl.random();
        return SetNodeRandomly{
            .depth = depth,
            .length = length,
            .root = root,
            .num_iterations = @intFromFloat(@as(f32, @floatFromInt(length)) * pct),
            .random = random,
        };
    }

    pub fn run(self: *SetNodeRandomly, allocator: std.mem.Allocator) void {
        _ = allocator;
        for (0..self.num_iterations) |_| {
            const index = self.random.uintLessThanBiased(usize, self.length);
            const leaf = pool.createLeafFromUint(index) catch unreachable;
            const new_node = self.root.setNodeAtDepth(&pool, self.depth, index, leaf) catch unreachable;
            pool.ref(new_node) catch unreachable;
            pool.unref(self.root.*);
            self.root.* = new_node;
        }
    }
};

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    const allocator = std.heap.page_allocator;
    var bench = zbench.Benchmark.init(allocator, .{});
    defer bench.deinit();

    pool = try Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 50_000_000 });
    defer pool.deinit();

    const depth = 40;
    const length = 1_000_000;
    const pct = 0.5;

    var node_root = try createTree(allocator, depth, length);
    // const node_root = try createTree(allocator, depth, length);
    // try pool.ref(node_root);

    const get_nodes_randomly = try GetNodeRandomly.init(depth, length, pct, node_root, 0);
    try bench.addParam("get_nodes_randomly", &get_nodes_randomly, .{});

    const set_nodes_randomly = try SetNodeRandomly.init(depth, length, pct, &node_root, 0);
    try bench.addParam("set_nodes_randomly", &set_nodes_randomly, .{});

    try bench.run(io, std.Io.File.stdout());
}

fn createTree(allocator: std.mem.Allocator, depth: u6, length: usize) !Node.Id {
    const leaves = try allocator.alloc(Node.Id, length);
    defer allocator.free(leaves);

    for (0..leaves.len) |i| {
        leaves[i] = try pool.createLeafFromUint(i);
    }
    const root = try Node.fillWithContents(&pool, leaves, depth);
    try pool.ref(root);
    return root;
}
