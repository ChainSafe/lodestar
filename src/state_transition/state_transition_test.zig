//! Tests for `state_transition.zig`.

const std = @import("std");
const Diagnostics = @import("diagnostics").Diagnostics;
const types = @import("consensus_types");
const AnySignedBeaconBlock = @import("fork_types").AnySignedBeaconBlock;
const deinitReusedEpochTransitionCache = @import("cache/epoch_transition_cache.zig").deinitReusedEpochTransitionCache;
const TestCachedBeaconState = @import("test_utils/root.zig").TestCachedBeaconState;
const generateElectraBlock = @import("test_utils/generate_block.zig").generateElectraBlock;
const testing = std.testing;
const Node = @import("persistent_merkle_tree").Node;
const TransitionOpts = @import("state_transition.zig").TransitionOpts;
const stateTransition = @import("state_transition.zig").stateTransition;
const metrics = @import("metrics.zig");
const FAR_FUTURE_EPOCH = @import("constants").FAR_FUTURE_EPOCH;

const preset = @import("preset").preset;
const constants = @import("constants");
const processAttestations = @import("block/process_attestations.zig").processAttestations;
const processSyncAggregate = @import("block/process_sync_committee.zig").processSyncAggregate;
const slashValidator = @import("block/slash_validator.zig").slashValidator;
const ProposerRewards = @import("cache/state_cache.zig").ProposerRewards;

const TestCase = struct {
    transition_opt: TransitionOpts,
    expect_error: bool,
};

test "state transition - electra block" {
    const test_cases = [_]TestCase{
        .{ .transition_opt = .{}, .expect_error = true },
        .{ .transition_opt = .{ .verify_signatures = false, .verify_proposer = true }, .expect_error = true },
        .{ .transition_opt = .{ .verify_signatures = false, .verify_proposer = false, .verify_state_root = true }, .expect_error = true },
        // this runs through epoch transition + process block without verifications
        .{ .transition_opt = .{ .verify_signatures = false, .verify_proposer = false, .verify_state_root = false }, .expect_error = false },
    };

    inline for (test_cases) |tc| {
        const allocator = std.testing.allocator;
        const pool_size = 180_000;
        var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
        defer pool.deinit();

        var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
        defer test_state.deinit();

        var electra_block = types.electra.SignedBeaconBlock.default_value;
        try generateElectraBlock(allocator, test_state.cached_state, &electra_block);
        defer types.electra.SignedBeaconBlock.deinit(allocator, &electra_block);

        const signed_beacon_block = AnySignedBeaconBlock{ .full_electra = &electra_block };

        // this returns the error so no need to handle returned post_state
        // TODO: if blst can publish error.BadEncoding, can just use testing.expectError
        // testing.expectError(blst.c.BLST_BAD_ENCODING, stateTransition(allocator, test_state.cached_state, signed_block, .{ .verify_signatures = true }));
        const res = stateTransition(
            allocator,
            std.testing.io,
            test_state.cached_state,
            signed_beacon_block,
            tc.transition_opt,
            null,
        );
        if (tc.expect_error) {
            if (res) |_| {
                try testing.expect(false);
            } else |_| {}
        } else {
            if (res) |post_state| {
                defer {
                    post_state.deinit();
                    allocator.destroy(post_state);
                }
            } else |_| {
                try testing.expect(false);
            }
        }
    }

    deinitReusedEpochTransitionCache();
}

