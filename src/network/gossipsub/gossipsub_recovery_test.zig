const support = @import("test_support.zig");
const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const topic_mod = @import("topic.zig");
const Engine = @import("../quic/Engine.zig");
const Pair = @import("test_pair.zig").Pair;
const test_topic = "/eth2/01020304/beacon_block/ssz_snappy";
const MessageId = Gossipsub.MessageId;
const constants = @import("constants.zig");
const protobuf = @import("protobuf.zig");
const peers_mod = @import("peer_book.zig");
const Handle = Engine.Handle;
const Now = @import("../types.zig").Now;
const peer_id = @import("../wire/peer_id.zig");
const outbox = @import("outbox.zig");
const delivery = @import("delivery.zig");
const Recovery = @import("recovery.zig");
const IwantOutcome = @import("metrics.zig").IwantOutcome;
const resource_options: Gossipsub.Options = .{ .random_seed = 1, .connected_capacity = 3, .retained_capacity = 9, .retained_outbound_reserve = 1, .validation_capacity = 1, .mcache_capacity = 2, .seen_capacity = 4 };

test "gossipsub IHAVE saturation preserves recovery for new and reconnected identities" {
    const decay = @exp(@log(@as(f64, 0.01)) / 320);
    const target = 0.3125 / (1 - decay) - 6;
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .connected_capacity = 8, .retained_capacity = 420, .retained_outbound_reserve = 1, .iwant_followup_ms = 12000, .score_params = .{ .behaviour_weight = -4000 / (target * target), .behaviour_decay = decay } });
    defer g.deinit();
    try support.subscribe(&g, test_topic);
    for (0..8) |index| _ = support.addPeer(&g, .{ .index = @intCast(index), .generation = 1 }, .v1_2).?;
    var bytes: [4096]u8 = undefined;
    var writer = protobuf.Writer.init(&bytes);
    for (0..7) |peer| {
        const io = &g.sessions.rows[peer].io;
        for (0..constants.max_ihave_per_heartbeat) |batch| {
            writer.len = 0;
            for (0..constants.gossip_ids_max) |item| {
                var id: MessageId = @splat(0);
                std.mem.writeInt(u32, id[0..4], @intCast((peer * constants.max_ihave_per_heartbeat + batch) * constants.gossip_ids_max + item), .little);
                writer.bytesField(2, &id);
            }
            support.control(&g, @intCast(peer), .{ .ihave = .{ .topic = test_topic, .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
            for (0..4) |_| {
                const segment = io.tx.segment(&g.messages.store, 0);
                if (segment.len == 0) break;
                if (io.tx.advance(segment.len)) |completion| g.writeCompleted(g.sessions.ref(@intCast(peer)), completion, 1);
            }
        }
    }
    const reserve = Recovery.promises_reserved_per_peer;
    try std.testing.expectEqual(constants.promises_cap - @as(usize, g.peers.pin_limit - 7) * reserve, g.recovery.len);
    const occupied = g.recovery.len;
    const old = g.logical(0);
    const conn = g.sessions.rows[0].conn;
    g.connectionClosed(conn);
    try std.testing.expectEqual(occupied, g.recovery.len);
    try std.testing.expect(g.peers.rows[old.index].pins > 0);
    const reconnect = g.addPeer(.{ .index = 0, .generation = 2 }, &.{ .identity = g.peers.rows[old.index].identity, .address = .unspecified, .direction = .inbound }, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 })).admitted;
    var fresh: [1]MessageId = .{@splat(255)};
    try std.testing.expectEqual(old, g.logical(reconnect.index));
    try std.testing.expectError(error.PeerCapacity, g.recovery.filterPending(&g.peers, old, &fresh));
    writer.len = 0;
    for (0..constants.gossip_ids_max) |item| {
        var id: MessageId = @splat(255);
        id[0] = @intCast(item);
        writer.bytesField(2, &id);
    }
    support.control(&g, 7, .{ .ihave = .{ .topic = test_topic, .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    try std.testing.expectEqual(@as(u16, reserve), g.sessions.rows[7].io.iwant_ids_sent);
    try std.testing.expectEqual(occupied + reserve, g.recovery.len);
    try std.testing.expectError(error.PeerCapacity, g.recovery.filterPending(&g.peers, g.logical(7), &fresh));
    _ = g.recovery.cancel(&g.peers, conn, true);
    try std.testing.expect((try g.recovery.filterPending(&g.peers, g.logical(7), &fresh)).capacity > reserve);
    g.recovery.clear(&g.peers);
    try std.testing.expectEqual(@as(usize, constants.promises_cap), g.recovery.available());
}

fn expectControlFloodBounded(control_tag: u8) !void {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .items_per_peer = 4096, .items_per_pump = 8192 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?.index;
    const controls_per_rpc = 4096;
    const io = &g.sessions.rows[peer].io;
    var rpc: [5 * controls_per_rpc + 8]u8 = undefined;
    var writer = protobuf.Writer.init(&rpc);
    writer.tag(3, 2);
    writer.varint(controls_per_rpc * @as(usize, if (control_tag == 0x0a) 5 else 2));
    for (0..controls_per_rpc) |_| {
        writer.bytes(&.{ control_tag, if (control_tag == 0x0a) 3 else 0 });
        if (control_tag == 0x0a) writer.bytesField(1, "t");
    }
    // Seventeen RPCs carry more controls than a u16 counts, all inside one heartbeat.
    for (0..17) |_| {
        io.startRpc(writer.written());
        var done = false;
        for (0..controls_per_rpc + 1) |_| {
            var delivered: usize = 0;
            var items: usize = g.options.items_per_peer;
            done = try support.processRpc(&g, peer, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }), &delivered, &items);
            if (done) break;
        }
        try std.testing.expect(done);
        _ = g.sessions.finishFrame(io);
    }
    try std.testing.expectEqual(@as(u16, if (control_tag == 0x0a) 10 else 0), if (control_tag == 0x0a) io.ihave_recv else io.idontwant_recv);
}

test "gossipsub bounds more than 65535 IHAVE controls per heartbeat" {
    try expectControlFloodBounded(0x0a);
}

test "gossipsub bounds more than 65535 IDONTWANT controls per heartbeat" {
    try expectControlFloodBounded(0x2a);
}

test "gossipsub legal maximum IWANT response uses actual IO without mesh publish" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    try support.subscribe(setup.shared.server.gossipsub, test_topic);
    try support.subscribe(setup.shared.client.gossipsub, test_topic);
    for (0..20) |_| try setup.pumpOnce();
    const payload = try std.testing.allocator.alloc(u8, constants.MAX_PAYLOAD_SIZE);
    defer std.testing.allocator.free(payload);
    var rng = std.Random.DefaultPrng.init(73);
    rng.random().bytes(payload);
    const destination = setup.shared.client.gossipsub.sessions.find(setup.shared.handles.client).?;
    _ = setup.shared.client.gossipsub.overlay.peerSubscription(&setup.shared.client.gossipsub.overlayContext(setup.shared.client.gossipsub.last_now_ms), destination, test_topic, false);
    const result = try setup.shared.client.gossipsub.publish(test_topic, payload, setup.shared.pair.now);
    try std.testing.expectEqual(@as(u16, 0), result.queued);
    _ = setup.shared.client.gossipsub.overlay.peerSubscription(&setup.shared.client.gossipsub.overlayContext(setup.shared.client.gossipsub.last_now_ms), destination, test_topic, true);
    const id = topic_mod.validMessageId(test_topic, payload, .{});
    const pb = @import("protobuf.zig");
    var buf: [64]u8 = undefined;
    var w = pb.Writer.init(&buf);
    w.varint(pb.iwantRpcSize(1, 20));
    pb.beginIwantRpc(&w, 1, 20);
    pb.writeIwantId(&w, &id);
    try std.testing.expectEqual(w.len, try setup.shared.pair.server.write(setup.serverStream(), w.written(), false));
    var received = false;
    for (0..2000) |_| {
        try setup.pumpOnce();
        for (setup.serverMessages()) |message| {
            try std.testing.expectEqualSlices(u8, payload, message.bytes);
            received = true;
        }
        if (received) break;
    }
    try std.testing.expect(received);
    const cached = setup.shared.client.gossipsub.messages.history.get(&setup.shared.client.gossipsub.messages.store, id).?;
    const history = &setup.shared.client.gossipsub.messages.history;
    const logical = setup.shared.client.gossipsub.sessions.rows[destination].logical;
    try std.testing.expect(!history.iwantAllowed(cached, logical, 1));
    try std.testing.expect(history.iwantAllowed(cached, logical, 2));
}

