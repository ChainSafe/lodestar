const std = @import("std");
const binding = @import("binding.zig");
const Engine = @import("Engine.zig");
const limits = @import("limits.zig");
const trace = @import("../stream_trace.zig");
const support = @import("test_support.zig");

const Event = Engine.Event;
const Pair = support.Pair;
const client_address = support.client_address;
const server_address = support.server_address;
const connectPair = support.connectPair;
const expectClosed = support.expectClosed;
const expectStreamOpened = support.expectStreamOpened;
const expectStreamClosed = support.expectStreamClosed;

test "engine stream errors leak no quiche or openssl member" {
    comptime {
        const leaked = [_][]const u8{ "Done", "OpenSslFailed", "TlsFail", "CryptoFail", "Unknown" };
        for (@typeInfo(Engine.StreamError).error_set.?) |member| {
            for (leaked) |name| std.debug.assert(!std.mem.eql(u8, member.name, name));
        }
        std.debug.assert(@typeInfo(Engine.StreamError).error_set.?.len == 8);
        std.debug.assert(@typeInfo(Engine.DialError).error_set.?.len == 5);
        for (@typeInfo(binding.Error).error_set.?) |member| {
            std.debug.assert(!std.mem.eql(u8, member.name, "Done"));
        }
    }
    try std.testing.expect(@typeInfo(Engine.StreamError).error_set != null);
}

test "engine reports a stopped write as a stream close carrying the peer's code" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.client.openStream(handles.client);
    try std.testing.expectEqual(@as(usize, 1), try pair.client.write(stream, "x", true));
    try pair.pump();
    var storage: [8]Event = undefined;
    const inbound = try support.expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    var buffer: [8]u8 = undefined;
    const read = try pair.server.read(inbound, &buffer);
    try std.testing.expect(read.fin);
    try std.testing.expectEqualStrings("x", buffer[0..read.len]);

    pair.client.shutdown(stream, .read, 7);
    try pair.pump();
    const stopped = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), stopped.len);
    try std.testing.expect(stopped[0].stream_ready.ready.writable);
    try std.testing.expectError(error.StreamStopped, pair.server.write(inbound, "y", false));
    const events = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), events.len);
    try std.testing.expectEqual(@as(?u64, 7), try support.expectStreamClosed(events[0], inbound));
    try std.testing.expectError(error.UnknownStream, pair.server.write(inbound, "z", false));
}

test "engine reports a stopped write on a stream that is still readable" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.client.openStream(handles.client);
    try std.testing.expectEqual(@as(usize, 1), try pair.client.write(stream, "x", false));
    try pair.pump();
    var storage: [8]Event = undefined;
    const inbound = try support.expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    pair.client.shutdown(stream, .read, 7);
    try pair.pump();
    const events = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), events.len);
    try std.testing.expect(events[0].stream_ready.ready.writable);
    try std.testing.expectError(error.StreamStopped, pair.server.write(inbound, "y", false));
    var buffer: [8]u8 = undefined;
    try std.testing.expectEqualStrings("x", buffer[0..(try pair.server.read(inbound, &buffer)).len]);
}

