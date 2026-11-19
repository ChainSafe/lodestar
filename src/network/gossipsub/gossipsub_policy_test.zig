const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const constants = @import("constants.zig");
const local_intent = @import("local_intent.zig");
const protobuf = @import("protobuf.zig");
const topic_mod = @import("topic.zig");
const peers_mod = @import("peer_book.zig");
const Engine = @import("../quic/Engine.zig");
const Handle = Engine.Handle;
const Now = @import("../types.zig").Now;
const snappy = @import("snappy");
const support = @import("test_support.zig");
const testMessage = support.message;
const peer_id = @import("../wire/peer_id.zig");
const test_pair = @import("test_pair.zig");
const test_support = @import("../quic/test_support.zig");
const topic_fixture = @import("topic_fixture.zig");

test "gossip accepts a full namespace subscription transition in one RPC" {
    const policy = @import("topic_policy.zig");
    var boundary: policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    for (std.enums.values(topic_mod.Kind)) |kind| {
        boundary.rules[@intFromEnum(kind)] = .{ .count = kind.countMax(), .ssz_min = 1, .ssz_max = 1024 };
    }
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .topic_policy = &.{boundary} });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    var bytes: [64 * 1024]u8 = undefined;
    var writer = protobuf.Writer.init(&bytes);
    for ([_]bool{ true, false }) |subscribed| {
        for (std.enums.values(topic_mod.Kind)) |kind| {
            for (0..kind.countMax()) |subnet| {
                var suffix_buffer: [topic_mod.name_max_len]u8 = undefined;
                const suffix = if (kind.countMax() == 1) @tagName(kind) else try std.fmt.bufPrint(&suffix_buffer, "{s}_{d}", .{ @tagName(kind), subnet });
                var topic: [topic_mod.topic_max_len]u8 = undefined;
                const name = topic_mod.build(boundary.digest, suffix, &topic);
                if (subscribed) try support.subscribe(&g, name);
                protobuf.writeSubscription(&writer, subscribed, name);
            }
        }
    }
    const io = &g.sessions.rows[peer.index].io;
    io.startRpc(writer.written());
    for (0..128) |_| {
        var count: usize = 0;
        var items: usize = 16;
        if (try support.processRpc(&g, peer.index, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 1 }), &count, &items)) break;
    }
    try std.testing.expectEqual(@as(usize, 0), g.resourceSnapshot().remote_subscriptions);
    _ = g.sessions.finishFrame(io);
}

test "gossipsub IHAVE security ignores unknown and unsubscribed topics through RPC decoding" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const subscribed = "/eth2/01020304/beacon_block/ssz_snappy";
    const retired = "/eth2/01020304/beacon_aggregate_and_proof/ssz_snappy";
    try support.subscribe(&g, subscribed);
    try support.subscribe(&g, retired);
    try support.unsubscribe(&g, retired);
    for ([_][]const u8{ "/eth2/01020304/unknown/ssz_snappy", retired, subscribed }) |name| {
        var bytes: [256]u8 = undefined;
        var writer = protobuf.Writer.init(&bytes);
        protobuf.beginIhaveRpc(&writer, name, 1, constants.message_id_length);
        protobuf.writeIhaveId(&writer, &([_]u8{7} ** 20));
        const io = &g.sessions.rows[peer.index].io;
        io.startRpc(writer.written());
        var items: usize = 128;
        var count: usize = 0;
        try std.testing.expect(try support.processRpc(&g, peer.index, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 1 }), &count, &items));
        try std.testing.expectEqual(@as(usize, @intFromBool(std.mem.eql(u8, name, subscribed))), g.recovery.len);
        try std.testing.expect(!g.sessions.finishFrame(io));
    }
}

test "gossip policy reconnect retains authenticated penalty" {
    var g = try support.init(std.testing.allocator, .{
        .random_seed = 1,
    });
    defer g.deinit();
    const metadata: peers_mod.Metadata = .{
        .identity = .{ .bytes = [_]u8{1} ** peer_id.length },
        .address = .unspecified,
        .direction = .inbound,
    };
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    const first = g.addPeer(.{ .index = 0, .generation = 1 }, &metadata, now).admitted;
    const original = g.sessions.rows[first.index].logical;
    g.peers.scores.penalize(original.index, 20);
    const topic_name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, topic_name);
    const topic = g.overlay.findTopic(topic_name).?;
    g.peers.addBackoff(original, topic, 1, 60_000);
    g.connectionClosed(.{ .index = 0, .generation = 1 });
    const second = g.addPeer(.{ .index = 0, .generation = 2 }, &metadata, now).admitted;
    try std.testing.expectEqual(original, g.sessions.rows[second.index].logical);
    try std.testing.expect(g.peers.backedOff(original, topic, 60_000));
    try std.testing.expect(!g.peers.backedOff(original, topic, 60_001));
    try std.testing.expect(g.peers.score(g.sessions.rows[second.index].logical, 1) < 0);
}

