//! Zig 0.16.0 Threaded compatibility: native handles, address conversion and V6ONLY.
//! Re-audit these assumptions when upgrading Zig, including the Darwin socket ABI.
const std = @import("std");
const builtin = @import("builtin");
const Sockets = @import("sockets.zig").Sockets;
const net = std.Io.net;
const BindError = Sockets.BindError;
const os = builtin.os.tag;
pub const PosixAddress = std.Io.Threaded.PosixAddress;
pub const addressToPosix = std.Io.Threaded.addressToPosix;
pub const addressFromPosix = std.Io.Threaded.addressFromPosix;
pub const errnoBug = std.Io.Threaded.errnoBug;

pub const native_sockets = std.options.networking and (os == .linux or os == .macos);
comptime {
    if (!std.mem.eql(u8, builtin.zig_version_string, "0.16.0"))
        @compileError("UDP Threaded compatibility requires an audit for this Zig version");
}

pub fn threaded(io: std.Io) bool {
    return io.vtable.netBindIp == std.Io.Threaded.global_single_threaded.io().vtable.netBindIp;
}

pub fn threadedSend(io: std.Io) bool {
    return io.vtable.netSend == std.Io.Threaded.global_single_threaded.io().vtable.netSend;
}

pub fn threadedReceive(io: std.Io) bool {
    return io.vtable.batchAwaitConcurrent == std.Io.Threaded.global_single_threaded.io().vtable.batchAwaitConcurrent;
}

pub fn bindIp6(io: std.Io, ip: net.Ip6Address) BindError!net.Socket {
    const address: net.IpAddress = .{ .ip6 = ip };
    if (native_sockets) {
        // Zig 0.16 Threaded sets IPV6_V6ONLY to zero for ip6_only. Set it before
        // binding its native sockets; other I/O providers retain their own bind contract.
        if (threaded(io)) {
            try io.checkCancel();
            const p = std.posix;
            const flags = p.SOCK.DGRAM | if (os == .linux) p.SOCK.CLOEXEC else 0;
            const opened = p.system.socket(p.AF.INET6, flags, p.IPPROTO.UDP);
            try checkBindError(p.errno(opened));
            const fd: net.Socket.Handle = @intCast(opened);
            errdefer io.vtable.netClose(io.userdata, &.{fd});
            if (os != .linux) try checkBindError(p.errno(p.system.fcntl(fd, p.F.SETFD, @as(usize, p.FD_CLOEXEC))));
            const enabled: c_int = 1;
            // Darwin's IPV6_V6ONLY from netinet6/in6.h is absent in Zig 0.16.
            const ipv6_only = if (os == .macos) 27 else p.IPV6.V6ONLY;
            try checkBindError(p.errno(p.system.setsockopt(fd, p.IPPROTO.IPV6, ipv6_only, std.mem.asBytes(&enabled), @sizeOf(c_int))));
            var storage: std.Io.Threaded.PosixAddress = undefined;
            var len = std.Io.Threaded.addressToPosix(&address, &storage);
            try checkBindError(p.errno(p.system.bind(fd, &storage.any, len)));
            try checkBindError(p.errno(p.system.getsockname(fd, &storage.any, &len)));
            return .{ .handle = fd, .address = std.Io.Threaded.addressFromPosix(&storage) };
        }
    }
    return address.bind(io, .{ .mode = .dgram, .protocol = .udp, .ip6_only = true });
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
