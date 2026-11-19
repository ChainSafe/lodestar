const std = @import("std");
const FaultIo = @import("fault_io");
const Sockets = @import("sockets.zig").Sockets;
const Address = @import("address.zig").Address;
const waitForDatagram = @import("socket_test_support").waitForDatagram;
const payload_max = 1500;

const net = std.Io.net;

fn oneSecond() std.Io.Timeout {
    return .{ .duration = .{ .raw = .fromMilliseconds(1_000), .clock = .awake } };
}

test "UDP receives into caller storage and recovers after truncation" {
    var buffer: [payload_max]u8 = undefined;
    const loopback = net.IpAddress{ .ip4 = .loopback(0) };
    var receiver = try Sockets.bind(std.testing.io, .single(loopback));
    defer receiver.close(std.testing.io);
    var sender = try Sockets.bind(std.testing.io, .single(loopback));
    defer sender.close(std.testing.io);
    try std.testing.expect(receiver.localAddress().port() != 0);

    const payload = [_]u8{0x44} ** 1200;
    const receiver_address = receiver.localAddress();
    try sender.sendTo(std.testing.io, receiver_address, &payload, payload_max);
    const first = try receiver.receiveDatagram(std.testing.io, &buffer, oneSecond());
    try std.testing.expectEqualSlices(u8, &payload, first.bytes);
    try std.testing.expect(first.bytes.ptr == &buffer);
    first.bytes[0] = 0x00;
    try std.testing.expectEqual(sender.localAddress().port(), first.from.port());

    var raw_sender = try loopback.bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer raw_sender.close(std.testing.io);
    const oversized = [_]u8{0x55} ** (payload_max + 1);
    const destination = Address.toNetwork(receiver.localAddress());
    try raw_sender.send(std.testing.io, &destination, &oversized);
    try std.testing.expectError(error.DatagramTooLarge, receiver.receiveDatagram(std.testing.io, &buffer, oneSecond()));

    try sender.sendTo(std.testing.io, receiver_address, &payload, payload_max);
    const second = try receiver.receiveDatagram(std.testing.io, &buffer, oneSecond());
    try std.testing.expectEqualSlices(u8, &payload, second.bytes);
}

test "UDP receive times out without traffic" {
    var buffer: [payload_max]u8 = undefined;
    const loopback = net.IpAddress{ .ip4 = .loopback(0) };
    var receiver = try Sockets.bind(std.testing.io, .single(loopback));
    defer receiver.close(std.testing.io);
    const short = std.Io.Timeout{ .duration = .{ .raw = .fromMilliseconds(20), .clock = .awake } };
    try std.testing.expectError(error.Timeout, receiver.receiveDatagram(std.testing.io, &buffer, short));
}

test "UDP rejects oversized sends before I/O" {
    var transport = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer transport.close(std.testing.io);
    const oversized = [_]u8{0x44} ** (payload_max + 1);
    const destination = Address{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9_001 } };
    try std.testing.expectError(
        error.DatagramTooLarge,
        transport.sendTo(undefined, destination, &oversized, payload_max),
    );
}

