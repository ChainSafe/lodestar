const constants = @import("constants.zig");
const std = @import("std");
const schedule_test_support = @import("../schedule_test_support.zig");
const gossip_test = @import("test_support.zig");
const Engine = @import("../quic/Engine.zig");
const Pair = @import("test_pair.zig").Pair;
const topic_mod = @import("topic.zig");
const metrics = @import("metrics.zig");

const topic = "/eth2/6a95a1a9/beacon_block/ssz_snappy";
const heartbeat = @import("constants.zig").heartbeat_interval_ms;

fn connectMesh(setup: *Pair) !void {
    try gossip_test.subscribe(setup.shared.client.gossipsub, topic);
    try gossip_test.subscribe(setup.shared.server.gossipsub, topic);
    for (0..20) |_| try setup.pumpOnce();
    setup.shared.pair.advance(heartbeat + 1);
    for (0..20) |_| try setup.pumpOnce();
}

/// Delivers the client's pending engine events to its service and reports whether any of them
/// was a readiness event routed to the client's gossip session.
fn processClient(setup: *Pair) bool {
    var storage: [64]Engine.Event = undefined;
    const events = setup.shared.pair.events(&setup.shared.pair.client, &storage);
    var routed = false;
    for (events) |event| if (event == .stream_ready) {
        const bound = setup.shared.pair.client.route(event.stream_ready.stream) orelse continue;
        routed = routed or bound.owner == .gossip_inbound or bound.owner == .gossip_outbound;
    };
    _ = setup.shared.client.process(&setup.shared.pair.client, events, setup.shared.pair.now, .{});
    return routed;
}

test "gossip idle mesh of 200 sessions costs no session visits" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    try connectMesh(&setup);
    const g = setup.shared.client.gossipsub;
    const index = g.overlay.findTopic(topic).?;
    // 199 more sessions on connections this engine does not hold. Their subscriptions count as
    // announced, they subscribe to the topic and eight of them graft us.
    for (0..199) |i| {
        const peer = gossip_test.addPeer(g, .{ .index = @intCast(300 + i), .generation = 1 }, .v1_2).?;
        const tx = &g.sessions.rows[peer.index].io.tx;
        tx.subscription_dirty.setRangeValue(.{ .start = 0, .end = tx.subscription_dirty.bit_length }, false);
        tx.subscription_since = null;
        g.settle(peer.index);
        const context = g.overlayContext(setup.shared.pair.now.millis());
        _ = g.overlay.peerSubscription(&context, peer.index, topic, true);
        if (i < 8) g.overlay.onGraft(&context, index, peer.index);
    }
    // One turn takes the sessions marked at admission, which have nothing to do.
    for (0..8) |_| try setup.pumpOnce();
    try std.testing.expectEqual(@as(usize, 200), g.resourceSnapshot().admitted_peers);
    const mesh = g.overlay.mesh(index).count();
    try std.testing.expect(mesh >= 9);
    const visits = g.sessions.visits;
    const writes = g.sessions.writes;
    const cycles = g.cycle.epoch;
    for (0..120) |_| {
        setup.shared.pair.advance(30);
        try setup.pumpOnce();
        try std.testing.expectEqual(@as(usize, 0), g.sessions.ready.len);
        try std.testing.expect(schedule_test_support.wakeupMilliseconds(g.schedule(), setup.shared.pair.now.millis()).? > setup.shared.pair.now.millis());
    }
    try std.testing.expect(g.cycle.epoch - cycles >= 4);
    try std.testing.expectEqual(visits, g.sessions.visits);
    try std.testing.expectEqual(writes, g.sessions.writes);
    try std.testing.expectEqual(mesh, g.overlay.mesh(index).count());
}