test "state transition - a rejected block leaves the pre-state unchanged" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();
    defer deinitReusedEpochTransitionCache();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    var electra_block = types.electra.SignedBeaconBlock.default_value;
    try generateElectraBlock(allocator, test_state.cached_state, &electra_block);
    defer types.electra.SignedBeaconBlock.deinit(allocator, &electra_block);

    const signed_beacon_block = AnySignedBeaconBlock{ .full_electra = &electra_block };

    // Snapshot the pre-state just before the transition.
    const before = (try test_state.cached_state.state.hashTreeRoot()).*;
    const before_slot = try test_state.cached_state.state.slot();

    // Full verification rejects this block (it isn't validly signed). stateTransition advances
    // and mutates a clone, then discards it on error — so the original state must come out
    // untouched: same root, same slot. (This is the invariant behind the "mutate then reject"
    // findings; the mutations only ever land on the thrown-away clone.)
    const res = stateTransition(allocator, std.testing.io, test_state.cached_state, signed_beacon_block, .{}, null);
    if (res) |post| {
        post.deinit();
        allocator.destroy(post);
        try testing.expect(false); // expected the block to be rejected
    } else |_| {}

    const after = (try test_state.cached_state.state.hashTreeRoot()).*;
    try testing.expectEqualSlices(u8, &before, &after);
    try testing.expectEqual(before_slot, try test_state.cached_state.state.slot());
}

/// Value of the first sample line `<name> <value>` in a Prometheus text scrape.
fn metricValue(output: []const u8, name: []const u8) ?u64 {
    var lines = std.mem.splitScalar(u8, output, '\n');
    while (lines.next()) |line| {
        if (std.mem.startsWith(u8, line, name) and line.len > name.len and line[name.len] == ' ') {
            return std.fmt.parseInt(u64, line[name.len + 1 ..], 10) catch null;
        }
    }
    return null;
}

