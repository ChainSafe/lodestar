const std = @import("std");
const bls = @import("bls");
const ct = @import("consensus_types");
const c = @import("constants");
const Node = @import("persistent_merkle_tree").Node;
const BeaconConfig = @import("config").BeaconConfig;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const upgradeStateToFulu = @import("../slot/upgrade_state_to_fulu.zig").upgradeStateToFulu;
const upgradeStateToGloas = @import("../slot/upgrade_state_to_gloas.zig").upgradeStateToGloas;
const computeDomain = @import("domain.zig").computeDomain;
const computeSigningRoot = @import("signing_root.zig").computeSigningRoot;
const deposit_module = @import("../block/process_deposit.zig");
const preVerify = @import("pre_verify_builder_deposits.zig").preVerifyBuilderDepositsPreGloas;
const metrics = @import("../metrics.zig");

fn fuluState(allocator: std.mem.Allocator, pool: *Node.Pool) !TestCachedBeaconState {
    var fixture = try TestCachedBeaconState.init(allocator, pool, 64);
    errdefer fixture.deinit();
    const state = fixture.cached_state;
    const upgraded = try upgradeStateToFulu(allocator, state.config, state.epoch_cache, state.state.castToFork(.electra));
    state.state.* = .{ .fulu = upgraded.inner };
    try state.state.commit();
    return fixture;
}

fn signedDeposit(config: *const BeaconConfig, seed: u8, prefix: u8, amount: u64) !ct.electra.PendingDeposit.Type {
    const sk = try bls.SecretKey.keyGen(&(@as([32]u8, @splat(seed))), null);
    var deposit = ct.electra.PendingDeposit.default_value;
    deposit.pubkey = sk.toPublicKey().compress();
    deposit.withdrawal_credentials[0] = prefix;
    deposit.amount = amount;
    var domain: [32]u8 = undefined;
    try computeDomain(c.DOMAIN_DEPOSIT, config.chain.GENESIS_FORK_VERSION, c.ZERO_HASH, &domain);
    var signing_root: [32]u8 = undefined;
    try computeSigningRoot(
        ct.phase0.DepositMessage,
        &.{ .pubkey = deposit.pubkey, .withdrawal_credentials = deposit.withdrawal_credentials, .amount = amount },
        &domain,
        &signing_root,
    );
    deposit.signature = sk.sign(&signing_root, bls.DST, null).compress();
    return deposit;
}

test "deposit preverify batches agree with individual proof-of-possession checks" {
    const allocator = std.testing.allocator;
    const config = BeaconConfig.init(@import("config").mainnet.chain_config, c.ZERO_HASH);
    const pool = try bls.ThreadPool.init(allocator, std.testing.io, .{ .n_workers = 4 });
    defer pool.deinit(std.testing.io);
    var deposits: [8]ct.electra.PendingDeposit.Type = undefined;
    for (&deposits, 0..) |*deposit, index| deposit.* = try signedDeposit(
        &config,
        @intCast(index + 40),
        c.BUILDER_WITHDRAWAL_PREFIX,
        1_000_000_000,
    );
    deposits[1].amount += 1;
    deposits[2].withdrawal_credentials[0] = 1;
    deposits[3].signature = @splat(0);
    deposits[4].signature = @splat(0);
    deposits[4].signature[0] = 0xc0;
    deposits[5].pubkey = @splat(0);
    deposits[6].pubkey = @splat(0);
    deposits[6].pubkey[0] = 0xc0;
    var results: [deposits.len]bool = undefined;
    for ([_]bool{ true, false }) |batch_verify| {
        try deposit_module.verifyDepositSignatures(std.testing.io, pool, &config, &deposits, &results, batch_verify);
        for (deposits, results) |deposit, result| {
            const valid = if (deposit_module.validateDepositSignature(
                &config,
                &deposit.pubkey,
                &deposit.withdrawal_credentials,
                deposit.amount,
                deposit.signature,
            )) true else |_| false;
            try std.testing.expectEqual(valid, result);
        }
        try std.testing.expectEqualSlices(bool, &.{ true, false, false, false, false, false, false, true }, &results);
    }
}