test "gossip policy GRAFT rejects negative peers and excludes direct peers" {
    var g = try support.init(std.testing.allocator, .{
        .random_seed = 1,
    });
    defer g.deinit();
    const conn: Handle = .{ .index = 0, .generation = 1 };
    const peer = support.addPeer(&g, conn, .v1_2).?;
    const topic_str = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, topic_str);
    const topic = g.overlay.findTopic(topic_str).?;
    support.penalize(&g, conn, 7);
    support.control(&g, peer.index, .{ .graft = topic_str }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 0), g.overlay.mesh(topic).count());
    g.peers.scores.rows[g.sessions.rows[peer.index].logical.index].behaviour = 0;
    support.penalize(&g, conn, 0);
    g.markDirect(conn);
    _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), peer.index, g.overlay.topicString(topic), true);
    var context = g.overlayContext(100_000);
    context.snapshot = &g.cycle.scores;
    g.overlay.maintain(&context, topic);
    try std.testing.expectEqual(@as(usize, 0), g.overlay.mesh(topic).count());
}

test "gossip ignores GRAFT crossing a local unsubscribe without extending backoff or penalizing" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    const topic = g.overlay.findTopic(name).?;
    const logical = g.sessions.rows[peer.index].logical;
    support.control(&g, peer.index, .{ .graft = name }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    try support.unsubscribe(&g, name);
    const backoff = g.peers.backoff(logical, topic);
    const queued = g.sessions.rows[peer.index].io.tx.critical.count;
    const penalty = g.peers.scores.rows[logical.index].behaviour;
    support.control(&g, peer.index, .{ .graft = name }, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    try std.testing.expectEqualDeep(backoff, g.peers.backoff(logical, topic));
    try std.testing.expectEqual(queued, g.sessions.rows[peer.index].io.tx.critical.count);
    try std.testing.expectEqual(penalty, g.peers.scores.rows[logical.index].behaviour);
}

test "gossip policy combined transport calls respect one shared peer allowance" {
    var setup: test_pair.Pair = .{};
    try setup.init();
    defer setup.deinit();
    for (0..20) |_| try setup.pumpOnce();
    const g = setup.shared.client.gossipsub;
    const peer = g.sessions.find(setup.shared.handles.client).?;
    g.options.calls_per_peer = 1;
    for ([_]usize{ 8, 1 }) |global| {
        g.options.calls_per_pump = global;
        var read_turns: usize = 0;
        var write_turns: usize = 0;
        for (0..8) |_| {
            // One empty frame each way: queued output and a readable edge on the same session.
            try std.testing.expect(g.sessions.rows[peer].io.tx.inject(&.{0}, setup.shared.pair.now.millis()));
            g.settle(peer);
            try std.testing.expectEqual(@as(usize, 1), try setup.shared.pair.server.write(setup.serverStream(), &.{0}, false));
            try setup.shared.pair.pump();
            setup.forwardClient();
            const turn = support.pumpTurn(g, &setup.shared.pair.client, setup.shared.pair.now);
            const calls = global - turn.budget.calls;
            try std.testing.expect(calls <= 1);
            if (calls > 0) {
                if (turn.budget.output < setup.shared.client.gossipsub.options.output_per_pump) write_turns += 1 else read_turns += 1;
            }
        }
        try std.testing.expect(read_turns > 0 and write_turns > 0);
        for (0..32) |_| {
            if (support.sessionWakeup(g, setup.shared.pair.now) > setup.shared.pair.now.millis()) break;
            const turn = support.pumpTurn(g, &setup.shared.pair.client, setup.shared.pair.now);
            try std.testing.expect(global - turn.budget.calls <= 1);
        }
        try std.testing.expect(!g.sessions.rows[peer].io.tx.pending());
        try std.testing.expect(support.sessionWakeup(g, setup.shared.pair.now) > setup.shared.pair.now.millis());
    }
}

test "gossip policy sent promise survives reconnect without token rearming" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const metadata: peers_mod.Metadata = .{ .identity = .{ .bytes = [_]u8{1} ** peer_id.length }, .address = .unspecified, .direction = .inbound };
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    const conn: Handle = .{ .index = 0, .generation = 1 };
    const first = g.addPeer(conn, &metadata, now).admitted;
    const ref = g.sessions.rows[first.index].logical;
    try g.recovery.add(&g.peers, [_]u8{1} ** 20, g.sessions.rows[first.index].logical, g.sessions.rows[first.index].conn, 9, 30_000);
    g.recovery.controlSent(g.sessions.rows[first.index].conn, 9, g.options.iwant_followup_ms, 10);
    g.connectionClosed(conn);
    try std.testing.expectEqual(@as(usize, 1), g.recovery.len);
    const next = g.addPeer(.{ .index = 0, .generation = 2 }, &metadata, now).admitted;
    g.recovery.controlSent(g.sessions.rows[next.index].conn, 9, g.options.iwant_followup_ms, 2000);
    try std.testing.expectEqual(@as(?u64, 3010), g.recovery.batches[0].expiry);
    support.heartbeat(&g, Now.fromMilliseconds(.{ .mono_ms = 3010, .unix_s = 0 }));
    try std.testing.expectEqual(@as(u64, 1), g.counters.broken_promises);
    try std.testing.expectEqual(@as(u32, 0), g.peers.rows[ref.index].pins);
}

