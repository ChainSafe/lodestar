//! Linux and macOS system calls for SocketPair's native path: destination and source control
//! messages on both, sendmmsg, recvmmsg and GSO on Linux. Batches keep the caller's datagram
//! boundaries.
const std = @import("std");
const builtin = @import("builtin");
const compat = @import("compat.zig");
const SocketPair = @import("SocketPair.zig");
const Address = @import("address.zig").Address;
const net = std.Io.net;
const assert = std.debug.assert;
const SendError = SocketPair.SendError;
const SendOutcome = SocketPair.SendOutcome;
const ReceiveError = SocketPair.ReceiveError;
const os = builtin.os.tag;
const linux = std.os.linux;
const ip4_total_length_max = std.math.maxInt(u16);
const ip4_header_size = 20;
const udp_header_size = 8;
/// Generic Segmentation Offload (GSO) is a Linux feature for sending many UDP datagrams with one pass through the kernel.
const gso_payload_max = ip4_total_length_max - ip4_header_size - udp_header_size;

const ControlHeader = if (os == .linux) linux.cmsghdr else extern struct { len: u32, level: i32, type: i32 };
const control_alignment = if (os == .linux) @sizeOf(usize) else @sizeOf(u32);
const control_data = std.mem.alignForward(usize, @sizeOf(ControlHeader), control_alignment);
// Darwin's values from netinet/in.h and netinet6/in6.h are absent from std.posix in Zig 0.16.
const ip_pktinfo = if (os == .linux) linux.IP.PKTINFO else 26;
const ipv6_recvpktinfo = if (os == .linux) linux.IPV6.RECVPKTINFO else 61;
const ipv6_pktinfo = if (os == .linux) linux.IPV6.PKTINFO else 46;
const ip_dontfrag = 28;
const ipv6_dontfrag = 62;
pub const control_size = 64;
pub const Control = [control_size]u8;
comptime {
    assert(controlSpace(@sizeOf(std.posix.in6_pktinfo)) + controlSpace(@sizeOf(u16)) <= control_size);
    assert(@sizeOf(std.posix.in_pktinfo) <= @sizeOf(std.posix.in6_pktinfo));
}

fn controlSpace(len: usize) usize {
    return control_data + std.mem.alignForward(usize, len, control_alignment);
}

fn putControl(control: []align(8) u8, level: i32, kind: i32, value: anytype) usize {
    const space = controlSpace(@sizeOf(@TypeOf(value)));
    @memset(control[0..space], 0);
    const header: *ControlHeader = @ptrCast(control.ptr);
    header.* = .{ .len = @intCast(control_data + @sizeOf(@TypeOf(value))), .level = level, .type = kind };
    @memcpy(control[control_data..][0..@sizeOf(@TypeOf(value))], std.mem.asBytes(&value));
    return space;
}

pub fn linkLocal(octets: [16]u8) bool {
    return octets[0] == 0xfe and octets[1] & 0xc0 == 0x80;
}

/// Asks the kernel to report each datagram's destination address.
pub fn reportDestination(handle: net.Socket.Handle, family: std.meta.Tag(net.IpAddress)) std.posix.E {
    const p = std.posix;
    const enabled: c_int = 1;
    const level: i32, const option: u32 = switch (family) {
        .ip4 => .{ p.IPPROTO.IP, ip_pktinfo },
        .ip6 => .{ p.IPPROTO.IPV6, ipv6_recvpktinfo },
    };
    return p.errno(p.system.setsockopt(handle, level, option, std.mem.asBytes(&enabled), @sizeOf(c_int)));
}

/// Disables fragmentation. Linux PROBE ignores cached path MTUs so QUIC can validate its own
/// MTU probes rather than being constrained by ICMP messages the transport has not validated.
pub fn preventFragmentation(handle: net.Socket.Handle, family: std.meta.Tag(net.IpAddress)) std.posix.E {
    const p = std.posix;
    if (os == .linux and family == .ip6) {
        // Linux's IPv6 append path checks DONTFRAG separately from the PMTU policy.
        const enabled: c_int = 1;
        const err = p.errno(p.system.setsockopt(handle, p.IPPROTO.IPV6, linux.IPV6.DONTFRAG, std.mem.asBytes(&enabled), @sizeOf(c_int)));
        if (err != .SUCCESS) return err;
    }
    const level: i32, const option: u32 = switch (family) {
        .ip4 => .{ p.IPPROTO.IP, if (os == .linux) linux.IP.MTU_DISCOVER else ip_dontfrag },
        .ip6 => .{ p.IPPROTO.IPV6, if (os == .linux) linux.IPV6.MTU_DISCOVER else ipv6_dontfrag },
    };
    const value: c_int = if (os == .linux) linux.IP.PMTUDISC_PROBE else 1;
    return p.errno(p.system.setsockopt(handle, level, option, std.mem.asBytes(&value), @sizeOf(c_int)));
}

