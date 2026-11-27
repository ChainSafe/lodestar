const std = @import("std");
const keys = @import("keys.zig");

const generator_compressed = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

fn secretOne() [keys.secret_key_length]u8 {
    return [_]u8{0} ** 31 ++ [_]u8{1};
}

test "public key of secret key one is the generator" {
    const pair = try keys.KeyPair.fromSecretKey(&secretOne());
    var expected: [keys.public_key_length]u8 = undefined;
    _ = try std.fmt.hexToBytes(&expected, generator_compressed);
    try std.testing.expectEqualSlices(u8, &expected, &pair.publicKey().bytes);
}

test "protobuf public key uses the fixed secp256k1 prefix" {
    const pair = try keys.KeyPair.fromSecretKey(&secretOne());
    const encoded = pair.publicKey().encodeProtobuf();
    try std.testing.expectEqualSlices(u8, &.{ 0x08, 0x02, 0x12, 0x21 }, encoded[0..4]);
    const decoded = try keys.PublicKey.decodeProtobuf(&encoded);
    try std.testing.expectEqualSlices(u8, &pair.publicKey().bytes, &decoded.bytes);
    try std.testing.expectError(error.InvalidProtobuf, keys.PublicKey.decodeProtobuf(encoded[0..36]));
    var wrong_type = encoded;
    wrong_type[1] = 0x01;
    try std.testing.expectError(error.InvalidProtobuf, keys.PublicKey.decodeProtobuf(&wrong_type));
    var not_a_point = encoded;
    not_a_point[4] = 0x05;
    try std.testing.expectError(error.InvalidPublicKey, keys.PublicKey.decodeProtobuf(&not_a_point));
}

test "signatures are DER, low-S, and verify" {
    const pair = try keys.KeyPair.fromSecretKey(&secretOne());
    const message = "libp2p-tls-handshake:test";
    var buffer: [keys.signature_der_length_max]u8 = undefined;
    const signature = try pair.sign(message, &buffer);
    try std.testing.expectEqual(@as(u8, 0x30), signature[0]);
    try pair.publicKey().verify(message, signature);
    try std.testing.expectError(error.SignatureVerificationFailed, pair.publicKey().verify("other", signature));

    const Ecdsa = std.crypto.sign.ecdsa.EcdsaSecp256k1Sha256;
    const parsed = try Ecdsa.Signature.fromDer(signature);
    const order: u256 = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
    try std.testing.expect(std.mem.readInt(u256, &parsed.s, .big) <= order / 2);

    const high_s = Ecdsa.Signature{ .r = parsed.r, .s = try std.crypto.ecc.Secp256k1.scalar.neg(parsed.s, .big) };
    var high_buffer: [keys.signature_der_length_max]u8 = undefined;
    try pair.publicKey().verify(message, high_s.toDer(&high_buffer));
}

test "malformed signatures and keys are rejected" {
    const pair = try keys.KeyPair.fromSecretKey(&secretOne());
    try std.testing.expectError(error.InvalidSignature, pair.publicKey().verify("m", &.{ 0x30, 0x00 }));
    try std.testing.expectError(error.InvalidSecretKey, keys.KeyPair.fromSecretKey(&([_]u8{0} ** 32)));
    try std.testing.expectError(error.InvalidPublicKey, keys.PublicKey.fromBytes(&([_]u8{0x02} ++ [_]u8{0xff} ** 32)));
}
