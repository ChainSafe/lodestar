const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const ct = @import("consensus_types");
const c = @import("constants");
const preset = @import("preset").preset;
const config_module = @import("config");
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const PubkeyCache = @import("../cache/pubkey_cache.zig").PubkeyCache;
const applyParentExecutionPayload = @import("process_parent_execution_payload.zig").applyParentExecutionPayload;
const validateExecutionRequests = @import("process_parent_execution_payload.zig").validateExecutionRequests;

test "Gloas settles a delayed parent payment before processing its builder exit" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 350_000 });
    defer pool.deinit();
    var any_state = try AnyBeaconState.fromValue(allocator, &pool, .gloas, &ct.gloas.BeaconState.default_value);
    defer any_state.deinit();
    const state = any_state.castToFork(.gloas);
    try state.setSlot(3 * preset.SLOTS_PER_EPOCH);
    var header = try state.latestBlockHeader();
    try header.set("slot", 1);
    var checkpoint = try state.inner.get("finalized_checkpoint");
    try checkpoint.set("epoch", 2);
    var builders = try state.inner.get("builders");
    var builder = ct.gloas.Builder.default_value;
    builder.pubkey = @splat(1);
    builder.execution_address = @splat(2);
    builder.balance = 100;
    builder.withdrawable_epoch = c.FAR_FUTURE_EPOCH;
    try builders.pushValue(&builder);
    var bid = ct.gloas.ExecutionPayloadBid.default_value;
    bid.slot = 1;
    bid.value = 17;
    bid.block_hash = @splat(3);
    try state.inner.setValue("latest_execution_payload_bid", &bid);
    const active_config = if (@import("preset").active_preset == .mainnet) config_module.mainnet.chain_config else config_module.minimal.chain_config;
    var config = config_module.BeaconConfig.init(active_config, c.ZERO_HASH);
    var pubkeys = PubkeyCache.init(allocator, std.testing.io);
    defer pubkeys.deinit();
    const cache = try EpochCache.createFromState(allocator, std.testing.io, &any_state, .{ .config = &config, .pubkey_cache = &pubkeys }, .{ .skip_sync_committee_cache = true, .skip_sync_pubkeys = true });
    defer cache.deinit();
    var requests = ct.gloas.ExecutionRequests.default_value;
    defer ct.gloas.ExecutionRequests.deinit(allocator, &requests);
    try requests.builder_exits.append(allocator, .{ .pubkey = builder.pubkey, .source_address = builder.execution_address });
    try applyParentExecutionPayload(.gloas, allocator, std.testing.io, &config, cache, state, &requests);
    try builders.getValue(undefined, 0, &builder);
    try std.testing.expectEqual(c.FAR_FUTURE_EPOCH, builder.withdrawable_epoch);
    var pending = try state.inner.getReadonly("builder_pending_withdrawals");
    try std.testing.expectEqual(@as(usize, 1), try pending.length());
    var withdrawal: ct.gloas.BuilderPendingWithdrawal.Type = undefined;
    try pending.getValue(undefined, 0, &withdrawal);
    try std.testing.expectEqual(@as(u64, 17), withdrawal.amount);
    try std.testing.expectEqualSlices(u8, &bid.block_hash, try state.inner.getFieldRoot("latest_block_hash"));
}

test "Gloas request operation limits apply independently of SSZ decoding" {
    inline for (.{
        .{ "withdrawals", preset.MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD },
        .{ "consolidations", preset.MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD },
        .{ "builder_deposits", preset.MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD },
        .{ "builder_exits", preset.MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD },
    }) |field_limit| {
        const field = field_limit[0];
        const limit = field_limit[1];
        const Element = ct.gloas.ExecutionRequests.getFieldType(field).Element;
        var values: [limit + 1]Element.Type = @splat(Element.default_value);
        var requests = ct.gloas.ExecutionRequests.default_value;
        @field(requests, field) = .{ .items = values[0..limit], .capacity = limit + 1 };
        try validateExecutionRequests(.gloas, &requests);
        @field(requests, field).items = values[0..];
        try std.testing.expectError(error.TooManyExecutionRequests, validateExecutionRequests(.gloas, &requests));
    }
}
