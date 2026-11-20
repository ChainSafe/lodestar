//! secp256k1 primitives for the v4 identity scheme. Signing is deterministic per RFC 6979 and
//! produces reproducible low-S signatures without the high-S malleable counterpart.

const std = @import("std");

const Secp256k1 = std.crypto.ecc.Secp256k1;
const Ecdsa = std.crypto.sign.ecdsa.EcdsaSecp256k1Sha256;
const HmacSha256 = std.crypto.auth.hmac.sha2.HmacSha256;
const Scalar = Secp256k1.scalar.Scalar;
const scalar_order = Secp256k1.scalar.field_order;
const half_scalar_order = scalar_order / 2;
const rfc6979_candidates_max: usize = 16;

pub const Error = error{
    EcdhFailed,
    InvalidPublicKey,
    InvalidSecretKey,
    InvalidSignature,
    SigningFailed,
};

pub const KeyPair = Ecdsa.KeyPair;
pub const PublicKey = Ecdsa.PublicKey;

pub fn keyPairFromSecret(secret: *const [32]u8) Error!KeyPair {
    var secret_key = Ecdsa.SecretKey.fromBytes(secret.*) catch
        return error.InvalidSecretKey;
    defer std.crypto.secureZero(u8, std.mem.asBytes(&secret_key));
    return KeyPair.fromSecretKey(secret_key) catch return error.InvalidSecretKey;
}

pub fn compressedPublicKey(key_pair: *const KeyPair) [33]u8 {
    return key_pair.public_key.toCompressedSec1();
}

pub fn uncompressedPublicKey(compressed: *const [33]u8) Error![65]u8 {
    const public_key = Ecdsa.PublicKey.fromSec1(compressed) catch
        return error.InvalidPublicKey;
    return public_key.toUncompressedSec1();
}

pub fn ecdh(public_key: *const [33]u8, key_pair: *const KeyPair) Error![33]u8 {
    const peer = Secp256k1.fromSec1(public_key) catch return error.InvalidPublicKey;
    var secret = key_pair.secret_key.toBytes();
    defer std.crypto.secureZero(u8, &secret);
    var shared = peer.mul(secret, .big) catch return error.EcdhFailed;
    defer std.crypto.secureZero(u8, std.mem.asBytes(&shared));
    return shared.toCompressedSec1();
}

pub fn sign(digest: *const [32]u8, key_pair: *const KeyPair) Error![64]u8 {
    var secret_bytes = key_pair.secret_key.toBytes();
    defer std.crypto.secureZero(u8, &secret_bytes);
    var generator = Rfc6979.init(secret_bytes, digest.*);
    defer std.crypto.secureZero(u8, std.mem.asBytes(&generator));
    var secret = Scalar.fromBytes(secret_bytes, .big) catch
        return error.SigningFailed;
    defer std.crypto.secureZero(u8, std.mem.asBytes(&secret));
    const z = scalarFromDigest(digest.*);

    var attempts: usize = 0;
    while (attempts < rfc6979_candidates_max) : (attempts += 1) {
        var nonce = generator.next() orelse continue;
        defer std.crypto.secureZero(u8, std.mem.asBytes(&nonce));
        const point = Secp256k1.basePoint.mul(nonce.toBytes(.big), .big) catch {
            generator.reject();
            continue;
        };
        const r = scalarFromDigest(point.affineCoordinates().x.toBytes(.big));
        if (r.isZero()) {
            generator.reject();
            continue;
        }
        const s = nonce.invert().mul(z.add(r.mul(secret)));
        if (s.isZero()) {
            generator.reject();
            continue;
        }
        return r.toBytes(.big) ++ canonicalLowS(s.toBytes(.big));
    }
    return error.SigningFailed;
}

/// Rejects high-S signatures, since a third party could otherwise re-encode a valid one.
pub fn verify(
    digest: *const [32]u8,
    signature: *const [64]u8,
    public_key: *const [33]u8,
) Error!void {
    _ = try verifyAndDecode(digest, signature, public_key);
}

/// Returns the authenticated public point so identity derivation need not decode it again.
pub fn verifyAndDecode(digest: *const [32]u8, signature: *const [64]u8, public_key: *const [33]u8) Error!PublicKey {
    const s = std.mem.readInt(u256, signature[32..64], .big);
    if (s == 0 or s > half_scalar_order) return error.InvalidSignature;
    const key = PublicKey.fromSec1(public_key) catch return error.InvalidPublicKey;
    const parsed = Ecdsa.Signature.fromBytes(signature.*);
    parsed.verifyPrehashed(digest.*, key) catch return error.InvalidSignature;
    return key;
}

const Rfc6979 = struct {
    key: [32]u8,
    value: [32]u8,

    fn init(secret: [32]u8, digest: [32]u8) Rfc6979 {
        var result = Rfc6979{
            .key = [_]u8{0} ** 32,
            .value = [_]u8{1} ** 32,
        };
        const digest_octets = scalarFromDigest(digest).toBytes(.big);
        var seed: [97]u8 = undefined;
        defer std.crypto.secureZero(u8, &seed);
        seed[0..32].* = result.value;
        seed[32] = 0;
        seed[33..65].* = secret;
        seed[65..97].* = digest_octets;
        HmacSha256.create(&result.key, &seed, &result.key);
        HmacSha256.create(&result.value, &result.value, &result.key);
        seed[0..32].* = result.value;
        seed[32] = 1;
        HmacSha256.create(&result.key, &seed, &result.key);
        HmacSha256.create(&result.value, &result.value, &result.key);
        return result;
    }

    fn next(self: *Rfc6979) ?Scalar {
        HmacSha256.create(&self.value, &self.value, &self.key);
        const scalar = Scalar.fromBytes(self.value, .big) catch {
            self.reject();
            return null;
        };
        if (scalar.isZero()) {
            self.reject();
            return null;
        }
        return scalar;
    }

    fn reject(self: *Rfc6979) void {
        var input: [33]u8 = undefined;
        defer std.crypto.secureZero(u8, &input);
        input[0..32].* = self.value;
        input[32] = 0;
        HmacSha256.create(&self.key, &input, &self.key);
        HmacSha256.create(&self.value, &self.value, &self.key);
    }
};

fn scalarFromDigest(bytes: [32]u8) Scalar {
    const value = std.mem.readInt(u256, &bytes, .big) % scalar_order;
    var reduced: [32]u8 = undefined;
    std.mem.writeInt(u256, &reduced, value, .big);
    return Scalar.fromBytes(reduced, .big) catch unreachable;
}

pub fn canonicalLowS(encoded: [32]u8) [32]u8 {
    const value = std.mem.readInt(u256, &encoded, .big);
    std.debug.assert(value > 0 and value < scalar_order);
    if (value <= half_scalar_order) return encoded;
    var low: [32]u8 = undefined;
    std.mem.writeInt(u256, &low, scalar_order - value, .big);
    return low;
}

comptime {
    std.debug.assert(rfc6979_candidates_max <= 1_024);
    std.debug.assert(@sizeOf(KeyPair) <= 256);
}