test "state transition - records per-block and per-epoch metrics" {
    const allocator = std.testing.allocator;
    try metrics.init(allocator, std.testing.io, .{});
    defer metrics.deinit();

    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();
    defer deinitReusedEpochTransitionCache();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    var electra_block = types.electra.SignedBeaconBlock.default_value;
    try generateElectraBlock(allocator, test_state.cached_state, &electra_block);
    defer types.electra.SignedBeaconBlock.deinit(allocator, &electra_block);

    // Give the epoch transition something to report: validator 0 needs an
    // effective balance update, validator 1 is below the ejection balance,
    // and validator 2 is waiting for the activation queue.
    const state = test_state.cached_state.state.castToFork(.electra);
    var balances = try state.balances();
    try balances.set(0, 20_000_000_000);
    var validators = try state.validators();
    var to_eject = try validators.get(1);
    try to_eject.set("effective_balance", 16_000_000_000);
    var to_queue = try validators.get(2);
    try to_queue.set("activation_eligibility_epoch", FAR_FUTURE_EPOCH);
    // The fixture starts with full participation. The block's attestation targets the
    // epoch that the transition rotates into previous_epoch_participation, so clear the
    // current one to make those attesters newly seen.
    var current_participation = try state.currentEpochParticipation();
    for (0..try state.validatorsCount()) |i| {
        try current_participation.set(i, 0);
    }
    // Exercise the progressive-balance self-heal path at the epoch boundary.
    test_state.cached_state.epoch_cache.current_target_unslashed_balance_increments += 1;
    try test_state.cached_state.state.commit();

    const signed_beacon_block = AnySignedBeaconBlock{ .full_electra = &electra_block };
    const post_state = try stateTransition(
        allocator,
        std.testing.io,
        test_state.cached_state,
        signed_beacon_block,
        .{ .verify_signatures = false, .verify_proposer = false, .verify_state_root = false, .source = .regen },
        null,
    );
    defer {
        post_state.deinit();
        allocator.destroy(post_state);
    }

    var aw: std.Io.Writer.Allocating = .init(allocator);
    defer aw.deinit();
    try metrics.write(&aw.writer);
    const out = aw.written();

    // One clone of the pre-state, which has been cloned once afterwards.
    try testing.expectEqual(@as(?u64, 1), metricValue(out, "lodestar_stfn_state_cloned_count_count"));
    try testing.expectEqual(@as(?u64, 1), metricValue(out, "lodestar_stfn_state_cloned_count_sum"));
    // The block sits in the next epoch, so exactly one epoch transition was committed.
    try testing.expectEqual(@as(?u64, 1), metricValue(out, "lodestar_stfn_epoch_transition_commit_seconds_count"));
    // Epoch gauges come from the transition cache built before process_registry_updates.
    try testing.expectEqual(@as(?u64, 1), metricValue(out, "lodestar_stfn_validators_in_activation_queue"));
    try testing.expectEqual(@as(?u64, 1), metricValue(out, "lodestar_stfn_validators_in_exit_queue"));
    try testing.expect(metricValue(out, "lodestar_stfn_effective_balance_updates_count").? >= 1);
    // Per-block gauges describe the block just processed.
    const attestation_count: u64 = @intCast(electra_block.message.body.attestations.items.len);
    try testing.expectEqual(@as(?u64, attestation_count), metricValue(out, "lodestar_stfn_attestations_per_block_total"));
    try testing.expect(metricValue(out, "lodestar_stfn_new_seen_attesters_per_block_total").? > 0);
    try testing.expect(metricValue(out, "lodestar_stfn_new_seen_attesters_effective_balance_per_block_total").? > 0);
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_progressive_balances_mismatches_total{target=\"current\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_block_step_seconds_count{step=\"processBlockHeader\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_block_seconds_count{source=\"regen\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_block_step_seconds_count{step=\"processWithdrawals\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_block_step_seconds_count{step=\"processExecutionPayload\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_block_step_seconds_count{step=\"processRandao\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_block_step_seconds_count{step=\"processEth1Data\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_block_step_seconds_count{step=\"processOperations\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_block_step_seconds_count{step=\"processSyncAggregate\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_block_step_seconds_count{step=\"processBlobKzgCommitments\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_operations_step_seconds_count{step=\"processProposerSlashing\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_operations_step_seconds_count{step=\"processAttesterSlashing\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_operations_step_seconds_count{step=\"processAttestations\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_operations_step_seconds_count{step=\"processDeposit\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_operations_step_seconds_count{step=\"processVoluntaryExit\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_operations_step_seconds_count{step=\"processBlsToExecutionChange\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_operations_step_seconds_count{step=\"processDepositRequest\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_operations_step_seconds_count{step=\"processWithdrawalRequest\"}"),
    );
    try testing.expectEqual(
        @as(?u64, 1),
        metricValue(out, "lodestar_stfn_process_operations_step_seconds_count{step=\"processConsolidationRequest\"}"),
    );
    const proposer_rewards = post_state.getProposerRewards();
    try testing.expectEqual(
        @as(?u64, proposer_rewards.attestations),
        metricValue(out, "lodestar_stfn_proposer_rewards_total{type=\"attestation\"}"),
    );
    try testing.expectEqual(
        @as(?u64, proposer_rewards.sync_aggregate),
        metricValue(out, "lodestar_stfn_proposer_rewards_total{type=\"sync_aggregate\"}"),
    );
    try testing.expectEqual(
        @as(?u64, proposer_rewards.slashing),
        metricValue(out, "lodestar_stfn_proposer_rewards_total{type=\"slashing\"}"),
    );
}

test "proposer rewards should report only new attestation participation and reset on clone" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();

    var fixture = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer fixture.deinit();
    const cached = fixture.cached_state;
    const state = cached.state.castToFork(.electra);
    var participation = try state.currentEpochParticipation();
    for (0..256) |index| try participation.set(index, 0);

    var block = types.electra.SignedBeaconBlock.default_value;
    defer types.electra.SignedBeaconBlock.deinit(allocator, &block);
    try generateElectraBlock(allocator, cached, &block);

    const proposer = try cached.getBeaconProposer(try state.slot());
    var balances = try state.balances();
    const balance_before = try balances.get(proposer);
    try processAttestations(.electra, allocator, std.testing.io, cached.config, cached.epoch_cache, state, &cached.proposer_rewards, &cached.slashings_cache, block.message.body.attestations.items, false);
    const rewards = cached.getProposerRewards();
    try std.testing.expect(rewards.attestations > 0);
    try std.testing.expectEqual(rewards.attestations, try balances.get(proposer) - balance_before);

    const root = (try cached.state.hashTreeRoot()).*;
    const cloned = try cached.clone(allocator, .{});
    defer {
        cloned.deinit();
        allocator.destroy(cloned);
    }
    try std.testing.expectEqualDeep(ProposerRewards{}, cloned.getProposerRewards());
    try std.testing.expectEqualDeep(rewards, cached.getProposerRewards());
    try std.testing.expectEqualDeep(root, (try cloned.state.hashTreeRoot()).*);

    try processAttestations(.electra, allocator, std.testing.io, cached.config, cached.epoch_cache, state, &cached.proposer_rewards, &cached.slashings_cache, block.message.body.attestations.items, false);
    try std.testing.expectEqual(@as(u64, 0), cached.getProposerRewards().attestations);
    try std.testing.expectEqual(balance_before + rewards.attestations, try balances.get(proposer));
}

