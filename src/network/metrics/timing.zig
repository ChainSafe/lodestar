const std = @import("std");
const histogram = @import("histogram.zig");

pub const Duration = histogram.Histogram(u64, &.{ 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 700_000_000, 1_000_000_000, 3_000_000_000 }, .{ .unit = .nanoseconds });

pub fn now(io: std.Io) u64 {
    return @intCast(@max(0, std.Io.Timestamp.now(io, .awake).nanoseconds));
}
