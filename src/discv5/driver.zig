const std = @import("std");
const Transport = @import("Transport.zig");
const CallTable = @import("CallTable.zig");

pub const Options = struct {
    wait_max: std.Io.Duration = .fromMilliseconds(100),
    deadline: ?std.Io.Clock.Timestamp = null,
};

/// Standalone std.Io driver. Waiting receives at most one datagram; protocol advancement uses
/// the clock read after that wait. Dual-family sockets require Io concurrency support.
pub fn step(transport: *Transport, io: std.Io, expired: []CallTable.Expired, options: Options) Transport.Error!Transport.AdvanceResult {
    if (expired.len == 0) return error.MissingExpiryStorage;
    const before_stamp = std.Io.Clock.Timestamp.now(io, .awake);
    const before_ms = @divTrunc(before_stamp.raw.nanoseconds, std.time.ns_per_ms);
    if (before_stamp.raw.nanoseconds < 0 or before_ms > std.math.maxInt(u64))
        return .{ .failure = .{ .cause = error.ClockOutOfRange, .stage = .clock } };
    const before: u64 = @intCast(before_ms);
    var deadline = before_stamp.addDuration(.{ .clock = .awake, .raw = .fromSeconds(1) });
    if (options.deadline) |limit| {
        std.debug.assert(limit.clock == .awake);
        if (limit.compare(.lt, deadline)) deadline = limit;
    }
    if (transport.engine.nextDeadlineMs()) |ms| {
        const limit: std.Io.Clock.Timestamp = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, ms) * std.time.ns_per_ms) };
        if (limit.compare(.lt, deadline)) deadline = limit;
    }
    std.debug.assert(options.wait_max.nanoseconds >= 0);
    const wait_ns = @min(options.wait_max.nanoseconds, std.time.ns_per_s, @max(0, before_stamp.durationTo(deadline).raw.nanoseconds));
    const wait_ms: u64 = @intCast(@divTrunc(wait_ns, std.time.ns_per_ms) + @intFromBool(@mod(wait_ns, std.time.ns_per_ms) != 0));
    var ready: [2]bool = @splat(true);
    const input: Transport.Input = if (wait_ms == 0)
        transport.receive(io, &ready)
    else if (transport.sockets.receiveDatagram(io, &transport.receive_buffer, .{ .duration = .{
        .raw = .fromMilliseconds(@intCast(wait_ms)),
        .clock = .awake,
    } })) |packet| packet else |err| err;
    var clock_failure: ?error{ClockOutOfRange} = null;
    const read = Transport.monotonicMilliseconds(io) catch |err| blk: {
        clock_failure = err;
        break :blk before;
    };
    var result = try transport.advance(io, @max(before, read), expired, input);
    if (result.failure == null) if (clock_failure) |err| {
        result.failure = .{ .cause = err, .stage = .clock };
    };
    return result;
}

test {
    _ = @import("driver_test.zig");
}
