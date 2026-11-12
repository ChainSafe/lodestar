const std = @import("std");
const time = @import("time.zig");

test "owner time preserves nanoseconds and floors within one millisecond" {
    const earlier: time.Now = .{ .monotonic = .{ .clock = .awake, .raw = .fromNanoseconds(1_000_001) }, .wall = .{ .clock = .real, .raw = .fromNanoseconds(0) } };
    var later = earlier;
    later.monotonic.raw.nanoseconds += 1;
    try std.testing.expectEqual(earlier.millis(), later.millis());
    try std.testing.expectEqual(later.nanos(), earlier.floor(later).nanos());
    try std.testing.expectEqual(later.nanos(), later.floor(earlier).nanos());
}

test "native wait conversion rounds up and clamps before narrowing" {
    const now = time.milliseconds(1);
    const future = now.addDuration(.{ .clock = .awake, .raw = .fromNanoseconds(1) });
    try std.testing.expectEqual(@as(u32, 1), time.waitMilliseconds(future, now, .fromSeconds(1)));
    try std.testing.expectEqual(@as(u32, 0), time.waitMilliseconds(now, future, .fromSeconds(1)));
    try std.testing.expectEqual(@as(u32, 1000), time.waitMilliseconds(time.milliseconds(std.math.maxInt(u64)), now, .fromSeconds(1)));
}

test "owner clock validates before narrowing either sample" {
    const Clock = struct {
        monotonic: i96,
        wall: i96,
        fn read(context: ?*anyopaque, which: std.Io.Clock) std.Io.Timestamp {
            const self: *@This() = @ptrCast(@alignCast(context.?));
            return .{ .nanoseconds = if (which == .awake) self.monotonic else self.wall };
        }
    };
    var vtable = std.Io.failing.vtable.*;
    vtable.now = Clock.read;
    var clock: Clock = .{ .monotonic = std.math.maxInt(u64), .wall = 0 };
    const io: std.Io = .{ .userdata = &clock, .vtable = &vtable };
    const valid = try time.Now.read(io);
    try std.testing.expectEqual(std.math.maxInt(u64), valid.nanos());
    for ([_]Clock{
        .{ .monotonic = -1, .wall = 0 },
        .{ .monotonic = @as(i96, std.math.maxInt(u64)) + 1, .wall = 0 },
        .{ .monotonic = 0, .wall = -1 },
        .{ .monotonic = 0, .wall = (@as(i96, std.math.maxInt(i64)) + 1) * std.time.ns_per_s },
    }) |invalid| {
        clock = invalid;
        try std.testing.expectError(error.ClockOutOfRange, time.Now.read(io));
    }
}

test "millisecond deadlines round after adding the duration" {
    var now = time.Now.fromMilliseconds(.{ .mono_ms = 100, .unix_s = 0 });
    try std.testing.expectEqual(@as(u64, 101), now.deadlineMilliseconds(.fromMilliseconds(1)));
    try std.testing.expectEqual(@as(u64, 101), now.deadlineMilliseconds(.fromNanoseconds(1)));
    now.monotonic.raw.nanoseconds += 900_000;
    try std.testing.expectEqual(@as(u64, 101), now.deadlineMilliseconds(.fromNanoseconds(100_000)));
    try std.testing.expectEqual(@as(u64, 102), now.deadlineMilliseconds(.fromNanoseconds(100_001)));
    try std.testing.expectEqual(@as(u64, 102), now.deadlineMilliseconds(.fromNanoseconds(500_000)));
    try std.testing.expectEqual(@as(u64, 102), now.deadlineMilliseconds(.fromMilliseconds(1)));
}