test "gossipsub IWANT promises commit on queue and start at completed control transmission" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .control_bytes = 64 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const topic = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, topic);
    var body: [32]u8 = undefined;
    var w = protobuf.Writer.init(&body);
    const id = [_]u8{7} ** 20;
    w.bytesField(2, &id);
    try std.testing.expect(g.sessions.rows[peer.index].io.tx.inject(&([_]u8{0} ** 64), 1));
    support.control(&g, peer.index, .{ .ihave = .{ .topic = topic, .body = w.written() } }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 1 }));
    try std.testing.expectEqual(@as(usize, 0), g.recovery.len);
    g.sessions.rows[peer.index].io.tx.cancelStream();
    support.control(&g, peer.index, .{ .ihave = .{ .topic = topic, .body = w.written() } }, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 1 }));
    try std.testing.expectEqual(@as(usize, 1), g.recovery.len);
    support.heartbeat(&g, Now.fromMilliseconds(.{ .mono_ms = 1_000, .unix_s = 0 }));
    try std.testing.expectEqual(@as(u64, 0), g.counters.broken_promises);
    const io = &g.sessions.rows[peer.index].io;
    const first = io.tx.segment(&g.messages.store, 0);
    _ = io.tx.advance(1);
    try std.testing.expectEqual(@as(u64, 3_002), g.recovery.batches[0].expiry);
    const token = io.tx.advance(first.len - 1).?.control.token;
    g.recovery.controlSent(g.sessions.rows[peer.index].conn, token, g.options.iwant_followup_ms, 1_000);
    try std.testing.expectEqual(@as(u64, 4_000), g.recovery.batches[0].expiry);
}

