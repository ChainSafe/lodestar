//! Nonblocking collector I/O with deadlines also bounded by exporter shutdown.
const std = @import("std");
const builtin = @import("builtin");
const wire = @import("wire.zig");

pub const Error = error{ InvalidAddress, UnsupportedPlatform, SocketFailed, Disconnected, Timeout, Stopped, InvalidHandshake };
pub const Endpoint = union(enum) {
    unix: struct { path: [108]u8, len: u8 },
    ip: std.Io.net.IpAddress,

    /// Native capture accepts filesystem Unix sockets and numeric IP:port endpoints.
    pub fn parse(text: []const u8) Error!Endpoint {
        if (text.len == 0 or std.mem.findScalar(u8, text, 0) != null) return error.InvalidAddress;
        if (std.mem.findScalar(u8, text, '/')) |_| {
            if (text.len >= @sizeOf(@FieldType(std.c.sockaddr.un, "path"))) return error.InvalidAddress;
            var endpoint: Endpoint = .{ .unix = .{ .path = @splat(0), .len = @intCast(text.len) } };
            @memcpy(endpoint.unix.path[0..text.len], text);
            return endpoint;
        }
        const ip = std.Io.net.IpAddress.parseLiteral(text) catch return error.InvalidAddress;
        if (ip.getPort() == 0) return error.InvalidAddress;
        return .{ .ip = ip };
    }
};

pub fn now(io: std.Io) i64 {
    return @intCast(@divTrunc(std.Io.Timestamp.now(io, .awake).nanoseconds, std.time.ns_per_ms));
}

