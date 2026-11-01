const std = @import("std");
const Sockets = @import("sockets.zig").Sockets;
const Address = @import("address.zig").Address;
const net = std.Io.net;
const fault_io = @import("fault_io");
const waitForDatagram = @import("socket_test_support").waitForDatagram;

const loopbacks: Sockets.Bindings = .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } };

fn timeout(milliseconds: i64) std.Io.Timeout {
    return .{ .duration = .{ .raw = .fromMilliseconds(milliseconds), .clock = .awake } };
}

/// A ready read that tries every family.
fn readAny(sockets: *Sockets, io: std.Io, buffer: []u8) Sockets.ReceiveError!?net.IncomingMessage {
    var ready: [2]bool = @splat(true);
    return sockets.receiveReady(io, buffer, &ready);
}

test "UDP rejects mapped IPv6 listeners before any provider acquisition" {
    const Provider = struct {
        fn bind(_: ?*anyopaque, _: *const net.IpAddress, _: net.IpAddress.BindOptions) net.IpAddress.BindError!net.Socket {
            return error.NetworkDown;
        }
    };
    var vtable = std.testing.io.vtable.*;
    vtable.netBindIp = Provider.bind;
    const io: std.Io = .{ .userdata = null, .vtable = &vtable };
    const mapped: net.Ip6Address = .{ .bytes = .{0} ** 10 ++ .{ 0xff, 0xff, 127, 0, 0, 1 }, .port = 4001 };
    try std.testing.expectError(error.AddressFamilyUnsupported, Sockets.bind(io, .{ .ip6 = mapped }));
    try std.testing.expectError(error.AddressFamilyUnsupported, Sockets.bind(io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = mapped } }));
    const received = Address.fromNetwork(.{ .ip6 = mapped });
    try std.testing.expectEqualDeep(Address{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4001 } }, received);
    try std.testing.expectEqualDeep(net.IpAddress{ .ip4 = .loopback(4001) }, received.toNetwork());
    try std.testing.expect(!(Address{ .ip6 = .{ .octets = mapped.bytes, .port = 9000 } }).isUsable());
}

test "UDP delegates both families to the supplied bind provider" {
    const Provider = struct {
        fn bind(_: ?*anyopaque, address: *const net.IpAddress, options: net.IpAddress.BindOptions) net.IpAddress.BindError!net.Socket {
            std.debug.assert(options.ip6_only == (address.* == .ip6));
            std.debug.assert(options.mode == .dgram and options.protocol == .udp);
            return error.NetworkDown;
        }
    };
    var vtable = std.testing.io.vtable.*;
    vtable.netBindIp = Provider.bind;
    const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
    try std.testing.expectError(error.NetworkDown, Sockets.bind(io, .{ .ip4 = .loopback(0) }));
    try std.testing.expectError(error.NetworkDown, Sockets.bind(io, .{ .ip6 = .loopback(0) }));
}