test "gossipsub IHAVE pending and duplicate prefixes do not hide new tail IDs" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    var bytes: [8192]u8 = undefined;
    var writer = protobuf.Writer.init(&bytes);
    for (0..constants.gossip_ids_max) |i| {
        const id: MessageId = @splat(@intCast(i));
        writer.bytesField(2, &id);
    }
    support.control(&g, peer.index, .{ .ihave = .{ .topic = name, .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 1 }));
    try std.testing.expectEqual(constants.gossip_ids_max, g.recovery.len);
    const first_tail: MessageId = @splat(128);
    for (0..constants.gossip_ids_max) |_| writer.bytesField(2, &first_tail);
    const second_tail: MessageId = @splat(129);
    writer.bytesField(2, &second_tail);
    support.control(&g, peer.index, .{ .ihave = .{ .topic = name, .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 1 }));
    try std.testing.expectEqual(constants.gossip_ids_max + 2, g.recovery.len);
    try std.testing.expectEqual(@as(u16, constants.gossip_ids_max + 2), g.sessions.rows[peer.index].io.iwant_ids_sent);
    support.control(&g, peer.index, .{ .ihave = .{ .topic = name, .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 1 }));
    try std.testing.expectEqual(constants.gossip_ids_max + 2, g.recovery.len);
}