test "gossip policy duplicate connections preserve one logical owner and direct deliveries" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    var metadata: peers_mod.Metadata = .{ .identity = .{ .bytes = [_]u8{1} ** peer_id.length }, .address = .unspecified, .direction = .outbound };
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    const conn: Handle = .{ .index = 0, .generation = 1 };
    const first = g.addPeer(conn, &metadata, now).admitted;
    const second: Handle = .{ .index = 1, .generation = 1 };
    try std.testing.expectEqual(Gossipsub.PeerAdmission.duplicate, g.addPeer(second, &metadata, now));
    g.connectionClosed(second);
    try std.testing.expectEqual(@as(?u16, first.index), g.sessions.find(conn));
    const topic = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, topic);
    _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), first.index, topic, true);
    g.markDirect(conn);
    support.penalize(&g, conn, 110);
    g.sessions.rows[first.index].outbound = .{ .live = .{ .stream = .{ .conn = conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
    const result = try g.publish(topic, "direct data", now);
    try std.testing.expectEqual(@as(u16, 1), result.queued);
    try std.testing.expectEqual(@as(usize, 0), g.overlay.mesh(g.overlay.findTopic(topic).?).count());
    g.connectionClosed(conn);
    metadata.direct = true;
    const next = g.addPeer(second, &metadata, now).admitted;
    try std.testing.expect(g.peers.rows[g.sessions.rows[next.index].logical.index].direct);
    g.connectionClosed(second);
    metadata.direct = false;
    const indirect = g.addPeer(.{ .index = 1, .generation = 2 }, &metadata, now).admitted;
    try std.testing.expect(!g.peers.rows[g.sessions.rows[indirect.index].logical.index].direct);
}

test "gossip policy topic expiry waits for attribution and preserves copied event window" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const conn: Handle = .{ .index = 0, .generation = 1 };
    const peer = support.addPeer(&g, conn, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    const topic = g.overlay.findTopic(name).?;
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    try std.testing.expectEqual(@as(?usize, 1), try testMessage(&g, peer.index, "retained", 1));
    const event = inbox.last();
    const copied = g.resourceSnapshot();
    try support.subscribe(&g, name);
    try std.testing.expectEqualStrings("retained", event.bytes);
    try std.testing.expectEqualStrings(name, event.topic);
    try std.testing.expectEqual(@as(usize, 1), copied.pending_validations);
    try std.testing.expectEqualDeep(copied, g.resourceSnapshot());
    try support.unsubscribe(&g, name);
    g.connectionClosed(conn);
    g.overlay.expireTopic(&g.overlayContext(g.last_now_ms), topic, g.messages.validation.retainsTopic(topic));
    try std.testing.expect(g.overlay.rows[topic].active);
    _ = g.report(event.handle, .ignore, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    g.messages.validation.expire(&g.messages.store, &g.peers, 30_002);
    g.last_now_ms = 30_002;
    g.overlay.expireTopic(&g.overlayContext(g.last_now_ms), topic, g.messages.validation.retainsTopic(topic));
    try std.testing.expect(!g.overlay.rows[topic].active);
    const next_name = "/eth2/01020304/voluntary_exit/ssz_snappy";
    try support.subscribe(&g, next_name);
    try std.testing.expect(g.overlay.findTopic(next_name).? != topic);
    try support.subscribe(&g, name);
    try std.testing.expectEqual(topic, g.overlay.findTopic(name).?);
    try std.testing.expectEqualStrings(name, event.topic);
    try std.testing.expectEqualStrings("retained", event.bytes);
}

test "gossip policy topic retirement bounds arbitrarily slow active score decay" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .retained_score_ms = 10, .score_params = .{ .decay_interval_ms = 1, .topic = .{ .first_delivery_decay = 0.999999999999 } } });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    const topic = g.overlay.findTopic(name).?;
    g.peers.scores.deliverEligible(g.sessions.rows[peer.index].logical.index, topic, false);
    try support.unsubscribe(&g, name);
    g.overlay.flushSubscriptions(&g.sessions.rows[peer.index].io.tx, &g.sessions.control_scratch, g.last_now_ms);
    g.last_now_ms = 11;
    g.peers.scores.refresh(11);
    g.overlay.expireTopic(&g.overlayContext(g.last_now_ms), topic, g.messages.validation.retainsTopic(topic));
    try std.testing.expect(!g.overlay.rows[topic].active);
    try std.testing.expectEqual(@as(f64, 0), g.peers.score(g.sessions.rows[peer.index].logical, 11));
}