test "UDP wildcard listeners share a port and keep datagrams in their address family" {
    var sockets = try Sockets.bind(std.testing.io, .{ .ip6 = .unspecified(0) });
    defer sockets.close(std.testing.io);
    const port = sockets.values[1].?.address.getPort();
    sockets.values[0] = try (net.IpAddress{ .ip4 = .unspecified(port) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    var senders = try Sockets.bind(std.testing.io, loopbacks);
    defer senders.close(std.testing.io);
    for ([_]net.IpAddress{ .{ .ip4 = .loopback(port) }, .{ .ip6 = .loopback(port) } }, 0..) |destination, family| {
        try senders.values[family].?.send(std.testing.io, &destination, "same port");
        var buffer: [16]u8 = undefined;
        const packet = try sockets.values[family].?.receiveTimeout(std.testing.io, &buffer, timeout(1000));
        try std.testing.expectEqual(@as(usize, family), if (packet.from == .ip4) @as(usize, 0) else 1);
        try std.testing.expectEqualStrings("same port", packet.data);
    }
    sockets.close(std.testing.io);
    sockets = try Sockets.bind(std.testing.io, .{ .dual = .{ .ip4 = .unspecified(port), .ip6 = .unspecified(port) } });
    try std.testing.expectEqual(port, sockets.values[0].?.address.getPort());
    try std.testing.expectEqual(port, sockets.values[1].?.address.getPort());
    try std.testing.expectError(error.AddressInUse, Sockets.bind(std.testing.io, .{ .ip6 = .unspecified(port) }));
}

test "UDP rolls back the first bind through its provider when the second fails" {
    const Provider = struct {
        binds: u8 = 0,
        closes: u8 = 0,

        fn bind(context: ?*anyopaque, address: *const net.IpAddress, _: net.IpAddress.BindOptions) net.IpAddress.BindError!net.Socket {
            const self: *@This() = @ptrCast(@alignCast(context.?));
            self.binds += 1;
            return switch (address.*) {
                .ip4 => .{ .handle = 73, .address = address.* },
                .ip6 => error.AddressInUse,
            };
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
    try std.testing.expectError(error.AddressInUse, Sockets.bind(io, loopbacks));
    try std.testing.expectEqual(@as(u8, 2), provider.binds);
    try std.testing.expectEqual(@as(u8, 1), provider.closes);
}

test "UDP retains packets arriving between readiness probes and blocking receives" {
    var sockets = try Sockets.bind(std.testing.io, loopbacks);
    defer sockets.close(std.testing.io);
    const Arrival = struct {
        var targets: [2]?net.Socket = undefined;
        var fired: std.atomic.Value(bool) = .init(false);

        fn wait(userdata: ?*anyopaque, batch: *std.Io.Batch, deadline: std.Io.Timeout) std.Io.Batch.AwaitConcurrentError!void {
            const operation = batch.storage[batch.submitted.head.toIndex()].submission.operation.net_receive;
            if (operation.flags.peek and !fired.swap(true, .acq_rel)) {
                // The first arrival can finish the other waiter and cancel this injector.
                const protection = std.testing.io.swapCancelProtection(.blocked);
                defer _ = std.testing.io.swapCancelProtection(protection);
                for (targets) |target| target.?.send(std.testing.io, &target.?.address, "arrival") catch unreachable;
            }
            return std.testing.io.vtable.batchAwaitConcurrent(userdata, batch, deadline);
        }
    };
    Arrival.targets = sockets.values;
    Arrival.fired.store(false, .release);
    var vtable = std.testing.io.vtable.*;
    vtable.batchAwaitConcurrent = Arrival.wait;
    const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
    var buffer: [16]u8 = undefined;
    var families: [2]bool = @splat(false);
    for (0..2) |_| {
        const packet = try sockets.receiveTimeout(io, &buffer, timeout(1_000));
        try std.testing.expectEqualStrings("arrival", packet.data);
        const family: usize = if (packet.from == .ip4) 0 else 1;
        try std.testing.expect(!families[family]);
        families[family] = true;
    }
    try std.testing.expect(Arrival.fired.load(.acquire));
    try std.testing.expect(families[0] and families[1]);
    try std.testing.expectEqual(null, try readAny(&sockets, io, &buffer));
}

test "UDP partial wait startup failure cancels the first task and leaves sockets usable" {
    var sockets = try Sockets.bind(std.testing.io, loopbacks);
    defer sockets.close(std.testing.io);
    const Provider = struct {
        threadlocal var starts: u8 = 0;

        fn start(userdata: ?*anyopaque, group: *std.Io.Group, context: []const u8, alignment: std.mem.Alignment, run: *const fn (*const anyopaque) void) std.Io.ConcurrentError!void {
            starts += 1;
            if (starts == 2) return error.ConcurrencyUnavailable;
            return std.testing.io.vtable.groupConcurrent(userdata, group, context, alignment, run);
        }
    };
    Provider.starts = 0;
    var vtable = std.testing.io.vtable.*;
    vtable.groupConcurrent = Provider.start;
    const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
    var buffer: [16]u8 = undefined;
    try std.testing.expectError(error.ConcurrencyUnavailable, sockets.receiveTimeout(io, &buffer, .none));
    try std.testing.expectEqual(@as(u8, 2), Provider.starts);
    for (sockets.values) |target| {
        try target.?.send(std.testing.io, &target.?.address, "retained");
        try waitForDatagram(target.?);
    }
    for (0..2) |_| {
        const packet = (try readAny(&sockets, std.testing.io, &buffer)).?;
        try std.testing.expectEqualStrings("retained", packet.data);
    }
}

test "UDP dual-stack timeout joins waits and ready reads need no concurrency" {
    var threaded = std.Io.Threaded.init(std.testing.allocator, .{ .concurrent_limit = .nothing });
    defer threaded.deinit();
    const io = threaded.io();
    var sockets = try Sockets.bind(io, loopbacks);
    defer sockets.close(io);
    var buffer: [16]u8 = undefined;
    try std.testing.expectEqual(null, try readAny(&sockets, io, &buffer));
    try std.testing.expectError(error.Timeout, sockets.receiveTimeout(io, &buffer, timeout(0)));
    for (sockets.values) |target| {
        try target.?.send(io, &target.?.address, "ready");
        try waitForDatagram(target.?);
    }
    for (0..2) |_| {
        const packet = try sockets.receiveTimeout(io, &buffer, timeout(0));
        try std.testing.expectEqualStrings("ready", packet.data);
    }
    var concurrent_sockets = try Sockets.bind(std.testing.io, loopbacks);
    defer concurrent_sockets.close(std.testing.io);
    try std.testing.expectError(error.Timeout, concurrent_sockets.receiveTimeout(std.testing.io, &buffer, timeout(10)));
    try std.testing.expectEqual(null, try readAny(&concurrent_sockets, std.testing.io, &buffer));
}

fn kernelSize(handle: net.Socket.Handle, option: u32) !u32 {
    const p = std.posix;
    var value: c_int = 0;
    var len: p.socklen_t = @sizeOf(c_int);
    try std.testing.expectEqual(p.E.SUCCESS, p.errno(p.system.getsockopt(handle, p.SOL.SOCKET, option, std.mem.asBytes(&value), &len)));
    return @intCast(value);
}

test "UDP records the kernel's socket buffer sizes and receive drops after a request" {
    const os = @import("builtin").os.tag;
    if (os != .linux and os != .macos) return error.SkipZigTest;
    var plain = try Sockets.bind(std.testing.io, loopbacks);
    defer plain.close(std.testing.io);
    var sockets = try Sockets.bind(std.testing.io, loopbacks);
    defer sockets.close(std.testing.io);
    const largest: Sockets.Buffers = .{ .receive = Sockets.Buffers.bytes_max, .send = Sockets.Buffers.bytes_max };
    const short = sockets.requestBuffers(largest);
    const full: u64 = if (os == .linux) 2 * @as(u64, Sockets.Buffers.bytes_max) else Sockets.Buffers.bytes_max;
    for (sockets.values, sockets.buffers, short) |socket, reported, below| {
        try std.testing.expectEqual(try kernelSize(socket.?.handle, std.posix.SO.RCVBUF), reported.?.receive.?);
        try std.testing.expectEqual(try kernelSize(socket.?.handle, std.posix.SO.SNDBUF), reported.?.send.?);
        try std.testing.expectEqual(reported.?.receive.? < full or reported.?.send.? < full, below);
    }
    try std.testing.expectEqual([2]?Sockets.Buffers.Reported{ null, null }, plain.buffers);
    // A supported observation must work equally before and after requesting buffers.
    try std.testing.expectEqual(sockets.drops(), plain.drops());
    const smallest: Sockets.Buffers = .{ .receive = Sockets.Buffers.bytes_min, .send = Sockets.Buffers.bytes_min };
    try std.testing.expectEqual([2]bool{ false, false }, sockets.requestBuffers(smallest));
    if (os != .linux) return;
    // Kernels without SO_MEMINFO report no drop count, and production exports none.
    const initial = sockets.drops();
    if (initial[0] == null) return;
    try std.testing.expectEqual([2]?u64{ 0, 0 }, initial);
    const sent = 256;
    var payload: [1200]u8 = @splat(0);
    for (0..sent) |_| try plain.values[0].?.send(std.testing.io, &sockets.values[0].?.address, &payload);
    var received: usize = 0;
    for (0..1000) |_| {
        while (try readAny(&sockets, std.testing.io, &payload)) |_| received += 1;
        if (received + sockets.drops()[0].? == sent) break;
        try std.Io.sleep(std.testing.io, .fromMilliseconds(1), .awake);
    }
    try std.testing.expect(received > 0 and received < sent);
    try std.testing.expectEqual(sent, received + sockets.drops()[0].?);
    try std.testing.expectEqual(@as(?u64, 0), sockets.drops()[1]);
}

test "UDP drop totals extend kernel counter wraps independently without recounting" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var sockets = try Sockets.bind(std.testing.io, loopbacks);
    defer sockets.close(std.testing.io);

    const initial = sockets.drops();
    if (initial[0] == null or initial[1] == null) return error.SkipZigTest;
    try std.testing.expectEqual([2]?u64{ 0, 0 }, initial);

    // Seed earlier samples across wrap boundaries; idle sockets supply a stable zero.
    const wrap: u64 = 1 << 32;
    sockets.drop_counts[0] = .{ .last = std.math.maxInt(u32), .total = wrap - 1 };
    try std.testing.expectEqual([2]?u64{ wrap, 0 }, sockets.drops());
    try std.testing.expectEqual([2]?u64{ wrap, 0 }, sockets.drops());

    sockets.drop_counts[1] = .{ .last = 1, .total = wrap + 1 };
    try std.testing.expectEqual([2]?u64{ wrap, 2 * wrap }, sockets.drops());
    try std.testing.expectEqual([2]?u64{ wrap, 2 * wrap }, sockets.drops());
}

test "UDP records a failed size readback as unknown and not below the request" {
    const os = @import("builtin").os.tag;
    if (os != .linux and os != .macos) return error.SkipZigTest;
    // getsockopt fails on a descriptor that is not open.
    var sockets: Sockets = .{ .native = .{ true, false }, .values = .{ .{ .handle = -1, .address = .{ .ip4 = .loopback(0) } }, null } };
    const largest: Sockets.Buffers = .{ .receive = Sockets.Buffers.bytes_max, .send = Sockets.Buffers.bytes_max };
    try std.testing.expectEqual([2]bool{ false, false }, sockets.requestBuffers(largest));
    try std.testing.expectEqual([2]?Sockets.Buffers.Reported{ .{ .receive = null, .send = null }, null }, sockets.buffers);
    try std.testing.expectEqual([2]?u64{ null, null }, sockets.drops());
}

test "UDP batches report the exact prefix before a failing datagram and resume after it" {
    var sockets = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer sockets.close(std.testing.io);
    const self_address = sockets.primary().address;
    // Linux refuses a broadcast without SO_BROADCAST with EACCES.
    const broadcast: net.IpAddress = .{ .ip4 = .{ .bytes = @splat(255), .port = self_address.ip4.port } };
    const messages = [_]Sockets.Outgoing{
        .{ .to = Address.fromNetwork(self_address), .bytes = "first" },
        .{ .to = Address.fromNetwork(broadcast), .bytes = "refused" },
        .{ .to = Address.fromNetwork(self_address), .bytes = "third" },
    };
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 0, .failure = error.AccessDenied }, sendMany(&sockets, std.testing.io, messages[1..]));
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 1, .failure = error.AccessDenied }, sendMany(&sockets, std.testing.io, &messages));
    try std.testing.expectEqual(@as(usize, 5), messages[0].bytes.len);
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 1, .failure = null }, sendMany(&sockets, std.testing.io, messages[2..]));
    var buffer: [16]u8 = undefined;
    for ([_][]const u8{ "first", "third" }) |expected| {
        try waitForDatagram(sockets.primary());
        try std.testing.expectEqualStrings(expected, (try readAny(&sockets, std.testing.io, &buffer)).?.data);
    }
    try std.testing.expectEqual(null, try readAny(&sockets, std.testing.io, &buffer));
}

