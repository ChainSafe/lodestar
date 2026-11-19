const std = @import("std");
const keys = @import("keys.zig");
const signed_key = @import("signed_key.zig");

pub const spec_spki = "3059301306072a8648ce3d020106082a8648ce3d030107034200040c901d423c831ca85e27c73c263ba132721bb9d7a84c4f0380b2a6756fd601331c8870234dec878504c174144fa4b14b66a651691606d8173e55bd37e381569e";
pub const spec_signed_key = "306f0425080212210206dc6968726765b820f050263ececf7f71e4955892776c0970542efd689d2382044630440220145e15a991961f0d08cd15425bb95ec93f6ffa03c5a385eedc34ecf464c7a8ab022026b3109b8a3f40ef833169777eb2aa337cfb6282f188de0666d1bcec2a4690dd";
const spec_ecdsa_signed_key = "3081aa045f0803125b3059301306072a8648ce3d020106082a8648ce3d03010703420004bf30511f909414ebdd3242178fd290f093a551cf75c973155de0bb5a96fedf6cb5d52da7563e794b512f66e60c7f55ba8a3acf3dd72a801980d205e8a1ad29f2044730450220064ea8124774caf8f50e57f436aa62350ce652418c019df5d98a3ac666c9386a022100aa59d704a931b5f72fb9222cb6cc51f954d04a4e2e5450f8805fe8918f71eaae";

fn hex(comptime text: []const u8) [text.len / 2]u8 {
    var out: [text.len / 2]u8 = undefined;
    _ = std.fmt.hexToBytes(&out, text) catch unreachable;
    return out;
}

test "signed key decodes and verifies the libp2p spec vector" {
    const der = hex(spec_signed_key);
    const decoded = try signed_key.decode(&der);
    var message: [signed_key.message_length_max]u8 = undefined;
    const spki = hex(spec_spki);
    const to_verify = try signed_key.message(&spki, &message);
    try std.testing.expectEqualStrings("libp2p-tls-handshake:", to_verify[0..21]);
    try decoded.public_key.verify(to_verify, decoded.signature);
}

test "signed key round trips through encode" {
    const der = hex(spec_signed_key);
    const decoded = try signed_key.decode(&der);
    var out: [signed_key.der_length_max]u8 = undefined;
    const encoded = try signed_key.encode(&decoded.public_key, decoded.signature, &out);
    try std.testing.expectEqualSlices(u8, &der, encoded);
}

test "signed key rejects other key types and malformed DER" {
    const ecdsa = hex(spec_ecdsa_signed_key);
    try std.testing.expectError(error.UnsupportedKeyType, signed_key.decode(&ecdsa));
    const der = hex(spec_signed_key);
    try std.testing.expectError(error.Malformed, signed_key.decode(der[0 .. der.len - 1]));
    try std.testing.expectError(error.Malformed, signed_key.decode(&(der ++ [_]u8{0})));
    var wrong_tag = der;
    wrong_tag[2] = 0x05;
    try std.testing.expectError(error.Malformed, signed_key.decode(&wrong_tag));
    const long_form = [3]u8{ 0x30, 0x81, 0x6f } ++ der[2..];
    try std.testing.expectError(error.Malformed, signed_key.decode(long_form[0..]));
    try std.testing.expectError(error.Malformed, signed_key.decode(&.{}));
    var too_long: [signed_key.spki_length_max + 1]u8 = undefined;
    var message: [signed_key.message_length_max]u8 = undefined;
    try std.testing.expectError(error.MessageTooLong, signed_key.message(&too_long, &message));
    _ = &too_long;
    _ = &long_form;
}
