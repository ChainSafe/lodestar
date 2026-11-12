const Now = @import("../types.zig").Now;
const support = @import("test_support.zig");
const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const topic_mod = @import("topic.zig");
const test_topic = "/eth2/01020304/beacon_block/ssz_snappy";
const Engine = @import("../quic/Engine.zig");
const outbox = @import("outbox.zig");
const delivery = @import("delivery.zig");
const message_store = @import("message_store.zig");
const snappy = @import("snappy");
const topic_policy = @import("topic_policy.zig");
const gossip_limits = @import("../gossip_limits.zig");
const constants = @import("constants.zig");
const test_pair = @import("test_pair.zig");
const topic_fixture = @import("topic_fixture.zig");
const protobuf = @import("protobuf.zig");

fn publicationLimits() !Gossipsub.Options {
    var limits: gossip_limits.Limits = @splat(.{ .items = 2, .bytes = 4096 });
    limits[@intFromEnum(topic_mod.Kind.beacon_block)] = .{ .items = 8, .bytes = 24 * 1024 * 1024 };
    var options: Gossipsub.Options = .{ .random_seed = 1, .connected_capacity = 3, .retained_capacity = 9, .retained_outbound_reserve = 1 };
    try options.setPayloadLimits(&limits);
    return options;
}

test "publication uses history capacity while remote block validation is full" {
    var options = try publicationLimits();
    var boundary: topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    boundary.rules[@intFromEnum(topic_mod.Kind.beacon_block)] = .{ .count = 1, .ssz_max = 4096 };
    options.topic_policy = &.{boundary};
    var g = try support.init(std.testing.allocator, options);
    defer g.deinit();
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    try support.subscribe(&g, test_topic);
    for (0..2) |index| {
        const peer = support.addPeer(&g, .{ .index = @intCast(index), .generation = 1 }, .v1_2).?;
        for (0..4) |item| {
            const body = [_]u8{@intCast(index * 4 + item)};
            try std.testing.expectEqual(@as(?usize, 1), try support.message(&g, peer.index, &body, 1));
        }
    }
    try std.testing.expectEqual(@as(usize, 8), g.messages.pendingValidations());
    try std.testing.expect(g.messages.store.canReserve(64));
    _ = try g.publish(test_topic, "local", Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 8), g.messages.pendingValidations());
    try std.testing.expectEqual(@as(usize, 1), g.messages.history.count);
    try std.testing.expect(g.messages.known(topic_mod.validMessageId(test_topic, "local", .{}), 2));
}

test "publication queues despite a full ordinary block allowance" {
    var options = try publicationLimits();
    var boundary: topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    boundary.rules[@intFromEnum(topic_mod.Kind.beacon_block)] = .{ .count = 1, .ssz_max = 4096 };
    options.topic_policy = &.{boundary};
    var g = try support.init(std.testing.allocator, options);
    defer g.deinit();
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    try support.subscribe(&g, test_topic);
    const sender = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const recipient = support.addPeer(&g, .{ .index = 1, .generation = 1 }, .v1_2).?;
    const t = g.overlay.findTopic(test_topic).?;
    _ = g.overlay.peerSubscription(&g.overlayContext(0), recipient.index, test_topic, true);
    g.overlay.rows[t].mesh.set(recipient.index);
    g.markDirect(g.sessions.rows[recipient.index].conn);
    for (0..2) |index| {
        const body = [_]u8{@intCast(index)};
        try std.testing.expectEqual(@as(?usize, 1), try support.message(&g, sender.index, &body, 1));
        _ = g.report(inbox.last().handle, .accept, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    }
    const queue = &g.sessions.rows[recipient.index].io.tx.data;
    try std.testing.expectEqual(@as(usize, 2), queue.count);
    try std.testing.expectEqual(@as(usize, 0), queue.local_bytes);
    try std.testing.expect(queue.bytes < constants.tx_peer_bytes - constants.tx_local_bytes);
    const outcome = try g.publishWithOptions(test_topic, "local", .{ .allow_zero_peers = false }, Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 0 }));
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .selected = 1, .queued = 1 }, outcome);
    try std.testing.expect(g.messages.known(topic_mod.validMessageId(test_topic, "local", .{}), 3));
    try std.testing.expectError(error.Duplicate, g.publish(test_topic, "local", Now.fromMilliseconds(.{ .mono_ms = 4, .unix_s = 0 })));
}

