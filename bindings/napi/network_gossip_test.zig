const std = @import("std");
const g = @import("network_gossip.zig");
const network = @import("network");

test "gossip original admission wall projection is precise and independent of drain" {
    try std.testing.expectEqual(@as(u64, 1700000000123), try g.projectWall(100, .{ .monotonic = network.time.milliseconds(150), .wall = .{ .clock = .real, .raw = .fromNanoseconds(@as(i96, 1700000000173) * std.time.ns_per_ms) } }));
    try std.testing.expectEqual(@as(u64, 1700000000623), try g.projectWall(100, .{ .monotonic = network.time.milliseconds(150), .wall = .{ .clock = .real, .raw = .fromNanoseconds(@as(i96, 1700000000673) * std.time.ns_per_ms) } }));
    try std.testing.expectError(error.InvalidNetworkClock, g.projectWall(151, .{ .monotonic = network.time.milliseconds(150), .wall = .{ .clock = .real, .raw = .fromNanoseconds(@as(i96, 1700000000173) * std.time.ns_per_ms) } }));
}
