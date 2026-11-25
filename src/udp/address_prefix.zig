const std = @import("std");
const Address = @import("address.zig").Address;

/// A whole IPv4 address or an IPv6 /64, the widths req/resp and gossipsub use. Ports and
/// interface scopes are not part of a prefix; endpoint comparison remains Address.eql.
pub const Prefix = union(enum) {
    ip4: [4]u8,
    ip6: [8]u8,

    pub fn fromAddress(address: *const Address) Prefix {
        return switch (address.normalized()) {
            .ip4 => |ip| .{ .ip4 = ip.octets },
            .ip6 => |ip| .{ .ip6 = ip.octets[0..8].* },
        };
    }

    pub fn eql(self: Prefix, other: Prefix) bool {
        return std.meta.eql(self, other);
    }
};

test {
    _ = @import("address_prefix_test.zig");
}