test "gossip retries a flow-blocked session only when send capacity grows" {
    var setup: Pair = .{};
    try setup.initWindow(.{ .random_seed = 1, .active_send_timeout_ms = 400 }, .{ .random_seed = 1 }, 4096);
    defer setup.deinit();
    try connectMesh(&setup);
    const g = setup.shared.client.gossipsub;
    const index = g.sessions.find(setup.shared.handles.client).?;
    const io = &g.sessions.rows[index].io;
    var payload: [48 * 1024]u8 = undefined;
    var random = std.Random.DefaultPrng.init(7);
    random.random().bytes(&payload);
    try std.testing.expectEqual(@as(u16, 1), (try g.publish(topic, &payload, setup.shared.pair.now)).queued);

    // The publish is written in the turn that follows it, until the server's credit runs out.
    const writes = g.sessions.writes;
    _ = processClient(&setup);
    try std.testing.expect(g.sessions.writes > writes);
    try std.testing.expect(!io.tx.ready and io.tx.pending());
    try std.testing.expect(!g.sessions.rows[index].ready_link.linked);

    // The server does not read. Each round the client sends one byte on a stream of its own and
    // the server acknowledges it: ACKs without credit wake no session and retry no write.
    const probe = try setup.shared.pair.client.openStream(setup.shared.handles.client);
    const visits = g.sessions.visits;
    const blocked = g.sessions.blocked_writes;
    const attempts = g.sessions.writes;
    const received = setup.shared.pair.client_accepted;
    for (0..100) |_| {
        try std.testing.expectEqual(@as(usize, 1), try setup.shared.pair.client.write(probe, "x", false));
        try setup.shared.pair.pump();
        try std.testing.expect(!processClient(&setup));
        try std.testing.expect(gossip_test.sessionWakeup(g, setup.shared.pair.now) > setup.shared.pair.now.millis());
    }
    try std.testing.expect(setup.shared.pair.client_accepted - received >= 100);
    try std.testing.expectEqual(visits, g.sessions.visits);
    try std.testing.expectEqual(blocked, g.sessions.blocked_writes);
    try std.testing.expectEqual(attempts, g.sessions.writes);

    // The server reads, and its credit arrives as writable events. A turn visits the session
    // exactly when an event reached it, and each visit writes into the new credit.
    var rounds: usize = 0;
    var woken: usize = 0;
    while (io.tx.data.count > 0 and rounds < 256) : (rounds += 1) {
        _ = setup.shared.processServer(.{});
        try setup.shared.pair.pump();
        const before = g.sessions.visits;
        const calls = g.sessions.writes;
        const routed = processClient(&setup);
        try std.testing.expectEqual(@as(u64, @intFromBool(routed)), g.sessions.visits - before);
        if (routed) {
            woken += 1;
            try std.testing.expect(g.sessions.writes > calls);
        } else try std.testing.expectEqual(calls, g.sessions.writes);
        try setup.shared.pair.pump();
    }
    try std.testing.expectEqual(@as(usize, 0), io.tx.data.count);
    try std.testing.expect(woken > 1);
    try std.testing.expect(g.sessions.rows[index].outStream() != null);

    // A blocked stream that never gains credit fails at its active-send deadline, popped from
    // the heap on the first turn at or after it.
    try std.testing.expectEqual(@as(u16, 1), (try g.publish(topic, payload[0 .. 32 * 1024], setup.shared.pair.now)).queued);
    _ = processClient(&setup);
    try std.testing.expect(!io.tx.ready and io.tx.pending());
    const deadline = io.deadlines(&g.options).next().?;
    try std.testing.expectEqual(deadline, g.sessions.deadlines.get(index).?);
    try std.testing.expectEqual(io.tx.active_deadline_ms.?, deadline);
    setup.shared.pair.advance(deadline - 1 - setup.shared.pair.now.millis());
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(g.schedule(), setup.shared.pair.now.millis()).? > setup.shared.pair.now.millis());
    _ = processClient(&setup);
    try std.testing.expect(g.sessions.rows[index].outStream() != null);
    setup.shared.pair.advance(1);
    try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(g.schedule(), setup.shared.pair.now.millis()));
    _ = processClient(&setup);
    try std.testing.expect(g.sessions.rows[index].outStream() == null);
    try std.testing.expect(!io.tx.pending());
}