test "publication refusal retry duplicate and exact expiry preserve admission" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .seen_ttl_ms = 100, .mcache_capacity = 2, .seen_capacity = 2 });
    defer g.deinit();
    const id = topic_mod.validMessageId(test_topic, "local", .{});
    const counts = g.topic_metrics.get(test_topic);
    try std.testing.expectError(error.NoPeersSubscribedToTopic, g.publishWithOptions(test_topic, "local", .{ .allow_zero_peers = false }, Now.fromMilliseconds(.{ .mono_ms = 10, .unix_s = 0 })));
    try std.testing.expectEqual(@as(u64, 0), counts.published);
    try std.testing.expect(!g.messages.seen.contains(id, 10));
    try std.testing.expectEqual(@as(usize, 0), g.messages.history.count);
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const t = g.overlay.findTopic(test_topic).?;
    _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), peer.index, test_topic, true);
    g.markDirect(g.sessions.rows[peer.index].conn);
    const admitted = try g.publishWithOptions(test_topic, "local", .{ .allow_zero_peers = false }, Now.fromMilliseconds(.{ .mono_ms = 11, .unix_s = 0 }));
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .selected = 1, .queued = 1 }, admitted);
    const retained = g.messages.history.message(g.messages.history.get(&g.messages.store, id).?);
    const tx_before = g.sessions.rows[peer.index].io.tx.data.count;
    const seen_at = g.messages.seen.added_ms[g.messages.seen.tail];
    const fanout_at = g.overlay.rows[t].fanout_last_ms;
    try std.testing.expectError(error.Duplicate, g.publish(test_topic, "local", Now.fromMilliseconds(.{ .mono_ms = 20, .unix_s = 0 })));
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .duplicate = true }, try g.publishWithOptions(test_topic, "local", .{ .ignore_duplicate = true }, Now.fromMilliseconds(.{ .mono_ms = 110, .unix_s = 0 })));
    try std.testing.expectEqual(retained, g.messages.history.message(g.messages.history.get(&g.messages.store, id).?));
    try std.testing.expectEqual(tx_before, g.sessions.rows[peer.index].io.tx.data.count);
    try std.testing.expectEqual(seen_at, g.messages.seen.added_ms[g.messages.seen.tail]);
    try std.testing.expectEqual(fanout_at, g.overlay.rows[t].fanout_last_ms);
    try std.testing.expectEqual(@as(u64, 1), counts.published);
    _ = try g.publish(test_topic, "local", Now.fromMilliseconds(.{ .mono_ms = 111, .unix_s = 0 }));
    try std.testing.expectEqual(@as(u64, 2), counts.published);
    try std.testing.expectEqual(@as(u64, 0), counts.received);
}