test "proposer rewards should count sync positions without participant rewards" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();

    var fixture = try TestCachedBeaconState.init(allocator, &pool, 16);
    defer fixture.deinit();
    const cached = fixture.cached_state;
    const state = cached.state.castToFork(.electra);
    const epoch_cache = cached.epoch_cache;
    const proposer = try cached.getBeaconProposer(try state.slot());
    const indices = try epoch_cache.current_sync_committee_indexed.get().getValidatorIndices();
    var proposer_positions: u64 = 0;
    var aggregate = types.electra.SyncAggregate.default_value;
    for (0..preset.SYNC_COMMITTEE_SIZE) |index| {
        try aggregate.sync_committee_bits.set(index, true);
        if (indices[index] == proposer) proposer_positions += 1;
    }
    var balances = try state.balances();
    const before = try balances.get(proposer);
    try processSyncAggregate(
        .electra,
        std.testing.io,
        cached.config,
        epoch_cache,
        state,
        &cached.proposer_rewards,
        &aggregate,
        false,
    );
    const expected = preset.SYNC_COMMITTEE_SIZE * epoch_cache.sync_proposer_reward;
    try std.testing.expect(expected > 0);
    try std.testing.expectEqual(expected, cached.getProposerRewards().sync_aggregate);
    try std.testing.expectEqual(expected + proposer_positions * epoch_cache.sync_participant_reward, try balances.get(proposer) - before);
}

test "proposer rewards should accumulate slashing rewards with and without a whistleblower" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();

    var fixture = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer fixture.deinit();
    const cached = fixture.cached_state;
    const state = cached.state.castToFork(.electra);
    const proposer = try cached.getBeaconProposer(try state.slot());
    const slashed = (proposer + 1) % 256;
    const second_slashed = (proposer + 2) % 256;
    const whistleblower = (proposer + 3) % 256;
    const reward = 32_000_000_000 / preset.WHISTLEBLOWER_REWARD_QUOTIENT_ELECTRA;
    const proposer_share = reward * constants.PROPOSER_WEIGHT / constants.WEIGHT_DENOMINATOR;
    var balances = try state.balances();
    const before = try balances.get(proposer);
    const whistleblower_before = try balances.get(whistleblower);

    try @import("cache/slashings_cache.zig").buildFromStateIfNeeded(allocator, state, &cached.slashings_cache);
    try slashValidator(.electra, cached.config, cached.epoch_cache, state, &cached.proposer_rewards, &cached.slashings_cache, slashed, null);
    try std.testing.expectEqual(@as(u64, reward), cached.getProposerRewards().slashing);
    try slashValidator(.electra, cached.config, cached.epoch_cache, state, &cached.proposer_rewards, &cached.slashings_cache, second_slashed, whistleblower);
    try std.testing.expectEqual(@as(u64, reward + proposer_share), cached.getProposerRewards().slashing);
    try std.testing.expectEqual(@as(u64, reward + proposer_share), try balances.get(proposer) - before);
    try std.testing.expectEqual(@as(u64, reward - proposer_share), try balances.get(whistleblower) - whistleblower_before);
}