test "gossip busy session cannot starve the others" {
    const per_turn = 4;
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1, .connected_capacity = 3 * per_turn, .peers_per_pump = per_turn, .calls_per_peer = 1 }, .{ .random_seed = 2 });
    defer setup.deinit();
    for (0..20) |_| try setup.pumpOnce();
    const g = setup.shared.client.gossipsub;
    const busy = g.sessions.find(setup.shared.handles.client).?;
    const stream = setup.clientStream();
    for (1..3 * per_turn) |i| {
        _ = gossip_test.addPeer(g, .{ .index = @intCast(300 + i), .generation = 1 }, .v1_2).?;
    }
    try std.testing.expectEqual(@as(usize, 3 * per_turn), g.resourceSnapshot().admitted_peers);
    _ = gossip_test.pumpTurn(g, &setup.shared.pair.client, setup.shared.pair.now);
    _ = gossip_test.pumpTurn(g, &setup.shared.pair.client, setup.shared.pair.now);
    _ = gossip_test.pumpTurn(g, &setup.shared.pair.client, setup.shared.pair.now);
    try std.testing.expectEqual(@as(usize, 0), g.sessions.ready.len);
    // One writable QUIC stream isolates the rotation from remote flow control. The busy session
    // queues 64 frames and writes one per turn; every other session queues one.
    for (g.sessions.rows, 0..) |*row, position| {
        g.sessions.setOutbound(@intCast(position), .{ .live = .{ .stream = stream, .version = .v1_2 } });
        const frames: usize = if (position == busy) 64 else 1;
        for (0..frames) |_| try std.testing.expect(row.io.tx.inject(&.{0}, setup.shared.pair.now.millis()));
        g.settle(@intCast(position));
    }
    try std.testing.expectEqual(@as(usize, 3 * per_turn), g.sessions.ready.len);
    for (0..3) |_| {
        const visits = g.sessions.visits;
        _ = gossip_test.pumpTurn(g, &setup.shared.pair.client, setup.shared.pair.now);
        try std.testing.expectEqual(@as(u64, per_turn), g.sessions.visits - visits);
        // The busy session still has work and waits behind every session queued before it.
        try std.testing.expect(g.sessions.rows[busy].ready_link.linked);
    }
    for (g.sessions.rows, 0..) |*row, position| {
        if (position != busy) try std.testing.expect(!row.io.tx.pending());
    }
    try std.testing.expectEqual(@as(usize, 1), g.sessions.ready.len);
    try std.testing.expectEqual(@as(usize, 64 - 1), g.sessions.rows[busy].io.tx.control.count);
}

test "gossip publish reaches a mesh peer in the turn after it and leaves no ready session" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    try connectMesh(&setup);
    const g = setup.shared.client.gossipsub;
    const index = g.sessions.find(setup.shared.handles.client).?;
    try std.testing.expectEqual(@as(usize, 0), g.sessions.ready.len);
    try std.testing.expectEqual(@as(u16, 1), (try g.publish(topic, "same turn", setup.shared.pair.now)).queued);
    try std.testing.expect(g.sessions.rows[index].ready_link.linked);
    try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(g.schedule(), setup.shared.pair.now.millis()));
    _ = setup.shared.processClient(.{});
    try std.testing.expect(!g.sessions.rows[index].io.tx.pending());
    try std.testing.expectEqual(@as(usize, 0), g.sessions.ready.len);
    try std.testing.expect(gossip_test.sessionWakeup(g, setup.shared.pair.now) > setup.shared.pair.now.millis());
    try std.testing.expect(setup.shared.pair.client.backlog() or setup.shared.pair.client.dirtyCount() > 0);
    try setup.shared.pair.pump();
    _ = setup.shared.processServer(.{});
    try std.testing.expectEqual(@as(usize, 1), setup.serverMessages().len);
    try std.testing.expectEqualStrings("same turn", setup.serverMessages()[0].bytes);
}

