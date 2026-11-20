const std = @import("std");
const cert = @import("cert.zig");
const keys = @import("../wire/keys.zig");
const signed_key = @import("../wire/signed_key.zig");
const c = @import("quiche_zig:quiche");

const now_unix: i64 = 1_700_000_000;

fn hostPair() !keys.KeyPair {
    return keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{1}));
}

test "certificate is self-signed and carries a critical libp2p extension" {
    const host = try hostPair();
    var certificate = try cert.Certificate.create(&host, now_unix, .{ 1, 2, 3, 4, 5, 6, 7, 8 });
    defer certificate.deinit();

    var buffer: [cert.der_length_max]u8 = undefined;
    const der = try certificate.der(&buffer);
    try std.testing.expect(der.len > 200);

    var cursor: [*c]const u8 = der.ptr;
    const parsed = c.d2i_X509(null, &cursor, @intCast(der.len)) orelse return error.TestUnexpectedResult;
    defer c.X509_free(parsed);
    const key = c.X509_get_pubkey(parsed) orelse return error.TestUnexpectedResult;
    defer c.EVP_PKEY_free(key);
    try std.testing.expectEqual(@as(c_int, 1), c.X509_verify(parsed, key));

    const oid = c.OBJ_txt2obj(cert.extension_oid, 1) orelse return error.TestUnexpectedResult;
    defer c.ASN1_OBJECT_free(oid);
    const index = c.X509_get_ext_by_OBJ(parsed, oid, -1);
    try std.testing.expect(index >= 0);
    const extension = c.X509_get_ext(parsed, index) orelse return error.TestUnexpectedResult;
    try std.testing.expect(c.X509_EXTENSION_get_critical(extension) != 0);

    const data = c.X509_EXTENSION_get_data(extension) orelse return error.TestUnexpectedResult;
    const length: usize = @intCast(c.ASN1_STRING_length(data));
    const decoded = try signed_key.decode(c.ASN1_STRING_get0_data(data)[0..length]);
    try std.testing.expectEqualSlices(u8, &host.publicKey().bytes, &decoded.public_key.bytes);

    var spki: [signed_key.spki_length_max]u8 = undefined;
    const spki_der = try cert.spkiDer(key, &spki);
    var message: [signed_key.message_length_max]u8 = undefined;
    try decoded.public_key.verify(try signed_key.message(spki_der, &message), decoded.signature);
}

test "certificate validity window brackets the creation time" {
    const host = try hostPair();
    var certificate = try cert.Certificate.create(&host, now_unix, .{ 9, 9, 9, 9, 9, 9, 9, 9 });
    defer certificate.deinit();
    var before: c.time_t = @intCast(now_unix - 7_200);
    var inside: c.time_t = @intCast(now_unix);
    var decade: c.time_t = @intCast(now_unix + 10 * 365 * 24 * 3_600);
    var after: c.time_t = @intCast(now_unix + 101 * 365 * 24 * 3_600);
    try std.testing.expect(c.X509_cmp_time(c.X509_get0_notBefore(certificate.x509), &before) > 0);
    try std.testing.expect(c.X509_cmp_time(c.X509_get0_notBefore(certificate.x509), &inside) < 0);
    try std.testing.expect(c.X509_cmp_time(c.X509_get0_notAfter(certificate.x509), &inside) > 0);
    try std.testing.expect(c.X509_cmp_time(c.X509_get0_notAfter(certificate.x509), &decade) > 0);
    try std.testing.expect(c.X509_cmp_time(c.X509_get0_notAfter(certificate.x509), &after) < 0);
}

test "certificate DER does not fit a small buffer" {
    const host = try hostPair();
    var certificate = try cert.Certificate.create(&host, now_unix, .{ 0, 0, 0, 0, 0, 0, 0, 0 });
    defer certificate.deinit();
    var small: [64]u8 = undefined;
    try std.testing.expectError(error.EncodeFailed, certificate.der(&small));
}
