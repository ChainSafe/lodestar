const std = @import("std");
const builtin = @import("builtin");
const SocketPair = @import("SocketPair.zig");

/// Read the actual kernel option, independently of the socket setup helper.
fn socketOption(handle: std.Io.net.Socket.Handle, level: i32, option: u32) !c_int {
    const p = std.posix;
    var value: c_int = 0;
    var len: p.socklen_t = @sizeOf(c_int);
    try std.testing.expectEqual(p.E.SUCCESS, p.errno(p.system.getsockopt(handle, level, option, std.mem.asBytes(&value), &len)));
    try std.testing.expectEqual(@as(p.socklen_t, @sizeOf(c_int)), len);
    return value;
}

test "UDP IPv6 listeners disable IP fragmentation" {
    const os = builtin.os.tag;
    if (os != .linux and os != .macos) return error.SkipZigTest;
    // Linux IPV6_MTU_DISCOVER=IPV6_PMTUDISC_DO; Darwin IPV6_DONTFRAG=1.
    const option: u32 = if (os == .linux) std.os.linux.IPV6.MTU_DISCOVER else 62;
    const expected: c_int = if (os == .linux) std.os.linux.IPV6.PMTUDISC_DO else 1;
    for ([_]std.Io.net.Ip6Address{ .loopback(0), .unspecified(0) }) |address| {
        var sockets = try SocketPair.bind(std.testing.io, .{ .ip6 = address });
        defer sockets.close(std.testing.io);
        try std.testing.expectEqual(expected, try socketOption(sockets.values[1].?.handle, std.posix.IPPROTO.IPV6, option));
    }
}

test "UDP IPv4 listeners disable IP fragmentation" {
    const os = builtin.os.tag;
    if (os != .linux and os != .macos) return error.SkipZigTest;
    // Linux IP_MTU_DISCOVER=IP_PMTUDISC_DO; Darwin IP_DONTFRAG=1.
    const option: u32 = if (os == .linux) std.os.linux.IP.MTU_DISCOVER else 28;
    const expected: c_int = if (os == .linux) std.os.linux.IP.PMTUDISC_DO else 1;
    for ([_]std.Io.net.Ip4Address{ .loopback(0), .unspecified(0) }) |address| {
        var sockets = try SocketPair.bind(std.testing.io, .{ .ip4 = address });
        defer sockets.close(std.testing.io);
        try std.testing.expectEqual(expected, try socketOption(sockets.values[0].?.handle, std.posix.IPPROTO.IP, option));
    }
}