test "UDP reuses the same scratch for a smaller batch with new payloads and destinations" {
    const Recorder = struct {
        calls: usize = 0,
        fail_after: ?usize = null,
        ports: [Sockets.BatchScratch.capacity]u16 = undefined,
        payloads: [Sockets.BatchScratch.capacity][]const u8 = undefined,
        len: usize = 0,

        fn send(userdata: ?*anyopaque, _: net.Socket.Handle, messages: []net.OutgoingMessage, _: net.SendFlags) struct { ?net.Socket.SendError, usize } {
            const self: *@This() = @ptrCast(@alignCast(userdata.?));
            self.calls += 1;
            self.len = messages.len;
            for (messages, 0..) |message, i| {
                self.ports[i] = Address.fromNetwork(message.address.*).port();
                self.payloads[i] = message.data_ptr[0..message.data_len];
            }
            if (self.fail_after) |sent| return .{ error.NetworkUnreachable, sent };
            return .{ null, messages.len };
        }
    };
    var socket = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer socket.close(std.testing.io);
    var recorder: Recorder = .{};
    var vtable = std.testing.io.vtable.*;
    vtable.netSend = Recorder.send;
    const io: std.Io = .{ .userdata = &recorder, .vtable = &vtable };
    const first: Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9_001 } };
    const second: Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9_002 } };
    var payloads = [_]u8{ 1, 2, 3, 4, 5 };
    recorder.fail_after = 1;
    var scratch: Sockets.BatchScratch = undefined;
    const failed = socket.sendMany(io, &.{
        .{ .to = first, .bytes = payloads[0..1] },
        .{ .to = first, .bytes = payloads[1..2] },
        .{ .to = first, .bytes = payloads[2..3] },
    }, payload_max, &scratch);
    try std.testing.expectEqual(@as(usize, 1), failed.sent);
    try std.testing.expectEqual(@as(usize, 3), recorder.len);
    recorder.fail_after = null;
    const outcome = socket.sendMany(io, &.{.{ .to = second, .bytes = payloads[3..5] }}, payload_max, &scratch);
    try std.testing.expectEqual(@as(usize, 1), outcome.sent);
    try std.testing.expect(outcome.failure == null);
    try std.testing.expectEqual(@as(usize, 2), recorder.calls);
    try std.testing.expectEqual(@as(usize, 1), recorder.len);
    try std.testing.expectEqual(@as(u16, 9_002), recorder.ports[0]);
    try std.testing.expectEqualSlices(u8, &.{ 4, 5 }, recorder.payloads[0]);
}

test "dual-stack UDP sends an ordered mixed batch and receives both datagram families" {
    var buffer: [payload_max]u8 = undefined;
    var target = try Sockets.bind(std.testing.io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } });
    defer target.close(std.testing.io);
    const local = target.localAddresses();
    try std.testing.expect(local[0].? == .ip4 and local[1].? == .ip6);
    var payload = [_]u8{ 1, 2, 3 };
    const batch = [_]Sockets.Outgoing{
        .{ .to = local[0].?, .bytes = payload[0..1] },
        .{ .to = local[1].?, .bytes = payload[1..2] },
        .{ .to = local[0].?, .bytes = payload[2..3] },
    };
    var scratch6: Sockets.BatchScratch = undefined;
    const outcome = target.sendMany(std.testing.io, &batch, payload_max, &scratch6);
    try std.testing.expectEqual(batch.len, outcome.sent);
    try std.testing.expect(outcome.failure == null);
    for ([_]u8{ 1, 2, 3 }, 0..) |expected, i| {
        const message = try target.receiveDatagram(std.testing.io, &buffer, oneSecond());
        try std.testing.expectEqualSlices(u8, &.{expected}, message.bytes);
        try std.testing.expectEqual(i == 1, message.from == .ip6);
    }
}

test "dual-stack UDP binds explicit addresses on the same port and rolls back partial binding" {
    const bindings: Sockets.Bindings = blk: {
        var ipv6 = try Sockets.bind(std.testing.io, .{ .ip6 = .loopback(0) });
        defer ipv6.close(std.testing.io);
        const port = ipv6.localAddress().port();
        const pair: Sockets.Bindings = .{ .dual = .{
            .ip4 = .loopback(port),
            .ip6 = .loopback(port),
        } };
        try std.testing.expectError(error.AddressInUse, Sockets.bind(std.testing.io, pair));
        var ipv4 = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(port) });
        defer ipv4.close(std.testing.io);
        break :blk pair;
    };
    var both = try Sockets.bind(std.testing.io, bindings);
    defer both.close(std.testing.io);
    for (both.localAddresses()) |address| try std.testing.expectEqual(bindings.dual.ip4.port, address.?.port());
}