test "gossip policy unsent subscriptions cannot pin retired topics indefinitely" {
    var pair: test_support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .pressure_timeout_ms = 10 });
    defer g.deinit();
    const conn: Handle = .{ .index = 0, .generation = 1 };
    _ = support.addPeer(&g, conn, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    try support.unsubscribe(&g, name);
    _ = support.pump(&g, &pair.server, Now.fromMilliseconds(.{ .mono_ms = 11, .unix_s = 0 }));
    try std.testing.expect(g.sessions.find(conn) == null);
    try std.testing.expectEqual(@as(u64, 1), g.counters.local_pressure_resets);
    const topic = g.overlay.findTopic(name).?;
    g.overlay.expireTopic(&g.overlayContext(g.last_now_ms), topic, g.messages.validation.retainsTopic(topic));
    try std.testing.expect(!g.overlay.rows[topic].active);
}

test "gossip policy subscription retry preserves its first pressure deadline" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    try support.subscribe(&g, "/eth2/01020304/beacon_block/ssz_snappy");
    g.last_now_ms = 1;
    g.sendSubscriptions(peer.index);
    try std.testing.expectEqual(@as(?u64, 0), g.sessions.rows[peer.index].io.tx.subscription_since);
}

test "gossip policy review I4 heartbeat fanout and advertisements share one snapshot" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 17, .topics_per_pump = 1 });
    defer g.deinit();
    const first_name = "/eth2/01020304/beacon_block/ssz_snappy";
    const second_name = "/eth2/01020304/beacon_aggregate_and_proof/ssz_snappy";
    _ = support.activate(&g, first_name).?;
    const second = support.activate(&g, second_name).?;
    for (0..9) |i| {
        const peer = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
        _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), peer.index, first_name, true);
        _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), peer.index, second_name, true);
        g.sessions.rows[peer.index].outbound = .{ .live = .{ .stream = .{ .conn = g.sessions.rows[peer.index].conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
    }
    const start: Now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    _ = try g.publish(first_name, "first", start);
    _ = try g.publish(second_name, "second", start);
    support.heartbeat(&g, start);
    // Place the score change between the two topics regardless of the shuffled traversal.
    for (g.cycle.order, 0..) |*topic, index| topic.* = @intCast(index);
    Gossipsub.finishPump(&g, start);
    try std.testing.expectEqual(@as(usize, 1), g.cycle.cursor);
    try std.testing.expect(g.cycle.isActive());
    const epoch = g.cycle.epoch;
    const retained = g.overlay.fanoutMembers(second).findFirstSet().?;
    var advertised: u16 = 0;
    for (0..9) |i| if (!g.overlay.fanoutMembers(second).isSet(i)) {
        advertised = @intCast(i);
    };
    g.peers.scores.penalize(g.sessions.rows[@intCast(retained)].logical.index, 50);
    g.peers.scores.penalize(g.sessions.rows[advertised].logical.index, 50);
    for (g.sessions.rows) |*peer| peer.io.tx.cancelStream();
    g.last_now_ms = 2;
    g.opportunistic_at = 2;
    support.heartbeat(&g, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    try std.testing.expect(!g.cycle.opportunistic);
    try std.testing.expectEqual(epoch, g.cycle.epoch);
    Gossipsub.finishPump(&g, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    try std.testing.expect(g.overlay.fanoutMembers(second).isSet(retained));
    try std.testing.expectEqual(@as(usize, 8), g.overlay.fanoutMembers(second).count());
    try std.testing.expect(g.sessions.rows[advertised].io.tx.gossip_len > 0);
    try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[advertised].io.tx.control.count);
    try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[retained].io.tx.control.count);
    Gossipsub.finishPump(&g, Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 0 }));
    try std.testing.expect(!g.cycle.isActive());
    try std.testing.expectEqual(@as(usize, 1), g.sessions.rows[advertised].io.tx.control.count);
    try std.testing.expectEqual(epoch, g.cycle.epoch);
    for (g.sessions.rows) |*peer| peer.io.tx.cancelStream();
    g.last_now_ms = 701;
    support.heartbeat(&g, Now.fromMilliseconds(.{ .mono_ms = 701, .unix_s = 0 }));
    Gossipsub.finishPump(&g, Now.fromMilliseconds(.{ .mono_ms = 701, .unix_s = 0 }));
    Gossipsub.finishPump(&g, Now.fromMilliseconds(.{ .mono_ms = 702, .unix_s = 0 }));
    try std.testing.expect(!g.overlay.fanoutMembers(second).isSet(retained));
    try std.testing.expectEqual(@as(usize, 7), g.overlay.fanoutMembers(second).count());
    try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[advertised].io.tx.control.count);
    try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[retained].io.tx.control.count);
    const live = g.overlay.fanoutMembers(second).findFirstSet().?;
    g.peers.scores.penalize(g.sessions.rows[@intCast(live)].logical.index, 50);
    _ = try g.publish(second_name, "live publish", Now.fromMilliseconds(.{ .mono_ms = 703, .unix_s = 0 }));
    try std.testing.expect(!g.overlay.fanoutMembers(second).isSet(live));
}

