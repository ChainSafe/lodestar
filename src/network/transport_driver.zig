const std = @import("std");
const Now = @import("types.zig").Now;
const Transport = @import("transport.zig").Transport;
const Engine = @import("quic/Engine.zig");
const wait = @import("wait.zig");
const constants = @import("constants.zig");

pub const Options = struct { wait_max: std.Io.Duration = .fromMilliseconds(constants.poll_interval_ms) };
pub const Error = Transport.AdvanceError || wait.Error || error{ClockOutOfRange};
pub const Result = struct { progress: Transport.Progress, cancelled: bool = false, failure: ?Error = null };

/// Standalone driver for a transport without NetworkCore. Requires OS sockets and the OS clock,
/// like the network driver. The caller consumes event borrows before another turn or teardown.
pub fn step(transport: *Transport, io: std.Io, events: []Engine.Event, options: Options) Result {
    const before = Now.read(io) catch |err| return .{
        .progress = .{ .now = Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 }) },
        .failure = err,
    };
    const timeout = transport.schedule(events.len).timeout(before.monotonic, options.wait_max);
    const ready = wait.poll(io, .{ .quic = transport.sockets.handles() }, timeout);
    var failure: ?Error = ready.failure;
    const read = Now.read(io) catch |err| blk: {
        failure = failure orelse err;
        break :blk before;
    };
    const now = read.floor(before);
    const advanced = transport.advance(io, .{
        .now = now,
        .ready = if (ready.failure != null) @splat(true) else ready.quic,
        .cancelled = ready.cancelled,
    }, events);
    if (advanced.failure) |err| failure = failure orelse err;
    return .{ .progress = advanced.progress, .cancelled = advanced.cancelled, .failure = failure };
}

test {
    _ = @import("transport_driver_test.zig");
}