test "engine routed reset and stop retire through I/O and capture closure once" {
    for ([_]bool{ false, true }) |reset_read| {
        var pair: Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        const handles = try connectPair(&pair);
        var capture = try trace.Capture.init(std.testing.allocator, std.testing.io, @intCast(pair.server.registry.slots.len));
        defer capture.deinit(std.testing.allocator);
        capture.connected(handles.server, &pair.client_ctx.local_peer_id, client_address, server_address, .inbound);
        pair.server.stream_capture = &capture;
        defer pair.server.stream_capture = null;

        const stream = try pair.client.openStream(handles.client);
        _ = try pair.client.write(stream, "x", !reset_read);
        try pair.pump();
        var storage: [8]Event = undefined;
        const inbound = try expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
        try pair.server.bindStream(inbound, .{ .owner = .reqresp_inbound, .row = 0 });
        capture.selected(inbound, .{ .reqresp = .ping_v1 }, .inbound, "");
        var buffer: [8]u8 = undefined;
        const read = try pair.server.read(inbound, &buffer);
        try std.testing.expectEqualStrings("x", buffer[0..read.len]);
        try std.testing.expectEqual(!reset_read, read.fin);
        if (reset_read) _ = try pair.server.write(inbound, "", true);
        pair.client.shutdown(stream, if (reset_read) .write else .read, 7);
        try pair.pump();
        const ready = pair.events(&pair.server, &storage);
        try std.testing.expectEqual(@as(usize, 1), ready.len);
        try std.testing.expectEqual(inbound, ready[0].stream_ready.stream);
        if (reset_read) {
            const reset = try pair.server.read(inbound, &buffer);
            try std.testing.expect(reset.fin);
            try std.testing.expectEqual(@as(?u64, 7), reset.reset_code);
        } else {
            try std.testing.expect(ready[0].stream_ready.ready.writable);
            try std.testing.expectError(error.StreamStopped, pair.server.write(inbound, "y", false));
        }
        try std.testing.expect(pair.server.route(inbound) == null);
        try std.testing.expect(!pair.server.eventsPending());
        try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.server, &storage).len);
        pair.server.closeStream(inbound, 0);
        const batch = capture.drain();
        var closed: usize = 0;
        for (batch.events) |event| if (event.payload == .stream_closed) {
            try std.testing.expect(event.payload.stream_closed.reset);
            closed += 1;
        };
        try std.testing.expectEqual(@as(usize, 1), closed);
        try std.testing.expect(!batch.reset and !batch.pending);
    }
}

test "engine capacity preserves a STOP code before gathering writable streams" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);
    const stream = try pair.client.openStream(handles.client);
    _ = try pair.client.write(stream, "x", true);
    try pair.pump();
    var storage: [8]Event = undefined;
    const inbound = try expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    var buffer: [1]u8 = undefined;
    try std.testing.expect((try pair.server.read(inbound, &buffer)).fin);

    const code = std.math.maxInt(u62);
    pair.client.shutdown(stream, .read, code);
    try pair.flush(&pair.client);
    try std.testing.expectError(error.StreamStopped, pair.server.streamCapacity(inbound));
    const ready = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), ready.len);
    try std.testing.expect(ready[0].stream_ready.ready.writable);
    try std.testing.expectError(error.StreamStopped, pair.server.write(inbound, "y", false));
    const closed = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), closed.len);
    try std.testing.expectEqual(@as(?u64, code), try expectStreamClosed(closed[0], inbound));
}

test "engine streams echo data with fin in both directions" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.client.openStream(handles.client);
    try std.testing.expectEqual(@as(u64, 0), stream.id);
    try std.testing.expectEqual(@as(usize, 4), try pair.client.write(stream, "ping", true));
    try pair.pump();

    var storage: [8]Event = undefined;
    const server_events = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), server_events.len);
    const inbound = try expectStreamOpened(server_events[0], handles.server);
    try std.testing.expectEqual(@as(u64, 0), inbound.id);

    var buffer: [16]u8 = undefined;
    const received = try pair.server.read(inbound, &buffer);
    try std.testing.expectEqualStrings("ping", buffer[0..received.len]);
    try std.testing.expect(received.fin);
    try std.testing.expectEqual(@as(usize, 4), try pair.server.write(inbound, "pong", true));
    try pair.pump();

    const reply = try pair.client.read(stream, &buffer);
    try std.testing.expectEqualStrings("pong", buffer[0..reply.len]);
    try std.testing.expect(reply.fin);
    try std.testing.expectError(error.UnknownStream, pair.client.read(stream, &buffer));
    try std.testing.expectError(error.UnknownStream, pair.server.read(inbound, &buffer));
}

test "engine server can open a stream toward the client" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.server.openStream(handles.server);
    try std.testing.expectEqual(@as(u64, 1), stream.id);
    _ = try pair.server.write(stream, "hello", false);
    try pair.pump();

    var storage: [8]Event = undefined;
    const client_events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), client_events.len);
    const inbound = try expectStreamOpened(client_events[0], handles.client);
    var buffer: [16]u8 = undefined;
    const received = try pair.client.read(inbound, &buffer);
    try std.testing.expectEqualStrings("hello", buffer[0..received.len]);
    try std.testing.expect(!received.fin);

    pair.client.closeStream(inbound, 7);
    try pair.pump();
    try std.testing.expectError(error.UnknownStream, pair.client.read(inbound, &buffer));
    try std.testing.expectError(error.StreamStopped, pair.server.write(stream, "more", false));
}

