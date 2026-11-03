const std = @import("std");
const constants = @import("../constants.zig");
const Engine = @import("Engine.zig");
const limits = @import("limits.zig");
const support = @import("test_support.zig");
const types = @import("../types.zig");
const Registry = @import("Registry.zig");

const Pair = support.Pair;
const client_address = support.client_address;
const server_address = support.server_address;
const connectPair = support.connectPair;

const rebound_address = types.Address{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4_003 } };
const bulk = [_]u8{0x5a} ** 2_000;

fn expectPathChanged(event: Engine.Event, conn: Engine.Handle) !types.Address {
    switch (event) {
        .path_changed => |changed| {
            try std.testing.expectEqual(conn, changed.conn);
            return changed.peer;
        },
        else => return error.TestUnexpectedResult,
    }
}

fn readAll(engine: *Engine, stream: Engine.StreamHandle, sink: []u8) !usize {
    var total: usize = 0;
    var reads: usize = 0;
    while (reads < 16 and total < sink.len) : (reads += 1) {
        const read = try engine.read(stream, sink[total..]);
        if (read.len == 0) break;
        total += read.len;
    }
    return total;
}

test "engine validates a routed packet that arrives from another source path" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);
    var storage: [8]Engine.Event = undefined;

    try std.testing.expectEqual(client_address, pair.server.receiveEndpoint(handles.server).?);
    const original: types.PeerOrigin = .{ .connection = handles.server, .endpoint = pair.server.receiveEndpoint(handles.server) };
    pair.client_source = rebound_address;
    const stream = try pair.client.openStream(handles.client);
    try std.testing.expectEqual(bulk.len, try pair.client.write(stream, &bulk, false));
    try pair.pump();

    try std.testing.expectEqual(rebound_address, pair.server.peerAddress(handles.server).?);
    try std.testing.expect(pair.server.receiveEndpoint(handles.server) == null);
    try std.testing.expectEqual(client_address, original.endpoint.?);
    const events = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 2), events.len);
    try std.testing.expectEqual(rebound_address, try expectPathChanged(events[0], handles.server));
    const inbound = try support.expectStreamOpened(events[1], handles.server);

    var sink: [bulk.len]u8 = undefined;
    try std.testing.expectEqual(bulk.len, try readAll(&pair.server, inbound, &sink));
    try std.testing.expectEqualSlices(u8, &bulk, &sink);
    try std.testing.expectEqual(@as(usize, 5), try pair.server.write(inbound, "world", false));
    try pair.pump();
    var reply: [16]u8 = undefined;
    const echoed = try pair.client.read(stream, &reply);
    try std.testing.expectEqualStrings("world", reply[0..echoed.len]);
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.server, &storage).len);
}

test "engine keeps the validated path while a new source remains unvalidated" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);
    var storage: [8]Engine.Event = undefined;

    pair.client_source = rebound_address;
    pair.drop_to_address = rebound_address;
    const stream = try pair.client.openStream(handles.client);
    try std.testing.expectEqual(bulk.len, try pair.client.write(stream, &bulk, false));

    var inbound: ?Engine.StreamHandle = null;
    var rounds: usize = 0;
    while (rounds < 20) : (rounds += 1) {
        try pair.pump();
        for (pair.events(&pair.server, &storage)) |event| switch (event) {
            .path_changed => return error.TestUnexpectedResult,
            .stream_opened => |opened| inbound = opened,
            else => {},
        };
        try std.testing.expectEqual(client_address, pair.server.peerAddress(handles.server).?);
    }
    try std.testing.expect(inbound != null);
    try std.testing.expect(pair.server.receiveEndpoint(handles.server) == null);

    pair.client_source = client_address;
    pair.drop_to_address = null;
    try std.testing.expectEqual(@as(usize, 3), try pair.client.write(stream, "bye", false));
    try pair.pump();
    var sink: [bulk.len + 3]u8 = undefined;
    try std.testing.expectEqual(sink.len, try readAll(&pair.server, inbound.?, &sink));
    try std.testing.expectEqualSlices(u8, &bulk, sink[0..bulk.len]);
    try std.testing.expectEqualStrings("bye", sink[bulk.len..]);
    try std.testing.expectEqual(client_address, pair.server.peerAddress(handles.server).?);
    try std.testing.expect(pair.server.receiveEndpoint(handles.server) == null);
    try std.testing.expect(pair.server.peerId(handles.server) != null);
    for (pair.events(&pair.server, &storage)) |event| {
        try std.testing.expect(event != .path_changed);
        try std.testing.expect(event != .closed);
    }
}

