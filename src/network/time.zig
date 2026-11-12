const std = @import("std");
const Io = std.Io;

/// A copied owner-clock sample. Protocol deadlines use awake time; wall time is for TLS,
/// consensus slots, persistence and diagnostics. The two clocks are sampled independently.
pub const Now = struct {
    monotonic: Io.Clock.Timestamp,
    wall: Io.Clock.Timestamp,

    pub fn read(io: Io) error{ClockOutOfRange}!Now {
        const monotonic = Io.Clock.Timestamp.now(io, .awake);
        const wall = Io.Clock.Timestamp.now(io, .real);
        if (monotonic.raw.nanoseconds < 0 or monotonic.raw.nanoseconds > std.math.maxInt(u64) or
            wall.raw.nanoseconds < 0 or @divTrunc(wall.raw.nanoseconds, std.time.ns_per_s) > std.math.maxInt(i64)) return error.ClockOutOfRange;
        return .{ .monotonic = monotonic, .wall = wall };
    }

    pub fn fromMilliseconds(value: struct { mono_ms: u64, unix_s: i64 }) Now {
        return .{
            .monotonic = milliseconds(value.mono_ms),
            .wall = .{ .clock = .real, .raw = .fromNanoseconds(@as(i96, value.unix_s) * std.time.ns_per_s) },
        };
    }

    pub fn millis(self: *const Now) u64 {
        std.debug.assert(self.monotonic.clock == .awake);
        return @intCast(@divTrunc(self.monotonic.raw.nanoseconds, std.time.ns_per_ms));
    }

    pub fn nanos(self: *const Now) u64 {
        std.debug.assert(self.monotonic.clock == .awake);
        return @intCast(self.monotonic.raw.nanoseconds);
    }

    pub fn deadlineMilliseconds(self: *const Now, timeout: Io.Duration) u64 {
        std.debug.assert(timeout.nanoseconds >= 0);
        return ceilMilliseconds(self.monotonic.addDuration(.{ .clock = .awake, .raw = timeout }));
    }

    pub fn unixSeconds(self: *const Now) i64 {
        std.debug.assert(self.wall.clock == .real);
        return self.wall.raw.toSeconds();
    }

    pub fn floor(self: Now, minimum: Now) Now {
        return if (self.monotonic.compare(.gte, minimum.monotonic)) self else minimum;
    }
};

pub fn milliseconds(value: u64) Io.Clock.Timestamp {
    return .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, value) * std.time.ns_per_ms) };
}

pub fn optionalMilliseconds(value: ?u64) ?Io.Clock.Timestamp {
    return if (value) |ms| milliseconds(ms) else null;
}

pub fn ceilMilliseconds(value: Io.Clock.Timestamp) u64 {
    std.debug.assert(value.clock == .awake and value.raw.nanoseconds >= 0);
    return @intCast(@divTrunc(value.raw.nanoseconds, std.time.ns_per_ms) + @intFromBool(@mod(value.raw.nanoseconds, std.time.ns_per_ms) != 0));
}

/// Clamp before narrowing, and round a future deadline up so a sub-millisecond remainder
/// cannot make the native readiness wait spin.
pub fn waitMilliseconds(deadline: Io.Clock.Timestamp, now: Io.Clock.Timestamp, maximum: Io.Duration) u32 {
    std.debug.assert(deadline.clock == .awake and now.clock == .awake);
    std.debug.assert(maximum.nanoseconds >= 0 and maximum.nanoseconds <= @as(i96, std.math.maxInt(u32)) * std.time.ns_per_ms);
    const remaining = @min(@max(0, now.durationTo(deadline).raw.nanoseconds), maximum.nanoseconds);
    return @intCast(@divTrunc(remaining, std.time.ns_per_ms) + @intFromBool(@mod(remaining, std.time.ns_per_ms) != 0));
}

test {
    _ = @import("time_test.zig");
}
