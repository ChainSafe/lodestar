const Now = @import("types.zig").Now;
const FaultIo = @import("fault_io");
const std = @import("std");
const constants = @import("constants.zig");
const Transport = @import("transport.zig").Transport;
const Engine = @import("quic/Engine.zig");
const multistream = @import("wire/multistream.zig");
const support = @import("transport_test_support.zig");
const types = @import("types.zig");
const udp_mod = @import("udp");
const KeyPair = @import("wire/keys.zig").KeyPair;
const quic_limits = @import("quic/limits.zig");
const transport_driver = @import("transport_driver.zig");

const net = std.Io.net;
const Node = support.Node;

const ping_protocol = "/ipfs/ping/1.0.0";
const step_options = transport_driver.Options{ .wait_max = .fromMilliseconds(10) };

fn writeSome(engine: *Engine, stream: Engine.StreamHandle, bytes: []const u8, fin: bool) !usize {
    return engine.write(stream, bytes, fin) catch |err| switch (err) {
        error.WouldBlock => 0,
        else => err,
    };
}

fn stepBoth(a: *Node, b: *Node, events_a: []Engine.Event, events_b: []Engine.Event) !struct { a: usize, b: usize } {
    const ra = try support.step(&a.transport, std.testing.io, events_a, step_options);
    const rb = try support.step(&b.transport, std.testing.io, events_b, step_options);
    try std.testing.expectEqual(@as(u32, 0), ra.send_failures);
    try std.testing.expectEqual(@as(u32, 0), rb.send_failures);
    return .{ .a = ra.events, .b = rb.events };
}

test "transport reports stream events for the connections with stream data" {
    var client: Node = .{};
    try client.init(7);
    defer client.deinit();
    var server: Node = .{};
    try server.init(8);
    defer server.deinit();

    const handle = try client.transport.dialPeer(std.testing.io, server.transport.sockets.localAddress(), server.transport.peerId(), try Now.read(std.testing.io));
    var client_events: [8]Engine.Event = undefined;
    var server_events: [8]Engine.Event = undefined;
    var server_handle: ?Engine.Handle = null;
    var client_connected = false;
    for (0..200) |_| {
        const counts = try stepBoth(&client, &server, &client_events, &server_events);
        for (client_events[0..counts.a]) |event| if (event == .connected) {
            client_connected = true;
        };
        for (server_events[0..counts.b]) |event| if (event == .connected) {
            server_handle = event.connected.conn;
        };
        if (client_connected and server_handle != null) break;
    }
    try std.testing.expect(client_connected and server_handle != null);

    const stream = try client.transport.engine.openStream(handle);
    var reported: usize = 0;
    var deferred: usize = 0;
    var rounds: usize = 0;
    while (rounds < 50 and (reported == 0 or deferred == 0)) : (rounds += 1) {
        _ = try writeSome(&client.transport.engine, stream, "ping", false);
        _ = try support.step(&client.transport, std.testing.io, &client_events, step_options);
        const narrow =
            try support.step(&server.transport, std.testing.io, server_events[0..0], step_options);
        try std.testing.expectEqual(@as(usize, 0), narrow.events);
        if (narrow.events_pending) deferred += 1;
        const wide =
            try support.step(&server.transport, std.testing.io, &server_events, step_options);
        for (server_events[0..wide.events]) |event| {
            const conn = switch (event) {
                .stream_opened => |opened| opened.conn,
                .stream_ready => |ready| ready.stream.conn,
                else => continue,
            };
            try std.testing.expectEqual(server_handle.?, conn);
            reported += 1;
        }
    }
    try std.testing.expect(reported > 0);
    try std.testing.expect(deferred > 0);

    var quiet = false;
    var idle: usize = 0;
    while (idle < 50 and !quiet) : (idle += 1) {
        _ = try support.step(&client.transport, std.testing.io, &client_events, step_options);
        const result =
            try support.step(&server.transport, std.testing.io, &server_events, step_options);
        if (result.datagrams_accepted > 0 or result.events > 0) continue;
        try std.testing.expect(!result.events_pending);
        quiet = true;
    }
    try std.testing.expect(quiet);
}

test "transport counts a hostile oversized datagram and keeps stepping" {
    var node: Node = .{};
    try node.init(3);
    defer node.deinit();

    const loopback = net.IpAddress{ .ip4 = .loopback(0) };
    var stranger = try loopback.bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer stranger.close(std.testing.io);

    const oversized = [_]u8{0x5a} ** 2_000;
    const destination = udp_mod.Address.toNetwork(node.transport.sockets.localAddress());
    try stranger.send(std.testing.io, &destination, &oversized);

    var events: [4]Engine.Event = undefined;
    var errors: u32 = 0;
    var rounds: usize = 0;
    while (rounds < 50 and errors == 0) : (rounds += 1) {
        const result = try support.step(&node.transport, std.testing.io, &events, step_options);
        try std.testing.expectEqual(@as(u32, 0), result.datagrams_accepted);
        try std.testing.expectEqual(@as(u32, 0), result.datagrams_received);
        try std.testing.expectEqual(@as(usize, 0), result.events);
        errors += result.receive_errors;
    }
    try std.testing.expectEqual(@as(u32, 1), errors);

    const after = try support.step(&node.transport, std.testing.io, &events, step_options);
    try std.testing.expectEqual(@as(u32, 0), after.receive_errors);
    try std.testing.expectEqual(@as(u32, 0), after.datagrams_accepted);
}

test "transport keeps batching past a counted receive error" {
    var node: Node = .{};
    try node.init(5);
    defer node.deinit();

    const loopback = net.IpAddress{ .ip4 = .loopback(0) };
    var stranger = try loopback.bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer stranger.close(std.testing.io);

    const oversized = [_]u8{0x5a} ** 2_000;
    const destination = udp_mod.Address.toNetwork(node.transport.sockets.localAddress());
    var sent: usize = 0;
    while (sent < 3) : (sent += 1) try stranger.send(std.testing.io, &destination, &oversized);

    var events: [4]Engine.Event = undefined;
    const result = try support.step(&node.transport, std.testing.io, &events, step_options);
    try std.testing.expect(result.receive_errors >= 2);
    try std.testing.expectEqual(@as(u32, 0), result.datagrams_received);
    try std.testing.expectEqual(@as(u32, 0), result.datagrams_accepted);
}