test "publication recipient policy tops up without graft and accounts unique shared descriptors" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .score_params = .{ .publish_threshold = -9000 }, .connected_capacity = 16, .retained_capacity = 33, .retained_outbound_reserve = 1 });
    defer g.deinit();
    try support.subscribe(&g, test_topic);
    const t = g.overlay.findTopic(test_topic).?;
    for (0..12) |index| {
        const conn: Engine.Handle = .{ .index = @intCast(index), .generation = 1 };
        const peer = support.addPeer(&g, conn, .v1_2).?;
        _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), peer.index, test_topic, true);
        g.sessions.rows[peer.index].outbound = .{ .live = .{ .stream = .{ .conn = conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
    }
    g.markDirect(g.sessions.rows[0].conn);
    support.penalize(&g, g.sessions.rows[0].conn, 40);
    support.penalize(&g, g.sessions.rows[10].conn, 40);
    support.penalize(&g, g.sessions.rows[9].conn, 36);
    try std.testing.expectEqual(g.options.score_params.publish_threshold, g.scoreSnapshot(g.sessions.rows[9].conn, Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 })).?);
    g.options.pressure_timeout_ms = 1;
    g.sessions.setOutbound(11, .{ .closing = g.sessions.rows[11].outStream().? });
    g.overlay.rows[t].mesh.set(1);
    g.overlay.rows[t].mesh.set(10);
    g.overlay.rows[t].mesh.set(11);
    g.sessions.rows[1].outbound = .none;
    g.sessions.rows[9].outbound = .none;
    const outcome = try g.publish(test_topic, "short mesh", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .selected = 8, .queued = 8 }, outcome);
    try std.testing.expectEqual(@as(usize, 3), g.overlay.mesh(t).count());
    const id = topic_mod.validMessageId(test_topic, "short mesh", .{});
    const h = g.messages.history.message(g.messages.history.get(&g.messages.store, id).?);
    try std.testing.expectEqual(@as(usize, 1), g.messages.store.used_entries);
    const first_bytes = @as(u64, g.messages.store.get(h).?.len) * 8;
    try std.testing.expectEqual(first_bytes, g.topic_metrics.get(test_topic).published_bytes);
    for (g.sessions.rows[0..12], 0..) |*peer, index| {
        const io = &peer.io;
        try std.testing.expectEqual(@as(usize, 0), io.tx.critical.used);
        if (index == 0 or (index >= 2 and index <= 8)) {
            try std.testing.expectEqual(@as(usize, 1), io.tx.data.count);
            try std.testing.expectEqual(@as(u64, 1), io.tx.rpc_sent.message);
            try std.testing.expectEqual(h, (io.tx.data.next(&g.messages.store, g.last_now_ms, g.options.tx_timeout_ms)).?.message);
        } else try std.testing.expectEqual(@as(usize, 0), io.tx.data.count);
        io.tx.cancelStream();
    }
    g.sessions.rows[2].outbound = .none;
    const full = &g.sessions.rows[3].io.tx;
    for (0..outbox.data_capacity) |_| {
        const origin: delivery.Origin = if (full.data.full()) .publication else .forward;
        try std.testing.expectEqual(.queued, full.queueData(&g.messages.store, h, origin, .{ .bytes = constants.tx_peer_bytes }, 2));
    }
    const full_messages = full.rpc_sent.message;
    const flood = try g.publishWithOptions(test_topic, "flood", .{ .flood = true }, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .selected = 7, .queued = 6, .pressured = 1 }, flood);
    try std.testing.expectEqual(full_messages, full.rpc_sent.message);
    const flood_id = topic_mod.validMessageId(test_topic, "flood", .{});
    const flood_h = g.messages.history.message(g.messages.history.get(&g.messages.store, flood_id).?);
    try std.testing.expectEqual(first_bytes + @as(u64, g.messages.store.get(flood_h).?.len) * 6, g.topic_metrics.get(test_topic).published_bytes);
}