test "gossip topic retirement clears expired scores while backoff remains" {
    var g = try support.init(std.testing.allocator, .{
        .random_seed = 1,
        .connected_capacity = 2,
        .retained_capacity = 9,
        .retained_outbound_reserve = 1,
    });
    defer g.deinit();
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    g.peers.scores.invalid(0, 0);
    try support.unsubscribe(&g, name);
    g.last_now_ms = g.overlay.rows[0].retire_after_ms.?;
    g.peers.backoffs[0] = .{ .until = g.last_now_ms + 100 };
    g.overlay.expireTopic(&g.overlayContext(g.last_now_ms), 0, g.messages.validation.retainsTopic(0));
    try std.testing.expect(!g.peers.scores.retainsTopic(0));
    try std.testing.expect(g.overlay.rows[0].active);
    try std.testing.expectEqual(g.last_now_ms + 100, g.peers.backoffs[0].until);
}

test "publication subscribed fanout expires through owner maintenance" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const conn: Handle = .{ .index = 0, .generation = 1 };
    const p = support.addPeer(&g, conn, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    const t = g.overlay.findTopic(name).?;
    _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), p.index, name, true);
    g.sessions.rows[p.index].outbound = .{ .live = .{ .stream = .{ .conn = conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
    _ = try g.publish(name, "fanout expiry", Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 1), g.overlay.fanoutMembers(t).count());
    support.heartbeat(&g, Now.fromMilliseconds(.{ .mono_ms = 59_999, .unix_s = 0 }));
    Gossipsub.finishPump(&g, Now.fromMilliseconds(.{ .mono_ms = 59_999, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 1), g.overlay.fanoutMembers(t).count());
    support.heartbeat(&g, Now.fromMilliseconds(.{ .mono_ms = 60_000, .unix_s = 0 }));
    Gossipsub.finishPump(&g, Now.fromMilliseconds(.{ .mono_ms = 60_000, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 0), g.overlay.fanoutMembers(t).count());
    _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), p.index, name, false);
    g.sessions.rows[p.index].io.tx.cancelStream();
    const next_conn: Handle = .{ .index = 1, .generation = 1 };
    const next = support.addPeer(&g, next_conn, .v1_2).?;
    _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), next.index, name, true);
    g.sessions.rows[next.index].outbound = .{ .live = .{ .stream = .{ .conn = next_conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
    const result = try g.publish(name, "fresh fanout", Now.fromMilliseconds(.{ .mono_ms = 60_001, .unix_s = 0 }));
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .selected = 1, .queued = 1 }, result);
    try std.testing.expectEqual(@as(usize, 1), g.overlay.fanoutMembers(t).count());
    try std.testing.expect(g.overlay.fanoutMembers(t).isSet(next.index));
    try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[p.index].io.tx.data.count);
    const queued = (g.sessions.rows[next.index].io.tx.data.next(&g.messages.store, g.last_now_ms, g.options.tx_timeout_ms)).?.message;
    try std.testing.expectEqual(topic_mod.validMessageId(name, "fresh fanout", .{}), g.messages.store.get(queued).?.id);
}

