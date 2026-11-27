const std = @import("std");
const crypto = @import("crypto.zig");
const handshake = @import("handshake.zig");

test "official ECDH and handshake key derivation vectors" {
    const secret = hexBytes(
        32,
        "fb757dc581730490a1d7a00deea65e9b1936924caaea8f44d476014856b68736",
    );
    const key_pair = try crypto.keyPairFromSecret(&secret);
    const public_key = hexBytes(
        33,
        "039961e4c2356d61bedb83052c115d311acb3a96f5777296dcf297351130266231",
    );
    const expected_shared = hexBytes(
        33,
        "033b11a2a1f214567e1537ce5e509ffd9b21373247f2a3ff6841f4976f53165e7e",
    );
    try std.testing.expectEqual(expected_shared, try crypto.ecdh(&public_key, &key_pair));

    const recipient_key = hexBytes(
        33,
        "0317931e6e0840220642f230037d285d122bc59063221ef3226b1f403ddc69ca91",
    );
    const initiator_id = hexBytes(
        32,
        "aaaa8419e9f49d0083561b48287df592939a8d19947d8c0ef88f2a4856a69fbb",
    );
    const recipient_id = hexBytes(
        32,
        "bbbb9d047f0488c0b5a93c1c3f2d8bafc7c8ff337024a55434a0d0555de64db9",
    );
    const challenge = hexBytes(
        63,
        "000000000000000000000000000000006469736376350001010102030405060708" ++
            "090a0b0c00180102030405060708090a0b0c0d0e0f100000000000000000",
    );
    const keys = try handshake.deriveKeys(
        &key_pair,
        &recipient_key,
        &initiator_id,
        &recipient_id,
        &challenge,
    );
    const expected_initiator = hexBytes(16, "dccc82d81bd610f4f76d3ebe97a40571");
    const expected_recipient = hexBytes(16, "ac74bb8773749920b0d3a8881c173ec5");
    try std.testing.expectEqual(expected_initiator, keys.initiator);
    try std.testing.expectEqual(expected_recipient, keys.recipient);
}

test "official identity proof signature vector" {
    const secret = hexBytes(
        32,
        "fb757dc581730490a1d7a00deea65e9b1936924caaea8f44d476014856b68736",
    );
    const key_pair = try crypto.keyPairFromSecret(&secret);
    const public_key = crypto.compressedPublicKey(&key_pair);
    const challenge = hexBytes(
        63,
        "000000000000000000000000000000006469736376350001010102030405060708" ++
            "090a0b0c00180102030405060708090a0b0c0d0e0f100000000000000000",
    );
    const ephemeral_key = hexBytes(
        33,
        "039961e4c2356d61bedb83052c115d311acb3a96f5777296dcf297351130266231",
    );
    const recipient_id = hexBytes(
        32,
        "bbbb9d047f0488c0b5a93c1c3f2d8bafc7c8ff337024a55434a0d0555de64db9",
    );
    const expected = hexBytes(
        64,
        "94852a1e2318c4e5e9d422c98eaf19d1d90d876b29cd06ca7cb7546d0fff7b48" ++
            "4fe86c09a064fe72bdbef73ba8e9c34df0cd2b53e9d65528c2c7f336d5dfc6e6",
    );
    const signature = try handshake.signProof(
        &key_pair,
        &challenge,
        &ephemeral_key,
        &recipient_id,
    );
    try std.testing.expectEqual(expected, signature);
    try handshake.verifyProof(
        &signature,
        &public_key,
        &challenge,
        &ephemeral_key,
        &recipient_id,
    );
    try expectRejectsMalleable(&signature, &public_key, &challenge, &ephemeral_key, &recipient_id);

    var invalid = signature;
    invalid[0] ^= 1;
    try std.testing.expectError(
        error.InvalidSignature,
        handshake.verifyProof(
            &invalid,
            &public_key,
            &challenge,
            &ephemeral_key,
            &recipient_id,
        ),
    );
}

fn expectRejectsMalleable(
    signature: *const [64]u8,
    public_key: *const [33]u8,
    challenge: *const [63]u8,
    ephemeral_key: *const [33]u8,
    recipient_id: *const [32]u8,
) !void {
    const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
    var malleable = signature.*;
    const s = std.mem.readInt(u256, malleable[32..64], .big);
    std.mem.writeInt(u256, malleable[32..64], order - s, .big);
    try std.testing.expectError(
        error.InvalidSignature,
        handshake.verifyProof(
            &malleable,
            public_key,
            challenge,
            ephemeral_key,
            recipient_id,
        ),
    );
}

fn hexBytes(comptime length: usize, comptime encoded: []const u8) [length]u8 {
    var result: [length]u8 = undefined;
    _ = std.fmt.hexToBytes(&result, encoded) catch unreachable;
    return result;
}