test "gossipsub IHAVE samples eligible IDs across the advertisement independently per peer" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .connected_capacity = 2, .retained_capacity = 9, .retained_outbound_reserve = 1 });
    defer g.deinit();
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    var bytes: [16384]u8 = undefined;
    var writer = protobuf.Writer.init(&bytes);
    for (0..512) |i| {
        var id: MessageId = @splat(0);
        std.mem.writeInt(u16, id[0..2], @intCast(i), .big);
        writer.bytesField(2, &id);
        if (i < 16) _ = g.messages.seen.add(id, 0);
    }
    for (0..2) |i| {
        const peer = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
        support.control(&g, peer.index, .{ .ihave = .{ .topic = name, .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    }
    try std.testing.expectEqual(@as(usize, 2), g.recovery.batch_len);
    var selected: [2]std.StaticBitSet(512) = @splat(.empty);
    for (g.recovery.batches[0..2], 0..) |batch, peer| {
        try std.testing.expectEqual(@as(u16, constants.gossip_ids_max), batch.count);
        var slot = batch.head;
        var high = false;
        for (0..batch.count) |_| {
            const request = &g.recovery.requests[slot];
            const id = std.mem.readInt(u16, request.id[0..2], .big);
            try std.testing.expect(id >= 16 and id < 512 and !selected[peer].isSet(id));
            selected[peer].set(id);
            high = high or id >= 256;
            slot = request.next;
        }
        try std.testing.expect(high);
    }
    try std.testing.expect(!selected[0].eql(selected[1]));
    try std.testing.expectEqual(@as(usize, 2 * constants.gossip_ids_max), g.recovery.len);
}

test "gossipsub IHAVE security bounds one identity and deduplicates queued requests" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .iwant_followup_ms = 12000 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    var bytes: [4096]u8 = undefined;
    var writer = protobuf.Writer.init(&bytes);
    const duplicate = [_]u8{7} ** 20;
    for (0..128) |_| writer.bytesField(2, &duplicate);
    const io = &g.sessions.rows[peer.index].io;
    for (0..2) |_| support.control(&g, peer.index, .{ .ihave = .{ .topic = name, .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 1 }));
    try std.testing.expectEqual(@as(usize, 1), g.recovery.len);
    for (0..7) |heartbeat| {
        io.resetHeartbeat();
        for (0..constants.max_ihave_per_heartbeat) |batch| {
            writer.len = 0;
            for (0..constants.gossip_ids_max) |item| {
                var id: MessageId = @splat(0);
                std.mem.writeInt(u32, id[0..4], @intCast((heartbeat * constants.max_ihave_per_heartbeat + batch) * constants.gossip_ids_max + item), .little);
                writer.bytesField(2, &id);
            }
            support.control(&g, peer.index, .{ .ihave = .{ .topic = name, .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = heartbeat * 1000, .unix_s = 1 }));
            for (0..4) |_| {
                const segment = io.tx.segment(&g.messages.store, 0);
                if (segment.len == 0) break;
                if (io.tx.advance(segment.len)) |completion| g.writeCompleted(g.sessions.ref(peer.index), completion, heartbeat * 1000);
            }
        }
    }
    try std.testing.expectEqual(@as(usize, constants.gossip_ids_max * constants.max_ihave_per_heartbeat), g.recovery.len);
    const other = support.addPeer(&g, .{ .index = 1, .generation = 1 }, .v1_2).?;
    const occupied = g.recovery.len;
    support.control(&g, other.index, .{ .ihave = .{ .topic = name, .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = 7000, .unix_s = 1 }));
    try std.testing.expectEqual(occupied + constants.gossip_ids_max, g.recovery.len);
    try std.testing.expectEqual(occupied, g.recovery.cancel(&g.peers, g.sessions.rows[peer.index].conn, true).removed);
    io.resetHeartbeat();
    support.control(&g, peer.index, .{ .ihave = .{ .topic = name, .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = 7000, .unix_s = 1 }));
    try std.testing.expectEqual(@as(usize, 2 * constants.gossip_ids_max), g.recovery.len);
}

test "gossipsub history queue refusal and authenticated reconnect preserve retransmission counts" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .mcache_capacity = 2 });
    defer g.deinit();
    const metadata: peers_mod.Metadata = .{
        .identity = .{ .bytes = [_]u8{1} ** peer_id.length },
        .address = .unspecified,
        .direction = .inbound,
    };
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    const first = g.addPeer(.{ .index = 0, .generation = 1 }, &metadata, now).admitted;
    g.sessions.setOutbound(first.index, .{ .live = .{ .stream = .{ .conn = g.sessions.rows[first.index].conn, .id = 2, .slot = 0 }, .version = .v1_2 } });
    const logical_peer = g.sessions.rows[first.index].logical;
    const id: MessageId = @splat(9);
    const message = g.messages.store.put(g.overlay.namespace.topicAt(0).name.kind, id, g.overlay.topicString(0), "payload").?;
    g.messages.history.put(&g.messages.store, message, 0, g.cycle.epoch);
    g.messages.store.seal(message);
    var bytes: [64]u8 = undefined;
    var writer = protobuf.Writer.init(&bytes);
    protobuf.beginIwantRpc(&writer, 1, id.len);
    protobuf.writeIwantId(&writer, &id);
    var reader = protobuf.RpcReader.init(writer.written());
    const iwant = (try reader.next()).?.iwant;
    // Forwards fill the ordinary allowance and publications the local reserve.
    const tx = &g.sessions.rows[first.index].io.tx;
    for (0..outbox.data_capacity) |_| {
        const origin: delivery.Origin = if (tx.data.full()) .publication else .forward;
        try std.testing.expectEqual(outbox.QueueResult.queued, tx.queueData(&g.messages.store, message, origin, .{ .bytes = constants.tx_peer_bytes }, 1));
    }
    support.control(&g, first.index, .{ .iwant = iwant }, Now.fromMilliseconds(.{ .mono_ms = g.last_now_ms, .unix_s = 0 }));
    try std.testing.expect(g.messages.history.iwantAllowed(g.messages.history.get(&g.messages.store, id).?, logical_peer, 1));
    try std.testing.expectEqual(@as(u64, 1), g.iwant_outcomes[@intFromEnum(IwantOutcome.refused)]);
    g.sessions.rows[first.index].io.tx.cancelStream();
    for (0..4) |_| support.control(&g, first.index, .{ .iwant = iwant }, Now.fromMilliseconds(.{ .mono_ms = g.last_now_ms, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 3), g.sessions.rows[first.index].io.tx.data.count);
    g.connectionClosed(.{ .index = 0, .generation = 1 });
    const second = g.addPeer(.{ .index = 0, .generation = 2 }, &metadata, now).admitted;
    g.sessions.setOutbound(second.index, .{ .live = .{ .stream = .{ .conn = g.sessions.rows[second.index].conn, .id = 2, .slot = 0 }, .version = .v1_2 } });
    try std.testing.expectEqual(logical_peer, g.sessions.rows[second.index].logical);
    support.control(&g, second.index, .{ .iwant = iwant }, Now.fromMilliseconds(.{ .mono_ms = g.last_now_ms, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[second.index].io.tx.data.count);
    g.connectionClosed(.{ .index = 0, .generation = 2 });
    const expired: Now = Now.fromMilliseconds(.{ .mono_ms = g.peers.retention_ms + 2, .unix_s = 0 });
    const third = g.addPeer(.{ .index = 0, .generation = 3 }, &metadata, expired).admitted;
    g.sessions.setOutbound(third.index, .{ .live = .{ .stream = .{ .conn = g.sessions.rows[third.index].conn, .id = 2, .slot = 0 }, .version = .v1_2 } });
    try std.testing.expectEqual(logical_peer.index, g.sessions.rows[third.index].logical.index);
    try std.testing.expect(g.sessions.rows[third.index].logical.generation > logical_peer.generation);
    for (0..4) |_| support.control(&g, third.index, .{ .iwant = iwant }, Now.fromMilliseconds(.{ .mono_ms = g.last_now_ms, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 3), g.sessions.rows[third.index].io.tx.data.count);
}

test "recovery owner clear releases sent and unsent attribution pins" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const conn: Handle = .{ .index = 0, .generation = 1 };
    const peer = support.addPeer(&g, conn, .v1_2).?;
    const ref = g.sessions.rows[peer.index].logical;
    try g.recovery.add(&g.peers, [_]u8{1} ** 20, g.sessions.rows[peer.index].logical, g.sessions.rows[peer.index].conn, 1, 30_000);
    try g.recovery.add(&g.peers, [_]u8{2} ** 20, g.sessions.rows[peer.index].logical, g.sessions.rows[peer.index].conn, 2, 30_000);
    g.recovery.controlSent(g.sessions.rows[peer.index].conn, 1, g.options.iwant_followup_ms, 10);
    try std.testing.expectEqual(@as(u32, 2), g.peers.rows[ref.index].pins);
    g.recovery.clear(&g.peers);
    try std.testing.expectEqual(@as(u32, 0), g.peers.rows[ref.index].pins);
    g.recovery.controlSent(g.sessions.rows[peer.index].conn, 2, g.options.iwant_followup_ms, 20);
    support.heartbeat(&g, Now.fromMilliseconds(.{ .mono_ms = 4000, .unix_s = 0 }));
    try std.testing.expectEqual(@as(u64, 0), g.counters.broken_promises);
}

test "gossipsub configured IWANT receipt starts twelve second deadline once" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .iwant_followup_ms = 12_000 });
    defer g.deinit();
    const conn: Handle = .{ .index = 0, .generation = 1 };
    const p = support.addPeer(&g, conn, .v1_2).?;
    const io = &g.sessions.rows[p.index].io;
    const token = io.tx.injectFrame("control", false, 1).?;
    try g.recovery.add(&g.peers, [_]u8{1} ** 20, g.sessions.rows[p.index].logical, conn, token, 30_000);
    g.recovery.controlSent(.{ .index = 0, .generation = 2 }, token, 12_000, 5);
    g.recovery.controlSent(g.sessions.rows[p.index].conn, token + 1, g.options.iwant_followup_ms, 5);
    try std.testing.expectEqual(@as(u64, 30_000), g.recovery.batches[0].expiry);
    _ = io.tx.segment(&g.messages.store, 0);
    try std.testing.expect(io.tx.advance(1) == null);
    try std.testing.expectEqual(@as(u64, 30_000), g.recovery.batches[0].expiry);
    g.writeCompleted(g.sessions.ref(p.index), io.tx.advance(6).?, 100);
    g.recovery.controlSent(g.sessions.rows[p.index].conn, token, g.options.iwant_followup_ms, 200);
    try std.testing.expectEqual(@as(u64, 12_100), g.recovery.batches[0].expiry);
    support.heartbeat(&g, Now.fromMilliseconds(.{ .mono_ms = 12_099, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 1), g.recovery.len);
    support.heartbeat(&g, Now.fromMilliseconds(.{ .mono_ms = 12_100, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 0), g.recovery.len);
    try std.testing.expectEqual(@as(u64, 1), g.counters.broken_promises);
    try std.testing.expectEqual(@as(u32, 0), g.peers.rows[g.sessions.rows[p.index].logical.index].pins);
}

test "gossip unsent IWANT expiry refunds recovery slots without blaming the peer" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const conn: Handle = .{ .index = 0, .generation = 1 };
    const peer = support.addPeer(&g, conn, .v1_2).?;
    const logical = g.sessions.rows[peer.index].logical;
    const capacity = g.recovery.available();
    try g.recovery.add(&g.peers, @splat(1), logical, conn, 1, 100);
    try std.testing.expectEqual(@as(u32, 1), g.peers.rows[logical.index].pins);
    g.recovery.controlSent(conn, 1, 3000, 100);
    support.heartbeat(&g, Now.fromMilliseconds(.{ .mono_ms = 100, .unix_s = 0 }));
    try std.testing.expectEqual(capacity, g.recovery.available());
    try std.testing.expectEqual(@as(u32, 0), g.peers.rows[logical.index].pins);
    try std.testing.expectEqual(@as(u64, 0), g.counters.broken_promises);
    try std.testing.expectEqual(@as(usize, 0), g.recovery.batch_len);
}

