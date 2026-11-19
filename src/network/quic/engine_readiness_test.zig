const std = @import("std");
const binding = @import("binding.zig");
const constants = @import("../constants.zig");
const Engine = @import("Engine.zig");
const support = @import("test_support.zig");

const Event = Engine.Event;
const Pair = support.Pair;

fn drainEvents(pair: *Pair, engine: *Engine) usize {
    var storage: [64]Event = undefined;
    var total: usize = 0;
    for (0..16) |_| {
        const polled = pair.events(engine, &storage).len;
        total += polled;
        if (polled == 0) break;
    }
    return total;
}

test "engine idle connections cost no timer, advance or flush visits" {
    var pair: Pair = .{};
    try pair.init(.{}, .{ .handshaking_per_prefix_max = 32, .handshaking_per_source_max = 32 });
    defer pair.deinit();
    for (0..32) |_| _ = try pair.dial();
    try pair.pump();
    _ = drainEvents(&pair, &pair.client);
    _ = drainEvents(&pair, &pair.server);
    try std.testing.expectEqual(@as(usize, 32), pair.client.registry.activeIndices().len);
    try std.testing.expectEqual(@as(usize, 32), pair.server.registry.activeIndices().len);
    for (pair.client.registry.activeIndices()) |index| try std.testing.expect(pair.client.registry.slots[index].state == .established);

    const engines = [_]*Engine{ &pair.client, &pair.server };
    var visits: [2]Engine.Visits = undefined;
    for (engines, &visits) |engine, *before| before.* = engine.visits;
    for (0..100) |_| {
        pair.advance(1);
        try pair.pump();
    }
    for (engines, visits) |engine, before| {
        try std.testing.expectEqualDeep(before, engine.visits);
        try std.testing.expect(!engine.backlog());
        try std.testing.expect(!engine.eventsPending());
    }
}

test "engine writable event re-arms only when send capacity grows" {
    var pair: Pair = .{};
    try pair.init(.{}, .{ .keep_alive_ms = 50 });
    defer pair.deinit();
    binding.c.quiche_config_set_initial_max_stream_data_bidi_remote(pair.server.config.ptr, 4096);
    const handles = try support.connectPair(&pair);
    const stream = try pair.client.openStream(handles.client);
    var payload: [8192]u8 = @splat(0x61);
    try std.testing.expectEqual(@as(usize, 4096), try pair.client.write(stream, &payload, false));
    const slot = &pair.client.registry.slots[handles.client.index];
    try std.testing.expect(slot.table.entries[stream.slot].write_lowat > 0);
    try pair.pump();
    try std.testing.expectEqual(@as(usize, 0), countWritable(&pair, stream));

    // A repeated WouldBlock re-dirties the connection, because quiche queues DATA_BLOCKED for
    // every write the connection window cannot fit; this stream-level block has nothing to send.
    try std.testing.expectError(error.WouldBlock, pair.client.write(stream, payload[4096..], false));
    try std.testing.expect(pair.client.backlog());
    var scratch: [constants.datagram_size_max]u8 = undefined;
    try std.testing.expect(pair.client.sendOne(handles.client.index, pair.now, &scratch) == null);
    pair.client.sent(handles.client.index, pair.now, true);
    try std.testing.expect(!pair.client.backlog());

    // A PING and a duplicate of it carry no credit.
    pair.advance(50);
    pair.settle(&pair.server);
    const server_index = handles.server.index;
    var datagram: [constants.datagram_size_max]u8 = undefined;
    var copy: [constants.datagram_size_max]u8 = undefined;
    const ping = pair.server.sendOne(server_index, pair.now, &datagram).?;
    @memcpy(copy[0..ping.bytes.len], ping.bytes);
    try std.testing.expect(pair.server.sendOne(server_index, pair.now, &datagram) == null);
    pair.server.sent(server_index, pair.now, true);
    var response: [constants.datagram_size_max]u8 = undefined;
    for (0..2) |_| {
        var replay: [constants.datagram_size_max]u8 = undefined;
        @memcpy(replay[0..ping.bytes.len], copy[0..ping.bytes.len]);
        _ = pair.client.receive(replay[0..ping.bytes.len], &support.server_address, pair.now, &response);
        pair.settle(&pair.client);
        try std.testing.expectEqual(@as(usize, 0), countWritable(&pair, stream));
    }
    try pair.pump();
    try std.testing.expectEqual(@as(usize, 0), countWritable(&pair, stream));

    // The peer's MAX_STREAM_DATA grants credit and reports the stream once.
    var events: [16]Event = undefined;
    var inbound: ?Engine.StreamHandle = null;
    for (pair.events(&pair.server, &events)) |event| if (event == .stream_opened) {
        inbound = event.stream_opened;
    };
    var sink: [4096]u8 = undefined;
    var consumed: usize = 0;
    for (0..8) |_| {
        const read = try pair.server.read(inbound.?, sink[consumed..]);
        consumed += read.len;
        if (read.len == 0 or consumed == 4096) break;
    }
    try std.testing.expectEqual(@as(usize, 4096), consumed);
    try pair.pump();
    try std.testing.expectEqual(@as(usize, 1), countWritable(&pair, stream));
    try pair.pump();
    try std.testing.expectEqual(@as(usize, 0), countWritable(&pair, stream));

    // Writing past the new credit blocks again and re-arms, queuing the blocked frame.
    const accepted = try pair.client.write(stream, &payload, false);
    try std.testing.expect(accepted > 0 and accepted < payload.len);
    try std.testing.expect(slot.table.entries[stream.slot].write_lowat > 0);
    try std.testing.expect(pair.client.backlog());
}

