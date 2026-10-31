//! Shared utilities for fork-choice benchmarks.
//!
//! Provides `initializeForkChoice` which builds a `ForkChoice` with a linear
//! chain of `initial_block_count` blocks, suitable for benchmarking head
//! updates, attestation processing, and related operations.

const std = @import("std");
const Allocator = std.mem.Allocator;

const fork_choice = @import("fork_choice");
const ForkChoice = fork_choice.ForkChoice;
const ProtoArray = fork_choice.ProtoArray;
const ProtoBlock = fork_choice.ProtoBlock;
const ForkChoiceStore = fork_choice.ForkChoiceStore;
const Checkpoint = fork_choice.Checkpoint;
const JustifiedBalances = fork_choice.JustifiedBalances;
const JustifiedBalancesGetter = fork_choice.JustifiedBalancesGetter;
const onBlockFromProto = fork_choice.onBlockFromProto;

const state_transition = @import("state_transition");
const CachedBeaconState = state_transition.CachedBeaconState;

const config = @import("config");
const constants = @import("constants");
const ZERO_HASH = constants.ZERO_HASH;

/// Options for initializing a benchmark ForkChoice instance.
pub const Opts = struct {
    /// Number of blocks in the linear chain (including genesis).
    initial_block_count: u32 = 64,
    /// Number of validators (all with effective balance = 32 ETH).
    initial_validator_count: u32 = 600_000,
    /// Number of equivocating validator indices to mark.
    initial_equivocated_count: u32 = 0,
};

/// Dummy justified-balances getter that returns an empty list.
///
/// Benchmarks never trigger a justified checkpoint change that would
/// call through to the getter, so returning an empty list is safe.
/// Uses page_allocator as a safe fallback allocator.
fn dummyBalancesGetter(_: ?*anyopaque, _: Checkpoint, _: *CachedBeaconState) JustifiedBalances {
    return .empty;
}

const dummy_getter: JustifiedBalancesGetter = .{ .getFn = &dummyBalancesGetter };

/// Build a root from a slot number: first 4 bytes = slot (little-endian), rest = 0.
fn rootFromSlot(slot: u32) [32]u8 {
    var root: [32]u8 = ZERO_HASH;
    std.mem.writeInt(u32, root[0..4], slot, .little);
    return root;
}

/// Construct a minimal `ProtoBlock` for benchmarking.
fn makeBlock(slot: u64, root: [32]u8, parent_root: [32]u8) ProtoBlock {
    return .{
        .slot = slot,
        .block_root = root,
        .parent_root = parent_root,
        .state_root = ZERO_HASH,
        .target_root = root,
        .justified_epoch = 0,
        .justified_root = ZERO_HASH,
        .finalized_epoch = 0,
        .finalized_root = ZERO_HASH,
        .unrealized_justified_epoch = 0,
        .unrealized_justified_root = ZERO_HASH,
        .unrealized_finalized_epoch = 0,
        .unrealized_finalized_root = ZERO_HASH,
        .extra_meta = .{ .pre_merge = {} },
        .timeliness = true,
    };
}

/// Build a ForkChoice with a linear chain for benchmarking.
///
/// Allocates a ProtoArray, ForkChoiceStore, and ForkChoice on the heap.
/// The returned pointer must be freed via `deinitForkChoice`.
pub fn initializeForkChoice(allocator: Allocator, opts: Opts) !*ForkChoice {
    // -- Balances: every validator has effective balance = 32 ETH (increment = 32) --
    const balances = try allocator.alloc(u16, opts.initial_validator_count);
    defer allocator.free(balances);
    @memset(balances, 32);

    // -- Genesis checkpoint (epoch 0, ZERO_HASH root) --
    const genesis_cp: Checkpoint = .{
        .epoch = 0,
        .root = ZERO_HASH,
    };

    // -- Genesis block at slot 0 --
    const genesis_block = makeBlock(0, ZERO_HASH, ZERO_HASH);

    // -- ProtoArray from genesis --
    const pa = try allocator.create(ProtoArray);
    errdefer allocator.destroy(pa);
    try pa.initialize(allocator, genesis_block, 0);
    errdefer pa.deinit(allocator);

    // -- ForkChoiceStore --
    const fc_store = try allocator.create(ForkChoiceStore);
    errdefer allocator.destroy(fc_store);
    try fc_store.init(
        allocator,
        0,
        genesis_cp,
        genesis_cp,
        balances,
        dummy_getter,
        .{},
    );
    errdefer fc_store.deinit(allocator);

    // -- ForkChoice (in-place init) --
    const fc = try allocator.create(ForkChoice);
    errdefer allocator.destroy(fc);
    try fc.init(
        allocator,
        &config.mainnet.config,
        fc_store,
        pa,
        opts.initial_validator_count,
        .{},
    );
    errdefer fc.deinit(allocator);

    // -- Build a linear chain of blocks (slots 1 .. initial_block_count-1) --
    const current_slot: u64 = @intCast(opts.initial_block_count);
    var prev_root: [32]u8 = ZERO_HASH; // genesis root

    for (1..opts.initial_block_count) |slot| {
        const block_root = rootFromSlot(@intCast(slot));
        const block = makeBlock(@intCast(slot), block_root, prev_root);
        try onBlockFromProto(fc, allocator, block, current_slot);
        prev_root = block_root;
    }

    // -- Mark equivocating validators --
    for (0..opts.initial_equivocated_count) |i| {
        try fc.fc_store.equivocating_indices.put(allocator, @intCast(i), {});
    }

    return fc;
}

/// Release all resources allocated by `initializeForkChoice`.
pub fn deinitForkChoice(allocator: Allocator, fc: *ForkChoice) void {
    // Save pointers before fc.deinit() sets self.* = undefined.
    const fc_store = fc.fc_store;
    const proto_arr = fc.proto_array;

    // ForkChoice.deinit releases votes, caches, queued attestations, and
    // the balances Rc reference held by ForkChoice itself.
    fc.deinit(allocator);

    // ForkChoiceStore.deinit releases equivocating_indices and both
    // justified/unrealized_justified balance Rc references.
    fc_store.deinit(allocator);
    allocator.destroy(fc_store);

    // ProtoArray.deinit releases nodes, indices, and ptc_votes.
    proto_arr.deinit(allocator);
    allocator.destroy(proto_arr);

    // Finally free the ForkChoice struct itself.
    allocator.destroy(fc);
}