test "dual-stack UDP cancels both pending peek waits and leaves sockets usable" {
    var target = try Sockets.bind(std.testing.io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } });
    defer target.close(std.testing.io);
    var sender = try Sockets.bind(std.testing.io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } });
    defer sender.close(std.testing.io);
    const destinations = target.localAddresses();
    const Worker = struct {
        started: std.Io.Event = .unset,
        parked: std.Io.Event = .unset,
        starts: std.atomic.Value(u8) = .init(0),
        finished: std.atomic.Value(u8) = .init(0),
        canceled: std.atomic.Value(u8) = .init(0),
        var active: *@This() = undefined;

        fn wait(userdata: ?*anyopaque, batch: *std.Io.Batch, deadline: std.Io.Timeout) std.Io.Batch.AwaitConcurrentError!void {
            const operation = batch.storage[batch.submitted.head.toIndex()].submission.operation.net_receive;
            if (!operation.flags.peek) return std.testing.io.vtable.batchAwaitConcurrent(userdata, batch, deadline);
            const self = active;
            const previous = self.starts.fetchAdd(1, .acq_rel);
            std.debug.assert(previous < 2);
            defer _ = self.finished.fetchAdd(1, .release);
            if (previous == 1) self.started.set(std.testing.io);
            // Hold both provider waits pending until cancellation, with a failure bound for cleanup.
            const limit = (std.Io.Timeout{ .duration = .{ .raw = .fromSeconds(5), .clock = .awake } }).toDeadline(std.testing.io);
            for (0..16) |_| {
                self.parked.waitTimeout(std.testing.io, limit) catch |err| switch (err) {
                    error.Canceled => {
                        _ = self.canceled.fetchAdd(1, .release);
                        return err;
                    },
                    error.Timeout => {
                        // Event waits can report a spurious wake for the cancellation signal.
                        std.testing.io.checkCancel() catch |canceled| {
                            _ = self.canceled.fetchAdd(1, .release);
                            return canceled;
                        };
                        if (limit.toDurationFromNow(std.testing.io).?.raw.nanoseconds <= 0) return error.Timeout;
                        continue;
                    },
                };
                unreachable;
            }
            return error.Timeout;
        }

        fn receive(receiver: *Sockets, io: std.Io) Sockets.DatagramError!void {
            var buffer: [payload_max]u8 = undefined;
            _ = try receiver.receiveDatagram(io, &buffer, .none);
        }
    };
    var worker: Worker = .{};
    Worker.active = &worker;
    var vtable = std.testing.io.vtable.*;
    vtable.batchAwaitConcurrent = Worker.wait;
    const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
    var receiver = try std.testing.io.concurrent(Worker.receive, .{ &target, io });
    defer _ = receiver.cancel(std.testing.io) catch {};
    const startup_deadline = oneSecond().toDeadline(std.testing.io);
    for (0..16) |_| {
        if (worker.started.isSet()) break;
        worker.started.waitTimeout(std.testing.io, startup_deadline) catch |err| switch (err) {
            error.Canceled => return err,
            error.Timeout => {},
        };
        if (worker.started.isSet()) break;
        if (startup_deadline.toDurationFromNow(std.testing.io).?.raw.nanoseconds <= 0) return error.Timeout;
    } else return error.StartupWakeLimit;
    try std.testing.expectEqual(@as(u8, 2), worker.starts.load(.acquire));
    try std.testing.expectEqual(@as(u8, 0), worker.finished.load(.acquire));
    for (destinations) |address| try sender.sendTo(std.testing.io, address.?, "retained", payload_max);
    try std.testing.expectError(error.Canceled, receiver.cancel(std.testing.io));
    try std.testing.expectEqual(@as(u8, 2), worker.finished.load(.acquire));
    try std.testing.expectEqual(@as(u8, 2), worker.canceled.load(.acquire));
    var buffer: [payload_max]u8 = undefined;
    var families: [2]bool = @splat(false);
    for (0..2) |_| {
        const packet = try target.receiveDatagram(std.testing.io, &buffer, oneSecond());
        try std.testing.expectEqualStrings("retained", packet.bytes);
        const family: usize = if (packet.from == .ip4) 0 else 1;
        try std.testing.expect(!families[family]);
        families[family] = true;
    }
    try std.testing.expectEqual([2]bool{ true, true }, families);
    var ready: [2]bool = @splat(true);
    try std.testing.expectEqual(null, try target.receiveReadyDatagram(std.testing.io, &buffer, &ready));
}

