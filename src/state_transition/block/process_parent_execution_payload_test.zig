const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const ct = @import("consensus_types");
const c = @import("constants");
const preset = @import("preset").preset;
const config_module = @import("config");
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const PubkeyCache = @import("../cache/pubkey_cache.zig").PubkeyCache;
const BeaconBlock = @import("fork_types").BeaconBlock;
const applyParentExecutionPayload = @import("process_parent_execution_payload.zig").applyParentExecutionPayload;
const processParentExecutionPayload = @import("process_parent_execution_payload.zig").processParentExecutionPayload;
const validateExecutionRequests = @import("process_parent_execution_payload.zig").validateExecutionRequests;
const WithdrawalsResult = @import("process_withdrawals.zig").WithdrawalsResult;
const processWithdrawalsGloas = @import("process_withdrawals_gloas.zig").processWithdrawals;
const gloas = @import("../utils/gloas.zig");

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
    bid.payload_root = @splat(4);
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
    try std.testing.expectEqualSlices(u8, &bid.payload_root, try state.inner.getFieldRoot("latest_payload_root"));
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

// The payload the state builds on, and the payload the bid of the latest block commits to. Block hashes and
// payload roots never share a value, so that a decision by block hash cannot pass for one by payload root.
const latest_block_hash: [32]u8 = @splat(1);
const latest_payload_root: [32]u8 = @splat(2);
const parent_bid_block_hash: [32]u8 = @splat(3);
const parent_bid_payload_root: [32]u8 = @splat(4);

const ParentCase = enum {
    /// `bid.parent_payload_root` is the payload root of the parent bid, `bid.parent_block_hash` is the latest
    /// block hash of the state: FULL by payload root, EMPTY by block hash
    full_by_root_empty_by_hash,
    /// `bid.parent_payload_root` is the latest payload root of the state, `bid.parent_block_hash` is the block
    /// hash of the parent bid: EMPTY by payload root, FULL by block hash
    empty_by_root_full_by_hash,
};

/// Process the parent execution payload of a block whose bid names a parent payload root and a parent block hash
/// that give opposite answers to "is the parent block full". Returns whether the payload was applied.
/// `with_requests` makes the block carry the execution requests the parent bid commits to, which only a block
/// on a full parent may do.
fn processParent(parent_case: ParentCase, with_requests: bool) !bool {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 350_000 });
    defer pool.deinit();
    var any_state = try AnyBeaconState.fromValue(allocator, &pool, .gloas, &ct.gloas.BeaconState.default_value);
    defer any_state.deinit();
    const state = any_state.castToFork(.gloas);
    try state.setSlot(2);
    var header = try state.latestBlockHeader();
    try header.set("slot", 1);
    try state.inner.setValue("latest_block_hash", &latest_block_hash);
    try state.inner.setValue("latest_payload_root", &latest_payload_root);

    var block: BeaconBlock(.full, .gloas) = .{ .inner = ct.gloas.BeaconBlock.default_value };
    defer ct.gloas.BeaconBlock.deinit(allocator, &block.inner);
    block.inner.slot = 2;
    const requests = &block.inner.body.parent_execution_requests;
    if (with_requests) {
        try requests.withdrawals.append(allocator, ct.electra.WithdrawalRequest.default_value);
    }

    var parent_bid = ct.gloas.ExecutionPayloadBid.default_value;
    parent_bid.slot = 1;
    parent_bid.block_hash = parent_bid_block_hash;
    parent_bid.payload_root = parent_bid_payload_root;
    try ct.gloas.ExecutionRequests.hashTreeRoot(allocator, requests, &parent_bid.execution_requests_root);
    try state.inner.setValue("latest_execution_payload_bid", &parent_bid);

    const bid = &block.inner.body.signed_execution_payload_bid.message;
    switch (parent_case) {
        .full_by_root_empty_by_hash => {
            bid.parent_payload_root = parent_bid_payload_root;
            bid.parent_block_hash = latest_block_hash;
        },
        .empty_by_root_full_by_hash => {
            bid.parent_payload_root = latest_payload_root;
            bid.parent_block_hash = parent_bid_block_hash;
        },
    }

    const active_config = if (@import("preset").active_preset == .mainnet) config_module.mainnet.chain_config else config_module.minimal.chain_config;
    var config = config_module.BeaconConfig.init(active_config, c.ZERO_HASH);
    var pubkeys = PubkeyCache.init(allocator, std.testing.io);
    defer pubkeys.deinit();
    const cache = try EpochCache.createFromState(allocator, std.testing.io, &any_state, .{ .config = &config, .pubkey_cache = &pubkeys }, .{ .skip_sync_committee_cache = true, .skip_sync_pubkeys = true });
    defer cache.deinit();

    try processParentExecutionPayload(.gloas, allocator, std.testing.io, &config, cache, state, &block);

    // Applying the payload makes it the latest payload of the state and marks it available, all or nothing
    var availability = try state.inner.getReadonly("execution_payload_availability");
    const is_available = try availability.get(1);
    const applied = std.mem.eql(u8, &parent_bid_payload_root, try state.inner.getFieldRoot("latest_payload_root"));
    try std.testing.expectEqual(applied, is_available);
    try std.testing.expectEqualSlices(
        u8,
        if (applied) &parent_bid_block_hash else &latest_block_hash,
        try state.inner.getFieldRoot("latest_block_hash"),
    );
    if (!applied) {
        try std.testing.expectEqualSlices(u8, &latest_payload_root, try state.inner.getFieldRoot("latest_payload_root"));
    }
    return applied;
}