test "UDP native single batch and ready receive check cancellation before I/O" {
    const os = @import("builtin").os.tag;
    if (os != .linux and os != .macos) return error.SkipZigTest;
    const Canceled = struct {
        fn check(_: ?*anyopaque) std.Io.Cancelable!void {
            return error.Canceled;
        }
    };
    var sockets = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer sockets.close(std.testing.io);
    var vtable = std.testing.io.vtable.*;
    vtable.checkCancel = Canceled.check;
    const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
    const destination = sockets.primary().address;
    const message: Sockets.Outgoing = .{ .to = Address.fromNetwork(destination), .bytes = "canceled" };
    try std.testing.expectError(error.Canceled, sockets.sendTo(io, message.to, message.bytes, 16));
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 0, .failure = error.Canceled }, sendMany(&sockets, io, (&message)[0..1]));
    var buffer: [16]u8 = undefined;
    try std.testing.expectEqual(null, try readAny(&sockets, std.testing.io, &buffer));
    try sockets.sendTo(std.testing.io, message.to, "retained", 16);
    try waitForDatagram(sockets.primary());
    var ready: [2]bool = .{ true, false };
    try std.testing.expectError(error.Canceled, sockets.receiveReady(io, &buffer, &ready));
    try std.testing.expectEqual([2]bool{ true, false }, ready);
    try std.testing.expectEqualStrings("retained", (try sockets.receiveReady(std.testing.io, &buffer, &ready)).?.data);
}

