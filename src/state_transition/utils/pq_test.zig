const std = @import("std");
const c = @import("constants");
const pq = @import("pq.zig");
const Sha256 = std.crypto.hash.sha2.Sha256;

test "leaf ranges do not overlap" {
    try std.testing.expectEqual(c.XMSS_RESERVED_LEAVES, pq.computeXmssAttestationLeafIndex(0));
    const last_attestation = pq.computeXmssAttestationLeafIndex(c.XMSS_ATTESTATION_LEAVES - 1);
    try std.testing.expectEqual(last_attestation + 1, pq.computeXmssLeafIndex(0, c.LEAF_OFFSET_BEACON_PROPOSER));
    try std.testing.expectEqual(
        pq.computeXmssLeafIndex(0, c.XMSS_LEAVES_PER_SLOT - 1) + 1,
        pq.computeXmssLeafIndex(1, c.LEAF_OFFSET_BEACON_PROPOSER),
    );
}

test "deposit public keys" {
    const xmss_pubkey: pq.XmssPubkey = @splat(7);
    const named = pq.requestPubkey(&xmss_pubkey);
    try std.testing.expect(!pq.isLegacyPubkey(&named));
    try std.testing.expectEqualSlices(u8, &xmss_pubkey, &pq.computeDepositPubkey(&named));

    var bls_pubkey: [48]u8 = @splat(1);
    bls_pubkey[0] = 0x80;
    try std.testing.expect(pq.isLegacyPubkey(&bls_pubkey));
    var expected: [32]u8 = undefined;
    Sha256.hash(&(bls_pubkey ++ [1]u8{0}), &expected, .{});
    try std.testing.expectEqualSlices(u8, &expected, &pq.computeDepositPubkey(&bls_pubkey));
}

test "VRF proof opens the leaf of its slot" {
    const slot: u64 = 0b101;
    var proof: pq.VrfProof = undefined;
    for (&proof, 0..) |*node, i| node.* = @splat(@intCast(i));
    var root = proof[0];
    for (proof[1..], 0..) |sibling, depth| {
        const pair = if ((slot >> @intCast(depth)) & 1 == 1) sibling ++ root else root ++ sibling;
        Sha256.hash(&pair, &root, .{});
    }
    try std.testing.expect(pq.isValidVrfProof(&root, slot, &proof));
    try std.testing.expect(!pq.isValidVrfProof(&root, slot + 1, &proof));
}

test "an attestation proof of nothing is empty" {
    try std.testing.expect(try pq.verifyAttestationProof(&.{}, &.{}));
    try std.testing.expect(!try pq.verifyAttestationProof(&.{}, &.{0}));
}