test "local intent reclaimed history answers actual IWANT with original wire topic and bytes" {
    var g = try support.init(std.testing.allocator, .{
        .random_seed = 1,
        .connected_capacity = 2,
        .retained_capacity = 9,
        .retained_outbound_reserve = 1,
        .topic_policy = &.{topic_fixture.full(.{ 1, 2, 3, 4 })},
    });
    defer g.deinit();
    const workspace = try std.testing.allocator.create(local_intent.Workspace);
    defer std.testing.allocator.destroy(workspace);
    workspace.* = .{};
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    const replacement = "/eth2/01020304/voluntary_exit/ssz_snappy";
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    _ = try g.publish(name, "original payload", now);
    const id = topic_mod.validMessageId(name, "original payload", .{});
    const message = g.messages.history.message(g.messages.history.get(&g.messages.store, id).?);
    try std.testing.expect(try g.prepareSubscriptions(topic_fixture.subscriptions(&.{replacement}), workspace, now, 0));
    g.commitSubscriptions(workspace);
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    var request: [64]u8 = undefined;
    var writer = protobuf.Writer.init(&request);
    protobuf.beginIwantRpc(&writer, 1, id.len);
    protobuf.writeIwantId(&writer, &id);
    var reader = protobuf.RpcReader.init(writer.written());
    support.control(&g, peer.index, .{ .iwant = (try reader.next()).?.iwant }, Now.fromMilliseconds(.{ .mono_ms = g.last_now_ms, .unix_s = 0 }));
    const io = &g.sessions.rows[peer.index].io;
    try std.testing.expectEqual(@as(usize, 1), io.tx.data.count);
    try std.testing.expectEqual(message, (io.tx.data.next(&g.messages.store, g.last_now_ms, g.options.tx_timeout_ms)).?.message);
    const cached = g.messages.history.get(&g.messages.store, id).?;
    const logical = g.sessions.rows[peer.index].logical;
    try std.testing.expect(!g.messages.history.iwantAllowed(cached, logical, 1));
    try std.testing.expect(g.messages.history.iwantAllowed(cached, logical, 2));
    var wire: [512]u8 = undefined;
    var used: usize = 0;
    for (0..8) |_| {
        const segment = io.tx.segment(&g.messages.store, 0);
        if (segment.len == 0) break;
        try std.testing.expect(used + segment.len <= wire.len);
        @memcpy(wire[used..][0..segment.len], segment);
        used += segment.len;
        _ = io.tx.advance(segment.len);
    }
    try std.testing.expectEqual(@as(usize, 0), io.tx.data.count);
    try std.testing.expect(std.mem.find(u8, wire[0..used], name) != null);
    var decompressed: [64]u8 = undefined;
    const size = try snappy.raw.uncompress(g.messages.store.segment(message, g.messages.store.cursor(message)), &decompressed);
    try std.testing.expectEqualStrings("original payload", decompressed[0..size]);
    try std.testing.expect(g.overlay.findTopic(replacement) != null);
    try std.testing.expectEqualStrings(name, g.overlay.topicString(0));
}