test "UDP native retry cancellation preserves a same-family successful prefix" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    const Cancel = struct {
        checks: usize = 0,
        fn check(context: ?*anyopaque) std.Io.Cancelable!void {
            const self: *@This() = @ptrCast(@alignCast(context.?));
            self.checks += 1;
            if (self.checks == 2) return error.Canceled;
        }
    };
    var sockets = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer sockets.close(std.testing.io);
    var cancel: Cancel = .{};
    var vtable = std.testing.io.vtable.*;
    vtable.checkCancel = Cancel.check;
    const io: std.Io = .{ .userdata = &cancel, .vtable = &vtable };
    const messages = [_]Sockets.Outgoing{
        .{ .to = sockets.localAddress(), .bytes = "prefix" },
        .{ .to = .{ .ip4 = .{ .octets = @splat(255), .port = sockets.localAddress().port() } }, .bytes = "refused" },
        .{ .to = sockets.localAddress(), .bytes = "suffix" },
    };
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 1, .failure = error.Canceled }, sendMany(&sockets, io, &messages));
    try std.testing.expectEqual(@as(usize, 2), cancel.checks);
    var buffer: [16]u8 = undefined;
    try std.testing.expectEqualStrings("prefix", (try readAny(&sockets, std.testing.io, &buffer)).?.data);
    try std.testing.expectEqual(null, try readAny(&sockets, std.testing.io, &buffer));
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 1, .failure = null }, sendMany(&sockets, std.testing.io, messages[2..]));
    try std.testing.expectEqualStrings("suffix", (try readAny(&sockets, std.testing.io, &buffer)).?.data);
}

