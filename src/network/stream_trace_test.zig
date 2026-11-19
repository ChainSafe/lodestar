const std = @import("std");
const trace = @import("stream_trace.zig");
const t = @import("types.zig");
const PeerId = @import("wire/peer_id.zig").PeerId;
const a = std.testing.allocator;
const conn: t.Handle = .{ .index = 0, .generation = 1 };
const stream: t.StreamHandle = .{ .conn = conn, .id = 0, .slot = 0 };
const peer: PeerId = .{ .bytes = @splat(1) };
const address: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9000 } };

test "stream capture owns bytes and preserves negotiation leftovers in both directions" {
    var capture = try trace.Capture.init(a, std.testing.io, 1);
    defer capture.deinit(a);
    capture.connected(conn, &peer, address, address, .outbound);
    capture.data(stream, .outbound, "negotiation");
    capture.selected(stream, .identify, .outbound, "prefix");
    var bytes = [_]u8{ 1, 2, 3 };
    capture.data(stream, .inbound, &bytes);
    @memset(&bytes, 9);
    capture.data(stream, .outbound, "response");
    capture.streamClosed(stream, false);
    const batch = capture.drain();
    try std.testing.expect(!batch.reset and !batch.pending);
    try std.testing.expectEqual(@as(usize, 6), batch.events.len);
    try std.testing.expectEqualSlices(u8, "prefix\x01\x02\x03response", batch.data);
    try std.testing.expectEqual(false, batch.events[5].payload.stream_closed.reset);
    try std.testing.expectEqual(@as(usize, 0), capture.drain().events.len);
}

test "stream capture overflow pauses bytes and snapshots live metadata before resuming" {
    var capture = try trace.Capture.init(a, std.testing.io, 1);
    defer capture.deinit(a);
    capture.connected(conn, &peer, address, address, .inbound);
    capture.selected(stream, .identify, .inbound, "");
    const chunk = try a.alloc(u8, trace.chunk_max);
    defer a.free(chunk);
    @memset(chunk, 7);
    for (0..258) |_| capture.data(stream, .inbound, chunk);
    const snapshot = capture.drain();
    try std.testing.expect(snapshot.reset);
    try std.testing.expectEqual(@as(usize, 2), snapshot.events.len);
    try std.testing.expectEqual(@as(u64, 258 * trace.chunk_max), snapshot.dropped_bytes);
    try std.testing.expectEqual(@as(usize, 0), snapshot.data.len);
    const alias = snapshot.events[1].payload.stream.id;
    capture.data(stream, .outbound, "after");
    const batch = capture.drain();
    try std.testing.expect(!batch.reset);
    try std.testing.expectEqual(alias, batch.events[0].payload.data.stream);
    try std.testing.expectEqualSlices(u8, "after", batch.data);
    capture.invalidate(batch.data.len);
    try std.testing.expectEqual(@as(u64, 258 * trace.chunk_max + 5), capture.drain().dropped_bytes);
}

test "stream capture disconnect and reuse cannot attribute old handles to new streams" {
    var capture = try trace.Capture.init(a, std.testing.io, 1);
    defer capture.deinit(a);
    capture.connected(conn, &peer, address, address, .inbound);
    capture.selected(stream, .identify, .inbound, "");
    const first = capture.drain().events[1].payload.stream.id;
    capture.disconnected(conn);
    const next: t.Handle = .{ .index = 0, .generation = 2 };
    const next_stream: t.StreamHandle = .{ .conn = next, .id = 0, .slot = 0 };
    capture.connected(next, &peer, address, address, .outbound);
    capture.selected(next_stream, .identify, .outbound, "");
    capture.data(stream, .inbound, "stale");
    capture.streamClosed(stream, true);
    capture.invalidate(0);
    const batch = capture.drain();
    try std.testing.expectEqual(@as(usize, 2), batch.events.len);
    try std.testing.expect(batch.events[1].payload.stream.id > first);
}

test "stream capture wraps byte storage and recovers from metadata overflow" {
    var capture = try trace.Capture.init(a, std.testing.io, 1);
    defer capture.deinit(a);
    capture.connected(conn, &peer, address, address, .outbound);
    capture.selected(stream, .identify, .outbound, "");
    var bytes: [trace.chunk_max - 3]u8 = undefined;
    for (&bytes, 0..) |*byte, i| byte.* = @truncate(i);
    for (0..513) |_| {
        capture.data(stream, .outbound, &bytes);
        const batch = capture.drain();
        try std.testing.expect(!batch.reset and !batch.pending);
        try std.testing.expectEqualSlices(u8, &bytes, batch.data);
    }
    for (0..capture.events.len + 1) |_| capture.pathChanged(conn, address, address);
    capture.streamClosed(stream, false);
    const snapshot = capture.drain();
    try std.testing.expect(snapshot.reset and !snapshot.pending);
    try std.testing.expectEqual(@as(usize, 1), snapshot.events.len);
    try std.testing.expect(snapshot.events[0].payload == .connection);
    try std.testing.expectEqual(@as(u64, 0), snapshot.dropped_bytes);
}

test "stream capture shares peer aliases and closes streams before their connection" {
    var capture = try trace.Capture.init(a, std.testing.io, 2);
    defer capture.deinit(a);
    const other: t.Handle = .{ .index = 1, .generation = 1 };
    capture.connected(conn, &peer, address, address, .inbound);
    capture.connected(other, &peer, address, address, .outbound);
    capture.selected(stream, .identify, .inbound, "");
    try std.testing.expect(capture.ready.isSet());
    const opened = capture.drain();
    try std.testing.expect(!capture.ready.isSet());
    try std.testing.expectEqual(opened.events[0].payload.connection.peer_alias, opened.events[1].payload.connection.peer_alias);
    const alias = opened.events[2].payload.stream.id;
    capture.disconnected(conn);
    const closed = capture.drain();
    try std.testing.expectEqual(@as(usize, 2), closed.events.len);
    try std.testing.expectEqual(alias, closed.events[0].payload.stream_closed.stream);
    try std.testing.expect(closed.events[0].payload.stream_closed.reset);
    try std.testing.expect(closed.events[1].payload == .connection_closed);
}

test "stream capture shutdown closes live metadata and remains drainable" {
    var capture = try trace.Capture.init(a, std.testing.io, 1);
    defer capture.deinit(a);
    capture.connected(conn, &peer, address, address, .inbound);
    capture.selected(stream, .identify, .inbound, "final");
    capture.close();
    const batch = capture.drain();
    try std.testing.expectEqualSlices(u8, "final", batch.data);
    try std.testing.expectEqual(@as(usize, 5), batch.events.len);
    try std.testing.expect(batch.events[3].payload == .stream_closed);
    try std.testing.expect(batch.events[4].payload == .connection_closed);
    capture.close();
    try std.testing.expectEqual(@as(usize, 0), capture.drain().events.len);
}
