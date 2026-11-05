const std = @import("std");
const Address = @import("address.zig").Address;
const Group = @import("address_group.zig").Group;

test "address groups normalize mapped IPv4 and ignore host port and interface bits" {
    const first: Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
    const second: Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 254 }, .port = 65535 } };
    const other: Address = .{ .ip4 = .{ .octets = .{ 192, 0, 3, 1 }, .port = 1 } };
    const mapped: Address = .{ .ip6 = .{ .octets = .{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 192, 0, 2, 9 }, .port = 99, .interface = 7 } };
    try std.testing.expect(Group.fromAddress(&first).eql(Group.fromAddress(&second)));
    try std.testing.expect(Group.fromAddress(&first).eql(Group.fromAddress(&mapped)));
    try std.testing.expect(!Group.fromAddress(&first).eql(Group.fromAddress(&other)));

    const ipv6: Address = .{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 }, .port = 1 } };
    var subnet = ipv6;
    @memset(subnet.ip6.octets[6..], 255);
    subnet.ip6.port = 2;
    subnet.ip6.interface = 10;
    try std.testing.expect(Group.fromAddress(&ipv6).eql(Group.fromAddress(&subnet)));
    subnet.ip6.octets[5] += 1;
    try std.testing.expect(!Group.fromAddress(&ipv6).eql(Group.fromAddress(&subnet)));
    try std.testing.expect(!Group.fromAddress(&ipv6).eql(Group.fromAddress(&first)));
}