test "deposit preverify rejects subgroup failures and cancelling invalid signatures" {
    const allocator = std.testing.allocator;
    const config = BeaconConfig.init(@import("config").mainnet.chain_config, c.ZERO_HASH);
    const pool = try bls.ThreadPool.init(allocator, std.testing.io, .{ .n_workers = 4 });
    defer pool.deinit(std.testing.io);
    var deposits: [32]ct.electra.PendingDeposit.Type = undefined;
    for (&deposits, 0..) |*deposit, index| deposit.* = try signedDeposit(
        &config,
        @intCast(index + 40),
        c.BUILDER_WITHDRAWAL_PREFIX,
        1_000_000_000,
    );
    deposits[17].amount += 1;
    var results: [deposits.len]bool = undefined;
    try deposit_module.verifyDepositSignatures(std.testing.io, pool, &config, &deposits, &results, true);
    for (results, 0..) |valid, index| try std.testing.expectEqual(index != 17, valid);

    deposits[0].pubkey = @splat(0);
    deposits[0].pubkey[0] = 0x80;
    deposits[0].pubkey[47] = 4;
    const non_subgroup_pk = try bls.PublicKey.uncompress(&deposits[0].pubkey);
    try std.testing.expectError(error.PointNotInGroup, non_subgroup_pk.validate());
    var found_non_subgroup_sig = false;
    for (1..256) |last_byte| {
        deposits[1].signature = @splat(0);
        deposits[1].signature[0] = 0x80;
        deposits[1].signature[95] = @intCast(last_byte);
        const signature = bls.Signature.uncompress(&deposits[1].signature) catch continue;
        if (signature.validate(true)) {} else |err| {
            if (err != error.PointNotInGroup) continue;
            found_non_subgroup_sig = true;
            break;
        }
    }
    try std.testing.expect(found_non_subgroup_sig);
    try deposit_module.verifyDepositSignatures(std.testing.io, pool, &config, deposits[0..2], results[0..2], true);
    try std.testing.expectEqualSlices(bool, &.{ false, false }, results[0..2]);

    deposits[0] = try signedDeposit(&config, 40, c.BUILDER_WITHDRAWAL_PREFIX, 1_000_000_000);
    deposits[1] = try signedDeposit(&config, 41, c.BUILDER_WITHDRAWAL_PREFIX, 1_000_000_000);
    const original = [_]bls.Signature{
        try bls.Signature.uncompress(&deposits[0].signature),
        try bls.Signature.uncompress(&deposits[1].signature),
    };
    const offset = try bls.Signature.uncompress(&deposits[2].signature);
    var negated: bls.c.blst_p2 = undefined;
    bls.c.blst_p2_from_affine(&negated, &offset.point);
    bls.c.blst_p2_cneg(&negated, true);
    const minus = (bls.AggregateSignature{ .point = negated }).toSignature();
    const changed = [_]bls.Signature{
        (try bls.AggregateSignature.aggregate(&.{ original[0], offset }, true)).toSignature(),
        (try bls.AggregateSignature.aggregate(&.{ original[1], minus }, true)).toSignature(),
    };
    try std.testing.expectEqualSlices(u8, &(try bls.AggregateSignature.aggregate(&original, true)).toSignature().compress(), &(try bls.AggregateSignature.aggregate(&changed, true)).toSignature().compress());
    deposits[0].signature = changed[0].compress();
    deposits[1].signature = changed[1].compress();
    try deposit_module.verifyDepositSignatures(std.testing.io, pool, &config, deposits[0..2], results[0..2], true);
    try std.testing.expectEqualSlices(bool, &.{ false, false }, results[0..2]);
}

