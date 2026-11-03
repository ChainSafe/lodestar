const std = @import("std");

/// Endpoint address shared by discovery and QUIC. Addresses on different IPv6 interfaces
/// are distinct endpoints. IPv6 flow information does not identify an endpoint, so we omit it.
///
/// We keep this separate from `std.Io.net.IpAddress` so comparisons and hash-map lookups
/// agree. The standard type's `eql` ignores the IPv6 interface, while `AutoHashMap` includes
/// both interface and flow information.
pub const Address = union(enum) {
    ip4: struct {
        octets: [4]u8,
        port: u16,
    },
    ip6: struct {
        octets: [16]u8,
        port: u16,
        interface: u32 = 0,
    },

    pub const unspecified: Address = .{ .ip4 = .{ .octets = .{ 0, 0, 0, 0 }, .port = 0 } };

    pub fn port(self: Address) u16 {
        return switch (self) {
            .ip4 => |value| value.port,
            .ip6 => |value| value.port,
        };
    }

    /// Basic remote-endpoint eligibility; consumers still apply relay and admission policy.
    /// Construction does not imply usability: listeners and placeholders may be unspecified.
    pub fn isUsable(self: Address) bool {
        if (self == .ip6 and isIp4Mapped(self.ip6.octets)) return false;
        return switch (self) {
            inline else => |value| value.port != 0 and !std.mem.allEqual(u8, &value.octets, 0),
        };
    }

    /// std reads any "::ffff:" prefix as an IPv4-mapped address and rejects hex groups after it,
    /// while its formatter spells such addresses that way. Naming the leading zero group routes
    /// them through the general parser.
    pub fn parseIpText(text: []const u8, port_number: u16) error{InvalidAddress}!std.Io.net.IpAddress {
        const mapped_prefix = "::ffff:";
        if (std.ascii.startsWithIgnoreCase(text, mapped_prefix) and std.mem.findScalar(u8, text, '.') == null) {
            var spelled: [64]u8 = undefined;
            if (text.len + 1 > spelled.len) return error.InvalidAddress;
            spelled[0] = '0';
            @memcpy(spelled[1..][0..text.len], text);
            return std.Io.net.IpAddress.parse(spelled[0 .. text.len + 1], port_number) catch error.InvalidAddress;
        }
        return std.Io.net.IpAddress.parse(text, port_number) catch error.InvalidAddress;
    }

    pub fn isIp4Mapped(ip: [16]u8) bool {
        return std.mem.allEqual(u8, ip[0..10], 0) and ip[10] == 0xff and ip[11] == 0xff;
    }

    pub fn normalized(self: *const Address) Address {
        if (self.* == .ip6 and isIp4Mapped(self.ip6.octets))
            return .{ .ip4 = .{ .octets = self.ip6.octets[12..16].*, .port = self.ip6.port } };
        return self.*;
    }

    /// Normalizes socket input: mapped IPv6 becomes IPv4 and IPv6 flow information is discarded.
    /// ENR and multiaddr consumers instead reject mapped IPv6 as an advertised IPv6 endpoint.
    pub fn fromNetwork(address: std.Io.net.IpAddress) Address {
        const endpoint: Address = switch (address) {
            .ip4 => |ip| .{ .ip4 = .{ .octets = ip.bytes, .port = ip.port } },
            .ip6 => |ip| .{ .ip6 = .{ .octets = ip.bytes, .port = ip.port, .interface = ip.interface.index } },
        };
        return endpoint.normalized();
    }

    pub fn toNetwork(self: Address) std.Io.net.IpAddress {
        return switch (self) {
            .ip4 => |ip| .{ .ip4 = .{ .bytes = ip.octets, .port = ip.port } },
            .ip6 => |ip| .{ .ip6 = .{ .bytes = ip.octets, .port = ip.port, .flow = 0, .interface = .{ .index = ip.interface } } },
        };
    }

    pub fn eql(self: Address, other: Address) bool {
        return std.meta.eql(self, other);
    }
};

test "parseIpText accepts hex groups after a mapped-looking prefix" {
    const spelled = try Address.parseIpText("::ffff:ffee", 1);
    try std.testing.expect(spelled == .ip6);
    try std.testing.expectEqual([16]u8{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xee }, spelled.ip6.bytes);
    const mapped = try Address.parseIpText("::ffff:127.0.0.1", 1);
    try std.testing.expect(mapped == .ip6 and Address.isIp4Mapped(mapped.ip6.bytes));
    try std.testing.expectError(error.InvalidAddress, Address.parseIpText("::ffff:zz", 1));
    try std.testing.expect((try Address.parseIpText("10.0.0.1", 1)) == .ip4);
}
