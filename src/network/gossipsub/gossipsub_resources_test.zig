const topic_mod = @import("topic.zig");
const support = @import("test_support.zig");
const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const Engine = @import("../quic/Engine.zig");
const Pair = @import("test_pair.zig").Pair;
const test_topic = "/eth2/01020304/beacon_block/ssz_snappy";
const constants = @import("constants.zig");
const peers_mod = @import("peer_book.zig");
const Handle = Engine.Handle;
const Now = @import("../types.zig").Now;
const testMessage = support.message;
const ValidationHandle = Gossipsub.ValidationHandle;
const storage = @import("message_store.zig");
const delivery = @import("delivery.zig");
const StorageRefusal = @import("messages.zig").StorageRefusal;
const CountingAllocator = @import("../counting_allocator.zig").CountingAllocator;
const QueueResult = @import("outbox.zig").QueueResult;
const snappy = @import("snappy");
const metrics = @import("metrics.zig");
const turn_mod = @import("turn.zig");
const resource_options: Gossipsub.Options = .{ .random_seed = 1, .connected_capacity = 3, .retained_capacity = 9, .retained_outbound_reserve = 1, .validation_capacity = 1, .mcache_capacity = 2, .seen_capacity = 4 };

test "gossipsub pinned payload pressure drops the publication and releases receive pages" {
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1 }, .{ .random_seed = 1, .mcache_arena_bytes = constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE) + 4096 });
    defer setup.deinit();
    try setup.connectMesh();
    const payload = try std.testing.allocator.alloc(u8, constants.MAX_PAYLOAD_SIZE);
    defer std.testing.allocator.free(payload);
    var rng = std.Random.DefaultPrng.init(97);
    rng.random().bytes(payload);
    _ = try setup.shared.client.gossipsub.publish(test_topic, payload, setup.shared.pair.now);
    var handle: ?Gossipsub.ValidationHandle = null;
    for (0..2000) |_| {
        try setup.pumpOnce();
        for (setup.serverMessages()) |message| {
            handle = message.handle;
        }
        if (handle != null) break;
    }
    try std.testing.expect(handle != null);
    const refused_id = topic_mod.validMessageId(test_topic, payload[0 .. 3 * 1024 * 1024], .{});
    _ = try setup.shared.client.gossipsub.publish(test_topic, payload[0 .. 3 * 1024 * 1024], setup.shared.pair.now);
    const g = setup.shared.server.gossipsub;
    const peer = g.sessions.find(setup.shared.handles.server).?;
    for (0..2000) |_| {
        try setup.pumpOnce();
        if (g.messages.storage_refusals[@intFromEnum(StorageRefusal.payload_capacity)] != 0) break;
    }
    try std.testing.expectEqual(@as(u64, 1), g.messages.storage_refusals[@intFromEnum(StorageRefusal.payload_capacity)]);
    try std.testing.expectEqual(@as(usize, 1), g.messages.pendingValidations());
    try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[peer].io.overflow.pages);
    try std.testing.expect(g.sessions.rows[peer].io.rpc == null);
    try std.testing.expect(!g.messages.known(refused_id, setup.shared.pair.now.millis()));
    try std.testing.expectEqual(@as(u64, 0), g.counters.local_pressure_resets);
    _ = g.report(handle.?, .ignore, setup.shared.pair.now);
    payload[0] ^= 1;
    _ = try setup.shared.client.gossipsub.publish(test_topic, payload[0 .. 3 * 1024 * 1024], setup.shared.pair.now);
    var received = false;
    for (0..2000) |_| {
        try setup.pumpOnce();
        for (setup.serverMessages()) |message| {
            try std.testing.expectEqualSlices(u8, payload[0 .. 3 * 1024 * 1024], message.bytes);
            received = true;
        }
        if (received) break;
    }
    try std.testing.expect(received);
}