test "state transition should preserve withdrawal diagnostics after failure" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 180_000,
    });
    defer pool.deinit();

    const generate_state = @import("test_utils/generate_state.zig");
    const chain_config = if (@import("preset").active_preset == .mainnet)
        @import("config").mainnet.chain_config
    else
        @import("config").minimal.chain_config;
    const state = try generate_state.generateElectraState(
        allocator,
        &pool,
        generate_state.getConfig(chain_config, .electra, 0),
        256,
    );
    var test_state = TestCachedBeaconState.initFromState(allocator, &pool, state, .electra, 0) catch |err| {
        state.deinit();
        allocator.destroy(state);
        return err;
    };
    defer test_state.deinit();
    const before_root = (try state.hashTreeRoot()).*;
    const slot = try state.slot();
    var latest_header = try state.latestBlockHeader();
    var block = types.electra.SignedBlindedBeaconBlock.default_value;
    block.message.slot = slot;
    block.message.proposer_index = test_state.cached_state.epoch_cache.proposers[slot % preset.SLOTS_PER_EPOCH];
    block.message.parent_root = (try latest_header.hashTreeRoot()).*;
    var expected_root: [32]u8 = undefined;
    try types.capella.Withdrawals.hashTreeRoot(allocator, &types.capella.Withdrawals.default_value, &expected_root);
    block.message.body.execution_payload_header.withdrawals_root = expected_root;
    block.message.body.execution_payload_header.withdrawals_root[0] ^= 1;
    const actual_root = block.message.body.execution_payload_header.withdrawals_root;
    var diagnostics: Diagnostics = .{};

    try testing.expectError(error.WithdrawalsRootMismatch, stateTransition(
        allocator,
        std.testing.io,
        test_state.cached_state,
        .{ .blinded_electra = &block },
        .{ .diagnostics = &diagnostics, .verify_proposer = false },
        null,
    ));
    const mismatch = &diagnostics.detail.?.state_transition.withdrawals_root_mismatch;
    try testing.expectEqualSlices(u8, &expected_root, &mismatch.expected);
    try testing.expectEqualSlices(u8, &actual_root, &mismatch.actual);
    try testing.expectEqualSlices(u8, &before_root, try state.hashTreeRoot());
    try testing.expectEqual(slot, try state.slot());

    var full_block = types.electra.SignedBeaconBlock.default_value;
    defer types.electra.SignedBeaconBlock.deinit(allocator, &full_block);
    full_block.message.slot = slot;
    full_block.message.proposer_index = test_state.cached_state.epoch_cache.proposers[slot % preset.SLOTS_PER_EPOCH];
    full_block.message.parent_root = (try latest_header.hashTreeRoot()).*;
    try full_block.message.body.execution_payload.withdrawals.append(
        allocator,
        types.capella.Withdrawal.default_value,
    );
    diagnostics = .{};

    try testing.expectError(error.WithdrawalsLengthMismatch, stateTransition(
        allocator,
        std.testing.io,
        test_state.cached_state,
        .{ .full_electra = &full_block },
        .{ .diagnostics = &diagnostics, .verify_proposer = false },
        null,
    ));
    const length_mismatch = &diagnostics.detail.?.state_transition.withdrawals_length_mismatch;
    try testing.expectEqual(@as(usize, 0), length_mismatch.expected);
    try testing.expectEqual(@as(usize, 1), length_mismatch.actual);
    try testing.expectEqualSlices(u8, &before_root, try state.hashTreeRoot());
    try testing.expectEqual(slot, try state.slot());

    try testing.expectError(error.WithdrawalsRootMismatch, stateTransition(
        allocator,
        std.testing.io,
        test_state.cached_state,
        .{ .blinded_electra = &block },
        .{ .verify_proposer = false },
        null,
    ));

    diagnostics = .{};
    block.message.slot = slot - 1;
    try testing.expectError(error.outdatedSlot, stateTransition(
        allocator,
        std.testing.io,
        test_state.cached_state,
        .{ .blinded_electra = &block },
        .{ .diagnostics = &diagnostics },
        null,
    ));
    try testing.expectEqual(null, diagnostics.detail);
}
