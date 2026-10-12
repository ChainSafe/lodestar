const std = @import("std");
const Diagnostics = @import("diagnostics").Diagnostics;
const Allocator = std.mem.Allocator;
const ForkSeq = @import("config").ForkSeq;
const metrics = @import("metrics.zig");
const observeEpochTransitionStep = metrics.observeEpochTransitionStep;
const observeEpochTransition = metrics.observeEpochTransition;
const time = @import("time");

const types = @import("consensus_types");
const preset = @import("preset").preset;

const Slot = types.primitive.Slot.Type;
const CachedBeaconState = @import("cache/state_cache.zig").CachedBeaconState;
const BeaconConfig = @import("config").BeaconConfig;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const AnySignedBeaconBlock = @import("fork_types").AnySignedBeaconBlock;
const EpochCache = @import("./cache/epoch_cache.zig").EpochCache;
const verifyProposerSignature = @import("./signature_sets/proposer.zig").verifyProposerSignature;
pub const processBlock = @import("./block/process_block.zig").processBlock;
const EpochTransitionCache = @import("cache/epoch_transition_cache.zig").EpochTransitionCache;
const processEpoch = @import("epoch/process_epoch.zig").processEpoch;
const computeEpochAtSlot = @import("utils/epoch.zig").computeEpochAtSlot;
const processSlot = @import("slot/process_slot.zig").processSlot;
const ValidatorMonitor = @import("ValidatorMonitor.zig");
pub const deinitReusedEpochTransitionCache = @import("cache/epoch_transition_cache.zig").deinitReusedEpochTransitionCache;
const upgradeStateToAltair = @import("slot/upgrade_state_to_altair.zig").upgradeStateToAltair;
const upgradeStateToBellatrix = @import("slot/upgrade_state_to_bellatrix.zig").upgradeStateToBellatrix;
const upgradeStateToCapella = @import("slot/upgrade_state_to_capella.zig").upgradeStateToCapella;
const upgradeStateToDeneb = @import("slot/upgrade_state_to_deneb.zig").upgradeStateToDeneb;
const upgradeStateToElectra = @import("slot/upgrade_state_to_electra.zig").upgradeStateToElectra;
const upgradeStateToFulu = @import("slot/upgrade_state_to_fulu.zig").upgradeStateToFulu;

pub const ExecutionPayloadStatus = enum(u8) {
    invalid,
    valid,
};

pub const DataAvailabilityStatus = enum(u8) {
    pre_data,
    out_of_range,
    available,
};

pub const ProcessBlockSource = metrics.ProcessBlockSource;

pub const BlockExternalData = struct {
    execution_payload_status: ExecutionPayloadStatus = .valid,
    data_availability_status: DataAvailabilityStatus = .available,
};

pub fn processSlots(
    allocator: std.mem.Allocator,
    io: std.Io,
    cached_state: *CachedBeaconState,
    slot: Slot,
    validator_monitor: ?*ValidatorMonitor,
) !void {
    const config = cached_state.config;
    const epoch_cache = cached_state.epoch_cache;
    const state = cached_state.state;

    if (try state.slot() > slot) return error.outdatedSlot;

    while (try state.slot() < slot) {
        try processSlot(cached_state.state);

        const next_slot = try state.slot() + 1;
        if (next_slot % preset.SLOTS_PER_EPOCH == 0) {
            const epoch_transition_timer = time.start(io);

            var timer = time.start(io);
            var epoch_transition_cache = try EpochTransitionCache.init(
                allocator,
                config,
                epoch_cache,
                state,
            );
            defer epoch_transition_cache.deinit();
            try observeEpochTransitionStep(.{ .step = .before_process_epoch }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));

            switch (state.forkSeq()) {
                inline else => |f| {
                    try processEpoch(
                        f,
                        allocator,
                        io,
                        config,
                        epoch_cache,
                        state.castToFork(f),
                        &epoch_transition_cache,
                    );
                },
            }
            if (validator_monitor) |monitor| {
                monitor.registerValidatorStatuses(
                    epoch_transition_cache.current_epoch,
                    epoch_transition_cache.flags,
                    if (epoch_transition_cache.balances) |balances| balances.items else null,
                );
            }

            try state.setSlot(next_slot);

            timer = time.start(io);
            try epoch_cache.afterProcessEpoch(state, &epoch_transition_cache);
            try observeEpochTransitionStep(.{ .step = .after_process_epoch }, @as(u64, @intCast(time.since(io, timer).nanoseconds)));
            // state.commit

            const state_epoch = computeEpochAtSlot(next_slot);

            if (state_epoch == config.chain.ALTAIR_FORK_EPOCH) {
                const phase0_state = try state.tryCastToFork(.phase0);
                const upgraded = try upgradeStateToAltair(allocator, config, epoch_cache, phase0_state);
                state.* = .{ .altair = upgraded.inner };
            }
            if (state_epoch == config.chain.BELLATRIX_FORK_EPOCH) {
                const altair_state = try state.tryCastToFork(.altair);
                const upgraded = try upgradeStateToBellatrix(config, epoch_cache, altair_state);
                state.* = .{ .bellatrix = upgraded.inner };
            }
            if (state_epoch == config.chain.CAPELLA_FORK_EPOCH) {
                const bellatrix_state = try state.tryCastToFork(.bellatrix);
                const upgraded = try upgradeStateToCapella(allocator, config, epoch_cache, bellatrix_state);
                state.* = .{ .capella = upgraded.inner };
            }
            if (state_epoch == config.chain.DENEB_FORK_EPOCH) {
                const capella_state = try state.tryCastToFork(.capella);
                const upgraded = try upgradeStateToDeneb(allocator, config, epoch_cache, capella_state);
                state.* = .{ .deneb = upgraded.inner };
            }
            if (state_epoch == config.chain.ELECTRA_FORK_EPOCH) {
                const deneb_state = try state.tryCastToFork(.deneb);
                const upgraded = try upgradeStateToElectra(allocator, config, epoch_cache, deneb_state);
                state.* = .{ .electra = upgraded.inner };
            }
            if (state_epoch == config.chain.FULU_FORK_EPOCH) {
                const electra_state = try state.tryCastToFork(.electra);
                const upgraded = try upgradeStateToFulu(allocator, config, epoch_cache, electra_state);
                state.* = .{ .fulu = upgraded.inner };
            }

            try epoch_cache.finalProcessEpoch(state);

            const commit_timer = time.start(io);
            try state.commit();
            metrics.state_transition.epoch_transition_commit.observe(time.durationSeconds(time.since(io, commit_timer)));
            metrics.state_transition.epoch_transition.observe(time.durationSeconds(time.since(io, epoch_transition_timer)));
        } else {
            try state.setSlot(next_slot);
        }
    }

    try state.commit();
}

