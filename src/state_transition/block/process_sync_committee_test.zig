//! Tests for `process_sync_committee.zig`.

const std = @import("std");
const types = @import("consensus_types");
const preset = @import("preset").preset;
const Root = types.primitive.Root.Type;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const c = @import("constants");
const bls = @import("bls");
const Node = @import("persistent_merkle_tree").Node;
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const getBeaconProposer = @import("../cache/get_beacon_proposer.zig").getBeaconProposer;
const getBlockRootAtSlot = @import("../utils/block_root.zig").getBlockRootAtSlot;
const processSyncAggregate = @import("process_sync_committee.zig").processSyncAggregate;
const getSyncCommitteeSignatureSet = @import("process_sync_committee.zig").getSyncCommitteeSignatureSet;

const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const test_utils = @import("../test_utils/root.zig");

test "process sync aggregate - sanity" {
    const allocator = std.testing.allocator;
    const pool_size = 180_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    const state = test_state.cached_state.state;
    const config = test_state.cached_state.config;
    const epoch_cache = test_state.cached_state.epoch_cache;
    const fork_state = state.castToFork(.electra);
    const previous_slot = try state.slot() - 1;
    const root_signed = try getBlockRootAtSlot(.electra, fork_state, previous_slot);
    const domain = try config.getDomain(epoch_cache.epoch, c.DOMAIN_SYNC_COMMITTEE, previous_slot);
    var signing_root: Root = undefined;
    try computeSigningRoot(types.primitive.Root, root_signed, domain, &signing_root);

    const committee_indices = @as(*const [preset.SYNC_COMMITTEE_SIZE]ValidatorIndex, @ptrCast(try epoch_cache.current_sync_committee_indexed.get().getValidatorIndices()));
    // validator 0 signs
    const sig0 = try test_utils.interopSign(committee_indices[0], &signing_root);
    // validator 1 signs
    const sig1 = try test_utils.interopSign(committee_indices[1], &signing_root);
    const agg_sig = try bls.AggregateSignature.aggregate(&.{ sig0, sig1 }, true);

    var sync_aggregate: types.electra.SyncAggregate.Type = types.electra.SyncAggregate.default_value;
    sync_aggregate.sync_committee_signature = agg_sig.toSignature().compress();
    try sync_aggregate.sync_committee_bits.set(0, true);
    // don't set bit 1 yet

    const res = processSyncAggregate(
        .electra,
        std.testing.io,
        config,
        epoch_cache,
        fork_state,
        &test_state.cached_state.proposer_rewards,
        &sync_aggregate,
        true,
    );
    try std.testing.expect(res == error.SyncCommitteeSignatureInvalid);

    // now set bit 1
    try sync_aggregate.sync_committee_bits.set(1, true);
    try processSyncAggregate(
        .electra,
        std.testing.io,
        config,
        epoch_cache,
        fork_state,
        &test_state.cached_state.proposer_rewards,
        &sync_aggregate,
        true,
    );

    const signature_set = (try getSyncCommitteeSignatureSet(
        allocator,
        std.testing.io,
        config,
        epoch_cache,
        &sync_aggregate,
        try state.slot(),
        root_signed,
        null,
    )).?;
    defer allocator.free(signature_set.pubkeys);
}

test "process sync aggregate - proposer penalty floors at zero" {
    const allocator = std.testing.allocator;

    const Case = struct { name: []const u8, start_balance_factor: u64, participate: bool };
    const cases = [_]Case{
        .{ .name = "balance below the penalty", .start_balance_factor = 0, .participate = false },
        .{ .name = "balance equal to the penalty", .start_balance_factor = 1, .participate = false },
        .{ .name = "balance above the penalty", .start_balance_factor = 8, .participate = false },
        .{ .name = "mixed participation", .start_balance_factor = 0, .participate = true },
    };

    var penalty_path_exercised = false;

    for (cases) |case| {
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
        defer pool.deinit();

        var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
        defer test_state.deinit();

        const state = test_state.cached_state.state;
        const config = test_state.cached_state.config;
        const epoch_cache = test_state.cached_state.epoch_cache;
        const fork_state = state.castToFork(.electra);

        const proposer_index = try getBeaconProposer(.electra, epoch_cache, fork_state, try state.slot());
        const committee_indices = @as(*const [preset.SYNC_COMMITTEE_SIZE]ValidatorIndex, @ptrCast(try epoch_cache.current_sync_committee_indexed.get().getValidatorIndices()));

        var sync_aggregate: types.electra.SyncAggregate.Type = types.electra.SyncAggregate.default_value;
        var proposer_positions: usize = 0;
        for (committee_indices, 0..) |index, i| {
            if (index != proposer_index) continue;
            proposer_positions += 1;
            if (case.participate and proposer_positions == 1) try sync_aggregate.sync_committee_bits.set(i, true);
        }
        if (proposer_positions == 0) continue;
        penalty_path_exercised = true;

        const penalty = epoch_cache.sync_participant_reward;
        var balances = try fork_state.balances();
        try balances.set(proposer_index, case.start_balance_factor * penalty);

        try processSyncAggregate(
            .electra,
            std.testing.io,
            config,
            epoch_cache,
            fork_state,
            &test_state.cached_state.proposer_rewards,
            &sync_aggregate,
            false,
        );

        var updated = try fork_state.balances();
        const final_balance = try updated.get(proposer_index);
        if (case.start_balance_factor >= proposer_positions and !case.participate) {
            try std.testing.expectEqual(
                (case.start_balance_factor - proposer_positions) * penalty,
                final_balance,
            );
        } else if (!case.participate) {
            try std.testing.expectEqual(@as(u64, 0), final_balance);
        }
    }

    if (!penalty_path_exercised) return error.SkipZigTest;
}
