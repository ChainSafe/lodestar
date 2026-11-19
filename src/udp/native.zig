//! Native UDP operations. Linux batches preserve the caller's datagram boundaries.
const std = @import("std");
const builtin = @import("builtin");
const compat = @import("compat.zig");
const Sockets = @import("sockets.zig").Sockets;
const net = std.Io.net;
const assert = std.debug.assert;
const SendError = Sockets.SendError;
const SendOutcome = Sockets.SendOutcome;
const ReceiveError = Sockets.ReceiveError;
const os = builtin.os.tag;
const linux = std.os.linux;
const gso_payload_max = 65_507;

pub fn receive(
    io: std.Io,
    handle: net.Socket.Handle,
    buffer: []u8,
) ReceiveError!?net.IncomingMessage {
    const p = std.posix;
    var storage: compat.PosixAddress = undefined;
    var vector: p.iovec = .{ .base = buffer.ptr, .len = buffer.len };
    var header: p.msghdr = .{
        .name = &storage.any,
        .namelen = @sizeOf(compat.PosixAddress),
        .iov = (&vector)[0..1],
        .iovlen = 1,
        .control = null,
        .controllen = 0,
        .flags = 0,
    };
    try io.checkCancel();
    const received = p.system.recvmsg(handle, &header, p.MSG.NOSIGNAL | p.MSG.DONTWAIT);
    return switch (p.errno(received)) {
        .SUCCESS => .{
            .from = compat.addressFromPosix(&storage),
            .data = buffer[0..@intCast(received)],
            .control = &.{},
            .flags = .{
                .eor = (header.flags & p.MSG.EOR) != 0,
                .trunc = (header.flags & p.MSG.TRUNC) != 0,
                .ctrunc = (header.flags & p.MSG.CTRUNC) != 0,
                .oob = (header.flags & p.MSG.OOB) != 0,
                .errqueue = if (@hasDecl(p.MSG, "ERRQUEUE")) (header.flags & p.MSG.ERRQUEUE) != 0 else false,
            },
        },
        .AGAIN, .INTR => null,
        else => |err| receiveError(err),
    };
}

pub fn send(
    io: std.Io,
    handle: net.Socket.Handle,
    address: *const net.IpAddress,
    bytes: []const u8,
) SendError!void {
    const p = std.posix;
    var storage: compat.PosixAddress = undefined;
    const length = compat.addressToPosix(address, &storage);
    try io.checkCancel();
    const sent = p.system.sendto(
        handle,
        bytes.ptr,
        bytes.len,
        p.MSG.NOSIGNAL | p.MSG.DONTWAIT,
        &storage.any,
        length,
    );
    return switch (p.errno(sent)) {
        .SUCCESS => assert(@as(usize, @intCast(sent)) == bytes.len),
        else => |err| sendError(err),
    };
}

pub const SendScratch = if (os == .linux) struct {
    headers: [Sockets.BatchScratch.capacity]linux.mmsghdr,
    addresses: [Sockets.BatchScratch.capacity]compat.PosixAddress,
    vectors: [Sockets.BatchScratch.capacity]std.posix.iovec,
    controls: [Sockets.BatchScratch.capacity]Segmentation,
    groups: [Sockets.BatchScratch.capacity]struct { end: usize, bytes: usize },
} else struct {};

const Segmentation = extern struct {
    header: linux.cmsghdr,
    size: u16,
};

/// Positive sendmmsg results hide the next group's errno. Retry only the unsent suffix.
pub fn sendMany(
    io: std.Io,
    handle: net.Socket.Handle,
    messages: []const Sockets.Outgoing,
    scratch: *SendScratch,
) SendOutcome {
    assert(messages.len > 0 and messages.len <= Sockets.BatchScratch.capacity);
    if (comptime os != .linux) {
        for (messages, 0..) |message, sent| {
            const address = message.to.toNetwork();
            send(io, handle, &address, message.bytes) catch |err|
                return .{ .sent = sent, .failure = err };
        }
        return .{ .sent = messages.len, .failure = null };
    }
    var group_count = prepareSend(messages, scratch, true);
    var group: usize = 0;
    var sent: usize = 0;
    var base: usize = 0;
    // Each successful call advances at least one datagram; fallback rebuilds the suffix once.
    for (0..messages.len + 1) |_| {
        if (sent == messages.len) return .{ .sent = sent, .failure = null };
        io.checkCancel() catch |err| return .{ .sent = sent, .failure = err };
        const result = linux.sendmmsg(
            handle,
            scratch.headers[group..].ptr,
            @intCast(group_count - group),
            linux.MSG.NOSIGNAL | linux.MSG.DONTWAIT,
        );
        const errno = linux.errno(result);
        if (errno == .SUCCESS) {
            assert(result > 0 and result <= group_count - group);
            for (
                scratch.headers[group..][0..result],
                scratch.groups[group..][0..result],
            ) |header, accepted|
                assert(header.len == accepted.bytes);
            group += result;
            sent = base + scratch.groups[group - 1].end;
        } else if (scratch.headers[group].hdr.iovlen > 1 and segmentationRefused(errno)) {
            // GSO support can depend on the route. Plain sends retain the original error and
            // accepted-prefix semantics, without replaying groups already handed to the kernel.
            base = sent;
            group_count = prepareSend(messages[sent..], scratch, false);
            group = 0;
        } else return .{ .sent = sent, .failure = sendError(errno) };
    }
    assert(sent == messages.len);
    return .{ .sent = sent, .failure = null };
}

