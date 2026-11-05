const std = @import("std");
const cert = @import("cert.zig");
const keys = @import("../wire/keys.zig");
const peer_id = @import("../wire/peer_id.zig");
const verify = @import("verify.zig");
const c = @import("quiche_zig:quiche");
const test_support = @import("test_support.zig");

const spec_secp256k1_cert = "308201ba3082015fa0030201020204499602d2300a06082a8648ce3d040302302031123010060355040a13096c69627032702e696f310a300806035504051301313020170d3735303130313133303030305a180f34303936303130313133303030305a302031123010060355040a13096c69627032702e696f310a300806035504051301313059301306072a8648ce3d020106082a8648ce3d030107034200040c901d423c831ca85e27c73c263ba132721bb9d7a84c4f0380b2a6756fd601331c8870234dec878504c174144fa4b14b66a651691606d8173e55bd37e381569ea38184308181307f060a2b0601040183a25a01010471306f0425080212210206dc6968726765b820f050263ececf7f71e4955892776c0970542efd689d2382044630440220145e15a991961f0d08cd15425bb95ec93f6ffa03c5a385eedc34ecf464c7a8ab022026b3109b8a3f40ef833169777eb2aa337cfb6282f188de0666d1bcec2a4690dd300a06082a8648ce3d0403020349003046022100e1a217eeef9ec9204b3f774a08b70849646b6a1e6b8b27f93dc00ed58545d9fe022100b00dafa549d0f03547878338c7b15e7502888f6d45db387e5ae6b5d46899cef0";
const spec_ecdsa_cert = "308201f63082019da0030201020204499602d2300a06082a8648ce3d040302302031123010060355040a13096c69627032702e696f310a300806035504051301313020170d3735303130313133303030305a180f34303936303130313133303030305a302031123010060355040a13096c69627032702e696f310a300806035504051301313059301306072a8648ce3d020106082a8648ce3d030107034200040c901d423c831ca85e27c73c263ba132721bb9d7a84c4f0380b2a6756fd601331c8870234dec878504c174144fa4b14b66a651691606d8173e55bd37e381569ea381c23081bf3081bc060a2b0601040183a25a01010481ad3081aa045f0803125b3059301306072a8648ce3d020106082a8648ce3d03010703420004bf30511f909414ebdd3242178fd290f093a551cf75c973155de0bb5a96fedf6cb5d52da7563e794b512f66e60c7f55ba8a3acf3dd72a801980d205e8a1ad29f2044730450220064ea8124774caf8f50e57f436aa62350ce652418c019df5d98a3ac666c9386a022100aa59d704a931b5f72fb9222cb6cc51f954d04a4e2e5450f8805fe8918f71eaae300a06082a8648ce3d04030203470030440220799395b0b6c1e940a7e4484705f610ab51ed376f19ff9d7c16757cfbf61b8d4302206205c03fbb0f95205c779be86581d3e31c01871ad5d1f3435bcf375cb0e5088a";
const spec_peer_id = "16Uiu2HAkutTMoTzDw1tCvSRtu6YoixJwS46S1ZFxW8hSx9fWHiPs";
const now_unix: i64 = 1_700_000_000;

fn hex(comptime text: []const u8) [text.len / 2]u8 {
    var out: [text.len / 2]u8 = undefined;
    _ = std.fmt.hexToBytes(&out, text) catch unreachable;
    return out;
}

test "verify accepts the libp2p secp256k1 spec certificate" {
    const der = hex(spec_secp256k1_cert);
    const id = try verify.verifyDer(&der, now_unix);
    var text: [peer_id.text_length_max]u8 = undefined;
    try std.testing.expectEqualStrings(spec_peer_id, id.toText(&text));
}

test "verify enforces the validity window" {
    const der = hex(spec_secp256k1_cert);
    try std.testing.expectError(error.CertificateNotYetValid, verify.verifyDer(&der, 100));
    try std.testing.expectError(error.CertificateExpired, verify.verifyDer(&der, 70_000_000_000));
}

