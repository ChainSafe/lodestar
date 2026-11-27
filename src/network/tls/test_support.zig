const std = @import("std");
const cert = @import("cert.zig");
const keys = @import("../wire/keys.zig");
const signed_key = @import("../wire/signed_key.zig");
const c = @import("quiche_zig:quiche");

pub fn forgeHostSignature(certificate: *cert.Certificate, claimed: *const keys.PublicKey, signer: *const keys.KeyPair) !void {
    var spki: [signed_key.spki_length_max]u8 = undefined;
    var message: [signed_key.message_length_max]u8 = undefined;
    var signature: [keys.signature_der_length_max]u8 = undefined;
    const signature_der = try signer.sign(try signed_key.message(try cert.spkiDer(certificate.key, &spki), &message), &signature);
    var encoded: [signed_key.der_length_max]u8 = undefined;
    const value = try signed_key.encode(claimed, signature_der, &encoded);
    const oid = c.OBJ_txt2obj(cert.extension_oid, 1) orelse return error.TestUnexpectedResult;
    defer c.ASN1_OBJECT_free(oid);
    const index = c.X509_get_ext_by_OBJ(certificate.x509, oid, -1);
    try std.testing.expect(index >= 0);
    const extension = c.X509_get_ext(certificate.x509, index) orelse return error.TestUnexpectedResult;
    const data = c.X509_EXTENSION_get_data(extension) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(c_int, 1), c.ASN1_OCTET_STRING_set(data, value.ptr, @intCast(value.len)));
    try std.testing.expect(c.X509_sign(certificate.x509, certificate.key, c.EVP_sha256()) > 0);
}
