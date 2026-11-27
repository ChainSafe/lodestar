const std = @import("std");
const Address = @import("udp").Address;
const peer_id = @import("peer_id.zig");
const varint = @import("varint.zig");

pub const binary_length_max = 65;
pub const text_length_max = 160;

const code_ip4: u64 = 4;
const code_ip6: u64 = 41;
const code_udp: u64 = 273;
const code_p2p: u64 = 421;
const code_quic_v1: u64 = 461;

pub const Error = error{ InvalidMultiaddr, BufferTooSmall } || peer_id.Error || varint.Error;

/// QUIC multiaddrs do not support IPv6 interface zones; encoding rejects scoped endpoints.
pub const Multiaddr = struct {
    address: Address,
    peer: ?peer_id.PeerId = null,

    fn validateEncodableAddress(self: *const Multiaddr) error{InvalidMultiaddr}!void {
        if (self.address == .ip6 and (self.address.ip6.interface != 0 or Address.isIp4Mapped(self.address.ip6.octets))) return error.InvalidMultiaddr;
    }

    pub fn encode(self: *const Multiaddr, out: []u8) Error![]u8 {
        try self.validateEncodableAddress();
        var cursor: usize = 0;
        switch (self.address) {
            .ip4 => |ip| {
                try putVarint(out, &cursor, code_ip4);
                try put(out, &cursor, &ip.octets);
            },
            .ip6 => |ip| {
                try putVarint(out, &cursor, code_ip6);
                try put(out, &cursor, &ip.octets);
            },
        }
        try putVarint(out, &cursor, code_udp);
        var port_bytes: [2]u8 = undefined;
        std.mem.writeInt(u16, &port_bytes, self.address.port(), .big);
        try put(out, &cursor, &port_bytes);
        try putVarint(out, &cursor, code_quic_v1);
        if (self.peer) |id| {
            try putVarint(out, &cursor, code_p2p);
            try putVarint(out, &cursor, peer_id.length);
            try put(out, &cursor, &id.bytes);
        }
        return out[0..cursor];
    }

    pub fn decode(bytes: []const u8) Error!Multiaddr {
        var cursor: usize = 0;
        var address: Address = switch (try takeVarint(bytes, &cursor)) {
            code_ip4 => .{ .ip4 = .{ .octets = (try take(bytes, &cursor, 4))[0..4].*, .port = 0 } },
            code_ip6 => .{ .ip6 = .{
                .octets = (try take(bytes, &cursor, 16))[0..16].*,
                .port = 0,
            } },
            else => return error.InvalidMultiaddr,
        };
        if (address == .ip6 and Address.isIp4Mapped(address.ip6.octets)) return error.InvalidMultiaddr;
        if (try takeVarint(bytes, &cursor) != code_udp) return error.InvalidMultiaddr;
        const port = std.mem.readInt(u16, (try take(bytes, &cursor, 2))[0..2], .big);
        switch (address) {
            .ip4 => |*ip| ip.port = port,
            .ip6 => |*ip| ip.port = port,
        }
        if (try takeVarint(bytes, &cursor) != code_quic_v1) return error.InvalidMultiaddr;
        var result = Multiaddr{ .address = address };
        if (cursor == bytes.len) return result;
        if (try takeVarint(bytes, &cursor) != code_p2p) return error.InvalidMultiaddr;
        if (try takeVarint(bytes, &cursor) != peer_id.length) return error.InvalidMultiaddr;
        result.peer = try peer_id.PeerId.fromBytes(try take(bytes, &cursor, peer_id.length));
        if (cursor != bytes.len) return error.InvalidMultiaddr;
        return result;
    }

    pub fn toText(self: *const Multiaddr, out: *[text_length_max]u8) Error![]const u8 {
        try self.validateEncodableAddress();
        var cursor: usize = 0;
        switch (self.address) {
            .ip4 => |ip| {
                const written = std.fmt.bufPrint(out[cursor..], "/ip4/{d}.{d}.{d}.{d}", .{
                    ip.octets[0], ip.octets[1], ip.octets[2], ip.octets[3],
                }) catch return error.BufferTooSmall;
                cursor += written.len;
            },
            .ip6 => |ip| {
                const written = std.fmt.bufPrint(out[cursor..], "/ip6/{f}", .{
                    std.Io.net.Ip6Address.Unresolved{ .bytes = ip.octets, .interface_name = null },
                }) catch return error.BufferTooSmall;
                cursor += written.len;
            },
        }
        const port = self.address.port();
        const tail = std.fmt.bufPrint(out[cursor..], "/udp/{d}/quic-v1", .{port}) catch
            return error.BufferTooSmall;
        cursor += tail.len;
        if (self.peer) |id| {
            var text: [peer_id.text_length_max]u8 = undefined;
            const id_text = id.toText(&text);
            const written = std.fmt.bufPrint(out[cursor..], "/p2p/{s}", .{id_text}) catch
                return error.BufferTooSmall;
            cursor += written.len;
        }
        return out[0..cursor];
    }

    pub fn parse(text: []const u8) Error!Multiaddr {
        if (text.len == 0 or text[0] != '/' or text.len > text_length_max) {
            return error.InvalidMultiaddr;
        }
        var parts = std.mem.splitScalar(u8, text[1..], '/');
        const family = parts.next() orelse return error.InvalidMultiaddr;
        const host = parts.next() orelse return error.InvalidMultiaddr;
        const udp_part = parts.next() orelse return error.InvalidMultiaddr;
        if (!std.mem.eql(u8, udp_part, "udp")) return error.InvalidMultiaddr;
        const port_text = parts.next() orelse return error.InvalidMultiaddr;
        const port = std.fmt.parseInt(u16, port_text, 10) catch return error.InvalidMultiaddr;
        const quic_part = parts.next() orelse return error.InvalidMultiaddr;
        if (!std.mem.eql(u8, quic_part, "quic-v1")) return error.InvalidMultiaddr;

        const address: Address = if (std.mem.eql(u8, family, "ip4")) blk: {
            const parsed = Address.parseIpText(host, port) catch return error.InvalidMultiaddr;
            if (parsed != .ip4) return error.InvalidMultiaddr;
            break :blk .{ .ip4 = .{ .octets = parsed.ip4.bytes, .port = port } };
        } else if (std.mem.eql(u8, family, "ip6")) blk: {
            const parsed = Address.parseIpText(host, port) catch return error.InvalidMultiaddr;
            if (parsed != .ip6) return error.InvalidMultiaddr;
            if (Address.isIp4Mapped(parsed.ip6.bytes)) return error.InvalidMultiaddr;
            break :blk .{ .ip6 = .{ .octets = parsed.ip6.bytes, .port = port } };
        } else return error.InvalidMultiaddr;

        var result = Multiaddr{ .address = address };
        if (parts.next()) |component| {
            if (!std.mem.eql(u8, component, "p2p")) return error.InvalidMultiaddr;
            const id_text = parts.next() orelse return error.InvalidMultiaddr;
            result.peer = try peer_id.PeerId.fromText(id_text);
            if (parts.next() != null) return error.InvalidMultiaddr;
        }
        return result;
    }
};

fn put(out: []u8, cursor: *usize, bytes: []const u8) Error!void {
    if (out.len - cursor.* < bytes.len) return error.BufferTooSmall;
    @memcpy(out[cursor.*..][0..bytes.len], bytes);
    cursor.* += bytes.len;
}

fn putVarint(out: []u8, cursor: *usize, value: u64) Error!void {
    if (out.len - cursor.* < varint.encodedLength(value)) return error.BufferTooSmall;
    cursor.* += (try varint.encode(value, out[cursor.*..])).len;
}

fn take(bytes: []const u8, cursor: *usize, count: usize) Error![]const u8 {
    if (bytes.len - cursor.* < count) return error.Truncated;
    const slice = bytes[cursor.*..][0..count];
    cursor.* += count;
    return slice;
}

fn takeVarint(bytes: []const u8, cursor: *usize) Error!u64 {
    const decoded = try varint.decode(bytes[cursor.*..]);
    cursor.* += decoded.length;
    return decoded.value;
}

test {
    _ = @import("multiaddr_test.zig");
}
