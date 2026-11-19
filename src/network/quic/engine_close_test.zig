const std = @import("std");
const constants = @import("../constants.zig");
const Engine = @import("Engine.zig");
const keys = @import("../wire/keys.zig");
const support = @import("test_support.zig");
const test_support = @import("../tls/test_support.zig");
const binding = @import("binding.zig");

const Event = Engine.Event;
const Pair = support.Pair;
const client_address = support.client_address;
const server_address = support.server_address;
const connectPair = support.connectPair;
const expectConnected = support.expectConnected;
const expectClosed = support.expectClosed;
const expectStreamOpened = support.expectStreamOpened;

test "engine stale handles are rejected" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);
    const stale = Engine.Handle{ .index = handles.client.index, .generation = handles.client.generation +% 1 };
    try std.testing.expectError(error.StaleHandle, pair.client.openStream(stale));
    try std.testing.expect(pair.client.peerId(stale) == null);
    const out_of_range = Engine.Handle{ .index = 9_999, .generation = 0 };
    try std.testing.expectError(error.StaleHandle, pair.client.openStream(out_of_range));

    const stream = try pair.client.openStream(handles.client);
    var buffer: [16]u8 = undefined;
    const wrong_slot = Engine.StreamHandle{
        .conn = stream.conn,
        .id = stream.id,
        .slot = stream.slot + 1,
    };
    try std.testing.expectError(error.UnknownStream, pair.client.read(wrong_slot, &buffer));
    try std.testing.expectError(error.UnknownStream, pair.client.write(wrong_slot, "x", false));
    try std.testing.expectError(error.UnknownStream, pair.client.streamCapacity(wrong_slot));

    const past_table = Engine.StreamHandle{ .conn = stream.conn, .id = stream.id, .slot = 255 };
    try std.testing.expectError(error.UnknownStream, pair.client.read(past_table, &buffer));
    try std.testing.expectError(error.UnknownStream, pair.client.write(past_table, "x", false));

    const other = try pair.client.openStream(handles.client);
    try std.testing.expect(other.slot != stream.slot);
    try std.testing.expect(other.id != stream.id);
    const aliased = Engine.StreamHandle{
        .conn = stream.conn,
        .id = stream.id,
        .slot = other.slot,
    };
    try std.testing.expectError(error.UnknownStream, pair.client.read(aliased, &buffer));
    try std.testing.expectError(error.UnknownStream, pair.client.write(aliased, "x", false));
    try std.testing.expectError(error.UnknownStream, pair.client.streamCapacity(aliased));

    const stale_stream = Engine.StreamHandle{
        .conn = stale,
        .id = stream.id,
        .slot = stream.slot,
    };
    try std.testing.expectError(error.StaleHandle, pair.client.read(stale_stream, &buffer));
    try std.testing.expectEqual(@as(usize, 1), try pair.client.write(stream, "x", false));
}

test "engine reports a host close on both sides" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    _ = pair.client.close(handles.client, 42);
    try pair.pump();

    var storage: [8]Event = undefined;
    const client_events = pair.events(&pair.client, &storage);
    const client_reason =
        try expectClosed(client_events[0], handles.client, .outbound, &pair.server_ctx);
    try std.testing.expectEqual(Engine.CloseReason.host, client_reason);
    const server_events = pair.events(&pair.server, &storage);
    const server_reason =
        try expectClosed(server_events[0], handles.server, .inbound, &pair.client_ctx);
    try std.testing.expect(server_reason.peer_closed.app);
    try std.testing.expectEqual(@as(u64, 42), server_reason.peer_closed.code);
    try std.testing.expectError(error.StaleHandle, pair.client.openStream(handles.client));
    try std.testing.expectEqual(@as(u16, 0), pair.client.registry.handshaking);
}