test "gossipsub rejects incompatible memory plans and cleans partial startup allocations" {
    const a = std.testing.allocator;
    try std.testing.expectError(error.InvalidLimits, support.init(a, .{ .random_seed = 1, .receive_arena_bytes = 65536 }));
    try std.testing.expectError(error.InvalidLimits, support.init(a, .{ .random_seed = 1, .receive_arena_bytes = 1024 * 1024 * 1024 + 4096 }));
    try std.testing.checkAllAllocationFailures(a, testStartup, .{});
}

test "gossipsub resource snapshot starts empty" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const snapshot = g.resourceSnapshot();
    try std.testing.expectEqual(@as(usize, 0), snapshot.admitted_peers);
    try std.testing.expectEqual(@as(usize, 0), snapshot.queued_descriptors);
    try std.testing.expectEqual(@as(usize, 0), snapshot.store_entries);
    try std.testing.expectEqual(@as(usize, 0), snapshot.pending_validations);
}

test "gossip resolved capacities allocate owner rows and reject stale ceiling handles" {
    var ledger: CountingAllocator = .{ .backing = std.testing.allocator };
    var g = try support.init(ledger.allocator(), .{ .random_seed = 1, .connected_capacity = 2, .retained_capacity = 9, .retained_outbound_reserve = 1 });
    try std.testing.expectEqual(@as(usize, 2), g.sessions.rows.len);
    try std.testing.expectEqual(@as(usize, 9), g.peers.rows.len);
    try std.testing.expectEqual(@as(usize, 9), g.peers.scores.rows.len);
    try std.testing.expect(!g.sessions.matches(.{ .index = 2, .generation = 0 }));
    try std.testing.expect(!g.peers.matches(.{ .index = 9, .generation = 0 }));
    try std.testing.expectEqual(ledger.bytes, g.memoryPlan().total_bytes - @sizeOf(Gossipsub));
    g.deinit();
    try std.testing.expectEqual(@as(usize, 0), ledger.bytes);
}

test "gossip default owner memory reconciles requested allocations" {
    var ledger: CountingAllocator = .{ .backing = std.testing.allocator };
    {
        var g = try support.init(ledger.allocator(), .{ .random_seed = 1 });
        defer g.deinit();
        const plan = g.memoryPlan();
        try std.testing.expectEqual(ledger.bytes, plan.total_bytes - @sizeOf(Gossipsub));
    }
    try std.testing.expectEqual(@as(usize, 0), ledger.bytes);
}

test "gossip resource snapshot releases queued bytes and descriptors with the owner" {
    var backing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    var ledger: CountingAllocator = .{ .backing = backing.allocator() };
    var g = try support.init(ledger.allocator(), .{ .random_seed = 1, .connected_capacity = 2, .retained_capacity = 9, .retained_outbound_reserve = 1 });
    defer g.deinit();
    const calls = backing.allocations;
    const conn: Handle = .{ .index = 0, .generation = 1 };
    const peer = support.addPeer(&g, conn, .v1_2).?;
    const io = &g.sessions.rows[peer.index].io;
    io.tx.cancelStream();
    const message = g.messages.store.put(.beacon_block, [_]u8{1} ** 20, "t", "abc").?;
    g.messages.store.retainHistory(message);
    g.messages.store.seal(message);
    try std.testing.expectEqual(QueueResult.queued, io.tx.queueData(&g.messages.store, message, .forward, .{ .bytes = 10 }, 7));
    const snapshot = g.resourceSnapshot();
    try std.testing.expectEqual(@as(usize, 3), snapshot.queued_bytes);
    try std.testing.expectEqual(@as(usize, 1), snapshot.queued_descriptors);
    try std.testing.expectEqualDeep(snapshot, g.resourceSnapshot());
    g.connectionClosed(conn);
    g.messages.store.releaseHistory(message);
    const released = g.resourceSnapshot();
    try std.testing.expectEqual(@as(usize, 0), released.queued_bytes);
    try std.testing.expectEqual(@as(usize, 0), released.queued_descriptors);
    try std.testing.expectEqual(calls, backing.allocations);
}