fn activePeerStreams(engine: *const Engine, handle: Engine.Handle) usize {
    var count: usize = 0;
    const peer_half = engine.registry.slots[handle.index].table.entries[limits.streams_per_connection / 2 ..];
    for (peer_half) |*entry| {
        if (entry.claimed) count += 1;
    }
    return count;
}

test "engine releases a peer-reset stream entry and frees the peer half" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.client.openStream(handles.client);
    _ = try pair.client.write(stream, "x", false);
    try pair.pump();

    var storage: [limits.streams_per_connection]Event = undefined;
    const opened = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), opened.len);
    const inbound = try expectStreamOpened(opened[0], handles.server);

    pair.client.shutdown(stream, .write, 7);
    pair.client.shutdown(stream, .read, 7);
    try pair.pump();

    var buffer: [16]u8 = undefined;
    const reset = try pair.server.read(inbound, &buffer);
    try std.testing.expectEqual(@as(usize, 0), reset.len);
    try std.testing.expect(reset.fin);
    try std.testing.expectEqual(@as(u64, 7), reset.reset_code.?);
    try std.testing.expectError(error.UnknownStream, pair.server.read(inbound, &buffer));
    try std.testing.expectEqual(@as(usize, 1), activePeerStreams(&pair.server, handles.server));

    const closed = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), closed.len);
    try std.testing.expectEqual(@as(u64, 7), (try expectStreamClosed(closed[0], inbound)).?);
    try std.testing.expectEqual(@as(usize, 0), activePeerStreams(&pair.server, handles.server));

    const dialer_closed = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), dialer_closed.len);
    try std.testing.expect(try expectStreamClosed(dialer_closed[0], stream) == null);

    var reopened: usize = 0;
    while (reopened < limits.peer_streams_bidi) : (reopened += 1) {
        const next = try pair.client.openStream(handles.client);
        _ = try pair.client.write(next, "y", false);
        try pair.pump();
    }
    const events = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, limits.peer_streams_bidi), events.len);
    for (events) |event| _ = try expectStreamOpened(event, handles.server);
}

test "engine keeps a queued fin intact when closing a stream" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.client.openStream(handles.client);
    try std.testing.expectEqual(@as(usize, 4), try pair.client.write(stream, "tail", true));
    pair.client.closeStream(stream, 0);
    try pair.pump();

    var storage: [8]Event = undefined;
    const inbound = try expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    var buffer: [16]u8 = undefined;
    const received = try pair.server.read(inbound, &buffer);
    try std.testing.expectEqualStrings("tail", buffer[0..received.len]);
    try std.testing.expect(received.fin);
    try std.testing.expect(received.reset_code == null);
}

test "engine releases a stopped and reset stream entry" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.server.openStream(handles.server);
    _ = try pair.server.write(stream, "hello", false);
    try pair.pump();

    var storage: [8]Event = undefined;
    const inbound = try expectStreamOpened(pair.events(&pair.client, &storage)[0], handles.client);
    pair.client.closeStream(inbound, 9);
    try pair.pump();

    try std.testing.expectError(error.StreamStopped, pair.server.write(stream, "more", false));
    var buffer: [16]u8 = undefined;
    const ended = try pair.server.read(stream, &buffer);
    try std.testing.expect(ended.fin);
    try std.testing.expectError(error.UnknownStream, pair.server.read(stream, &buffer));
}