fn segmentationRefused(errno: std.posix.E) bool {
    return switch (errno) {
        .INVAL, .IO, .MSGSIZE, .NOPROTOOPT, .OPNOTSUPP => true,
        else => false,
    };
}

fn prepareSend(messages: []const Sockets.Outgoing, scratch: *SendScratch, segment: bool) usize {
    for (messages, 0..) |message, i|
        scratch.vectors[i] = .{ .base = @constCast(message.bytes.ptr), .len = message.bytes.len };
    var begin: usize = 0;
    var groups: usize = 0;
    while (begin < messages.len) : (groups += 1) {
        const first = messages[begin];
        var end = begin + 1;
        var bytes = first.bytes.len;
        if (segment and bytes > 0 and bytes <= gso_payload_max) {
            while (end < messages.len) {
                const next = messages[end];
                if (!first.to.eql(next.to) or next.bytes.len == 0 or
                    next.bytes.len > first.bytes.len or bytes + next.bytes.len > gso_payload_max) break;
                bytes += next.bytes.len;
                end += 1;
                if (next.bytes.len < first.bytes.len) break;
            }
        }
        const address = first.to.toNetwork();
        scratch.headers[groups] = .{ .hdr = .{
            .name = &scratch.addresses[groups].any,
            .namelen = compat.addressToPosix(&address, &scratch.addresses[groups]),
            .iov = scratch.vectors[begin..end].ptr,
            .iovlen = end - begin,
            .control = null,
            .controllen = 0,
            .flags = 0,
        }, .len = 0 };
        if (end - begin > 1) {
            const control = &scratch.controls[groups];
            control.* = std.mem.zeroes(Segmentation);
            control.header = .{
                .len = @offsetOf(Segmentation, "size") + @sizeOf(u16),
                .level = linux.IPPROTO.UDP,
                .type = linux.UDP.SEGMENT,
            };
            control.size = @intCast(first.bytes.len);
            scratch.headers[groups].hdr.control = control;
            scratch.headers[groups].hdr.controllen = @sizeOf(Segmentation);
        }
        scratch.groups[groups] = .{ .end = end, .bytes = bytes };
        begin = end;
    }
    return groups;
}

pub const ReceiveScratch = if (os == .linux) struct {
    headers: [Sockets.receive_batch_max]linux.mmsghdr,
    addresses: [Sockets.receive_batch_max]compat.PosixAddress,
    vectors: [Sockets.receive_batch_max]std.posix.iovec,
} else struct {};

pub fn receiveMany(
    io: std.Io,
    handle: net.Socket.Handle,
    slots: []Sockets.ReceiveSlot,
    scratch: *ReceiveScratch,
) ReceiveError!usize {
    assert(slots.len > 0 and slots.len <= Sockets.receive_batch_max);
    for (slots, 0..) |slot, i| {
        scratch.vectors[i] = .{ .base = slot.buffer.ptr, .len = slot.buffer.len };
        scratch.headers[i] = .{ .hdr = .{
            .name = &scratch.addresses[i].any,
            .namelen = @sizeOf(compat.PosixAddress),
            .iov = scratch.vectors[i..].ptr,
            .iovlen = 1,
            .control = null,
            .controllen = 0,
            .flags = 0,
        }, .len = 0 };
    }
    try io.checkCancel();
    const result = linux.recvmmsg(
        handle,
        &scratch.headers,
        @intCast(slots.len),
        linux.MSG.NOSIGNAL | linux.MSG.DONTWAIT,
        null,
    );
    switch (linux.errno(result)) {
        .SUCCESS => {
            assert(result > 0 and result <= slots.len);
            for (slots[0..result], 0..) |*slot, i| {
                const header = scratch.headers[i];
                assert(header.len <= slot.buffer.len);
                slot.message = .{
                    .from = compat.addressFromPosix(&scratch.addresses[i]),
                    .data = slot.buffer[0..header.len],
                    .control = &.{},
                    .flags = .{
                        .eor = (header.hdr.flags & linux.MSG.EOR) != 0,
                        .trunc = (header.hdr.flags & linux.MSG.TRUNC) != 0,
                        .ctrunc = (header.hdr.flags & linux.MSG.CTRUNC) != 0,
                        .oob = (header.hdr.flags & linux.MSG.OOB) != 0,
                        .errqueue = (header.hdr.flags & linux.MSG.ERRQUEUE) != 0,
                    },
                };
            }
            return result;
        },
        .AGAIN, .INTR => return 0,
        else => |err| return receiveError(err),
    }
}