test "UDP leaves sends to a provider that replaces them" {
    var sockets = try Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer sockets.close(std.testing.io);
    var faults: fault_io = .{ .send = .{} };
    const destination = Address.fromNetwork(sockets.primary().address);
    try std.testing.expectError(error.AddressFamilyUnsupported, sockets.sendTo(faults.io(), destination, "provider", 16));
    try std.testing.expectEqual(@as(usize, 1), faults.send_calls);
    const message: Sockets.Outgoing = .{ .to = Address.fromNetwork(sockets.primary().address), .bytes = "provider" };
    try std.testing.expectEqual(Sockets.SendOutcome{ .sent = 0, .failure = error.AddressFamilyUnsupported }, sendMany(&sockets, faults.io(), (&message)[0..1]));
    try std.testing.expectEqual(@as(usize, 2), faults.send_calls);
}

test "UDP ready reads alternate marked families across turns and clear each one found empty" {
    var sockets = try Sockets.bind(std.testing.io, loopbacks);
    defer sockets.close(std.testing.io);
    const ip4 = sockets.values[0].?;
    const ip6 = sockets.values[1].?;
    for ([_][]const u8{ "4a", "4b", "4c" }) |payload| try ip4.send(std.testing.io, &ip4.address, payload);
    for ([_][]const u8{ "6a", "6b" }) |payload| try ip6.send(std.testing.io, &ip6.address, payload);
    var buffer: [16]u8 = undefined;
    // A turn whose quota ends after three reads leaves the next turn to start at the other family.
    for ([_][]const []const u8{ &.{ "4a", "6a", "4b" }, &.{ "6b", "4c" } }) |turn| {
        var ready: [2]bool = @splat(true);
        for (turn) |expected| {
            try waitForDatagram(if (expected[0] == '4') ip4 else ip6);
            const message = (try sockets.receiveReady(std.testing.io, &buffer, &ready)).?;
            try std.testing.expectEqualStrings(expected, message.data);
            try std.testing.expectEqual([2]bool{ true, true }, ready);
        }
        if (turn.len == 2) {
            try std.testing.expectEqual(null, try sockets.receiveReady(std.testing.io, &buffer, &ready));
            try std.testing.expectEqual([2]bool{ false, false }, ready);
        }
    }
    try ip6.send(std.testing.io, &ip6.address, "6c");
    try waitForDatagram(ip6);
    var ready: [2]bool = .{ true, false };
    try std.testing.expectEqual(null, try sockets.receiveReady(std.testing.io, &buffer, &ready));
    try std.testing.expectEqual([2]bool{ false, false }, ready);
    ready = .{ false, true };
    try std.testing.expectEqualStrings("6c", (try sockets.receiveReady(std.testing.io, &buffer, &ready)).?.data);
    var single = try Sockets.bind(std.testing.io, .{ .ip6 = .loopback(0) });
    defer single.close(std.testing.io);
    ready = @splat(true);
    try std.testing.expectEqual(null, try single.receiveReady(std.testing.io, &buffer, &ready));
    try std.testing.expectEqual([2]bool{ true, false }, ready);
}