pub const Socket = struct {
    fd: c_int,
    io: std.Io,
    stop_at: *const std.atomic.Value(i64),

    pub fn connect(endpoint: *const Endpoint, io: std.Io, stop_at: *const std.atomic.Value(i64)) Error!Socket {
        if (builtin.os.tag != .linux and builtin.os.tag != .macos) return error.UnsupportedPlatform;
        var address: extern union { any: std.c.sockaddr, ip: std.Io.Threaded.PosixAddress, un: std.c.sockaddr.un } = undefined;
        const length: std.c.socklen_t = switch (endpoint.*) {
            .unix => |*unix| blk: {
                address.un = .{ .path = @splat(0) };
                @memcpy(address.un.path[0..unix.len], unix.path[0..unix.len]);
                break :blk @intCast(@offsetOf(std.c.sockaddr.un, "path") + @as(usize, unix.len) + 1);
            },
            .ip => |*ip| std.Io.Threaded.addressToPosix(ip, &address.ip),
        };
        const fd = std.c.socket(address.any.family, std.c.SOCK.STREAM, 0);
        if (fd < 0) return error.SocketFailed;
        errdefer _ = std.c.close(fd);
        if (std.c.fcntl(fd, std.c.F.SETFD, @as(c_int, std.c.FD_CLOEXEC)) < 0) return error.SocketFailed;
        const flags = std.c.fcntl(fd, std.c.F.GETFL);
        if (flags < 0 or std.c.fcntl(fd, std.c.F.SETFL, flags | @as(c_int, @bitCast(std.c.O{ .NONBLOCK = true }))) < 0) return error.SocketFailed;
        if (builtin.os.tag == .macos) {
            const yes: c_int = 1;
            if (std.c.setsockopt(fd, std.c.SOL.SOCKET, std.c.SO.NOSIGPIPE, &std.mem.toBytes(yes), @sizeOf(c_int)) != 0) return error.SocketFailed;
        }
        const socket: Socket = .{ .fd = fd, .io = io, .stop_at = stop_at };
        if (std.c.connect(fd, &address.any, length) != 0) {
            switch (std.c.errno(-1)) {
                .INPROGRESS, .AGAIN, .INTR => {},
                else => return error.SocketFailed,
            }
            try socket.wait(std.c.POLL.OUT, now(io) + 5000);
            var result: c_int = 0;
            var size: std.c.socklen_t = @sizeOf(c_int);
            if (std.c.getsockopt(fd, std.c.SOL.SOCKET, std.c.SO.ERROR, std.mem.asBytes(&result), &size) != 0 or result != 0) return error.SocketFailed;
        }
        return socket;
    }

    pub fn close(self: *const Socket) void {
        _ = std.c.close(self.fd);
    }

    pub fn checkConnected(self: *const Socket) Error!void {
        var fd = [_]std.c.pollfd{.{ .fd = self.fd, .events = std.c.POLL.IN, .revents = 0 }};
        const result = std.c.poll(&fd, 1, 0);
        if (result < 0) {
            if (std.c.errno(result) == .INTR) return;
            return error.SocketFailed;
        }
        // The collector sends nothing after ServerHello. Readiness means EOF or a protocol violation.
        if (fd[0].revents != 0) return error.Disconnected;
    }

    fn check(self: *const Socket, deadline: i64) Error!void {
        const time = now(self.io);
        if (time >= self.stop_at.load(.acquire)) return error.Stopped;
        if (time >= deadline) return error.Timeout;
    }

    fn wait(self: *const Socket, events: c_short, deadline: i64) Error!void {
        while (true) {
            try self.check(deadline);
            var fd = [_]std.c.pollfd{.{ .fd = self.fd, .events = events, .revents = 0 }};
            const result = std.c.poll(&fd, 1, 20);
            if (result < 0) {
                if (std.c.errno(result) == .INTR) continue;
                return error.SocketFailed;
            }
            if (fd[0].revents & events != 0) return;
            if (fd[0].revents & (std.c.POLL.ERR | std.c.POLL.HUP | std.c.POLL.NVAL) != 0) return error.Disconnected;
        }
    }

    pub fn write(self: *const Socket, bytes: []const u8) Error!void {
        const deadline = now(self.io) + 5000;
        var offset: usize = 0;
        while (offset < bytes.len) {
            try self.check(deadline);
            const sent = std.c.send(self.fd, bytes[offset..].ptr, bytes.len - offset, if (builtin.os.tag == .linux) std.c.MSG.NOSIGNAL else 0);
            if (sent > 0) {
                offset += @intCast(sent);
            } else if (sent == 0) {
                return error.Disconnected;
            } else switch (std.c.errno(sent)) {
                .INTR => {},
                .AGAIN => try self.wait(std.c.POLL.OUT, deadline),
                else => return error.Disconnected,
            }
        }
    }

    fn read(self: *const Socket, bytes: []u8, deadline: i64) Error!void {
        var offset: usize = 0;
        while (offset < bytes.len) {
            try self.check(deadline);
            const received = std.c.recv(self.fd, bytes[offset..].ptr, bytes.len - offset, 0);
            if (received > 0) {
                offset += @intCast(received);
            } else if (received == 0) {
                return error.Disconnected;
            } else switch (std.c.errno(received)) {
                .INTR => {},
                .AGAIN => try self.wait(std.c.POLL.IN, deadline),
                else => return error.Disconnected,
            }
        }
    }

    pub fn handshake(self: *const Socket, hello: []const u8) (Error || wire.Error)!u64 {
        try self.write(hello);
        const deadline = now(self.io) + 5000;
        var byte: [1]u8 = undefined;
        try self.read(&byte, deadline);
        if (byte[0] != 2) return error.InvalidHandshake;
        var length: usize = 0;
        for (0..4) |i| {
            try self.read(&byte, deadline);
            length |= @as(usize, byte[0] & 127) << @as(u6, @intCast(i * 7));
            if (length > wire.hello_max) return error.InvalidHandshake;
            if (byte[0] & 128 == 0) {
                var buffer: [wire.hello_max]u8 = undefined;
                try self.read(buffer[0..length], deadline);
                return wire.serverHello(buffer[0..length]);
            }
        }
        return error.InvalidHandshake;
    }
};

test {
    _ = @import("socket_test.zig");
}
