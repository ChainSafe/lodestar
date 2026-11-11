//! Helpers of the PQ fork: leanXMSS leaves and verification, VRF proofs, and
//! the attestation proof.

const std = @import("std");
const Allocator = std.mem.Allocator;
const c = @import("constants");
const leanvm = @import("leanvm");
const Sha256 = std.crypto.hash.sha2.Sha256;

pub const XmssPubkey = [c.XMSS_PUBKEY_SIZE]u8;
pub const XmssSignature = [c.XMSS_SIGNATURE_SIZE]u8;
pub const VrfProof = [c.VRF_TREE_DEPTH + 1][32]u8;
pub const Claim = leanvm.xmss.Claim;

pub fn computeXmssAttestationLeafIndex(epoch: u64) u64 {
    return c.XMSS_RESERVED_LEAVES +| epoch;
}

pub fn computeXmssLeafIndex(slot: u64, leaf_offset: u64) u64 {
    std.debug.assert(leaf_offset < c.XMSS_LEAVES_PER_SLOT);
    return c.XMSS_RESERVED_LEAVES + c.XMSS_ATTESTATION_LEAVES +| slot *| c.XMSS_LEAVES_PER_SLOT +| leaf_offset;
}

/// The leaf a signature says it was made at. `xmssVerify` proves it.
pub fn signatureLeafIndex(signature: *const XmssSignature) u32 {
    return std.mem.readInt(u32, signature[0..4], .little);
}

/// True only if `signature` is `pubkey`'s over `message` at `leaf_index`.
pub fn xmssVerify(
    pubkey: *const XmssPubkey,
    leaf_index: u64,
    message: *const [32]u8,
    signature: *const XmssSignature,
) error{Unavailable}!bool {
    if (signatureLeafIndex(signature) != leaf_index) return false;
    leanvm.xmss.verify(pubkey, message, signature) catch |err| switch (err) {
        error.Unavailable => return error.Unavailable,
        else => return false,
    };
    return true;
}

/// A request made before the fork names a compressed BLS public key, whose
/// first byte has its top bit set.
pub fn isLegacyPubkey(pubkey: *const [48]u8) bool {
    return !std.mem.eql(u8, pubkey[0..16], &c.XMSS_DEPOSIT_PREFIX);
}

/// How a deposit or an execution request names an XMSS public key.
pub fn requestPubkey(pubkey: *const XmssPubkey) [48]u8 {
    return c.XMSS_DEPOSIT_PREFIX ++ pubkey.*;
}

pub fn computeDepositPubkey(pubkey: *const [48]u8) XmssPubkey {
    if (isLegacyPubkey(pubkey)) return legacyDigest(pubkey, c.LEGACY_XMSS_PUBKEY_DOMAIN);
    return pubkey[16..48].*;
}

pub fn computeDepositVrfRoot(pubkey: *const [48]u8, signature: *const [96]u8) [32]u8 {
    if (isLegacyPubkey(pubkey)) return legacyDigest(pubkey, c.LEGACY_VRF_ROOT_DOMAIN);
    return signature[0..32].*;
}

fn legacyDigest(pubkey: *const [48]u8, domain: u8) [32]u8 {
    var out: [32]u8 = undefined;
    Sha256.hash(&(pubkey.* ++ [1]u8{domain}), &out, .{});
    return out;
}

/// Checks that `proof` opens the leaf for `slot` under `vrf_root`.
pub fn isValidVrfProof(vrf_root: *const [32]u8, slot: u64, proof: *const VrfProof) bool {
    var value = proof[0];
    for (proof[1..], 0..) |*sibling, depth| {
        const pair = if ((slot >> @intCast(depth)) & 1 == 1) sibling.* ++ value else value ++ sibling.*;
        Sha256.hash(&pair, &value, .{});
    }
    return std.mem.eql(u8, &value, vrf_root);
}

/// Checks that `proof` proves a signature for every claim. Sorts `claims` and
/// drops duplicates: a leanVM proof is of a set of claims, at leaves it does
/// not record.
pub fn verifyAttestationProof(claims: []Claim, proof: []const u8) error{Unavailable}!bool {
    std.mem.sortUnstable(Claim, claims, {}, Claim.lessThan);
    var len: usize = 0;
    for (claims) |claim| {
        if (len > 0 and std.mem.eql(u8, std.mem.asBytes(&claims[len - 1]), std.mem.asBytes(&claim))) continue;
        claims[len] = claim;
        len += 1;
    }
    if (len == 0) return proof.len == 0;

    const decoded = leanvm.Proof.fromBytes(proof, claims[0..len]) catch |err| switch (err) {
        error.Unavailable => return error.Unavailable,
        else => return false,
    };
    defer decoded.deinit();
    decoded.verify() catch |err| switch (err) {
        error.Unavailable => return error.Unavailable,
        else => return false,
    };
    return true;
}

test {
    _ = @import("pq_test.zig");
}
