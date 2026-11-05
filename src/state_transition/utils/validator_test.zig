//! Tests for `validator.zig`.

const std = @import("std");
const types = @import("consensus_types");
const preset = @import("preset").preset;
const Validator = types.phase0.Validator;
const Epoch = types.primitive.Epoch.Type;
const WithdrawalCredentials = types.primitive.Root.Type;
const validator_mod = @import("validator.zig");
const getActivationChurnLimit = validator_mod.getActivationChurnLimit;
const getBalanceChurnLimit = validator_mod.getBalanceChurnLimit;
const getChurnLimit = validator_mod.getChurnLimit;
const getMaxEffectiveBalance = validator_mod.getMaxEffectiveBalance;
const isActiveValidator = validator_mod.isActiveValidator;
const isSlashableValidator = validator_mod.isSlashableValidator;

test "isActiveValidator" {
    // Active: activation_epoch <= epoch < exit_epoch
    var v: Validator.Type = std.mem.zeroes(Validator.Type);
    v.activation_epoch = 5;
    v.exit_epoch = 10;

    try std.testing.expect(!isActiveValidator(&v, 4)); // before activation
    try std.testing.expect(isActiveValidator(&v, 5)); // at activation
    try std.testing.expect(isActiveValidator(&v, 7)); // mid-range
    try std.testing.expect(isActiveValidator(&v, 9)); // last active epoch
    try std.testing.expect(!isActiveValidator(&v, 10)); // at exit
    try std.testing.expect(!isActiveValidator(&v, 11)); // after exit

    // FAR_FUTURE_EPOCH means never exits
    v.exit_epoch = std.math.maxInt(Epoch);
    try std.testing.expect(isActiveValidator(&v, 100));
}

test "isSlashableValidator" {
    var v: Validator.Type = std.mem.zeroes(Validator.Type);
    v.activation_epoch = 5;
    v.withdrawable_epoch = 20;
    v.slashed = false;

    // Slashable: !slashed AND activation_epoch <= epoch < withdrawable_epoch
    try std.testing.expect(!isSlashableValidator(&v, 4)); // before activation
    try std.testing.expect(isSlashableValidator(&v, 5)); // at activation
    try std.testing.expect(isSlashableValidator(&v, 15)); // mid-range
    try std.testing.expect(isSlashableValidator(&v, 19)); // last slashable epoch
    try std.testing.expect(!isSlashableValidator(&v, 20)); // at withdrawable
    try std.testing.expect(!isSlashableValidator(&v, 25)); // after withdrawable

    // Already slashed
    v.slashed = true;
    try std.testing.expect(!isSlashableValidator(&v, 10));
}

test "getChurnLimit" {
    const config = &@import("config").mainnet.config;

    // With small validator count, should return MIN_PER_EPOCH_CHURN_LIMIT
    const min_churn = getChurnLimit(config, 10);
    try std.testing.expectEqual(config.chain.MIN_PER_EPOCH_CHURN_LIMIT, min_churn);

    // With large validator count, should return active_count / CHURN_LIMIT_QUOTIENT
    const large_count: usize = config.chain.CHURN_LIMIT_QUOTIENT * 100;
    const large_churn = getChurnLimit(config, large_count);
    try std.testing.expectEqual(100, large_churn);
}

test "getActivationChurnLimit" {
    const config = &@import("config").mainnet.config;

    // Pre-deneb: same as getChurnLimit
    const pre_deneb = getActivationChurnLimit(config, .capella, 1_000_000);
    const churn = getChurnLimit(config, 1_000_000);
    try std.testing.expectEqual(churn, pre_deneb);

    // Deneb+: min(MAX_PER_EPOCH_ACTIVATION_CHURN_LIMIT, getChurnLimit)
    const post_deneb = getActivationChurnLimit(config, .deneb, 1_000_000);
    try std.testing.expectEqual(@min(config.chain.MAX_PER_EPOCH_ACTIVATION_CHURN_LIMIT, churn), post_deneb);
}

test "getBalanceChurnLimit" {
    // Large total balance: calculated churn > min churn
    // 10_000_000 / 65536 * 1e9 = 152 * 1e9 = 152_000_000_000
    // vs min 128_000_000_000 → calculated wins
    const result = getBalanceChurnLimit(
        10_000_000, // total_active_balance_increments (~10M validators)
        65536, // churn_limit_quotient
        128_000_000_000, // min_per_epoch_churn_limit (128 ETH in Gwei)
    );
    const expected_raw: u64 = (10_000_000 / 65536) * preset.EFFECTIVE_BALANCE_INCREMENT;
    const expected = expected_raw - (expected_raw % preset.EFFECTIVE_BALANCE_INCREMENT);
    try std.testing.expectEqual(expected, result);

    // Small total balance: min churn wins
    // 100 / 65536 * 1e9 = 0 → min 128_000_000_000 wins
    const small_result = getBalanceChurnLimit(
        100, // tiny
        65536,
        128_000_000_000,
    );
    const min_churn: u64 = 128_000_000_000;
    const expected_small = min_churn - (min_churn % preset.EFFECTIVE_BALANCE_INCREMENT);
    try std.testing.expectEqual(expected_small, small_result);
}

test "getMaxEffectiveBalance" {
    // ETH1 withdrawal credentials → MIN_ACTIVATION_BALANCE
    var eth1_creds: WithdrawalCredentials = [_]u8{0x01} ++ [_]u8{0} ** 31;
    try std.testing.expectEqual(preset.MIN_ACTIVATION_BALANCE, getMaxEffectiveBalance(&eth1_creds));

    // Compounding withdrawal credentials → MAX_EFFECTIVE_BALANCE_ELECTRA
    var compounding_creds: WithdrawalCredentials = [_]u8{0x02} ++ [_]u8{0} ** 31;
    try std.testing.expectEqual(preset.MAX_EFFECTIVE_BALANCE_ELECTRA, getMaxEffectiveBalance(&compounding_creds));

    // BLS withdrawal credentials → MIN_ACTIVATION_BALANCE
    var bls_creds: WithdrawalCredentials = [_]u8{0x00} ++ [_]u8{0} ** 31;
    try std.testing.expectEqual(preset.MIN_ACTIVATION_BALANCE, getMaxEffectiveBalance(&bls_creds));
}
