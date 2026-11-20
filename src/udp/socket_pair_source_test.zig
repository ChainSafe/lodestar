const std = @import("std");
const FaultIo = @import("fault_io");
const SocketPair = @import("SocketPair.zig");
const Address = @import("address.zig").Address;
const net = std.Io.net;
const io = std.testing.io;
const payload_max = 1_200;

const wildcards: SocketPair.Bindings = .{ .dual = .{ .ip4 = .unspecified(0), .ip6 = .unspecified(0) } };

fn oneSecond() std.Io.Timeout {
    return .{ .duration = .{ .raw = .fromMilliseconds(1_000), .clock = .awake } };
}

fn loopback(last: u8, port: u16) Address {
    return .{ .ip4 = .{ .octets = .{ 127, 0, 0, last }, .port = port } };
}

fn loopback6(port: u16) Address {
    return Address.fromNetwork(.{ .ip6 = .loopback(port) });
}

fn readReady(sockets: *SocketPair, buffer: []u8) !SocketPair.Datagram {
    var ready: [2]bool = @splat(true);
    return (try sockets.receiveReadyDatagram(io, buffer, &ready)) orelse error.NoDatagram;
}

test "a wildcard socket reports the address each datagram was sent to on every receive path" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var target = try SocketPair.bind(io, wildcards);
    defer target.close(io);
    var sender = try SocketPair.bind(io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } });
    defer sender.close(io);
    const ports = target.localAddresses();
    const destinations = [_]Address{ loopback(2, ports[0].?.port()), loopback(3, ports[0].?.port()), loopback6(ports[1].?.port()) };
    var buffer: [16]u8 = undefined;
    var fault: FaultIo = .{};
    for (destinations) |destination| {
        const from = sender.localAddresses()[if (destination == .ip4) 0 else 1].?;
        for (0..4) |_| try sender.sendTo(io, destination, null, "to", payload_max);

        const ready = try readReady(&target, &buffer);
        try std.testing.expectEqualDeep(destination, ready.to);
        try std.testing.expectEqualDeep(from, ready.from);
        try std.testing.expectEqualDeep(destination, (try target.receiveDatagram(io, &buffer, oneSecond())).to);
        var either: [2]bool = @splat(true);
        try std.testing.expectEqualDeep(destination, (try target.receiveReadyDatagram(fault.io(), &buffer, &either)).?.to);

        var buffers: [2][16]u8 = undefined;
        var slots: [2]SocketPair.ReceiveSlot = undefined;
        for (&slots, &buffers) |*slot, *bytes| slot.* = .{ .buffer = bytes };
        var scratch: SocketPair.ReceiveScratch = undefined;
        either = @splat(true);
        try std.testing.expectEqual(SocketPair.ReceiveOutcome{ .received = 1 }, target.receiveManyReady(io, &slots, &either, &scratch));
        try std.testing.expectEqualDeep(destination, (try slots[0].datagram()).to);
        try std.testing.expectEqualStrings("to", (try slots[0].datagram()).bytes);
    }
}

test "a socket bound to one address reports it for every datagram and resolves sources without a system call" {
    var target = try SocketPair.bind(io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } });
    defer target.close(io);
    try std.testing.expectEqual([2]?net.Socket.Handle{ null, null }, target.probes);
    var buffer: [16]u8 = undefined;
    for (target.localAddresses()) |local| {
        try target.sendTo(io, local.?, null, "to", payload_max);
        const datagram = try target.receiveDatagram(io, &buffer, oneSecond());
        try std.testing.expectEqualDeep(local.?, datagram.to);
        try std.testing.expectEqualDeep(local.?, datagram.from);
        var peer = local.?;
        switch (peer) {
            inline else => |*ip| ip.port = 9,
        }
        try std.testing.expectEqualDeep(local.?, try target.sourceFor(undefined, peer));
    }
    var single = try SocketPair.bind(io, .{ .ip4 = .loopback(0) });
    defer single.close(io);
    try std.testing.expectError(error.AddressFamilyUnsupported, single.sourceFor(undefined, loopback6(9)));
}