test "publication failed history admission retains payloads and recovery attribution" {
    var limits: gossip_limits.Limits = @splat(.{ .items = 2, .bytes = message_store.page_bytes });
    limits[@intFromEnum(topic_mod.Kind.beacon_block)] = .{ .items = 80, .bytes = 80 * message_store.page_bytes };
    var boundary: topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    boundary.rules[@intFromEnum(topic_mod.Kind.beacon_block)] = .{ .count = 1, .ssz_max = 64 * message_store.page_bytes };
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .topic_policy = &.{boundary}, .payload_limits = limits, .validation_capacity = gossip_limits.items(&limits) });
    defer g.deinit();
    const conn: Engine.Handle = .{ .index = 0, .generation = 1 };
    const peer = support.addPeer(&g, conn, .v1_2).?;
    var random = std.Random.DefaultPrng.init(1);
    var payload: [1024]u8 = undefined;
    random.random().bytes(&payload);
    var retained: [80]message_store.Handle = undefined;
    for (&retained, 0..) |*h, i| {
        payload[0] = @intCast(i);
        _ = try g.publish(test_topic, &payload, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
        h.* = g.messages.history.message(g.messages.history.get(&g.messages.store, topic_mod.validMessageId(test_topic, &payload, .{})).?);
    }
    try std.testing.expectEqual(.queued, g.sessions.rows[peer.index].io.tx.queueData(&g.messages.store, retained[0], .forward, Gossipsub.delivery_limits, 1));
    const retry = try std.testing.allocator.alloc(u8, 64 * message_store.page_bytes);
    defer std.testing.allocator.free(retry);
    random.random().bytes(retry);
    // The compressed replacement needs 65 pages, one more than a reclamation pass can free.
    const compressed = try snappy.raw.compress(retry, g.msg_scratch);
    try std.testing.expectEqual(@as(usize, 65), message_store.Store.pagesFor(compressed));
    const id = topic_mod.validMessageId(test_topic, retry, .{});
    const logical = g.sessions.rows[peer.index].logical;
    const second_conn: Engine.Handle = .{ .index = 1, .generation = 1 };
    const second_peer = support.addPeer(&g, second_conn, .v1_2).?;
    const second_logical = g.sessions.rows[second_peer.index].logical;
    try g.recovery.add(&g.peers, id, logical, conn, 1, 30_000);
    try g.recovery.add(&g.peers, id, second_logical, second_conn, 2, 30_000);
    g.recovery.controlSent(conn, 1, 12_000, 1);
    try std.testing.expectError(error.ResourceExhausted, g.publish(test_topic, retry, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 })));
    try std.testing.expectEqual(@as(u64, retained.len), g.topic_metrics.get(test_topic).published);
    try std.testing.expect(!g.messages.seen.contains(id, 2));
    try std.testing.expectEqual(@as(usize, 2), g.recovery.len);
    try std.testing.expectEqual(@as(u64, 12_001), g.recovery.batches[0].expiry);
    try std.testing.expectEqual(@as(u32, 1), g.peers.rows[logical.index].pins);
    try std.testing.expectEqual(@as(u32, 1), g.peers.rows[second_logical.index].pins);
    try std.testing.expectEqual(retained.len, g.messages.history.count);
    for (retained, 0..) |h, i| {
        payload[0] = @intCast(i);
        var decoded: [1024]u8 = undefined;
        const size = try snappy.raw.uncompress(g.messages.store.segment(h, g.messages.store.cursor(h)), &decoded);
        try std.testing.expectEqualSlices(u8, &payload, decoded[0..size]);
    }
    try std.testing.expectEqual(@as(usize, 1), g.sessions.rows[peer.index].io.tx.data.count);
    for (0..constants.mcache_len) |_| support.ageHistory(&g);
    _ = try g.publish(test_topic, retry, Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 0), g.recovery.len);
    try std.testing.expectEqual(@as(u32, 0), g.peers.rows[logical.index].pins);
    try std.testing.expectEqual(@as(u32, 0), g.peers.rows[second_logical.index].pins);
    try std.testing.expectError(error.UnknownTopic, g.publish("invalid", "bytes", Now.fromMilliseconds(.{ .mono_ms = 4, .unix_s = 0 })));
    const oversized = try std.testing.allocator.alloc(u8, constants.MAX_PAYLOAD_SIZE + 1);
    defer std.testing.allocator.free(oversized);
    try std.testing.expectError(error.PayloadTooLarge, g.publish(test_topic, oversized, Now.fromMilliseconds(.{ .mono_ms = 4, .unix_s = 0 })));
    try std.testing.expectEqual(@as(u64, retained.len + 1), g.topic_metrics.get(test_topic).published);
    try std.testing.expectEqual(@as(u64, 0), g.topic_metrics.get("invalid").published);
}

