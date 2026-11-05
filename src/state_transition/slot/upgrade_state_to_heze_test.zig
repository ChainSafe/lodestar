const std = @import("std");
const ct = @import("consensus_types");
const preset = @import("preset").preset;
const config_module = @import("config");
const BeaconConfig = config_module.BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const Node = @import("persistent_merkle_tree").Node;
const upgradeStateToHeze = @import("upgrade_state_to_heze.zig").upgradeStateToHeze;

test "Heze upgrade preserves bid fields and initializes inclusion list bits" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();
    const config = BeaconConfig.init(config_module.mainnet.chain_config, @splat(0));
    var value = ct.gloas.BeaconState.default_value;
    defer ct.gloas.BeaconState.deinit(allocator, &value);
    value.slot = 3 * preset.SLOTS_PER_EPOCH;
    value.fork.current_version = config.chain.GLOAS_FORK_VERSION;
    value.eth1_deposit_index = 42;
    value.deposit_requests_start_index = 42;
    value.latest_execution_payload_bid.parent_block_hash = @splat(1);
    value.latest_execution_payload_bid.parent_block_root = @splat(2);
    value.latest_execution_payload_bid.block_hash = @splat(3);
    value.latest_execution_payload_bid.prev_randao = @splat(4);
    value.latest_execution_payload_bid.fee_recipient = @splat(5);
    value.latest_execution_payload_bid.gas_limit = 30_000_000;
    value.latest_execution_payload_bid.builder_index = 7;
    value.latest_execution_payload_bid.slot = value.slot - 1;
    value.latest_execution_payload_bid.value = 9;
    value.latest_execution_payload_bid.execution_payment = 10;
    value.latest_execution_payload_bid.execution_requests_root = @splat(11);
    try value.latest_execution_payload_bid.blob_kzg_commitments.append(allocator, @splat(12));
    try value.balances.append(allocator, 17);

    var source = BeaconState(.gloas){ .inner = try ct.gloas.BeaconState.TreeView.fromValue(allocator, &pool, &value) };
    var source_owned = true;
    defer if (source_owned) source.deinit();
    var upgraded = try upgradeStateToHeze(allocator, &config, &source);
    source_owned = false;
    defer upgraded.deinit();
    try std.testing.expectEqualSlices(u8, &config.chain.HEZE_FORK_VERSION, &try upgraded.forkCurrentVersion());
    try std.testing.expectEqual(3, try (try upgraded.fork()).get("epoch"));
    var bid = ct.heze.ExecutionPayloadBid.default_value;
    defer ct.heze.ExecutionPayloadBid.deinit(allocator, &bid);
    try upgraded.inner.getValue(allocator, "latest_execution_payload_bid", &bid);
    inline for (ct.gloas.ExecutionPayloadBid.fields) |field| {
        try std.testing.expect(field.type.equals(&@field(value.latest_execution_payload_bid, field.name), &@field(bid, field.name)));
    }
    try std.testing.expect(bid.inclusion_list_bits.equals(&ct.heze.InclusionListBits.default_value));
    var balances = try upgraded.balances();
    try std.testing.expectEqual(17, try balances.get(0));
}

test "Heze upgrade rejects undrained legacy deposits without consuming the source" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();
    const config = BeaconConfig.init(config_module.mainnet.chain_config, @splat(0));
    var source = BeaconState(.gloas){ .inner = try ct.gloas.BeaconState.TreeView.fromValue(allocator, &pool, &ct.gloas.BeaconState.default_value) };
    defer source.deinit();
    try source.setDepositRequestsStartIndex(1);
    const root = (try source.hashTreeRoot()).*;
    try std.testing.expectError(error.LegacyDepositsNotDrained, upgradeStateToHeze(allocator, &config, &source));
    try std.testing.expectEqualSlices(u8, &root, try source.hashTreeRoot());
}

test "memory_safety: Heze upgrade retains source ownership on allocation failure" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 500_000 });
    defer pool.deinit();
    const config = BeaconConfig.init(config_module.mainnet.chain_config, @splat(0));
    var value = ct.gloas.BeaconState.default_value;
    defer ct.gloas.BeaconState.deinit(allocator, &value);
    try value.latest_execution_payload_bid.blob_kzg_commitments.append(allocator, @splat(9));
    var template = BeaconState(.gloas){ .inner = try ct.gloas.BeaconState.TreeView.fromValue(allocator, &pool, &value) };
    defer template.deinit();
    const root = (try template.hashTreeRoot()).*;
    const baseline_nodes = pool.getNodesInUse();
    var succeeded = false;
    for (0..512) |fail_index| {
        var failing = std.testing.FailingAllocator.init(allocator, .{});
        var source = BeaconState(.gloas){ .inner = try ct.gloas.BeaconState.TreeView.init(failing.allocator(), &pool, template.inner.getRoot()) };
        failing.fail_index = failing.alloc_index + fail_index;
        pool.allocator = failing.allocator();
        defer pool.allocator = allocator;
        if (upgradeStateToHeze(failing.allocator(), &config, &source)) |result| {
            var upgraded = result;
            upgraded.deinit();
            succeeded = true;
        } else |err| {
            failing.fail_index = std.math.maxInt(usize);
            defer source.deinit();
            try std.testing.expectEqual(error.OutOfMemory, err);
            try std.testing.expectEqualSlices(u8, &root, try source.hashTreeRoot());
        }
        pool.allocator = allocator;
        try std.testing.expectEqual(baseline_nodes, pool.getNodesInUse());
        try std.testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
        if (succeeded) break;
    }
    try std.testing.expect(succeeded);
}
