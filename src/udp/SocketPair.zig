//! Owns at most one UDP socket per address family and presents them as one endpoint.
//!
//! IPv4 and IPv6 traffic use separate sockets, and the IPv6 socket accepts IPv6 only. A peer
//! address then has a single representation, and each family is bound, sized and counted on its
//! own. Per-family state lives in two-element arrays indexed IPv4 first.
//!
//! Receiving alternates the family tried first across calls, so a busy family cannot starve the
//! other. The caller's readiness flags are hints that a read corrects. Sending uses the socket
//! of the destination's family, keeps the caller's order and reports the exact accepted prefix
//! on failure.
//!
//! Native handles on a threaded `std.Io` make system calls directly: batched sends and receives
//! on Linux, the local destination of each received datagram, source pinning, and route lookups
//! on probe sockets for wildcard binds. Linux and macOS only; other targets fail to compile.
//! Other I/O providers use `std.Io` and must honor source-selection control messages. Without
//! destination metadata, receives report the bound address.
//!
//! Native sockets never fragment, as required by RFC 9000 section 14. A datagram above the
//! local interface MTU fails with MessageOversize. Other I/O providers configure their own sockets.
//!
//! Nothing allocates. Batch scratch and receive buffers are fixed-size and supplied by the caller.
//!
//! The caller serializes operations and close and does not copy a live owner. Pass an `std.Io`
//! compatible with the socket handles; Threaded operations require native handles. Readiness
//! checks borrow raw handles without transferring ownership.
const std = @import("std");
const net = std.Io.net;
const assert = std.debug.assert;
const compat = @import("compat.zig");
const native_io = @import("native.zig");
const os = @import("builtin").os.tag;
const native_sockets = compat.native_sockets;
const Address = @import("address.zig").Address;
const family_ip4: usize = 0;
const family_ip6: usize = 1;
const SocketPair = @This();

comptime {
    if (os != .linux and os != .macos)
        @compileError("UDP sockets support Linux and macOS only");
}

values: [2]?net.Socket = .{ null, null },
/// Buffer sizes per family as getsockopt reported them after `requestBuffers`. Linux reports
/// double the size it grants.
buffers: [2]?Buffers.Reported = .{ null, null },
/// Kernel drop counts per family, extended past their 32-bit wrap by `drops`.
drop_counts: [2]DropCount = @splat(.{}),
cursor: u1 = 0,
native: [2]bool = @splat(false),
/// One socket per wildcard-bound native family, connected only to ask the kernel for a route.
/// macOS keeps the port the first connect bound; datagrams sent to it queue unread up to
/// SO_RCVBUF until close.
probes: [2]?net.Socket.Handle = .{ null, null },
control: Control align(8) = undefined,

pub const Mode = enum {
    ip4,
    ip6,
    dual,
    pub fn supports(self: Mode, address: Address) bool {
        return switch (address) {
            .ip4 => self != .ip6,
            .ip6 => self != .ip4,
        };
    }
};

pub const Bindings = union(enum) {
    ip4: net.Ip4Address,
    ip6: net.Ip6Address,
    dual: struct { ip4: net.Ip4Address, ip6: net.Ip6Address },

    pub fn single(address: net.IpAddress) Bindings {
        return switch (address) {
            .ip4 => |ip| .{ .ip4 = ip },
            .ip6 => |ip| .{ .ip6 = ip },
        };
    }
};

pub const BindError = net.IpAddress.BindError;
pub const ReceiveError = net.Socket.ReceiveTimeoutError || error{IncompatibleProvider};
pub const DatagramError = ReceiveError || error{ DatagramTooLarge, InvalidSourceAddress, InvalidDestinationAddress };
pub const SourceError = std.Io.Cancelable || error{ AddressFamilyUnsupported, SourceUnavailable };
pub const SendError = net.Socket.SendError || error{
    IncompatibleProvider,
    DatagramTooLarge,
    WouldBlock,
    /// Local policy, such as an egress firewall rule, refused the datagram to this destination
    /// (EPERM), or on Linux the pinned IPv6 source is not an address of this host (EINVAL).
    /// Native single and batch sends name it on Linux and macOS.
    DestinationRefused,
};

pub fn destinationUnreachable(err: SendError) bool {
    return switch (err) {
        error.AccessDenied,
        error.AddressFamilyUnsupported,
        error.ConnectionRefused,
        error.ConnectionResetByPeer,
        error.DestinationRefused,
        error.HostUnreachable,
        error.NetworkDown,
        error.NetworkUnreachable,
        => true,
        else => false,
    };
}