test "engine closes on peer id mismatch" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();

    const wrong = pair.client_ctx.local_peer_id;
    const handle = try pair.client.dial(
        &server_address,
        wrong,
        pair.now,
    );
    try pair.pump();

    var storage: [8]Event = undefined;
    const client_events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), client_events.len);
    try std.testing.expectEqual(
        Engine.CloseReason.peer_id_mismatch,
        try expectClosed(client_events[0], handle, .outbound, &pair.server_ctx),
    );

    var server_storage: [8]Event = undefined;
    const server_events = pair.events(&pair.server, &server_storage);
    try std.testing.expectEqual(@as(usize, 2), server_events.len);
    const server_handle = try expectConnected(server_events[0], .inbound, &pair.client_ctx);
    const reason = try expectClosed(server_events[1], server_handle, .inbound, &pair.client_ctx);
    try std.testing.expectEqual(@as(u64, 1), reason.peer_closed.code);
    try std.testing.expectEqual(@as(u16, 0), pair.client.registry.handshaking);
}

/// Dials, then delivers the server's flight so the client is established before it has sent its
/// own final flight. The first Initial draws a Retry.
fn establishClient(pair: *Pair) !Engine.Handle {
    const handle = try pair.dial();
    try pair.flush(&pair.client);
    try pair.flush(&pair.client);
    pair.settle(&pair.server);
    try pair.flush(&pair.server);
    pair.settle(&pair.client);
    var storage: [8]Event = undefined;
    const connected = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), connected.len);
    try std.testing.expectEqual(handle, try expectConnected(connected[0], .outbound, &pair.server_ctx));
    return handle;
}

test "engine delivers a close requested before the establishing flight leaves" {
    // Turns whose flush never reaches the connection, as when the send quota runs out first.
    for ([_]usize{ 0, 3 }) |unserviced| {
        var pair: Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        const start = pair.now;
        const handle = try establishClient(&pair);
        try std.testing.expect(pair.client.close(handle, 7));
        for (0..unserviced) |_| {
            pair.settle(&pair.client);
            pair.client.finishFlush(pair.now);
        }

        // One datagram carries the whole final flight, within quiche's two-datagram minimum window.
        var datagrams: usize = 0;
        var out: [constants.datagram_size_max]u8 = undefined;
        for (0..4) |_| {
            const datagram = pair.sendOne(&pair.client, handle.index, &out) orelse break;
            var response: [constants.datagram_size_max]u8 = undefined;
            try std.testing.expect(pair.server.receive(datagram, &client_address, pair.now, &response) == .accepted);
            datagrams += 1;
        }
        pair.client.sent(handle.index, pair.now, true);
        try std.testing.expectEqual(@as(usize, 1), datagrams);
        pair.settle(&pair.server);
        var storage: [8]Event = undefined;
        const connected = pair.events(&pair.server, &storage);
        try std.testing.expectEqual(@as(usize, 1), connected.len);
        const server_handle = try expectConnected(connected[0], .inbound, &pair.client_ctx);
        try pair.pump();

        const client_events = pair.events(&pair.client, &storage);
        try std.testing.expectEqual(@as(usize, 1), client_events.len);
        try std.testing.expectEqual(
            Engine.CloseReason.host,
            try expectClosed(client_events[0], handle, .outbound, &pair.server_ctx),
        );
        const server_events = pair.events(&pair.server, &storage);
        try std.testing.expectEqual(@as(usize, 1), server_events.len);
        const reason = try expectClosed(server_events[0], server_handle, .inbound, &pair.client_ctx);
        try std.testing.expect(reason.peer_closed.app);
        try std.testing.expectEqual(@as(u64, 7), reason.peer_closed.code);
        try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.client, &storage).len);
        try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.server, &storage).len);
        try std.testing.expectEqual(@as(usize, 0), pair.client.registry.activeIndices().len);
        try std.testing.expectEqual(@as(usize, 0), pair.server.registry.activeIndices().len);
        // The virtual clock never moved, so no timer ended either side.
        try std.testing.expectEqual(start, pair.now);
    }
}