/// The local address a datagram was sent to, with `port`. Null when the control data names none.
/// Rejects unspecified, multicast and broadcast destinations. macOS leaves spec_dst unset, so
/// an IPv4 subnet broadcast passes.
pub fn destination(control: []const u8, port: u16) error{InvalidDestinationAddress}!?Address {
    const p = std.posix;
    var offset: usize = 0;
    while (control.len - offset >= @sizeOf(ControlHeader)) {
        const header = std.mem.bytesToValue(ControlHeader, control[offset..][0..@sizeOf(ControlHeader)]);
        if (header.len < control_data or header.len > control.len - offset) return null;
        const data = control[offset + control_data .. offset + header.len];
        if (header.level == p.IPPROTO.IP and header.type == ip_pktinfo and data.len >= @sizeOf(p.in_pktinfo)) {
            const info = std.mem.bytesToValue(p.in_pktinfo, data[0..@sizeOf(p.in_pktinfo)]);
            const octets: [4]u8 = @bitCast(info.addr);
            // Linux reports the receiving interface's address as spec_dst for broadcast and multicast.
            if (os == .linux and info.addr != info.spec_dst) return error.InvalidDestinationAddress;
            if (octets[0] >= 224 or info.addr == 0) return error.InvalidDestinationAddress;
            return .{ .ip4 = .{ .octets = octets, .port = port } };
        }
        if (header.level == p.IPPROTO.IPV6 and header.type == ipv6_pktinfo and data.len >= @sizeOf(p.in6_pktinfo)) {
            const info = std.mem.bytesToValue(p.in6_pktinfo, data[0..@sizeOf(p.in6_pktinfo)]);
            if (info.addr[0] == 0xff or std.mem.allEqual(u8, &info.addr, 0)) return error.InvalidDestinationAddress;
            const interface: u32 = if (linkLocal(info.addr)) @intCast(info.ifindex) else 0;
            return .{ .ip6 = .{ .octets = info.addr, .port = port, .interface = interface } };
        }
        offset += std.mem.alignForward(usize, header.len, control_alignment);
        if (offset > control.len) return null;
    }
    return null;
}

pub fn pinned(from: ?Address) ?Address {
    const source = from orelse return null;
    return switch (source) {
        inline else => |ip| if (std.mem.allEqual(u8, &ip.octets, 0)) null else source,
    };
}

/// Writes the packet-info message pinning `from` as the source and returns its length. A non-zero
/// IPv4 interface index would override the address on Darwin.
pub fn pinSource(control: []align(8) u8, from: Address) usize {
    const p = std.posix;
    return switch (from) {
        .ip4 => |ip| putControl(control, p.IPPROTO.IP, ip_pktinfo, p.in_pktinfo{
            .ifindex = 0,
            .spec_dst = @bitCast(ip.octets),
            .addr = 0,
        }),
        .ip6 => |ip| putControl(control, p.IPPROTO.IPV6, ipv6_pktinfo, p.in6_pktinfo{
            .addr = ip.octets,
            .ifindex = if (linkLocal(ip.octets)) @intCast(ip.interface) else 0,
        }),
    };
}