/// `sent` datagrams went out; `failure` is the error of the next one, null when all did.
pub const SendOutcome = struct { sent: usize, failure: ?SendError };
pub const SendDrops = struct {
    datagrams: [@typeInfo(Reason).@"enum".field_names.len]u64 = @splat(0),
    bytes: [@typeInfo(Reason).@"enum".field_names.len]u64 = @splat(0),

    /// EAGAIN is distinct from ENOBUFS/ENOMEM, which the Io send contract groups as SystemResources.
    pub const Reason = enum {
        would_block,
        system_resources,
        destination_unreachable,

        pub fn fromError(err: SendError) ?Reason {
            return switch (err) {
                error.WouldBlock => .would_block,
                error.SystemResources => .system_resources,
                else => null,
            };
        }
    };

    pub fn add(self: *SendDrops, reason: Reason, len: usize) void {
        self.datagrams[@backingInt(reason)] +|= 1;
        self.bytes[@backingInt(reason)] +|= len;
    }
};
/// Payload-only datagrams. Payloads are borrowed for the duration of sendMany.
/// `from` pins the source address; its port is ignored. Null or an unspecified address of the
/// destination's family leaves the choice to the kernel.
pub const Outgoing = struct { to: Address, bytes: []const u8, from: ?Address = null };
/// Exclusively borrowed during sendMany; no pointers are retained after it returns.
pub const BatchScratch = union {
    native: native_io.SendScratch,
    provider: struct {
        addresses: [capacity]net.IpAddress,
        messages: [capacity]net.OutgoingMessage,
        controls: [capacity]Control align(8),
    },

    pub const capacity = 16;
};
/// `to` is the local address the datagram was sent to, with the receiving socket's port. Where
/// the provider reports no destination it is the socket's bound address, which may be unspecified.
/// macOS does not filter IPv4 subnet broadcasts; `to` can be one and a reply pinned to it
/// fails with NetworkUnreachable.
pub const Datagram = struct { from: Address, to: Address, bytes: []u8 };
pub const Control = native_io.Control;
pub const receive_batch_max = 16;
pub const ReceiveScratch = native_io.ReceiveScratch;
/// The caller owns buffer. Only slots in ReceiveOutcome.received have a message.
pub const ReceiveSlot = struct {
    buffer: []u8,
    message: net.IncomingMessage = undefined,
    bound: net.IpAddress = undefined,
    control: Control align(8) = undefined,

    pub fn datagram(self: *const ReceiveSlot) DatagramError!Datagram {
        return checkedDatagram(self.message, self.buffer, self.bound);
    }
};
/// Received slots remain valid even when a later receive fails.
pub const ReceiveOutcome = struct { received: usize = 0, failure: ?ReceiveError = null };

/// Kernel socket buffer sizes in bytes.
pub const Buffers = struct {
    receive: u32,
    send: u32,

    pub const bytes_min: u32 = 64 * 1024;
    pub const bytes_max: u32 = 64 * 1024 * 1024;

    pub fn valid(self: Buffers) bool {
        return self.receive >= bytes_min and self.receive <= bytes_max and
            self.send >= bytes_min and self.send <= bytes_max;
    }

    /// Sizes as getsockopt reported them. Null where the read failed.
    pub const Reported = struct { receive: ?u32, send: ?u32 };
};

/// IPv6 sockets accept IPv6 only, including when both families share a port.
pub fn bind(io: std.Io, addresses: Bindings) BindError!SocketPair {
    const ip6 = switch (addresses) {
        .ip4 => null,
        .ip6 => |ip| ip,
        .dual => |ips| ips.ip6,
    };
    if (ip6) |ip| if (Address.isIp4Mapped(ip.bytes)) return error.AddressFamilyUnsupported;
    var result: SocketPair = .{};
    errdefer result.close(io);
    switch (addresses) {
        .ip4 => |ip| result.values[0] = try (net.IpAddress{ .ip4 = ip }).bind(io, .{ .mode = .dgram, .protocol = .udp }),
        .ip6 => |ip| result.values[1] = try compat.bindIp6(io, ip),
        .dual => |ips| {
            result.values[0] = try (net.IpAddress{ .ip4 = ips.ip4 }).bind(io, .{ .mode = .dgram, .protocol = .udp });
            result.values[1] = try compat.bindIp6(io, ips.ip6);
        },
    }
    for (result.values, &result.native) |socket, *native| native.* = socket != null and native_sockets and compat.threaded(io);
    if (native_sockets) {
        for (result.values, result.native, &result.probes) |socket, native, *probe| {
            if (!native) continue;
            const address = socket.?.address;
            try compat.checkBindError(native_io.reportDestination(socket.?.handle, address));
            try compat.checkBindError(native_io.preventFragmentation(socket.?.handle, address));
            if (unspecified(address)) probe.* = try compat.open(io, address);
        }
    }
    return result;
}

