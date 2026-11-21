const std = @import("std");
const socket = @import("socket.zig");

test "xray endpoint parsing bounds Unix paths and requires explicit TCP ports" {
    try std.testing.expect((try socket.Endpoint.parse("/run/xray/capture.sock")) == .unix);
    try std.testing.expectEqual(@as(u16, 19100), (try socket.Endpoint.parse("127.0.0.1:19100")).ip.getPort());
    try std.testing.expectEqual(@as(u16, 19100), (try socket.Endpoint.parse("[::1]:19100")).ip.getPort());
    for ([_][]const u8{ "", "127.0.0.1", "[::1]:0", "/tmp/a\x00b", "example.com:123", "127.0.0.1:65536" }) |text|
        try std.testing.expectError(error.InvalidAddress, socket.Endpoint.parse(text));
    const long: [109]u8 = @splat('/');
    try std.testing.expectError(error.InvalidAddress, socket.Endpoint.parse(&long));
}

test "xray socket observes shutdown before waiting for collector input" {
    const stop: std.atomic.Value(i64) = .init(0);
    const live: socket.Socket = .{ .fd = -1, .io = std.testing.io, .stop_at = &stop };
    try std.testing.expectError(error.Stopped, live.write("bytes"));
}

fn pair() ![2]std.c.fd_t {
    var fds: [2]std.c.fd_t = undefined;
    if (std.c.socketpair(std.c.AF.UNIX, std.c.SOCK.STREAM, 0, &fds) != 0) return error.SocketFailed;
    errdefer for (fds) |fd| {
        _ = std.c.close(fd);
    };
    for (fds) |fd| {
        const flags = std.c.fcntl(fd, std.c.F.GETFL);
        if (flags < 0 or std.c.fcntl(fd, std.c.F.SETFL, flags | @as(c_int, @bitCast(std.c.O{ .NONBLOCK = true }))) < 0) return error.SocketFailed;
    }
    return fds;
}

test "xray socket detects idle collector closure" {
    const fds = try pair();
    defer _ = std.c.close(fds[0]);
    const stop: std.atomic.Value(i64) = .init(std.math.maxInt(i64));
    const live: socket.Socket = .{ .fd = fds[0], .io = std.testing.io, .stop_at = &stop };
    try live.checkConnected();
    _ = std.c.close(fds[1]);
    try std.testing.expectError(error.Disconnected, live.checkConnected());
}

test "xray socket stops a blocked write without collector progress" {
    const fds = try pair();
    defer for (fds) |fd| {
        _ = std.c.close(fd);
    };
    var stop: std.atomic.Value(i64) = .init(std.math.maxInt(i64));
    const live: socket.Socket = .{ .fd = fds[0], .io = std.testing.io, .stop_at = &stop };
    const Writer = struct {
        fn run(connection: *const socket.Socket) void {
            const bytes = std.testing.allocator.alloc(u8, 8 * 1024 * 1024) catch unreachable;
            defer std.testing.allocator.free(bytes);
            @memset(bytes, 3);
            std.testing.expectError(error.Stopped, connection.write(bytes)) catch @panic("blocked write ignored shutdown");
        }
    };
    const thread = try std.Thread.spawn(.{}, Writer.run, .{&live});
    defer thread.join();
    var ready = [_]std.c.pollfd{.{ .fd = fds[1], .events = std.c.POLL.IN, .revents = 0 }};
    const result = std.c.poll(&ready, 1, 5000);
    stop.store(0, .release);
    try std.testing.expectEqual(@as(c_int, 1), result);
}

test "xray socket preserves bytes through partial writes" {
    const fds = try pair();
    defer for (fds) |fd| {
        _ = std.c.close(fd);
    };
    const capacity: c_int = 4096;
    try std.testing.expectEqual(@as(c_int, 0), std.c.setsockopt(fds[0], std.c.SOL.SOCKET, std.c.SO.SNDBUF, std.mem.asBytes(&capacity), @sizeOf(c_int)));
    const stop: std.atomic.Value(i64) = .init(std.math.maxInt(i64));
    const live: socket.Socket = .{ .fd = fds[0], .io = std.testing.io, .stop_at = &stop };
    const Reader = struct {
        fn run(fd: std.c.fd_t) void {
            var received: usize = 0;
            var bytes: [4000]u8 = undefined;
            const deadline = socket.now(std.testing.io) + 5000;
            while (received < 1024 * 1024 and socket.now(std.testing.io) < deadline) {
                const count = std.c.recv(fd, &bytes, bytes.len, 0);
                if (count > 0) {
                    for (bytes[0..@intCast(count)], received..) |byte, index| std.debug.assert(byte == @as(u8, @truncate(index)));
                    received += @intCast(count);
                } else {
                    var ready = [_]std.c.pollfd{.{ .fd = fd, .events = std.c.POLL.IN, .revents = 0 }};
                    _ = std.c.poll(&ready, 1, 20);
                }
            }
            std.debug.assert(received == 1024 * 1024);
        }
    };
    const thread = try std.Thread.spawn(.{}, Reader.run, .{fds[1]});
    defer thread.join();
    const bytes = try std.testing.allocator.alloc(u8, 1024 * 1024);
    defer std.testing.allocator.free(bytes);
    for (bytes, 0..) |*byte, index| byte.* = @truncate(index);
    try live.write(bytes);
}