test "engine sends an inbound close requested in the turn the connection establishes" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const start = pair.now;
    const handle = try establishClient(&pair);
    try pair.flush(&pair.client);
    pair.settle(&pair.server);
    var storage: [8]Event = undefined;
    const connected = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), connected.len);
    const server_handle = try expectConnected(connected[0], .inbound, &pair.client_ctx);
    try std.testing.expect(pair.server.close(server_handle, 9));

    // The server's first flush carries the close without waiting on its own flight.
    try pair.flush(&pair.server);
    pair.settle(&pair.client);
    const client_events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), client_events.len);
    const reason = try expectClosed(client_events[0], handle, .outbound, &pair.server_ctx);
    try std.testing.expect(reason.peer_closed.app);
    try std.testing.expectEqual(@as(u64, 9), reason.peer_closed.code);
    try pair.pump();
    const server_events = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), server_events.len);
    try std.testing.expectEqual(
        Engine.CloseReason.host,
        try expectClosed(server_events[0], server_handle, .inbound, &pair.client_ctx),
    );
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.client, &storage).len);
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.server, &storage).len);
    try std.testing.expectEqual(@as(usize, 0), pair.client.registry.activeIndices().len);
    try std.testing.expectEqual(@as(usize, 0), pair.server.registry.activeIndices().len);
    try std.testing.expectEqual(start, pair.now);
}

test "engine closes a dial the server never answers no later than the handshake timeout" {
    var pair: Pair = .{};
    try pair.init(.{ .handshake_timeout_ms = 100 }, .{});
    defer pair.deinit();
    pair.drop_to_server = true;

    const handle = try pair.dial();
    try pair.pump();
    pair.advance(100);
    try pair.pump();

    var storage: [8]Event = undefined;
    const client_events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), client_events.len);
    try std.testing.expectEqual(
        Engine.CloseReason.dial_unanswered,
        try expectClosed(client_events[0], handle, .outbound, null),
    );
    try std.testing.expectEqual(@as(u64, 1), pair.client.connection_metrics.closed[1][@intFromEnum(Engine.CloseReason.dial_unanswered)]);
    try std.testing.expectEqual(@as(u64, 0), pair.client.connection_metrics.established[1]);
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.client, &storage).len);
    try std.testing.expectEqual(@as(u16, 0), pair.client.registry.handshaking);
}

test "engine rejects a forged certificate with tls_failed" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();

    const server_key = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{2}));
    const other = try keys.KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{9}));
    const server_public = server_key.publicKey();
    const context = &pair.server.tls;
    try test_support.forgeHostSignature(&context.certificate, &server_public, &other);
    try std.testing.expectEqual(@as(c_int, 1), binding.c.SSL_CTX_use_certificate(context.ssl_ctx, context.certificate.x509));

    const handle = try pair.dial();
    try pair.pump();

    var storage: [8]Event = undefined;
    const client_events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), client_events.len);
    try std.testing.expectEqual(
        Engine.CloseReason.tls_failed,
        try expectClosed(client_events[0], handle, .outbound, null),
    );
}

test "engine reclaims slots across many connection lifetimes" {
    var pair: Pair = .{};
    try pair.init(
        .{ .connections_max = 4, .handshaking_max = 4 },
        .{ .connections_max = 4, .handshaking_max = 4 },
    );
    defer pair.deinit();

    var storage: [8]Event = undefined;
    var round: usize = 0;
    while (round < 100) : (round += 1) {
        const handle = try pair.dial();
        try pair.pump();
        _ = pair.events(&pair.client, &storage);
        _ = pair.events(&pair.server, &storage);
        _ = pair.client.close(handle, 0);
        try pair.pump();
        _ = pair.events(&pair.client, &storage);
        _ = pair.events(&pair.server, &storage);
    }

    try std.testing.expectEqual(@as(usize, 1), pair.client.registry.activeIndices().len);
    _ = pair.events(&pair.client, &storage);
    _ = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 0), pair.client.registry.activeIndices().len);
    try std.testing.expectEqual(@as(usize, 0), pair.server.registry.activeIndices().len);
    try std.testing.expectEqual(@as(u16, 0), pair.client.registry.handshaking);
    try std.testing.expectEqual(@as(u16, 0), pair.server.registry.handshaking);
    for (pair.client.registry.slots) |*slot| try std.testing.expect(slot.conn == null);
    for (pair.server.registry.slots) |*slot| try std.testing.expect(slot.conn == null);
}

