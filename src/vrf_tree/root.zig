//! A validator's VRF tree: a Merkle tree of depth `depth` whose leaves are
//! secret values, one per slot. The validator registers the root, and reveals
//! the leaf of a slot with its Merkle branch as its RANDAO reveal or its
//! aggregator selection proof.
//!
//! The leaves derive from a seed, which is the tree's whole secret. The tree
//! itself is too large to keep, so `VrfTree` holds only its layers above
//! subtrees of `2^subtree_depth` leaves and rebuilds the subtree a proof needs.

const std = @import("std");
const Allocator = std.mem.Allocator;
const c = @import("constants");
const hashing = @import("hashing");

pub const depth = c.VRF_TREE_DEPTH;
pub const subtree_depth = 16;
const top_depth = depth - subtree_depth;
const subtree_leaves = 1 << subtree_depth;
const subtree_count = 1 << top_depth;

pub const Seed = [32]u8;
pub const Root = [32]u8;
/// The leaf of a slot, then its Merkle branch from the bottom up.
pub const Proof = [depth + 1][32]u8;

pub const VrfTree = struct {
    allocator: Allocator,
    seed: Seed,
    /// Slots below `2^populated_depth` have a secret leaf. The rest are zero.
    populated_depth: u8,
    /// The layers over the subtree roots, as a binary heap: node 1 is the root
    /// and nodes `subtree_count..` are the subtree roots.
    top: [][32]u8,
    subtree: Subtree,
    /// The subtree `subtree.nodes` holds, if any.
    cached: ?u32 = null,

    /// One subtree as a binary heap: nodes `subtree_leaves..` are its leaves.
    const Subtree = struct {
        nodes: [][32]u8,
        /// Hash inputs of the leaves.
        preimages: [][2][32]u8,

        fn init(allocator: Allocator) !Subtree {
            const nodes = try allocator.alloc([32]u8, 2 * subtree_leaves);
            errdefer allocator.free(nodes);
            return .{ .nodes = nodes, .preimages = try allocator.alloc([2][32]u8, subtree_leaves) };
        }

        fn deinit(self: Subtree, allocator: Allocator) void {
            allocator.free(self.nodes);
            allocator.free(self.preimages);
        }

        /// Fills the heap for subtree `index`. Leaves from `populated` on are zero.
        fn build(self: Subtree, seed: *const Seed, index: u32, populated: u64) void {
            const first: u64 = @as(u64, index) << subtree_depth;
            const count: usize = @intCast(@min(populated -| first, subtree_leaves));
            for (self.preimages[0..count], first..) |*preimage, slot| {
                preimage[0] = seed.*;
                preimage[1] = @splat(0);
                std.mem.writeInt(u64, preimage[1][0..8], slot, .little);
            }
            const leaves = self.nodes[subtree_leaves..];
            hashing.hash(leaves[0..count], @ptrCast(self.preimages[0..count])) catch unreachable;
            @memset(leaves[count..], @splat(0));

            var width: usize = subtree_leaves;
            while (width > 1) : (width /= 2) {
                hashing.hash(self.nodes[width / 2 .. width], self.nodes[width .. 2 * width]) catch unreachable;
            }
        }
    };

    /// Builds the tree of `seed` on `threads` threads. A full tree hashes
    /// `2^(depth + 1)` times. `populated_depth` below `depth` leaves the later
    /// slots without a secret, which only a test network should accept.
    pub fn init(allocator: Allocator, seed: *const Seed, populated_depth: u8, threads: usize) !VrfTree {
        if (populated_depth > depth) return error.InvalidDepth;
        const populated = @as(u64, 1) << @intCast(populated_depth);

        const top = try allocator.alloc([32]u8, 2 * subtree_count);
        errdefer allocator.free(top);
        @memset(top[subtree_count..], hashing.getZeroHash(subtree_depth).*);

        const populated_subtrees: u32 = @intCast((populated - 1) / subtree_leaves + 1);
        var build: Build = .{ .seed = seed, .populated = populated, .roots = top[subtree_count..][0..populated_subtrees] };
        const workers = try allocator.alloc(std.Thread, @min(@max(threads, 1), populated_subtrees) - 1);
        defer allocator.free(workers);
        var spawned: usize = 0;
        for (workers) |*worker| {
            worker.* = std.Thread.spawn(.{}, Build.run, .{ &build, allocator }) catch break;
            spawned += 1;
        }
        build.run(allocator);
        for (workers[0..spawned]) |worker| worker.join();
        if (build.failed.load(.acquire)) return error.OutOfMemory;

        var width: usize = subtree_count;
        while (width > 1) : (width /= 2) {
            try hashing.hash(top[width / 2 .. width], top[width .. 2 * width]);
        }

        return .{
            .allocator = allocator,
            .seed = seed.*,
            .populated_depth = populated_depth,
            .top = top,
            .subtree = try Subtree.init(allocator),
        };
    }

    const Build = struct {
        seed: *const Seed,
        populated: u64,
        roots: [][32]u8,
        next: std.atomic.Value(u32) = .init(0),
        failed: std.atomic.Value(bool) = .init(false),

        fn run(self: *Build, allocator: Allocator) void {
            const subtree = Subtree.init(allocator) catch return self.failed.store(true, .release);
            defer subtree.deinit(allocator);
            while (true) {
                const index = self.next.fetchAdd(1, .monotonic);
                if (index >= self.roots.len) return;
                subtree.build(self.seed, index, self.populated);
                self.roots[index] = subtree.nodes[1];
            }
        }
    };

    pub fn deinit(self: *VrfTree) void {
        std.crypto.secureZero(u8, &self.seed);
        std.crypto.secureZero(u8, std.mem.sliceAsBytes(self.subtree.nodes));
        std.crypto.secureZero(u8, std.mem.sliceAsBytes(self.subtree.preimages));
        self.subtree.deinit(self.allocator);
        self.allocator.free(self.top);
        self.* = undefined;
    }

    pub fn root(self: *const VrfTree) Root {
        return self.top[1];
    }

    /// The proof for `slot`. Rebuilds a subtree when `slot` is outside the one
    /// last proved from, so calls must not overlap.
    pub fn proof(self: *VrfTree, slot: u64) error{SlotNotPopulated}!Proof {
        if (slot >> @intCast(self.populated_depth) != 0) return error.SlotNotPopulated;
        const index: u32 = @intCast(slot >> subtree_depth);
        if (self.cached != index) {
            self.subtree.build(&self.seed, index, @as(u64, 1) << @intCast(self.populated_depth));
            self.cached = index;
        }

        var out: Proof = undefined;
        var node: usize = subtree_leaves + @as(usize, @intCast(slot % subtree_leaves));
        out[0] = self.subtree.nodes[node];
        for (out[1..][0..subtree_depth]) |*sibling| {
            sibling.* = self.subtree.nodes[node ^ 1];
            node /= 2;
        }
        node = subtree_count + index;
        for (out[1 + subtree_depth ..]) |*sibling| {
            sibling.* = self.top[node ^ 1];
            node /= 2;
        }
        return out;
    }
};

test {
    _ = @import("root_test.zig");
}