test "a pinned source leaves from that address on single, batched, mixed and segmented sends" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var target = try SocketPair.bind(io, .{ .ip4 = .loopback(0) });
    defer target.close(io);
    var sender = try SocketPair.bind(io, .{ .ip4 = .unspecified(0) });
    defer sender.close(io);
    const to = target.localAddress();
    const port = sender.localAddress().port();
    var buffer: [payload_max]u8 = undefined;

    try sender.sendTo(io, to, null, "default", payload_max);
    try std.testing.expectEqualDeep(loopback(1, port), (try readReady(&target, &buffer)).from);
    try sender.sendTo(io, to, loopback(2, 0), "pinned", payload_max);
    try std.testing.expectEqualDeep(loopback(2, port), (try readReady(&target, &buffer)).from);
    try sender.sendTo(io, to, Address.unspecified, "unpinned", payload_max);
    try std.testing.expectEqualDeep(loopback(1, port), (try readReady(&target, &buffer)).from);
    var fault: FaultIo = .{};
    try sender.sendTo(fault.io(), to, loopback(3, 0), "provider", payload_max);
    try std.testing.expectEqualDeep(loopback(3, port), (try readReady(&target, &buffer)).from);

    var scratch: SocketPair.BatchScratch = undefined;
    const segment = [_]u8{0x51} ** 64;
    const sources = [_]?Address{ loopback(2, 0), loopback(2, 0), loopback(2, 0), loopback(3, 0), null, loopback(2, 0) };
    var batch: [sources.len]SocketPair.Outgoing = undefined;
    for (&batch, sources) |*message, from| message.* = .{ .to = to, .bytes = &segment, .from = from };
    try std.testing.expectEqual(SocketPair.SendOutcome{ .sent = batch.len, .failure = null }, sender.sendMany(io, &batch, payload_max, &scratch));
    // The first three share a destination and a source, so they leave as one segmented message.
    try std.testing.expectEqual(@as(usize, 3), scratch.native.headers[0].hdr.iovlen);
    try std.testing.expectEqual(@as(usize, 1), scratch.native.headers[1].hdr.iovlen);
    for (sources) |from| {
        const datagram = try readReady(&target, &buffer);
        try std.testing.expectEqualSlices(u8, &segment, datagram.bytes);
        const expected = if (from) |pinned| loopback(pinned.ip4.octets[3], port) else loopback(1, port);
        try std.testing.expectEqualDeep(expected, datagram.from);
        try std.testing.expectEqualDeep(to, datagram.to);
    }
    try std.testing.expectEqual(SocketPair.SendOutcome{ .sent = batch.len, .failure = null }, sender.sendMany(fault.io(), &batch, payload_max, &scratch));
    for (sources) |from| {
        const expected = if (from) |pinned| loopback(pinned.ip4.octets[3], port) else loopback(1, port);
        try std.testing.expectEqualDeep(expected, (try readReady(&target, &buffer)).from);
    }
    try std.testing.expectError(error.NoDatagram, readReady(&target, &buffer));
}

test "a source that is not local or not of the destination's family fails as unreachable without sending" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var sockets = try SocketPair.bind(io, wildcards);
    defer sockets.close(io);
    var target = try SocketPair.bind(io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } });
    defer target.close(io);
    const foreign = [2]Address{
        .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 0 } },
        .{ .ip6 = .{ .octets = .{ 0x20, 0x01, 0x0d, 0xb8 } ++ .{0} ** 11 ++ .{1}, .port = 0 } },
    };
    var scratch: SocketPair.BatchScratch = undefined;
    for (target.localAddresses(), foreign, [2]SocketPair.SendError{ error.NetworkUnreachable, error.DestinationRefused }, 0..) |to, from, expected, family| {
        try std.testing.expect(SocketPair.destinationUnreachable(expected));
        try std.testing.expectError(expected, sockets.sendTo(io, to.?, from, "foreign", payload_max));
        const batch = [_]SocketPair.Outgoing{
            .{ .to = to.?, .bytes = "local", .from = to.? },
            .{ .to = to.?, .bytes = "first", .from = from },
            .{ .to = to.?, .bytes = "again", .from = from },
        };
        try std.testing.expectEqual(SocketPair.SendOutcome{ .sent = 1, .failure = expected }, sockets.sendMany(io, &batch, payload_max, &scratch));
        const other = foreign[1 - family];
        try std.testing.expectError(error.AddressFamilyUnsupported, sockets.sendTo(io, to.?, other, "family", payload_max));
        const mixed = [_]SocketPair.Outgoing{ .{ .to = to.?, .bytes = "local" }, .{ .to = to.?, .bytes = "family", .from = other } };
        try std.testing.expectEqual(SocketPair.SendOutcome{ .sent = 1, .failure = error.AddressFamilyUnsupported }, sockets.sendMany(io, &mixed, payload_max, &scratch));
        var buffer: [16]u8 = undefined;
        for (0..2) |_| try std.testing.expectEqualStrings("local", (try readReady(&target, &buffer)).bytes);
        try std.testing.expectError(error.NoDatagram, readReady(&target, &buffer));
    }
}

