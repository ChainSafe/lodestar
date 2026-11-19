const std = @import("std");
const ct = @import("consensus_types");
const c = @import("constants");
const preset = @import("preset").preset;
const config_module = @import("config");
const BeaconConfig = config_module.BeaconConfig;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const BeaconState = @import("fork_types").BeaconState;
const Node = @import("persistent_merkle_tree").Node;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const PubkeyCache = @import("../cache/pubkey_cache.zig").PubkeyCache;
const upgradeStateToGloas = @import("upgrade_state_to_gloas.zig").upgradeStateToGloas;

const validator_count = 96;

fn sourceState(allocator: std.mem.Allocator, pool: *Node.Pool, config: *const BeaconConfig, include_pending: bool) !AnyBeaconState {
    var value = ct.fulu.BeaconState.default_value;
    defer ct.fulu.BeaconState.deinit(allocator, &value);
    value.slot = preset.SLOTS_PER_EPOCH;
    value.fork = .{ .previous_version = config.chain.ELECTRA_FORK_VERSION, .current_version = config.chain.FULU_FORK_VERSION, .epoch = 0 };
    value.latest_block_header.slot = value.slot - 1;
    value.latest_execution_payload_header.parent_hash = @splat(1);
    value.latest_execution_payload_header.block_hash = @splat(2);
    value.latest_execution_payload_header.prev_randao = @splat(3);
    value.latest_execution_payload_header.gas_limit = 12345;
    for (0..validator_count) |index| {
        var validator = ct.phase0.Validator.default_value;
        std.mem.writeInt(u64, validator.pubkey[0..8], index, .little);
        validator.withdrawal_credentials[0] = c.COMPOUNDING_WITHDRAWAL_PREFIX;
        validator.effective_balance = preset.MAX_EFFECTIVE_BALANCE_ELECTRA;
        validator.exit_epoch = c.FAR_FUTURE_EPOCH;
        validator.withdrawable_epoch = c.FAR_FUTURE_EPOCH;
        try value.validators.append(allocator, validator);
        try value.balances.append(allocator, validator.effective_balance + index);
        try value.previous_epoch_participation.append(allocator, @intCast(index % 8));
        try value.current_epoch_participation.append(allocator, @intCast((index + 1) % 8));
        try value.inactivity_scores.append(allocator, index);
    }
    if (include_pending) {
        var pending = ct.electra.PendingDeposit.default_value;
        pending.pubkey = @splat(0xff);
        pending.amount = 17;
        try value.pending_deposits.append(allocator, pending);
        try value.pending_partial_withdrawals.append(allocator, .{ .validator_index = 2, .amount = 7, .withdrawable_epoch = 9 });
        try value.pending_consolidations.append(allocator, .{ .source_index = 2, .target_index = 3 });
    }
    return AnyBeaconState.fromValue(allocator, pool, .fulu, &value);
}

test "memory_safety: Gloas upgrade preserves Fulu across view and pool payload allocation failures" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();
    const empty_nodes = pool.getNodesInUse();
    const active_config = if (@import("preset").active_preset == .mainnet) config_module.mainnet.chain_config else config_module.minimal.chain_config;
    var config = BeaconConfig.init(active_config, c.ZERO_HASH);
    config.chain.GLOAS_FORK_EPOCH = 1;
    var template = try sourceState(allocator, &pool, &config, true);
    defer template.deinit();
    var pubkeys = PubkeyCache.init(allocator, std.testing.io);
    defer pubkeys.deinit();
    const epoch_cache = try EpochCache.createFromState(allocator, std.testing.io, &template, .{ .config = &config, .pubkey_cache = &pubkeys }, .{ .skip_sync_committee_cache = true, .skip_sync_pubkeys = true });
    defer epoch_cache.deinit();
    const source_root = (try template.hashTreeRoot()).*;
    const baseline_nodes = pool.getNodesInUse();
    var succeeded = false;
    for (0..4096) |fail_index| {
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var source = BeaconState(.fulu){ .inner = try ct.fulu.BeaconState.TreeView.init(failing.allocator(), &pool, template.castToFork(.fulu).inner.getRoot()) };
        failing.fail_index = failing.alloc_index + fail_index;
        pool.allocator = failing.allocator();
        defer pool.allocator = allocator;
        if (upgradeStateToGloas(failing.allocator(), std.testing.io, &config, epoch_cache, &source)) |upgraded_value| {
            failing.fail_index = std.math.maxInt(usize);
            var upgraded = upgraded_value;
            defer upgraded.deinit();
            var balances = try upgraded.balances();
            try std.testing.expectEqual(@as(usize, validator_count), try balances.length());
            for (0..validator_count) |index| try std.testing.expectEqual(preset.MAX_EFFECTIVE_BALANCE_ELECTRA + index, try balances.get(index));
            var pending = try upgraded.pendingDeposits();
            try std.testing.expectEqual(@as(usize, 1), try pending.length());
            succeeded = true;
        } else |err| {
            failing.fail_index = std.math.maxInt(usize);
            defer source.deinit();
            try std.testing.expectEqual(error.OutOfMemory, err);
            try std.testing.expectEqualSlices(u8, &source_root, try source.hashTreeRoot());
        }
        pool.allocator = allocator;
        try std.testing.expectEqual(baseline_nodes, pool.getNodesInUse());
        try std.testing.expectEqualSlices(u8, &source_root, try template.hashTreeRoot());
        if (succeeded) break;
    }
    try std.testing.expect(succeeded);
    try std.testing.expect(baseline_nodes > empty_nodes);
}

test "Gloas upgrade migrates empty pending queues" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();
    const active_config = if (@import("preset").active_preset == .mainnet) config_module.mainnet.chain_config else config_module.minimal.chain_config;
    var config = BeaconConfig.init(active_config, c.ZERO_HASH);
    config.chain.GLOAS_FORK_EPOCH = 1;
    var state = try sourceState(allocator, &pool, &config, false);
    defer state.deinit();
    var pubkeys = PubkeyCache.init(allocator, std.testing.io);
    defer pubkeys.deinit();
    const epoch_cache = try EpochCache.createFromState(allocator, std.testing.io, &state, .{ .config = &config, .pubkey_cache = &pubkeys }, .{ .skip_sync_committee_cache = true, .skip_sync_pubkeys = true });
    defer epoch_cache.deinit();
    const upgraded = try upgradeStateToGloas(allocator, std.testing.io, &config, epoch_cache, state.castToFork(.fulu));
    state = .{ .gloas = upgraded.inner };
    inline for (.{ "pending_deposits", "pending_partial_withdrawals", "pending_consolidations" }) |field| {
        var pending = try upgraded.inner.get(field);
        try std.testing.expectEqual(@as(usize, 0), try pending.length());
    }
    try std.testing.expectEqual(@as(usize, validator_count), try state.validatorsCount());
}