pub fn receive(
    io: std.Io,
    handle: net.Socket.Handle,
    buffer: []u8,
    control: *align(8) Control,
) ReceiveError!?net.IncomingMessage {
    const p = std.posix;
    var storage: compat.PosixAddress = undefined;
    var vector: p.iovec = .{ .base = buffer.ptr, .len = buffer.len };
    var header: p.msghdr = .{
        .name = &storage.any,
        .namelen = @sizeOf(compat.PosixAddress),
        .iov = (&vector)[0..1],
        .iovlen = 1,
        .control = control,
        .controllen = control_size,
        .flags = 0,
    };
    try io.checkCancel();
    const received = p.system.recvmsg(handle, &header, p.MSG.NOSIGNAL | p.MSG.DONTWAIT);
    return switch (p.errno(received)) {
        .SUCCESS => .{
            .from = compat.addressFromPosix(&storage),
            .data = buffer[0..@intCast(received)],
            .control = control[0..@intCast(header.controllen)],
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
    from: ?Address,
    bytes: []const u8,
) SendError!void {
    const p = std.posix;
    var storage: compat.PosixAddress = undefined;
    const length = compat.addressToPosix(address, &storage);
    try io.checkCancel();
    const sent = if (pinned(from)) |source| blk: {
        var control: Control align(8) = undefined;
        var vector: p.iovec_const = .{ .base = bytes.ptr, .len = bytes.len };
        const header: p.msghdr_const = .{
            .name = &storage.any,
            .namelen = length,
            .iov = (&vector)[0..1],
            .iovlen = 1,
            .control = &control,
            .controllen = @intCast(pinSource(&control, source)),
            .flags = 0,
        };
        break :blk p.system.sendmsg(handle, &header, p.MSG.NOSIGNAL | p.MSG.DONTWAIT);
    } else p.system.sendto(
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

/// The source address the kernel routes `peer` from. Connecting a UDP socket sends nothing, and
/// disconnecting makes the next call resolve afresh.
pub fn route(io: std.Io, probe: net.Socket.Handle, peer: *const net.IpAddress) SocketPair.SourceError!Address {
    const p = std.posix;
    var storage: compat.PosixAddress = undefined;
    const peer_length = compat.addressToPosix(peer, &storage);
    try io.checkCancel();
    if (p.errno(p.system.connect(probe, &storage.any, peer_length)) != .SUCCESS) return error.SourceUnavailable;
    var length: p.socklen_t = @sizeOf(compat.PosixAddress);
    const named = p.errno(p.system.getsockname(probe, &storage.any, &length));
    // Darwin reports EINVAL for an address shorter than the socket's family requires.
    var unspecified = std.mem.zeroes(compat.PosixAddress);
    unspecified.any.family = p.AF.UNSPEC;
    const disconnected = p.errno(p.system.connect(probe, &unspecified.any, peer_length));
    // Darwin disconnects and then reports the unspecified family as unsupported.
    if (named != .SUCCESS or (disconnected != .SUCCESS and (os == .linux or disconnected != .AFNOSUPPORT))) return error.SourceUnavailable;
    var source = Address.fromNetwork(compat.addressFromPosix(&storage));
    if (source == .ip6 and !linkLocal(source.ip6.octets)) source.ip6.interface = 0;
    return source;
}

pub const SendScratch = if (os == .linux) struct {
    headers: [SocketPair.BatchScratch.capacity]linux.mmsghdr,
    addresses: [SocketPair.BatchScratch.capacity]compat.PosixAddress,
    vectors: [SocketPair.BatchScratch.capacity]std.posix.iovec,
    controls: [SocketPair.BatchScratch.capacity]Control align(8),
    groups: [SocketPair.BatchScratch.capacity]struct { end: usize, bytes: usize },
} else struct {};

/// Positive sendmmsg results hide the next group's errno. Retry only the unsent suffix.
pub fn sendMany(
    io: std.Io,
    handle: net.Socket.Handle,
    messages: []const SocketPair.Outgoing,
    scratch: *SendScratch,
) SendOutcome {
    assert(messages.len > 0 and messages.len <= SocketPair.BatchScratch.capacity);
    if (comptime os != .linux) {
        for (messages, 0..) |message, sent| {
            const address = message.to.toNetwork();
            send(io, handle, &address, message.from, message.bytes) catch |err|
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

/// Fills `scratch` with one sendmmsg header per group and returns the group count. With
/// `segment` a group is a run of equal-sized datagrams to one peer from one source; the last
/// may be shorter. Each group records where it ends in `messages`, so a partial send maps back
/// to a datagram count.
fn prepareSend(messages: []const SocketPair.Outgoing, scratch: *SendScratch, segment: bool) usize {
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
                if (!first.to.eql(next.to) or !std.meta.eql(first.from, next.from) or next.bytes.len == 0 or
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
        const control: []align(8) u8 = &scratch.controls[groups];
        var control_len: usize = if (pinned(first.from)) |from| pinSource(control, from) else 0;
        if (end - begin > 1) {
            const segment_size: u16 = @intCast(first.bytes.len);
            control_len += putControl(@alignCast(control[control_len..]), linux.IPPROTO.UDP, linux.UDP.SEGMENT, segment_size);
        }
        if (control_len > 0) {
            scratch.headers[groups].hdr.control = control.ptr;
            scratch.headers[groups].hdr.controllen = control_len;
        }
        scratch.groups[groups] = .{ .end = end, .bytes = bytes };
        begin = end;
    }
    return groups;
}

pub const ReceiveScratch = if (os == .linux) struct {
    headers: [SocketPair.receive_batch_max]linux.mmsghdr,
    addresses: [SocketPair.receive_batch_max]compat.PosixAddress,
    vectors: [SocketPair.receive_batch_max]std.posix.iovec,
} else struct {};

pub fn receiveMany(
    io: std.Io,
    handle: net.Socket.Handle,
    slots: []SocketPair.ReceiveSlot,
    scratch: *ReceiveScratch,
) ReceiveError!usize {
    assert(slots.len > 0 and slots.len <= SocketPair.receive_batch_max);
    for (slots, 0..) |*slot, i| {
        scratch.vectors[i] = .{ .base = slot.buffer.ptr, .len = slot.buffer.len };
        scratch.headers[i] = .{ .hdr = .{
            .name = &scratch.addresses[i].any,
            .namelen = @sizeOf(compat.PosixAddress),
            .iov = scratch.vectors[i..].ptr,
            .iovlen = 1,
            .control = &slots[i].control,
            .controllen = control_size,
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
                    .control = slot.control[0..header.hdr.controllen],
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
        // Linux reports EINVAL for an IPv6 source address the host does not own.
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
        // A pinned source that is not a local address produces EADDRNOTAVAIL on macOS.
        .NETUNREACH, .ADDRNOTAVAIL => error.NetworkUnreachable,
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