pub const TransitionOpts = struct {
    diagnostics: ?*Diagnostics = null,
    verify_state_root: bool = true,
    verify_proposer: bool = true,
    /// NOTE: verifying BLS signatures is expensive - make sure to turn this off for tests.
    verify_signatures: bool = true,
    transfer_cache: bool = true,
    block_external_data: BlockExternalData = .{},
    source: ProcessBlockSource = .block,
};

pub const StateTransitionResult = struct {
    state: AnyBeaconState,
    epoch_cache: *EpochCache,

    pub fn deinit(self: *StateTransitionResult) void {
        self.state.deinit();
        self.epoch_cache.deinit();
    }
};

pub fn stateTransition(
    allocator: std.mem.Allocator,
    io: std.Io,
    cached_state: *CachedBeaconState,
    signed_block: AnySignedBeaconBlock,
    opts: TransitionOpts,
    validator_monitor: ?*ValidatorMonitor,
) !*CachedBeaconState {
    const block = signed_block.beaconBlock();
    const block_slot = block.slot();

    var post_cached_state = try cached_state.clone(
        allocator,
        .{ .transfer_cache = opts.transfer_cache },
    );
    errdefer {
        post_cached_state.deinit();
        allocator.destroy(post_cached_state);
    }

    metrics.state_transition.pre_state_cloned_count.observe(cached_state.cloned_count);

    try processSlots(
        allocator,
        io,
        post_cached_state,
        block_slot,
        validator_monitor,
    );

    const config = post_cached_state.config;
    const post_epoch_cache = post_cached_state.epoch_cache;
    const post_state = post_cached_state.state;

    // Verify proposer signature only
    if (opts.verify_proposer and !try verifyProposerSignature(
        allocator,
        io,
        config,
        post_epoch_cache,
        signed_block,
    )) {
        return error.InvalidBlockSignature;
    }

    if (block.forkSeq() != post_state.forkSeq()) {
        return error.InvalidBlockForkForState;
    }
    // Note: time only on success
    const process_block_timer = time.start(io);
    switch (post_state.forkSeq()) {
        inline else => |f| {
            switch (block.blockType()) {
                inline else => |bt| {
                    if (comptime (bt == .blinded and f.lt(.bellatrix)) or (bt == .blinded and f.gte(.gloas))) {
                        return error.InvalidBlockTypeForFork;
                    } else {
                        var block_diagnostics: Diagnostics = .{};
                        const diagnostics = opts.diagnostics orelse &block_diagnostics;
                        processBlock(
                            f,
                            allocator,
                            io,
                            config,
                            post_epoch_cache,
                            post_state.castToFork(f),
                            &post_cached_state.proposer_rewards,
                            &post_cached_state.slashings_cache,
                            bt,
                            block.castToFork(bt, f),
                            opts.block_external_data,
                            .{ .verify_signature = opts.verify_signatures, .diagnostics = diagnostics },
                        ) catch |err| {
                            if (diagnostics.detail) |*detail| {
                                std.log.warn("Block processing failed at slot {d}: {f}", .{ block_slot, detail });
                            }
                            return err;
                        };
                    }
                },
            }
        },
    }
    const commit_timer = time.start(io);
    try post_state.commit();
    metrics.state_transition.process_block_commit.observe(time.durationSeconds(time.since(io, commit_timer)));
    try metrics.state_transition.process_block.observe(
        .{ .source = opts.source },
        time.durationSeconds(time.since(io, process_block_timer)),
    );

    const proposer_rewards = post_cached_state.proposer_rewards;
    try metrics.state_transition.proposer_rewards.set(.{ .type = .attestation }, proposer_rewards.attestations);
    try metrics.state_transition.proposer_rewards.set(.{ .type = .sync_aggregate }, proposer_rewards.sync_aggregate);
    try metrics.state_transition.proposer_rewards.set(.{ .type = .slashing }, proposer_rewards.slashing);

    // Verify state root
    if (opts.verify_state_root) {
        const timer = time.start(io);
        const post_state_root = try post_state.hashTreeRoot();
        try metrics.state_transition.state_hash_tree_root.observe(.{ .source = .state_transition }, time.durationSeconds(time.since(io, timer)));

        const block_state_root = block.stateRoot();
        if (!std.mem.eql(u8, post_state_root, block_state_root)) {
            return error.InvalidStateRoot;
        }
    }

    return post_cached_state;
}

test {
    _ = @import("state_transition_test.zig");
}
