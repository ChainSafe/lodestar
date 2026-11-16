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

const latest_block_hash: [32]u8 = @splat(1);
const latest_payload_root: [32]u8 = @splat(2);

const BidCase = enum { consistent, parent_payload_root_mismatch, payload_root_equals_parent };

/// Process a self-build bid on a state whose latest payload has `latest_block_hash` and `latest_payload_root`.
/// The bid always builds on `latest_block_hash` with another block hash, so that only the payload roots differ
/// between the cases.
fn processBid(bid_case: BidCase) !void {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 350_000 });
    defer pool.deinit();
    var any_state = try AnyBeaconState.fromValue(allocator, &pool, .gloas, &ct.gloas.BeaconState.default_value);
    defer any_state.deinit();
    const state = any_state.castToFork(.gloas);
    try state.setSlot(preset.SLOTS_PER_EPOCH);
    try state.inner.setValue("latest_block_hash", &latest_block_hash);
    try state.inner.setValue("latest_payload_root", &latest_payload_root);
    const active_config = if (@import("preset").active_preset == .mainnet) config_module.mainnet.chain_config else config_module.minimal.chain_config;
    var config = config_module.BeaconConfig.init(active_config, c.ZERO_HASH);
    var pubkeys = PubkeyCache.init(allocator, std.testing.io);
    defer pubkeys.deinit();
    const cache = try EpochCache.createFromState(allocator, std.testing.io, &any_state, .{ .config = &config, .pubkey_cache = &pubkeys }, .{ .skip_sync_committee_cache = true, .skip_sync_pubkeys = true });
    defer cache.deinit();

    var signed_bid = ct.gloas.SignedExecutionPayloadBid.default_value;
    signed_bid.signature = c.G2_POINT_AT_INFINITY;
    signed_bid.message.builder_index = c.BUILDER_INDEX_SELF_BUILD;
    signed_bid.message.slot = preset.SLOTS_PER_EPOCH;
    signed_bid.message.parent_block_hash = latest_block_hash;
    signed_bid.message.block_hash = @splat(3);
    signed_bid.message.parent_payload_root = latest_payload_root;
    signed_bid.message.payload_root = @splat(4);
    switch (bid_case) {
        .consistent => {},
        .parent_payload_root_mismatch => signed_bid.message.parent_payload_root = @splat(5),
        .payload_root_equals_parent => signed_bid.message.payload_root = latest_payload_root,
    }

    try processExecutionPayloadBid(.gloas, allocator, &config, cache, state, &signed_bid);

    var latest_bid = try state.inner.getReadonly("latest_execution_payload_bid");
    try std.testing.expectEqualSlices(u8, &signed_bid.message.payload_root, try latest_bid.getFieldRoot("payload_root"));
}

test "Gloas accepts a bid that builds on the latest block hash and payload root" {
    try processBid(.consistent);
}

test "Gloas rejects a bid whose parent payload root is not the latest payload root" {
    try std.testing.expectError(error.BidParentPayloadRootMismatch, processBid(.parent_payload_root_mismatch));
}

test "Gloas rejects a bid whose payload root equals its parent payload root" {
    try std.testing.expectError(error.BidPayloadRootEqualsParent, processBid(.payload_root_equals_parent));
}
