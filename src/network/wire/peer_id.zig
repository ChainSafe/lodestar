const std = @import("std");
const keys = @import("keys.zig");

pub const length = 2 + keys.protobuf_length;
pub const text_length_max = 55;

const multihash_prefix = [_]u8{ 0x00, keys.protobuf_length };
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

pub const Error = error{ InvalidPeerId, InvalidText } || keys.Error;

pub const PeerId = struct {
    bytes: [length]u8,

    pub fn fromPublicKey(key: *const keys.PublicKey) PeerId {
        return .{ .bytes = multihash_prefix ++ key.encodeProtobuf() };
    }

    pub fn fromBytes(bytes: []const u8) Error!PeerId {
        if (bytes.len != length) return error.InvalidPeerId;
        if (!std.mem.eql(u8, bytes[0..multihash_prefix.len], &multihash_prefix)) {
            return error.InvalidPeerId;
        }
        _ = try keys.PublicKey.decodeProtobuf(bytes[multihash_prefix.len..]);
        return .{ .bytes = bytes[0..length].* };
    }

    pub fn publicKey(self: *const PeerId) keys.Error!keys.PublicKey {
        return keys.PublicKey.decodeProtobuf(self.bytes[multihash_prefix.len..]);
    }

    pub fn eql(self: *const PeerId, other: *const PeerId) bool {
        return std.mem.eql(u8, &self.bytes, &other.bytes);
    }

    pub fn toText(self: *const PeerId, out: *[text_length_max]u8) []const u8 {
        return base58Encode(&self.bytes, out);
    }

    pub fn fromText(text: []const u8) Error!PeerId {
        var decoded: [length]u8 = undefined;
        const bytes = try base58Decode(text, &decoded);
        return fromBytes(bytes);
    }
};

fn base58Encode(input: *const [length]u8, out: *[text_length_max]u8) []const u8 {
    var zeros: usize = 0;
    while (zeros < input.len and input[zeros] == 0) zeros += 1;

    var digits: [text_length_max]u8 = undefined;
    var digits_len: usize = 0;
    for (input[zeros..]) |byte| {
        var carry: u32 = byte;
        for (digits[0..digits_len]) |*digit| {
            carry += @as(u32, digit.*) << 8;
            digit.* = @intCast(carry % 58);
            carry /= 58;
        }
        while (carry != 0) : (carry /= 58) {
            std.debug.assert(digits_len < text_length_max);
            digits[digits_len] = @intCast(carry % 58);
            digits_len += 1;
        }
    }

    for (out[0..zeros]) |*char| char.* = alphabet[0];
    for (0..digits_len) |index| {
        out[zeros + index] = alphabet[digits[digits_len - 1 - index]];
    }
    return out[0 .. zeros + digits_len];
}

fn base58Decode(text: []const u8, out: *[length]u8) error{InvalidText}![]u8 {
    if (text.len == 0 or text.len > text_length_max) return error.InvalidText;
    var zeros: usize = 0;
    while (zeros < text.len and text[zeros] == alphabet[0]) zeros += 1;

    var bytes: [length]u8 = undefined;
    var bytes_len: usize = 0;
    for (text[zeros..]) |char| {
        const digit = std.mem.findScalar(u8, alphabet, char) orelse return error.InvalidText;
        var carry: u32 = @intCast(digit);
        for (bytes[0..bytes_len]) |*byte| {
            carry += @as(u32, byte.*) * 58;
            byte.* = @truncate(carry);
            carry >>= 8;
        }
        while (carry != 0) : (carry >>= 8) {
            if (bytes_len == length) return error.InvalidText;
            bytes[bytes_len] = @truncate(carry);
            bytes_len += 1;
        }
    }

    if (zeros + bytes_len > length) return error.InvalidText;
    for (out[0..zeros]) |*byte| byte.* = 0;
    for (0..bytes_len) |index| out[zeros + index] = bytes[bytes_len - 1 - index];
    return out[0 .. zeros + bytes_len];
}

test {
    _ = @import("peer_id_test.zig");
}
