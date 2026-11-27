const std = @import("std");
const Node = @import("persistent_merkle_tree").Node;
const ct = @import("consensus_types");
const c = @import("constants");
const preset = @import("preset").preset;
const config_module = @import("config");
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const PubkeyCache = @import("../cache/pubkey_cache.zig").PubkeyCache;
const processExecutionPayloadBid = @import("process_execution_payload_bid.zig").processExecutionPayloadBid;

test "Gloas builder bid signature is checked only when verify_signature is set" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 350_000 });
    defer pool.deinit();
    var any_state = try AnyBeaconState.fromValue(allocator, &pool, .gloas, &ct.gloas.BeaconState.default_value);
    defer any_state.deinit();
    const state = any_state.castToFork(.gloas);
    const slot = 3 * preset.SLOTS_PER_EPOCH;
    try state.setSlot(slot);
    var checkpoint = try state.inner.get("finalized_checkpoint");
    try checkpoint.set("epoch", 2);
    var builders = try state.inner.get("builders");
    var builder = ct.gloas.Builder.default_value;
    builder.pubkey = @splat(1);
    builder.balance = preset.MIN_DEPOSIT_AMOUNT;
    builder.withdrawable_epoch = c.FAR_FUTURE_EPOCH;
    try builders.pushValue(&builder);
    const active_config = if (@import("preset").active_preset == .mainnet) config_module.mainnet.chain_config else config_module.minimal.chain_config;
    var config = config_module.BeaconConfig.init(active_config, c.ZERO_HASH);
    var pubkeys = PubkeyCache.init(allocator, std.testing.io);
    defer pubkeys.deinit();
    const cache = try EpochCache.createFromState(allocator, std.testing.io, &any_state, .{ .config = &config, .pubkey_cache = &pubkeys }, .{ .skip_sync_committee_cache = true, .skip_sync_pubkeys = true });
    defer cache.deinit();

    var signed_bid = ct.gloas.SignedExecutionPayloadBid.default_value;
    signed_bid.message.slot = slot;
    signed_bid.message.builder_index = 0;
    signed_bid.message.block_hash = @splat(3);
    signed_bid.signature = @splat(4);

    try std.testing.expectError(error.InvalidBidSignature, processExecutionPayloadBid(.gloas, allocator, &config, cache, state, &signed_bid, true));

    try processExecutionPayloadBid(.gloas, allocator, &config, cache, state, &signed_bid, false);
    var latest_bid = try state.inner.getReadonly("latest_execution_payload_bid");
    try std.testing.expectEqualSlices(u8, &signed_bid.message.block_hash, try latest_bid.getFieldRoot("block_hash"));
}
