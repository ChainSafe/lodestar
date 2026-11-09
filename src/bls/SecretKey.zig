//! BLS `SecretKey` for signing operations.
value: c.blst_scalar = c.blst_scalar{},

const Self = @This();

/// Size of serialized `SecretKey` in bytes.
pub const serialize_size = 32;

/// Generate a `SecretKey` using HKDF key derivation.
///
/// `SecretKey` on success, `BlstError` on failure.
pub fn keyGen(ikm: []const u8, key_info: ?[]const u8) BlstError!Self {
    if (ikm.len < 32) {
        return error.BadEncoding;
    }

    var sk = Self{};
    c.blst_keygen(
        &sk.value,
        &ikm[0],
        ikm.len,
        if (key_info) |info| info.ptr else null,
        if (key_info) |info| info.len else 0,
    );
    return sk;
}

/// Generate a `SecretKey` using HKDF key derivation (version 3).
///
/// Returns `SecretKey` on success, `BlstError` on failure
pub fn keyGenV3(ikm: []const u8, info: ?[]const u8) BlstError!Self {
    if (ikm.len < 32) {
        return error.BadEncoding;
    }

    var sk = Self{};
    c.blst_keygen_v3(
        &sk.value,
        &ikm[0],
        ikm.len,
        if (info) |i| i.ptr else null,
        if (info) |i| i.len else 0,
    );
    return sk;
}

/// Generate a `SecretKey` using HKDF key derivation (version 4.5).
///
/// `salt` must not be empty.
/// Returns `SecretKey` on success, `BlstError` on failure.
pub fn keyGenV45(ikm: []const u8, salt: []const u8, info: ?[]const u8) BlstError!Self {
    if (ikm.len < 32) {
        return error.BadEncoding;
    }
    if (salt.len == 0) {
        return error.BadEncoding;
    }

    var sk = Self{};
    c.blst_keygen_v4_5(
        &sk.value,
        &ikm[0],
        ikm.len,
        salt.ptr,
        salt.len,
        if (info) |i| i.ptr else null,
        if (info) |i| i.len else 0,
    );
    return sk;
}

/// Generate a `SecretKey` using HKDF key derivation (version 5).
///
/// `salt` must not be empty.
/// Returns `SecretKey` on success, `BlstError` on failure.
pub fn keyGenV5(ikm: []const u8, salt: []const u8, info: ?[]const u8) BlstError!Self {
    if (ikm.len < 32) {
        return error.BadEncoding;
    }
    if (salt.len == 0) {
        return error.BadEncoding;
    }

    var sk = Self{};
    c.blst_keygen_v5(
        &sk.value,
        &ikm[0],
        ikm.len,
        salt.ptr,
        salt.len,
        if (info) |i| i.ptr else null,
        if (info) |i| i.len else 0,
    );
    return sk;
}

/// Derive a master `SecretKey` using EIP-2333 key derivation.
///
///   Returns the `SecretKey` on success, `BlstError` on failure.
pub fn deriveMasterEip2333(ikm: []const u8) BlstError!Self {
    if (ikm.len < 32) {
        return error.BadEncoding;
    }

    var sk = Self{};
    c.blst_derive_master_eip2333(&sk.value, ikm.ptr, ikm.len);
    return sk;
}

/// Derive and return a child `SecretKey` using EIP-2333 key derivation.
pub fn deriveChildEip2333(self: *const Self, child_index: u32) BlstError!Self {
    var sk = Self{};
    c.blst_derive_child_eip2333(&sk.value, &self.value, child_index);
    return sk;
}

/// Derive the `PublicKey` from this `SecretKey`.
pub fn toPublicKey(self: *const Self) PublicKey {
    var pk = PublicKey{};
    c.blst_sk_to_pk2_in_g1(null, @ptrCast(&pk.point), &self.value);
    return pk;
}

/// Sign a message with this `SecretKey`. Returns the `Signature` for the message.
pub fn sign(self: *const Self, msg: *const SigningRoot, dst: []const u8, aug: ?[]const u8) Signature {
    var sig = Signature{};
    var q = @import("AggregateSignature.zig"){};
    c.blst_hash_to_g2(
        @ptrCast(&q.point),
        msg,
        @sizeOf(SigningRoot),
        dst.ptr,
        dst.len,
        if (aug) |a| a.ptr else null,
        if (aug) |a| a.len else 0,
    );
    c.blst_sign_pk2_in_g1(null, &sig.point, &q.point, &self.value);
    return sig;
}

/// Serialize the `SecretKey` to bytes.
pub fn serialize(self: *const Self) [32]u8 {
    var sk_out = [_]u8{0} ** 32;
    c.blst_bendian_from_scalar(&sk_out[0], &self.value);
    return sk_out;
}

/// Deserialize a `SecretKey` from bytes.
///
/// Returns `SecretKey` on success, `BlstError` on failure.
pub fn deserialize(sk_in: *const [32]u8) BlstError!Self {
    var sk = Self{};
    c.blst_scalar_from_bendian(&sk.value, sk_in);
    if (!c.blst_sk_check(&sk.value)) {
        return error.BadEncoding;
    }
    return sk;
}

const std = @import("std");
const BlstError = @import("error.zig").BlstError;
const check = @import("error.zig").check;
const blst = @import("root.zig");
const PublicKey = blst.PublicKey;
const Signature = blst.Signature;
const SigningRoot = blst.SigningRoot;

const c = @import("root.zig").c;

test "key generation rejects an empty salt" {
    const ikm = [_]u8{0x42} ** 32;
    const salt: []const u8 = &.{};

    try std.testing.expectError(error.BadEncoding, keyGenV45(&ikm, salt, null));
    try std.testing.expectError(error.BadEncoding, keyGenV5(&ikm, salt, null));
}
