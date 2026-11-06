//! Shared setup for the fork choice benchmarks: a `Store` with a linear chain, every
//! validator at 32 ETH, mirroring `packages/fork-choice/test/perf/forkChoice/util.ts`.

const std = @import("std");
const Allocator = std.mem.Allocator;
const fork_choice = @import("fork_choice");
const Store = fork_choice.Store;
const Checkpoint = fork_choice.Checkpoint;
const config_mod = @import("config");
const BeaconConfig = config_mod.BeaconConfig;
const ZERO_HASH = @import("constants").ZERO_HASH;
const preset = @import("preset").preset;

pub const Opts = struct {
    initial_block_count: u32 = 64,
    initial_validator_count: u32 = 600_000,
    initial_equivocated_count: u32 = 0,
    /// Build a Gloas chain and boost the tip so `getHead` takes `should_apply_proposer_boost`.
    gloas_boosted: bool = false,
};

const gloas_chain_config = config_mod.mainnet.chain_config.merge(.{
    .ALTAIR_FORK_EPOCH = 0,
    .BELLATRIX_FORK_EPOCH = 0,
    .CAPELLA_FORK_EPOCH = 0,
    .DENEB_FORK_EPOCH = 0,
    .ELECTRA_FORK_EPOCH = 0,
    .FULU_FORK_EPOCH = 0,
    .GLOAS_FORK_EPOCH = 0,
});
pub const gloas_config = BeaconConfig.init(gloas_chain_config, config_mod.mainnet.genesis_validators_root);

const Provider = struct {
    validator_count: u32,

    fn justifiedBalances(ctx: *anyopaque, allocator: Allocator, _: Checkpoint) anyerror!fork_choice.JustifiedBalances {
        const self: *Provider = @ptrCast(@alignCast(ctx));
        const increments = try allocator.alloc(u16, self.validator_count);
        errdefer allocator.free(increments);
        @memset(increments, 32);
        var active = try std.DynamicBitSetUnmanaged.initFull(allocator, self.validator_count);
        errdefer active.deinit(allocator);
        return .{ .effective_balance_increments = increments, .active_unslashed = active };
    }

    fn slotCommitteeMembers(_: *anyopaque, _: Allocator, _: fork_choice.store.Root, _: u64, _: *std.ArrayList(u64)) anyerror!void {}

    const vtable: fork_choice.StateProvider.VTable = .{
        .justifiedBalances = justifiedBalances,
        .slotCommitteeMembers = slotCommitteeMembers,
    };
};

/// zbench copies benchmark structs by value, so the store lives behind a pointer.
pub const Bench = struct {
    store: *Store,
    provider: *Provider,

    pub fn deinit(self: *Bench, allocator: Allocator) void {
        self.store.deinit();
        allocator.destroy(self.store);
        allocator.destroy(self.provider);
    }
};

/// Never the zero root, which the store reserves for "no proposer boost".
pub fn rootFromSlot(slot: u64) [32]u8 {
    var root: [32]u8 = ZERO_HASH;
    root[31] = 1;
    std.mem.writeInt(u64, root[0..8], slot, .little);
    return root;
}

/// Checkpoint at the first block of `epoch` (the anchor for epoch 0).
fn epochCheckpoint(epoch: u64) Checkpoint {
    return .{ .epoch = epoch, .root = rootFromSlot(epoch * preset.SLOTS_PER_EPOCH) };
}

fn payloadHash(slot: u64) [32]u8 {
    var hash: [32]u8 = ZERO_HASH;
    hash[0] = 0xaa;
    std.mem.writeInt(u64, hash[8..16], slot, .little);
    return hash;
}

/// A store with blocks at slots `0 .. initial_block_count - 1`, the clock at
/// `initial_block_count`, and the first `initial_equivocated_count` validators equivocating.
pub fn initStore(allocator: Allocator, opts: Opts) !Bench {
    const provider = try allocator.create(Provider);
    errdefer allocator.destroy(provider);
    provider.* = .{ .validator_count = opts.initial_validator_count };
    const state_provider: fork_choice.StateProvider = .{ .ctx = provider, .vtable = &Provider.vtable };

    const config = if (opts.gloas_boosted) &gloas_config else &config_mod.mainnet.config;
    const fork: config_mod.ForkSeq = if (opts.gloas_boosted) .gloas else .electra;
    const anchor_root = rootFromSlot(0);
    const genesis: Checkpoint = .{ .epoch = 0, .root = anchor_root };
    const store = try allocator.create(Store);
    errdefer allocator.destroy(store);
    store.* = try Store.initFromSummary(allocator, config, 0, .{
        .root = anchor_root,
        .parent_root = ZERO_HASH,
        .slot = 0,
        .proposer_index = 0,
        .state_root = ZERO_HASH,
        .fork = fork,
        .justified_checkpoint = genesis,
        .finalized_checkpoint = genesis,
        .unrealized_justified_checkpoint = genesis,
        .unrealized_finalized_checkpoint = genesis,
        .payload_block_hash = if (opts.gloas_boosted) payloadHash(0) else ZERO_HASH,
        .execution_status = if (opts.gloas_boosted) .syncing else .pre_merge,
    }, state_provider);
    errdefer store.deinit();

    try store.onTick(store.timing.timeAtSlotMs(opts.initial_block_count));
    // Every Gloas block builds on its parent's payload, so each payload must be verified first.
    if (opts.gloas_boosted) try store.onExecutionPayloadEnvelope(anchor_root, .valid, null);

    // A chain that justifies every epoch: a block in epoch E has realized checkpoints
    // (E-1, E-2) and unrealized (E, E-1), so the store's checkpoints follow the tip and
    // the whole chain stays viable however far the clock has advanced.
    var parent_root = anchor_root;
    for (1..opts.initial_block_count) |slot| {
        const root = rootFromSlot(slot);
        const epoch = slot / preset.SLOTS_PER_EPOCH;
        const justified = epochCheckpoint(epoch -| 1);
        try store.onBlockSummary(.{
            .root = root,
            .parent_root = parent_root,
            .slot = slot,
            .proposer_index = 0,
            .state_root = root,
            .fork = fork,
            .justified_checkpoint = justified,
            .finalized_checkpoint = epochCheckpoint(epoch -| 2),
            .unrealized_justified_checkpoint = epochCheckpoint(epoch),
            .unrealized_finalized_checkpoint = justified,
            .payload_block_hash = if (opts.gloas_boosted) payloadHash(slot) else ZERO_HASH,
            .execution_status = if (opts.gloas_boosted) .syncing else .pre_merge,
            // Each block builds on the parent's payload, so Gloas chains link FULL variants.
            .bid_parent_block_hash = if (opts.gloas_boosted) payloadHash(slot - 1) else ZERO_HASH,
        });
        if (opts.gloas_boosted) try store.onExecutionPayloadEnvelope(root, .valid, null);
        parent_root = root;
    }

    if (opts.gloas_boosted) store.proposer_boost_root = parent_root;

    if (opts.initial_equivocated_count > 0) {
        try store.equivocating_indices.resize(allocator, opts.initial_equivocated_count, true);
    }

    return .{ .store = store, .provider = provider };
}
