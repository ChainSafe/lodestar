const Now = @import("types.zig").Now;
const std = @import("std");
const support = @import("transport_test_support.zig");
const Engine = @import("quic/Engine.zig");
const keys = @import("wire/keys.zig");
const multiaddr = @import("wire/multiaddr.zig");
const Transport = @import("transport.zig").Transport;
const constants = @import("constants.zig");
const transport_driver = @import("transport_driver.zig");

const step_options = transport_driver.Options{ .wait_max = .fromMilliseconds(10) };
const payload_len = 64 * 1024;

fn initTransport(target: *Transport, seed: u8) !void {
    const key = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{seed}));
    try target.init(std.testing.allocator, std.testing.io, .{
        .host = &key,
        .bind = .{ .ip4 = .loopback(0) },
    });
}

fn writeSome(
    engine: *Engine,
    stream: Engine.StreamHandle,
    bytes: []const u8,
) !usize {
    return engine.write(stream, bytes, false) catch |err| switch (err) {
        error.WouldBlock => 0,
        else => err,
    };
}

test "transport moves a bulk payload over loopback sockets with batched sends" {
    var dialer: Transport = .{};
    try initTransport(&dialer, 21);
    defer dialer.deinit(std.testing.io);
    var listener: Transport = .{};
    try initTransport(&listener, 22);
    defer listener.deinit(std.testing.io);

    const target = listener.localMultiaddr();
    try std.testing.expect(target.peer.?.eql(&listener.peerId()));
    const handle = try dialer.dial(std.testing.io, &target, try Now.read(std.testing.io));

    var dialer_events: [8]Engine.Event = undefined;
    var listener_events: [8]Engine.Event = undefined;
    var connected = false;
    var rounds: usize = 0;
    while (rounds < 200 and !connected) : (rounds += 1) {
        const dialed = try support.step(&dialer, std.testing.io, &dialer_events, step_options);
        _ = try support.step(&listener, std.testing.io, &listener_events, step_options);
        for (dialer_events[0..dialed.events]) |event| {
            if (event == .connected) connected = true;
        }
    }
    try std.testing.expect(connected);

    var payload: [payload_len]u8 = undefined;
    for (&payload, 0..) |*byte, index| byte.* = @truncate(index *% 31 +% 7);
    const stream = try dialer.engine.openStream(handle);
    var sink: [payload_len]u8 = undefined;
    var written: usize = 0;
    var received: usize = 0;
    var inbound: ?Engine.StreamHandle = null;
    var datagrams_sent: u32 = 0;
    var send_calls: u32 = 0;
    rounds = 0;
    while (rounds < 2_000 and received < payload_len) : (rounds += 1) {
        if (written < payload_len) {
            written += try writeSome(&dialer.engine, stream, payload[written..]);
        }
        const sent = try support.step(&dialer, std.testing.io, &dialer_events, step_options);
        try std.testing.expectEqual(@as(u32, 0), sent.send_failures);
        datagrams_sent += sent.datagrams_sent;
        send_calls += sent.send_calls;
        const got = try support.step(&listener, std.testing.io, &listener_events, step_options);
        for (listener_events[0..got.events]) |event| {
            if (event == .stream_opened) inbound = event.stream_opened;
        }
        const open = inbound orelse continue;
        var reads: usize = 0;
        while (reads < 8 and received < payload_len) : (reads += 1) {
            const read = try listener.engine.read(open, sink[received..]);
            if (read.len == 0) break;
            received += read.len;
        }
    }
    try std.testing.expectEqual(@as(usize, payload_len), received);
    try std.testing.expectEqualSlices(u8, &payload, &sink);
    try std.testing.expect(send_calls > 0);
    try std.testing.expect(send_calls < datagrams_sent);
}

test "transport refuses to dial a multiaddr without a peer id" {
    var dialer: Transport = .{};
    try initTransport(&dialer, 23);
    defer dialer.deinit(std.testing.io);

    const target = multiaddr.Multiaddr{ .address = dialer.localAddress() };
    try std.testing.expectError(error.MissingPeerId, dialer.dial(std.testing.io, &target, try Now.read(std.testing.io)));
    try std.testing.expectEqual(@as(usize, 0), dialer.engine.registry.activeIndices().len);
}