test "transport surfaces a send failure to an unreachable destination" {
    var node: Node = .{};
    try node.init(4);
    defer node.deinit();

    const unreachable_peer = types.Address{ .ip4 = .{
        .octets = @splat(255),
        .port = 4_001,
    } };
    const now = try Now.read(std.testing.io);
    _ = try node.transport.engine.dial(
        &unreachable_peer,
        node.transport.peerId(),
        now,
    );

    var events: [4]Engine.Event = undefined;
    const result = try support.step(&node.transport, std.testing.io, &events, step_options);
    try std.testing.expectEqual(@as(u32, 1), result.send_failures);
    try std.testing.expectEqual(@as(u32, 0), result.datagrams_sent);
    try std.testing.expectEqual(@as(usize, 0), result.events);
    try std.testing.expect(node.transport.schedule(1).runnable);
    const delivered = try support.step(&node.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expectEqual(@as(usize, 1), delivered.events);
    switch (events[0]) {
        .closed => |closed| {
            try std.testing.expectEqual(Engine.Direction.outbound, closed.direction);
            try std.testing.expect(closed.reason == .send_failed);
            try std.testing.expect(closed.peer_id == null);
            try std.testing.expectEqual(@as(u16, 0), closed.conn.index);
        },
        else => return error.TestUnexpectedResult,
    }
    try std.testing.expectEqual(@as(u16, 0), node.transport.engine.registry.outbound);

    try std.testing.expectError(
        error.DestinationUnreachable,
        node.transport.dialPeer(std.testing.io, unreachable_peer, node.transport.peerId(), try Now.read(std.testing.io)),
    );
}

test "transport treats temporary route failures as loss on authenticated connections" {
    var client: Node = .{};
    try client.init(1);
    defer client.deinit();
    var server: Node = .{};
    try server.init(2);
    defer server.deinit();
    const handle = try client.transport.dialPeer(std.testing.io, server.transport.localAddress(), server.transport.peerId(), try Now.read(std.testing.io));
    var client_events: [8]Engine.Event = undefined;
    var server_events: [8]Engine.Event = undefined;
    for (0..200) |_| {
        _ = try stepBoth(&client, &server, &client_events, &server_events);
        if (client.transport.engine.peerId(handle) != null) break;
    }
    try std.testing.expect(client.transport.engine.peerId(handle) != null);
    const stream = try client.transport.engine.openStream(handle);
    for ([_]net.Socket.SendError{ error.NetworkDown, error.NetworkUnreachable, error.HostUnreachable, error.AccessDenied }) |err| {
        try std.testing.expectEqual(@as(usize, 64), try client.transport.engine.write(stream, &(@as([64]u8, @splat(1))), false));
        var faults: FaultIo = .{ .send = .{}, .send_failure = err };
        var progress: Transport.Progress = .{ .now = try Now.read(std.testing.io) };
        const reason = @intFromEnum(udp_mod.Sockets.SendDrops.Reason.destination_unreachable);
        const before = client.transport.send_drops.datagrams[reason];
        try client.transport.flush(faults.io(), progress.now, &progress);
        try std.testing.expectEqual(@as(u32, 0), progress.send_failures);
        try std.testing.expect(client.transport.send_drops.datagrams[reason] > before);
        try std.testing.expect(client.transport.engine.peerId(handle) != null);
    }
    try std.testing.expectEqual(@as(usize, 4), try client.transport.engine.write(stream, "live", false));
    var recovered: Transport.Progress = .{ .now = try Now.read(std.testing.io) };
    try client.transport.flush(std.testing.io, recovered.now, &recovered);
    try std.testing.expect(recovered.datagrams_sent > 0);
    try std.testing.expectEqual(@as(u32, 0), recovered.send_failures);
}

test "transport completes a libp2p ping over loopback sockets" {
    var client: Node = .{};
    try client.init(1);
    defer client.deinit();
    var server: Node = .{};
    try server.init(2);
    defer server.deinit();

    const handle = try client.transport.dialPeer(std.testing.io, server.transport.sockets.localAddress(), server.transport.peerId(), try Now.read(std.testing.io));

    var client_events: [8]Engine.Event = undefined;
    var server_events: [8]Engine.Event = undefined;
    var server_handle: ?Engine.Handle = null;
    var client_connected = false;
    var rounds: usize = 0;
    while (rounds < 200 and (server_handle == null or !client_connected)) : (rounds += 1) {
        const counts = try stepBoth(&client, &server, &client_events, &server_events);
        for (client_events[0..counts.a]) |event| if (event == .connected) {
            try std.testing.expectEqual(handle, event.connected.conn);
            client_connected = true;
        };
        for (server_events[0..counts.b]) |event| if (event == .connected) {
            try std.testing.expect(event.connected.peer_id.eql(&client.transport.peerId()));
            server_handle = event.connected.conn;
        };
    }
    try std.testing.expect(client_connected);
    try std.testing.expect(server_handle != null);

    const stream = try client.transport.engine.openStream(handle);
    var dialer = try multistream.Dialer.init(ping_protocol);
    var hello: [2 * multistream.message_length_max]u8 = undefined;
    const hello_bytes = try dialer.initialWrite(&hello);
    try std.testing.expectEqual(hello_bytes.len, try writeSome(&client.transport.engine, stream, hello_bytes, false));

    var listener: multistream.Listener = .{};
    var inbound: ?Engine.StreamHandle = null;
    var negotiated = false;
    var accepted = false;
    const payload = [_]u8{0xab} ** 32;
    var echo: [32]u8 = undefined;
    var echoed: usize = 0;
    rounds = 0;
    while (rounds < 400 and echoed < 32) : (rounds += 1) {
        const counts = try stepBoth(&client, &server, &client_events, &server_events);
        for (server_events[0..counts.b]) |event| if (event == .stream_opened) {
            inbound = event.stream_opened;
        };
        if (inbound) |server_stream| {
            var buffer: [256]u8 = undefined;
            const read = try server.transport.engine.read(server_stream, &buffer);
            var cursor: usize = 0;
            if (read.len > 0 and !negotiated) {
                var reply: [multistream.listener_write_max]u8 = undefined;
                const outcome = try listener.feed(buffer[0..read.len], &.{.{ .id = ping_protocol, .index = 0 }}, &reply);
                if (outcome.write.len > 0) _ = try writeSome(&server.transport.engine, server_stream, outcome.write, false);
                if (outcome.status == .selected) negotiated = true;
                cursor = outcome.consumed;
            }
            if (negotiated and cursor < read.len) _ = try writeSome(&server.transport.engine, server_stream, buffer[cursor..read.len], false);
        }
        var client_buffer: [256]u8 = undefined;
        const client_read = try client.transport.engine.read(stream, &client_buffer);
        if (client_read.len > 0 and !accepted) {
            const outcome = try dialer.feed(client_buffer[0..client_read.len]);
            if (outcome.status == .accepted) {
                accepted = true;
                try std.testing.expectEqual(@as(usize, 32), try writeSome(&client.transport.engine, stream, &payload, false));
            }
        } else if (client_read.len > 0) {
            @memcpy(echo[echoed..][0..client_read.len], client_buffer[0..client_read.len]);
            echoed += client_read.len;
        }
    }
    try std.testing.expect(accepted);
    try std.testing.expectEqualSlices(u8, &payload, &echo);

    _ = client.transport.engine.close(handle, 0);
    var closed = false;
    rounds = 0;
    while (rounds < 100 and !closed) : (rounds += 1) {
        const counts = try stepBoth(&client, &server, &client_events, &server_events);
        for (server_events[0..counts.b]) |event| if (event == .closed) {
            try std.testing.expectEqual(server_handle.?, event.closed.conn);
            closed = true;
        };
    }
    try std.testing.expect(closed);
}

test "transport rotates dirty connections under one aggregate send allowance" {
    var node: Node = .{};
    try node.init(13);
    defer node.deinit();
    node.transport.work_limits.send_per_turn_max = 1;
    node.transport.work_limits.burst_per_connection = 1;
    const loopback = net.IpAddress{ .ip4 = .loopback(0) };
    var receive_buffer: [constants.datagram_size_max]u8 = undefined;
    var sink = try udp_mod.Sockets.bind(std.testing.io, .single(loopback));
    defer sink.close(std.testing.io);
    const destination = sink.localAddress();
    const now = try Now.read(std.testing.io);
    for (0..3) |_| {
        _ = try node.transport.engine.dial(&destination, node.transport.peerId(), now);
    }
    var events: [8]Engine.Event = undefined;
    var served: [3]u16 = undefined;
    for (&served) |*index| {
        index.* = node.transport.engine.nextDirty().?;
        const result = try support.step(&node.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
        try std.testing.expectEqual(@as(u32, 1), result.datagrams_sent);
        try std.testing.expect(result.backlog);
        _ = try sink.receiveDatagram(std.testing.io, &receive_buffer, .{ .duration = .{ .raw = .fromMilliseconds(10), .clock = .awake } });
    }
    try std.testing.expect(served[0] != served[1] and served[1] != served[2] and served[0] != served[2]);
    const drained = try support.step(&node.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expectEqual(@as(u32, 0), drained.datagrams_sent);
    try std.testing.expect(!drained.backlog);
}

fn allocateTransport(allocator: std.mem.Allocator) !void {
    const keys = @import("wire/keys.zig");
    const host = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{14}));
    var transport: Transport = .{};
    try transport.init(allocator, std.testing.io, .{
        .host = &host,
        .bind = .{ .ip4 = .loopback(0) },
        .limits = .{ .connections_max = 4, .handshaking_max = 4 },
    });
    defer transport.deinit(std.testing.io);
}

test "transport startup allocation failure releases transferred engine and TLS ownership" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocateTransport, .{});
}

