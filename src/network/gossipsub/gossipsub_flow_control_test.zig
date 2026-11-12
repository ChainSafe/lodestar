const schedule_test_support = @import("../schedule_test_support.zig");
const support = @import("test_support.zig");
const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const Pair = @import("test_pair.zig").Pair;
const test_topic = "/eth2/01020304/beacon_block/ssz_snappy";
const constants = @import("constants.zig");
const snappy = @import("snappy");
const frame_mod = @import("frame.zig");

test "gossipsub legal maximum and above two MiB publish use actual resumable IO" {
    const sizes = [_]usize{ 65536, 2 * 1024 * 1024 + 1, constants.MAX_PAYLOAD_SIZE };
    for (sizes) |size| {
        var setup: Pair = .{};
        try setup.init();
        defer setup.deinit();
        try setup.connectMesh();
        const payload = try std.testing.allocator.alloc(u8, size);
        defer std.testing.allocator.free(payload);
        var rng = std.Random.DefaultPrng.init(42);
        rng.random().bytes(payload);
        const outcome = try setup.shared.client.gossipsub.publish(test_topic, payload, setup.shared.pair.now);
        try std.testing.expectEqual(@as(u16, 1), outcome.queued);
        try std.testing.expectEqual(@as(u16, 0), outcome.pressured);
        var received = false;
        for (0..2000) |_| {
            try setup.pumpOnce();
            for (setup.serverMessages()) |message| {
                try std.testing.expectEqualSlices(u8, payload, message.bytes);
                try std.testing.expectEqual(Gossipsub.ReportOutcome{ .applied = .accept }, setup.shared.server.gossipsub.report(message.handle, .accept, setup.shared.pair.now));
                received = true;
            }
            if (received) break;
        }
        try std.testing.expect(received);
        try std.testing.expectEqual(setup.shared.server.gossipsub.sessions.receive_pool.next.len, setup.shared.server.gossipsub.sessions.receive_pool.free_pages);
    }
}

test "gossipsub readiness behind a partial turn stays queued and is generation checked" {
    var setup: Pair = .{};
    try setup.initOpts(.{
        .random_seed = 1,
    }, .{ .random_seed = 1, .peers_per_pump = 1 });
    defer setup.deinit();
    try setup.connectMesh();
    const g = setup.shared.server.gossipsub;
    const real_peer = g.sessions.find(setup.shared.handles.server).?;
    try std.testing.expect(!g.sessions.rows[real_peer].ready_link.linked);
    // A session added now is ready before the real peer's readable edge arrives.
    _ = support.addPeer(g, .{ .index = 77, .generation = 9 }, .v1_2).?;
    const pb = @import("protobuf.zig");
    var compressed: [128]u8 = undefined;
    const n = try snappy.raw.compress("arrived behind a ready session", &compressed);
    var body: [256]u8 = undefined;
    var w = pb.Writer.init(&body);
    pb.writeMessage(&w, compressed[0..n], test_topic);
    var frame: [258]u8 = undefined;
    const wire = frame_mod.writeFrame(&frame, w.written());
    try std.testing.expectEqual(wire.len, try setup.shared.pair.client.write(setup.clientStream(), wire, false));
    try setup.shared.pair.pump();
    setup.forwardServer();
    try std.testing.expect(g.sessions.rows[real_peer].ready_link.linked);
    try std.testing.expectEqual(@as(usize, 0), support.pump(g, &setup.shared.pair.server, setup.shared.pair.now));
    try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(g.schedule(), setup.shared.pair.now.millis()));
    try std.testing.expectEqual(@as(usize, 1), support.pump(g, &setup.shared.pair.server, setup.shared.pair.now));
    try std.testing.expectEqualStrings("arrived behind a ready session", setup.serverMessages()[0].bytes);
    for (0..8) |_| {
        if (support.sessionWakeup(g, setup.shared.pair.now) > setup.shared.pair.now.millis()) break;
        _ = support.pump(g, &setup.shared.pair.server, setup.shared.pair.now);
    }
    try std.testing.expect(!g.sessions.rows[real_peer].io.rx_ready);
    // An event for the same stream id on a previous connection generation is dropped.
    var stale = g.sessions.rows[real_peer].in_stream.?;
    stale.conn.generation += 1;
    g.streamReady(&setup.shared.pair.server, .{ .owner = .gossip_inbound, .row = real_peer }, stale, .{ .readable = true });
    try std.testing.expect(!g.sessions.rows[real_peer].io.rx_ready);
    try std.testing.expect(support.sessionWakeup(g, setup.shared.pair.now) > setup.shared.pair.now.millis());
}

test "gossipsub native write credit behind a ready session resumes and blocked writes quiesce" {
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1, .peers_per_pump = 1 }, .{
        .random_seed = 1,
    });
    defer setup.deinit();
    try setup.connectMesh();
    const g = setup.shared.client.gossipsub;
    const index = g.sessions.find(setup.shared.handles.client).?;
    const payload = try std.testing.allocator.alloc(u8, constants.MAX_PAYLOAD_SIZE);
    defer std.testing.allocator.free(payload);
    var rng = std.Random.DefaultPrng.init(112);
    rng.random().bytes(payload);
    _ = try g.publish(test_topic, payload, setup.shared.pair.now);
    for (0..512) |_| {
        setup.forwardClient();
        if (support.sessionWakeup(g, setup.shared.pair.now) > setup.shared.pair.now.millis()) break;
        _ = support.pump(g, &setup.shared.pair.client, setup.shared.pair.now);
        try setup.shared.pair.pump();
    }
    const io = &g.sessions.rows[index].io;
    try std.testing.expect(io.tx.data.count > 0);
    try std.testing.expect(!io.tx.ready);
    try std.testing.expect(io.tx.blocked_since != null);
    try std.testing.expect(support.sessionWakeup(g, setup.shared.pair.now) > setup.shared.pair.now.millis());
    const before = io.tx.active.data.sent();
    // A session added now is ready ahead of the writable edge the server's reads will grant.
    _ = support.addPeer(g, .{ .index = 77, .generation = 1 }, .v1_2).?;
    for (0..32) |_| {
        setup.forwardServer();
        _ = support.pump(setup.shared.server.gossipsub, &setup.shared.pair.server, setup.shared.pair.now);
        try setup.shared.pair.pump();
    }
    setup.forwardClient();
    try std.testing.expect(io.tx.ready and g.sessions.rows[index].ready_link.linked);
    _ = support.pump(g, &setup.shared.pair.client, setup.shared.pair.now);
    try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(g.schedule(), setup.shared.pair.now.millis()));
    _ = support.pump(g, &setup.shared.pair.client, setup.shared.pair.now);
    try std.testing.expect(io.tx.active.data.sent() > before);
    g.connectionClosed(setup.shared.handles.client);
    try std.testing.expectEqual(@as(usize, 0), io.tx.data.count);
}
