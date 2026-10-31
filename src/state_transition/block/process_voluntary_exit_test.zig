//! Tests for `process_voluntary_exit.zig`.

const types = @import("consensus_types");
const SignedVoluntaryExit = types.phase0.SignedVoluntaryExit.Type;
const std = @import("std");
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const Node = @import("persistent_merkle_tree").Node;
const getVoluntaryExitValidity = @import("process_voluntary_exit.zig").getVoluntaryExitValidity;

fn makeSignedVoluntaryExit(epoch: u64, validator_index: u64) SignedVoluntaryExit {
    return .{
        .message = .{
            .epoch = epoch,
            .validator_index = validator_index,
        },
        .signature = [_]u8{0} ** 96,
    };
}

test "voluntary exit - valid" {
    const allocator = std.testing.allocator;
    const pool_size = 180_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    const current_epoch = test_state.cached_state.epoch_cache.epoch;
    const signed_exit = makeSignedVoluntaryExit(current_epoch, 0);

    const result = try getVoluntaryExitValidity(
        .electra,
        std.testing.io,
        test_state.config,
        test_state.cached_state.epoch_cache,
        test_state.cached_state.state.castToFork(.electra),
        &signed_exit,
        false,
    );
    try std.testing.expectEqual(.valid, result);
}

test "voluntary exit - inactive validator (out of bounds index)" {
    const allocator = std.testing.allocator;
    const pool_size = 180_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    const current_epoch = test_state.cached_state.epoch_cache.epoch;
    const signed_exit = makeSignedVoluntaryExit(current_epoch, 9999);

    const result = try getVoluntaryExitValidity(
        .electra,
        std.testing.io,
        test_state.config,
        test_state.cached_state.epoch_cache,
        test_state.cached_state.state.castToFork(.electra),
        &signed_exit,
        false,
    );
    try std.testing.expectEqual(.inactive, result);
}

test "voluntary exit - inactive validator (not active in current epoch)" {
    const allocator = std.testing.allocator;
    const pool_size = 180_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    const current_epoch = test_state.cached_state.epoch_cache.epoch;

    // Set validator 0's exit_epoch to 0 so it's not active in current epoch
    var state = test_state.cached_state.state.castToFork(.electra);
    var validators = try state.validators();
    var validator = try validators.get(0);
    try validator.set("exit_epoch", 0);

    const signed_exit = makeSignedVoluntaryExit(current_epoch, 0);

    const result = try getVoluntaryExitValidity(
        .electra,
        std.testing.io,
        test_state.config,
        test_state.cached_state.epoch_cache,
        state,
        &signed_exit,
        false,
    );
    try std.testing.expectEqual(.inactive, result);
}

test "voluntary exit - already exited validator" {
    const allocator = std.testing.allocator;
    const pool_size = 180_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    const current_epoch = test_state.cached_state.epoch_cache.epoch;

    // Set validator 0's exit_epoch to a non-FAR_FUTURE value but still active
    var state = test_state.cached_state.state.castToFork(.electra);
    var validators = try state.validators();
    var validator = try validators.get(0);
    try validator.set("exit_epoch", current_epoch + 100);

    const signed_exit = makeSignedVoluntaryExit(current_epoch, 0);

    const result = try getVoluntaryExitValidity(
        .electra,
        std.testing.io,
        test_state.config,
        test_state.cached_state.epoch_cache,
        state,
        &signed_exit,
        false,
    );
    try std.testing.expectEqual(.already_exited, result);
}

test "voluntary exit - early epoch" {
    const allocator = std.testing.allocator;
    const pool_size = 180_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    const current_epoch = test_state.cached_state.epoch_cache.epoch;

    // Set voluntary exit epoch to a future epoch
    const signed_exit = makeSignedVoluntaryExit(current_epoch + 1, 0);

    const result = try getVoluntaryExitValidity(
        .electra,
        std.testing.io,
        test_state.config,
        test_state.cached_state.epoch_cache,
        test_state.cached_state.state.castToFork(.electra),
        &signed_exit,
        false,
    );
    try std.testing.expectEqual(.early_epoch, result);
}

test "voluntary exit - short time active" {
    const allocator = std.testing.allocator;
    const pool_size = 180_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    const current_epoch = test_state.cached_state.epoch_cache.epoch;

    // Set validator 0's activation_epoch so it hasn't been active long enough
    var state = test_state.cached_state.state.castToFork(.electra);
    var validators = try state.validators();
    var validator = try validators.get(0);
    try validator.set("activation_epoch", current_epoch);

    const signed_exit = makeSignedVoluntaryExit(current_epoch, 0);

    const result = try getVoluntaryExitValidity(
        .electra,
        std.testing.io,
        test_state.config,
        test_state.cached_state.epoch_cache,
        state,
        &signed_exit,
        false,
    );
    try std.testing.expectEqual(.short_time_active, result);
}