test "dual-stack UDP ready reads reject a truncated datagram and keep reading its family" {
    var buffer: [payload_max]u8 = undefined;
    var target = try Sockets.bind(std.testing.io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } });
    defer target.close(std.testing.io);
    const local = target.localAddresses();
    var raw_sender = try (net.IpAddress{ .ip4 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer raw_sender.close(std.testing.io);
    const oversized = [_]u8{0x55} ** (payload_max + 1);
    try raw_sender.send(std.testing.io, &Address.toNetwork(local[0].?), &oversized);
    try target.sendTo(std.testing.io, local[0].?, "ip4", payload_max);
    try target.sendTo(std.testing.io, local[1].?, "ip6", payload_max);
    var ready: [2]bool = @splat(true);
    try waitForDatagram(target.values[0].?);
    try std.testing.expectError(error.DatagramTooLarge, target.receiveReadyDatagram(std.testing.io, &buffer, &ready));
    try waitForDatagram(target.values[1].?);
    try std.testing.expectEqualSlices(u8, "ip6", (try target.receiveReadyDatagram(std.testing.io, &buffer, &ready)).?.bytes);
    try waitForDatagram(target.values[0].?);
    try std.testing.expectEqualSlices(u8, "ip4", (try target.receiveReadyDatagram(std.testing.io, &buffer, &ready)).?.bytes);
    try std.testing.expectEqual([2]bool{ true, true }, ready);
    try std.testing.expectEqual(null, try target.receiveReadyDatagram(std.testing.io, &buffer, &ready));
    try std.testing.expectEqual([2]bool{ false, false }, ready);
}

test "ordered UDP batches preserve every prefix across chunks families and invalid inputs" {
    const Recorder = struct {
        seen: usize = 0,
        stop: ?usize = null,
        fn send(context: ?*anyopaque, _: net.Socket.Handle, messages: []net.OutgoingMessage, _: net.SendFlags) struct { ?net.Socket.SendError, usize } {
            const self: *@This() = @ptrCast(@alignCast(context.?));
            for (messages, 0..) |message, i| {
                if (self.stop == self.seen) return .{ error.NetworkUnreachable, i };
                std.debug.assert(message.data_len == 1);
                std.debug.assert(message.data_ptr[0] == self.seen);
                std.debug.assert(message.address.getPort() == 9000 + self.seen);
                self.seen += 1;
            }
            return .{ null, messages.len };
        }
    };
    var sockets = try Sockets.bind(std.testing.io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } });
    defer sockets.close(std.testing.io);
    var scratch: Sockets.BatchScratch = undefined;
    var payload: [21]u8 = undefined;
    var outgoing: [21]Sockets.Outgoing = undefined;
    for (&payload, &outgoing, 0..) |*byte, *packet, i| {
        byte.* = @intCast(i);
        // The first run crosses scratch capacity; later runs alternate families.
        const address: net.IpAddress = if (i < 17 or i % 2 == 0) .{ .ip4 = .loopback(@intCast(9000 + i)) } else .{ .ip6 = .loopback(@intCast(9000 + i)) };
        packet.* = .{ .to = Address.fromNetwork(address), .bytes = byte[0..1] };
    }
    var recorder: Recorder = .{};
    var vtable = std.testing.io.vtable.*;
    vtable.netSend = Recorder.send;
    const io: std.Io = .{ .userdata = &recorder, .vtable = &vtable };
    for (0..outgoing.len + 1) |prefix| {
        recorder = .{ .stop = prefix };
        const result = sockets.sendMany(io, &outgoing, 1, &scratch);
        try std.testing.expectEqual(prefix, result.sent);
        try std.testing.expectEqual(prefix, recorder.seen);
        if (prefix == outgoing.len) {
            try std.testing.expect(result.failure == null);
        } else try std.testing.expectEqual(error.NetworkUnreachable, result.failure.?);
    }
    for (0..outgoing.len) |invalid| {
        const bytes = outgoing[invalid].bytes;
        outgoing[invalid].bytes = "oversized";
        recorder = .{};
        try std.testing.expectEqual(Sockets.SendOutcome{ .sent = invalid, .failure = error.DatagramTooLarge }, sockets.sendMany(io, &outgoing, 1, &scratch));
        if (invalid > 0) {
            recorder = .{ .stop = invalid - 1 };
            try std.testing.expectEqual(Sockets.SendOutcome{ .sent = invalid - 1, .failure = error.NetworkUnreachable }, sockets.sendMany(io, &outgoing, 1, &scratch));
        }
        outgoing[invalid].bytes = bytes;
        const address = outgoing[invalid].to;
        switch (outgoing[invalid].to) {
            inline else => |*ip| ip.port = 0,
        }
        recorder = .{};
        try std.testing.expectEqual(Sockets.SendOutcome{ .sent = invalid, .failure = error.DestinationRefused }, sockets.sendMany(io, &outgoing, 1, &scratch));
        if (invalid > 0) {
            recorder = .{ .stop = invalid - 1 };
            try std.testing.expectEqual(Sockets.SendOutcome{ .sent = invalid - 1, .failure = error.NetworkUnreachable }, sockets.sendMany(io, &outgoing, 1, &scratch));
        }
        outgoing[invalid].to = address;
    }
    // Reusing provider scratch for native sends must replace every descriptor.
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 1, .failure = null }, sockets.sendMany(std.testing.io, &.{.{ .to = sockets.localAddress(), .bytes = "native" }}, 6, &scratch));
    var buffer: [8]u8 = undefined;
    try std.testing.expectEqualStrings("native", (try sockets.receiveDatagram(std.testing.io, &buffer, oneSecond())).bytes);
    recorder = .{};
    try std.testing.expectEqual(@as(usize, 1), sockets.sendMany(io, outgoing[0..1], 1, &scratch).sent);
}

