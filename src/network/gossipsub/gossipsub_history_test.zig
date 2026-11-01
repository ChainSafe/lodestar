const Pair = @import("test_pair.zig").Pair;
const snappy = @import("snappy");
const delivery = @import("delivery.zig");
const Delivery = @import("metrics.zig").Delivery;
const Now = @import("../types.zig").Now;
const support = @import("test_support.zig");
const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const topic_mod = @import("topic.zig");
const constants = @import("constants.zig");
const receiveForTest = support.receiveMessage;
const testMessage = support.message;
const storage = @import("message_store.zig");
const gossip_limits = @import("../gossip_limits.zig");
const topic_policy = @import("topic_policy.zig");
const CountingAllocator = @import("../counting_allocator.zig").CountingAllocator;
const IwantOutcome = @import("metrics.zig").IwantOutcome;
const protobuf = @import("protobuf.zig");
const QueueResult = @import("outbox.zig").QueueResult;

fn requestOne(g: *Gossipsub, peer: u16, id: *const topic_mod.MessageId) void {
    var body: [32]u8 = undefined;
    var writer = protobuf.Writer.init(&body);
    writer.bytesField(1, id);
    support.control(g, peer, .{ .iwant = .{ .body = writer.written() } }, Now.fromMilliseconds(.{ .mono_ms = g.last_now_ms, .unix_s = 0 }));
}

test "gossipsub duplicate invalid bytes do not evict useful history" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .mcache_capacity = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const topic = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, topic);
    _ = try g.publish(topic, "useful", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 1 }));
    const useful = topic_mod.validMessageId(topic, "useful", .{});
    const retained = g.messages.history.message(g.messages.history.get(&g.messages.store, useful).?);
    for (0..20) |_| {
        try std.testing.expectEqual(@as(?usize, 0), try testMessage(&g, peer.index, "useful", 2));
        _ = receiveForTest(&g, peer.index, .{ .topic = topic, .data = &.{ 5, 0 } }, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 1 }));
        try std.testing.expectEqual(retained, g.messages.history.message(g.messages.history.get(&g.messages.store, useful).?));
    }
}

test "gossip history covers the processor retention allowance and the memory plan accounts for it" {
    const limits: gossip_limits.Limits = @splat(.{ .items = 4, .bytes = 4096 });
    const total = gossip_limits.items(&limits);
    var boundary: topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    boundary.rules[@intFromEnum(topic_mod.Kind.beacon_block)] = .{ .count = 1, .ssz_max = 1024 };
    for ([_]usize{ 16, total + 1 }, [_]usize{ total, total + 1 }) |floor, expected| {
        var ledger: CountingAllocator = .{ .backing = std.testing.allocator };
        var g = try support.init(ledger.allocator(), .{ .random_seed = 1, .topic_policy = &.{boundary}, .mcache_capacity = floor, .validation_capacity = total, .payload_limits = limits });
        try std.testing.expectEqual(expected, g.messages.history.entries.len);
        try std.testing.expectEqual(expected + total, g.messages.store.entries.len);
        try std.testing.expectEqual(ledger.bytes, g.memoryPlan().total_bytes - @sizeOf(Gossipsub));
        g.deinit();
    }
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .mcache_capacity = 16, .validation_capacity = total });
    defer g.deinit();
    try std.testing.expectEqual(@as(usize, 16), g.messages.history.entries.len);
}

test "gossip history at capacity serves IWANT until each message's sixth heartbeat boundary" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .mcache_capacity = 2 * constants.mcache_len });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    const history = &g.messages.history;
    var ids: [constants.mcache_len][2]topic_mod.MessageId = undefined;
    for (&ids, 0..) |*window, epoch| {
        if (epoch > 0) support.ageHistory(&g);
        for (window, 0..) |*id, i| {
            var payload: [2]u8 = .{ @intCast(epoch), @intCast(i) };
            _ = try g.publish(name, &payload, Now.fromMilliseconds(.{ .mono_ms = 1 + epoch, .unix_s = 0 }));
            id.* = topic_mod.validMessageId(name, &payload, .{});
        }
    }
    try std.testing.expectEqual(history.entries.len, history.count);
    // A full history evicts its oldest message while that message still has a window left.
    _ = try g.publish(name, "one more", Now.fromMilliseconds(.{ .mono_ms = 10, .unix_s = 0 }));
    try std.testing.expectEqual(history.entries.len, history.count);
    try std.testing.expect(history.get(&g.messages.store, ids[0][0]) == null);
    const misses = &g.iwant_outcomes[@intFromEnum(IwantOutcome.miss)];
    const unknown = misses.*;
    requestOne(&g, peer.index, &ids[0][0]);
    try std.testing.expectEqual(unknown + 1, misses.*);
    requestOne(&g, peer.index, &ids[0][1]);
    try std.testing.expectEqual(unknown + 1, misses.*);
    // Each heartbeat boundary retires exactly the window that reached six; the next stays servable.
    for (1..constants.mcache_len) |window| {
        support.ageHistory(&g);
        try std.testing.expect(history.get(&g.messages.store, ids[window - 1][1]) == null);
        requestOne(&g, peer.index, &ids[window - 1][1]);
        try std.testing.expectEqual(unknown + window + 1, misses.*);
        requestOne(&g, peer.index, &ids[window][0]);
        requestOne(&g, peer.index, &ids[window][1]);
        try std.testing.expectEqual(unknown + window + 1, misses.*);
    }
    g.cancelWrites(g.sessions.ref(peer.index));
}

