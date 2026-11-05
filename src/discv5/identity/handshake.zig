//! The v4 handshake derives session keys with HKDF and proves the static key with a signature
//! bound to one challenge, following the discv5 theory spec.

const std = @import("std");
const crypto = @import("crypto.zig");
const types = @import("../types.zig");
const constants = @import("../wire/constants.zig");

const HmacSha256 = std.crypto.auth.hmac.sha2.HmacSha256;
const Sha256 = std.crypto.hash.sha2.Sha256;
const agreement_label = "discovery v5 key agreement";
const proof_label = "discovery v5 identity proof";

pub const Error = crypto.Error;

pub const Keys = struct {
    initiator: [16]u8,
    recipient: [16]u8,
};

/// Runs HKDF-SHA256 with the challenge data as salt and both node IDs as info. The `initiator`
/// key belongs to whichever side answered the WHOAREYOU.
pub fn deriveKeys(
    private_key: *const crypto.KeyPair,
    public_key: *const [33]u8,
    initiator_id: *const types.NodeId,
    recipient_id: *const types.NodeId,
    challenge_data: *const [constants.whoareyou_packet_size]u8,
) Error!Keys {
    var shared_secret = try crypto.ecdh(public_key, private_key);
    defer std.crypto.secureZero(u8, &shared_secret);
    var pseudo_random_key: [32]u8 = undefined;
    defer std.crypto.secureZero(u8, &pseudo_random_key);
    HmacSha256.create(&pseudo_random_key, &shared_secret, challenge_data);

    var info: [agreement_label.len + 64 + 1]u8 = undefined;
    @memcpy(info[0..agreement_label.len], agreement_label);
    @memcpy(info[agreement_label.len..][0..32], initiator_id);
    @memcpy(info[agreement_label.len + 32 ..][0..32], recipient_id);
    info[info.len - 1] = 1;
    var expanded: [32]u8 = undefined;
    defer std.crypto.secureZero(u8, &expanded);
    HmacSha256.create(&expanded, &info, &pseudo_random_key);
    return .{
        .initiator = expanded[0..16].*,
        .recipient = expanded[16..32].*,
    };
}

/// Signs the challenge, the ephemeral key, and the recipient ID together, so a proof cannot be
/// replayed to another node or reused for another challenge.
pub fn signProof(
    static_key: *const crypto.KeyPair,
    challenge_data: *const [constants.whoareyou_packet_size]u8,
    ephemeral_public_key: *const [33]u8,
    recipient_id: *const types.NodeId,
) Error![64]u8 {
    const digest = proofDigest(challenge_data, ephemeral_public_key, recipient_id);
    return crypto.sign(&digest, static_key);
}

pub fn verifyProof(
    signature: *const [64]u8,
    static_public_key: *const [33]u8,
    challenge_data: *const [constants.whoareyou_packet_size]u8,
    ephemeral_public_key: *const [33]u8,
    recipient_id: *const types.NodeId,
) Error!void {
    const digest = proofDigest(challenge_data, ephemeral_public_key, recipient_id);
    return crypto.verify(&digest, signature, static_public_key);
}

fn proofDigest(
    challenge_data: *const [constants.whoareyou_packet_size]u8,
    ephemeral_public_key: *const [33]u8,
    recipient_id: *const types.NodeId,
) [32]u8 {
    var input: [proof_label.len + constants.whoareyou_packet_size + 33 + 32]u8 = undefined;
    @memcpy(input[0..proof_label.len], proof_label);
    @memcpy(input[proof_label.len..][0..challenge_data.len], challenge_data);
    const public_key_start = proof_label.len + challenge_data.len;
    @memcpy(input[public_key_start..][0..33], ephemeral_public_key);
    @memcpy(input[public_key_start + 33 ..], recipient_id);
    var digest: [32]u8 = undefined;
    Sha256.hash(&input, &digest, .{});
    return digest;
}

comptime {
    std.debug.assert(agreement_label.len == 26);
    std.debug.assert(proof_label.len == 27);
    std.debug.assert(@sizeOf(Keys) == 32);
}

test {
    _ = @import("handshake_test.zig");
}
