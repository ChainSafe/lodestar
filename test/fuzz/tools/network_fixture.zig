const network = @import("network");

pub const seed = [_]u8{1} ** 32;
pub const unix_s = 1_800_000_000;
pub const local: network.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9000 } };

pub fn source(index: usize) network.Address {
    return .{ .ip4 = .{ .octets = .{ 192, 0, 2, @intCast(1 + index / 2) }, .port = @intCast(9000 + index) } };
}