pub fn requestBuffersLogged(self: *SocketPair, request: Buffers, comptime scope: @EnumLiteral()) void {
    const short = self.requestBuffers(request);
    for (short, self.buffers, [_][]const u8{ "ip4", "ip6" }) |below, reported, family| {
        if (!below) continue;
        std.log.scoped(scope).warn("socket_buffers_below_request family={s} receive_bytes={?d} receive_requested={d} send_bytes={?d} send_requested={d}", .{ family, reported.?.receive, request.receive, reported.?.send, request.send });
    }
}

/// Requests `request` on each socket and records what the kernel reports. The kernel caps a
/// request at its limit (net.core.rmem_max and wmem_max on Linux), so a smaller size is not
/// an error. Returns the families whose sockets the kernel granted less than the request; an
/// unknown size does not count. Sockets of other I/O providers and platforms keep their sizes
/// and record nothing.
pub fn requestBuffers(self: *SocketPair, request: Buffers) [2]bool {
    assert(request.valid());
    var short: [2]bool = .{ false, false };
    if (native_sockets) {
        const p = std.posix;
        for (self.values, self.native, &self.buffers, &short) |socket, native, *reported, *below| {
            if (!native) continue;
            const handle = (socket orelse continue).handle;
            native_io.setBuffer(handle, p.SO.RCVBUF, request.receive);
            native_io.setBuffer(handle, p.SO.SNDBUF, request.send);
            const sizes: Buffers.Reported = .{ .receive = native_io.readBuffer(handle, p.SO.RCVBUF), .send = native_io.readBuffer(handle, p.SO.SNDBUF) };
            reported.* = sizes;
            below.* = native_io.capped(sizes.receive, request.receive) or native_io.capped(sizes.send, request.send);
        }
    }
    return short;
}

/// Datagrams the kernel dropped at each socket over its lifetime, mostly on a full receive
/// buffer. Each call extends Linux's wrapping 32-bit count. Null off Linux, for non-native
/// sockets and where the kernel reports no count. Independent of buffer sizing.
pub fn drops(self: *SocketPair) [2]?u64 {
    var result: [2]?u64 = .{ null, null };
    if (comptime os != .linux) return result;
    for (self.values, self.native, &self.drop_counts, &result) |socket, native, *count, *total| {
        if (!native) continue;
        total.* = count.add(native_io.readDrops(socket.?.handle) orelse continue);
    }
    return result;
}

pub fn close(self: *SocketPair, io: std.Io) void {
    for (self.values) |socket| if (socket) |value| value.close(io);
    for (self.probes, self.values) |probe, socket| if (probe) |handle| (net.Socket{ .handle = handle, .address = socket.?.address }).close(io);
    self.* = .{};
}

pub fn mode(self: *const SocketPair) Mode {
    assert(self.values[0] != null or self.values[1] != null);
    return if (self.values[0] == null) .ip6 else if (self.values[1] == null) .ip4 else .dual;
}

pub fn primary(self: *const SocketPair) net.Socket {
    return self.values[0] orelse self.values[1].?;
}

pub fn localAddress(self: *const SocketPair) Address {
    return Address.fromNetwork(self.primary().address);
}

pub fn localAddresses(self: *const SocketPair) [2]?Address {
    var result: [2]?Address = .{ null, null };
    for (self.values, 0..) |socket, i| if (socket) |value| {
        result[i] = Address.fromNetwork(value.address);
    };
    return result;
}

/// The source address the kernel would choose to reach `peer`, with the bound port. A socket
/// bound to a specific address answers without a system call. Where no route can be asked
/// for, the answer is the bound address, which may be unspecified.
pub fn sourceFor(self: *const SocketPair, io: std.Io, peer: Address) SourceError!Address {
    const family: usize = if (peer == .ip4) family_ip4 else family_ip6;
    const socket = self.values[family] orelse return error.AddressFamilyUnsupported;
    const bound = Address.fromNetwork(socket.address);
    if (native_sockets) {
        if (self.probes[family]) |probe| {
            assert(unspecified(socket.address));
            var source = try native_io.route(io, probe, &peer.toNetwork());
            switch (source) {
                inline else => |*ip| ip.port = bound.port(),
            }
            return source;
        }
    }
    return bound;
}