test "engine abandon frees a closed slot whose event was never reported" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    try std.testing.expect(pair.client.close(handles.client, 0));
    try pair.pump();
    try std.testing.expect(pair.client.eventsPending());

    try std.testing.expect(pair.client.abandon(handles.client));
    try std.testing.expectEqual(@as(usize, 0), pair.client.registry.activeIndices().len);
    try std.testing.expect(!pair.client.eventsPending());

    var storage: [8]Event = undefined;
    try std.testing.expectEqual(@as(usize, 0), pair.client.pollEvents(&storage));
    try std.testing.expect(!pair.client.abandon(handles.client));
}

test "engine abandon frees a closed slot after its event was reported" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    try std.testing.expect(pair.client.close(handles.client, 0));
    try pair.pump();

    var storage: [8]Event = undefined;
    const events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), events.len);
    _ = try expectClosed(events[0], handles.client, .outbound, &pair.server_ctx);
    try std.testing.expectEqual(@as(usize, 1), pair.client.registry.activeIndices().len);
    try std.testing.expect(!pair.client.eventsPending());

    try std.testing.expect(pair.client.abandon(handles.client));
    try std.testing.expectEqual(@as(usize, 0), pair.client.registry.activeIndices().len);
    try std.testing.expect(!pair.client.abandon(handles.client));
    try std.testing.expect(pair.client.peerId(handles.client) == null);
}

test "engine polling twice keeps handles from the first call valid" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.client.openStream(handles.client);
    _ = try pair.client.write(stream, "one", false);
    try pair.pump();

    var one: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&one));
    const inbound = try expectStreamOpened(one[0], handles.server);

    try std.testing.expect(pair.client.close(handles.client, 0));
    try pair.pump();

    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&one));
    _ = try expectClosed(one[0], handles.server, .inbound, &pair.client_ctx);
    try std.testing.expectEqual(@as(usize, 0), pair.server.pollEvents(&one));
    try std.testing.expect(!pair.server.eventsPending());

    var buffer: [16]u8 = undefined;
    const final = try pair.server.read(inbound, &buffer);
    try std.testing.expectEqualStrings("one", buffer[0..final.len]);
    try std.testing.expect(pair.server.peerId(handles.server) != null);

    pair.server.releaseReported();
    try std.testing.expect(pair.server.peerId(handles.server) == null);
    try std.testing.expectError(error.StaleHandle, pair.server.read(inbound, &buffer));
}

test "engine close reports whether it issued the close" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    try std.testing.expect(pair.client.close(handles.client, 0));
    try std.testing.expect(!pair.client.close(handles.client, 0));
}

test "engine abandon frees a dialing slot without an event" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();

    const handle = try pair.dial();
    try std.testing.expectEqual(@as(usize, 1), pair.client.registry.activeIndices().len);

    try std.testing.expect(pair.client.abandon(handle));
    try std.testing.expectEqual(@as(usize, 0), pair.client.registry.activeIndices().len);
    try std.testing.expect(!pair.client.abandon(handle));

    var storage: [8]Event = undefined;
    try std.testing.expectEqual(@as(usize, 0), pair.client.pollEvents(&storage));
    try std.testing.expect(!pair.client.eventsPending());
    try std.testing.expectError(error.StaleHandle, pair.client.openStream(handle));
}