test "deposit preverify resumes bounded work and warms validator prefixes across clones" {
    const allocator = std.testing.allocator;
    var nodes = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer nodes.deinit();
    var fixture = try fuluState(allocator, &nodes);
    defer fixture.deinit();
    const state = fixture.cached_state;
    var pending = try state.state.castToFork(.fulu).pendingDeposits();
    const builder = try signedDeposit(state.config, 42, c.BUILDER_WITHDRAWAL_PREFIX, 1_000_000_000);
    const validator = try signedDeposit(state.config, 42, 1, 1_000_000_000);
    for (0..40) |index| {
        var invalid = validator;
        invalid.amount += index + 1;
        try pending.pushValue(&invalid);
    }
    try pending.pushValue(&builder);
    try pending.pushValue(&validator);
    try state.state.commit();
    const root = (try state.state.hashTreeRoot()).*;
    const pool = try bls.ThreadPool.init(allocator, std.testing.io, .{ .n_workers = 1 });
    defer pool.deinit(std.testing.io);

    const first = try preVerify(std.testing.io, pool, state, 7, 60_000);
    try std.testing.expectEqual(@as(usize, 0), first.invalid_validator_signatures_count);
    try std.testing.expectEqual(@as(usize, 1), first.valid_builder_signatures_count);
    try std.testing.expectEqual(@as(usize, 1), first.valid_validator_signatures_count);
    const clone = try state.clone(allocator, .{});
    defer {
        clone.deinit();
        allocator.destroy(clone);
    }
    try std.testing.expectEqual(state.epoch_cache.builder_deposit_signature_cache, clone.epoch_cache.builder_deposit_signature_cache);
    const second = try preVerify(std.testing.io, pool, clone, 10_000, 0);
    try std.testing.expectEqual(@as(usize, 32), second.invalid_validator_signatures_count);
    const third = try preVerify(std.testing.io, pool, state, 10_000, 60_000);
    try std.testing.expectEqual(@as(usize, 8), third.invalid_validator_signatures_count);
    try std.testing.expectEqual(@as(usize, 0), third.valid_builder_signatures_count);
    try std.testing.expectEqual(@as(usize, 0), third.valid_validator_signatures_count);
    try std.testing.expectEqual(@as(usize, 42), third.total_cached_deposits);
    try std.testing.expectEqualSlices(u8, &root, try state.state.hashTreeRoot());

    try metrics.init(allocator, std.testing.io, .{});
    defer metrics.deinit();
    const upgraded = try upgradeStateToGloas(allocator, std.testing.io, state.config, state.epoch_cache, state.state.castToFork(.fulu));
    state.state.* = .{ .gloas = upgraded.inner };
    var builders = try upgraded.inner.get("builders");
    try std.testing.expectEqual(@as(usize, 1), try builders.length());
    var builder_value: ct.gloas.Builder.Type = undefined;
    try builders.getValue(undefined, 0, &builder_value);
    try std.testing.expectEqual(builder.amount + validator.amount, builder_value.balance);
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try metrics.write(&output.writer);
    try std.testing.expect(
        std.mem.find(u8, output.written(), "stfn_gloas_onboard_builders_signature_checks{source=\"verified\"} 0\n") != null,
    );
    try std.testing.expect(
        std.mem.find(u8, output.written(), "stfn_gloas_onboard_builders_signature_checks{source=\"cache\"} 41\n") != null,
    );
}

