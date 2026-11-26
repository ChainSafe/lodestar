//! NAPI bindings for a PQ validator's VRF tree.
//!
//! Building a tree runs on the libuv pool and fans out over threads of its own.
const std = @import("std");
const zapi = @import("zapi:zapi");
const js = zapi.js;
const napi = zapi.napi;
const AddonIdentity = @import("zapi_addon_identity");
const vrf_tree = @import("vrf_tree");

pub const SEED_SIZE: u32 = @sizeOf(vrf_tree.Seed);
pub const DEPTH: u32 = vrf_tree.depth;
pub const PROOF_SIZE: u32 = @sizeOf(vrf_tree.Proof);
pub const STATE_RECORD_SIZE: u32 = vrf_tree.state_record_size;

// A tree outlives the task that builds it, on another thread than the JS one.
const allocator = std.heap.c_allocator;

const BuildTask = struct {
    seed: vrf_tree.Seed,
    populated_depth: u8,
    /// The tree's own record, copied: the task outlives the call.
    state: ?[vrf_tree.state_record_size]u8 = null,
    /// Threads to hash on. Zero is one per CPU.
    threads: u32 = 0,
    /// The tree's subtree roots, to load in place of hashing its leaves. Owned.
    subtree_roots: ?[]const [32]u8 = null,
    tree: ?vrf_tree.VrfTree = null,

    pub fn compute(self: *BuildTask) !void {
        const state: ?[]const u8 = if (self.state) |*state| state else null;
        if (self.subtree_roots) |roots| {
            self.tree = try vrf_tree.VrfTree.initFromSubtreeRoots(allocator, &self.seed, self.populated_depth, state, roots);
            return;
        }
        const threads = if (self.threads != 0) self.threads else std.Thread.getCpuCount() catch 1;
        self.tree = try vrf_tree.VrfTree.init(allocator, &self.seed, self.populated_depth, state, threads);
    }

    pub fn resolve(self: *BuildTask, env: napi.Env) !napi.Value {
        const tree = self.tree.?;
        self.tree = null;
        // The instance owns `tree` from here, a failed materialization included.
        const instance = js.convertReturn(VrfTree, AddonIdentity, .{ .tree = tree }, env.env);
        if (instance == null) return error.MaterializeFailed;
        return .{ .env = env.env, .value = instance };
    }

    pub fn deinit(self: *BuildTask) void {
        std.crypto.secureZero(u8, &self.seed);
        if (self.subtree_roots) |roots| js.allocator().free(roots);
        if (self.tree) |*tree| tree.deinit();
    }

    /// Makes `task` that for the tree of `seed`, with its own record among `records` if
    /// not empty. In place, so that the caller's is the only copy of the seed to wipe.
    fn init(task: *BuildTask, seed: js.Uint8Array, populated_depth: js.Number, records: js.Uint8Array) !void {
        const slice = try seed.toSlice();
        if (slice.len != SEED_SIZE) return error.InvalidSeedLength;
        const depth = try populated_depth.toU32Exact();
        if (depth > vrf_tree.depth) return error.InvalidDepth;
        const records_slice = try records.toSlice();
        var state: ?[vrf_tree.state_record_size]u8 = null;
        if (records_slice.len != 0) {
            if (records_slice.len % vrf_tree.state_record_size != 0) return error.InvalidStateRecords;
            state = (vrf_tree.findState(slice[0..SEED_SIZE], records_slice) orelse return error.NoMatchingState).*;
        }
        task.* = .{ .seed = slice[0..SEED_SIZE].*, .populated_depth = @intCast(depth), .state = state };
    }
};

/// JS: vrfTree.isValidProof(root, slot, proof) → boolean
pub fn isValidProof(root: js.Uint8Array, slot: js.Number, proof: js.Uint8Array) !js.Boolean {
    const root_slice = try root.toSlice();
    const proof_slice = try proof.toSlice();
    if (root_slice.len != @sizeOf(vrf_tree.Root) or proof_slice.len != PROOF_SIZE) return js.Boolean.from(false);
    var decoded: vrf_tree.Proof = undefined;
    @memcpy(std.mem.asBytes(&decoded), proof_slice);
    return js.Boolean.from(vrf_tree.isValidProof(root_slice[0..@sizeOf(vrf_tree.Root)], try slot.toU64Exact(), &decoded));
}

/// A VRF tree. Instances come from `build`: one built with `new` holds no tree
/// and every method throws `TreeNotLoaded`.
pub const VrfTree = struct {
    pub const js_meta = js.class(.{});

    tree: ?vrf_tree.VrfTree = null,

    pub fn init() VrfTree {
        return .{};
    }

    pub fn deinit(self: *VrfTree) void {
        if (self.tree) |*tree| tree.deinit();
        self.tree = null;
    }

    /// Resolves with the tree of `seed`, which is all of its secret material.
    /// Slots from `2^populated_depth` on get no proof. `records`, if not empty,
    /// holds the precomputed states among which the tree finds its own. It
    /// hashes on `threads` threads, one per CPU if zero.
    pub fn build(seed: js.Uint8Array, populated_depth: js.Number, records: js.Uint8Array, threads: js.Number) !js.Value {
        var task: BuildTask = undefined;
        try task.init(seed, populated_depth, records);
        // Wipes this copy of the seed: the spawned task holds its own.
        defer std.crypto.secureZero(u8, &task.seed);
        task.threads = try threads.toU32Exact();
        return js.spawn(BuildTask, task, "vrfTree.VrfTree.build");
    }

    /// Resolves with the tree of `seed` from `subtree_roots`, what `subtreeRoots`
    /// gave for a tree built with the same arguments, without building a subtree.
    /// The roots are not checked against the seed: the caller vouches for them.
    pub fn fromSubtreeRoots(seed: js.Uint8Array, populated_depth: js.Number, subtree_roots: js.Uint8Array, records: js.Uint8Array) !js.Value {
        var task: BuildTask = undefined;
        try task.init(seed, populated_depth, records);
        // Wipes this copy of the seed: the spawned task holds its own.
        defer std.crypto.secureZero(u8, &task.seed);
        const bytes = try subtree_roots.toSlice();
        const count = vrf_tree.populatedSubtrees(task.populated_depth);
        if (bytes.len != @as(usize, count) * 32) return error.InvalidSubtreeRoots;
        const roots = try js.allocator().alloc([32]u8, count);
        errdefer js.allocator().free(roots);
        @memcpy(std.mem.sliceAsBytes(roots), bytes);
        task.subtree_roots = roots;
        return js.spawn(BuildTask, task, "vrfTree.VrfTree.fromSubtreeRoots");
    }

    /// The roots of the subtrees with a populated leaf, 32 bytes each. No secret.
    pub fn subtreeRoots(self: *const VrfTree) !js.OwnedUint8Array {
        const tree = &(self.tree orelse return error.TreeNotLoaded);
        return .fromSlice(js.allocator(), std.mem.sliceAsBytes(tree.subtreeRoots()));
    }

    pub fn root(self: *const VrfTree) !js.Uint8Array {
        const tree = &(self.tree orelse return error.TreeNotLoaded);
        return js.Uint8Array.from(&tree.root());
    }

    /// The leaf of `slot` then its Merkle branch, `PROOF_SIZE` bytes.
    pub fn proof(self: *VrfTree, slot: js.Number) !js.Uint8Array {
        const tree = &(self.tree orelse return error.TreeNotLoaded);
        const out = try tree.proof(try slot.toU64Exact());
        return js.Uint8Array.from(std.mem.asBytes(&out));
    }
};