fn countWritable(pair: *Pair, stream: Engine.StreamHandle) usize {
    var storage: [32]Event = undefined;
    var count: usize = 0;
    for (pair.events(&pair.client, &storage)) |event| switch (event) {
        .stream_ready => |ready| if (std.meta.eql(ready.stream, stream) and ready.ready.writable) {
            count += 1;
        },
        else => {},
    };
    return count;
}

test "engine wakeup is its timer heap top" {
    var pair: Pair = .{};
    try pair.init(.{ .keep_alive_ms = 7_000 }, .{ .handshaking_per_source_max = 8 });
    defer pair.deinit();
    for (0..4) |_| _ = try pair.dial();
    try pair.pump();
    _ = drainEvents(&pair, &pair.client);
    var recomputed: ?u64 = null;
    var keyed: ?u64 = null;
    for (pair.client.registry.activeIndices()) |index| {
        const slot = &pair.client.registry.slots[index];
        var due = (slot.last_send_ms + 7_000) * std.time.ns_per_ms;
        if (slot.timeoutNs()) |remaining| due = @min(due, pair.now.nanos() + remaining);
        recomputed = @min(recomputed orelse due, due);
        const key = pair.client.registry.timers.get(index).?;
        keyed = @min(keyed orelse key, key);
    }
    const top = pair.client.nextDeadlineNs().?;
    try std.testing.expectEqual(keyed.?, top);
    // quiche's own clock moved on since the keys were set, so its timer reads slightly earlier.
    try std.testing.expect(top >= recomputed.?);
    try std.testing.expect(top - recomputed.? <= std.time.ns_per_ms);
}

test "engine events drain connections in arrival order across one-event polls" {
    var pair: Pair = .{};
    try pair.init(.{}, .{ .handshaking_per_source_max = 8 });
    defer pair.deinit();
    const first = try pair.dial();
    try pair.pump();
    const second = try pair.dial();
    try pair.pump();
    var one: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), pair.client.pollEvents(&one));
    try std.testing.expectEqual(first, one[0].connected.conn);
    try std.testing.expectEqual(@as(usize, 1), pair.client.pollEvents(&one));
    try std.testing.expectEqual(second, one[0].connected.conn);
    try std.testing.expectEqual(@as(usize, 0), pair.client.pollEvents(&one));
    try std.testing.expect(!pair.client.eventsPending());
}

test "engine changing a write watermark replaces an unpolled writable edge" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    binding.c.quiche_config_set_initial_max_stream_data_bidi_remote(pair.server.config.ptr, 4096);
    const handles = try support.connectPair(&pair);
    const stream = try pair.client.openStream(handles.client);
    var payload: [16384]u8 = @splat(0x61);
    try std.testing.expectEqual(@as(usize, 4096), try pair.client.write(stream, &payload, false));
    try pair.pump();
    var storage: [8]Event = undefined;
    const inbound = try support.expectStreamOpened(pair.events(&pair.server, &storage)[0], handles.server);
    var sink: [4096]u8 = undefined;
    try std.testing.expectEqual(@as(usize, 4096), (try pair.server.read(inbound, &sink)).len);
    try pair.pump();
    try std.testing.expect(pair.client.eventsPending());
    const available = try pair.client.streamCapacity(stream);
    try std.testing.expect(available > 0 and available + 128 <= payload.len);
    try std.testing.expectEqual(available, try pair.client.write(stream, payload[0 .. available + 128], false));
    // The old edge represented credit just consumed by this write. The new interest must wait.
    try std.testing.expectEqual(@as(usize, 0), countWritable(&pair, stream));
    try pair.pump();
    try std.testing.expectEqual(@as(usize, 0), countWritable(&pair, stream));
    try std.testing.expectError(error.WouldBlock, pair.client.write(stream, payload[0..512], false));
    try std.testing.expectEqual(@as(usize, 0), countWritable(&pair, stream));
}

test "engine advances a received burst and its due timer once" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    binding.c.quiche_config_set_initial_congestion_window_packets(pair.client.config.ptr, 128);
    const handles = try support.connectPair(&pair);
    try pair.pump();
    const stream = try pair.client.openStream(handles.client);
    const payload = [_]u8{0x5a} ** (64 * 1024);
    try std.testing.expectEqual(payload.len, try pair.client.write(stream, &payload, false));

    // Retain a due key while packets change the connection's native timer.
    pair.server.registry.timers.set(handles.server.index, pair.now.nanos());
    const before = pair.server.visits;
    var buffer: [constants.datagram_size_max]u8 = undefined;
    var reply: [constants.datagram_size_max]u8 = undefined;
    for (0..32) |_| {
        const sent = pair.client.sendOne(handles.client.index, pair.now, &buffer) orelse return error.TestUnexpectedResult;
        try std.testing.expectEqual(handles.server, pair.server.receive(sent.bytes, &support.client_address, pair.now, &reply).accepted);
    }
    try std.testing.expectEqualDeep(before, pair.server.visits);
    try std.testing.expectEqual(pair.now.nanos(), pair.server.registry.timers.get(handles.server.index).?);
    pair.server.advance(pair.now);
    try std.testing.expectEqual(before.timer + 1, pair.server.visits.timer);
    try std.testing.expectEqual(before.advance + 1, pair.server.visits.advance);
    try std.testing.expectEqual(before.timeouts, pair.server.visits.timeouts);
    try std.testing.expect(pair.server.nextDeadlineNs().? > pair.now.nanos());

    var events: [8]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), pair.server.pollEvents(&events));
    const inbound = try support.expectStreamOpened(events[0], handles.server);
    var sink: [payload.len]u8 = undefined;
    const read = try pair.server.read(inbound, &sink);
    try std.testing.expect(read.len > 30 * 1024);
    try std.testing.expectEqualSlices(u8, payload[0..read.len], sink[0..read.len]);
}