test "Gloas applies the parent payload when the payload root says FULL and the block hash says EMPTY" {
    try std.testing.expect(try processParent(.full_by_root_empty_by_hash, false));
    try std.testing.expect(try processParent(.full_by_root_empty_by_hash, true));
}

test "Gloas does not apply the parent payload when the payload root says EMPTY and the block hash says FULL" {
    try std.testing.expect(!try processParent(.empty_by_root_full_by_hash, false));
}

test "Gloas rejects parent execution requests when the payload root says EMPTY and the block hash says FULL" {
    try std.testing.expectError(error.ParentExecutionRequestsNotEmpty, processParent(.empty_by_root_full_by_hash, true));
}

const WithdrawalsCase = enum {
    /// The latest payload of the state is the one its bid commits to, with another block hash than the bid's
    full_by_root_empty_by_hash,
    /// The latest payload of the state is not the one its bid commits to, with the block hash of the bid
    empty_by_root_full_by_hash,
};

/// Process a withdrawal of 30 from a builder with balance 100 and return the balance of the builder afterwards.
/// `isParentBlockFull` gates the withdrawals: nothing is withdrawn on top of an empty parent block.
fn processBuilderWithdrawal(withdrawals_case: WithdrawalsCase) !u64 {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 350_000 });
    defer pool.deinit();
    var any_state = try AnyBeaconState.fromValue(allocator, &pool, .gloas, &ct.gloas.BeaconState.default_value);
    defer any_state.deinit();
    const state = any_state.castToFork(.gloas);
    var validators = try state.inner.get("validators");
    try validators.pushValue(&ct.phase0.Validator.default_value);
    var builders = try state.inner.get("builders");
    var builder = ct.gloas.Builder.default_value;
    builder.balance = 100;
    try builders.pushValue(&builder);

    var parent_bid = ct.gloas.ExecutionPayloadBid.default_value;
    parent_bid.block_hash = parent_bid_block_hash;
    parent_bid.payload_root = parent_bid_payload_root;
    try state.inner.setValue("latest_execution_payload_bid", &parent_bid);
    const is_full = switch (withdrawals_case) {
        .full_by_root_empty_by_hash => blk: {
            try state.inner.setValue("latest_payload_root", &parent_bid_payload_root);
            try state.inner.setValue("latest_block_hash", &latest_block_hash);
            break :blk true;
        },
        .empty_by_root_full_by_hash => blk: {
            try state.inner.setValue("latest_payload_root", &latest_payload_root);
            try state.inner.setValue("latest_block_hash", &parent_bid_block_hash);
            break :blk false;
        },
    };
    try std.testing.expectEqual(is_full, try gloas.isParentBlockFull(.gloas, state));

    var result: WithdrawalsResult = .{ .withdrawals = ct.capella.Withdrawals.default_value };
    defer ct.capella.Withdrawals.deinit(allocator, &result.withdrawals);
    try result.withdrawals.append(allocator, .{
        .index = 0,
        .validator_index = gloas.convertBuilderIndexToValidatorIndex(0),
        .address = @splat(5),
        .amount = 30,
    });
    try processWithdrawalsGloas(.gloas, state, &result);

    // The withdrawals of the payload are only expected of a payload on top of a full parent block
    var expected_withdrawals = try state.inner.getReadonly("payload_expected_withdrawals");
    try std.testing.expectEqual(@as(usize, if (is_full) 1 else 0), try expected_withdrawals.length());

    try builders.getValue(undefined, 0, &builder);
    return builder.balance;
}

test "Gloas processes withdrawals when the payload root says FULL and the block hash says EMPTY" {
    try std.testing.expectEqual(@as(u64, 70), try processBuilderWithdrawal(.full_by_root_empty_by_hash));
}

test "Gloas skips withdrawals when the payload root says EMPTY and the block hash says FULL" {
    try std.testing.expectEqual(@as(u64, 100), try processBuilderWithdrawal(.empty_by_root_full_by_hash));
}