test "gossip retention makes room from its own kind's oldest copy despite queued sends" {
    const limits: gossip_limits.Limits = @splat(.{ .items = 4, .bytes = 4096 });
    var boundary: topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    boundary.rules[@intFromEnum(topic_mod.Kind.beacon_block)] = .{ .count = 1, .ssz_max = 1024 };
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .topic_policy = &.{boundary}, .validation_capacity = gossip_limits.items(&limits), .payload_limits = limits });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    const kind = @intFromEnum(topic_mod.Kind.beacon_block);
    for (0..4) |i| _ = try g.publish(name, &[_]u8{@intCast(i)}, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 4), g.messages.store.retained_entries_by_kind[kind]);
    _ = try g.publish(name, "fifth", Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    try std.testing.expect(g.messages.history.get(&g.messages.store, topic_mod.validMessageId(name, &[_]u8{0}, .{})) == null);
    try std.testing.expectEqual(@as(usize, 4), g.messages.history.count);
    // One stalled recipient cannot consume every retained entry of a kind.
    var slot = g.messages.history.head;
    for (0..g.messages.history.count) |i| {
        try std.testing.expectEqual(@as(QueueResult, if (i == 0) .queued else .full), g.sessions.rows[peer.index].io.tx.queueData(&g.messages.store, g.messages.history.message(slot), .forward, .{ .bytes = constants.tx_peer_bytes }, 2));
        slot = g.messages.history.entries[slot].next;
    }
    _ = try g.publish(name, "sixth", Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 0 }));
    try std.testing.expectEqual(@as(u64, 0), g.messages.retention_refusals[kind]);
    try std.testing.expectEqual(@as(usize, 4), g.messages.history.count);
    g.cancelWrites(g.sessions.ref(peer.index));
}

