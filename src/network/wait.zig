const std = @import("std");
const builtin = @import("builtin");
const time = @import("time.zig");

pub const supported = builtin.os.tag == .linux or builtin.os.tag == .macos;
/// A backstop only: an owner computes its wait from its deadlines and wakes on readiness.
pub const native_wait_max_ms: u32 = 1_000;
pub const Error = error{ UnsupportedWait, InvalidWakeSource, WaitFailed, WaitSourceClosed, Canceled };
pub const Sources = struct { quic: [2]?i32, discovery: [2]?i32 = .{ null, null }, host: ?i32 = null };
pub const Result = struct {
    /// Per family, indexed like `Sources.quic`.
    quic: [2]bool = .{ false, false },
    discovery: [2]bool = .{ false, false },
    host: bool = false,
    /// Cancellation stops further I/O even when failure records an earlier diagnostic.
    cancelled: bool = false,
    failure: ?Error = null,

    pub fn discoveryReady(self: *const Result) bool {
        return self.discovery[0] or self.discovery[1];
    }

    pub fn quicReady(self: *const Result) bool {
        return self.quic[0] or self.quic[1];
    }
};

/// Requires real OS descriptors from an Io provider with the OS awake clock.
/// Cancellation is checked around one poll, bounded to 1 s. Host readiness and
/// signals can wake it sooner; arbitrary Io cancellation cannot interrupt libc.
/// Only observes readiness. Descriptor owners retain all bytes and close duties.
pub fn poll(io: std.Io, sources: Sources, timeout: std.Io.Timeout) Result {
    const maximum = std.Io.Duration.fromMilliseconds(native_wait_max_ms);
    const now = std.Io.Clock.Timestamp.now(io, .awake);
    const deadline = switch (timeout) {
        .none => now.addDuration(.{ .clock = .awake, .raw = maximum }),
        .deadline => |deadline| deadline,
        .duration => |duration| blk: {
            std.debug.assert(duration.clock == .awake and duration.raw.nanoseconds >= 0);
            break :blk now.addDuration(.{ .clock = .awake, .raw = .fromNanoseconds(@min(duration.raw.nanoseconds, maximum.nanoseconds)) });
        },
    };
    return pollWith(io, sources, time.waitMilliseconds(deadline, now, maximum), std.c.poll);
}

fn pollWith(io: std.Io, sources: Sources, timeout_ms: u32, comptime pollFn: anytype) Result {
    if (!supported) return .{ .failure = error.UnsupportedWait };
    const handles = sources.quic ++ sources.discovery ++ [_]?i32{sources.host};
    if (sources.quic[0] == null and sources.quic[1] == null) return .{ .failure = error.InvalidWakeSource };
    for (handles) |fd| if (fd) |value| if (value < 0) return .{ .failure = error.InvalidWakeSource };
    io.checkCancel() catch |err| return .{ .cancelled = true, .failure = err };
    var descriptors: [5]std.c.pollfd = undefined;
    for (handles, &descriptors) |fd, *descriptor| descriptor.* = .{ .fd = fd orelse -1, .events = std.c.POLL.IN, .revents = 0 };
    var result: Result = .{};
    const count = pollFn(&descriptors, descriptors.len, @intCast(@min(timeout_ms, native_wait_max_ms)));
    if (count < 0) {
        switch (std.c.errno(count)) {
            .INTR => {},
            else => |errno| {
                std.log.scoped(.network_runtime).err("owner_poll_failed errno={s}", .{@tagName(errno)});
                result.failure = error.WaitFailed;
            },
        }
    } else {
        for (&result.quic, descriptors[0..2]) |*ready, descriptor| ready.* = descriptor.revents & std.c.POLL.IN != 0;
        for (&result.discovery, descriptors[2..4]) |*ready, descriptor| ready.* = descriptor.revents & std.c.POLL.IN != 0;
        result.host = descriptors[4].revents & std.c.POLL.IN != 0;
        for (descriptors, 0..) |descriptor, index| {
            if (descriptor.revents & (std.c.POLL.ERR | std.c.POLL.HUP | std.c.POLL.NVAL) != 0) {
                const role: []const u8 = if (index < 2) "quic" else if (index < 4) "discovery" else "host";
                const family: []const u8 = if (index == 4) "none" else if (index % 2 == 0) "ip4" else "ip6";
                std.log.scoped(.network_runtime).err("owner_poll_source_failed role={s} family={s} descriptor={d} revents={x}", .{ role, family, descriptor.fd, descriptor.revents });
                result.failure = error.WaitSourceClosed;
            }
        }
    }
    io.checkCancel() catch |err| {
        result.cancelled = true;
        result.failure = result.failure orelse err;
    };
    return result;
}

