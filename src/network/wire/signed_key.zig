const keys = @import("keys.zig");

pub const prefix = "libp2p-tls-handshake:";
pub const spki_length_max = 128;
pub const message_length_max = prefix.len + spki_length_max;
pub const der_length_max = 128;

pub const Error = error{ Malformed, MessageTooLong, UnsupportedKeyType };

pub const SignedKey = struct {
    public_key: keys.PublicKey,
    signature: []const u8,
};

pub fn message(spki_der: []const u8, out: *[message_length_max]u8) Error![]const u8 {
    if (spki_der.len > spki_length_max) return error.MessageTooLong;
    @memcpy(out[0..prefix.len], prefix);
    @memcpy(out[prefix.len..][0..spki_der.len], spki_der);
    return out[0 .. prefix.len + spki_der.len];
}

pub fn encode(
    public_key: *const keys.PublicKey,
    signature: []const u8,
    out: *[der_length_max]u8,
) Error![]const u8 {
    if (signature.len == 0 or signature.len > keys.signature_der_length_max) return error.Malformed;
    const body_length = 2 + keys.protobuf_length + 2 + signature.len;
    out[0] = 0x30;
    out[1] = @intCast(body_length);
    out[2] = 0x04;
    out[3] = keys.protobuf_length;
    @memcpy(out[4..][0..keys.protobuf_length], &public_key.encodeProtobuf());
    const signature_offset = 4 + keys.protobuf_length;
    out[signature_offset] = 0x04;
    out[signature_offset + 1] = @intCast(signature.len);
    @memcpy(out[signature_offset + 2 ..][0..signature.len], signature);
    return out[0 .. 2 + body_length];
}

pub fn decode(der: []const u8) Error!SignedKey {
    var cursor: usize = 0;
    const body = try element(der, &cursor, 0x30);
    if (cursor != der.len) return error.Malformed;
    var inner: usize = 0;
    const key_bytes = try element(body, &inner, 0x04);
    const signature = try element(body, &inner, 0x04);
    if (inner != body.len) return error.Malformed;
    if (key_bytes.len < 2 or key_bytes[0] != 0x08) return error.Malformed;
    if (key_bytes[1] != 0x02) return error.UnsupportedKeyType;
    const public_key = keys.PublicKey.decodeProtobuf(key_bytes) catch return error.Malformed;
    if (signature.len == 0 or signature.len > keys.signature_der_length_max) return error.Malformed;
    return .{ .public_key = public_key, .signature = signature };
}

fn element(bytes: []const u8, cursor: *usize, tag: u8) Error![]const u8 {
    if (bytes.len - cursor.* < 2) return error.Malformed;
    if (bytes[cursor.*] != tag) return error.Malformed;
    var length: usize = bytes[cursor.* + 1];
    cursor.* += 2;
    if (length == 0x81) {
        if (bytes.len - cursor.* < 1) return error.Malformed;
        length = bytes[cursor.*];
        if (length < 0x80) return error.Malformed;
        cursor.* += 1;
    } else if (length >= 0x80) {
        return error.Malformed;
    }
    if (bytes.len - cursor.* < length) return error.Malformed;
    const slice = bytes[cursor.*..][0..length];
    cursor.* += length;
    return slice;
}

test {
    _ = @import("signed_key_test.zig");
}
