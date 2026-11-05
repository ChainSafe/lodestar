const std = @import("std");
const wait = @import("wait.zig");
const net = std.Io.net;
const Sockets = @import("udp").Sockets;

fn socket() !net.Socket {
    return (net.IpAddress{ .ip4 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
}

test "native wait retains independent and simultaneous datagrams with actual zero wait" {
    if (!wait.supported) return error.SkipZigTest;
    const first = try socket();
    defer first.close(std.testing.io);
    const second = try socket();
    defer second.close(std.testing.io);
    const host = try socket();
    defer host.close(std.testing.io);
    const sources: wait.Sources = .{ .quic = .{ first.handle, null }, .discovery = .{ second.handle, null }, .host = host.handle };
    const empty = wait.poll(std.testing.io, sources, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(0) } });
    try std.testing.expect(empty.failure == null);
    try std.testing.expect(!empty.quicReady() and !empty.discoveryReady() and !empty.host);
    const sockets = [_]net.Socket{ first, second, host };
    for (sockets, 0..) |target, index| {
        try host.send(std.testing.io, &target.address, "retained");
        const ready = wait.poll(std.testing.io, sources, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(100) } });
        try std.testing.expect(ready.failure == null);
        try std.testing.expectEqual([2]bool{ index == 0, false }, ready.quic);
        try std.testing.expectEqual([2]bool{ index == 1, false }, ready.discovery);
        try std.testing.expectEqual(index == 2, ready.host);
        var buffer: [8]u8 = undefined;
        const message = try target.receiveTimeout(std.testing.io, &buffer, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(0) } });
        try std.testing.expectEqualStrings("retained", message.data);
    }
    for (sockets) |target| try host.send(std.testing.io, &target.address, "queued");
    const all = wait.poll(std.testing.io, sources, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(0) } });
    try std.testing.expect(all.failure == null and all.quic[0] and all.discoveryReady() and all.host);
    for (sockets) |target| {
        var buffer: [8]u8 = undefined;
        const message = try target.receiveTimeout(std.testing.io, &buffer, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(0) } });
        try std.testing.expectEqualStrings("queued", message.data);
    }
}

test "native wait delayed wake preserves payload on each source" {
    if (!wait.supported) return error.SkipZigTest;
    const first = try socket();
    defer first.close(std.testing.io);
    const second = try socket();
    defer second.close(std.testing.io);
    const host = try socket();
    defer host.close(std.testing.io);
    for ([_]net.Socket{ first, second, host }, 0..) |target, index| {
        const sender = try std.Thread.spawn(.{}, delayedSend, .{ host, target.address });
        defer sender.join();
        const result = wait.poll(std.testing.io, .{ .quic = .{ first.handle, null }, .discovery = .{ second.handle, null }, .host = host.handle }, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(1000) } });
        try std.testing.expect(result.failure == null);
        try std.testing.expectEqual([2]bool{ index == 0, false }, result.quic);
        try std.testing.expectEqual([2]bool{ index == 1, false }, result.discovery);
        try std.testing.expectEqual(index == 2, result.host);
        var buffer: [8]u8 = undefined;
        const message = try target.receiveTimeout(std.testing.io, &buffer, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(0) } });
        try std.testing.expectEqualStrings("delayed", message.data);
    }
}

fn delayedSend(sender: net.Socket, address: net.IpAddress) void {
    std.testing.io.sleep(.fromMilliseconds(10), .awake) catch unreachable;
    sender.send(std.testing.io, &address, "delayed") catch unreachable;
}

test "native wait cancellation checkpoints preserve readiness after completion" {
    if (!wait.supported) return error.SkipZigTest;
    const target = try socket();
    defer target.close(std.testing.io);
    try target.send(std.testing.io, &target.address, "queued");
    var vtable = std.testing.io.vtable.*;
    vtable.checkCancel = Cancellation.check;
    vtable.now = Cancellation.now;
    var cancellation: Cancellation = .{ .cancel_at = 1 };
    const io: std.Io = .{ .userdata = &cancellation, .vtable = &vtable };
    const before = wait.poll(io, .{ .quic = .{ target.handle, null } }, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(100) } });
    try std.testing.expect(before.cancelled);
    try std.testing.expectEqual(error.Canceled, before.failure.?);
    try std.testing.expect(!before.quicReady());
    cancellation = .{ .cancel_at = 2 };
    const after = wait.poll(io, .{ .quic = .{ target.handle, null } }, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(100) } });
    try std.testing.expect(after.cancelled);
    try std.testing.expectEqual(error.Canceled, after.failure.?);
    try std.testing.expectEqual([2]bool{ true, false }, after.quic);
    var buffer: [8]u8 = undefined;
    const message = try target.receiveTimeout(std.testing.io, &buffer, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(0) } });
    try std.testing.expectEqualStrings("queued", message.data);
}