test "engine reports a stream close on each side of a fin exchange" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.client.openStream(handles.client);
    _ = try pair.client.write(stream, "ping", true);
    try pair.pump();

    var storage: [8]Event = undefined;
    const inbound = try expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    var buffer: [16]u8 = undefined;
    _ = try pair.server.read(inbound, &buffer);
    try std.testing.expectEqual(@as(usize, 4), try pair.server.write(inbound, "pong", true));
    try pair.pump();

    const server_events = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), server_events.len);
    try std.testing.expect(try expectStreamClosed(server_events[0], inbound) == null);
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.server, &storage).len);

    const reply = try pair.client.read(stream, &buffer);
    try std.testing.expectEqualStrings("pong", buffer[0..reply.len]);
    const client_events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), client_events.len);
    try std.testing.expect(try expectStreamClosed(client_events[0], stream) == null);
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.client, &storage).len);
}

test "engine reports a stream close on both sides of a reset" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.client.openStream(handles.client);
    _ = try pair.client.write(stream, "x", false);
    try pair.pump();

    var storage: [8]Event = undefined;
    const inbound = try expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    pair.client.shutdown(stream, .write, 7);
    pair.client.shutdown(stream, .read, 7);
    try pair.pump();

    const client_events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), client_events.len);
    try std.testing.expect(try expectStreamClosed(client_events[0], stream) == null);
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.client, &storage).len);

    var buffer: [16]u8 = undefined;
    const reset = try pair.server.read(inbound, &buffer);
    try std.testing.expectEqual(@as(u64, 7), reset.reset_code.?);
    const server_events = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), server_events.len);
    try std.testing.expectEqual(@as(u64, 7), (try expectStreamClosed(server_events[0], inbound)).?);
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.server, &storage).len);
}

test "engine reports a stream close once for a host stream close" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.client.openStream(handles.client);
    _ = try pair.client.write(stream, "x", false);
    pair.client.closeStream(stream, 9);

    var storage: [8]Event = undefined;
    const events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), events.len);
    try std.testing.expect(try expectStreamClosed(events[0], stream) == null);
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.client, &storage).len);
    try std.testing.expectError(error.UnknownStream, pair.client.write(stream, "y", false));
    var buffer: [16]u8 = undefined;
    try std.testing.expectError(error.UnknownStream, pair.client.read(stream, &buffer));
}

const bulk_length = 64 * 1_024;

test "engine reports a blocked stream and recovers capacity after a pump" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    var capture = try trace.Capture.init(std.testing.allocator, std.testing.io, @intCast(pair.client.registry.slots.len));
    defer capture.deinit(std.testing.allocator);
    capture.connected(handles.client, &pair.server_ctx.local_peer_id, server_address, client_address, .outbound);
    pair.client.stream_capture = &capture;
    defer pair.client.stream_capture = null;

    const stream = try pair.client.openStream(handles.client);
    capture.selected(stream, .identify, .outbound, "");
    var payload: [bulk_length]u8 = undefined;
    for (&payload, 0..) |*byte, index| byte.* = @truncate(index *% 31 +% 5);

    var sent = try pair.client.write(stream, &payload, false);
    try std.testing.expect(sent > 0);
    try std.testing.expect(sent < payload.len);
    var blocked = false;
    var attempts: usize = 0;
    while (attempts < 64 and !blocked and sent < payload.len) : (attempts += 1) {
        sent += pair.client.write(stream, payload[sent..], false) catch |err| switch (err) {
            error.WouldBlock => blk: {
                blocked = true;
                break :blk 0;
            },
            else => return err,
        };
    }
    try std.testing.expect(blocked);

    try std.testing.expectEqual(@as(usize, 0), try pair.client.streamCapacity(stream));

    try pair.pump();
    try std.testing.expect(try pair.client.streamCapacity(stream) > 0);

    var storage: [8]Event = undefined;
    const inbound = try expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    var received: usize = 0;
    var scratch: [4_096]u8 = undefined;
    var pumps: usize = 0;
    while (pumps < 64 and received < payload.len) : (pumps += 1) {
        var writes: usize = 0;
        while (writes < 64 and sent < payload.len) : (writes += 1) {
            sent += pair.client.write(stream, payload[sent..], false) catch |err| switch (err) {
                error.WouldBlock => break,
                else => return err,
            };
        }
        try pair.pump();
        var reads: usize = 0;
        while (reads < 64) : (reads += 1) {
            const chunk = try pair.server.read(inbound, &scratch);
            if (chunk.len == 0) break;
            try std.testing.expectEqualSlices(u8, payload[received..][0..chunk.len], scratch[0..chunk.len]);
            received += chunk.len;
        }
    }
    try std.testing.expectEqual(payload.len, received);
    const captured = capture.drain();
    try std.testing.expect(!captured.reset and !captured.pending);
    try std.testing.expectEqualSlices(u8, &payload, captured.data);
}