test "a pinned IPv6 source round trips with its destination" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var sockets = try SocketPair.bind(io, .{ .ip6 = .unspecified(0) });
    defer sockets.close(io);
    const local = loopback6(sockets.localAddress().port());
    var scratch: SocketPair.BatchScratch = undefined;
    const batch = [_]SocketPair.Outgoing{ .{ .to = local, .bytes = "one", .from = local }, .{ .to = local, .bytes = "two", .from = local } };
    try std.testing.expectEqual(SocketPair.SendOutcome{ .sent = 2, .failure = null }, sockets.sendMany(io, &batch, payload_max, &scratch));
    try std.testing.expectEqual(@as(usize, 2), scratch.native.headers[0].hdr.iovlen);
    try sockets.sendTo(io, local, local, "end", payload_max);
    var buffer: [16]u8 = undefined;
    for ([_][]const u8{ "one", "two", "end" }) |expected| {
        const datagram = try readReady(&sockets, &buffer);
        try std.testing.expectEqualStrings(expected, datagram.bytes);
        try std.testing.expectEqualDeep(local, datagram.to);
        try std.testing.expectEqualDeep(local, datagram.from);
    }
}

test "a wildcard socket rejects a datagram sent to a multicast group" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var target = try SocketPair.bind(io, .{ .ip4 = .unspecified(0) });
    defer target.close(io);
    const port = target.localAddress().port();
    const group: Address = .{ .ip4 = .{ .octets = .{ 224, 0, 0, 1 }, .port = port } };
    target.sendTo(io, group, loopback(1, 0), "group", payload_max) catch return error.SkipZigTest;
    try target.sendTo(io, loopback(1, port), null, "unicast", payload_max);
    var buffer: [16]u8 = undefined;
    try std.testing.expectError(error.InvalidDestinationAddress, readReady(&target, &buffer));
    try std.testing.expectEqualStrings("unicast", (try readReady(&target, &buffer)).bytes);
}

test "sourceFor asks the kernel afresh for each peer of a wildcard socket" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var sockets = try SocketPair.bind(io, wildcards);
    defer sockets.close(io);
    const ports = sockets.localAddresses();
    try std.testing.expect(sockets.probes[0] != null and sockets.probes[1] != null);
    try std.testing.expectEqualDeep(loopback6(ports[1].?.port()), try sockets.sourceFor(io, loopback6(9)));
    // A host without a route to the documentation network has only loopback sources to compare.
    const remote: Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 9 } };
    const routed = sockets.sourceFor(io, remote) catch |err| switch (err) {
        error.SourceUnavailable => null,
        else => return err,
    };
    for (0..2) |_| {
        try std.testing.expectEqualDeep(loopback(1, ports[0].?.port()), try sockets.sourceFor(io, loopback(2, 9)));
        if (routed) |source| {
            try std.testing.expect(source.ip4.octets[0] != 127 and source.ip4.port == ports[0].?.port());
            try std.testing.expectEqualDeep(source, try sockets.sourceFor(io, remote));
        }
    }
    var buffer: [16]u8 = undefined;
    try std.testing.expectError(error.NoDatagram, readReady(&sockets, &buffer));
}