test "deposit preverify unrelated validators do not exhaust capacity before a builder" {
    const allocator = std.testing.allocator;
    var nodes = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer nodes.deinit();
    var fixture = try fuluState(allocator, &nodes);
    defer fixture.deinit();
    const state = fixture.cached_state;
    const unrelated = [_]ct.electra.PendingDeposit.Type{
        try signedDeposit(state.config, 180, 1, 1_000_000_000),
        try signedDeposit(state.config, 181, 1, 1_000_000_000),
    };
    const builder = try signedDeposit(state.config, 182, c.BUILDER_WITHDRAWAL_PREFIX, 1_000_000_000);
    const cache = &state.epoch_cache.builder_deposit_signature_cache.instance;
    cache.capacity = unrelated.len;
    var pending = try state.state.castToFork(.fulu).pendingDeposits();
    for (&unrelated) |*deposit| try pending.pushValue(deposit);
    try pending.pushValue(&builder);
    try state.state.commit();
    const root = (try state.state.hashTreeRoot()).*;
    const pool = try bls.ThreadPool.init(allocator, std.testing.io, .{ .n_workers = 1 });
    defer pool.deinit(std.testing.io);

    var valid_builder_signatures: usize = 0;
    for (0..3) |_| {
        const result = try preVerify(std.testing.io, pool, state, 10_000, 60_000);
        valid_builder_signatures += result.valid_builder_signatures_count;
    }

    try std.testing.expectEqualSlices(u8, &root, try state.state.hashTreeRoot());
    try std.testing.expectEqual(@as(usize, 1), valid_builder_signatures);
    try std.testing.expectEqual(@as(?bool, true), try cache.get(state.config, &builder));
    for (&unrelated) |*deposit| {
        try std.testing.expectEqual(@as(?bool, null), try cache.get(state.config, deposit));
        try std.testing.expect(!cache.isBuilderPubkey(deposit.pubkey));
    }
    try std.testing.expectEqual(@as(usize, 1), cache.validity.count());
}

test "deposit preverify bounds scans even when no deposit needs verification" {
    const allocator = std.testing.allocator;
    var nodes = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer nodes.deinit();
    var fixture = try fuluState(allocator, &nodes);
    defer fixture.deinit();
    const state = fixture.cached_state;
    var pending = try state.state.castToFork(.fulu).pendingDeposits();
    var known = ct.electra.PendingDeposit.default_value;
    var validators = try state.state.validators();
    var validator: ct.phase0.Validator.Type = undefined;
    try validators.getValue(undefined, 0, &validator);
    known.pubkey = validator.pubkey;
    for (0..100) |_| try pending.pushValue(&known);
    try state.state.commit();
    const pool = try bls.ThreadPool.init(allocator, std.testing.io, .{ .n_workers = 1 });
    defer pool.deinit(std.testing.io);
    const first = try preVerify(std.testing.io, pool, state, 10_000, 0);
    try std.testing.expectEqual(@as(usize, 32), first.scanned_pending_deposits);
    try std.testing.expectEqual(@as(usize, 0), first.total_cached_deposits);
    try std.testing.expectEqual(@as(usize, 32), state.epoch_cache.builder_deposit_signature_cache.instance.scan_cursor);
    const second = try preVerify(std.testing.io, pool, state, 0, 60_000);
    try std.testing.expectEqual(@as(usize, 0), second.scanned_pending_deposits);
}