test "UDP missing family and native cancellation retain the exact mixed prefix" {
    var sockets = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer sockets.close(std.testing.io);
    var scratch: Sockets.BatchScratch = undefined;
    const batch = [_]Sockets.Outgoing{
        .{ .to = sockets.localAddress(), .bytes = "first" },
        .{ .to = Address.fromNetwork(.{ .ip6 = .loopback(9) }), .bytes = "second" },
        .{ .to = sockets.localAddress(), .bytes = "third" },
    };
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 1, .failure = error.AddressFamilyUnsupported }, sockets.sendMany(std.testing.io, &batch, 8, &scratch));
    var buffer: [8]u8 = undefined;
    try std.testing.expectEqualStrings("first", (try sockets.receiveDatagram(std.testing.io, &buffer, oneSecond())).bytes);
    if (@import("builtin").os.tag != .linux and @import("builtin").os.tag != .macos) return;
    var dual = try Sockets.bind(std.testing.io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } });
    defer dual.close(std.testing.io);
    const Cancel = struct {
        checks: usize = 0,
        fn check(context: ?*anyopaque) std.Io.Cancelable!void {
            const self: *@This() = @ptrCast(@alignCast(context.?));
            self.checks += 1;
            if (self.checks == 2) return error.Canceled;
        }
    };
    var cancel: Cancel = .{};
    var vtable = std.testing.io.vtable.*;
    vtable.checkCancel = Cancel.check;
    const io: std.Io = .{ .userdata = &cancel, .vtable = &vtable };
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 1, .failure = error.Canceled }, dual.sendMany(io, &batch, 8, &scratch));
    try std.testing.expectEqual(@as(usize, 2), cancel.checks);
    try std.testing.expectEqualStrings("first", (try sockets.receiveDatagram(std.testing.io, &buffer, oneSecond())).bytes);
}