test "native wait bounds interruption and preserves fatal context at error level" {
    _ = @import("wait_test.zig");
    if (!supported) return error.SkipZigTest;
    const Interrupted = struct {
        var calls: usize = 0;
        fn poll(_: [*]std.c.pollfd, _: std.c.nfds_t, timeout: c_int) c_int {
            calls += 1;
            std.debug.assert(timeout == native_wait_max_ms);
            std.c._errno().* = @intFromEnum(std.posix.E.INTR);
            return -1;
        }
    };
    const result = pollWith(std.testing.io, .{ .quic = .{ 0, null } }, 5000, Interrupted.poll);
    try std.testing.expectEqual(@as(usize, 1), Interrupted.calls);
    try std.testing.expect(result.failure == null);
    try std.testing.expect(!result.quicReady() and !result.discoveryReady() and !result.host);

    const runner = @import("root");
    const Failed = struct {
        var errno: std.posix.E = .NOMEM;
        var source: usize = 0;
        var flags: c_short = 0;

        fn pollErrno(_: [*]std.c.pollfd, _: std.c.nfds_t, _: c_int) c_int {
            std.c._errno().* = @intFromEnum(errno);
            return -1;
        }

        fn pollSource(descriptors: [*]std.c.pollfd, count: std.c.nfds_t, _: c_int) c_int {
            std.debug.assert(count == 5 and source < count);
            descriptors[source].revents = flags;
            return 1;
        }
    };
    const sources: Sources = .{ .quic = .{ 11, 12 }, .discovery = .{ 13, 14 }, .host = 15 };
    const CancelAfter = struct {
        threadlocal var checks: u8 = 0;
        fn check(_: ?*anyopaque) std.Io.Cancelable!void {
            checks += 1;
            if (checks == 2) return error.Canceled;
        }
    };
    var vtable = std.testing.io.vtable.*;
    vtable.checkCancel = CancelAfter.check;
    const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
    for ([_]std.posix.E{ .NOMEM, .INVAL }) |errno| {
        Failed.errno = errno;
        var buffer: [64]u8 = undefined;
        var expected: runner.LogExpectation = .{ .level = .err, .scope = "network_runtime", .message = try std.fmt.bufPrint(&buffer, "owner_poll_failed errno={s}", .{@tagName(errno)}) };
        const previous = runner.expected_log;
        defer runner.expected_log = previous;
        runner.expected_log = &expected;
        CancelAfter.checks = 0;
        const failed = pollWith(io, sources, 0, Failed.pollErrno);
        try std.testing.expect(failed.cancelled);
        try std.testing.expectEqual(error.WaitFailed, failed.failure.?);
        try std.testing.expect(expected.matched);
    }
    const cases = [_]struct { role: []const u8, family: []const u8, flags: c_short }{
        .{ .role = "quic", .family = "ip4", .flags = std.c.POLL.ERR },
        .{ .role = "quic", .family = "ip6", .flags = std.c.POLL.HUP },
        .{ .role = "discovery", .family = "ip4", .flags = std.c.POLL.NVAL },
        .{ .role = "discovery", .family = "ip6", .flags = std.c.POLL.ERR | std.c.POLL.IN },
        .{ .role = "host", .family = "none", .flags = std.c.POLL.HUP | std.c.POLL.IN },
    };
    for (cases, 0..) |case, index| {
        Failed.source = index;
        Failed.flags = case.flags;
        var buffer: [128]u8 = undefined;
        var expected: runner.LogExpectation = .{ .level = .err, .scope = "network_runtime", .message = try std.fmt.bufPrint(&buffer, "owner_poll_source_failed role={s} family={s} descriptor={d} revents={x}", .{ case.role, case.family, index + 11, case.flags }) };
        const previous = runner.expected_log;
        defer runner.expected_log = previous;
        runner.expected_log = &expected;
        const failed = pollWith(std.testing.io, sources, 0, Failed.pollSource);
        try std.testing.expectEqual(error.WaitSourceClosed, failed.failure.?);
        try std.testing.expectEqual(index == 3, failed.discoveryReady());
        try std.testing.expectEqual(index == 4, failed.host);
        try std.testing.expect(expected.matched);
    }
}
