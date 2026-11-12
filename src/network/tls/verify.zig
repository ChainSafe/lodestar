const cert = @import("cert.zig");
const peer_id = @import("../wire/peer_id.zig");
const signed_key = @import("../wire/signed_key.zig");
const c = @import("quiche_zig:quiche");

pub const Error = error{
    CertificateMalformed,
    CertificateNotYetValid,
    CertificateExpired,
    SelfSignatureInvalid,
    UnknownCriticalExtension,
    ExtensionMissing,
    ExtensionMalformed,
    UnsupportedKeyType,
    HostSignatureInvalid,
    OpenSslFailed,
};

pub fn verifyDer(der: []const u8, now_unix: i64) Error!peer_id.PeerId {
    if (der.len == 0) return error.CertificateMalformed;
    var cursor: [*c]const u8 = der.ptr;
    const x509 = c.d2i_X509(null, &cursor, @intCast(der.len)) orelse
        return error.CertificateMalformed;
    defer c.X509_free(x509);
    if (@intFromPtr(cursor) != @intFromPtr(der.ptr) + der.len) return error.CertificateMalformed;
    return verifyX509(x509, now_unix);
}

fn verifyX509(x509: *c.X509, now_unix: i64) Error!peer_id.PeerId {
    try checkValidity(x509, now_unix);

    const key = c.X509_get_pubkey(x509) orelse return error.CertificateMalformed;
    defer c.EVP_PKEY_free(key);
    if (c.X509_verify(x509, key) != 1) return error.SelfSignatureInvalid;

    try checkCriticalExtensions(x509);
    const signed = try extensionValue(x509);

    var spki: [signed_key.spki_length_max]u8 = undefined;
    const spki_der = cert.spkiDer(key, &spki) catch return error.UnsupportedKeyType;
    var message: [signed_key.message_length_max]u8 = undefined;
    const to_verify = signed_key.message(spki_der, &message) catch
        return error.CertificateMalformed;
    signed.public_key.verify(to_verify, signed.signature) catch return error.HostSignatureInvalid;
    return peer_id.PeerId.fromPublicKey(&signed.public_key);
}

fn checkValidity(x509: *c.X509, now_unix: i64) Error!void {
    var now: c.time_t = @intCast(now_unix);
    const not_before = c.X509_cmp_time(c.X509_get0_notBefore(x509), &now);
    if (not_before == 0) return error.CertificateMalformed;
    if (not_before > 0) return error.CertificateNotYetValid;
    const not_after = c.X509_cmp_time(c.X509_get0_notAfter(x509), &now);
    if (not_after == 0) return error.CertificateMalformed;
    if (not_after < 0) return error.CertificateExpired;
}

fn checkCriticalExtensions(x509: *c.X509) Error!void {
    const oid = c.OBJ_txt2obj(cert.extension_oid, 1) orelse return error.OpenSslFailed;
    defer c.ASN1_OBJECT_free(oid);
    const count = c.X509_get_ext_count(x509);
    var index: c_int = 0;
    while (index < count) : (index += 1) {
        const extension = c.X509_get_ext(x509, index) orelse return error.CertificateMalformed;
        if (c.X509_EXTENSION_get_critical(extension) == 0) continue;
        if (c.X509_supported_extension(extension) != 0) continue;
        const object = c.X509_EXTENSION_get_object(extension) orelse
            return error.CertificateMalformed;
        if (c.OBJ_cmp(object, oid) != 0) return error.UnknownCriticalExtension;
    }
}

fn extensionValue(x509: *c.X509) Error!signed_key.SignedKey {
    const oid = c.OBJ_txt2obj(cert.extension_oid, 1) orelse return error.OpenSslFailed;
    defer c.ASN1_OBJECT_free(oid);
    const index = c.X509_get_ext_by_OBJ(x509, oid, -1);
    if (index < 0) return error.ExtensionMissing;
    if (c.X509_get_ext_by_OBJ(x509, oid, index) >= 0) return error.ExtensionMalformed;
    const extension = c.X509_get_ext(x509, index) orelse return error.CertificateMalformed;
    const data = c.X509_EXTENSION_get_data(extension) orelse return error.ExtensionMalformed;
    const length = c.ASN1_STRING_length(data);
    const bytes = c.ASN1_STRING_get0_data(data);
    if (length <= 0 or bytes == null) return error.ExtensionMalformed;
    return signed_key.decode(bytes[0..@intCast(length)]) catch |err| switch (err) {
        error.UnsupportedKeyType => error.UnsupportedKeyType,
        else => error.ExtensionMalformed,
    };
}

test {
    _ = @import("verify_test.zig");
}
