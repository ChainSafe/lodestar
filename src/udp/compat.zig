//! Zig 0.17.1 Threaded compatibility: native handles and address conversion.
//! Re-audit these assumptions when upgrading Zig, including the Darwin socket ABI.
const std = @import("std");
const builtin = @import("builtin");
const SocketPair = @import("SocketPair.zig");
const net = std.Io.net;
const BindError = SocketPair.BindError;
const os = builtin.os.tag;
pub const PosixAddress = std.Io.Threaded.PosixAddress;
pub const addressToPosix = std.Io.Threaded.addressToPosix;
pub const addressFromPosix = std.Io.Threaded.addressFromPosix;
pub const errnoBug = std.Io.Threaded.errnoBug;

pub const native_sockets = std.options.networking;
comptime {
    if (!std.mem.eql(u8, builtin.zig_version_string, "0.17.1"))
        @compileError("UDP Threaded compatibility requires an audit for this Zig version");
}

pub fn threaded(io: std.Io) bool {
    return io.vtable.netBindIp == std.Io.Threaded.global_single_threaded.io().vtable.netBindIp;
}

pub fn threadedSend(io: std.Io) bool {
    return io.vtable.operate == std.Io.Threaded.global_single_threaded.io().vtable.operate;
}

pub fn threadedReceive(io: std.Io) bool {
    const vtable = std.Io.Threaded.global_single_threaded.io().vtable;
    return io.vtable.operate == vtable.operate and io.vtable.batchAwaitConcurrent == vtable.batchAwaitConcurrent;
}

pub fn bindIp6(io: std.Io, ip: net.Ip6Address) BindError!net.Socket {
    const address: net.IpAddress = .{ .ip6 = ip };
    return address.bind(io, .{ .mode = .dgram, .protocol = .udp, .ip6_only = true });
}

/// An unbound native UDP socket of `address`'s family. IPv6 sockets accept IPv6 only.
pub fn open(io: std.Io, address: net.IpAddress) BindError!net.Socket.Handle {
    try io.checkCancel();
    const p = std.posix;
    const flags = p.SOCK.DGRAM | if (os == .linux) p.SOCK.CLOEXEC else 0;
    const opened = p.system.socket(if (address == .ip4) p.AF.INET else p.AF.INET6, flags, p.IPPROTO.UDP);
    try checkBindError(p.errno(opened));
    const fd: net.Socket.Handle = @intCast(opened);
    errdefer (net.Socket{ .handle = fd, .address = address }).close(io);
    if (os != .linux) try checkBindError(p.errno(p.system.fcntl(fd, p.F.SETFD, @as(usize, p.FD_CLOEXEC))));
    if (address == .ip6) {
        const enabled: c_int = 1;
        const ipv6_only = p.IPV6.V6ONLY;
        try checkBindError(p.errno(p.system.setsockopt(fd, p.IPPROTO.IPV6, ipv6_only, std.mem.asBytes(&enabled), @sizeOf(c_int))));
    }
    return fd;
}

pub fn checkBindError(err: std.posix.E) BindError!void {
    return switch (err) {
        .SUCCESS => {},
        .ADDRINUSE => error.AddressInUse,
        .ADDRNOTAVAIL => error.AddressUnavailable,
        .AFNOSUPPORT => error.AddressFamilyUnsupported,
        .NOMEM, .NOBUFS => error.SystemResources,
        .MFILE => error.ProcessFdQuotaExceeded,
        .NFILE => error.SystemFdQuotaExceeded,
        .NETDOWN => error.NetworkDown,
        .PROTONOSUPPORT => error.ProtocolUnsupportedByAddressFamily,
        .PROTOTYPE => error.SocketModeUnsupported,
        .NOPROTOOPT => error.OptionUnsupported,
        else => std.posix.unexpectedErrno(err),
    };
}