test "deposit preverify covers a late builder trigger and skips recoverable top-ups" {
    const allocator = std.testing.allocator;
    var nodes = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer nodes.deinit();
    var fixture = try fuluState(allocator, &nodes);
    defer fixture.deinit();
    const state = fixture.cached_state;
    var pending = try state.state.castToFork(.fulu).pendingDeposits();
    const builder = try signedDeposit(state.config, 43, c.BUILDER_WITHDRAWAL_PREFIX, 1_000_000_000);
    const validator = try signedDeposit(state.config, 43, 1, 1_000_000_000);
    for (0..40) |index| {
        var invalid = validator;
        invalid.amount += index + 1;
        try pending.pushValue(&invalid);
    }
    const other_builder = try signedDeposit(state.config, 44, c.BUILDER_WITHDRAWAL_PREFIX, 1_000_000_000);
    try pending.pushValue(&other_builder);
    for (0..100) |index| {
        var topup = other_builder;
        topup.amount += index + 1;
        try pending.pushValue(&topup);
    }
    try state.state.commit();
    const pool = try bls.ThreadPool.init(allocator, std.testing.io, .{ .n_workers = 4 });
    defer pool.deinit(std.testing.io);
    const result = try preVerify(std.testing.io, pool, state, 10_000, 60_000);
    try std.testing.expectEqual(@as(usize, 0), result.invalid_validator_signatures_count);
    try std.testing.expectEqual(@as(usize, 1), result.valid_builder_signatures_count);
    try std.testing.expectEqual(@as(usize, 23), result.invalid_builder_signatures_count);
    try pending.pushValue(&builder);
    try state.state.commit();
    try metrics.init(allocator, std.testing.io, .{});
    defer metrics.deinit();
    const upgraded = try upgradeStateToGloas(allocator, std.testing.io, state.config, state.epoch_cache, state.state.castToFork(.fulu));
    state.state.* = .{ .gloas = upgraded.inner };
    var builders = try upgraded.inner.get("builders");
    try std.testing.expectEqual(@as(usize, 2), try builders.length());
    try std.testing.expectEqual(
        @as(?bool, true),
        try state.epoch_cache.builder_deposit_signature_cache.instance.get(state.config, &builder),
    );
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try metrics.write(&output.writer);
    try std.testing.expect(
        std.mem.find(u8, output.written(), "stfn_gloas_onboard_builders_signature_checks{source=\"verified\"} 41\n") != null,
    );
    try std.testing.expect(
        std.mem.find(u8, output.written(), "stfn_gloas_onboard_builders_signature_checks{source=\"cache\"} 1\n") != null,
    );
}

test "deposit preverify valid validator prefix suppresses later signatures at the fork" {
    const allocator = std.testing.allocator;
    var nodes = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer nodes.deinit();
    var fixture = try fuluState(allocator, &nodes);
    defer fixture.deinit();
    const state = fixture.cached_state;
    var pending = try state.state.castToFork(.fulu).pendingDeposits();
    const validator = try signedDeposit(state.config, 45, 1, 1_000_000_000);
    try pending.pushValue(&validator);
    for (0..100) |index| {
        var topup = validator;
        topup.amount += index + 1;
        try pending.pushValue(&topup);
    }
    try pending.pushValue(&(try signedDeposit(state.config, 45, c.BUILDER_WITHDRAWAL_PREFIX, 1_000_000_000)));
    try state.state.commit();
    const pool = try bls.ThreadPool.init(allocator, std.testing.io, .{ .n_workers = 4 });
    defer pool.deinit(std.testing.io);
    const first = try preVerify(std.testing.io, pool, state, 10_000, 60_000);
    try std.testing.expectEqual(@as(usize, 1), first.total_cached_deposits);
    try std.testing.expectEqual(@as(usize, 0), first.valid_validator_signatures_count);
    const second = try preVerify(std.testing.io, pool, state, 10_000, 60_000);
    try std.testing.expectEqual(@as(usize, 33), second.total_cached_deposits);
    try std.testing.expectEqual(@as(usize, 1), second.valid_validator_signatures_count);
    try metrics.init(allocator, std.testing.io, .{});
    defer metrics.deinit();
    const upgraded = try upgradeStateToGloas(allocator, std.testing.io, state.config, state.epoch_cache, state.state.castToFork(.fulu));
    state.state.* = .{ .gloas = upgraded.inner };
    var builders = try upgraded.inner.get("builders");
    try std.testing.expectEqual(@as(usize, 0), try builders.length());
    var remaining = try state.state.castToFork(.gloas).pendingDeposits();
    try std.testing.expectEqual(@as(usize, 102), try remaining.length());
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try metrics.write(&output.writer);
    try std.testing.expect(
        std.mem.find(u8, output.written(), "stfn_gloas_onboard_builders_signature_checks{source=\"verified\"} 0\n") != null,
    );
    try std.testing.expect(
        std.mem.find(u8, output.written(), "stfn_gloas_onboard_builders_signature_checks{source=\"cache\"} 1\n") != null,
    );
}
