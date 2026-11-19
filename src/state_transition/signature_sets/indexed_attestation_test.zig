const std = @import("std");
const bls = @import("bls");
const types = @import("consensus_types");
const Node = @import("persistent_merkle_tree").Node;
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const addValidatorToRegistry = @import("../block/process_deposit.zig").addValidatorToRegistry;
const getIndexedAttestationSignatureSet = @import("indexed_attestation.zig").getIndexedAttestationSignatureSet;
const getAttestationDataSigningRoot = @import("indexed_attestation.zig").getAttestationDataSigningRoot;

test "indexed attestation resolves cached and state-local pubkeys in input order" {
    const allocator = std.testing.allocator;
    const io = std.testing.io;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 200_000 });
    defer pool.deinit();
    var fixture = try TestCachedBeaconState.init(allocator, &pool, 128);
    defer fixture.deinit();
    const state = fixture.cached_state.state;
    const cache = fixture.cached_state.epoch_cache;
    const secret_key = try bls.SecretKey.keyGen(&([_]u8{42} ** 32), null);
    const local_pubkey = secret_key.toPublicKey().compress();
    try addValidatorToRegistry(.electra, cache, state.castToFork(.electra), &local_pubkey, &([_]u8{1} ** 32), 0);
    try state.commit();

    const cases = [_][]const u64{ &.{ 0, 1 }, &.{ 0, 128 }, &.{128}, &.{ 128, 0 }, &.{} };
    for (cases) |indices| {
        errdefer std.debug.print("attesting indices: {any}\n", .{indices});
        var attestation = types.electra.IndexedAttestation.default_value;
        defer types.electra.IndexedAttestation.deinit(allocator, &attestation);
        for (indices) |index| try attestation.attesting_indices.append(allocator, index);
        const signature_set = try getIndexedAttestationSignatureSet(.electra, allocator, io, fixture.config, cache, state, &attestation);
        defer allocator.free(signature_set.pubkeys);
        try std.testing.expectEqual(indices.len, signature_set.pubkeys.len);
        var validators = try state.validators();
        for (indices, signature_set.pubkeys) |index, pubkey| {
            errdefer std.debug.print("validator index: {d}\n", .{index});
            var validator = try validators.getReadonly(index);
            const expected = try validator.get("pubkey");
            try std.testing.expectEqualSlices(u8, &expected, &pubkey.compress());
        }
        var expected_root: [32]u8 = undefined;
        try getAttestationDataSigningRoot(fixture.config, cache.epoch, &attestation.data, &expected_root);
        try std.testing.expectEqualSlices(u8, &expected_root, &signature_set.signing_root);
        try std.testing.expectEqualSlices(u8, &attestation.signature, &signature_set.signature);
        try std.testing.expectEqual(@as(u32, 128), fixture.pubkey_cache.count(io));
    }

    var invalid = types.electra.IndexedAttestation.default_value;
    defer types.electra.IndexedAttestation.deinit(allocator, &invalid);
    try invalid.attesting_indices.append(allocator, 0);
    try invalid.attesting_indices.append(allocator, 129);
    try std.testing.expectError(error.PubkeyNotFound, getIndexedAttestationSignatureSet(.electra, allocator, io, fixture.config, cache, state, &invalid));
}
