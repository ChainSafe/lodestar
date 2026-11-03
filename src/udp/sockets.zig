const std = @import("std");
const net = std.Io.net;
const assert = std.debug.assert;
const compat = @import("compat.zig");
const native_io = @import("native.zig");
const os = @import("builtin").os.tag;
const native_sockets = compat.native_sockets;
const Address = @import("address.zig").Address;

/// Owns at most one socket per configured address family. The caller serializes
/// operations and close and does not copy a live owner. Pass an `std.Io` compatible
/// with the socket handles; Threaded operations require native handles.
/// Readiness checks borrow raw handles without transferring ownership.
pub const Sockets = struct {
    values: [2]?net.Socket = .{ null, null },
    /// Buffer sizes per family as getsockopt reported them after `requestBuffers`. Linux reports
    /// double the size it grants.
    buffers: [2]?Buffers.Reported = .{ null, null },
    /// Kernel drop counts per family, extended past their 32-bit wrap by `drops`.
    drop_counts: [2]DropCount = @splat(.{}),
    cursor: u1 = 0,
    native: [2]bool = @splat(false),

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
    pub const DatagramError = ReceiveError || error{ DatagramTooLarge, InvalidSourceAddress };
    pub const SendError = net.Socket.SendError || error{
        IncompatibleProvider,
        DatagramTooLarge,
        WouldBlock,
        /// Local policy, such as an egress firewall rule, refused the datagram to this destination
        /// (EPERM). Native single and batch sends name it on Linux and macOS.
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
        datagrams: [std.meta.fields(Reason).len]u64 = @splat(0),
        bytes: [std.meta.fields(Reason).len]u64 = @splat(0),

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
            self.datagrams[@intFromEnum(reason)] +|= 1;
            self.bytes[@intFromEnum(reason)] +|= len;
        }
    };
    /// Payload-only datagrams. Payloads are borrowed for the duration of sendMany.
    pub const Outgoing = struct { to: Address, bytes: []const u8 };
    /// Exclusively borrowed during sendMany; no pointers are retained after it returns.
    pub const BatchScratch = union {
        native: native_io.SendScratch,
        provider: struct {
            addresses: [capacity]net.IpAddress,
            messages: [capacity]net.OutgoingMessage,
        },

        pub const capacity = 16;
    };
    pub const Datagram = struct { from: Address, bytes: []u8 };
    pub const receive_batch_max = 16;
    pub const ReceiveScratch = native_io.ReceiveScratch;
    /// The caller owns buffer. Only slots in ReceiveOutcome.received have a message.
    pub const ReceiveSlot = struct {
        buffer: []u8,
        message: net.IncomingMessage = undefined,

        pub fn datagram(self: *const ReceiveSlot) DatagramError!Datagram {
            return checkedDatagram(self.message, self.buffer);
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
    pub fn bind(io: std.Io, addresses: Bindings) BindError!Sockets {
        const ip6 = switch (addresses) {
            .ip4 => null,
            .ip6 => |ip| ip,
            .dual => |ips| ips.ip6,
        };
        if (ip6) |ip| if (Address.isIp4Mapped(ip.bytes)) return error.AddressFamilyUnsupported;
        var result: Sockets = .{};
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
        return result;
    }

    pub fn requestBuffersLogged(self: *Sockets, request: Buffers, comptime scope: @EnumLiteral()) void {
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
    pub fn requestBuffers(self: *Sockets, request: Buffers) [2]bool {
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
    pub fn drops(self: *Sockets) [2]?u64 {
        var result: [2]?u64 = .{ null, null };
        if (comptime os != .linux) return result;
        for (self.values, self.native, &self.drop_counts, &result) |socket, native, *count, *total| {
            if (!native) continue;
            total.* = count.add(native_io.readDrops(socket.?.handle) orelse continue);
        }
        return result;
    }

    pub fn close(self: *Sockets, io: std.Io) void {
        for (self.values) |socket| if (socket) |value| value.close(io);
        self.* = .{};
    }

    pub fn mode(self: *const Sockets) Mode {
        assert(self.values[0] != null or self.values[1] != null);
        return if (self.values[0] == null) .ip6 else if (self.values[1] == null) .ip4 else .dual;
    }

    pub fn primary(self: *const Sockets) net.Socket {
        return self.values[0] orelse self.values[1].?;
    }

    pub fn localAddress(self: *const Sockets) Address {
        return Address.fromNetwork(self.primary().address);
    }

    pub fn localAddresses(self: *const Sockets) [2]?Address {
        var result: [2]?Address = .{ null, null };
        for (self.values, 0..) |socket, i| if (socket) |value| {
            result[i] = Address.fromNetwork(value.address);
        };
        return result;
    }

    pub fn handles(self: *const Sockets) [2]?net.Socket.Handle {
        var result: [2]?net.Socket.Handle = .{ null, null };
        for (self.values, 0..) |socket, i| if (socket) |value| {
            result[i] = value.handle;
        };
        return result;
    }

    /// Blocking on both sockets requires two units of Io concurrency. Ready reads
    /// use no tasks, and a passed deadline reads without waiting. The returned data borrows
    /// buffer until the caller reuses it.
    pub fn receiveTimeout(self: *Sockets, io: std.Io, buffer: []u8, timeout: std.Io.Timeout) ReceiveError!net.IncomingMessage {
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
        if (!dual) return self.primary().receiveTimeout(io, buffer, timeout);
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
    pub fn receiveReady(self: *Sockets, io: std.Io, buffer: []u8, ready: *[2]bool) ReceiveError!?net.IncomingMessage {
        for (0..2) |_| {
            const at = self.cursor;
            self.cursor +%= 1;
            if (!ready[at]) continue;
            const socket = self.values[at] orelse continue;
            if (try receiveNow(io, socket, buffer, self.native[at])) |message| return message;
            ready[at] = false;
        }
        return null;
    }

    pub fn receiveDatagram(self: *Sockets, io: std.Io, buffer: []u8, timeout: std.Io.Timeout) DatagramError!Datagram {
        return checkedDatagram(try self.receiveTimeout(io, buffer, timeout), buffer);
    }

    /// `receiveReady` as a datagram.
    pub fn receiveReadyDatagram(self: *Sockets, io: std.Io, buffer: []u8, ready: *[2]bool) DatagramError!?Datagram {
        return try checkedDatagram((try self.receiveReady(io, buffer, ready)) orelse return null, buffer);
    }

    /// Nonblocking receive into independent caller-owned buffers. Ready families alternate
    /// batches; an empty family is cleared. Process received slots before reusing their buffers.
    /// Supply between one and receive_batch_max slots; every consumed datagram occupies a slot,
    /// including truncated datagrams, which ReceiveSlot.datagram rejects individually.
    pub fn receiveManyReady(
        self: *Sockets,
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
                if (count > 0) return .{ .received = count };
                ready[family] = false;
            } else {
                for (slots, 0..) |*slot, count| {
                    const received = receiveNow(io, socket, slot.buffer, self.native[family]) catch |err|
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

    pub fn sendTo(self: *const Sockets, io: std.Io, destination: Address, bytes: []const u8, payload_max: usize) SendError!void {
        if (bytes.len > payload_max) return error.DatagramTooLarge;
        if (destination.port() == 0) return error.DestinationRefused;
        const address = destination.toNetwork();
        const family: usize = if (destination == .ip4) 0 else 1;
        const socket = self.values[family] orelse return error.AddressFamilyUnsupported;
        if (!self.native[family] and compat.threadedSend(io)) return error.IncompatibleProvider;
        if (native_sockets) {
            if (self.native[family] and compat.threadedSend(io)) return native_io.send(io, socket.handle, &address, bytes);
        }
        try socket.send(io, &address, bytes);
    }

    /// Sends in input order, stopping at the first error with its exact accepted prefix.
    /// A later invalid entry is checked only after sending its valid prefix; earlier I/O
    /// failures win. Larger slices use bounded scratch chunks.
    pub fn sendMany(self: *const Sockets, io: std.Io, messages: []const Outgoing, payload_max: usize, scratch: *BatchScratch) SendOutcome {
        var begin: usize = 0;
        while (begin < messages.len) {
            if (messages[begin].bytes.len > payload_max) return .{ .sent = begin, .failure = error.DatagramTooLarge };
            if (messages[begin].to.port() == 0) return .{ .sent = begin, .failure = error.DestinationRefused };
            const family: usize = if (messages[begin].to == .ip4) 0 else 1;
            const socket = self.values[family] orelse return .{ .sent = begin, .failure = error.AddressFamilyUnsupported };
            if (!self.native[family] and compat.threadedSend(io)) return .{ .sent = begin, .failure = error.IncompatibleProvider };
            var end = begin + 1;
            const limit = begin + @min(BatchScratch.capacity, messages.len - begin);
            while (end < limit and std.meta.activeTag(messages[end].to) == std.meta.activeTag(messages[begin].to) and messages[end].bytes.len <= payload_max and messages[end].to.port() != 0) : (end += 1) {}
            const run = messages[begin..end];
            const outcome = if (native_sockets and self.native[family] and compat.threadedSend(io)) blk: {
                scratch.* = .{ .native = undefined };
                break :blk native_io.sendMany(io, socket.handle, run, &scratch.native);
            } else sendProvider(io, socket.handle, run, scratch);
            assert(outcome.sent <= run.len);
            assert((outcome.failure == null) == (outcome.sent == run.len));
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

    fn checkedDatagram(incoming: net.IncomingMessage, buffer: []u8) DatagramError!Datagram {
        if (incoming.from.getPort() == 0) return error.InvalidSourceAddress;
        if (incoming.flags.trunc) return error.DatagramTooLarge;
        assert(incoming.data.len <= buffer.len);
        return .{ .from = Address.fromNetwork(incoming.from), .bytes = buffer[0..incoming.data.len] };
    }

    fn receiveNow(io: std.Io, socket: net.Socket, buffer: []u8, native: bool) ReceiveError!?net.IncomingMessage {
        if (!native and compat.threadedReceive(io)) return error.IncompatibleProvider;
        if (native_sockets) {
            if (native and compat.threadedReceive(io)) return native_io.receive(io, socket.handle, buffer);
        }
        return socket.receiveTimeout(io, buffer, .{ .duration = .{ .raw = .zero, .clock = .awake } }) catch |err| switch (err) {
            error.Timeout => null,
            else => err,
        };
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
        }
        const failure, const sent = io.vtable.netSend(io.userdata, handle, provider.messages[0..messages.len], .{});
        assert(sent <= messages.len);
        for (messages[0..sent], provider.messages[0..sent]) |message, accepted| assert(message.bytes.len == accepted.data_len);
        return .{ .sent = sent, .failure = failure };
    }
};

test {
    _ = @import("sockets_test.zig");
    _ = @import("sockets_operations_test.zig");
    _ = @import("sockets_native_test.zig");
    _ = @import("linux_test_support.zig");
}