test "transport requires startup seed entropy but no entropy for later dial and receive" {
    var faults: FaultIo = .{ .entropy = .{ .at = 2 } };
    const io = faults.io();
    const key = try KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{41}));
    var refused: Transport = .{};
    try std.testing.expectError(error.EntropyUnavailable, refused.init(std.testing.allocator, io, .{
        .host = &key,
        .bind = .{ .ip4 = .loopback(0) },
    }));
    try std.testing.expectEqual(@as(usize, 2), faults.entropy_calls);

    var node: Node = .{};
    try node.init(41);
    defer node.deinit();
    var remote: Node = .{};
    try remote.init(42);
    defer remote.deinit();
    _ = try node.transport.dialPeer(io, remote.transport.localAddress(), remote.transport.peerId(), try Now.read(io));
    _ = try remote.transport.dialPeer(io, node.transport.localAddress(), node.transport.peerId(), try Now.read(io));
    var events: [4]Engine.Event = undefined;
    const received = try support.step(&node.transport, io, &events, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expect(received.datagrams_received > 0);
    try std.testing.expectEqual(@as(u32, 0), received.datagrams_accepted);
    var accepted: u32 = 0;
    for (0..8) |_| {
        _ = try support.step(&remote.transport, io, &events, .{ .wait_max = .fromMilliseconds(10) });
        accepted += (try support.step(&node.transport, io, &events, .{ .wait_max = .fromMilliseconds(10) })).datagrams_accepted;
        if (node.transport.engine.registry.active_len == 2) break;
    }
    try std.testing.expect(accepted > 0);
    try std.testing.expectEqual(@as(u16, 2), node.transport.engine.registry.active_len);
    try std.testing.expectEqual(@as(usize, 2), faults.entropy_calls);
}