test "UDP provider lifetime clears descriptors and telemetry without probing fabricated handles" {
    const Provider = struct {
        closes: usize = 0,
        fn bind(_: ?*anyopaque, address: *const net.IpAddress, _: net.IpAddress.BindOptions) net.IpAddress.BindError!net.Socket {
            return .{ .handle = 73, .address = address.* };
        }
        fn close(context: ?*anyopaque, handles: []const net.Socket.Handle) void {
            const self: *@This() = @ptrCast(@alignCast(context.?));
            std.debug.assert(handles.len == 1 and handles[0] == 73);
            self.closes += 1;
        }
    };
    var provider: Provider = .{};
    var vtable = std.testing.io.vtable.*;
    vtable.netBindIp = Provider.bind;
    vtable.netClose = Provider.close;
    const io: std.Io = .{ .userdata = &provider, .vtable = &vtable };
    var sockets = try Sockets.bind(io, .{ .ip4 = .loopback(0) });
    try std.testing.expectEqual([2]bool{ false, false }, sockets.native);
    _ = sockets.requestBuffers(.{ .receive = Sockets.Buffers.bytes_min, .send = Sockets.Buffers.bytes_min });
    try std.testing.expectEqual([2]?Sockets.Buffers.Reported{ null, null }, sockets.buffers);
    try std.testing.expectEqual([2]?u64{ null, null }, sockets.drops());
    try std.testing.expectError(error.IncompatibleProvider, sockets.sendTo(std.testing.io, Address.fromNetwork(.{ .ip4 = .loopback(9000) }), "fake", 4));
    var buffer: [8]u8 = undefined;
    try std.testing.expectError(error.IncompatibleProvider, sockets.receiveDatagram(std.testing.io, &buffer, .none));
    sockets.close(io);
    sockets.close(io);
    try std.testing.expectEqual(@as(usize, 1), provider.closes);
    try std.testing.expectEqual([2]?net.Socket.Handle{ null, null }, sockets.handles());
    try std.testing.expectEqual([2]?u64{ null, null }, sockets.drops());
    sockets = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer sockets.close(std.testing.io);
    try std.testing.expect(sockets.localAddress().port() > 0);
    if (sockets.drops()[0]) |drops| try std.testing.expectEqual(@as(u64, 0), drops);
}

test "UDP refuses destinations with port zero before I/O" {
    var socket = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer socket.close(std.testing.io);
    for ([_]net.IpAddress{ .{ .ip4 = .loopback(0) }, .{ .ip6 = .loopback(0) } }) |address| {
        try std.testing.expectError(error.DestinationRefused, socket.sendTo(undefined, Address.fromNetwork(address), "x", payload_max));
    }
}

test "UDP receive batches preserve sources lengths truncation and buffer ownership" {
    for ([_]bool{ false, true }) |provider| {
        var target = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
        defer target.close(std.testing.io);
        var other = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
        defer other.close(std.testing.io);
        const payloads = [_][]const u8{ "first", "", "too large", "last" };
        for (payloads, 0..) |payload, i| {
            const sender = if (i % 2 == 0) &target else &other;
            try sender.sendTo(std.testing.io, target.localAddress(), payload, 16);
        }
        var buffers: [4][5]u8 = undefined;
        var slots: [4]Sockets.ReceiveSlot = undefined;
        for (&slots, &buffers) |*slot, *buffer| slot.* = .{ .buffer = buffer };
        var scratch: Sockets.ReceiveScratch = undefined;
        var ready: [2]bool = .{ true, false };
        var faults: FaultIo = .{};
        const io = if (provider) faults.io() else std.testing.io;
        var received: usize = 0;
        for (0..slots.len) |_| {
            try waitForDatagram(target.primary());
            ready = .{ true, false };
            const result = target.receiveManyReady(io, slots[received..], &ready, &scratch);
            try std.testing.expectEqual(@as(?Sockets.ReceiveError, null), result.failure);
            try std.testing.expect(result.received > 0);
            received += result.received;
            if (received == slots.len) break;
        }
        try std.testing.expectEqual(slots.len, received);
        var seen: [payloads.len]bool = @splat(false);
        for (&slots, 0..) |*slot, index| {
            try std.testing.expect(slot.message.data.ptr == &buffers[index]);
            const i = for (payloads, 0..) |payload, i| {
                if (std.mem.eql(u8, slot.message.data, payload[0..@min(payload.len, slot.buffer.len)])) break i;
            } else return error.UnexpectedDatagram;
            try std.testing.expect(!seen[i]);
            seen[i] = true;
            const sender = if (i % 2 == 0) &target else &other;
            try std.testing.expect(Address.fromNetwork(slot.message.from).eql(sender.localAddress()));
            if (i == 2) {
                try std.testing.expectError(error.DatagramTooLarge, slot.datagram());
            } else try std.testing.expectEqualStrings(payloads[i], (try slot.datagram()).bytes);
        }
        try std.testing.expectEqual(Sockets.ReceiveOutcome{}, target.receiveManyReady(io, &slots, &ready, &scratch));
        try std.testing.expect(!ready[0]);
        try other.sendTo(std.testing.io, target.localAddress(), "new", 16);
        try waitForDatagram(target.primary());
        ready = .{ true, false };
        try std.testing.expectEqual(Sockets.ReceiveOutcome{ .received = 1 }, target.receiveManyReady(io, slots[0..1], &ready, &scratch));
        try std.testing.expectEqualStrings("new", (try slots[0].datagram()).bytes);
    }
}