fn receiveError(errno: std.posix.E) ReceiveError {
    return switch (errno) {
        .NFILE => error.SystemFdQuotaExceeded,
        .MFILE => error.ProcessFdQuotaExceeded,
        .NOBUFS, .NOMEM => error.SystemResources,
        .NOTCONN, .PIPE => error.SocketUnconnected,
        .MSGSIZE => error.MessageOversize,
        .CONNRESET => error.ConnectionResetByPeer,
        .NETDOWN => error.NetworkDown,
        .BADF, .FAULT, .INVAL, .NOTSOCK, .OPNOTSUPP => |err| compat.errnoBug(err),
        else => |err| std.posix.unexpectedErrno(err),
    };
}

fn sendError(errno: std.posix.E) SendError {
    return switch (errno) {
        .SUCCESS => unreachable,
        // UDP destinations with port zero produce EINVAL on Linux.
        .PERM, .INVAL => error.DestinationRefused,
        .ACCES => error.AccessDenied,
        .ALREADY => error.FastOpenAlreadyInProgress,
        .CONNRESET => error.ConnectionResetByPeer,
        .MSGSIZE => error.MessageOversize,
        .AGAIN => error.WouldBlock,
        .NOBUFS, .NOMEM => error.SystemResources,
        .PIPE, .NOTCONN => error.SocketUnconnected,
        .AFNOSUPPORT => error.AddressFamilyUnsupported,
        .HOSTUNREACH => error.HostUnreachable,
        .NETUNREACH => error.NetworkUnreachable,
        .NETDOWN => error.NetworkDown,
        .BADF, .DESTADDRREQ, .FAULT, .ISCONN, .NOTSOCK, .OPNOTSUPP => |err| compat.errnoBug(err),
        else => |err| std.posix.unexpectedErrno(err),
    };
}

pub fn capped(reported: ?u32, requested: u32) bool {
    const full: u64 = if (os == .linux) @as(u64, requested) * 2 else requested;
    return (reported orelse return false) < full;
}

pub fn setBuffer(handle: net.Socket.Handle, option: u32, bytes: u32) void {
    const p = std.posix;
    const value: c_int = @intCast(bytes);
    // The kernel caps the size silently on Linux and refuses it elsewhere. Reading the size back
    // decides the outcome, so the result is ignored.
    _ = p.system.setsockopt(handle, p.SOL.SOCKET, option, std.mem.asBytes(&value), @sizeOf(c_int));
}

pub fn readBuffer(handle: net.Socket.Handle, option: u32) ?u32 {
    const p = std.posix;
    var value: c_int = 0;
    var len: p.socklen_t = @sizeOf(c_int);
    if (p.errno(p.system.getsockopt(handle, p.SOL.SOCKET, option, std.mem.asBytes(&value), &len)) != .SUCCESS) return null;
    if (len != @sizeOf(c_int)) return null;
    return std.math.cast(u32, value);
}

pub fn readDrops(handle: net.Socket.Handle) ?u32 {
    const p = std.posix;
    // SK_MEMINFO_DROPS in linux/sock_diag.h. SO_MEMINFO reads the counter SO_RXQ_OVFL reports,
    // without ancillary data on every receive.
    const drops_index = 8;
    var meminfo: [drops_index + 1]u32 = @splat(0);
    var len: p.socklen_t = @sizeOf(@TypeOf(meminfo));
    if (p.errno(p.system.getsockopt(handle, p.SOL.SOCKET, p.SO.MEMINFO, std.mem.asBytes(&meminfo), &len)) != .SUCCESS) return null;
    if (len < @sizeOf(@TypeOf(meminfo))) return null;
    return meminfo[drops_index];
}