pub fn handles(self: *const SocketPair) [2]?net.Socket.Handle {
    var result: [2]?net.Socket.Handle = .{ null, null };
    for (self.values, 0..) |socket, i| if (socket) |value| {
        result[i] = value.handle;
    };
    return result;
}

/// Blocking on both sockets requires two units of Io concurrency. Ready reads
/// use no tasks, and a passed deadline reads without waiting. The returned data borrows
/// buffer until the caller reuses it.
pub fn receiveTimeout(self: *SocketPair, io: std.Io, buffer: []u8, timeout: std.Io.Timeout) ReceiveError!net.IncomingMessage {
    for (self.values, self.native) |socket, native| {
        if (socket != null and !native and compat.threadedReceive(io)) return error.IncompatibleProvider;
    }
    const deadline = timeout.toDeadline(io);
    const dual = self.values[0] != null and self.values[1] != null;
    if (dual or passed(io, deadline)) {
        var ready: [2]bool = @splat(true);
        if (try self.receiveReady(io, buffer, &ready)) |message| return message;
        if (passed(io, deadline)) return error.Timeout;
    }
    if (!dual) return receiveProvider(io, self.primary(), buffer, &self.control, timeout);
    {
        const Ready = union(enum) { ip4: ReceiveError!void, ip6: ReceiveError!void };
        var completions: [2]Ready = undefined;
        var select: std.Io.Select(Ready) = .init(io, &completions);
        defer select.cancelDiscard();
        try select.concurrent(.ip4, waitReadable, .{ io, self.values[0].?, deadline });
        try select.concurrent(.ip6, waitReadable, .{ io, self.values[1].?, deadline });
        switch (try select.await()) {
            inline else => |result| try result,
        }
    }
    var ready: [2]bool = @splat(true);
    return (try self.receiveReady(io, buffer, &ready)) orelse error.Timeout;
}

/// Reads one datagram, without waiting, from a family `ready` marks, indexed like `values`.
/// Families take turns across calls, so two ready families alternate. Readiness is only a
/// hint: a family found empty is cleared, and null means no marked family remains. The
/// returned data borrows buffer until the caller reuses it.
pub fn receiveReady(self: *SocketPair, io: std.Io, buffer: []u8, ready: *[2]bool) ReceiveError!?net.IncomingMessage {
    for (0..2) |_| {
        const at = self.cursor;
        self.cursor +%= 1;
        if (!ready[at]) continue;
        const socket = self.values[at] orelse continue;
        if (try receiveNow(io, socket, buffer, &self.control, self.native[at])) |message| return message;
        ready[at] = false;
    }
    return null;
}

pub fn receiveDatagram(self: *SocketPair, io: std.Io, buffer: []u8, timeout: std.Io.Timeout) DatagramError!Datagram {
    const message = try self.receiveTimeout(io, buffer, timeout);
    return checkedDatagram(message, buffer, self.boundFor(message.from));
}

/// `receiveReady` as a datagram.
pub fn receiveReadyDatagram(self: *SocketPair, io: std.Io, buffer: []u8, ready: *[2]bool) DatagramError!?Datagram {
    const message = (try self.receiveReady(io, buffer, ready)) orelse return null;
    return try checkedDatagram(message, buffer, self.boundFor(message.from));
}

