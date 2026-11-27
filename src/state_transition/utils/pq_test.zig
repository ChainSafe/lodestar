const std = @import("std");
const c = @import("constants");
const pq = @import("pq.zig");
const Sha256 = std.crypto.hash.sha2.Sha256;

test "leaf ranges do not overlap" {
    try std.testing.expectEqual(c.XMSS_RESERVED_LEAVES, pq.computeXmssAttestationLeafIndex(0));
    const last_attestation = pq.computeXmssAttestationLeafIndex(c.XMSS_ATTESTATION_LEAVES - 1);
    try std.testing.expect(!pq.isBuilderBidLeafIndex(last_attestation));
    try std.testing.expect(pq.isBuilderBidLeafIndex(last_attestation + 1));
    const first_slot_leaf = pq.computeXmssLeafIndex(0, c.LEAF_OFFSET_BEACON_PROPOSER);
    try std.testing.expect(pq.isBuilderBidLeafIndex(first_slot_leaf - 1));
    try std.testing.expect(!pq.isBuilderBidLeafIndex(first_slot_leaf));
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

test "VRF proof reveals the secret that the leaf of its slot commits to" {
    const slot: u64 = 0b101;
    var proof: pq.VrfProof = undefined;
    for (&proof, 0..) |*node, i| node.* = @splat(@intCast(i));
    var leaf: [32]u8 = undefined;
    std.crypto.hash.sha3.Keccak256.hash("VRF_LEAF" ++ proof[0] ++ [8]u8{ 0b101, 0, 0, 0, 0, 0, 0, 0 }, &leaf, .{});
    var root = leaf;
    for (proof[1..], 0..) |sibling, depth| {
        const pair = if ((slot >> @intCast(depth)) & 1 == 1) sibling ++ root else root ++ sibling;
        std.crypto.hash.sha3.Keccak256.hash(&pair, &root, .{});
    }
    try std.testing.expect(pq.isValidVrfProof(&root, slot, &proof));
    try std.testing.expect(!pq.isValidVrfProof(&root, slot + 1, &proof));

    // The leaf in place of the secret does not open it
    var leaf_proof = proof;
    leaf_proof[0] = leaf;
    try std.testing.expect(!pq.isValidVrfProof(&root, slot, &leaf_proof));
}

test "an attestation proof of nothing is empty" {
    try std.testing.expect(try pq.verifyAttestationProof(&.{}, &.{}));
    try std.testing.expect(!try pq.verifyAttestationProof(&.{}, &.{0}));
}
