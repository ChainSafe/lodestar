const std = @import("std");
const Allocator = std.mem.Allocator;
const ssz = @import("consensus_types");
const preset = @import("preset").preset;
const c = @import("constants");
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const EpochShufflingRc = @import("../utils/epoch_shuffling.zig").EpochShufflingRc;
const computeEpochShufflingForFork = @import("../utils/epoch_shuffling.zig").computeEpochShufflingForFork;
const upgradeStateToFulu = @import("../slot/upgrade_state_to_fulu.zig").upgradeStateToFulu;
const ValidatorIndex = ssz.primitive.ValidatorIndex.Type;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const seed_utils = @import("../utils/seed.zig");
const getSeed = seed_utils.getSeed;
const computeProposers = seed_utils.computeProposers;
const Node = @import("persistent_merkle_tree").Node;
const FLAG_UNSLASHED = @import("../utils/attester_status.zig").FLAG_UNSLASHED;

/// Updates `proposer_lookahead` during epoch processing.
/// Shifts out the oldest epoch and appends the new epoch at the end.
/// Uses active indices from the epoch transition cache for the new epoch.
pub fn startProposerLookaheadShuffling(
    comptime fork: ForkSeq,
    io: std.Io,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    epoch_transition_cache: *EpochTransitionCache,
) !void {
    const current_epoch = computeEpochAtSlot(try state.slot());
    const new_epoch = current_epoch + preset.MIN_SEED_LOOKAHEAD + 1;
    var seed: [32]u8 = undefined;
    try getSeed(fork, state, new_epoch, c.DOMAIN_BEACON_ATTESTER, &seed);
    try epoch_transition_cache.startShuffling(epoch_cache.allocator, io, seed, new_epoch);
}

pub fn processProposerLookahead(
    comptime fork: ForkSeq,
    allocator: Allocator,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    epoch_transition_cache: *EpochTransitionCache,
) !void {
    var proposer_lookahead: [ssz.fulu.ProposerLookahead.length]u64 = undefined;
    try state.proposerLookaheadInto(&proposer_lookahead);

    const lookahead_epochs = preset.MIN_SEED_LOOKAHEAD + 1;
    const last_epoch_start = (lookahead_epochs - 1) * preset.SLOTS_PER_EPOCH;

    // Shift out proposers in the first epoch
    std.mem.copyForwards(
        ValidatorIndex,
        proposer_lookahead[0..last_epoch_start],
        proposer_lookahead[preset.SLOTS_PER_EPOCH..],
    );

    // Fill in the last epoch with new proposer indices
    // The new epoch is current_epoch + MIN_SEED_LOOKAHEAD + 1 = current_epoch + 2
    const current_epoch = computeEpochAtSlot(try state.slot());
    const new_epoch = current_epoch + preset.MIN_SEED_LOOKAHEAD + 1;

    // Active indices for the new epoch come from the epoch transition cache
    // (computed during beforeProcessEpoch for current_epoch + 2)
    const active_indices = epoch_transition_cache.next_shuffling_active_indices;
    const effective_balance_increments = epoch_cache.getEffectiveBalanceIncrements();

    const next_shuffling = blk: {
        if (epoch_transition_cache.shuffling_job != null) {
            break :blk try epoch_transition_cache.joinShuffling();
        }
        const shuffling_active_indices = try epoch_cache.allocator.alloc(ValidatorIndex, active_indices.len);
        errdefer epoch_cache.allocator.free(shuffling_active_indices);
        std.mem.copyForwards(ValidatorIndex, shuffling_active_indices, active_indices);
        break :blk try computeEpochShufflingForFork(
            fork,
            epoch_cache.allocator,
            state,
            shuffling_active_indices,
            new_epoch,
        );
    };
    const next_shuffling_rc = blk: {
        errdefer next_shuffling.deinit();
        break :blk try EpochShufflingRc.create(epoch_cache.allocator, next_shuffling);
    };
    errdefer next_shuffling_rc.unref();

    var seed: [32]u8 = undefined;
    try getSeed(fork, state, new_epoch, c.DOMAIN_BEACON_PROPOSER, &seed);

    var eligible_proposers: std.ArrayList(ValidatorIndex) = .empty;
    defer eligible_proposers.deinit(allocator);
    if (comptime fork.gte(.gloas)) {
        try eligible_proposers.ensureTotalCapacity(allocator, next_shuffling_rc.get().active_indices.len);
        for (next_shuffling_rc.get().active_indices) |index| {
            if (epoch_transition_cache.flags[index] & FLAG_UNSLASHED != 0) eligible_proposers.appendAssumeCapacity(index);
        }
    }

    try computeProposers(
        fork,
        allocator,
        seed,
        new_epoch,
        if (comptime fork.gte(.gloas)) eligible_proposers.items else next_shuffling_rc.get().active_indices,
        effective_balance_increments,
        proposer_lookahead[last_epoch_start..],
    );

    try state.setProposerLookahead(&proposer_lookahead);
    epoch_transition_cache.next_shuffling = next_shuffling_rc;
}

const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;

test "memory_safety: proposer lookahead shuffling belongs to the epoch cache allocator" {
    const allocator = std.testing.allocator;
    inline for (.{ true, false }) |start_async| {
        const pool_size = 375_000;
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
        defer pool.deinit();

        var test_state = try TestCachedBeaconState.init(allocator, &pool, 10_000);
        defer test_state.deinit();

        const fulu_state = try upgradeStateToFulu(
            allocator,
            test_state.cached_state.config,
            test_state.cached_state.epoch_cache,
            try test_state.cached_state.state.tryCastToFork(.electra),
        );
        test_state.cached_state.state.* = .{ .fulu = fulu_state.inner };

        const current_epoch = computeEpochAtSlot(try test_state.cached_state.state.slot());
        const new_epoch = current_epoch + preset.MIN_SEED_LOOKAHEAD + 1;
        const fulu = test_state.cached_state.state.castToFork(.fulu);
        const expected_shuffling = blk: {
            const expected_indices = try allocator.dupe(ValidatorIndex, test_state.epoch_transition_cache.next_shuffling_active_indices);
            errdefer allocator.free(expected_indices);
            break :blk try computeEpochShufflingForFork(.fulu, allocator, fulu, expected_indices, new_epoch);
        };
        defer expected_shuffling.deinit();

        if (start_async) {
            try startProposerLookaheadShuffling(
                .fulu,
                std.testing.io,
                test_state.cached_state.epoch_cache,
                fulu,
                test_state.epoch_transition_cache,
            );
        }

        var caller_allocator_state = std.testing.FailingAllocator.init(allocator, .{});

        try processProposerLookahead(
            .fulu,
            caller_allocator_state.allocator(),
            test_state.cached_state.epoch_cache,
            test_state.cached_state.state.castToFork(.fulu),
            test_state.epoch_transition_cache,
        );

        const next_shuffling = test_state.epoch_transition_cache.next_shuffling.?;
        try std.testing.expectEqual(caller_allocator_state.allocated_bytes, caller_allocator_state.freed_bytes);
        try std.testing.expectEqual(allocator.ptr, next_shuffling.allocator.ptr);

        const actual_shuffling = next_shuffling.get();
        try std.testing.expectEqual(allocator.ptr, actual_shuffling.allocator.ptr);
        try std.testing.expectEqualSlices(ValidatorIndex, expected_shuffling.active_indices, actual_shuffling.active_indices);
        try std.testing.expectEqualSlices(ValidatorIndex, expected_shuffling.shuffling, actual_shuffling.shuffling);
    }
}