test "gossip recovery refusal restores promise slots and identity pins before returning" {
    var g = try support.init(std.testing.allocator, resource_options);
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const row = &g.sessions.rows[peer.index];
    const bytes = g.msg_scratch[0..row.io.tx.control.bytes.len];
    @memset(bytes, 1);
    try std.testing.expect(row.io.tx.inject(bytes, 0));
    const available = g.recovery.available();
    var ids: [2]Gossipsub.MessageId = .{ @splat(1), @splat(2) };
    _ = try g.recovery.filterPending(&g.peers, row.logical, &ids);
    try std.testing.expectError(error.OutboxFull, g.recovery.requestBatch(&g.peers, &row.io.tx, &g.sessions.control_scratch, &ids, row.logical, row.conn, g.overlay.rng.random(), g.options.iwant_followup_ms, 1));
    try std.testing.expectEqual(available, g.recovery.available());
    try std.testing.expectEqual(@as(usize, 0), g.recovery.batch_len);
    try std.testing.expect(std.mem.allEqual(u16, g.recovery.buckets, std.math.maxInt(u16)));
    try std.testing.expectEqual(@as(u32, 0), g.peers.rows[row.logical.index].pins);
    try std.testing.expect(row.io.tx.submit(&.{ .graft = test_topic }, &g.sessions.control_scratch, 1) != null);
    row.io.tx.cancelStream();
    _ = try g.recovery.filterPending(&g.peers, row.logical, &ids);
    try g.recovery.requestBatch(&g.peers, &row.io.tx, &g.sessions.control_scratch, &ids, row.logical, row.conn, g.overlay.rng.random(), g.options.iwant_followup_ms, 2);
    try std.testing.expectEqual(@as(usize, 2), g.recovery.len);
    try std.testing.expectEqual(g.recovery.buckets.len - 2, std.mem.count(u16, g.recovery.buckets, &.{std.math.maxInt(u16)}));
    try std.testing.expectEqual(@as(u32, 1), g.peers.rows[row.logical.index].pins);
    g.cancelWrites(peer);
    try std.testing.expectEqual(available, g.recovery.available());
    try std.testing.expect(std.mem.allEqual(u16, g.recovery.buckets, std.math.maxInt(u16)));
    try std.testing.expectEqual(@as(u32, 0), g.peers.rows[row.logical.index].pins);
}

