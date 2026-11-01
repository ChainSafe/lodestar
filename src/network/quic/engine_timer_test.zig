//! Exercises quiche's internal monotonic clock, which the engine's supplied time cannot advance.
const std = @import("std");
const Engine = @import("Engine.zig");
const support = @import("test_support.zig");

const Event = Engine.Event;
const Pair = support.Pair;
const connectPair = support.connectPair;
const expectClosed = support.expectClosed;

test "engine keep-alive survives a short idle timeout" {
    var pair: Pair = .{};
    try pair.init(.{ .idle_timeout_ms = 1_000, .keep_alive_ms = 200 }, .{ .idle_timeout_ms = 1_000, .keep_alive_ms = 200 });
    defer pair.deinit();
    pair.now = readClock();
    const handles = try connectPair(&pair);

    var round: usize = 0;
    while (round < 8) : (round += 1) {
        try std.Io.sleep(std.testing.io, .fromMilliseconds(200), .awake);
        pair.now = readClock();
        try pair.pump();
    }
    var storage: [8]Event = undefined;
    try std.testing.expectEqual(@as(usize, 0), pair.events(&pair.client, &storage).len);
    try std.testing.expect(pair.client.peerId(handles.client) != null);
}

test "engine reports idle timeout without keep-alive" {
    var pair: Pair = .{};
    try pair.init(.{ .idle_timeout_ms = 600, .keep_alive_ms = 60_000 }, .{ .idle_timeout_ms = 600, .keep_alive_ms = 60_000 });
    defer pair.deinit();
    pair.now = readClock();
    const handles = try connectPair(&pair);

    try std.Io.sleep(std.testing.io, .fromMilliseconds(900), .awake);
    pair.now = readClock();
    try pair.pump();

    var storage: [8]Event = undefined;
    const client_events = pair.events(&pair.client, &storage);
    try std.testing.expectEqual(@as(usize, 1), client_events.len);
    try std.testing.expectEqual(
        Engine.CloseReason.idle_timeout,
        try expectClosed(client_events[0], handles.client, .outbound, &pair.server_ctx),
    );
}

test "engine calls on_timeout only for keys whose quiche timer expired" {
    var pair: Pair = .{};
    try pair.init(.{ .idle_timeout_ms = 300, .keep_alive_ms = 60_000 }, .{ .idle_timeout_ms = 300, .keep_alive_ms = 60_000 });
    defer pair.deinit();
    pair.now = readClock();
    const handles = try support.connectPair(&pair);
    try pair.pump();
    var fired = pair.client.visits.timeouts;
    var closed = false;
    for (0..40) |_| {
        try std.Io.sleep(std.testing.io, .fromMilliseconds(25), .awake);
        pair.now = readClock();
        const top = pair.client.nextDeadlineNs();
        const pops = pair.client.visits.timer;
        pair.settle(&pair.client);
        if (pair.client.visits.timeouts > fired) {
            try std.testing.expect(top.? <= pair.now.nanos());
            try std.testing.expect(pair.client.visits.timer > pops);
            fired = pair.client.visits.timeouts;
        }
        var storage: [8]Event = undefined;
        for (pair.events(&pair.client, &storage)) |event| if (event == .closed) {
            try std.testing.expectEqual(handles.client, event.closed.conn);
            try std.testing.expect(event.closed.reason == .idle_timeout);
            closed = true;
        };
        if (closed) break;
    }
    try std.testing.expect(closed);
    try std.testing.expect(fired >= 1);
    try std.testing.expect(pair.client.visits.timer >= pair.client.visits.timeouts);
}

fn readClock() Engine.Now {
    const ns: u64 = @intCast(std.Io.Clock.awake.now(std.testing.io).nanoseconds);
    return .{ .monotonic = .{ .clock = .awake, .raw = .fromNanoseconds(ns) }, .wall = .{ .clock = .real, .raw = .fromNanoseconds(@as(i96, support.now_unix) * std.time.ns_per_s) } };
}

test "engine timer invariants tolerate time passing after scheduling" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    pair.now = readClock();
    pair.drop_to_server = true;
    _ = try pair.dial();
    try pair.flush(&pair.client);
    const scheduled = pair.client.nextDeadlineNs().?;

    try std.Io.sleep(std.testing.io, .fromMilliseconds(400), .awake);
    pair.client.finishFlush(pair.now);
    try std.testing.expectEqual(scheduled, pair.client.nextDeadlineNs());
}

test "engine native path validation timeout preserves the original path and connection" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    pair.now = readClock();
    const handles = try connectPair(&pair);
    const rebound: Engine.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4_003 } };
    pair.client_source = rebound;
    pair.drop_to_address = rebound;
    const stream = try pair.client.openStream(handles.client);
    const bulk = [_]u8{0x5a} ** 2_000;
    try std.testing.expectEqual(bulk.len, try pair.client.write(stream, &bulk, false));
    try pair.pump();
    try std.testing.expectEqual(@as(isize, 1), (try pathValidation(&pair.server, handles.server, rebound)).?);

    var failed = false;
    var inbound: ?Engine.StreamHandle = null;
    for (0..120) |_| {
        try std.Io.sleep(std.testing.io, .fromMilliseconds(100), .awake);
        pair.now = readClock();
        try pair.pump();
        var events: [8]Event = undefined;
        for (pair.events(&pair.server, &events)) |event| switch (event) {
            .stream_opened => |opened| inbound = opened,
            .path_changed, .closed => return error.TestUnexpectedResult,
            else => {},
        };
        try std.testing.expectEqual(support.client_address, pair.server.peerAddress(handles.server).?);
        // quiche's C ABI represents PathState::Failed as -1.
        if ((try pathValidation(&pair.server, handles.server, rebound)).? == -1) {
            failed = true;
            break;
        }
    }
    try std.testing.expect(failed);
    try std.testing.expect(inbound != null);
    pair.client_source = support.client_address;
    pair.drop_to_address = null;
    var received: [bulk.len]u8 = undefined;
    var count: usize = 0;
    for (0..received.len) |_| {
        if (count == received.len) break;
        const read = try pair.server.read(inbound.?, received[count..]);
        try std.testing.expect(read.len > 0);
        count += read.len;
    }
    try std.testing.expectEqual(received.len, count);
    try std.testing.expectEqualSlices(u8, &bulk, &received);
    try std.testing.expectEqual(@as(usize, 3), try pair.server.write(inbound.?, "bye", false));
    try pair.pump();
    var reply: [3]u8 = undefined;
    const read = try pair.client.read(stream, &reply);
    try std.testing.expectEqualStrings("bye", reply[0..read.len]);
    try std.testing.expectEqual(support.client_address, pair.server.peerAddress(handles.server).?);
    try std.testing.expect(pair.server.peerId(handles.server) != null);
}

fn pathValidation(engine: *const Engine, handle: Engine.Handle, address: Engine.Address) !?isize {
    const binding = @import("binding.zig");
    const conn = engine.registry.slots[handle.index].conn.?;
    for (0..2) |index| {
        var stats: binding.c.quiche_path_stats = undefined;
        if (binding.c.quiche_conn_path_stats(conn, index, &stats) != 0) break;
        const native = binding.SockAddr.fromStorage(&stats.peer_addr, stats.peer_addr_len) orelse return error.TestUnexpectedResult;
        const peer = native.toAddress() orelse return error.TestUnexpectedResult;
        if (peer.eql(address)) return stats.validation_state;
    }
    return null;
}
