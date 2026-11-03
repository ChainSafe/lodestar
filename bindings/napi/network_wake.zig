const std = @import("std");
const builtin = @import("builtin");

/// The owner's wake pipe. The runtime mutex guards `pending`, so a signal writes only when the
/// owner has drained every earlier one.
pub const Wake = struct {
    read_fd: i32,
    write_fd: i32,
    pending: bool = false,
    /// What `drain` reads and discards. A field rather than a local so ReleaseSafe does not fill it
    /// on every drain.
    drained: [4096]u8 = undefined,

    pub fn init() !Wake {
        if (builtin.os.tag != .linux and builtin.os.tag != .macos) return error.UnsupportedWait;
        var fds: [2]i32 = undefined;
        if (std.c.pipe(&fds) != 0) return error.NetworkWakeFailed;
        errdefer {
            _ = std.c.close(fds[0]);
            _ = std.c.close(fds[1]);
        }
        for (fds) |fd| {
            if (std.c.fcntl(fd, std.c.F.SETFD, @as(c_int, std.c.FD_CLOEXEC)) < 0) return error.NetworkWakeFailed;
            const flags = std.c.fcntl(fd, std.c.F.GETFL);
            if (flags < 0) return error.NetworkWakeFailed;
            const nonblock: c_int = @bitCast(std.c.O{ .NONBLOCK = true });
            if (std.c.fcntl(fd, std.c.F.SETFL, flags | nonblock) < 0) return error.NetworkWakeFailed;
        }
        return .{ .read_fd = fds[0], .write_fd = fds[1] };
    }

    pub fn deinit(self: *Wake) void {
        _ = std.c.close(self.write_fd);
        _ = std.c.close(self.read_fd);
        self.* = .{ .read_fd = -1, .write_fd = -1 };
    }

    pub fn signal(self: *Wake) !void {
        if (self.pending) return;
        const byte = [_]u8{1};
        const result = std.c.write(self.write_fd, &byte, byte.len);
        if (result != 1 and !(result < 0 and std.c.errno(result) == .AGAIN)) return error.NetworkWakeFailed;
        self.pending = true;
    }

    pub fn drain(self: *Wake) !void {
        self.pending = false;
        const result = std.c.read(self.read_fd, &self.drained, self.drained.len);
        if (result > 0) return;
        if (result < 0 and std.c.errno(result) == .AGAIN) return;
        return error.NetworkWakeFailed;
    }
};

test "wake writes once until a drain and reports permanently invalid descriptors" {
    var wake = try Wake.init();
    defer wake.deinit();
    var readable = [_]std.c.pollfd{.{ .fd = wake.read_fd, .events = std.c.POLL.IN, .revents = 0 }};
    for (0..100_000) |_| try wake.signal();
    try wake.drain();
    try std.testing.expectEqual(@as(c_int, 0), std.c.poll(&readable, 1, 0));
    try wake.signal();
    try std.testing.expectEqual(@as(c_int, 1), std.c.poll(&readable, 1, 0));
    var invalid = wake;
    invalid.pending = false;
    invalid.write_fd = -1;
    try std.testing.expectError(error.NetworkWakeFailed, invalid.signal());
    invalid.read_fd = -1;
    try std.testing.expectError(error.NetworkWakeFailed, invalid.drain());
}