test "engine bounds streams per connection" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    var opened: usize = 0;
    while (opened < limits.peer_streams_bidi) : (opened += 1) {
        const stream = try pair.client.openStream(handles.client);
        _ = try pair.client.write(stream, "x", false);
    }
    try pair.flush(&pair.client);
    for (0..8) |_| {
        try std.testing.expectError(error.StreamLimit, pair.client.openStream(handles.client));
        try std.testing.expect(!pair.client.backlog());
    }
    try pair.pump();

    var storage: [limits.streams_per_connection]Event = undefined;
    const server_events = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, limits.peer_streams_bidi), server_events.len);
    for (server_events) |event| _ = try expectStreamOpened(event, handles.server);
}

test "engine keeps received data readable after a local close" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.client.openStream(handles.client);
    _ = try pair.client.write(stream, "ping", true);
    try pair.pump();

    var storage: [8]Event = undefined;
    const inbound = try expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    _ = pair.server.close(handles.server, 0);

    var buffer: [16]u8 = undefined;
    const received = try pair.server.read(inbound, &buffer);
    try std.testing.expectEqualStrings("ping", buffer[0..received.len]);
    try std.testing.expect(received.fin);
}

test "engine keeps received data readable until the closed event is drained" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const stream = try pair.server.openStream(handles.server);
    try std.testing.expectEqual(@as(usize, 3), try pair.server.write(stream, "bye", true));
    _ = try pair.transfer(&pair.server, &pair.client, server_address, false);
    _ = pair.server.close(handles.server, 0);
    try pair.pump();

    var storage: [8]Event = undefined;
    const events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 2), events.len);
    const inbound = try expectStreamOpened(events[0], handles.client);
    _ = try expectClosed(events[1], handles.client, .outbound, &pair.server_ctx);

    var buffer: [16]u8 = undefined;
    const final = try pair.client.read(inbound, &buffer);
    try std.testing.expectEqualStrings("bye", buffer[0..final.len]);
    try std.testing.expect(final.fin);

    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.client, &storage).len);
    try std.testing.expectError(error.StaleHandle, pair.client.read(inbound, &buffer));
}

test "engine reports stream events one at a time when the slice is full" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const first = try pair.client.openStream(handles.client);
    _ = try pair.client.write(first, "one", false);
    const second = try pair.client.openStream(handles.client);
    _ = try pair.client.write(second, "two", false);
    try pair.pump();

    var storage: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&storage));
    _ = try expectStreamOpened(storage[0], handles.server);
    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&storage));
    _ = try expectStreamOpened(storage[0], handles.server);
    try std.testing.expectEqual(@as(usize, 0), pair.server.pollEvents(&storage));
}

test "engine reports pending events that did not fit the slice" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);

    const first = try pair.client.openStream(handles.client);
    _ = try pair.client.write(first, "one", false);
    const second = try pair.client.openStream(handles.client);
    _ = try pair.client.write(second, "two", false);
    try pair.pump();

    try std.testing.expect(pair.server.eventsPending());
    var storage: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&storage));
    try std.testing.expect(pair.server.eventsPending());
    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&storage));
    try std.testing.expect(!pair.server.eventsPending());
    try std.testing.expectEqual(@as(usize, 0), pair.server.pollEvents(&storage));
}