test "verify rejects tampered, truncated, and foreign key type certificates" {
    var der = hex(spec_secp256k1_cert);
    der[der.len - 1] ^= 0x01;
    try std.testing.expectError(error.SelfSignatureInvalid, verify.verifyDer(&der, now_unix));
    try std.testing.expectError(error.CertificateMalformed, verify.verifyDer(der[0 .. der.len - 10], now_unix));
    try std.testing.expectError(error.CertificateMalformed, verify.verifyDer(&.{}, now_unix));
    const ecdsa = hex(spec_ecdsa_cert);
    try std.testing.expectError(error.UnsupportedKeyType, verify.verifyDer(&ecdsa, now_unix));
}

test "verify round trips our own certificate and catches a foreign signer" {
    const host = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{1}));
    const other = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{2}));
    var buffer: [cert.der_length_max]u8 = undefined;

    var own = try cert.Certificate.create(&host, now_unix, .{ 1, 1, 1, 1, 1, 1, 1, 1 });
    defer own.deinit();
    const own_id = try verify.verifyDer(try own.der(&buffer), now_unix);
    const host_key = host.publicKey();
    try std.testing.expect(own_id.eql(&peer_id.PeerId.fromPublicKey(&host_key)));

    var forged = try cert.Certificate.create(&host, now_unix, .{ 2, 2, 2, 2, 2, 2, 2, 2 });
    defer forged.deinit();
    try test_support.forgeHostSignature(&forged, &host_key, &other);
    try std.testing.expectError(error.HostSignatureInvalid, verify.verifyDer(try forged.der(&buffer), now_unix));
}

test "verify rejects a certificate with a trailing byte" {
    const der = hex(spec_secp256k1_cert ++ "00");
    try std.testing.expectError(error.CertificateMalformed, verify.verifyDer(&der, now_unix));
}

test "verify rejects a certificate whose libp2p extension was removed" {
    const host = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{4}));
    var own = try cert.Certificate.create(&host, now_unix, .{ 4, 4, 4, 4, 4, 4, 4, 4 });
    defer own.deinit();

    const oid = c.OBJ_txt2obj(cert.extension_oid, 1) orelse return error.TestUnexpectedResult;
    defer c.ASN1_OBJECT_free(oid);
    const index = c.X509_get_ext_by_OBJ(own.x509, oid, -1);
    try std.testing.expect(index >= 0);
    const removed = c.X509_delete_ext(own.x509, index) orelse return error.TestUnexpectedResult;
    c.X509_EXTENSION_free(removed);
    try std.testing.expect(c.X509_sign(own.x509, own.key, c.EVP_sha256()) > 0);

    var buffer: [cert.der_length_max]u8 = undefined;
    try std.testing.expectError(error.ExtensionMissing, verify.verifyDer(try own.der(&buffer), now_unix));
}

test "verify rejects an unknown critical extension" {
    const host = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{1}));
    var own = try cert.Certificate.create(&host, now_unix, .{ 3, 3, 3, 3, 3, 3, 3, 3 });
    defer own.deinit();

    const oid = c.OBJ_txt2obj("1.3.6.1.4.1.53594.9.9", 1) orelse return error.TestUnexpectedResult;
    defer c.ASN1_OBJECT_free(oid);
    const octets = c.ASN1_OCTET_STRING_new() orelse return error.TestUnexpectedResult;
    defer c.ASN1_OCTET_STRING_free(octets);
    try std.testing.expectEqual(@as(c_int, 1), c.ASN1_OCTET_STRING_set(octets, "x", 1));
    const extension = c.X509_EXTENSION_create_by_OBJ(null, oid, 1, octets) orelse return error.TestUnexpectedResult;
    defer c.X509_EXTENSION_free(extension);
    try std.testing.expectEqual(@as(c_int, 1), c.X509_add_ext(own.x509, extension, -1));
    try std.testing.expect(c.X509_sign(own.x509, own.key, c.EVP_sha256()) > 0);

    var buffer: [cert.der_length_max]u8 = undefined;
    try std.testing.expectError(error.UnknownCriticalExtension, verify.verifyDer(try own.der(&buffer), now_unix));
}