test "transport isolates a failing destination in a mixed-owner batch" {
    var node: Node = .{};
    try node.init(16);
    defer node.deinit();
    var receive_buffer: [constants.datagram_size_max]u8 = undefined;
    var sink = try udp_mod.Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer sink.close(std.testing.io);
    const healthy_address = sink.localAddress();
    const failing_address = types.Address{ .ip4 = .{
        .octets = @splat(255),
        .port = 4001,
    } };
    const now = try Now.read(std.testing.io);
    const failing = try node.transport.engine.dial(
        &failing_address,
        node.transport.peerId(),
        now,
    );
    const healthy = try node.transport.engine.dial(
        &healthy_address,
        node.transport.peerId(),
        now,
    );
    var events: [4]Engine.Event = undefined;
    const result = try support.step(&node.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expectEqual(@as(?Engine.Handle, healthy), node.transport.engine.sendOwner(healthy.index));
    try std.testing.expectEqual(@as(u32, 1), result.send_failures);
    try std.testing.expectEqual(@as(u32, 1), result.datagrams_sent);
    try std.testing.expectEqual(@as(u32, 2), result.send_calls);
    try std.testing.expectEqual(@as(u16, 1), node.transport.engine.registry.outbound);
    try std.testing.expectEqual(@as(usize, 0), result.events);
    try std.testing.expect(node.transport.schedule(1).runnable);
    const delivered = try support.step(&node.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expectEqual(@as(usize, 1), delivered.events);
    try std.testing.expect(events[0] == .closed);
    try std.testing.expectEqual(failing, events[0].closed.conn);
    try std.testing.expect(events[0].closed.reason == .send_failed);
    {
        const received = try sink.receiveDatagram(std.testing.io, &receive_buffer, .{ .duration = .{ .raw = .fromMilliseconds(10), .clock = .awake } });
        try std.testing.expect(received.bytes.len >= quic_limits.client_initial_min);
    }
    try std.testing.expectError(error.Timeout, sink.receiveDatagram(std.testing.io, &receive_buffer, .{ .duration = .{ .raw = .zero, .clock = .awake } }));
}

test "transport fails only the connection whose destination the host refuses and keeps serving its batch" {
    const limits: Engine.Limits = .{ .connections_max = 3, .handshaking_max = 3, .dialing_max = 3, .outbound_max = 3 };
    const hub_key = try KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{111}));
    var hub: Transport = .{};
    try hub.init(std.testing.allocator, std.testing.io, .{ .host = &hub_key, .bind = .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } }, .limits = limits });
    defer hub.deinit(std.testing.io);
    try support.singlePacketInitial(&hub);
    var peers: [2]Node = .{ .{}, .{} };
    try peers[0].init(112);
    defer peers[0].deinit();
    try peers[1].init(113);
    defer peers[1].deinit();
    const Refused = struct {
        fn serve(node: *Transport, remotes: *[2]Node) !void {
            var faults: FaultIo = .{
                .send = .{ .socket = node.sockets.values[1].?.handle },
                .send_failure = error.AccessDenied,
            };
            const io = faults.io();
            const turn: transport_driver.Options = .{ .wait_max = .fromMilliseconds(0) };
            const refused_address: types.Address = .{ .ip6 = .{ .octets = .{0} ** 15 ++ .{1}, .port = 9 } };
            const expected = remotes[0].transport.peerId();
            try std.testing.expectError(error.DestinationUnreachable, node.dialPeer(io, refused_address, expected, try Now.read(io)));
            try std.testing.expectEqual(@as(u16, 0), node.engine.registry.active_len);
            try std.testing.expectEqual(@as(u16, 0), node.engine.registry.outbound);
            const now = try Now.read(io);
            const first = try node.engine.dial(&remotes[0].transport.localAddress(), expected, now);
            const refused = try node.engine.dial(&refused_address, expected, now);
            const second = try node.engine.dial(&remotes[1].transport.localAddress(), remotes[1].transport.peerId(), now);
            var events: [8]Engine.Event = undefined;
            // One Initial each: the IPv4 prefix goes out, the refused one ends only its connection
            // and the rest of the batch follows.
            const flushed = try support.step(node, io, &events, turn);
            try std.testing.expectEqual(@as(u32, 2), flushed.datagrams_sent);
            try std.testing.expectEqual(@as(u32, 2), flushed.send_calls);
            try std.testing.expectEqual(@as(u32, 1), flushed.send_failures);
            try std.testing.expectEqual(@as(usize, 0), flushed.events);
            const delivered = try support.step(node, io, &events, turn);
            try std.testing.expectEqual(@as(usize, 1), delivered.events);
            try std.testing.expectEqual(refused, events[0].closed.conn);
            try std.testing.expect(events[0].closed.reason == .send_failed);
            try std.testing.expectEqual(@as(u16, 2), node.engine.registry.outbound);
            // The next turn releases the slot; a new generation there is refused on its own.
            _ = try support.step(node, io, &events, turn);
            const again = try node.engine.dial(&refused_address, expected, now);
            try std.testing.expectEqual(refused.index, again.index);
            try std.testing.expect(again.generation != refused.generation);
            try std.testing.expect(!node.engine.close(refused, 0));
            const retried = try support.step(node, io, &events, turn);
            try std.testing.expectEqual(@as(u32, 1), retried.send_failures);
            try std.testing.expectEqual(@as(usize, 0), retried.events);
            const delivered_retry = try support.step(node, io, &events, turn);
            try std.testing.expectEqual(@as(usize, 1), delivered_retry.events);
            try std.testing.expectEqual(again, events[0].closed.conn);
            var connected: [2]bool = .{ false, false };
            var remote_events: [8]Engine.Event = undefined;
            for (0..200) |_| {
                for (remotes) |*remote| _ = try support.step(&remote.transport, io, &remote_events, turn);
                const progress = try support.step(node, io, &events, turn);
                for (events[0..progress.events]) |event| if (event == .connected) {
                    for ([_]Engine.Handle{ first, second }, &connected) |handle, *done| {
                        if (std.meta.eql(event.connected.conn, handle)) done.* = true;
                    }
                };
                if (connected[0] and connected[1]) break;
            }
            try std.testing.expectEqual([2]bool{ true, true }, connected);
        }
    };
    try Refused.serve(&hub, &peers);
}