test "engine survives an undecryptable packet routed to a live slot" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const scid = pair.client.registry.slots[handles.client.index].scid;
    var garbage: [1 + limits.local_cid_length + 32]u8 = undefined;
    garbage[0] = 0x40;
    @memcpy(garbage[1..][0..limits.local_cid_length], scid.slice());
    for (garbage[1 + limits.local_cid_length ..], 0..) |*byte, index| byte.* = @truncate(index *% 7 +% 3);

    var response: [constants.datagram_size_max]u8 = undefined;
    const outcome = pair.client.receive(
        &garbage,
        &server_address,
        pair.now,
        &response,
    );
    switch (outcome) {
        .accepted => |handle| try std.testing.expectEqual(handles.client, handle),
        else => return error.TestUnexpectedResult,
    }
    try std.testing.expect(pair.client.peerId(handles.client) != null);
}

test "engine routes a replayed client Initial to the existing connection" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    try std.testing.expect(pair.first_initial_len >= limits.client_initial_min);
    var replay: [constants.datagram_size_max]u8 = undefined;
    @memcpy(replay[0..pair.first_initial_len], pair.first_initial[0..pair.first_initial_len]);

    var response: [constants.datagram_size_max]u8 = undefined;
    const outcome = pair.server.receive(
        replay[0..pair.first_initial_len],
        &client_address,
        pair.now,
        &response,
    );
    switch (outcome) {
        .accepted => |handle| try std.testing.expectEqual(handles.server, handle),
        else => return error.TestUnexpectedResult,
    }
    try std.testing.expectEqual(@as(u16, 0), pair.server.registry.handshaking);
    try std.testing.expectEqual(@as(usize, 1), pair.server.registry.activeIndices().len);
}

test "engine advances and flushes only the connections that received datagrams" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);
    try pair.pump();
    try std.testing.expect(!pair.client.backlog());
    try std.testing.expectEqual(@as(usize, 0), pair.client.registry.pending.len);

    const stream = try pair.server.openStream(handles.server);
    _ = try pair.server.write(stream, "x", false);
    try std.testing.expect(try pair.transfer(&pair.server, &pair.client, server_address, false));
    const slot = &pair.client.registry.slots[handles.client.index];
    try std.testing.expect(slot.pending_link.linked and slot.dirty_link.linked);
    try std.testing.expectEqual(@as(usize, 1), pair.client.registry.pending.len);
    pair.settle(&pair.client);
    try std.testing.expectEqual(@as(usize, 0), pair.client.registry.pending.len);

    var storage: [8]Engine.Event = undefined;
    const polled = pair.events(&pair.client, &storage);
    try std.testing.expect(polled.len > 0);
    for (polled) |event| {
        const conn = switch (event) {
            .stream_opened => |opened| opened.conn,
            .stream_ready => |ready| ready.stream.conn,
            else => return error.TestUnexpectedResult,
        };
        try std.testing.expectEqual(handles.client, conn);
    }
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.client, &storage).len);
}

test "engine junk short header from a live peer's address marks nothing" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);
    try pair.pump();

    var reset: [1 + limits.local_cid_length + 24]u8 = undefined;
    reset[0] = 0x40;
    for (reset[1..], 0..) |*byte, index| byte.* = @truncate(index *% 37 +% 11);

    var response: [constants.datagram_size_max]u8 = undefined;
    const outcome = pair.client.receive(
        &reset,
        &server_address,
        pair.now,
        &response,
    );
    try std.testing.expectEqual(Engine.ReceiveOutcome.dropped, outcome);
    const slot = &pair.client.registry.slots[handles.client.index];
    try std.testing.expect(!slot.pending_link.linked and !slot.dirty_link.linked);
    try std.testing.expect(!pair.client.backlog());

    try std.testing.expect(pair.client.peerId(handles.client) != null);
    const live_before = pair.client.registry.activeIndices().len;
    const stranger = types.Address{ .ip4 = .{ .octets = .{ 127, 0, 0, 9 }, .port = 4_009 } };
    try std.testing.expectEqual(
        Engine.ReceiveOutcome.dropped,
        pair.client.receive(
            &reset,
            &stranger,
            pair.now,
            &response,
        ),
    );
    try std.testing.expectEqual(live_before, pair.client.registry.activeIndices().len);
    try std.testing.expect(pair.client.peerId(handles.client) != null);
    var events: [8]Engine.Event = undefined;
    for (events[0..pair.client.pollEvents(&events)]) |event| try std.testing.expect(event != .closed);
}

test "engine registry retires exhausted connection generations" {
    var registry = try Registry.init(std.testing.allocator, 2, 1);
    defer registry.deinit(std.testing.allocator);
    registry.slots[0].generation = std.math.maxInt(u32);
    try std.testing.expectEqual(@as(?u16, 1), registry.claim());
    registry.unclaim(1);
    registry.slots[1].generation = std.math.maxInt(u32);
    try std.testing.expectEqual(@as(?u16, null), registry.claim());
    try std.testing.expectEqual(@as(u16, 0), registry.active_len);
}
