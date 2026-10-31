const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const generateElectraBlock = @import("../test_utils/root.zig").generateElectraBlock;
const types = @import("consensus_types");
const computeBlockRewards = @import("block_rewards.zig").computeBlockRewards;
const ProposerRewards = @import("../cache/state_cache.zig").ProposerRewards;
const BeaconBlock = @import("fork_types").BeaconBlock;
const AnySignedBeaconBlock = @import("fork_types").AnySignedBeaconBlock;
const computeBlockRewardsAny = @import("block_rewards.zig").computeBlockRewardsAny;

fn clearParticipation(state: *TestCachedBeaconState) !void {
    var current = try state.cached_state.state.currentEpochParticipation();
    const current_len = try current.length();
    for (0..current_len) |i| try current.set(i, 0);
    var previous = try state.cached_state.state.previousEpochParticipation();
    const previous_len = try previous.length();
    for (0..previous_len) |i| try previous.set(i, 0);
    try state.cached_state.state.commit();
}

test "computeBlockRewards - totals and attestation reward" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    var signed_block = types.electra.SignedBeaconBlock.default_value;
    try generateElectraBlock(allocator, test_state.cached_state, &signed_block);
    defer types.electra.SignedBeaconBlock.deinit(allocator, &signed_block);
    const fork_block = BeaconBlock(.full, .electra){ .inner = signed_block.message };

    try clearParticipation(&test_state);

    const rewards = try computeBlockRewards(
        .electra,
        .full,
        allocator,
        std.testing.io,
        test_state.cached_state,
        &fork_block,
        null,
    );

    try std.testing.expectEqual(signed_block.message.proposer_index, rewards.proposer_index);
    try std.testing.expectEqual(
        rewards.attestations + rewards.sync_aggregate + rewards.proposer_slashings + rewards.attester_slashings,
        rewards.total,
    );
    try std.testing.expect(rewards.attestations > 0);
}

test "computeBlockRewards - reuses cached proposer rewards" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    var signed_block = types.electra.SignedBeaconBlock.default_value;
    try generateElectraBlock(allocator, test_state.cached_state, &signed_block);
    defer types.electra.SignedBeaconBlock.deinit(allocator, &signed_block);
    const fork_block = BeaconBlock(.full, .electra){ .inner = signed_block.message };

    const cached = ProposerRewards{ .attestations = 111, .sync_aggregate = 222 };
    const rewards = try computeBlockRewards(
        .electra,
        .full,
        allocator,
        std.testing.io,
        test_state.cached_state,
        &fork_block,
        cached,
    );

    try std.testing.expectEqual(@as(u64, 111), rewards.attestations);
    try std.testing.expectEqual(@as(u64, 222), rewards.sync_aggregate);
    try std.testing.expectEqual(@as(u64, 333), rewards.total);
}

test "computeBlockRewards - slashing rewards" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    var signed_block = types.electra.SignedBeaconBlock.default_value;
    try generateElectraBlock(allocator, test_state.cached_state, &signed_block);
    defer types.electra.SignedBeaconBlock.deinit(allocator, &signed_block);

    var proposer_slashing = types.phase0.ProposerSlashing.default_value;
    proposer_slashing.signed_header_1.message.proposer_index = 3;
    proposer_slashing.signed_header_2.message.proposer_index = 3;
    try signed_block.message.body.proposer_slashings.append(allocator, proposer_slashing);

    var attester_slashing = types.electra.AttesterSlashing.default_value;
    try attester_slashing.attestation_1.attesting_indices.append(allocator, 7);
    try attester_slashing.attestation_2.attesting_indices.append(allocator, 7);
    try signed_block.message.body.attester_slashings.append(allocator, attester_slashing);

    const fork_block = BeaconBlock(.full, .electra){ .inner = signed_block.message };

    const rewards = try computeBlockRewards(
        .electra,
        .full,
        allocator,
        std.testing.io,
        test_state.cached_state,
        &fork_block,
        ProposerRewards{ .attestations = 1, .sync_aggregate = 1 },
    );

    const expected = @divFloor(
        @as(u64, 32_000_000_000),
        @as(u64, @import("preset").preset.WHISTLEBLOWER_REWARD_QUOTIENT_ELECTRA),
    );
    try std.testing.expectEqual(expected, rewards.proposer_slashings);
    try std.testing.expectEqual(expected, rewards.attester_slashings);
    try std.testing.expectEqual(2 + expected * 2, rewards.total);
}

test "computeBlockRewardsAny - dispatches to the block's fork" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 180_000 });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    var signed_block = types.electra.SignedBeaconBlock.default_value;
    try generateElectraBlock(allocator, test_state.cached_state, &signed_block);
    defer types.electra.SignedBeaconBlock.deinit(allocator, &signed_block);

    const any_signed = AnySignedBeaconBlock{ .full_electra = &signed_block };
    const cached = ProposerRewards{ .attestations = 5, .sync_aggregate = 7 };

    const via_any = try computeBlockRewardsAny(
        allocator,
        std.testing.io,
        test_state.cached_state,
        any_signed.beaconBlock(),
        cached,
    );

    const fork_block = BeaconBlock(.full, .electra){ .inner = signed_block.message };
    const direct = try computeBlockRewards(
        .electra,
        .full,
        allocator,
        std.testing.io,
        test_state.cached_state,
        &fork_block,
        cached,
    );

    try std.testing.expectEqual(direct, via_any);
}