test "gossip batches more than ten topic advertisements into one RPC" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const tx = &g.sessions.rows[peer.index].io.tx;
    for (0..20) |index| {
        const id: MessageId = @splat(@intCast(index));
        try std.testing.expect(tx.gossipTopic(test_topic, &.{id}));
    }
    try std.testing.expectEqual(@as(usize, 0), tx.control.count);
    try std.testing.expect(tx.finishGossip(1));
    try std.testing.expectEqual(@as(usize, 1), tx.control.count);
    var framed = protobuf.Reader.init(tx.control.segment());
    const length = try framed.varint();
    var reader = protobuf.RpcReader.init(tx.control.segment()[protobuf.varintLen(length)..]);
    for (0..20) |index| {
        const item = (try reader.next()).?;
        try std.testing.expectEqualStrings(test_topic, item.ihave.topic);
        var ids = item.ihave.ids();
        try std.testing.expectEqualSlices(u8, &(@as(MessageId, @splat(@intCast(index)))), (try ids.next()).?);
        try std.testing.expect(try ids.next() == null);
    }
    try std.testing.expect(try reader.next() == null);
}

test "gossip full attestation advertisements fit the control queue including framing" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const tx = &g.sessions.rows[peer.index].io.tx;
    const ids: [constants.gossip_ids_max]MessageId = @splat(@splat(1));
    var admitted: usize = 0;
    for (0..64) |subnet| {
        var name: [topic_mod.topic_max_len]u8 = undefined;
        const canonical = topic_mod.buildCanonical(.{ .digest = .{ 1, 2, 3, 4 }, .name = .{ .kind = .beacon_attestation, .subnet = @intCast(subnet) } }, &name);
        admitted += @intFromBool(tx.gossipTopic(canonical, &ids));
    }
    try std.testing.expectEqual(@as(usize, 9), admitted);
    try std.testing.expectEqual(@as(usize, 0), tx.control.used);
    try std.testing.expect(tx.finishGossip(1));
    try std.testing.expectEqual(@as(usize, 1), tx.control.count);
    try std.testing.expect(!tx.pressure_pending);
    try std.testing.expectEqual(@as(u64, 0), tx.drops[@intFromEnum(outbox.DropReason.control_bytes)]);
    var framed = protobuf.Reader.init(tx.control.segment());
    const length = try framed.varint();
    try std.testing.expectEqual(tx.control.used, protobuf.varintLen(length) + length);
    var reader = protobuf.RpcReader.init(tx.control.segment()[protobuf.varintLen(length)..]);
    for (0..admitted) |subnet| {
        const item = (try reader.next()).?;
        try std.testing.expectEqual(@as(u16, @intCast(subnet)), topic_mod.parseCanonical(item.ihave.topic).?.name.subnet);
        var advertised = item.ihave.ids();
        for (ids) |id| try std.testing.expectEqualSlices(u8, &id, (try advertised.next()).?);
        try std.testing.expect(try advertised.next() == null);
    }
    try std.testing.expect(try reader.next() == null);
}

test "gossip advertisement budget includes exact framing boundaries and queue pressure stays separate" {
    const ids: [constants.gossip_ids_max]MessageId = @splat(@splat(1));
    for ([_]usize{ 1, 3, 4, 5, constants.gossip_ids_max }) |count| {
        const rpc_len = protobuf.ihaveRpcSize(test_topic, count, constants.message_id_length);
        const frame_len = protobuf.varintLen(rpc_len) + rpc_len;
        for (0..2) |short_by| {
            var options = resource_options;
            options.control_bytes = frame_len - short_by;
            var g = try support.init(std.testing.allocator, options);
            defer g.deinit();
            const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
            const tx = &g.sessions.rows[peer.index].io.tx;
            try std.testing.expectEqual(short_by == 0, tx.gossipTopic(test_topic, ids[0..count]));
            try std.testing.expect(!tx.gossipTopic(test_topic, ids[0..count]));
            try std.testing.expect(!tx.pressure_pending);
            try std.testing.expectEqual(@as(u64, 0), tx.drops[@intFromEnum(outbox.DropReason.control_bytes)]);
            try std.testing.expectEqual(short_by == 0, tx.finishGossip(1));
            if (short_by != 0) continue;
            try std.testing.expectEqual(frame_len, tx.control.used);
            // A staged batch fits by itself, but a still-queued batch can prevent its submission.
            try std.testing.expect(tx.gossipTopic(test_topic, ids[0..count]));
            try std.testing.expect(!tx.finishGossip(2));
            try std.testing.expect(tx.pressure_pending);
            try std.testing.expectEqual(@as(u64, 1), tx.drops[@intFromEnum(outbox.DropReason.control_bytes)]);
            try std.testing.expectEqual(@as(usize, 0), tx.gossip_len);
            try std.testing.expectEqual(@as(usize, 0), tx.gossip_ids);
        }
    }
}