test "engine abandons an unanswered dial at the unanswered timeout" {
    var pair: Pair = .{};
    try pair.init(.{ .unanswered_dial_timeout_ms = 100, .handshake_timeout_ms = 1_000 }, .{});
    defer pair.deinit();
    pair.drop_to_server = true;

    const handle = try pair.dial();
    try pair.pump();
    try std.testing.expect(!pair.client.dialAnswered(handle));
    try std.testing.expect(pair.client.nextDeadlineNs().? <= pair.now.nanos() + 100 * std.time.ns_per_ms);
    pair.advance(99);
    try pair.pump();
    var storage: [8]Event = undefined;
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.client, &storage).len);
    pair.advance(1);
    try pair.pump();
    const client_events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), client_events.len);
    try std.testing.expectEqual(
        Engine.CloseReason.dial_unanswered,
        try expectClosed(client_events[0], handle, .outbound, null),
    );
    try std.testing.expectEqual(@as(u64, 1), pair.client.connection_metrics.closed[1][@intFromEnum(Engine.CloseReason.dial_unanswered)]);
    try std.testing.expectEqual(@as(u16, 0), pair.client.registry.dialing);
}

test "engine keeps an answered dial until the handshake timeout" {
    var pair: Pair = .{};
    try pair.init(.{ .unanswered_dial_timeout_ms = 100, .handshake_timeout_ms = 1_000 }, .{});
    defer pair.deinit();

    const handle = try pair.dial();
    try std.testing.expect(try pair.transfer(&pair.client, &pair.server, client_address, false));
    try std.testing.expect(pair.client.dialAnswered(handle));
    pair.drop_to_server = true;
    pair.advance(100);
    try pair.pump();
    var storage: [8]Event = undefined;
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.client, &storage).len);
    pair.advance(900);
    try pair.pump();
    const client_events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), client_events.len);
    try std.testing.expectEqual(
        Engine.CloseReason.handshake_timeout,
        try expectClosed(client_events[0], handle, .outbound, null),
    );
}

test "engine deferred host close delays peer claims until the final flight drains" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handle = try establishClient(&pair);
    var packet: [constants.datagram_size_max]u8 = undefined;
    const flight = pair.sendOne(&pair.client, handle.index, &packet).?;
    var reply: [constants.datagram_size_max]u8 = undefined;
    try std.testing.expect(pair.server.receive(flight, &client_address, pair.now, &reply) == .accepted);
    pair.settle(&pair.server);
    var storage: [8]Event = undefined;
    const server = try expectConnected(pair.events(&pair.server, &storage)[0], .inbound, &pair.client_ctx);
    const stream = try pair.server.openStream(server);
    _ = try pair.server.write(stream, "last", true);
    _ = try pair.transfer(&pair.server, &pair.client, server_address, false);
    try std.testing.expect(pair.client.registry.slots[handle.index].flight_pending);
    try std.testing.expect(pair.client.close(handle, 7));
    pair.settle(&pair.client);
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.client, &storage).len);
    try std.testing.expect(pair.client.registry.slots[handle.index].table.find(stream.id) == null);
    try pair.pump();
    const closed = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 2), closed.len);
    const inbound = try support.expectStreamOpened(closed[0], handle);
    try std.testing.expectEqual(Engine.CloseReason.host, try expectClosed(closed[1], handle, .outbound, &pair.server_ctx));
    var buffer: [8]u8 = undefined;
    const read = try pair.client.read(inbound, &buffer);
    try std.testing.expectEqualStrings("last", buffer[0..read.len]);
    try std.testing.expect(read.fin);
}

test "engine close all includes precatalog handshakes and is repeatable" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);
    _ = try pair.dial();
    try std.testing.expectEqual(@as(u16, 1), pair.client.registry.dialing);
    try std.testing.expectEqual(@as(u16, 2), pair.client.registry.outbound);
    pair.client.closeAll();
    try std.testing.expectEqual(@as(u16, 0), pair.client.registry.dialing);
    try std.testing.expectEqual(@as(u16, 1), pair.client.registry.outbound);
    try pair.pump();
    var storage: [8]Event = undefined;
    const events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), events.len);
    try std.testing.expectEqual(Engine.CloseReason.host, try expectClosed(events[0], handles.client, .outbound, &pair.server_ctx));
    pair.client.closeAll();
    pair.client.closeAll();
    try std.testing.expectEqual(@as(u16, 0), pair.client.registry.outbound);
    try std.testing.expectEqual(@as(usize, 0), pair.client.registry.activeIndices().len);
}

