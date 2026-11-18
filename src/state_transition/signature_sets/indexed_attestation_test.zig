const std = @import("std");
const types = @import("consensus_types");
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const getAttestationWithIndicesSignatureSet = @import("indexed_attestation.zig").getAttestationWithIndicesSignatureSet;
const statePubkeyBytes = @import("../cache/pubkey_cache.zig").statePubkeyBytes;

test "indexed attestations resolve unfinalized registry keys without extending the dense cache" {
    const allocator = std.testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 200_000 });
    defer pool.deinit();
    var fixture = try TestCachedBeaconState.init(allocator, &pool, 64);
    defer fixture.deinit();
    try fixture.pubkey_cache.truncate(std.testing.io, 1);
    const validators = try fixture.cached_state.state.validators();
    var indices = [_]u64{ 0, 1, 2 };
    const set = try getAttestationWithIndicesSignatureSet(allocator, std.testing.io, fixture.config, fixture.cached_state.epoch_cache, validators, &types.phase0.AttestationData.default_value, @splat(0), &indices);
    defer allocator.free(set.pubkeys);
    for (set.pubkeys, indices) |pubkey, index| {
        const expected = try statePubkeyBytes(validators, index);
        const actual = pubkey.compress();
        try std.testing.expectEqualSlices(u8, &expected, &actual);
    }
    try std.testing.expectEqual(@as(u32, 1), fixture.pubkey_cache.count(std.testing.io));
    indices[2] = 64;
    try std.testing.expectError(error.PubkeyNotFound, getAttestationWithIndicesSignatureSet(allocator, std.testing.io, fixture.config, fixture.cached_state.epoch_cache, validators, &types.phase0.AttestationData.default_value, @splat(0), &indices));
}