test "gossip lifecycle sequence preserves ownership under pressure reconnect and late verdicts" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 91, .connected_capacity = 2, .retained_capacity = 9, .retained_outbound_reserve = 1, .validation_capacity = 2, .mcache_capacity = 4, .seen_capacity = 8, .mcache_arena_bytes = constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE) + storage.page_bytes, .validation_timeout_ms = 100, .validation_tombstone_ms = 200 });
    defer g.deinit();
    var rng = std.Random.DefaultPrng.init(17);
    var conn: Handle = .{ .index = 0, .generation = 1 };
    var source = support.addPeer(&g, conn, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    const metadata: peers_mod.Metadata = .{ .identity = g.peers.rows[g.sessions.rows[source.index].logical.index].identity, .address = .unspecified, .direction = .inbound };
    g.markDirect(conn);
    g.sessions.rows[source.index].outbound = .{ .live = .{ .stream = .{ .conn = conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
    _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), source.index, name, true);
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    var handles: [8]?ValidationHandle = @splat(null);
    for (0..512) |step| {
        const now: Now = Now.fromMilliseconds(.{ .mono_ms = step * 17 + 1, .unix_s = 0 });
        g.last_now_ms = now.millis();
        const value = rng.random().uintLessThan(u8, 8);
        const payload = [_]u8{'a' + value};
        switch (rng.random().uintLessThan(u8, 9)) {
            0, 1 => {
                if (try testMessage(&g, source.index, &payload, now.millis())) |count| {
                    if (count == 1) handles[value] = inbox.last().handle;
                    inbox.clear();
                }
            },
            2 => if (handles[value]) |handle| {
                _ = g.report(handle, @enumFromInt(rng.random().uintLessThan(u8, 3)), now);
            },
            3 => {
                _ = g.publish(name, &payload, now) catch |err| switch (err) {
                    error.Duplicate, error.ResourceExhausted => Gossipsub.PublishOutcome{},
                    else => return err,
                };
            },
            4 => g.messages.expire(&g.peers, now.millis()),
            5 => {
                g.connectionClosed(conn);
                conn.generation += 1;
                source = g.addPeer(conn, &metadata, now).admitted;
                g.markDirect(conn);
                g.sessions.rows[source.index].outbound = .{ .live = .{ .stream = .{ .conn = conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
                _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), source.index, name, true);
            },
            6 => {
                const subscribed = if (g.overlay.findTopic(name)) |topic| g.overlay.subscribed(topic) else false;
                if (subscribed) {
                    try support.unsubscribe(&g, name);
                } else try support.subscribe(&g, name);
            },
            7 => {
                support.heartbeat(&g, now);
                Gossipsub.finishPump(&g, now);
            },
            8 => for (g.sessions.rows) |*peer| peer.io.tx.cancelStream(),
            else => unreachable,
        }
        var pending: usize = 0;
        var occupied_pages: usize = 0;
        for (g.messages.store.entries, 0..) |*entry, index| {
            if (!entry.active) continue;
            try std.testing.expect(!entry.provisional);
            occupied_pages += storage.Store.pagesFor(entry.len);
            var validations: usize = 0;
            for (g.messages.validation.entries) |*slot| if (slot.state == .pending and slot.state.pending.message.index == index) {
                try std.testing.expectEqual(entry.generation, slot.state.pending.message.generation);
                validations += 1;
            };
            try std.testing.expectEqual(@as(usize, @intFromBool(entry.validation)), validations);
            pending += validations;
            const history = g.messages.history.get(&g.messages.store, entry.id);
            try std.testing.expectEqual(entry.history, if (history) |record| g.messages.history.message(record).index == index and g.messages.history.message(record).generation == entry.generation else false);
            try std.testing.expect(entry.validation or entry.history);
        }
        try std.testing.expectEqual(g.messages.store.next.len, occupied_pages + g.messages.store.free_pages);
        var records_pending: usize = 0;
        var pins: [9]u32 = @splat(0);
        for (g.messages.validation.recent) |*record| {
            records_pending += @intFromBool(record.state == .pending);
            if (record.state != .pending) continue;
            try std.testing.expect(g.peers.matches(record.source));
            pins[record.source.index] += 1;
            for (record.duplicates[0..record.duplicate_len]) |*duplicate| {
                try std.testing.expect(g.peers.matches(duplicate.peer));
                pins[duplicate.peer.index] += 1;
            }
        }
        try std.testing.expectEqual(pending, records_pending);
        for (g.peers.rows, pins) |*peer, expected| try std.testing.expectEqual(expected, peer.pins);
    }
}

test "gossip validation finishes without allocation while shared deliveries are full" {
    var allocator = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    var g = try support.init(allocator.allocator(), resource_options);
    defer g.deinit();
    try support.subscribe(&g, test_topic);
    const topic = g.overlay.findTopic(test_topic).?;
    const message = g.messages.publish(@splat(1), topic, .beacon_block, test_topic, "retained", 0, 0).?;
    for (0..3) |i| {
        const conn: Handle = .{ .index = @intCast(i), .generation = 1 };
        const session = support.addPeer(&g, conn, .v1_2).?;
        g.sessions.rows[session.index].outbound = .{ .live = .{ .stream = .{ .conn = conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
        g.overlay.rows[topic].mesh.set(i);
        const count: usize = if (i == 0) delivery.per_peer_limit else delivery.per_peer_reserve;
        const tx = &g.sessions.rows[i].io.tx;
        for (0..count) |item| {
            const origin: delivery.Origin = if (item >= count - constants.tx_local_descriptors) .publication else .forward;
            try std.testing.expectEqual(.queued, tx.queueData(&g.messages.store, message, origin, .{ .bytes = constants.tx_peer_bytes }, 0));
        }
    }
    const occupied = g.resourceSnapshot();
    try std.testing.expectEqual(occupied.delivery_descriptors_capacity, occupied.queued_descriptors);
    allocator.fail_index = allocator.alloc_index;
    var compressed: [64]u8 = undefined;
    const len = try snappy.raw.compress("valid message", &compressed);
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    var turn = Gossipsub.beginPump(&g, now);
    var credits = turn_mod.Credits.peer(&g.options);
    try std.testing.expectEqual(.done, g.receiveItem(g.sessions.ref(0), .{ .message = .{ .topic = test_topic, .data = compressed[0..len] } }, &turn, &credits));
    try std.testing.expectEqual(@as(usize, 1), inbox.count);
    try std.testing.expectEqualDeep(Gossipsub.ReportOutcome{ .applied = .accept }, g.report(inbox.last().handle, .accept, now));
    try std.testing.expect(g.messages.history.get(&g.messages.store, inbox.last().id) != null);
    try std.testing.expectEqual(@as(usize, 0), g.resourceSnapshot().pending_validations);
    try std.testing.expectEqual(@as(u64, 2), g.delivery_metrics.recipients[@intFromEnum(delivery.Origin.forward)][@intFromEnum(metrics.Delivery.Outcome.pressured)]);
    const old = g.sessions.ref(1);
    g.connectionClosed(g.sessions.rows[1].conn);
    const replacement = support.addPeer(&g, .{ .index = 1, .generation = 2 }, .v1_2).?;
    try std.testing.expect(replacement.generation != old.generation);
    g.cancelWrites(old);
    try std.testing.expectEqual(@as(usize, delivery.per_peer_reserve), g.sessions.deliveries.available);
    try std.testing.expectEqual(allocator.fail_index, allocator.alloc_index);
}

fn testStartup(a: std.mem.Allocator) !void {
    var g = try support.init(a, .{ .random_seed = 1, .seen_capacity = 1, .mcache_capacity = 1, .validation_capacity = 1, .body_buffer_bytes = 1, .control_bytes = 1, .critical_bytes = 32 + topic_mod.topic_max_len });
    defer g.deinit();
    const plan = g.memoryPlan();
    try std.testing.expectEqual(@as(usize, 4096), plan.page_bytes);
    try std.testing.expectEqual(g.messages.store.bytes.len, plan.retained_bytes);
    try std.testing.expectEqual(plan.total_bytes, plan.retained_bytes + plan.frame_bytes + plan.compression_bytes + plan.peer_buffer_bytes + plan.metadata_bytes);
}