test "transport bounds each turn's receive drain without active connections" {
    var node: Node = .{};
    try node.init(17);
    defer node.deinit();
    node.transport.work_limits.receive_per_turn_max = 2;
    var source = try udp_mod.Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer source.close(std.testing.io);
    const destination = node.transport.localAddress();
    for (0..3) |_| try source.sendTo(std.testing.io, destination, &.{0}, constants.datagram_size_max);
    var events: [4]Engine.Event = undefined;
    const result = try support.step(&node.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expectEqual(@as(u32, 2), result.datagrams_received);
    try std.testing.expectEqual(@as(u32, 2), result.datagrams_dropped);
    try std.testing.expectEqual(@as(usize, 0), node.transport.engine.registry.activeIndices().len);
    try std.testing.expect(!result.backlog);
    try std.testing.expect(node.transport.nextDeadlineNs() == null);
    const drained = try support.step(&node.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expectEqual(@as(u32, 1), drained.datagrams_received);
    try std.testing.expectEqual(@as(u32, 1), drained.datagrams_dropped);
}

test "transport drains dirty connections across small send budgets" {
    var node: Node = .{};
    try node.init(18);
    defer node.deinit();
    node.transport.work_limits.send_per_turn_max = 2;
    node.transport.work_limits.burst_per_connection = 1;
    var sink = try udp_mod.Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer sink.close(std.testing.io);
    const destination = sink.localAddress();
    const now = try Now.read(std.testing.io);
    for (0..3) |_| {
        _ = try node.transport.engine.dial(
            &destination,
            node.transport.peerId(),
            now,
        );
    }
    var events: [4]Engine.Event = undefined;
    var sent: u32 = 0;
    var quiescent = false;
    for (0..16) |_| {
        const result = try support.step(&node.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
        try std.testing.expect(result.datagrams_sent <= 2);
        sent += result.datagrams_sent;
        if (!result.backlog) {
            const deadline = node.transport.nextDeadlineNs().?;
            try std.testing.expect(deadline > result.now.nanos());
            quiescent = true;
            break;
        }
    }
    try std.testing.expect(sent >= 3);
    try std.testing.expect(quiescent);
}

fn quietConnectedNodes(client: *Node, server: *Node) !void {
    var events: [8]Engine.Event = undefined;
    for (0..128) |_| {
        const a = try support.step(&client.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(1) });
        const b = try support.step(&server.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(1) });
        const a_due = client.transport.nextDeadlineNs();
        const b_due = server.transport.nextDeadlineNs();
        if (!a.backlog and !b.backlog and a.datagrams_sent == 0 and b.datagrams_sent == 0 and
            (a_due == null or a_due.? > a.now.nanos()) and (b_due == null or b_due.? > b.now.nanos())) return;
    }
    return error.TestUnexpectedResult;
}

test "transport restarts a completed quiet scan after host writes and reads" {
    var client: Node = .{};
    try client.init(19);
    defer client.deinit();
    var server: Node = .{};
    try server.init(20);
    defer server.deinit();
    const handle = try client.transport.dialPeer(std.testing.io, server.transport.localAddress(), server.transport.peerId(), try Now.read(std.testing.io));
    var client_events: [8]Engine.Event = undefined;
    var server_events: [8]Engine.Event = undefined;
    var connected = false;
    for (0..100) |_| {
        const counts = try stepBoth(&client, &server, &client_events, &server_events);
        for (client_events[0..counts.a]) |event| {
            if (event == .connected) connected = true;
        }
        if (connected) break;
    }
    try std.testing.expect(connected);
    const stream = try client.transport.engine.openStream(handle);
    try quietConnectedNodes(&client, &server);
    try std.testing.expect(!client.transport.engine.backlog());
    try std.testing.expectEqual(@as(usize, 6), try client.transport.engine.write(stream, "credit", false));
    try std.testing.expect(client.transport.engine.backlog());
    var inbound: ?Engine.StreamHandle = null;
    for (0..100) |_| {
        const counts = try stepBoth(&client, &server, &client_events, &server_events);
        for (server_events[0..counts.b]) |event| {
            if (event == .stream_opened) inbound = event.stream_opened;
        }
        if (inbound != null) break;
    }
    try std.testing.expect(inbound != null);
    try quietConnectedNodes(&client, &server);
    var bytes: [6]u8 = undefined;
    try std.testing.expect(!server.transport.engine.backlog());
    try std.testing.expectEqual(@as(usize, 6), (try server.transport.engine.read(inbound.?, &bytes)).len);
    try std.testing.expectEqualStrings("credit", &bytes);
    try std.testing.expect(server.transport.engine.backlog());
    try quietConnectedNodes(&client, &server);
}

test "transport keys quiche's timer from a clock read after the flush so it never pops early" {
    const io = std.testing.io;
    var client: Node = .{};
    try client.init(71);
    defer client.deinit();
    var server: Node = .{};
    try server.init(72);
    defer server.deinit();
    const handle = try client.transport.dialPeer(io, server.transport.localAddress(), server.transport.peerId(), try Now.read(io));
    var client_events: [8]Engine.Event = undefined;
    var server_events: [8]Engine.Event = undefined;
    var connected = false;
    for (0..100) |_| {
        const counts = try stepBoth(&client, &server, &client_events, &server_events);
        for (client_events[0..counts.a]) |event| {
            if (event == .connected) connected = true;
        }
        if (connected) break;
    }
    try std.testing.expect(connected);
    try quietConnectedNodes(&client, &server);
    const transport = &client.transport;
    // A slow turn: the host writes, then the turn runs 20 ms before its flush. The server never
    // answers, so the connection's earliest timer is quiche's loss probe.
    const stream = try transport.engine.openStream(handle);
    const tick = try Now.read(io);
    try std.testing.expectEqual(@as(usize, 4), try transport.engine.write(stream, "slow", false));
    try std.Io.sleep(io, .fromMilliseconds(20), .awake);
    var result: Transport.Progress = .{ .now = tick };
    try transport.flush(io, tick, &result);
    try std.testing.expect(result.datagrams_sent > 0);
    // Each turn waits for the timer key as the owner loop does, and each popped key finds
    // quiche's timer expired.
    const pops = transport.engine.visits.timer;
    const fired = transport.engine.visits.timeouts;
    for (0..2) |_| {
        const now = try Now.read(io);
        const deadline_ms = (transport.nextDeadlineNs().? + std.time.ns_per_ms - 1) / std.time.ns_per_ms;
        try std.testing.expect(deadline_ms > now.millis());
        try std.Io.sleep(io, .fromMilliseconds(@intCast(deadline_ms - now.millis())), .awake);
        const turn = try Now.read(io);
        transport.engine.advance(turn);
        var flushed: Transport.Progress = .{ .now = turn };
        try transport.flush(io, turn, &flushed);
    }
    try std.testing.expectEqual(pops + 2, transport.engine.visits.timer);
    try std.testing.expectEqual(fired + 2, transport.engine.visits.timeouts);
}

test "transport receive cancellation retains progress and events while deferring sends" {
    var node: Node = .{};
    try node.init(36);
    defer node.deinit();
    var sink = try udp_mod.Sockets.bind(std.testing.io, .{ .ip4 = .loopback(0) });
    defer sink.close(std.testing.io);
    const destination = sink.localAddress();
    const now = try Now.read(std.testing.io);
    _ = try node.transport.engine.dial(&destination, node.transport.peerId(), now);
    const failed = try node.transport.engine.dial(&destination, node.transport.peerId(), now);
    try std.testing.expect(node.transport.engine.failSend(failed));
    try sink.primary().send(std.testing.io, &node.transport.sockets.primary().address, "invalid");
    var faults: FaultIo = .{ .receive = .{ .at = 2 } };
    const io = faults.io();
    var events: [4]Engine.Event = undefined;
    const result = transport_driver.step(&node.transport, io, &events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expect(result.cancelled);
    try std.testing.expectEqual(error.Canceled, result.failure.?);
    try std.testing.expectEqual(@as(u32, 1), result.progress.datagrams_received);
    try std.testing.expectEqual(@as(u32, 0), result.progress.datagrams_sent);
    try std.testing.expectEqual(@as(u32, 0), result.progress.send_calls);
    try std.testing.expectEqual(@as(usize, 1), result.progress.events);
    try std.testing.expectEqual(failed, events[0].closed.conn);
    try std.testing.expectEqual(@as(u8, 0), node.transport.batch_len);
    const next = try support.step(&node.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expectEqual(@as(usize, 0), next.events);
    try std.testing.expect(next.datagrams_sent > 0);
}

test "transport bursts one busy connection among many idle ones in one flush visit" {
    const keys = @import("wire/keys.zig");
    const connections = 64;
    const limits: Engine.Limits = .{
        .connections_max = connections,
        .handshaking_max = connections,
        .handshaking_per_source_max = connections,
        .handshaking_per_prefix_max = connections,
        .dialing_max = 16,
        .outbound_max = connections,
    };
    const hub_key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{61}));
    const spoke_key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{62}));
    var hub: Transport = .{};
    try hub.init(std.testing.allocator, std.testing.io, .{ .host = &hub_key, .bind = .{ .ip4 = .loopback(0) }, .limits = limits });
    defer hub.deinit(std.testing.io);
    var spoke: Transport = .{};
    try spoke.init(std.testing.allocator, std.testing.io, .{ .host = &spoke_key, .bind = .{ .ip4 = .loopback(0) }, .limits = limits });
    defer spoke.deinit(std.testing.io);
    var handles: [connections]Engine.Handle = undefined;
    var events: [256]Engine.Event = undefined;
    var dialed: usize = 0;
    var established: usize = 0;
    for (0..2_000) |_| {
        while (dialed < connections and spoke.engine.registry.dialing < limits.dialing_max) : (dialed += 1) {
            handles[dialed] = try spoke.dialPeer(std.testing.io, hub.localAddress(), hub.peerId(), try Now.read(std.testing.io));
        }
        const spoke_step = try support.step(&spoke, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(1) });
        for (events[0..spoke_step.events]) |event| established += @intFromBool(event == .connected);
        _ = try support.step(&hub, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(1) });
        if (established == connections) break;
    }
    try std.testing.expectEqual(@as(usize, connections), established);
    // Settle until neither side sends.
    for (0..200) |_| {
        const a = try support.step(&spoke, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(2) });
        const b = try support.step(&hub, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(2) });
        if (a.datagrams_sent == 0 and b.datagrams_sent == 0 and !a.backlog and !b.backlog) break;
    }
    try std.testing.expect(!spoke.engine.backlog());

    const busy = handles[connections / 2];
    const stream = try spoke.engine.openStream(busy);
    var payload: [64 * 1024]u8 = @splat(0x42);
    try std.testing.expect(try spoke.engine.write(stream, &payload, false) > 0);
    try std.testing.expectEqual(@as(usize, 1), spoke.engine.dirtyCount());
    const visits = spoke.engine.visits;
    var result = Transport.Progress{ .now = try Now.read(std.testing.io) };
    try spoke.flush(std.testing.io, result.now, &result);
    try std.testing.expectEqual(visits.flush + 1, spoke.engine.visits.flush);
    try std.testing.expectEqual(visits.timer, spoke.engine.visits.timer);
    // The initial congestion window allows ten datagrams; the burst allows sixteen.
    const expected = @min(spoke.work_limits.burst_per_connection, quic_limits.initial_congestion_window_packets);
    try std.testing.expect(result.datagrams_sent >= expected);
    try std.testing.expectEqual(@as(u32, 0), result.send_failures);
}