test "UDP receive batches alternate ready families and leave unmarked input queued" {
    var target = try Sockets.bind(std.testing.io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } });
    defer target.close(std.testing.io);
    const local = target.localAddresses();
    for (0..3) |_| for (local) |address| try target.sendTo(std.testing.io, address.?, "data", 16);
    var buffers: [2][8]u8 = undefined;
    var slots: [2]Sockets.ReceiveSlot = undefined;
    for (&slots, &buffers) |*slot, *buffer| slot.* = .{ .buffer = buffer };
    var scratch: Sockets.ReceiveScratch = undefined;
    var ready: [2]bool = .{ false, true };
    var remaining: [2]usize = .{ 3, 3 };
    var next_family: usize = 1;
    for (0..6) |_| {
        const family = if (remaining[next_family] > 0) next_family else 1 - next_family;
        try waitForDatagram(target.values[family].?);
        const result = target.receiveManyReady(std.testing.io, &slots, &ready, &scratch);
        try std.testing.expectEqual(@as(?Sockets.ReceiveError, null), result.failure);
        try std.testing.expect(result.received > 0 and result.received <= @min(slots.len, remaining[family]));
        for (slots[0..result.received]) |*slot| try std.testing.expect((try slot.datagram()).from.eql(local[family].?));
        remaining[family] -= result.received;
        next_family = 1 - family;
        ready = .{ true, true };
        if (remaining[0] + remaining[1] == 0) break;
    }
    try std.testing.expectEqual([2]usize{ 0, 0 }, remaining);
    try std.testing.expectEqual(Sockets.ReceiveOutcome{}, target.receiveManyReady(std.testing.io, &slots, &ready, &scratch));
    try std.testing.expectEqual([2]bool{ false, false }, ready);
}

test "UDP provider receive batches keep their prefix on cancellation" {
    var target = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer target.close(std.testing.io);
    for ([_][]const u8{ "first", "next" }) |payload| try target.sendTo(std.testing.io, target.localAddress(), payload, 16);
    var buffers: [2][8]u8 = undefined;
    var slots: [2]Sockets.ReceiveSlot = undefined;
    for (&slots, &buffers) |*slot, *buffer| slot.* = .{ .buffer = buffer };
    var scratch: Sockets.ReceiveScratch = undefined;
    var ready: [2]bool = .{ true, false };
    var faults: FaultIo = .{ .receive = .{ .at = 2 } };
    try waitForDatagram(target.primary());
    const result = target.receiveManyReady(faults.io(), &slots, &ready, &scratch);
    try std.testing.expectEqual(Sockets.ReceiveOutcome{ .received = 1, .failure = error.Canceled }, result);
    try std.testing.expectEqualStrings("first", (try slots[0].datagram()).bytes);
    try waitForDatagram(target.primary());
    try std.testing.expectEqual(Sockets.ReceiveOutcome{ .received = 1 }, target.receiveManyReady(std.testing.io, &slots, &ready, &scratch));
    try std.testing.expectEqualStrings("next", (try slots[0].datagram()).bytes);
}
