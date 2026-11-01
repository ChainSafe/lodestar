const std = @import("std");
const keys = @import("../wire/keys.zig");
const signed_key = @import("../wire/signed_key.zig");
const c = @import("quiche_zig:quiche");

pub const extension_oid = "1.3.6.1.4.1.53594.1.1";
pub const der_length_max = 1_024;

const not_before_offset_s: i64 = -3_600;
const not_after_offset_s: i64 = 100 * 365 * 24 * 3_600;

pub const Error = error{ OpenSslFailed, SignFailed, EncodeFailed } || signed_key.Error ||
    keys.Error;

pub const Certificate = struct {
    key: *c.EVP_PKEY,
    x509: *c.X509,

    pub fn create(host: *const keys.KeyPair, now_unix: i64, serial: [8]u8) Error!Certificate {
        const host_key = host.publicKey();
        const key = try generateP256();
        errdefer c.EVP_PKEY_free(key);

        const x509 = c.X509_new() orelse return error.OpenSslFailed;
        errdefer c.X509_free(x509);

        if (c.X509_set_version(x509, c.X509_VERSION_3) != 1) return error.OpenSslFailed;
        try setSerial(x509, serial);
        if (c.X509_set_pubkey(x509, key) != 1) return error.OpenSslFailed;
        try setEmptyNames(x509);
        try setValidity(x509, now_unix);
        try addExtension(x509, key, &host_key, host);
        if (c.X509_sign(x509, key, c.EVP_sha256()) <= 0) return error.SignFailed;
        return .{ .key = key, .x509 = x509 };
    }

    pub fn deinit(self: *Certificate) void {
        c.X509_free(self.x509);
        c.EVP_PKEY_free(self.key);
        self.* = undefined;
    }

    pub fn der(self: *const Certificate, out: []u8) Error![]u8 {
        return encodeDer(self.x509, out);
    }
};

fn encodeDer(x509: *c.X509, out: []u8) Error![]u8 {
    const length = c.i2d_X509(x509, null);
    if (length <= 0 or length > out.len) return error.EncodeFailed;
    var cursor: [*c]u8 = out.ptr;
    if (c.i2d_X509(x509, &cursor) != length) return error.EncodeFailed;
    return out[0..@intCast(length)];
}

pub fn spkiDer(key: *c.EVP_PKEY, out: *[signed_key.spki_length_max]u8) Error![]const u8 {
    const length = c.i2d_PUBKEY(key, null);
    if (length <= 0 or length > out.len) return error.EncodeFailed;
    var cursor: [*c]u8 = out;
    if (c.i2d_PUBKEY(key, &cursor) != length) return error.EncodeFailed;
    return out[0..@intCast(length)];
}

fn generateP256() Error!*c.EVP_PKEY {
    const ec = c.EC_KEY_new_by_curve_name(c.NID_X9_62_prime256v1) orelse return error.OpenSslFailed;
    errdefer c.EC_KEY_free(ec);
    if (c.EC_KEY_generate_key(ec) != 1) return error.OpenSslFailed;

    const key = c.EVP_PKEY_new() orelse return error.OpenSslFailed;
    errdefer c.EVP_PKEY_free(key);
    if (c.EVP_PKEY_assign_EC_KEY(key, ec) != 1) return error.OpenSslFailed;
    return key;
}

fn setSerial(x509: *c.X509, serial: [8]u8) Error!void {
    var value = std.mem.readInt(u64, &serial, .big);
    if (value == 0) value = 1;
    const integer = c.ASN1_INTEGER_new() orelse return error.OpenSslFailed;
    defer c.ASN1_INTEGER_free(integer);
    if (c.ASN1_INTEGER_set_uint64(integer, value) != 1) return error.OpenSslFailed;
    if (c.X509_set_serialNumber(x509, integer) != 1) return error.OpenSslFailed;
}

fn setEmptyNames(x509: *c.X509) Error!void {
    const name = c.X509_NAME_new() orelse return error.OpenSslFailed;
    defer c.X509_NAME_free(name);
    if (c.X509_set_issuer_name(x509, name) != 1) return error.OpenSslFailed;
    if (c.X509_set_subject_name(x509, name) != 1) return error.OpenSslFailed;
}

fn setValidity(x509: *c.X509, now_unix: i64) Error!void {
    const not_before = c.ASN1_TIME_set(null, @intCast(now_unix + not_before_offset_s)) orelse
        return error.OpenSslFailed;
    defer c.ASN1_TIME_free(not_before);
    const not_after = c.ASN1_TIME_set(null, @intCast(now_unix + not_after_offset_s)) orelse
        return error.OpenSslFailed;
    defer c.ASN1_TIME_free(not_after);
    if (c.X509_set1_notBefore(x509, not_before) != 1) return error.OpenSslFailed;
    if (c.X509_set1_notAfter(x509, not_after) != 1) return error.OpenSslFailed;
}

fn addExtension(
    x509: *c.X509,
    key: *c.EVP_PKEY,
    host_key: *const keys.PublicKey,
    signer: *const keys.KeyPair,
) Error!void {
    var spki: [signed_key.spki_length_max]u8 = undefined;
    const spki_der = try spkiDer(key, &spki);
    var message: [signed_key.message_length_max]u8 = undefined;
    const to_sign = try signed_key.message(spki_der, &message);
    var signature: [keys.signature_der_length_max]u8 = undefined;
    const signature_der = try signer.sign(to_sign, &signature);
    var value: [signed_key.der_length_max]u8 = undefined;
    const value_der = try signed_key.encode(host_key, signature_der, &value);

    const oid = c.OBJ_txt2obj(extension_oid, 1) orelse return error.OpenSslFailed;
    defer c.ASN1_OBJECT_free(oid);
    const octets = c.ASN1_OCTET_STRING_new() orelse return error.OpenSslFailed;
    defer c.ASN1_OCTET_STRING_free(octets);
    if (c.ASN1_OCTET_STRING_set(octets, value_der.ptr, @intCast(value_der.len)) != 1) {
        return error.OpenSslFailed;
    }
    const extension = c.X509_EXTENSION_create_by_OBJ(null, oid, 1, octets) orelse
        return error.OpenSslFailed;
    defer c.X509_EXTENSION_free(extension);
    if (c.X509_add_ext(x509, extension, -1) != 1) return error.OpenSslFailed;
}

test {
    _ = @import("cert_test.zig");
}