test "transport reads only the ready families up to the turn quota and resumes the backlog on the next poll" {
    const wait = @import("wait.zig");
    if (!wait.supported) return error.SkipZigTest;
    const key = try KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{41}));
    var hub: Transport = .{};
    try hub.init(std.testing.allocator, std.testing.io, .{ .host = &key, .bind = .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } } });
    defer hub.deinit(std.testing.io);
    const quota = hub.work_limits.receive_per_turn_max;
    try std.testing.expectEqual(constants.receive_batch_max, quota);
    const sockets = hub.sockets.values;
    const sources: wait.Sources = .{ .quic = hub.sockets.handles() };
    var stranger = try (net.IpAddress{ .ip4 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer stranger.close(std.testing.io);
    const oversized = [_]u8{0x5a} ** (constants.datagram_size_max + 1);
    try stranger.send(std.testing.io, &sockets[0].?.address, &oversized);
    for (0..quota + 7) |_| try stranger.send(std.testing.io, &sockets[0].?.address, &.{0});
    for (0..3) |_| try sockets[1].?.send(std.testing.io, &sockets[1].?.address, &.{0});

    var result: Transport.Progress = .{ .now = try Now.read(std.testing.io) };
    try hub.receive(std.testing.io, &result, .{ false, true });
    try std.testing.expectEqual(@as(u32, 3), result.datagrams_received);
    try std.testing.expectEqual(@as(u32, 3), result.datagrams_dropped);
    try std.testing.expectEqual(@as(u32, 0), result.receive_errors);
    // The quota counts the truncated datagram; the rest of the backlog keeps the socket readable.
    for ([_]u32{ quota - 1, 8 }, [_]u32{ 1, 0 }) |received, errors| {
        const readiness = wait.poll(std.testing.io, sources, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(0) } });
        try std.testing.expectEqual([2]bool{ true, false }, readiness.quic);
        result = .{ .now = try Now.read(std.testing.io) };
        try hub.receive(std.testing.io, &result, readiness.quic);
        try std.testing.expectEqual(received, result.datagrams_received);
        try std.testing.expectEqual(received, result.datagrams_dropped);
        try std.testing.expectEqual(errors, result.receive_errors);
    }
    try std.testing.expectEqual([2]bool{ false, false }, wait.poll(std.testing.io, sources, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(0) } }).quic);
    try std.testing.expectEqual(@as(u64, quota + 11), hub.counters.received_datagrams);
}

test "transport drops a pressure suffix once and preserves every connection and loss timer" {
    const Prefix = struct {
        var count: usize = 0;
        var calls: usize = 0;
        var dropped_bytes: usize = 0;
        fn send(_: ?*anyopaque, _: net.Socket.Handle, messages: []net.OutgoingMessage, _: net.SendFlags) struct { ?net.Socket.SendError, usize } {
            calls += 1;
            const sent = @min(count, messages.len);
            for (messages[sent..]) |message| dropped_bytes += message.data_len;
            return .{ if (sent < messages.len) error.SystemResources else null, sent };
        }
    };
    for ([_]usize{ 0, 1 }) |prefix| {
        var node: Node = .{};
        try node.init(122);
        defer node.deinit();
        const now = try Now.read(std.testing.io);
        var handles: [3]Engine.Handle = undefined;
        for (&handles) |*handle| handle.* = try node.transport.engine.dial(&node.transport.localAddress(), node.transport.peerId(), now);
        Prefix.count = prefix;
        Prefix.calls = 0;
        Prefix.dropped_bytes = 0;
        var vtable = std.testing.io.vtable.*;
        vtable.netSend = Prefix.send;
        const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
        var result: Transport.Progress = .{ .now = now };
        try node.transport.flush(io, now, &result);
        try std.testing.expectEqual(@as(usize, 1), Prefix.calls);
        try std.testing.expectEqual(@as(u32, @intCast(prefix)), result.datagrams_sent);
        try std.testing.expectEqual(@as(u32, 0), result.send_failures);
        try std.testing.expectEqual(@as(u8, 0), node.transport.batch_len);
        const reason = @intFromEnum(udp_mod.Sockets.SendDrops.Reason.system_resources);
        try std.testing.expectEqual(@as(u64, 3 - prefix), node.transport.send_drops.datagrams[reason]);
        try std.testing.expectEqual(@as(u64, Prefix.dropped_bytes), node.transport.send_drops.bytes[reason]);
        try std.testing.expect(Prefix.dropped_bytes > 0);
        for (handles) |handle| try std.testing.expectEqual(@as(?Engine.Handle, handle), node.transport.engine.sendOwner(handle.index));
        try std.testing.expect(node.transport.nextDeadlineNs().? > now.nanos());
        try std.testing.expect(!result.backlog);
        var idle: Transport.Progress = .{ .now = now };
        try node.transport.flush(io, now, &idle);
        try std.testing.expectEqual(@as(u32, 0), idle.send_calls);
        try std.testing.expectEqual(@as(usize, 1), Prefix.calls);
        try std.testing.expect(!idle.backlog);
    }
}