test "engine read shutdown consumes readiness while the write half stays open" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);
    const stream = try pair.client.openStream(handles.client);
    _ = try pair.client.write(stream, "payload", false);
    try pair.pump();
    var events: [8]Event = undefined;
    const inbound = try expectStreamOpened(pair.events(&pair.server, &events)[0], handles.server);
    var prefix: [2]u8 = undefined;
    try std.testing.expectEqual(@as(usize, 2), (try pair.server.read(inbound, &prefix)).len);
    try std.testing.expect(pair.server.streamWaits(inbound).?.read_open);
    pair.server.shutdown(inbound, .read, 7);
    try std.testing.expect(!pair.server.streamWaits(inbound).?.read_open);
    try std.testing.expectEqual(@as(usize, 5), try pair.server.write(inbound, "reply", true));
    try pair.pump();
    var buffer: [8]u8 = undefined;
    const response = try pair.client.read(stream, &buffer);
    try std.testing.expectEqualStrings("reply", buffer[0..response.len]);
    try std.testing.expect(response.fin);
}

test "engine immediate host close before advancement preserves peer stream claims" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);
    const stream = try pair.client.openStream(handles.client);
    _ = try pair.client.write(stream, "last", true);
    _ = try pair.transfer(&pair.client, &pair.server, client_address, false);
    try std.testing.expect(pair.server.close(handles.server, 0));
    pair.settle(&pair.server);
    var storage: [8]Event = undefined;
    const events = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), events.len);
    const inbound = try expectStreamOpened(events[0], handles.server);
    try pair.pump();
    const closed = pair.events(&pair.server, &storage);
    try std.testing.expectEqual(@as(usize, 1), closed.len);
    try std.testing.expectEqual(Engine.CloseReason.host, try expectClosed(closed[0], handles.server, .inbound, &pair.client_ctx));
    var buffer: [8]u8 = undefined;
    const read = try pair.server.read(inbound, &buffer);
    try std.testing.expectEqualStrings("last", buffer[0..read.len]);
    try std.testing.expect(read.fin);
}

// Bypass Slot for the peer FIN exchange to model a native stream collected before its table
// entry. Each public operation must retire the routed wrapper without a second notification.
test "engine normalizes missing native streams on read write and capacity" {
    for (0..3) |operation| {
        var pair: Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        const handles = try connectPair(&pair);
        const stream = try pair.client.openStream(handles.client);
        _ = try pair.client.write(stream, "x", true);
        try pair.pump();
        var storage: [8]Event = undefined;
        const inbound = try expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
        var buffer: [8]u8 = undefined;
        _ = try pair.server.read(inbound, &buffer);
        _ = try pair.server.write(inbound, "y", true);
        try pair.pump();
        const native = pair.client.registry.slots[handles.client.index].conn.?;
        var fin = false;
        var code: u64 = 0;
        try std.testing.expectEqual(@as(isize, 1), binding.c.quiche_conn_stream_recv(native, stream.id, &buffer, buffer.len, &fin, &code));
        try std.testing.expect(fin);
        try pair.client.bindStream(stream, .{ .owner = .reqresp_outbound, .row = 3 });
        switch (operation) {
            0 => try std.testing.expectError(error.UnknownStream, pair.client.read(stream, &buffer)),
            1 => try std.testing.expectError(error.UnknownStream, pair.client.write(stream, "z", false)),
            2 => try std.testing.expectError(error.UnknownStream, pair.client.streamCapacity(stream)),
            else => unreachable,
        }
        try std.testing.expect(!pair.client.eventsPending());
        const events = pair.events(&pair.client, &storage);
        try std.testing.expectEqual(@as(usize, 0), events.len);
        try std.testing.expect(pair.client.route(stream) == null);
        const replacement = try pair.client.openStream(handles.client);
        try std.testing.expectEqual(stream.slot, replacement.slot);
        try std.testing.expect(replacement.id != stream.id);
        try std.testing.expectError(error.UnknownStream, pair.client.read(stream, &buffer));
    }
}