/// Nonblocking receive into independent caller-owned buffers. Ready families alternate
/// batches; an empty family is cleared. Process received slots before reusing their buffers.
/// Supply between one and receive_batch_max slots; every consumed datagram occupies a slot,
/// including truncated datagrams, which ReceiveSlot.datagram rejects individually.
pub fn receiveManyReady(
    self: *SocketPair,
    io: std.Io,
    slots: []ReceiveSlot,
    ready: *[2]bool,
    scratch: *ReceiveScratch,
) ReceiveOutcome {
    assert(slots.len > 0 and slots.len <= receive_batch_max);
    for (0..2) |_| {
        const family = self.cursor;
        self.cursor +%= 1;
        if (!ready[family]) continue;
        const socket = self.values[family] orelse {
            ready[family] = false;
            continue;
        };
        if (!self.native[family] and compat.threadedReceive(io))
            return .{ .failure = error.IncompatibleProvider };
        if (os == .linux and self.native[family] and compat.threadedReceive(io)) {
            const count = native_io.receiveMany(io, socket.handle, slots, scratch) catch |err|
                return .{ .failure = err };
            for (slots[0..count]) |*slot| slot.bound = socket.address;
            if (count > 0) return .{ .received = count };
            ready[family] = false;
        } else {
            for (slots, 0..) |*slot, count| {
                slot.bound = socket.address;
                const received = receiveNow(io, socket, slot.buffer, &slot.control, self.native[family]) catch |err|
                    return .{ .received = count, .failure = err };
                slot.message = received orelse {
                    ready[family] = false;
                    if (count > 0) return .{ .received = count };
                    break;
                };
            } else return .{ .received = slots.len };
        }
    }
    return .{};
}

pub fn sendTo(self: *const SocketPair, io: std.Io, destination: Address, from: ?Address, bytes: []const u8, payload_max: usize) SendError!void {
    if (bytes.len > payload_max) return error.DatagramTooLarge;
    if (destination.port() == 0) return error.DestinationRefused;
    if (!sameFamily(destination, from)) return error.AddressFamilyUnsupported;
    const address = destination.toNetwork();
    const family: usize = if (destination == .ip4) family_ip4 else family_ip6;
    const socket = self.values[family] orelse return error.AddressFamilyUnsupported;
    if (!self.native[family] and compat.threadedSend(io)) return error.IncompatibleProvider;
    if (native_sockets) {
        if (self.native[family] and compat.threadedSend(io)) return native_io.send(io, socket.handle, &address, from, bytes);
    }
    var scratch: BatchScratch = undefined;
    const outcome = sendProvider(io, socket.handle, &.{.{ .to = destination, .bytes = bytes, .from = from }}, &scratch);
    if (outcome.failure) |err| return err;
}

/// Sends in input order, stopping at the first error with its exact accepted prefix.
/// A later invalid entry is checked only after sending its valid prefix; earlier I/O
/// failures win. Larger slices use bounded scratch chunks.
pub fn sendMany(self: *const SocketPair, io: std.Io, messages: []const Outgoing, payload_max: usize, scratch: *BatchScratch) SendOutcome {
    var begin: usize = 0;
    while (begin < messages.len) {
        if (messages[begin].bytes.len > payload_max) return .{ .sent = begin, .failure = error.DatagramTooLarge };
        if (messages[begin].to.port() == 0) return .{ .sent = begin, .failure = error.DestinationRefused };
        if (!sameFamily(messages[begin].to, messages[begin].from)) return .{ .sent = begin, .failure = error.AddressFamilyUnsupported };
        const family: usize = if (messages[begin].to == .ip4) family_ip4 else family_ip6;
        const socket = self.values[family] orelse return .{ .sent = begin, .failure = error.AddressFamilyUnsupported };
        if (!self.native[family] and compat.threadedSend(io)) return .{ .sent = begin, .failure = error.IncompatibleProvider };
        var end = begin + 1;
        const limit = begin + @min(BatchScratch.capacity, messages.len - begin);
        while (end < limit and std.meta.activeTag(messages[end].to) == std.meta.activeTag(messages[begin].to) and messages[end].bytes.len <= payload_max and messages[end].to.port() != 0 and sameFamily(messages[end].to, messages[end].from)) : (end += 1) {}
        const run = messages[begin..end];
        const outcome = if (native_sockets and self.native[family] and compat.threadedSend(io)) blk: {
            scratch.* = .{ .native = undefined };
            break :blk native_io.sendMany(io, socket.handle, run, &scratch.native);
        } else sendProvider(io, socket.handle, run, scratch);
        assert(outcome.sent <= run.len);
        // Io may return a successful prefix while deferring cancellation to the next operation.
        assert(outcome.failure != null or outcome.sent > 0);
        begin += outcome.sent;
        if (outcome.failure) |err| return .{ .sent = begin, .failure = err };
    }
    return .{ .sent = begin, .failure = null };
}

const DropCount = struct {
    last: u32 = 0,
    total: u64 = 0,

    fn add(self: *DropCount, raw: u32) u64 {
        // Exact while fewer than 2^32 drops happen between two reads; every metrics scrape reads.
        self.total += raw -% self.last;
        self.last = raw;
        return self.total;
    }
};

