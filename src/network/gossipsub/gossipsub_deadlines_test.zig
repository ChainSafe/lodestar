const support = @import("test_support.zig");
const std = @import("std");
const Pair = @import("test_pair.zig").Pair;
const Gossipsub = @import("Gossipsub.zig");
const test_topic = "/eth2/01020304/beacon_block/ssz_snappy";
const protobuf = @import("protobuf.zig");
const TimeoutReason = @import("peer_io.zig").TimeoutReason;
const receive_pool = @import("receive_pool.zig");
const time = @import("../time.zig");
const frame_mod = @import("frame.zig");

test "gossipsub large frame deadline releases receive pages despite byte progress" {
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1, .output_per_peer = 1, .tx_timeout_ms = 500 }, .{ .random_seed = 1, .body_buffer_bytes = 64, .large_frame_timeout_ms = 150, .pressure_timeout_ms = 500 });
    defer setup.deinit();
    for (0..16) |_| try setup.pumpOnce();
    const server_peer = setup.shared.server.gossipsub.sessions.find(setup.shared.handles.server).?;
    var prefix: [128]u8 = undefined;
    var w = protobuf.Writer.init(&prefix);
    w.varint(65536);
    w.bytes(&([_]u8{'x'} ** 65));
    try std.testing.expectEqual(w.len, try setup.shared.pair.client.write(setup.clientStream(), w.written(), false));
    for (0..4) |_| try setup.pumpOnce();
    try std.testing.expect(setup.shared.server.gossipsub.sessions.rows[server_peer].io.reader.declaredLen() != null);
    try std.testing.expectEqual(@as(u32, 1), setup.shared.server.gossipsub.sessions.rows[server_peer].io.overflow.pages);
    const began = setup.shared.pair.now.millis();
    for (0..1) |_| {
        setup.shared.pair.advance(100);
        try std.testing.expectEqual(@as(usize, 1), try setup.shared.pair.client.write(setup.clientStream(), "x", false));
        try setup.pumpOnce();
        try std.testing.expect(setup.shared.server.gossipsub.sessions.rows[server_peer].io.reader.declaredLen() != null);
        try std.testing.expect(setup.shared.server.gossipsub.sessions.rows[server_peer].io.progress_ms > began);
    }
    setup.shared.pair.advance(100);
    try setup.pumpOnce();
    try std.testing.expect(setup.shared.server.gossipsub.sessions.rows[server_peer].io.overflow.pages == 0);
    const logical = setup.shared.server.gossipsub.sessions.rows[server_peer].logical;
    try std.testing.expect(setup.shared.server.gossipsub.peers.rows[logical.index].large_frame_denied_until > setup.shared.pair.now.millis());
    try std.testing.expectEqual(@as(u64, 1), setup.shared.server.gossipsub.counters.receive_discards[@intFromEnum(Gossipsub.ReceiveDiscard.timeout)]);
    setup.shared.pair.advance(300);
    try setup.pumpOnce();
    try std.testing.expectEqual(@as(usize, 0), setup.shared.server.gossipsub.receiveTimeouts().len);
}

test "gossipsub completed frame expiry releases pages without blaming the peer" {
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1 }, .{
        .random_seed = 1,
        .body_buffer_bytes = 64,
        .items_per_peer = 1,
        .large_frame_timeout_ms = 50,
        .pressure_timeout_ms = 100,
    });
    defer setup.deinit();
    try setup.connectMesh();
    const g = setup.shared.server.gossipsub;
    const index = g.sessions.find(setup.shared.handles.server).?;
    const peer = &g.sessions.rows[index];
    const before = g.peers.score(peer.logical, setup.shared.pair.now.millis());
    var body: [256]u8 = undefined;
    var writer = protobuf.Writer.init(&body);
    protobuf.writeSubscription(&writer, true, test_topic);
    protobuf.writeSubscription(&writer, false, test_topic);
    var frame: [260]u8 = undefined;
    const wire = frame_mod.writeFrame(&frame, writer.written());
    try std.testing.expectEqual(wire.len, try setup.shared.pair.client.write(setup.clientStream(), wire, false));
    for (0..16) |_| {
        try setup.pumpOnce();
        if (peer.io.rpc != null) break;
    }
    try std.testing.expect(peer.io.rpc != null);
    try std.testing.expectEqual(@as(u32, 1), peer.io.overflow.pages);
    const began = peer.io.frame_since.?;
    try std.testing.expectEqual(@as(?u64, began + 100), peer.io.deadlines(&g.options).values[@intFromEnum(TimeoutReason.receive_frame)]);
    try g.recovery.add(&g.peers, @splat(1), peer.logical, peer.conn, 1, began + 1000);
    setup.shared.pair.advance(100);
    try setup.pumpOnce();
    try std.testing.expectEqual(@as(u64, 0), g.counters.local_pressure_resets);
    try std.testing.expect(peer.io.rpc == null);
    try std.testing.expectEqual(@as(usize, 0), g.recovery.len);
    try std.testing.expectEqual(@as(u64, 0), g.counters.broken_promises);
    try std.testing.expectEqual(before, g.peers.score(peer.logical, setup.shared.pair.now.millis()));
    try std.testing.expectEqual(@as(u64, 0), g.peers.rows[peer.logical.index].large_frame_denied_until);
    try std.testing.expectEqual(g.sessions.receive_pool.next.len, g.sessions.receive_pool.free_pages);
    try std.testing.expect(peer.in_stream != null and peer.outStream() != null);
}