test "gossip bounded advertisements vary the first active topic across heartbeats" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .control_bytes = 100, .mcache_capacity = 3 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const row = &g.sessions.rows[peer.index];
    row.outbound = .{ .live = .{ .stream = .{ .conn = row.conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
    const names = [_][]const u8{
        "/eth2/01020304/beacon_block/ssz_snappy",
        "/eth2/01020304/beacon_attestation_63/ssz_snappy",
        "/eth2/01020304/data_column_sidecar_127/ssz_snappy",
    };
    for (names) |name| {
        try std.testing.expect(support.activate(&g, name) != null);
        try std.testing.expect(g.overlay.peerSubscription(&g.overlayContext(0), peer.index, name, true) != null);
    }
    var advertised = std.StaticBitSet(names.len).empty;
    for (0..32) |heartbeat| {
        const now = Now.fromMilliseconds(.{ .mono_ms = 1 + heartbeat * 1000, .unix_s = 0 });
        row.io.tx.cancelStream();
        for (names, 0..) |name, index| {
            var id: MessageId = @splat(@intCast(index));
            std.mem.writeInt(u32, id[0..4], @intCast(heartbeat), .little);
            try std.testing.expect(g.messages.publish(id, support.activate(&g, name).?, topic_mod.parseCanonical(name).?.name.kind, name, "payload", now.millis(), g.cycle.epoch) != null);
        }
        support.heartbeat(&g, now);
        for (0..g.overlay.rows.len) |_| {
            if (!g.cycle.isActive()) break;
            g.maintainTopics(now);
        }
        try std.testing.expect(!g.cycle.isActive());
        try std.testing.expectEqual(@as(usize, 1), row.io.tx.control.count);
        try std.testing.expect(!row.io.tx.pressure_pending);
        var framed = protobuf.Reader.init(row.io.tx.control.segment());
        const length = try framed.varint();
        var reader = protobuf.RpcReader.init(row.io.tx.control.segment()[protobuf.varintLen(length)..]);
        const item = (try reader.next()).?;
        for (names, 0..) |name, index| {
            if (std.mem.eql(u8, name, item.ihave.topic)) advertised.set(index);
        }
        try std.testing.expect(try reader.next() == null);
    }
    try std.testing.expectEqual(names.len, advertised.count());
    try std.testing.expectEqual(@as(u64, 64), g.counters.ihave_budget_skipped);
    try std.testing.expectEqual(@as(u64, 0), row.io.tx.drops[@intFromEnum(outbox.DropReason.control_bytes)]);
}

test "gossip IDONTWANT admits a burst of ids across RPCs and bounds the total" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    var bytes: [32]u8 = undefined;
    for (0..constants.max_idontwant_per_heartbeat + 1) |index| {
        var id: MessageId = @splat(0);
        std.mem.writeInt(u16, id[0..2], @intCast(index), .little);
        var writer = protobuf.Writer.init(&bytes);
        writer.bytesField(1, &id);
        support.control(&g, peer.index, .{ .idontwant = .{ .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
        try std.testing.expectEqual(index < constants.max_idontwant_per_heartbeat, g.sessions.suppresses(peer.index, id, 1));
    }
    try std.testing.expectEqual(constants.max_idontwant_per_heartbeat, g.sessions.rows[peer.index].io.idontwant_recv);
}

test "gossipsub recovery expires on heartbeats without scheduling its own wakeup" {
    var pair: Pair = .{};
    try pair.initOpts(.{ .random_seed = 1, .heartbeat_interval_ms = 700 }, .{ .random_seed = 2 });
    defer pair.deinit();
    for (0..20) |_| try pair.pumpOnce();
    const g = pair.shared.client.gossipsub;
    const now = pair.shared.pair.now;
    const conn = pair.shared.handles.client;
    const session = g.sessions.find(conn).?;
    const peer = g.sessions.rows[session].logical;
    const heartbeat_at = g.heartbeat_at;
    try std.testing.expect(heartbeat_at > now.millis());
    const expiry = heartbeat_at - 1;
    const before = g.schedule();
    try g.recovery.add(&g.peers, @splat(1), peer, conn, 1, heartbeat_at + 1000);
    g.recovery.controlSent(conn, 1, expiry - now.millis(), now.millis());
    try g.recovery.add(&g.peers, @splat(2), peer, conn, 2, expiry);
    try std.testing.expectEqualDeep(before, g.schedule());

    const expired = Now.fromMilliseconds(.{ .mono_ms = expiry, .unix_s = now.unixSeconds() });
    _ = support.pumpTurn(g, &pair.shared.pair.client, expired);
    try std.testing.expectEqual(@as(usize, 2), g.recovery.len);
    try std.testing.expectEqual(@as(u64, 0), g.counters.broken_promises);

    const heartbeat = Now.fromMilliseconds(.{ .mono_ms = heartbeat_at, .unix_s = now.unixSeconds() });
    _ = support.pumpTurn(g, &pair.shared.pair.client, heartbeat);
    try std.testing.expectEqual(@as(usize, 0), g.recovery.len);
    try std.testing.expectEqual(@as(u64, 1), g.counters.broken_promises);
    try std.testing.expectEqual(@as(u32, 0), g.peers.rows[peer.index].pins);
}

test "gossipsub heartbeat processes a received message before expiring its promise" {
    var pair: Pair = .{};
    try pair.init();
    defer pair.deinit();
    try pair.connectMesh();
    const g = pair.shared.client.gossipsub;
    const conn = pair.shared.handles.client;
    const peer = g.sessions.rows[g.sessions.find(conn).?].logical;
    const now = pair.shared.pair.now;
    const heartbeat_at = g.heartbeat_at;
    const payload = "received on the heartbeat";
    const id = topic_mod.validMessageId(test_topic, payload, .{});
    try g.recovery.add(&g.peers, id, peer, conn, 1, heartbeat_at + 1000);
    g.recovery.controlSent(conn, 1, heartbeat_at - now.millis(), now.millis());

    const published = try pair.shared.server.gossipsub.publish(test_topic, payload, now);
    try std.testing.expectEqual(@as(u16, 1), published.queued);
    _ = pair.shared.processServer(.{});
    pair.shared.pair.advance(heartbeat_at - now.millis());
    try pair.shared.pair.pump();
    _ = pair.shared.processClient(.{});
    try std.testing.expect(g.messages.known(id, heartbeat_at));
    try std.testing.expectEqual(@as(usize, 0), g.recovery.len);
    try std.testing.expectEqual(@as(u64, 0), g.counters.broken_promises);
}

test "gossip recovery retention refusal preserves sent promises and submits no new IWANT" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .connected_capacity = 1, .retained_capacity = 3, .retained_outbound_reserve = 1 });
    defer g.deinit();
    const conn: Handle = .{ .index = 0, .generation = 1 };
    const source = support.addPeer(&g, conn, .v1_2).?;
    const original = g.logical(source.index);
    try g.recovery.add(&g.peers, @splat(1), original, conn, 7, 30_000);
    try g.recovery.add(&g.peers, @splat(2), original, conn, 8, 30_000);
    try std.testing.expectEqual(@as(u16, 1), g.peers.pinned);
    g.recovery.controlSent(conn, 7, 12_000, 1);
    g.connectionClosed(conn);
    try std.testing.expectEqual(@as(usize, 1), g.recovery.len);
    const fresh = support.addPeer(&g, .{ .index = 0, .generation = 2 }, .v1_2).?;
    const row = &g.sessions.rows[fresh.index];
    var ids = [_]MessageId{@splat(3)};
    try std.testing.expectError(error.PeerCapacity, g.recovery.filterPending(&g.peers, row.logical, &ids));
    try std.testing.expect(!row.io.tx.pending());
    try std.testing.expectError(error.PeerCapacity, g.recovery.requestBatch(&g.peers, &row.io.tx, &g.sessions.control_scratch, &ids, row.logical, row.conn, g.overlay.rng.random(), 12_000, 2));
    try std.testing.expect(!row.io.tx.pending());
    try std.testing.expectEqual(@as(usize, 1), g.recovery.len);
    try std.testing.expectEqual(@as(usize, 1), g.recovery.batch_len);
    try std.testing.expectEqual(@as(u32, 0), g.peers.rows[row.logical.index].pins);
    try std.testing.expectEqual(@as(u64, 1), g.recovery.expire(&g.peers, 12_001));
    try std.testing.expect(g.peers.matches(original));
    try std.testing.expectEqual(@as(f64, 1), g.peers.scores.rows[original.index].behaviour);
    try std.testing.expectEqual(@as(f64, 0), g.peers.scores.rows[row.logical.index].behaviour);
    try std.testing.expectEqual(@as(u16, 0), g.peers.pinned);
    try std.testing.expectEqual(@as(usize, 1), (try g.recovery.filterPending(&g.peers, row.logical, &ids)).count);
    try g.recovery.requestBatch(&g.peers, &row.io.tx, &g.sessions.control_scratch, &ids, row.logical, row.conn, g.overlay.rng.random(), 12_000, 12_002);
    try std.testing.expect(row.io.tx.pending());
    try std.testing.expectEqual(@as(u16, 1), g.peers.pinned);
}