const Cancellation = struct {
    checks: u8 = 0,
    cancel_at: u8,
    fn now(_: ?*anyopaque, clock: std.Io.Clock) std.Io.Timestamp {
        return std.testing.io.vtable.now(std.testing.io.userdata, clock);
    }
    fn check(context: ?*anyopaque) std.Io.Cancelable!void {
        const self: *Cancellation = @ptrCast(@alignCast(context.?));
        self.checks += 1;
        if (self.checks == self.cancel_at) return error.Canceled;
    }
};

test "dual-stack native wait observes all four protocol sockets and host wake without consuming data" {
    if (!wait.supported) return error.SkipZigTest;
    const bindings: Sockets.Bindings = .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } };
    var quic = try Sockets.bind(std.testing.io, bindings);
    defer quic.close(std.testing.io);
    var discovery = try Sockets.bind(std.testing.io, bindings);
    defer discovery.close(std.testing.io);
    const host = try socket();
    defer host.close(std.testing.io);
    const sources: wait.Sources = .{ .quic = quic.handles(), .discovery = discovery.handles(), .host = host.handle };
    const sockets = quic.values ++ discovery.values ++ [_]?net.Socket{host};
    for (sockets, 0..) |item, index| {
        const target = item.?;
        try target.send(std.testing.io, &target.address, "ready");
        const result = wait.poll(std.testing.io, sources, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(100) } });
        try std.testing.expect(result.failure == null);
        try std.testing.expectEqual([2]bool{ index == 0, index == 1 }, result.quic);
        try std.testing.expectEqual([2]bool{ index == 2, index == 3 }, result.discovery);
        try std.testing.expectEqual(index == 4, result.host);
        var buffer: [8]u8 = undefined;
        const message = try target.receiveTimeout(std.testing.io, &buffer, .{ .duration = .{ .raw = .zero, .clock = .awake } });
        try std.testing.expectEqualStrings("ready", message.data);
    }
}

test "native wait reports each QUIC family and a datagram arriving after its snapshot wakes the next poll" {
    if (!wait.supported) return error.SkipZigTest;
    const bindings: Sockets.Bindings = .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } };
    var quic = try Sockets.bind(std.testing.io, bindings);
    defer quic.close(std.testing.io);
    const ip4 = quic.values[0].?;
    const ip6 = quic.values[1].?;
    const sources: wait.Sources = .{ .quic = quic.handles() };
    try ip4.send(std.testing.io, &ip4.address, "early");
    const snapshot = wait.poll(std.testing.io, sources, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(100) } });
    try std.testing.expect(snapshot.failure == null);
    try std.testing.expectEqual([2]bool{ true, false }, snapshot.quic);
    // Arrivals after the snapshot: one on the ready family, one on the other.
    try ip4.send(std.testing.io, &ip4.address, "later");
    try ip6.send(std.testing.io, &ip6.address, "later");
    var ready = snapshot.quic;
    var buffer: [8]u8 = undefined;
    for ([_][]const u8{ "early", "later" }) |expected| {
        try std.testing.expectEqualStrings(expected, (try quic.receiveReady(std.testing.io, &buffer, &ready)).?.data);
    }
    try std.testing.expectEqual(null, try quic.receiveReady(std.testing.io, &buffer, &ready));
    try std.testing.expectEqual([2]bool{ false, false }, ready);
    // An arrival on a family already found empty this turn.
    try ip4.send(std.testing.io, &ip4.address, "last");
    const next = wait.poll(std.testing.io, sources, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(1_000) } });
    try std.testing.expect(next.failure == null);
    try std.testing.expectEqual([2]bool{ true, true }, next.quic);
    ready = next.quic;
    for ([_][]const u8{ "later", "last" }) |expected| {
        try std.testing.expectEqualStrings(expected, (try quic.receiveReady(std.testing.io, &buffer, &ready)).?.data);
    }
}
