//! A validator's VRF tree: a Merkle tree of depth `depth`, hashed with
//! Keccak-256, whose leaves are secret values, one per slot. The validator
//! registers the root, and reveals the leaf of a slot with its Merkle branch as
//! its RANDAO reveal.
//!
//! The leaf of a slot is the hash of a seed and the slot, so the seed is the
//! tree's whole secret (the spec's `compute_vrf_leaf`). The tree
//! itself is too large to keep, so `VrfTree` holds only its layers above
//! subtrees of `2^subtree_depth` leaves and rebuilds the subtree a proof needs.

const std = @import("std");
const Allocator = std.mem.Allocator;
const c = @import("constants");
const Keccak256 = std.crypto.hash.sha3.Keccak256;

pub const depth = c.VRF_TREE_DEPTH;
pub const subtree_depth = 16;
const top_depth = depth - subtree_depth;
const subtree_leaves = 1 << subtree_depth;
const subtree_count = 1 << top_depth;

pub const Seed = [32]u8;
pub const Root = [32]u8;
/// The leaf of a slot, then its Merkle branch from the bottom up.
pub const Proof = [depth + 1][32]u8;

/// What a file of precomputed trees holds for one: its root, a slot, which is
/// zero, and that slot's Merkle branch from the bottom up. A full tree hashes
/// `2^32` times, so a validator builds only the leaves of its first slots and
/// takes the siblings above them from such a record.
pub const state_record_size = 32 + 4 + depth * 32;

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

        fn init(allocator: Allocator) !Subtree {
            return .{ .nodes = try allocator.alloc([32]u8, 2 * subtree_leaves) };
        }

        fn deinit(self: Subtree, allocator: Allocator) void {
            allocator.free(self.nodes);
        }

        /// Fills the heap for subtree `index`. Leaves from `populated` on are zero.
        fn build(self: Subtree, seed: *const Seed, index: u32, populated: u64) void {
            const first: u64 = @as(u64, index) << subtree_depth;
            const count: usize = @intCast(@min(populated -| first, subtree_leaves));
            const leaves = self.nodes[subtree_leaves..];
            var preimage: [@sizeOf(Seed) + 8]u8 = undefined;
            defer std.crypto.secureZero(u8, &preimage);
            @memcpy(preimage[0..@sizeOf(Seed)], seed);
            for (leaves[0..count], first..) |*leaf, slot| {
                std.mem.writeInt(u64, preimage[@sizeOf(Seed)..], slot, .little);
                Keccak256.hash(&preimage, leaf, .{});
            }
            @memset(leaves[count..], @splat(0));
            hashLayers(self.nodes);
        }
    };

    /// Builds the tree of `seed` on `threads` threads. A full tree hashes
    /// `2^(depth + 1)` times. `populated_depth` below `depth` builds the leaves
    /// of the first `2^populated_depth` slots only, and proves no other slot.
    ///
    /// What stands above those leaves is `records`' if given: `state_record_size`
    /// bytes per tree, one of which must be this seed's, or `error.NoMatchingState`.
    /// Without `records` the other leaves are zero, which is another tree than
    /// the seed's full one and only a test network should accept.
    pub fn init(allocator: Allocator, seed: *const Seed, populated_depth: u8, records: ?[]const u8, threads: usize) !VrfTree {
        const top = try allocTop(allocator, populated_depth, records);
        errdefer allocator.free(top);

        const roots = top[subtree_count..][0..populatedSubtrees(populated_depth)];
        var build: Build = .{ .seed = seed, .populated = @as(u64, 1) << @intCast(populated_depth), .roots = roots };
        const workers = try allocator.alloc(std.Thread, @min(@max(threads, 1), roots.len) - 1);
        defer allocator.free(workers);
        var spawned: usize = 0;
        for (workers) |*worker| {
            worker.* = std.Thread.spawn(.{}, Build.run, .{ &build, allocator }) catch break;
            spawned += 1;
        }
        build.run(allocator);
        for (workers[0..spawned]) |worker| worker.join();
        if (build.failed.load(.acquire)) return error.OutOfMemory;

        return finish(allocator, seed, populated_depth, records, top);
    }

    /// The tree of `seed` from `roots`, what `subtreeRoots` gave for a tree built
    /// with the same `seed`, `populated_depth` and leaf rule. It hashes the layers
    /// over them and no leaf, so a tree is back in milliseconds.
    ///
    /// `roots` are not checked against `seed`: the caller vouches that this seed's
    /// tree gave them. Roots of another tree give one whose proofs do not open,
    /// unless `records` are given and hold no record of that tree, which fails
    /// with `error.NoMatchingState`.
    pub fn initFromSubtreeRoots(
        allocator: Allocator,
        seed: *const Seed,
        populated_depth: u8,
        records: ?[]const u8,
        roots: []const [32]u8,
    ) !VrfTree {
        const top = try allocTop(allocator, populated_depth, records);
        errdefer allocator.free(top);
        if (roots.len != populatedSubtrees(populated_depth)) return error.InvalidSubtreeRoots;
        @memcpy(top[subtree_count..][0..roots.len], roots);
        return finish(allocator, seed, populated_depth, records, top);
    }

    /// The roots of the subtrees with a populated leaf, in order: all that building
    /// the tree hashed its leaves for. They are inner nodes and hold no secret.
    pub fn subtreeRoots(self: *const VrfTree) []const [32]u8 {
        return self.top[subtree_count..][0..populatedSubtrees(self.populated_depth)];
    }

    /// The top layers with every subtree root that of a subtree of zero leaves.
    fn allocTop(allocator: Allocator, populated_depth: u8, records: ?[]const u8) ![][32]u8 {
        if (populated_depth > depth) return error.InvalidDepth;
        if (records) |bytes| {
            if (populated_depth < subtree_depth or populated_depth == depth) return error.InvalidDepth;
            if (bytes.len % state_record_size != 0) return error.InvalidStateRecords;
        }
        const top = try allocator.alloc([32]u8, 2 * subtree_count);
        @memset(top[subtree_count..], zeroSubtreeRoot());
        return top;
    }

    /// The tree over `top`, whose subtree roots are set. Owns `top` if it returns one.
    fn finish(allocator: Allocator, seed: *const Seed, populated_depth: u8, records: ?[]const u8, top: [][32]u8) !VrfTree {
        hashLayers(top);
        if (records) |bytes| try graft(top, populated_depth, bytes);

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

/// How many subtrees hold one of the first `2^populated_depth` leaves.
/// `populated_depth` is at most `depth`.
pub fn populatedSubtrees(populated_depth: u8) u32 {
    std.debug.assert(populated_depth <= depth);
    const populated = @as(u64, 1) << @intCast(populated_depth);
    return @intCast((populated - 1) / subtree_leaves + 1);
}

/// Fills the inner nodes of a binary heap from its leaves, the second half of `nodes`.
fn hashLayers(nodes: [][32]u8) void {
    var node = nodes.len / 2;
    while (node > 1) {
        node -= 1;
        Keccak256.hash(std.mem.asBytes(nodes[2 * node ..][0..2]), &nodes[node], .{});
    }
}

/// The record among `records` whose tree has the second leaf of `seed`'s, which a
/// record holds as its first sibling. `VrfTree.init` checks the rest of it.
pub fn findState(seed: *const Seed, records: []const u8) ?*const [state_record_size]u8 {
    var preimage: [@sizeOf(Seed) + 8]u8 = undefined;
    defer std.crypto.secureZero(u8, &preimage);
    preimage[0..@sizeOf(Seed)].* = seed.*;
    std.mem.writeInt(u64, preimage[@sizeOf(Seed)..], 1, .little);
    var second_leaf: [32]u8 = undefined;
    Keccak256.hash(&preimage, &second_leaf, .{});

    var offset: usize = 0;
    while (offset + state_record_size <= records.len) : (offset += state_record_size) {
        const record = records[offset..][0..state_record_size];
        if (std.mem.eql(u8, record[36..68], &second_leaf)) return record;
    }
    return null;
}

/// Replaces what `top` holds above the populated leaves, which it took for
/// zero, by the siblings of the record in `records` that those leaves belong to.
fn graft(top: [][32]u8, populated_depth: u8, records: []const u8) !void {
    // The node over the populated leaves, and its ancestors, are the leftmost of their layers
    const populated_root = top[@as(usize, 1) << @intCast(depth - populated_depth)];
    var offset: usize = 0;
    while (offset < records.len) : (offset += state_record_size) {
        const record = records[offset..][0..state_record_size];
        if (!std.mem.allEqual(u8, record[32..36], 0)) continue;
        const siblings: *const [depth][32]u8 = @ptrCast(record[36..]);
        var value = populated_root;
        for (siblings[populated_depth..]) |*sibling| Keccak256.hash(&(value ++ sibling.*), &value, .{});
        if (!std.mem.eql(u8, &value, record[0..32])) continue;

        for (siblings[populated_depth..], populated_depth..) |*sibling, height| {
            const node = @as(usize, 1) << @intCast(depth - height);
            top[node + 1] = sibling.*;
            Keccak256.hash(std.mem.asBytes(top[node..][0..2]), &top[node / 2], .{});
        }
        return;
    }
    return error.NoMatchingState;
}

/// The root of a subtree whose leaves are all zero.
fn zeroSubtreeRoot() [32]u8 {
    var value: [32]u8 = @splat(0);
    for (0..subtree_depth) |_| Keccak256.hash(&(value ++ value), &value, .{});
    return value;
}

/// Checks that `proof` opens the leaf of `slot` under `root`.
pub fn isValidProof(root: *const Root, slot: u64, proof: *const Proof) bool {
    var value = proof[0];
    for (proof[1..], 0..) |*sibling, height| {
        const pair = if ((slot >> @intCast(height)) & 1 == 1) sibling.* ++ value else value ++ sibling.*;
        Keccak256.hash(&pair, &value, .{});
    }
    return std.mem.eql(u8, &value, root);
}

test {
    _ = @import("root_test.zig");
}