test "publication empty subscribed mesh reuses bounded fanout and full mesh excludes extra peers" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .connected_capacity = 16, .retained_capacity = 33, .retained_outbound_reserve = 1 });
    defer g.deinit();
    try support.subscribe(&g, test_topic);
    const t = g.overlay.findTopic(test_topic).?;
    for (0..10) |index| {
        const conn: Engine.Handle = .{ .index = @intCast(index), .generation = 1 };
        const p = support.addPeer(&g, conn, .v1_2).?;
        _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), p.index, test_topic, true);
        g.sessions.rows[p.index].outbound = .{ .live = .{ .stream = .{ .conn = conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
    }
    const first = try g.publish(test_topic, "empty mesh", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .selected = 8, .queued = 8 }, first);
    const fanout = g.overlay.fanoutMembers(t).*;
    try std.testing.expectEqual(@as(usize, 8), fanout.count());
    try std.testing.expectEqual(@as(usize, 0), g.overlay.mesh(t).count());
    _ = try g.publish(test_topic, "reuse fanout", Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    try std.testing.expectEqual(fanout, g.overlay.fanoutMembers(t).*);
    for (0..8) |index| g.overlay.rows[t].mesh.set(index);
    for (g.sessions.rows) |*peer| peer.io.tx.cancelStream();
    const full = try g.publish(test_topic, "full mesh", Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 0 }));
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .selected = 8, .queued = 8 }, full);
    for (g.sessions.rows[0..10], 0..) |*peer, index| try std.testing.expectEqual(@as(usize, if (index < 8) 1 else 0), peer.io.tx.data.count);
}

test "publication local IDONTWANT cannot suppress exact bytes over QUIC" {
    var pair: test_pair.Pair = .{};
    try pair.init();
    defer pair.deinit();
    try support.subscribe(pair.shared.client.gossipsub, test_topic);
    try support.subscribe(pair.shared.server.gossipsub, test_topic);
    for (0..20) |_| try pair.pumpOnce();
    const destination = pair.shared.client.gossipsub.sessions.find(pair.shared.handles.client).?;
    const id = topic_mod.validMessageId(test_topic, "originated wire bytes", .{});
    pair.shared.client.gossipsub.sessions.suppress(destination, id, pair.shared.pair.now.millis(), 60_000);
    const outcome = try pair.shared.client.gossipsub.publishWithOptions(test_topic, "originated wire bytes", .{ .allow_zero_peers = false }, pair.shared.pair.now);
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .selected = 1, .queued = 1 }, outcome);
    var received: usize = 0;
    for (0..30) |_| {
        try pair.pumpOnce();
        for (pair.serverMessages()) |message| {
            try std.testing.expectEqual(id, message.id);
            try std.testing.expectEqualStrings(test_topic, message.topic);
            try std.testing.expectEqualStrings("originated wire bytes", message.bytes);
            received += 1;
        }
    }
    try std.testing.expectEqual(@as(usize, 1), received);
}

test "publication uses known topics beyond the local subscription limit" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .topic_policy = &topic_fixture.churn });
    defer g.deinit();
    for (0..constants.topics_cap) |i| {
        var bytes: [128]u8 = undefined;
        const name = try topic_fixture.churnTopic(i, &bytes);
        try support.subscribe(&g, name);
    }
    _ = try g.publish(test_topic, "body", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    try std.testing.expectError(error.UnknownTopic, g.publish("invalid", "body", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })));
}

test "delivery recipients count refused frames and completions by origin" {
    const Origin = @import("delivery.zig").Origin;
    const Outcome = @import("metrics.zig").Delivery.Outcome;
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const conn: Engine.Handle = .{ .index = 0, .generation = 1 };
    const peer = support.addPeer(&g, conn, .v1_2).?;
    _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), peer.index, test_topic, true);
    g.markDirect(conn);
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .selected = 1, .queued = 1 }, try g.publish(test_topic, "filler", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })));
    const id = topic_mod.validMessageId(test_topic, "filler", .{});
    const filler = g.messages.history.message(g.messages.history.get(&g.messages.store, id).?);
    const io = &g.sessions.rows[peer.index].io;
    // Forwards fill the ordinary allowance and publications the local reserve.
    for (1..outbox.data_capacity) |_| {
        const origin: Origin = if (io.tx.data.full()) .publication else .forward;
        try std.testing.expectEqual(.queued, io.tx.queueData(&g.messages.store, filler, origin, .{ .bytes = constants.tx_peer_bytes }, 1));
    }
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .selected = 1, .pressured = 1 }, try g.publish(test_topic, "refused", Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 })));
    var body: [32]u8 = undefined;
    var writer = protobuf.Writer.init(&body);
    writer.bytesField(1, &id);
    support.control(&g, peer.index, .{ .iwant = .{ .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 0 }));
    const recipients = &g.delivery_metrics.recipients;
    try std.testing.expectEqual(@as(u64, 1), recipients[@intFromEnum(Origin.publication)][@intFromEnum(Outcome.pressured)]);
    try std.testing.expectEqual(@as(u64, 1), recipients[@intFromEnum(Origin.iwant)][@intFromEnum(Outcome.pressured)]);
    try std.testing.expectEqual(@as(u64, 2), io.tx.drops[@intFromEnum(outbox.DropReason.data_descriptors)]);
    // The first queued frame was the publication.
    for (0..16) |_| {
        const segment = io.tx.segment(&g.messages.store, 0);
        g.advanceWrite(g.sessions.ref(peer.index), segment.len, 40);
        if (recipients[@intFromEnum(Origin.publication)][@intFromEnum(Outcome.completed)] == 1) break;
    }
    try std.testing.expectEqual(@as(u64, 1), recipients[@intFromEnum(Origin.publication)][@intFromEnum(Outcome.completed)]);
    try std.testing.expectEqual(@as(u64, 0), recipients[@intFromEnum(Origin.forward)][@intFromEnum(Outcome.completed)]);
    io.tx.cancelStream();
}

