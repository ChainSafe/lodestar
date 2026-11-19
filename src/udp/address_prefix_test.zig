const std = @import("std");
const Address = @import("address.zig").Address;
const Prefix = @import("address_prefix.zig").Prefix;

test "address prefixes normalize mapped IPv4 without changing endpoint scope" {
    const Source = Prefix(.{ .ip4 = 32, .ip6 = 64 });
    const ipv4: Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1234 } };
    const mapped: Address = .{ .ip6 = .{ .octets = .{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 192, 0, 2, 1 }, .port = 1234, .interface = 7 } };
    try std.testing.expectEqual(ipv4, mapped.normalized());
    try std.testing.expectEqual(ipv4, Address.fromNetwork(mapped.toNetwork()));
    try std.testing.expect(Source.fromAddress(&ipv4).eql(Source.fromAddress(&mapped)));
    var other = ipv4;
    other.ip4.port += 1;
    try std.testing.expect(!ipv4.eql(other));
    try std.testing.expect(Source.fromAddress(&ipv4).eql(Source.fromAddress(&other)));
    const ipv6: Address = .{ .ip6 = .{ .octets = .{ 0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 }, .port = 1234, .interface = 7 } };
    other = ipv6;
    other.ip6.interface += 1;
    try std.testing.expectEqual(ipv6, ipv6.normalized());
    try std.testing.expect(!ipv6.normalized().eql(other.normalized()));
    try std.testing.expect(Source.fromAddress(&ipv6).eql(Source.fromAddress(&other)));
    try std.testing.expect(!Source.fromAddress(&ipv4).eql(Source.fromAddress(&ipv6)));
}

test "address prefixes compare only the explicitly selected IPv4 bits" {
    const base: Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
    inline for (.{ 0, 1, 7, 8, 24, 25, 31, 32 }) |width| {
        const Key = Prefix(.{ .ip4 = width, .ip6 = 64 });
        for (0..32) |bit| {
            var other = base;
            other.ip4.octets[bit / 8] ^= @as(u8, 0x80) >> @as(u3, @intCast(bit % 8));
            try std.testing.expectEqual(bit >= width, Key.fromAddress(&base).eql(Key.fromAddress(&other)));
        }
    }
}

test "address prefixes compare only the explicitly selected IPv6 bits" {
    const base: Address = .{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1 }, .port = 1 } };
    inline for (.{ 0, 1, 7, 48, 63, 64, 65, 127, 128 }) |width| {
        const Key = Prefix(.{ .ip4 = 32, .ip6 = width });
        for (0..128) |bit| {
            var other = base;
            other.ip6.octets[bit / 8] ^= @as(u8, 0x80) >> @as(u3, @intCast(bit % 8));
            try std.testing.expectEqual(bit >= width, Key.fromAddress(&base).eql(Key.fromAddress(&other)));
        }
    }
}