test "engine capacity on a reported closed connection leaves it retirable" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);
    const stream = try pair.client.openStream(handles.client);
    _ = try pair.client.write(stream, "x", false);
    try pair.pump();
    var storage: [16]Event = undefined;
    const inbound = try expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    // The peer's STOP reaches the client before the client closes the connection.
    pair.server.shutdown(inbound, .read, 9);
    try pair.pump();
    _ = pair.client.close(handles.client, 7);
    try pair.pump();
    var reported = false;
    for (0..8) |_| {
        for (pair.events(&pair.client, &storage)) |event| if (event == .closed) {
            reported = true;
        };
        if (reported) break;
        pair.advance(100);
        try pair.pump();
    }
    try std.testing.expect(reported);
    const slot = &pair.client.registry.slots[handles.client.index];
    try std.testing.expect(slot.state == .closed and slot.close_event == .reported and !slot.hasEvents());
    try std.testing.expectError(error.StreamStopped, pair.client.streamCapacity(stream));
    try std.testing.expect(!slot.hasEvents());
    pair.client.releaseReported();
    try std.testing.expect(slot.state == .free);
}

test "engine blocked write marks the connection dirty after a flush" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try connectPair(&pair);
    const stream = try pair.client.openStream(handles.client);
    var payload: [bulk_length]u8 = undefined;
    for (&payload, 0..) |*byte, index| byte.* = @truncate(index *% 31 +% 5);
    var attempts: usize = 0;
    while (attempts < 64) : (attempts += 1) {
        _ = pair.client.write(stream, &payload, false) catch |err| switch (err) {
            error.WouldBlock => break,
            else => return err,
        };
    }
    try std.testing.expect(attempts < 64);
    try pair.flush(&pair.client);
    try std.testing.expect(pair.client.nextDirty() == null);

    try std.testing.expectError(error.WouldBlock, pair.client.write(stream, &payload, false));
    try std.testing.expect(pair.client.nextDirty() != null);
}

test "engine write on a stopped stream marks the connection dirty when the window is exhausted" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    binding.c.quiche_config_set_initial_max_data(pair.server.config.ptr, 16 * 1024);
    const handles = try connectPair(&pair);
    const stopped = try pair.client.openStream(handles.client);
    var payload: [bulk_length]u8 = @splat(0x61);
    try std.testing.expectEqual(@as(usize, 16), try pair.client.write(stopped, payload[0..16], false));
    try pair.pump();
    var storage: [8]Event = undefined;
    const inbound = try expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    // Deliver the STOP_SENDING without advancing the client, so the engine has not yet recorded
    // the stop and the write reaches quiche.
    pair.server.shutdown(inbound, .read, 7);
    try pair.flush(&pair.server);

    const filler = try pair.client.openStream(handles.client);
    var attempts: usize = 0;
    while (attempts < 64) : (attempts += 1) {
        _ = pair.client.write(filler, &payload, false) catch |err| switch (err) {
            error.WouldBlock => break,
            else => return err,
        };
    }
    try std.testing.expect(attempts < 64);
    try pair.flush(&pair.client);
    try std.testing.expect(pair.client.nextDirty() == null);

    try std.testing.expectError(error.StreamStopped, pair.client.write(stopped, payload[0..1], true));
    try std.testing.expect(pair.client.nextDirty() != null);
}

test "engine capacity on a stopped complete stream marks the connection dirty" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    binding.c.quiche_config_set_initial_max_streams_bidi(pair.server.config.ptr, 1);
    const handles = try connectPair(&pair);
    const stream = try pair.client.openStream(handles.client);
    try std.testing.expectEqual(@as(usize, 16), try pair.client.write(stream, "0123456789abcdef", true));
    try pair.pump();
    var storage: [8]Event = undefined;
    const inbound = try expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    var scratch: [64]u8 = undefined;
    var received: usize = 0;
    for (0..8) |_| {
        const read = try pair.server.read(inbound, &scratch);
        received += read.len;
        if (read.fin or read.len == 0) break;
    }
    try std.testing.expectEqual(@as(usize, 16), received);

    // The client stops reading the server's half and acknowledges the resulting reset, all through
    // one-way flushes so the server engine never advances and has not recorded the stop itself.
    pair.client.shutdown(stream, .read, 9);
    try pair.flush(&pair.client);
    try pair.flush(&pair.server);
    try pair.flush(&pair.client);
    try pair.flush(&pair.server);
    try std.testing.expect(pair.server.nextDirty() == null);

    try std.testing.expectError(error.StreamStopped, pair.server.streamCapacity(inbound));
    try std.testing.expect(pair.server.nextDirty() != null);
}
