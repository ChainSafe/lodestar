/// IPv4 /24 and IPv6 /48 resource groups, independent of ports and interface scopes.
pub const Group = @import("address_prefix.zig").Prefix(.{ .ip4 = 24, .ip6 = 48 });

test {
    _ = @import("address_group_test.zig");
}