test "gossip advertisements sample the whole burst independently for each recipient" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 17 });
    defer g.deinit();
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    const t = support.activate(&g, name).?;
    for (0..2) |i| {
        const peer = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
        _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), peer.index, name, true);
        g.sessions.rows[peer.index].outbound = .{ .live = .{ .stream = .{ .conn = g.sessions.rows[peer.index].conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
    }
    for (0..512) |i| {
        var bytes: [8]u8 = undefined;
        std.mem.writeInt(u64, &bytes, i, .little);
        _ = try g.publish(name, &bytes, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    }
    for (g.sessions.rows) |*peer| peer.io.tx.cancelStream();
    g.overlay.rows[t].fanout = .empty;
    const context = g.overlayContext(1);
    g.cycle.begin(context.sessions, context.peers, context.now, false, g.overlay.rng.random());
    Gossipsub.finishPump(&g, Now.fromMilliseconds(.{ .mono_ms = context.now, .unix_s = 0 }));
    const first = g.sessions.rows[0].io.tx.segment(&g.messages.store, 0);
    const second = g.sessions.rows[1].io.tx.segment(&g.messages.store, 0);
    try std.testing.expect(first.len > 0 and second.len > 0);
    try std.testing.expect(!std.mem.eql(u8, first, second));
    var beyond_prefix: usize = 0;
    for (g.messages.gossip_ids[0..constants.gossip_ids_max]) |id| {
        const entry = g.messages.history.get(&g.messages.store, id).?;
        if (g.messages.history.message(entry).index >= constants.gossip_ids_max) beyond_prefix += 1;
    }
    try std.testing.expect(beyond_prefix > constants.gossip_ids_max / 2);
}

test "gossip disconnect classifies active mesh score before pruning and records failure once" {
    for ([_]u64{ 50, 40, 30 }) |elapsed| {
        var g = try support.init(std.testing.allocator, .{
            .random_seed = 1,
            .score_params = .{ .topic = .{
                .time_in_mesh_weight = 1,
                .time_in_mesh_quantum_ms = 10,
                .mesh_delivery_threshold = 2,
                .mesh_delivery_activation_ms = 10,
            } },
        });
        defer g.deinit();
        const conn: Handle = .{ .index = 0, .generation = 1 };
        const metadata: peers_mod.Metadata = .{ .identity = .{ .bytes = @splat(1) }, .address = .unspecified, .direction = .inbound };
        const first = g.addPeer(conn, &metadata, Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 })).admitted;
        const ref = g.sessions.rows[first.index].logical;
        const name = "/eth2/01020304/beacon_block/ssz_snappy";
        try support.subscribe(&g, name);
        const topic = g.overlay.findTopic(name).?;
        g.sessions.rows[first.index].outbound = .{ .live = .{ .stream = .{ .conn = conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
        const context = g.overlayContext(0);
        _ = g.overlay.peerSubscription(&context, first.index, name, true);
        g.overlay.onGraft(&context, topic, first.index);
        try std.testing.expect(g.overlay.mesh(topic).isSet(first.index));
        try std.testing.expectEqual(@as(f64, @floatFromInt(elapsed / 10)) - 4, g.peers.score(ref, elapsed));
        g.last_now_ms = elapsed;
        g.connectionClosed(conn);
        g.connectionClosed(conn);
        try std.testing.expect(!g.overlay.mesh(topic).isSet(first.index));
        try std.testing.expect(!g.overlay.subscribers(topic).isSet(first.index));
        const counters = g.peers.scores.topics[@as(usize, ref.index) * g.overlay.rows.len + topic];
        try std.testing.expect(!counters.in_mesh);
        try std.testing.expectEqual(@as(f64, if (elapsed > 40) 0 else 4), counters.mesh_failures);
        const second = g.addPeer(.{ .index = 0, .generation = 2 }, &metadata, Now.fromMilliseconds(.{ .mono_ms = elapsed + 1, .unix_s = 0 })).admitted;
        try std.testing.expectEqual(ref, g.sessions.rows[second.index].logical);
        try std.testing.expectEqual(@as(f64, if (elapsed > 40) 0 else -4), g.peers.score(ref, elapsed + 1));
    }
}