test "dual-stack transport authenticates both families through one connection budget" {
    for ([_]bool{ false, true }) |inbound| {
        const hub_key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{101}));
        const key4 = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{102}));
        const key6 = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{103}));
        const limits: Engine.Limits = .{ .connections_max = 2, .handshaking_max = 2, .dialing_max = 2, .outbound_max = 2 };
        var hub: Transport = .{};
        try hub.init(std.testing.allocator, std.testing.io, .{ .host = &hub_key, .bind = .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } }, .limits = limits });
        defer hub.deinit(std.testing.io);
        var peer4: Transport = .{};
        try peer4.init(std.testing.allocator, std.testing.io, .{ .host = &key4, .bind = .{ .ip4 = .loopback(0) }, .limits = limits });
        defer peer4.deinit(std.testing.io);
        var peer6: Transport = .{};
        try peer6.init(std.testing.allocator, std.testing.io, .{ .host = &key6, .bind = .{ .ip6 = .loopback(0) }, .limits = limits });
        defer peer6.deinit(std.testing.io);
        const addresses = hub.sockets.localAddresses();
        if (inbound) {
            _ = try peer4.dialPeer(std.testing.io, addresses[0].?, hub.peerId(), try Now.read(std.testing.io));
            _ = try peer6.dialPeer(std.testing.io, addresses[1].?, hub.peerId(), try Now.read(std.testing.io));
        } else {
            _ = try hub.dialPeer(std.testing.io, peer4.localAddress(), peer4.peerId(), try Now.read(std.testing.io));
            _ = try hub.dialPeer(std.testing.io, peer6.localAddress(), peer6.peerId(), try Now.read(std.testing.io));
        }
        var connected: [2]bool = .{ false, false };
        var events: [8]Engine.Event = undefined;
        for (0..400) |_| {
            const result = try support.step(&hub, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(1) });
            for (events[0..result.events]) |event| if (event == .connected) {
                const peer = hub.engine.peerAddress(event.connected.conn).?;
                connected[if (peer == .ip4) @as(usize, 0) else 1] = true;
            };
            _ = try support.step(&peer4, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(1) });
            _ = try support.step(&peer6, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(1) });
            if (connected[0] and connected[1]) break;
        }
        try std.testing.expect(connected[0] and connected[1]);
        try std.testing.expectEqual(@as(usize, 2), hub.engine.registry.active_len);
        try std.testing.expectEqual(@as(usize, 2), hub.engine.registry.slots.len);
        try std.testing.expectError(error.DestinationUnreachable, peer4.dialPeer(std.testing.io, addresses[1].?, hub.peerId(), try Now.read(std.testing.io)));
        if (!inbound) try std.testing.expectError(error.DialLimit, hub.dialPeer(std.testing.io, peer4.localAddress(), peer4.peerId(), try Now.read(std.testing.io)));
    }
}

test "transport validates socket work limits before startup allocation" {
    const key = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{27}));
    const invalid = [_]Transport.WorkLimits{
        .{ .send_per_turn_max = 0 },
        .{ .send_per_turn_max = Transport.send_burst_max + 1 },
        .{ .receive_per_turn_max = 0 },
        .{ .receive_per_turn_max = Transport.receive_per_turn_max + 1 },
        .{ .burst_per_connection = 0 },
        .{ .send_per_turn_max = 8, .burst_per_connection = 9 },
    };
    for (invalid) |work_limits| {
        var target: Transport = .{};
        try std.testing.expectError(error.InvalidLimits, target.init(std.testing.failing_allocator, std.testing.io, .{
            .host = &key,
            .bind = .{ .ip4 = .loopback(0) },
            .work_limits = work_limits,
        }));
    }
    try (Transport.WorkLimits{ .send_per_turn_max = 1, .receive_per_turn_max = 1, .burst_per_connection = 1 }).validate();
    try (Transport.WorkLimits{ .burst_per_connection = Transport.send_burst_max, .receive_per_turn_max = Transport.receive_per_turn_max }).validate();
}

test "transport requests configured socket buffers and records the kernel's sizes" {
    const Buffers = @import("udp").Sockets.Buffers;
    const key = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{31}));
    const invalid = [_]Buffers{
        .{ .receive = Buffers.bytes_min - 1, .send = Buffers.bytes_min },
        .{ .receive = Buffers.bytes_min, .send = Buffers.bytes_max + 1 },
    };
    for (invalid) |socket_buffers| {
        var target: Transport = .{};
        try std.testing.expectError(error.InvalidLimits, target.init(std.testing.failing_allocator, std.testing.io, .{
            .host = &key,
            .bind = .{ .ip4 = .loopback(0) },
            .socket_buffers = socket_buffers,
        }));
    }
    var unsized: Transport = .{};
    try initTransport(&unsized, 32);
    defer unsized.deinit(std.testing.io);
    try std.testing.expectEqual([2]?Buffers.Reported{ null, null }, unsized.sockets.buffers);
    var sized: Transport = .{};
    try sized.init(std.testing.allocator, std.testing.io, .{
        .host = &key,
        .bind = .{ .ip4 = .loopback(0) },
        .socket_buffers = .{ .receive = Buffers.bytes_min, .send = Buffers.bytes_min },
    });
    defer sized.deinit(std.testing.io);
    const os = @import("builtin").os.tag;
    if (os != .linux and os != .macos) return;
    const reported = sized.sockets.buffers[0].?;
    try std.testing.expect(reported.receive.? >= Buffers.bytes_min and reported.send.? >= Buffers.bytes_min);
    try std.testing.expectEqual(null, sized.sockets.buffers[1]);
}

test "transport memory plan accounts for its packet batches" {
    var node: Transport = .{};
    try initTransport(&node, 28);
    defer node.deinit(std.testing.io);
    const plan = node.memoryPlan();
    try std.testing.expectEqual(node.engine.memoryPlan(), plan.engine);
    try std.testing.expectEqual(node.batch.buffers.len, plan.ready_batch_datagrams);
    try std.testing.expectEqual(@sizeOf(@TypeOf(node.batch)), plan.ready_batch_storage_bytes);
    try std.testing.expectEqual(@sizeOf(@TypeOf(node.receive_batch)), plan.receive_batch_storage_bytes);
}