test "UDP ready reads leave a provider that replaces timed receives on its own receive" {
    var sockets = try Sockets.bind(std.testing.io, loopbacks);
    defer sockets.close(std.testing.io);
    for (sockets.values) |target| {
        try target.?.send(std.testing.io, &target.?.address, "provider");
        try waitForDatagram(target.?);
    }
    var faults: fault_io = .{};
    var buffer: [16]u8 = undefined;
    var ready: [2]bool = .{ true, false };
    try std.testing.expectEqualStrings("provider", (try sockets.receiveReady(faults.io(), &buffer, &ready)).?.data);
    try std.testing.expectEqual(null, try sockets.receiveReady(faults.io(), &buffer, &ready));
    try std.testing.expectEqual([2]bool{ false, false }, ready);
    // One provider receive per read, the empty one included, and none for the unmarked family.
    try std.testing.expectEqual(@as(usize, 2), faults.receive_calls);
    faults.receive = .{ .at = 3 };
    ready = .{ false, true };
    try std.testing.expectError(error.Canceled, sockets.receiveReady(faults.io(), &buffer, &ready));
    try std.testing.expectEqual([2]bool{ false, true }, ready);
    faults.receive = null;
    try std.testing.expectEqualStrings("provider", (try sockets.receiveReady(faults.io(), &buffer, &ready)).?.data);
}

fn sendMany(sockets: *const Sockets, io: std.Io, messages: []const Sockets.Outgoing) Sockets.SendOutcome {
    var scratch: Sockets.BatchScratch = undefined;
    return sockets.sendMany(io, messages, 1500, &scratch);
}