test "publication priority belongs to each attempt: an IWANT for our publication is ordinary" {
    const Origin = @import("delivery.zig").Origin;
    const Outcome = @import("metrics.zig").Delivery.Outcome;
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const conn: Engine.Handle = .{ .index = 0, .generation = 1 };
    const peer = support.addPeer(&g, conn, .v1_2).?;
    _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), peer.index, test_topic, true);
    g.markDirect(conn);
    const io = &g.sessions.rows[peer.index].io;
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .selected = 1, .queued = 1 }, try g.publish(test_topic, "mine", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })));
    const id = topic_mod.validMessageId(test_topic, "mine", .{});
    var body: [32]u8 = undefined;
    var writer = protobuf.Writer.init(&body);
    writer.bytesField(1, &id);
    support.control(&g, peer.index, .{ .iwant = .{ .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 1), io.tx.data.classCount(.local));
    try std.testing.expectEqual(@as(usize, 1), io.tx.data.classCount(.ordinary));
    try std.testing.expectEqual(@as(usize, 1), io.tx.data.origins[@intFromEnum(Origin.iwant)]);
    // Both frames complete, the local one first; a later publication is cancelled by a reset.
    for (0..16) |_| {
        const segment = io.tx.segment(&g.messages.store, 0);
        if (segment.len == 0) break;
        g.advanceWrite(g.sessions.ref(peer.index), segment.len, 3);
    }
    _ = try g.publish(test_topic, "cancelled", Now.fromMilliseconds(.{ .mono_ms = 4, .unix_s = 0 }));
    try std.testing.expectEqual(@as(u64, 3), io.tx.rpc_sent.message);
    g.cancelWrites(g.sessions.ref(peer.index));
    try std.testing.expectEqual(@as(u64, 3), io.tx.rpc_sent.message);
    const recipients = &g.delivery_metrics.recipients;
    const publication = recipients[@intFromEnum(Origin.publication)];
    const iwant = recipients[@intFromEnum(Origin.iwant)];
    for ([_]Outcome{ .selected, .queued, .completed, .cancelled, .pressured, .unavailable }, [_]u64{ 2, 2, 1, 1, 0, 0 }, [_]u64{ 1, 1, 1, 0, 0, 0 }) |outcome, local, ordinary| {
        try std.testing.expectEqual(local, publication[@intFromEnum(outcome)]);
        try std.testing.expectEqual(ordinary, iwant[@intFromEnum(outcome)]);
    }
}

test "gossipsub queues incompressible 64 KiB publish" {
    var g = try support.init(std.testing.allocator, .{
        .random_seed = 1,
    });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const topic = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, topic);
    g.overlay.rows[g.overlay.findTopic(topic).?].mesh.set(peer.index);
    var payload: [65536]u8 = undefined;
    var rng = std.Random.DefaultPrng.init(42);
    rng.random().bytes(&payload);
    try std.testing.expectEqual(@as(u16, 1), (try g.publish(topic, &payload, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 1 }))).queued);
}