test "transport recovers a locally dropped first flight through QUIC loss recovery" {
    var client: Node = .{};
    try client.init(123);
    defer client.deinit();
    var server: Node = .{};
    try server.init(124);
    defer server.deinit();
    var faults: FaultIo = .{ .send = .{}, .send_failure = error.SystemResources };
    const handle = try client.transport.dialPeer(faults.io(), server.transport.localAddress(), server.transport.peerId(), try Now.read(faults.io()));
    try std.testing.expectEqual(@as(usize, 1), faults.send_calls);
    try std.testing.expectEqual(@as(u64, 0), client.transport.counters.sent_datagrams);
    const reason = @intFromEnum(udp_mod.Sockets.SendDrops.Reason.system_resources);
    try std.testing.expectEqual(@as(u64, 1), client.transport.send_drops.datagrams[reason]);
    const c = @import("quic/binding.zig").c;
    var stats: c.quiche_stats = undefined;
    c.quiche_conn_stats(client.transport.engine.registry.slots[handle.index].conn.?, &stats);
    try std.testing.expect(stats.sent > 0);
    try std.testing.expect(!client.transport.engine.backlog());
    const now = try Now.read(std.testing.io);
    const deadline_ms = (client.transport.nextDeadlineNs().? + std.time.ns_per_ms - 1) / std.time.ns_per_ms;
    try std.testing.expect(deadline_ms > now.millis() and deadline_ms - now.millis() < 3_000);
    try std.Io.sleep(std.testing.io, .fromMilliseconds(@intCast(deadline_ms - now.millis())), .awake);
    const after = try Now.read(std.testing.io);
    client.transport.engine.advance(after);
    var retransmitted: Transport.Progress = .{ .now = after };
    try client.transport.flush(std.testing.io, after, &retransmitted);
    try std.testing.expect(retransmitted.datagrams_sent > 0);
    try std.testing.expectEqual(@as(u32, 0), retransmitted.send_failures);
    var events_a: [8]Engine.Event = undefined;
    var events_b: [8]Engine.Event = undefined;
    var connected = false;
    for (0..200) |_| {
        const progress = try stepBoth(&client, &server, &events_a, &events_b);
        for (events_a[0..progress.a]) |event| if (event == .connected and std.meta.eql(event.connected.conn, handle)) {
            connected = true;
        };
        if (connected) break;
    }
    try std.testing.expect(connected);
    try std.testing.expectEqual(@as(u64, 1), client.transport.send_drops.datagrams[reason]);
}

test "transport pressure drops later families with exact cumulative accounting" {
    const key = try KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{127}));
    var node: Transport = .{};
    try node.init(std.testing.allocator, std.testing.io, .{ .host = &key, .bind = .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } } });
    defer node.deinit(std.testing.io);
    try support.singlePacketInitial(&node);
    const now = try Now.read(std.testing.io);
    const local = node.sockets.localAddresses();
    var owners: [3]Engine.Handle = undefined;
    for (&owners, [_]usize{ 0, 1, 0 }) |*owner, family| owner.* = try node.engine.dial(&local[family].?, node.peerId(), now);
    var faults: FaultIo = .{ .send = .{ .socket = node.sockets.values[1].?.handle }, .send_failure = error.SystemResources };
    var result: Transport.Progress = .{ .now = now };
    try node.flush(faults.io(), now, &result);
    try std.testing.expectEqual(@as(usize, 2), faults.send_calls);
    try std.testing.expectEqual(@as(u32, 1), result.send_calls);
    try std.testing.expectEqual(@as(u32, 1), result.datagrams_sent);
    try std.testing.expectEqual(@as(u32, 0), result.send_failures);
    try std.testing.expectEqual(@as(u64, 1), node.counters.sent_datagrams);
    try std.testing.expectEqual(node.batch.outgoing[0].bytes.len, node.counters.sent_bytes);
    const reason = @intFromEnum(udp_mod.Sockets.SendDrops.Reason.system_resources);
    try std.testing.expectEqual(@as(u64, 2), node.send_drops.datagrams[reason]);
    try std.testing.expectEqual(node.batch.outgoing[1].bytes.len + node.batch.outgoing[2].bytes.len, node.send_drops.bytes[reason]);
    for (owners) |owner| {
        try std.testing.expectEqual(@as(?Engine.Handle, owner), node.engine.sendOwner(owner.index));
        try std.testing.expect(node.engine.registry.timers.get(owner.index) != null);
    }
    var idle: Transport.Progress = .{ .now = now };
    try node.flush(faults.io(), now, &idle);
    try std.testing.expectEqual(@as(usize, 2), faults.send_calls);
    try std.testing.expectEqual(@as(u8, 0), node.batch_len);
}

test "transport cancellation stops final and capacity flushes without failing owners" {
    const Canceled = struct {
        var calls: usize = 0;
        var accepted_bytes: usize = 0;
        var prefix: usize = 0;
        fn send(_: ?*anyopaque, _: net.Socket.Handle, messages: []net.OutgoingMessage, _: net.SendFlags) struct { ?net.Socket.SendError, usize } {
            calls += 1;
            std.debug.assert(prefix < messages.len);
            for (messages[0..prefix]) |message| accepted_bytes += message.data_len;
            return .{ error.Canceled, prefix };
        }
    };
    for ([_]usize{ 3, 17 }) |count| {
        for ([_]usize{ 0, 1 }) |prefix| {
            const key = try KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{123}));
            const limits: Engine.Limits = .{ .connections_max = 20, .handshaking_max = 20, .dialing_max = 20, .outbound_max = 20 };
            var node: Transport = .{};
            try node.init(std.testing.allocator, std.testing.io, .{ .host = &key, .bind = .{ .ip4 = .loopback(0) }, .limits = limits });
            defer node.deinit(std.testing.io);
            const now = try Now.read(std.testing.io);
            var owners: [17]Engine.Handle = undefined;
            for (owners[0..count]) |*owner| owner.* = try node.engine.dial(&node.localAddress(), node.peerId(), now);
            var vtable = std.testing.io.vtable.*;
            vtable.netSend = Canceled.send;
            const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
            Canceled.calls = 0;
            Canceled.accepted_bytes = 0;
            Canceled.prefix = prefix;
            var result: Transport.Progress = .{ .now = now };
            try std.testing.expectError(error.Canceled, node.flush(io, now, &result));
            try std.testing.expectEqual(@as(usize, 1), Canceled.calls);
            try std.testing.expectEqual(prefix, result.datagrams_sent);
            try std.testing.expectEqual(Canceled.accepted_bytes, node.counters.sent_bytes);
            try std.testing.expectEqual(@as(u32, 0), result.send_failures);
            try std.testing.expectEqual(@as(u8, 0), node.batch_len);
            try std.testing.expectEqualDeep(udp_mod.Sockets.SendDrops{}, node.send_drops);
            for (owners[0..count]) |owner| {
                try std.testing.expectEqual(@as(?Engine.Handle, owner), node.engine.sendOwner(owner.index));
                try std.testing.expect(node.engine.registry.timers.get(owner.index) != null);
            }
            try std.testing.expectEqual(count > constants.send_batch_max, result.backlog);
        }
    }
}

