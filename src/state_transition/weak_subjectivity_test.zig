//! Tests for `weak_subjectivity.zig`.

const active_preset = @import("preset").active_preset;
const std = @import("std");
const validator = @import("./utils/validator.zig");
const computeWeakSubjectivityPeriodFromConstituentsElectra = @import("weak_subjectivity.zig").computeWeakSubjectivityPeriodFromConstituentsElectra;
const computeWeakSubjectivityPeriodFromConstituentsPhase0 = @import("weak_subjectivity.zig").computeWeakSubjectivityPeriodFromConstituentsPhase0;
const computeWeakSubjectivityPeriodCachedState = @import("weak_subjectivity.zig").computeWeakSubjectivityPeriodCachedState;
const getLatestWeakSubjectivityCheckpointEpoch = @import("weak_subjectivity.zig").getLatestWeakSubjectivityCheckpointEpoch;
const BeaconConfig = @import("config").BeaconConfig;
const EpochCache = @import("cache/epoch_cache.zig").EpochCache;

test "computeWeakSubjectivityPeriodFromConstituentsPhase0 - mainnet table" {
    if (active_preset != .mainnet) return error.SkipZigTest;
    // Ported from packages/state-transition/test/unit/util/weakSubjectivity.test.ts
    const config = &@import("config").mainnet.config;
    const min_delay = config.chain.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;

    const Case = struct { avg_balance: u64, val_count: usize, ws_period: u64 };
    const cases = [_]Case{
        .{ .avg_balance = 28, .val_count = 32768, .ws_period = 504 },
        .{ .avg_balance = 28, .val_count = 65536, .ws_period = 752 },
        .{ .avg_balance = 28, .val_count = 131072, .ws_period = 1248 },
        .{ .avg_balance = 28, .val_count = 262144, .ws_period = 2241 },
        .{ .avg_balance = 28, .val_count = 524288, .ws_period = 2241 },
        .{ .avg_balance = 28, .val_count = 1048576, .ws_period = 2241 },
        .{ .avg_balance = 32, .val_count = 32768, .ws_period = 665 },
        .{ .avg_balance = 32, .val_count = 65536, .ws_period = 1075 },
        .{ .avg_balance = 32, .val_count = 131072, .ws_period = 1894 },
        .{ .avg_balance = 32, .val_count = 262144, .ws_period = 3532 },
        .{ .avg_balance = 32, .val_count = 524288, .ws_period = 3532 },
        .{ .avg_balance = 32, .val_count = 1048576, .ws_period = 3532 },
    };

    for (cases) |c| {
        const total_balance_by_increment: u64 = c.avg_balance * @as(u64, @intCast(c.val_count));
        const churn = validator.getChurnLimit(config, c.val_count);
        const got = computeWeakSubjectivityPeriodFromConstituentsPhase0(
            c.val_count,
            total_balance_by_increment,
            churn,
            min_delay,
        );
        try std.testing.expectEqual(c.ws_period, got);
    }
}

test "computeWeakSubjectivityPeriodFromConstituentsElectra - mainnet table" {
    if (active_preset != .mainnet) return error.SkipZigTest;
    // Ported from packages/state-transition/test/unit/util/weakSubjectivity.test.ts
    // Values from https://github.com/ethereum/consensus-specs/blob/8ebb5e80862641287d7e8db2bbf69fa31612640b/specs/electra/weak-subjectivity.md#weak-subjectivity-period
    const config = &@import("config").mainnet.config;
    const min_delay = config.chain.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;

    const Case = struct { total_balance_increment: u64, ws_period: u64 };
    const cases = [_]Case{
        .{ .total_balance_increment = 1_048_576, .ws_period = 665 },
        .{ .total_balance_increment = 2_097_152, .ws_period = 1075 },
        .{ .total_balance_increment = 4_194_304, .ws_period = 1894 },
        .{ .total_balance_increment = 8_388_608, .ws_period = 3532 },
        .{ .total_balance_increment = 16_777_216, .ws_period = 3532 },
        .{ .total_balance_increment = 33_554_432, .ws_period = 3532 },
    };

    for (cases) |c| {
        const balance_churn = validator.getBalanceChurnLimit(
            c.total_balance_increment,
            config.chain.CHURN_LIMIT_QUOTIENT,
            config.chain.MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA,
        );
        const got = computeWeakSubjectivityPeriodFromConstituentsElectra(
            c.total_balance_increment,
            balance_churn,
            min_delay,
        );
        try std.testing.expectEqual(c.ws_period, got);
    }
}

test "computeWeakSubjectivityPeriodCachedState - Gloas mainnet table" {
    // v1.7.0-beta.4/specs/gloas/weak-subjectivity.md reference table.
    var chain_config = @import("config").mainnet.config.chain;
    chain_config.GLOAS_FORK_EPOCH = 0;
    const config = BeaconConfig.init(chain_config, @splat(0));
    // Electra and later formulas only read these aggregate cache fields.
    var epoch_cache: EpochCache = undefined;
    epoch_cache.config = &config;
    epoch_cache.epoch = 0;

    const Case = struct { total_balance_increment: u64, ws_period: u64 };
    const cases = [_]Case{
        .{ .total_balance_increment = 1_048_576, .ws_period = 620 },
        .{ .total_balance_increment = 2_097_152, .ws_period = 911 },
        .{ .total_balance_increment = 4_194_304, .ws_period = 1348 },
        .{ .total_balance_increment = 8_388_608, .ws_period = 1348 },
        .{ .total_balance_increment = 16_777_216, .ws_period = 1484 },
        .{ .total_balance_increment = 33_554_432, .ws_period = 1566 },
        .{ .total_balance_increment = 67_108_864, .ws_period = 1611 },
        .{ .total_balance_increment = 134_217_728, .ws_period = 1635 },
    };

    for (cases) |c| {
        epoch_cache.total_active_balance_increments = c.total_balance_increment;
        try std.testing.expectEqual(c.ws_period, computeWeakSubjectivityPeriodCachedState(&epoch_cache));
    }
}

test "getLatestWeakSubjectivityCheckpointEpoch - Gloas fork and clamp" {
    var chain_config = @import("config").mainnet.config.chain;
    chain_config.FULU_FORK_EPOCH = 0;
    chain_config.GLOAS_FORK_EPOCH = 10_000;
    var config = BeaconConfig.init(chain_config, @splat(0));
    var epoch_cache: EpochCache = undefined;
    epoch_cache.config = &config;
    epoch_cache.total_active_balance_increments = 33_554_432;

    epoch_cache.epoch = 9_999;
    try std.testing.expectEqual(3532, computeWeakSubjectivityPeriodCachedState(&epoch_cache));
    try std.testing.expectEqual(6467, getLatestWeakSubjectivityCheckpointEpoch(&epoch_cache));

    epoch_cache.epoch = 10_000;
    try std.testing.expectEqual(1566, computeWeakSubjectivityPeriodCachedState(&epoch_cache));
    try std.testing.expectEqual(8434, getLatestWeakSubjectivityCheckpointEpoch(&epoch_cache));

    chain_config.GLOAS_FORK_EPOCH = 0;
    config = BeaconConfig.init(chain_config, @splat(0));
    for ([_]u64{ 0, 1565, 1566, 1567 }, [_]u64{ 0, 0, 0, 1 }) |epoch, expected| {
        epoch_cache.epoch = epoch;
        try std.testing.expectEqual(expected, getLatestWeakSubjectivityCheckpointEpoch(&epoch_cache));
    }
}
