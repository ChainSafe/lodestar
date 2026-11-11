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

// A tree outlives the task that builds it, on another thread than the JS one.
const allocator = std.heap.c_allocator;

const BuildTask = struct {
    seed: vrf_tree.Seed,
    populated_depth: u8,
    tree: ?vrf_tree.VrfTree = null,

    pub fn compute(self: *BuildTask) !void {
        self.tree = try vrf_tree.VrfTree.init(allocator, &self.seed, self.populated_depth, std.Thread.getCpuCount() catch 1);
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
        if (self.tree) |*tree| tree.deinit();
    }
};

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
    /// Slots from `2^populated_depth` on get no secret.
    pub fn build(seed: js.Uint8Array, populated_depth: js.Number) !js.Value {
        const slice = try seed.toSlice();
        if (slice.len != SEED_SIZE) return error.InvalidSeedLength;
        const depth = try populated_depth.toU32Exact();
        if (depth > vrf_tree.depth) return error.InvalidDepth;
        var task: BuildTask = .{ .seed = slice[0..SEED_SIZE].*, .populated_depth = @intCast(depth) };
        // Wipes this copy of the seed: the spawned task holds its own.
        defer std.crypto.secureZero(u8, &task.seed);
        return js.spawn(BuildTask, task, "vrfTree.VrfTree.build");
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
