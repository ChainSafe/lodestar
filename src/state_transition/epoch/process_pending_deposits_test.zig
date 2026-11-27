//! Tests for `process_pending_deposits.zig`.

const std = @import("std");
const types = @import("consensus_types");
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const interop = @import("../test_utils/interop_pubkeys.zig");
const processPendingDeposits = @import("process_pending_deposits.zig").processPendingDeposits;

const BLSPubkey = types.primitive.BLSPubkey.Type;

test "a deposit after the one adding its validator is a top-up despite its checked signature" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 400_000 });
    defer pool.deinit();

    const validator_count = 256;
    var test_state = try TestCachedBeaconState.init(allocator, &pool, validator_count);
    defer test_state.deinit();
    const cached_state = test_state.cached_state;
    const state = cached_state.state.castToFork(.electra);
    const fork_version = cached_state.config.chain.GENESIS_FORK_VERSION;

    var pubkeys: [validator_count + 2]BLSPubkey = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);
    const new_validator = validator_count;
    const wrong_signer = validator_count + 1;
    const amount = 2_000_000_000;

    // Both deposits are for a pubkey unknown at the start, so both signatures are checked up
    // front, and the second one's check fails.
    var pending_deposits = try state.pendingDeposits();
    const valid = try interop.interopPendingDeposit(fork_version, &pubkeys[new_validator], amount, new_validator);
    const invalid = try interop.interopPendingDeposit(fork_version, &pubkeys[new_validator], amount, wrong_signer);
    try pending_deposits.pushValue(&valid);
    try pending_deposits.pushValue(&invalid);
    try cached_state.state.commit();

    try processPendingDeposits(
        .electra,
        allocator,
        std.testing.io,
        cached_state.config,
        cached_state.epoch_cache,
        state,
        test_state.epoch_transition_cache,
    );

    try std.testing.expectEqual(validator_count + 1, try state.validatorsCount());
    var validators = try state.validators();
    var validator = try validators.getReadonly(new_validator);
    try std.testing.expectEqualSlices(u8, &pubkeys[new_validator], &(try validator.get("pubkey")));
    var balances = try state.balances();
    try std.testing.expectEqual(2 * amount, try balances.get(new_validator));
    var queued_deposits = try state.pendingDeposits();
    try std.testing.expectEqual(0, try queued_deposits.length());
}

test "a new pubkey with an invalid signature is skipped between valid ones" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 400_000 });
    defer pool.deinit();

    const validator_count = 256;
    var test_state = try TestCachedBeaconState.init(allocator, &pool, validator_count);
    defer test_state.deinit();
    const cached_state = test_state.cached_state;
    const state = cached_state.state.castToFork(.electra);
    const fork_version = cached_state.config.chain.GENESIS_FORK_VERSION;

    var pubkeys: [validator_count + 4]BLSPubkey = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);
    const first = validator_count;
    const invalid = validator_count + 1;
    const last = validator_count + 2;
    const wrong_signer = validator_count + 3;
    const amount = 2_000_000_000;

    // Only the first signature is checked on the calling thread, so the invalid one is a task's result.
    var pending_deposits = try state.pendingDeposits();
    for ([_][2]usize{ .{ first, first }, .{ invalid, wrong_signer }, .{ last, last } }) |pubkey_signer| {
        const deposit = try interop.interopPendingDeposit(
            fork_version,
            &pubkeys[pubkey_signer[0]],
            amount,
            pubkey_signer[1],
        );
        try pending_deposits.pushValue(&deposit);
    }
    try cached_state.state.commit();

    try processPendingDeposits(
        .electra,
        allocator,
        std.testing.io,
        cached_state.config,
        cached_state.epoch_cache,
        state,
        test_state.epoch_transition_cache,
    );

    try std.testing.expectEqual(validator_count + 2, try state.validatorsCount());
    var validators = try state.validators();
    for ([_]usize{ first, last }, validator_count..) |pubkey_index, validator_index| {
        var validator = try validators.getReadonly(validator_index);
        try std.testing.expectEqualSlices(u8, &pubkeys[pubkey_index], &(try validator.get("pubkey")));
    }
    var queued_deposits = try state.pendingDeposits();
    try std.testing.expectEqual(0, try queued_deposits.length());
}

test "a pubkey cached beyond the state's validators is added as a new validator" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 400_000 });
    defer pool.deinit();

    const validator_count = 256;
    var test_state = try TestCachedBeaconState.init(allocator, &pool, validator_count);
    defer test_state.deinit();
    const cached_state = test_state.cached_state;
    const state = cached_state.state.castToFork(.electra);

    var pubkeys: [validator_count + 1]BLSPubkey = undefined;
    try interop.interopPubkeysCached(pubkeys.len, &pubkeys);
    const new_validator = validator_count;
    const amount = 2_000_000_000;

    // The pubkey cache is shared between states, so it can already hold a pubkey that this
    // state has not added yet.
    const pubkey_cache = cached_state.epoch_cache.pubkey_cache;
    try pubkey_cache.append(std.testing.io, pubkeys[new_validator], new_validator);

    var pending_deposits = try state.pendingDeposits();
    const deposit = try interop.interopPendingDeposit(
        cached_state.config.chain.GENESIS_FORK_VERSION,
        &pubkeys[new_validator],
        amount,
        new_validator,
    );
    try pending_deposits.pushValue(&deposit);
    try cached_state.state.commit();

    try processPendingDeposits(
        .electra,
        allocator,
        std.testing.io,
        cached_state.config,
        cached_state.epoch_cache,
        state,
        test_state.epoch_transition_cache,
    );

    try std.testing.expectEqual(validator_count + 1, try state.validatorsCount());
    var balances = try state.balances();
    try std.testing.expectEqual(amount, try balances.get(new_validator));
}
