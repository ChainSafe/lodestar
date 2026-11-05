const std = @import("std");
const Address = @import("address.zig").Address;

/// Callers choose prefix widths for their resource. Ports and interface scopes are not part
/// of a prefix; endpoint comparison remains Address.eql.
pub fn Prefix(comptime bits: struct { ip4: u6, ip6: u8 }) type {
    std.debug.assert(bits.ip4 <= 32 and bits.ip6 <= 128);
    return union(enum) {
        ip4: [std.math.divCeil(u8, bits.ip4, 8) catch unreachable]u8,
        ip6: [std.math.divCeil(u8, bits.ip6, 8) catch unreachable]u8,

        const Self = @This();

        pub fn fromAddress(address: *const Address) Self {
            return switch (address.normalized()) {
                .ip4 => |ip| .{ .ip4 = extract(bits.ip4, &ip.octets) },
                .ip6 => |ip| .{ .ip6 = extract(bits.ip6, &ip.octets) },
            };
        }

        pub fn eql(self: Self, other: Self) bool {
            return std.meta.eql(self, other);
        }
    };
}

fn extract(comptime bits: u8, octets: []const u8) [std.math.divCeil(u8, bits, 8) catch unreachable]u8 {
    const length = comptime std.math.divCeil(u8, bits, 8) catch unreachable;
    std.debug.assert(length <= octets.len);
    var result: [length]u8 = octets[0..length].*;
    if (bits % 8 != 0) result[length - 1] &= @as(u8, 0xff) << @as(u3, @intCast(8 - bits % 8));
    return result;
}

test {
    _ = @import("address_prefix_test.zig");
}