test "gossip retention reclaims queued pages for larger and inline mixed histories" {
    const limits_mod = @import("../gossip_limits.zig");
    const block = topic_mod.Kind.beacon_block;
    const exit = topic_mod.Kind.voluntary_exit;
    var limits: limits_mod.Limits = @splat(.{ .items = 4, .bytes = storage.page_bytes });
    limits[@intFromEnum(block)].bytes = 2 * storage.page_bytes;
    var boundary: topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
    boundary.rules[@intFromEnum(block)] = .{ .count = 1, .ssz_max = 6000 };
    boundary.rules[@intFromEnum(exit)] = .{ .count = 1, .ssz_max = 3000 };
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .topic_policy = &.{boundary}, .validation_capacity = limits_mod.items(&limits), .payload_limits = limits });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const history = &g.messages.history;
    var random = std.Random.DefaultPrng.init(3);
    var payloads: [3][5000]u8 = undefined;
    for (&payloads) |*payload| random.random().bytes(payload);
    const cases = [_]struct { name: []const u8, kept: [3][]const u8, queued: usize, replacement: []const u8 }{
        .{ .name = "/eth2/01020304/beacon_block/ssz_snappy", .kept = .{ payloads[0][0..1000], payloads[1][0..1000], "" }, .queued = 1, .replacement = &payloads[2] },
        .{ .name = "/eth2/01020304/voluntary_exit/ssz_snappy", .kept = .{ "inline one", "inline two", payloads[0][1000..2000] }, .queued = 2, .replacement = payloads[1][1000..2000] },
    };
    for (cases) |case| {
        var handles: [3]storage.Handle = undefined;
        var kept: usize = 0;
        for (case.kept) |payload| {
            if (payload.len == 0) continue;
            _ = try g.publish(case.name, payload, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
            handles[kept] = history.message(history.get(&g.messages.store, topic_mod.validMessageId(case.name, payload, .{})).?);
            kept += 1;
        }
        try std.testing.expectEqual(.queued, g.sessions.rows[peer.index].io.tx.queueData(&g.messages.store, handles[case.queued], .forward, .{ .bytes = constants.tx_peer_bytes }, 1));
        _ = try g.publish(case.name, case.replacement, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
        try std.testing.expect(g.messages.store.get(handles[case.queued]) == null);
        try std.testing.expect(history.get(&g.messages.store, topic_mod.validMessageId(case.name, case.replacement, .{})) != null);
    }
    try std.testing.expectEqual(@as(u64, 0), g.messages.retention_refusals[@intFromEnum(block)]);
    try std.testing.expectEqual(@as(u64, 0), g.messages.retention_refusals[@intFromEnum(exit)]);
    g.cancelWrites(g.sessions.ref(peer.index));
}

test "gossip history expiry frees payloads and cancels unstarted sends without a reset" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    _ = try g.publish(name, "held", Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    const handle = g.messages.history.message(g.messages.history.head);
    const tx = &g.sessions.rows[peer.index].io.tx;
    try std.testing.expectEqual(.queued, tx.queueData(&g.messages.store, handle, .forward, Gossipsub.delivery_limits, 1));
    for (1..constants.mcache_len + 2) |epoch| {
        const now = Now.fromMilliseconds(.{ .mono_ms = epoch * g.options.heartbeat_interval_ms, .unix_s = 0 });
        support.heartbeat(&g, now);
        for (0..g.overlay.rows.len + 1) |_| {
            Gossipsub.finishPump(&g, now);
            if (!g.cycle.isActive()) break;
        }
    }
    try std.testing.expect(g.messages.store.get(handle) == null);
    try std.testing.expectEqual(@as(usize, 0), (g.writeSegment(peer)).len);
    try std.testing.expect(!tx.pending());
    try std.testing.expect(g.sessions.rows[peer.index].outStream() != null);
    try std.testing.expectEqual(@as(usize, 0), g.messages.store.used_entries);
}

test "gossip retention forwards fresh messages while slow recipients queue the oldest 64 or all 256" {
    for ([_]usize{ 1, 4 }) |recipients| {
        var limits: gossip_limits.Limits = @splat(.{ .items = 2, .bytes = storage.page_bytes });
        limits[@intFromEnum(topic_mod.Kind.data_column_sidecar)].items = 256;
        var boundary: topic_policy.Boundary = .{ .digest = .{ 1, 2, 3, 4 } };
        boundary.rules[@intFromEnum(topic_mod.Kind.data_column_sidecar)] = .{ .count = 1, .ssz_max = 1024 };
        var g = try support.init(std.testing.allocator, .{
            .random_seed = 1,
            .connected_capacity = 6,
            .retained_capacity = 13,
            .retained_outbound_reserve = 1,
            .topic_policy = &.{boundary},
            .validation_capacity = gossip_limits.items(&limits),
            .payload_limits = limits,
        });
        defer g.deinit();
        const name = "/eth2/01020304/data_column_sidecar_0/ssz_snappy";
        for (0..recipients) |i| _ = support.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
        const now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
        for (0..256) |i| {
            const payload = [_]u8{@intCast(i)};
            _ = try g.publish(name, &payload, now);
            if (i < 64 * recipients) requestOne(&g, @intCast(i / 64), &topic_mod.validMessageId(name, &payload, .{}));
        }
        for (g.sessions.rows[0..recipients]) |*peer| try std.testing.expectEqual(@as(usize, 64), peer.io.tx.data.count);
        const oldest = g.messages.history.message(g.messages.history.head);
        const destination = support.addPeer(&g, .{ .index = 4, .generation = 1 }, .v1_2).?;
        const source = support.addPeer(&g, .{ .index = 5, .generation = 1 }, .v1_2).?;
        try support.subscribe(&g, name);
        _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), destination.index, name, true);
        g.overlay.rows[g.overlay.findTopic(name).?].mesh.set(destination.index);
        var inbox: support.Inbox = .{};
        defer inbox.deinit();
        inbox.attach(&g);
        var compressed: [64]u8 = undefined;
        const size = try snappy.raw.compress("fresh", &compressed);
        try std.testing.expectEqual(@as(?usize, 1), receiveForTest(&g, source.index, .{ .topic = name, .data = compressed[0..size] }, now));
        try std.testing.expectEqual(Gossipsub.ReportOutcome{ .applied = .accept }, g.report(inbox.last().handle, .accept, now));
        try std.testing.expect(g.messages.store.get(oldest) == null);
        try std.testing.expectEqual(@as(u64, 0), g.messages.retention_refusals[@intFromEnum(topic_mod.Kind.data_column_sidecar)]);
        const tx = &g.sessions.rows[destination.index].io.tx;
        try std.testing.expectEqual(@as(usize, 1), tx.data.count);
        const fresh = (tx.data.next(&g.messages.store, g.last_now_ms, g.options.tx_timeout_ms)).?.message;
        try std.testing.expectEqual(topic_mod.validMessageId(name, "fresh", .{}), g.messages.store.get(fresh).?.id);
        for (0..4) |_| {
            const segment = g.writeSegment(destination);
            if (segment.len == 0) break;
            g.advanceWrite(destination, segment.len, now.millis());
        }
        const metrics = &g.delivery_metrics.recipients[@intFromEnum(delivery.Origin.forward)];
        try std.testing.expectEqual(@as(u64, 1), metrics[@intFromEnum(Delivery.Outcome.completed)]);
        try std.testing.expectEqual(@as(usize, 0), tx.data.count);
    }
}