test "engine close all abandons inbound precatalog handshakes" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    _ = try establishClient(&pair);
    try std.testing.expectEqual(@as(u16, 1), pair.server.registry.handshaking);
    pair.server.closeAll();
    try std.testing.expectEqual(@as(u16, 0), pair.server.registry.handshaking);
    try std.testing.expectEqual(@as(usize, 0), pair.server.registry.activeIndices().len);
    try std.testing.expect(!pair.server.eventsPending());
}

test "engine send failures reject stale handles and count each close once" {
    var pair: Pair = .{};
    try pair.init(.{ .connections_max = 1, .handshaking_max = 1, .dialing_max = 1 }, .{});
    defer pair.deinit();
    try std.testing.expect(!pair.client.failSend(.{ .index = 0, .generation = 0 }));
    try std.testing.expect(!pair.client.failSend(.{ .index = 1, .generation = 0 }));

    const first = try pair.dial();
    try std.testing.expect(!pair.client.failSend(.{ .index = first.index, .generation = first.generation + 1 }));
    try std.testing.expect(pair.client.failSend(first));
    try std.testing.expect(!pair.client.failSend(first));
    var events: [2]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), pair.client.pollEvents(&events));
    try std.testing.expectEqual(Engine.CloseReason.send_failed, try expectClosed(events[0], first, .outbound, null));
    pair.client.releaseReported();
    try std.testing.expect(!pair.client.failSend(first));

    const replacement = try pair.dial();
    try std.testing.expectEqual(first.index, replacement.index);
    try std.testing.expect(first.generation != replacement.generation);
    try std.testing.expect(!pair.client.failSend(first));
    try std.testing.expectEqual(replacement, pair.client.sendOwner(replacement.index).?);
    try std.testing.expectEqual(@as(usize, 0), pair.client.pollEvents(&events));
    const direction = @intFromEnum(Engine.Direction.outbound);
    const reason = @intFromEnum(Engine.CloseReason.send_failed);
    try std.testing.expectEqual(@as(u64, 1), pair.client.connection_metrics.closed[direction][reason]);
    try std.testing.expect(pair.client.failSend(replacement));
    try std.testing.expectEqual(@as(u64, 2), pair.client.connection_metrics.closed[direction][reason]);
}

test "engine close reason keeps first local cause but send failure overrides deferred close" {
    for ([_]bool{ false, true }) |fail_send| {
        var pair: Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        const handle = if (fail_send) try establishClient(&pair) else (try support.connectPair(&pair)).client;
        try std.testing.expect(pair.client.close(handle, 7));
        if (fail_send) {
            try std.testing.expect(pair.client.failSend(handle));
        } else {
            // A second native close cause cannot replace the already latched host reason.
            const slot = &pair.client.registry.slots[handle.index];
            slot.close(.tls_failed, 0);
            try std.testing.expectEqual(Engine.CloseReason.host, slot.closeReason());
            try pair.pump();
        }
        var storage: [8]Event = undefined;
        const events = pair.events(&pair.client, &storage);
        try std.testing.expectEqual(@as(usize, 1), events.len);
        const reason: Engine.CloseReason = if (fail_send) .send_failed else .host;
        try std.testing.expectEqual(reason, try expectClosed(events[0], handle, .outbound, &pair.server_ctx));
        try std.testing.expectEqual(@as(u16, 0), pair.client.registry.outbound);
        try std.testing.expectEqual(@as(u16, 0), pair.client.registry.dialing);
    }
}
