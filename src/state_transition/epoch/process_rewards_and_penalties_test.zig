//! Tests for `process_rewards_and_penalties.zig`.

const std = @import("std");
const types = @import("consensus_types");
const c = @import("constants");
const Node = @import("persistent_merkle_tree").Node;
const preset = @import("preset").preset;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const interop = @import("../test_utils/interop_pubkeys.zig");
const computeDomain = @import("../utils/domain.zig").computeDomain;
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const processPendingDeposits = @import("process_pending_deposits.zig").processPendingDeposits;
const processRewardsAndPenalties = @import("process_rewards_and_penalties.zig").processRewardsAndPenalties;

const BLSPubkey = types.primitive.BLSPubkey.Type;

test "memory_safety: processRewardsAndPenalties - sanity" {
    const allocator = std.testing.allocator;
    const pool_size = 200_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 10_000);
    defer test_state.deinit();

    try processRewardsAndPenalties(
        .electra,
        test_state.cached_state.config,
        test_state.cached_state.epoch_cache,
        test_state.cached_state.state.castToFork(.electra),
        test_state.epoch_transition_cache,
        null,
    );
}

test "processRewardsAndPenalties maps compact slashing penalties to validator indices" {
    const allocator = std.testing.allocator;
    const pool_size = 200_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    const validator_count = 256;
    const slashed_index = validator_count - 1;
    const slashing_penalty = 1;
    var test_state = try TestCachedBeaconState.init(allocator, &pool, validator_count);
    defer test_state.deinit();

    const state = test_state.cached_state.state.castToFork(.electra);
    var initial_balances = try state.balances();
    const initial_first_balance = try initial_balances.get(0);
    const initial_slashed_balance = try initial_balances.get(slashed_index);
    const cache = test_state.epoch_transition_cache;
    try cache.indices_to_slash.append(cache.allocator, slashed_index);

    try processRewardsAndPenalties(
        .electra,
        test_state.cached_state.config,
        test_state.cached_state.epoch_cache,
        state,
        cache,
        &.{slashing_penalty},
    );

    const rewards = cache.validator_scratch;
    const first_balance_without_slashing =
        (try std.math.add(u64, initial_first_balance, rewards[0])) -| cache.penalties[0];
    const slashed_balance_without_slashing =
        (try std.math.add(u64, initial_slashed_balance, rewards[slashed_index])) -| cache.penalties[slashed_index];
    var updated_balances = try state.balances();
    try std.testing.expectEqual(first_balance_without_slashing, try updated_balances.get(0));
    try std.testing.expectEqual(slashed_balance_without_slashing - slashing_penalty, try updated_balances.get(slashed_index));
}

fn signedPendingDeposit(
    genesis_fork_version: types.primitive.Version.Type,
    validator_index: usize,
    pubkey: *const BLSPubkey,
) !types.electra.PendingDeposit.Type {
    const message = types.phase0.DepositMessage.Type{
        .pubkey = pubkey.*,
        .withdrawal_credentials = [_]u8{0} ** 32,
        .amount = 2_000_000_000,
    };
    var domain: types.primitive.Domain.Type = undefined;
    try computeDomain(c.DOMAIN_DEPOSIT, genesis_fork_version, c.ZERO_HASH, &domain);
    var signing_root: types.primitive.Root.Type = undefined;
    try computeSigningRoot(types.phase0.DepositMessage, &message, &domain, &signing_root);
    const signature = try interop.interopSign(validator_index, &signing_root);
    return .{
        .pubkey = message.pubkey,
        .withdrawal_credentials = message.withdrawal_credentials,
        .amount = message.amount,
        .signature = signature.compress(),
        .slot = 0,
    };
}

test "cached balances should match state after pending deposits fill the headroom" {
    const allocator = std.testing.allocator;
    const pool_size = 400_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    const validator_count = 256;
    const deposit_count = preset.MAX_PENDING_DEPOSITS_PER_EPOCH + 1;
    var test_state = try TestCachedBeaconState.init(allocator, &pool, validator_count);
    defer test_state.deinit();

    const cached_state = test_state.cached_state;
    const state = cached_state.state.castToFork(.electra);
    const cache = test_state.epoch_transition_cache;

    var pubkeys: [validator_count + deposit_count]BLSPubkey = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);
    var pending_deposits = try state.pendingDeposits();
    for (validator_count..pubkeys.len) |i| {
        const deposit = try signedPendingDeposit(cached_state.config.chain.GENESIS_FORK_VERSION, i, &pubkeys[i]);
        try pending_deposits.pushValue(&deposit);
    }
    try cached_state.state.commit();

    try processRewardsAndPenalties(
        .electra,
        cached_state.config,
        cached_state.epoch_cache,
        state,
        cache,
        null,
    );
    try processPendingDeposits(
        .electra,
        allocator,
        std.testing.io,
        cached_state.config,
        cached_state.epoch_cache,
        state,
        cache,
    );

    const cached_balances = cache.balances.?;
    try std.testing.expectEqual(validator_count + preset.MAX_PENDING_DEPOSITS_PER_EPOCH, cached_balances.items.len);
    try std.testing.expectEqual(cache.balances_buffer.ptr, cached_balances.items.ptr);

    const state_balances = try state.balancesSlice(allocator);
    defer allocator.free(state_balances);

    try std.testing.expectEqualSlices(u64, state_balances, cached_balances.items);

    var queued_deposits = try state.pendingDeposits();
    try std.testing.expectEqual(1, try queued_deposits.length());
}