test "gossip resumes a small frame cut by a short write once the stream is writable" {
    var setup: Pair = .{};
    try setup.initWindow(.{ .random_seed = 1 }, .{ .random_seed = 1 }, 4096);
    defer setup.deinit();
    try connectMesh(&setup);
    const g = setup.shared.client.gossipsub;
    const index = g.sessions.find(setup.shared.handles.client).?;
    const io = &g.sessions.rows[index].io;
    const credit = try setup.shared.pair.client.streamCapacity(setup.clientStream());
    var payloads: [24][200]u8 = undefined;
    var random = std.Random.DefaultPrng.init(11);
    var frames: [payloads.len]usize = undefined;
    var total: usize = 0;
    for (&payloads, &frames) |*payload, *frame| {
        random.random().bytes(payload);
        try std.testing.expectEqual(@as(u16, 1), (try g.publish(topic, payload, setup.shared.pair.now)).queued);
        const id = topic_mod.validMessageId(topic, payload, g.options.message_id_policy);
        frame.* = g.messages.store.get(g.messages.history.message(g.messages.history.get(&g.messages.store, id).?)).?.frameLen();
        total += frame.*;
    }
    try std.testing.expect(credit < total);
    var whole: usize = 0;
    var offset = credit;
    for (frames) |frame| {
        if (offset < frame) break;
        offset -= frame;
        whole += 1;
    }
    const calls = g.sessions.writes;
    const blocked = g.sessions.blocked_writes;
    _ = processClient(&setup);
    // QUIC took every whole frame the credit covers in one write each, then a prefix of the next.
    try std.testing.expect(offset > 0);
    try std.testing.expectEqual(@as(u64, whole + 1), g.sessions.writes - calls);
    try std.testing.expectEqual(blocked + 1, g.sessions.blocked_writes);
    try std.testing.expect(!io.tx.ready and io.tx.pending() and io.tx.blocked_since != null);
    try std.testing.expectEqual(payloads.len - whole, io.tx.data.count);
    try std.testing.expectEqual(offset, io.tx.active.data.sent());

    // The server reads, the writable event resumes the cut frame, and every frame arrives intact.
    for (0..256) |_| {
        if (io.tx.data.count == 0) break;
        _ = setup.shared.processServer(.{});
        try setup.shared.pair.pump();
        _ = processClient(&setup);
        try setup.shared.pair.pump();
    }
    _ = setup.shared.processServer(.{});
    try std.testing.expectEqual(@as(usize, 0), io.tx.data.count);
    try std.testing.expect(io.tx.blocked_since == null);
    try std.testing.expectEqual(payloads.len, setup.serverMessages().len);
    for (setup.serverMessages(), &payloads) |message, *payload| try std.testing.expectEqualSlices(u8, payload, message.bytes);
    try std.testing.expect(g.sessions.writes - calls <= payloads.len + (g.sessions.blocked_writes - blocked));
}

test "gossip local publications lead each turn for a bounded run and cannot starve forwards or IWANT responses" {
    const Origin = @import("delivery.zig").Origin;
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1, .calls_per_peer = 1 }, .{ .random_seed = 1 });
    defer setup.deinit();
    try connectMesh(&setup);
    const g = setup.shared.client.gossipsub;
    const index = g.sessions.find(setup.shared.handles.client).?;
    const io = &g.sessions.rows[index].io;
    _ = try g.publish(topic, "retained", setup.shared.pair.now);
    for (0..8) |_| _ = gossip_test.pumpTurn(g, &setup.shared.pair.client, setup.shared.pair.now);
    try std.testing.expect(!io.tx.pending());
    const retained = g.messages.history.message(g.messages.history.get(&g.messages.store, topic_mod.validMessageId(topic, "retained", g.options.message_id_policy)).?);
    const ordinary = [_]Origin{ .forward, .forward, .forward, .iwant, .forward, .forward };
    for (ordinary) |origin| try std.testing.expectEqual(.queued, io.tx.queueData(&g.messages.store, retained, origin, .{ .bytes = constants.tx_peer_bytes }, setup.shared.pair.now.millis()));
    for (0..8) |i| {
        var payload: [8]u8 = undefined;
        std.mem.writeInt(u64, &payload, i, .little);
        try std.testing.expectEqual(@as(u16, 1), (try g.publish(topic, &payload, setup.shared.pair.now)).queued);
    }
    // One write call per turn: each turn completes one frame, and the run carries across turns.
    const expected = [_]Origin{ .publication, .publication, .publication, .publication, .forward, .publication, .publication, .publication, .publication, .forward, .forward, .iwant, .forward, .forward };
    for (expected) |origin| {
        var before: [3]u64 = undefined;
        for (&before, g.delivery_metrics.recipients) |*count, outcomes| count.* = outcomes[@intFromEnum(metrics.Delivery.Outcome.completed)];
        _ = gossip_test.pumpTurn(g, &setup.shared.pair.client, setup.shared.pair.now);
        for (before, g.delivery_metrics.recipients, 0..) |count, outcomes, o| {
            const completed = outcomes[@intFromEnum(metrics.Delivery.Outcome.completed)] - count;
            try std.testing.expectEqual(@as(u64, @intFromBool(o == @intFromEnum(origin))), completed);
        }
    }
    try std.testing.expect(!io.tx.pending());
}
