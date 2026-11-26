const std = @import("std");
const Address = @import("address.zig").Address;
const Prefix = @import("address_prefix.zig").Prefix;

test "address prefixes normalize mapped IPv4 without changing endpoint scope" {
    const ipv4: Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1234 } };
    const mapped: Address = .{ .ip6 = .{ .octets = .{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 192, 0, 2, 1 }, .port = 1234, .interface = 7 } };
    try std.testing.expectEqual(ipv4, mapped.normalized());
    try std.testing.expectEqual(ipv4, Address.fromNetwork(mapped.toNetwork()));
    try std.testing.expect(Prefix.fromAddress(&ipv4).eql(Prefix.fromAddress(&mapped)));
    var other = ipv4;
    other.ip4.port += 1;
    try std.testing.expect(!ipv4.eql(other));
    try std.testing.expect(Prefix.fromAddress(&ipv4).eql(Prefix.fromAddress(&other)));
    const ipv6: Address = .{ .ip6 = .{ .octets = .{ 0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 }, .port = 1234, .interface = 7 } };
    other = ipv6;
    other.ip6.interface += 1;
    try std.testing.expectEqual(ipv6, ipv6.normalized());
    try std.testing.expect(!ipv6.normalized().eql(other.normalized()));
    try std.testing.expect(Prefix.fromAddress(&ipv6).eql(Prefix.fromAddress(&other)));
    try std.testing.expect(!Prefix.fromAddress(&ipv4).eql(Prefix.fromAddress(&ipv6)));
}

test "address prefixes compare every IPv4 bit and the first 64 IPv6 bits" {
    const ipv4: Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
    for (0..32) |bit| {
        var other = ipv4;
        other.ip4.octets[bit / 8] ^= @as(u8, 0x80) >> @as(u3, @intCast(bit % 8));
        try std.testing.expect(!Prefix.fromAddress(&ipv4).eql(Prefix.fromAddress(&other)));
    }
    const ipv6: Address = .{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1 }, .port = 1 } };
    for (0..128) |bit| {
        var other = ipv6;
        other.ip6.octets[bit / 8] ^= @as(u8, 0x80) >> @as(u3, @intCast(bit % 8));
        try std.testing.expectEqual(bit >= 64, Prefix.fromAddress(&ipv6).eql(Prefix.fromAddress(&other)));
    }
}
