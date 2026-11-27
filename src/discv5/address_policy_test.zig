const std = @import("std");
const address_policy = @import("address_policy.zig");
const support = @import("test_support.zig");
const address4 = support.address4;
const address6 = support.address6;

test "relay policy does not cross special address scopes" {
    const public = address4(203, 0, 113, 1, 9_000);
    const other_public = address4(198, 51, 100, 1, 9_000);
    const private = address4(10, 0, 0, 1, 9_000);
    const other_private = address4(192, 168, 1, 1, 9_000);
    const loopback = address4(127, 0, 0, 1, 9_000);
    const unspecified = address4(0, 0, 0, 0, 9_000);
    try std.testing.expect(address_policy.relayAllowed(public, other_public));
    try std.testing.expect(!address_policy.relayAllowed(public, private));
    try std.testing.expect(address_policy.relayAllowed(private, other_private));
    try std.testing.expect(address_policy.relayAllowed(loopback, loopback));
    try std.testing.expect(!address_policy.relayAllowed(private, loopback));
    try std.testing.expect(!address_policy.relayAllowed(public, unspecified));

    const public6 = address6(
        .{ 0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 },
        9_000,
    );
    const private6 = address6(.{ 0xfc, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 }, 9_000);
    const other_private6 = address6(.{ 0xfd, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2 }, 9_000);
    const multicast6 = address6(.{ 0xff, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 }, 9_000);
    try std.testing.expect(!address_policy.relayAllowed(public6, private6));
    try std.testing.expect(address_policy.relayAllowed(private6, other_private6));
    try std.testing.expect(!address_policy.relayAllowed(private, private6));
    try std.testing.expect(!address_policy.relayAllowed(public6, multicast6));
    const mapped_private = address6(.{0} ** 10 ++ .{ 0xff, 0xff, 10, 0, 0, 1 }, 9000);
    try std.testing.expect(!address_policy.relayAllowed(private6, mapped_private));
    try std.testing.expect(!address_policy.relayAllowed(mapped_private, private6));
}

test "endpoint equality and subnet grouping preserve distinct identity policies" {
    var left = support.fakeEndpoint(1, 9000);
    var right = left;
    try std.testing.expect(left.eql(&right));
    right.node_id[0] ^= 1;
    try std.testing.expect(!left.eql(&right));
    try std.testing.expect(address_policy.sameSubnet(left.address, right.address));
    right = left;
    right.address.ip4.port += 1;
    right.address.ip4.octets[3] += 1;
    try std.testing.expect(!left.eql(&right));
    try std.testing.expect(address_policy.sameSubnet(left.address, right.address));
    right.address.ip4.octets[2] += 1;
    try std.testing.expect(!address_policy.sameSubnet(left.address, right.address));
    right.address = support.address6(@splat(0x20), 9000);
    try std.testing.expect(!address_policy.sameSubnet(left.address, right.address));
    left.address = right.address;
    right.address.ip6.interface = 1;
    try std.testing.expect(!left.eql(&right));
    right.address.ip6.octets[8] += 1;
    try std.testing.expect(address_policy.sameSubnet(left.address, right.address));
    right.address.ip6.octets[7] += 1;
    right.address.ip6.octets[6] += 1;
    try std.testing.expect(address_policy.sameSubnet(left.address, right.address));
    right.address.ip6.octets[5] += 1;
    try std.testing.expect(!address_policy.sameSubnet(left.address, right.address));
}