test "gossipsub healthy continuous frame turnover does not expire a nonempty queue" {
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1, .calls_per_peer = 1, .tx_timeout_ms = 500 }, .{
        .random_seed = 1,
    });
    defer setup.deinit();
    try setup.connectMesh();
    const index = setup.shared.client.gossipsub.sessions.find(setup.shared.handles.client).?;
    var bytes: [8]u8 = undefined;
    std.mem.writeInt(u64, &bytes, 0, .little);
    _ = try setup.shared.client.gossipsub.publish(test_topic, &bytes, setup.shared.pair.now);
    std.mem.writeInt(u64, &bytes, 1, .little);
    _ = try setup.shared.client.gossipsub.publish(test_topic, &bytes, setup.shared.pair.now);
    const began = setup.shared.pair.now.millis();
    for (2..34) |i| {
        try setup.pumpOnce();
        try std.testing.expect(setup.shared.client.gossipsub.sessions.rows[index].io.tx.pending());
        try std.testing.expect(setup.shared.client.gossipsub.sessions.rows[index].io.tx.data.count > 0);
        setup.shared.pair.advance(25);
        std.mem.writeInt(u64, &bytes, i, .little);
        const result = try setup.shared.client.gossipsub.publish(test_topic, &bytes, setup.shared.pair.now);
        try std.testing.expectEqual(@as(u16, 1), result.queued);
    }
    try std.testing.expect(setup.shared.pair.now.millis() - began > 500);
    try std.testing.expect(setup.shared.client.gossipsub.sessions.outStream(index) != null);
}

test "gossipsub discarding a locally refused frame preserves its deadline without blaming the peer" {
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1 }, .{ .random_seed = 1, .body_buffer_bytes = 1024, .receive_arena_bytes = 16 * 1024 * 1024, .large_frame_timeout_ms = 200 });
    defer setup.deinit();
    try setup.connectMesh();
    const g = setup.shared.server.gossipsub;
    var held: [3]receive_pool.Chain = @splat(.{});
    defer for (&held) |*chain| g.sessions.receive_pool.release(chain);
    for (0..g.sessions.receive_pool.next.len) |i| {
        const chain = &held[i % held.len];
        _ = g.sessions.receive_pool.writable(chain).?;
        chain.len += receive_pool.page_bytes;
    }
    const index = g.sessions.find(setup.shared.handles.server).?;
    const peer = &g.sessions.rows[index];
    const before = g.peers.score(peer.logical, setup.shared.pair.now.millis());
    var wire: [65540]u8 = undefined;
    const body: [65536]u8 = @splat(0);
    _ = frame_mod.writeFrame(&wire, &body);
    try std.testing.expectEqual(@as(usize, 2048), try setup.shared.pair.client.write(setup.clientStream(), wire[0..2048], false));
    for (0..16) |_| {
        try setup.pumpOnce();
        if (peer.io.discarding) break;
    }
    try std.testing.expect(peer.io.discarding);
    const began = peer.io.frame_since.?;
    setup.shared.pair.now.monotonic = time.milliseconds(began + 199);
    try setup.pumpOnce();
    try std.testing.expect(peer.in_stream != null);
    setup.shared.pair.advance(1);
    try setup.pumpOnce();
    try std.testing.expect(peer.in_stream == null);
    try std.testing.expectEqual(@as(u64, 1), g.counters.local_pressure_resets);
    try std.testing.expectEqual(before, g.peers.score(peer.logical, setup.shared.pair.now.millis()));
    try std.testing.expectEqual(@as(u64, 0), g.peers.rows[peer.logical.index].large_frame_denied_until);
    for (g.peers.scores.penalties) |count| try std.testing.expectEqual(@as(u64, 0), count);
}

test "gossipsub receive expiry with buffered or transport unread bytes has no peer consequence" {
    for ([_]bool{ false, true }) |buffered| {
        var setup: Pair = .{};
        try setup.initOpts(.{ .random_seed = 1 }, .{ .random_seed = 1, .body_buffer_bytes = 64, .large_frame_timeout_ms = 100 });
        defer setup.deinit();
        try setup.connectMesh();
        const g = setup.shared.server.gossipsub;
        const index = g.sessions.find(setup.shared.handles.server).?;
        const peer = &g.sessions.rows[index];
        var prefix: [128]u8 = undefined;
        var writer = protobuf.Writer.init(&prefix);
        writer.varint(65536);
        writer.bytes(&([_]u8{0} ** 65));
        try std.testing.expectEqual(writer.len, try setup.shared.pair.client.write(setup.clientStream(), writer.written(), false));
        for (0..4) |_| try setup.pumpOnce();
        try std.testing.expectEqual(@as(u32, 1), peer.io.overflow.pages);
        if (buffered) {
            peer.io.unread_start = 0;
            peer.io.unread_end = 1;
            peer.io.unread[0] = 0;
        } else {
            try std.testing.expectEqual(@as(usize, 1), try setup.shared.pair.client.write(setup.clientStream(), "x", false));
            try setup.shared.pair.pump();
            try std.testing.expect(try setup.shared.pair.server.streamReadable(peer.in_stream.?));
        }
        setup.shared.pair.advance(100);
        try setup.pumpOnce();
        try std.testing.expectEqual(@as(usize, 0), g.receiveTimeouts().len);
        try std.testing.expectEqual(@as(u64, 1), g.counters.receive_discards[@intFromEnum(Gossipsub.ReceiveDiscard.unattributed_timeout)]);
        try std.testing.expectEqual(@as(u64, 0), g.peers.rows[peer.logical.index].large_frame_denied_until);
        for (g.peers.scores.penalties) |count| try std.testing.expectEqual(@as(u64, 0), count);
        try std.testing.expectEqual(g.sessions.receive_pool.next.len, g.sessions.receive_pool.free_pages);
    }
}
