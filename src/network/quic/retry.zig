const std = @import("std");
const binding = @import("binding.zig");
const limits = @import("limits.zig");
const Address = @import("../types.zig").Address;
const Hmac = std.crypto.auth.hmac.sha2.HmacSha256;

const family = "LZRETRY\x00";
const prefix = family ++ "\x01";
const issued_offset = prefix.len;
const length_offset = issued_offset + 8;
const cid_offset = length_offset + 1;
pub const token_max = cid_offset + limits.cid_length_max + Hmac.mac_length;

pub fn isLocal(token: []const u8) bool {
    return std.mem.startsWith(u8, token, family);
}

pub fn mint(key: *const [32]u8, from: *const Address, original: *const binding.Cid, scid: *const binding.Cid, now: u64, out: *[token_max]u8) []const u8 {
    std.debug.assert(original.len >= limits.initial_dcid_length_min);
    std.debug.assert(scid.len == limits.local_cid_length);
    @memcpy(out[0..prefix.len], prefix);
    std.mem.writeInt(u64, out[issued_offset..][0..8], now, .little);
    out[length_offset] = original.len;
    @memcpy(out[cid_offset..][0..original.len], original.slice());
    const length = cid_offset + @as(usize, original.len);
    out[length..][0..Hmac.mac_length].* = authenticate(key, from, scid, out[0..length]);
    return out[0 .. length + Hmac.mac_length];
}

pub fn validate(key: *const [32]u8, from: *const Address, scid: *const binding.Cid, token: []const u8, now: u64, lifetime: u64) ?binding.Cid {
    if (scid.len != limits.local_cid_length or token.len < cid_offset + Hmac.mac_length or token.len > token_max) return null;
    if (!std.mem.startsWith(u8, token, prefix)) return null;
    const length = token[length_offset];
    if (length < limits.initial_dcid_length_min or length > limits.cid_length_max or token.len != cid_offset + @as(usize, length) + Hmac.mac_length) return null;
    const issued = std.mem.readInt(u64, token[issued_offset..][0..8], .little);
    if (now < issued or now - issued >= lifetime) return null;
    const body = token[0 .. token.len - Hmac.mac_length];
    const expected = authenticate(key, from, scid, body);
    if (!std.crypto.timing_safe.eql([Hmac.mac_length]u8, expected, token[body.len..][0..Hmac.mac_length].*)) return null;
    return binding.Cid.fromSlice(body[cid_offset..]);
}

fn authenticate(key: *const [32]u8, from: *const Address, scid: *const binding.Cid, body: []const u8) [Hmac.mac_length]u8 {
    var mac = Hmac.init(key);
    mac.update("lodestar-z QUIC Retry");
    switch (from.*) {
        .ip4 => |address| {
            mac.update(&.{4});
            mac.update(&address.octets);
        },
        .ip6 => |address| {
            mac.update(&.{6});
            mac.update(&address.octets);
            var scope: [4]u8 = undefined;
            std.mem.writeInt(u32, &scope, address.interface, .little);
            mac.update(&scope);
        },
    }
    var port: [2]u8 = undefined;
    std.mem.writeInt(u16, &port, from.port(), .little);
    mac.update(&port);
    mac.update(scid.slice());
    mac.update(body);
    var result: [Hmac.mac_length]u8 = undefined;
    mac.final(&result);
    return result;
}

test {
    _ = @import("retry_test.zig");
}