test "gossipsub cache eviction skips pending frames and preserves active frames" {
    const test_topic = "/eth2/01020304/beacon_block/ssz_snappy";
    const Stage = enum { unstarted, partial, complete };
    var random = std.Random.DefaultPrng.init(8712);
    var large: [80_000]u8 = undefined;
    random.random().bytes(&large);
    for ([_][]const u8{ "old payload", &large }) |payload| {
        for ([_]Stage{ .unstarted, .partial, .complete }) |stage| {
            var setup: Pair = .{};
            try setup.initOpts(.{ .random_seed = 1, .mcache_capacity = 1 }, .{ .random_seed = 1 });
            defer setup.deinit();
            try setup.connectMesh();
            const g = setup.shared.client.gossipsub;
            const index = g.sessions.find(setup.shared.handles.client).?;
            const peer = &g.sessions.rows[index];
            const stream = peer.outStream().?;
            const before = g.peers.scores.penalties;
            const first = try g.publish(test_topic, payload, setup.shared.pair.now);
            try std.testing.expectEqual(@as(u16, 1), first.queued);
            const handle = g.messages.history.message(g.messages.history.head);
            var received_old = false;
            if (stage != .unstarted) {
                if (stage == .partial) g.options.output_per_peer = 1;
                for (0..64) |_| {
                    try setup.pumpOnce();
                    for (setup.serverMessages()) |event| if (std.mem.eql(u8, event.bytes, payload)) {
                        received_old = true;
                    };
                    if (stage == .partial or received_old) break;
                }
                if (stage == .partial) {
                    try std.testing.expect(peer.io.tx.active.data.sent() > 0);
                    try g.recovery.add(&g.peers, @splat(9), peer.logical, peer.conn, 1, setup.shared.pair.now.millis() + 30_000);
                    g.recovery.controlSent(peer.conn, 1, 12_000, setup.shared.pair.now.millis());
                } else try std.testing.expectEqual(@as(usize, 0), peer.io.tx.data.count);
            }
            _ = try g.publish(test_topic, "new payload", setup.shared.pair.now);
            if (stage == .partial and payload.len > 64 * 1024) {
                const retained = g.messages.store.get(handle).?;
                try std.testing.expect(!retained.history);
                try std.testing.expectEqual(@as(u16, 1), retained.senders);
            } else try std.testing.expect(g.messages.store.get(handle) == null);
            g.options.output_per_peer = 64 * 1024;
            var received_new = false;
            for (0..64) |_| {
                try setup.pumpOnce();
                for (setup.serverMessages()) |event| {
                    if (std.mem.eql(u8, event.bytes, payload)) received_old = true;
                    if (std.mem.eql(u8, event.bytes, "new payload")) received_new = true;
                }
            }
            try std.testing.expect(g.messages.store.get(handle) == null);
            try std.testing.expectEqual(stage != .unstarted, received_old);
            try std.testing.expect(received_new);
            try std.testing.expectEqual(stream, peer.outStream().?);
            try std.testing.expectEqualDeep(before, g.peers.scores.penalties);
            try std.testing.expectEqual(@as(usize, if (stage == .partial) 1 else 0), g.recovery.len);
            const metrics = &g.delivery_metrics.recipients[@intFromEnum(delivery.Origin.publication)];
            try std.testing.expectEqual(@as(u64, 2), metrics[@intFromEnum(Delivery.Outcome.queued)]);
            const cancelled: u64 = switch (stage) {
                .unstarted => 1,
                .partial => 0,
                .complete => 0,
            };
            try std.testing.expectEqual(cancelled, metrics[@intFromEnum(Delivery.Outcome.cancelled)]);
            try std.testing.expectEqual(2 - cancelled, metrics[@intFromEnum(Delivery.Outcome.completed)]);
            g.cancelWrites(g.sessions.ref(index));
            try std.testing.expectEqual(@as(u64, 2), metrics[@intFromEnum(Delivery.Outcome.cancelled)] + metrics[@intFromEnum(Delivery.Outcome.completed)]);
        }
    }
}