fn passed(io: std.Io, deadline: std.Io.Timeout) bool {
    const duration = deadline.toDurationFromNow(io) orelse return false;
    return duration.raw.nanoseconds <= 0;
}

fn unspecified(address: net.IpAddress) bool {
    return switch (address) {
        inline else => |ip| std.mem.allEqual(u8, &ip.bytes, 0),
    };
}

fn sameFamily(to: Address, from: ?Address) bool {
    return from == null or std.meta.activeTag(from.?) == std.meta.activeTag(to);
}

fn boundFor(self: *const SocketPair, from: net.IpAddress) net.IpAddress {
    const family: usize = if (from == .ip4) family_ip4 else family_ip6;
    return (self.values[family] orelse self.primary()).address;
}

fn checkedDatagram(incoming: net.IncomingMessage, buffer: []u8, bound: net.IpAddress) DatagramError!Datagram {
    if (incoming.from.getPort() == 0) return error.InvalidSourceAddress;
    if (incoming.flags.trunc) return error.DatagramTooLarge;
    assert(incoming.data.len <= buffer.len);
    const reported: ?Address = if (native_sockets) try native_io.destination(incoming.control, bound.getPort()) else null;
    return .{
        .from = Address.fromNetwork(incoming.from),
        .to = reported orelse Address.fromNetwork(bound),
        .bytes = buffer[0..incoming.data.len],
    };
}

fn receiveNow(io: std.Io, socket: net.Socket, buffer: []u8, control: *align(8) Control, native: bool) ReceiveError!?net.IncomingMessage {
    if (!native and compat.threadedReceive(io)) return error.IncompatibleProvider;
    if (native_sockets) {
        if (native and compat.threadedReceive(io)) return native_io.receive(io, socket.handle, buffer, control);
    }
    return receiveProvider(io, socket, buffer, control, .{ .duration = .{ .raw = .zero, .clock = .awake } }) catch |err| switch (err) {
        error.Timeout => null,
        else => err,
    };
}

/// A provider that reports no control data leaves the zeroed buffer, which names no destination.
fn receiveProvider(io: std.Io, socket: net.Socket, buffer: []u8, control: *align(8) Control, timeout: std.Io.Timeout) ReceiveError!net.IncomingMessage {
    @memset(control, 0);
    var message: [1]net.IncomingMessage = .{.init};
    message[0].control = control;
    const failure, const count = socket.receiveManyTimeout(io, &message, buffer, .{}, timeout);
    if (failure) |err| return err;
    assert(count == 1);
    return message[0];
}

fn waitReadable(io: std.Io, socket: net.Socket, timeout: std.Io.Timeout) ReceiveError!void {
    var message: [1]net.IncomingMessage = .{.init};
    var probe: [1]u8 = undefined;
    // Both tasks may finish before cancellation. Peeking keeps every datagram in
    // its socket until the serialized receiver lends the caller's buffer to it.
    const failure, const count = socket.receiveManyTimeout(io, &message, &probe, .{ .peek = true }, timeout);
    if (failure) |err| return err;
    assert(count == 1);
}

fn sendProvider(io: std.Io, handle: net.Socket.Handle, messages: []const Outgoing, scratch: *BatchScratch) SendOutcome {
    scratch.* = .{ .provider = undefined };
    const provider = &scratch.provider;
    for (messages, 0..) |message, i| {
        provider.addresses[i] = message.to.toNetwork();
        provider.messages[i] = .{ .address = &provider.addresses[i], .data_ptr = message.bytes.ptr, .data_len = message.bytes.len };
        if (native_sockets) {
            if (native_io.pinned(message.from)) |from|
                provider.messages[i].control = provider.controls[i][0..native_io.pinSource(&provider.controls[i], from)];
        }
    }
    const failure, const sent = (io.operate(.{ .net_send = .{
        .socket_handle = handle,
        .messages = provider.messages[0..messages.len],
        .flags = .{},
    } }) catch |err| return .{ .sent = 0, .failure = err }).net_send;
    assert(sent <= messages.len);
    for (messages[0..sent], provider.messages[0..sent]) |message, accepted| assert(message.bytes.len == accepted.data_len);
    return .{ .sent = sent, .failure = failure };
}

test {
    _ = @import("socket_pair_test.zig");
    _ = @import("socket_pair_operations_test.zig");
    _ = @import("socket_pair_native_test.zig");
    _ = @import("socket_pair_source_test.zig");
    _ = @import("linux_test_support.zig");
}
