const std = @import("std");
const bls = @import("bls");
const preset = @import("preset").preset;
const Node = @import("persistent_merkle_tree").Node;
const PubkeyCache = @import("../cache/pubkey_cache.zig").PubkeyCache;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const sync_committee = @import("sync_committee.zig");

test "getNextSyncCommittee returns the members' pubkeys and their aggregate" {
    const allocator = std.testing.allocator;

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 180_000,
    });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    const state = test_state.cached_state.state.castToFork(.electra);
    const epoch_cache = test_state.cached_state.epoch_cache;

    var info: sync_committee.SyncCommitteeInfo = undefined;
    try sync_committee.getNextSyncCommittee(
        .electra,
        allocator,
        std.testing.io,
        epoch_cache.pubkey_cache,
        state,
        epoch_cache.getNextEpochShuffling().active_indices,
        epoch_cache.getEffectiveBalanceIncrements(),
        &info,
    );

    var validators = try state.validators();
    var points: [preset.SYNC_COMMITTEE_SIZE]bls.PublicKey = undefined;
    for (info.indices, &info.sync_committee.pubkeys, &points) |index, *pubkey, *point| {
        var validator = try validators.get(index);
        const expected = try validator.get("pubkey");
        try std.testing.expectEqualSlices(u8, &expected, pubkey);
        point.* = try bls.PublicKey.uncompress(&expected);
    }
    const aggregate = try bls.AggregatePublicKey.aggregate(&points, false);
    try std.testing.expectEqualSlices(
        u8,
        &aggregate.toPublicKey().compress(),
        &info.sync_committee.aggregate_pubkey,
    );
}

test "getNextSyncCommittee fails when a member is missing from the pubkey cache" {
    const allocator = std.testing.allocator;

    var pool = try Node.Pool.init(.{
        .page_allocator = allocator,
        .allocator = allocator,
        .pool_size = 180_000,
    });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 256);
    defer test_state.deinit();

    var empty_cache = PubkeyCache.init(allocator, std.testing.io);
    defer empty_cache.deinit();

    const epoch_cache = test_state.cached_state.epoch_cache;
    var info: sync_committee.SyncCommitteeInfo = undefined;
    try std.testing.expectError(error.PubkeyNotFound, sync_committee.getNextSyncCommittee(
        .electra,
        allocator,
        std.testing.io,
        &empty_cache,
        test_state.cached_state.state.castToFork(.electra),
        epoch_cache.getNextEpochShuffling().active_indices,
        epoch_cache.getEffectiveBalanceIncrements(),
        &info,
    ));
}