test "transport canceled step retains accepted progress and canceled dial releases local state" {
    const Canceled = struct {
        var calls: usize = 0;
        fn send(_: ?*anyopaque, _: net.Socket.Handle, messages: []net.OutgoingMessage, _: net.SendFlags) struct { ?net.Socket.SendError, usize } {
            calls += 1;
            return .{ error.Canceled, messages.len - 1 };
        }
    };
    var node: Node = .{};
    try node.init(124);
    defer node.deinit();
    var vtable = std.testing.io.vtable.*;
    vtable.netSend = Canceled.send;
    const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
    Canceled.calls = 0;
    try std.testing.expectError(error.Canceled, node.transport.dialPeer(io, node.transport.localAddress(), node.transport.peerId(), try Now.read(io)));
    try std.testing.expectEqual(@as(u16, 0), node.transport.engine.registry.active_len);
    const now = try Now.read(std.testing.io);
    for (0..3) |_| _ = try node.transport.engine.dial(&node.transport.localAddress(), node.transport.peerId(), now);
    var events: [8]Engine.Event = undefined;
    const result = transport_driver.step(&node.transport, io, &events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expect(result.cancelled);
    try std.testing.expectEqual(error.Canceled, result.failure.?);
    try std.testing.expectEqual(@as(u32, 2), result.progress.datagrams_sent);
    try std.testing.expectEqual(@as(u32, 0), result.progress.send_failures);
    try std.testing.expectEqual(@as(usize, 0), result.progress.events);
    try std.testing.expectEqual(@as(usize, 2), Canceled.calls);
    try std.testing.expectEqual(@as(u16, 3), node.transport.engine.registry.active_len);
}

test "established transport survives canceled output and recovers its lost payload" {
    var client: Node = .{};
    try client.init(125);
    defer client.deinit();
    var server: Node = .{};
    try server.init(126);
    defer server.deinit();
    const handle = try client.transport.dialPeer(std.testing.io, server.transport.localAddress(), server.transport.peerId(), try Now.read(std.testing.io));
    var client_events: [8]Engine.Event = undefined;
    var server_events: [8]Engine.Event = undefined;
    var connected = false;
    for (0..200) |_| {
        const counts = try stepBoth(&client, &server, &client_events, &server_events);
        for (client_events[0..counts.a]) |event| if (event == .connected) {
            connected = true;
        };
        if (connected) break;
    }
    try std.testing.expect(connected);
    const stream = try client.transport.engine.openStream(handle);
    const payload = "cancel preserves this stream payload";
    try std.testing.expectEqual(payload.len, try client.transport.engine.write(stream, payload, false));
    var fault: FaultIo = .{ .send = .{}, .send_failure = error.Canceled };
    const stopped = transport_driver.step(&client.transport, fault.io(), &client_events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expectEqual(error.Canceled, stopped.failure.?);
    try std.testing.expectEqual(@as(usize, 1), fault.send_calls);
    try std.testing.expectEqual(@as(u32, 0), stopped.progress.send_failures);
    try std.testing.expectEqual(@as(?Engine.Handle, handle), client.transport.engine.sendOwner(handle.index));
    try std.testing.expectEqualDeep(udp_mod.Sockets.SendDrops{}, client.transport.send_drops);
    var incoming: ?Engine.StreamHandle = null;
    var recovered: [payload.len]u8 = undefined;
    var count: usize = 0;
    for (0..400) |_| {
        const counts = try stepBoth(&client, &server, &client_events, &server_events);
        for (server_events[0..counts.b]) |event| if (event == .stream_opened) {
            incoming = event.stream_opened;
        };
        if (incoming) |remote| count += (try server.transport.engine.read(remote, recovered[count..])).len;
        if (count == payload.len) break;
    }
    try std.testing.expectEqualStrings(payload, recovered[0..count]);
}

test "transport wait cancellation publishes existing events without flushing new output" {
    var node: Node = .{};
    try node.init(127);
    defer node.deinit();
    const now = try Now.read(std.testing.io);
    const failed = try node.transport.engine.dial(&node.transport.localAddress(), node.transport.peerId(), now);
    try std.testing.expect(node.transport.engine.failSend(failed));
    _ = try node.transport.engine.dial(&node.transport.localAddress(), node.transport.peerId(), now);
    var events: [4]Engine.Event = undefined;
    const result = node.transport.advance(std.testing.io, .{ .now = now, .cancelled = true }, &events);
    try std.testing.expect(result.cancelled);
    try std.testing.expectEqual(error.Canceled, result.failure.?);
    try std.testing.expectEqual(@as(usize, 1), result.progress.events);
    try std.testing.expectEqual(failed, events[0].closed.conn);
    try std.testing.expectEqual(@as(u32, 0), result.progress.datagrams_sent);
    try std.testing.expect(node.transport.schedule(1).runnable);
}

test "transport caps the final receive batch at the remaining budget including truncation" {
    var node: Node = .{};
    try node.init(43);
    defer node.deinit();
    const transport = &node.transport;
    transport.work_limits.receive_per_turn_max = udp_mod.Sockets.receive_batch_max + 1;
    const oversized = [_]u8{0} ** (constants.datagram_size_max + 1);
    const socket = transport.sockets.primary();
    for (0..20) |i| {
        const payload: []const u8 = if (i == udp_mod.Sockets.receive_batch_max) &oversized else &.{0};
        try socket.send(std.testing.io, &socket.address, payload);
    }
    const now = try Now.read(std.testing.io);
    var first: Transport.Progress = .{ .now = now };
    try transport.receive(std.testing.io, &first, .{ true, false });
    try std.testing.expectEqual(@as(u32, 16), first.datagrams_received);
    try std.testing.expectEqual(@as(u32, 1), first.receive_errors);
    try std.testing.expectEqual(@as(u64, 1), transport.counters.receive_budget_exhausted);
    var next: Transport.Progress = .{ .now = now };
    try transport.receive(std.testing.io, &next, .{ true, false });
    try std.testing.expectEqual(@as(u32, 3), next.datagrams_received);
    try std.testing.expectEqual(@as(u32, 0), next.receive_errors);
    try std.testing.expectEqual(@as(u64, 20), transport.counters.received_datagrams);
    try std.testing.expectEqual(@as(u64, 19), transport.counters.received_bytes);
    try std.testing.expectEqual(@as(u64, 1), transport.counters.receive_budget_exhausted);
}
