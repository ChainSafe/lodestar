const Now = @import("../types.zig").Now;
const support = @import("test_support.zig");
const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const topic_mod = @import("topic.zig");
const Engine = @import("../quic/Engine.zig");
const digest = topic_mod.ForkDigest{ 0x6a, 0x95, 0xa1, 0xa9 };
const Pair = @import("test_pair.zig").Pair;
const constants_heartbeat = @import("constants.zig").heartbeat_interval_ms;
const test_topic = "/eth2/01020304/beacon_block/ssz_snappy";
const ReportOutcome = Gossipsub.ReportOutcome;
const Handle = Engine.Handle;
const receiveForTest = support.receiveMessage;
const testMessage = support.message;
const constants = @import("constants.zig");
const StorageRefusal = @import("messages.zig").StorageRefusal;
const frame = @import("frame.zig");

test "gossip resolved attribution releases peer rows and scores late duplicates once after reuse" {
    for ([_]Gossipsub.Verdict{ .accept, .reject, .ignore }) |verdict| {
        var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .connected_capacity = 1, .retained_capacity = 5, .retained_outbound_reserve = 1 });
        defer g.deinit();
        var inbox: support.Inbox = .{};
        defer inbox.deinit();
        inbox.attach(&g);
        try support.subscribe(&g, test_topic);
        const conn: Handle = .{ .index = 0, .generation = 1 };
        const source = support.addPeer(&g, conn, .v1_2).?;
        const endpoint = Engine.Address{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 9000 } };
        g.sessions.rows[source.index].receive_endpoint = endpoint;
        const old = g.logical(source.index);
        try std.testing.expectEqual(@as(?usize, 1), try testMessage(&g, source.index, "message", 1));
        const handle = inbox.last().handle;
        try std.testing.expectEqual(@as(u32, 1), g.peers.rows[old.index].pins);
        _ = g.report(handle, verdict, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
        try std.testing.expectEqual(@as(u32, 0), g.peers.rows[old.index].pins);
        const topic = g.overlay.findTopic(test_topic).?;
        try std.testing.expect(g.messages.validation.retainsTopic(topic));
        g.connectionClosed(conn);
        for (1..g.peers.rows.len - g.peers.reserved) |i| {
            const retained = g.peers.admit(.{ .index = 0, .generation = @intCast(i + 10) }, &.{ .identity = .{ .bytes = @splat(@intCast(i)) }, .address = .unspecified, .direction = .inbound }, g.last_now_ms).admitted.peer;
            g.peers.scores.penalize(retained.index, 20);
            g.peers.disconnect(retained, g.last_now_ms);
        }
        const next = support.addPeer(&g, .{ .index = 0, .generation = 2 }, .v1_2).?;
        const current = g.logical(next.index);
        try std.testing.expectEqual(old, g.messages.validation.find(inbox.last().id, 2).?.source);
        try std.testing.expectEqual(conn, inbox.last().peer);
        try std.testing.expectEqual(endpoint, inbox.last().endpoint.?);
        try std.testing.expectEqual(old.index, current.index);
        try std.testing.expect(!g.peers.matches(old));
        g.overlay.rows[topic].mesh.set(next.index);
        for (0..2) |_| try std.testing.expectEqual(@as(?usize, 0), try testMessage(&g, next.index, "message", 3));
        const counters = g.peers.scores.topics[@as(usize, current.index) * g.peers.scores.topic_params.len + topic];
        try std.testing.expectEqual(@as(f64, if (verdict == .reject) 1 else 0), counters.invalid);
        try std.testing.expectEqual(@as(f64, if (verdict == .accept) 1 else 0), counters.mesh_deliveries);
        try std.testing.expectEqual(@as(u32, 0), g.peers.rows[current.index].pins);
        g.messages.expire(&g.peers, 30_002);
        try std.testing.expect(!g.messages.validation.retainsTopic(topic));
        try std.testing.expect(g.peers.matches(current));
    }
}

fn buildTopic(name: []const u8, out: []u8) []const u8 {
    return topic_mod.build(digest, name, out);
}

fn idFromHex(hex: []const u8) Gossipsub.MessageId {
    var id: Gossipsub.MessageId = undefined;
    _ = std.fmt.hexToBytes(&id, hex) catch unreachable;
    return id;
}

fn publishAdmissionA(setup: *Pair) !struct { count: usize, handle: ?Gossipsub.ValidationHandle } {
    setup.shared.pair.advance(1);
    const queued = try setup.shared.client.gossipsub.publish(test_topic, "A", setup.shared.pair.now);
    try std.testing.expectEqual(@as(u16, 1), queued.queued);
    var count: usize = 0;
    var handle: ?Gossipsub.ValidationHandle = null;
    for (0..20) |_| {
        try setup.pumpOnce();
        for (setup.serverMessages()) |message| {
            try std.testing.expectEqualStrings("A", message.bytes);
            count += 1;
            handle = message.handle;
        }
    }
    return .{ .count = count, .handle = handle };
}

test "gossipsub prunes a peer whose messages are rejected" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();

    var buf: [topic_mod.topic_max_len]u8 = undefined;
    const beacon_block = buildTopic("beacon_block", &buf);
    try support.subscribe(setup.shared.client.gossipsub, beacon_block);
    try support.subscribe(setup.shared.server.gossipsub, beacon_block);

    var rounds: usize = 0;
    while (rounds < 10) : (rounds += 1) try setup.pumpOnce();
    setup.shared.pair.advance(constants_heartbeat + 100);
    rounds = 0;
    while (rounds < 10) : (rounds += 1) try setup.pumpOnce();

    const client_index = setup.shared.server.gossipsub.sessions.find(setup.shared.handles.server).?;
    const server_topic = setup.shared.server.gossipsub.overlay.findTopic(beacon_block).?;
    try std.testing.expect(setup.shared.server.gossipsub.overlay.mesh(server_topic).isSet(client_index));

    _ = try setup.shared.client.gossipsub.publish(beacon_block, "an invalid block", setup.shared.pair.now);
    rounds = 0;
    var rejected = false;
    while (rounds < 20 and !rejected) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverMessages()) |m| {
            try std.testing.expectEqual(ReportOutcome{ .applied = .reject }, setup.shared.server.gossipsub.report(m.handle, .reject, setup.shared.pair.now));
            rejected = true;
        }
    }
    try std.testing.expect(rejected);

    try std.testing.expect(setup.shared.server.gossipsub.peers.score(.{ .index = client_index, .generation = setup.shared.server.gossipsub.peers.rows[client_index].generation }, setup.shared.pair.now.millis()) < 0);
    setup.shared.pair.advance(constants_heartbeat + 100);
    rounds = 0;
    while (rounds < 10) : (rounds += 1) try setup.pumpOnce();
    try std.testing.expect(!setup.shared.server.gossipsub.overlay.mesh(server_topic).isSet(client_index));
}

test "gossipsub credits first delivery only after the host accepts" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();

    var buf: [topic_mod.topic_max_len]u8 = undefined;
    const beacon_block = buildTopic("beacon_block", &buf);
    try support.subscribe(setup.shared.client.gossipsub, beacon_block);
    try support.subscribe(setup.shared.server.gossipsub, beacon_block);

    var rounds: usize = 0;
    while (rounds < 10) : (rounds += 1) try setup.pumpOnce();
    setup.shared.pair.advance(constants_heartbeat + 100);
    rounds = 0;
    while (rounds < 10) : (rounds += 1) try setup.pumpOnce();

    const client_index = setup.shared.server.gossipsub.sessions.find(setup.shared.handles.server).?;
    const topic_index = setup.shared.server.gossipsub.overlay.findTopic(beacon_block).?;
    const scores = &setup.shared.server.gossipsub.peers.scores;
    const counters = &scores.topics[@as(usize, client_index) * scores.topic_params.len + topic_index];
    try std.testing.expectEqual(@as(f64, 0), counters.first_deliveries);

    _ = try setup.shared.client.gossipsub.publish(beacon_block, "a beacon block payload", setup.shared.pair.now);
    var handle: ?Gossipsub.ValidationHandle = null;
    rounds = 0;
    while (rounds < 20 and handle == null) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverMessages()) |m| handle = m.handle;
    }
    try std.testing.expect(handle != null);

    try std.testing.expectEqual(@as(f64, 0), counters.first_deliveries);
    try std.testing.expectEqual(ReportOutcome{ .applied = .accept }, setup.shared.server.gossipsub.report(handle.?, .accept, setup.shared.pair.now));
    try std.testing.expectEqual(@as(f64, 1), counters.first_deliveries);
    try std.testing.expectEqual(ReportOutcome.already_resolved, setup.shared.server.gossipsub.report(handle.?, .accept, setup.shared.pair.now));
    try std.testing.expectEqual(@as(f64, 1), counters.first_deliveries);
}

test "gossipsub uses configured message IDs on publish and wire receive" {
    const vectors = [_]struct {
        policy: topic_mod.MessageIdPolicy,
        valid: []const u8,
        invalid: []const u8,
        invalid_body: []const u8,
    }{
        .{
            .policy = .{},
            .valid = "a9fe6ab574e2aac2f18a37d95a6250a6e0f5b583",
            .invalid = "a28c11a9057a41e968c2c3eead4b4c9fdd39c0d0",
            .invalid_body = "c2f970d6f12a642a5df7488e0cef9d76062b0b12",
        },
        .{
            .policy = .{ .phase0_digest = .{ 1, 2, 3, 4 } },
            .valid = "79d62a59d0e47597aeb73cb85ba034c3f67f90e8",
            .invalid = "a0960f8d63bfe4fce6c26ae9e33f8f2d2729239a",
            .invalid_body = "785b35d50e5df9eee4bb06e5b102b1088d149500",
        },
    };
    for (vectors) |vector| {
        var setup: Pair = .{};
        try setup.initOpts(
            .{ .random_seed = 1, .message_id_policy = vector.policy },
            .{ .random_seed = 1, .message_id_policy = vector.policy },
        );
        defer setup.deinit();
        const topic = "/eth2/01020304/beacon_block/ssz_snappy";
        try support.subscribe(setup.shared.client.gossipsub, topic);
        try support.subscribe(setup.shared.server.gossipsub, topic);
        for (0..20) |_| try setup.pumpOnce();
        setup.shared.pair.advance(constants_heartbeat + 100);
        for (0..10) |_| try setup.pumpOnce();
        _ = try setup.shared.client.gossipsub.publish(topic, "hello", setup.shared.pair.now);
        const valid = idFromHex(vector.valid);
        try std.testing.expect(setup.shared.client.gossipsub.messages.seen.contains(valid, setup.shared.pair.now.millis()));
        var received = false;
        for (0..20) |_| {
            try setup.pumpOnce();
            for (setup.serverMessages()) |message| {
                try std.testing.expectEqual(valid, message.id);
                received = true;
            }
            if (received) break;
        }
        try std.testing.expect(received);
        const protobuf = @import("protobuf.zig");
        const malformed = [_][]const u8{ &.{0xff}, &.{ 5, 0 } };
        const invalid_ids = [_][]const u8{ vector.invalid, vector.invalid_body };
        for (malformed, invalid_ids) |data, expected| {
            var rpc: [128]u8 = undefined;
            var writer = protobuf.Writer.init(&rpc);
            protobuf.writeMessage(&writer, data, topic);
            var framed: [130]u8 = undefined;
            const wire = frame.writeFrame(&framed, writer.written());
            try std.testing.expectEqual(
                wire.len,
                try setup.shared.pair.client.write(setup.clientStream(), wire, false),
            );
            for (0..4) |_| try setup.pumpOnce();
            try std.testing.expect(setup.shared.server.gossipsub.messages.seen.contains(idFromHex(expected), setup.shared.pair.now.millis()));
        }
    }
}

test "gossipsub tombstones suppress Seen eviction replays and expire for natural readmission" {
    var setup: Pair = .{};
    try setup.initOpts(.{
        .random_seed = 1,
        .seen_ttl_ms = 1,
    }, .{ .random_seed = 1, .seen_capacity = 1, .validation_capacity = 4, .validation_tombstone_ms = 100, .mcache_capacity = 1 });
    defer setup.deinit();
    try setup.connectMesh();
    const first = try publishAdmissionA(&setup);
    try std.testing.expectEqual(@as(usize, 1), first.count);
    const old = first.handle.?;
    try std.testing.expectEqual(Gossipsub.ReportOutcome{ .applied = .ignore }, setup.shared.server.gossipsub.report(old, .ignore, setup.shared.pair.now));
    try std.testing.expectEqual(@as(usize, 0), setup.shared.server.gossipsub.messages.store.used_entries);
    _ = try setup.shared.server.gossipsub.publish(test_topic, "B", setup.shared.pair.now);
    const id = topic_mod.validMessageId(test_topic, "A", .{});
    try std.testing.expect(setup.shared.server.gossipsub.messages.known(id, setup.shared.pair.now.millis()));
    const suppressed = try publishAdmissionA(&setup);
    try std.testing.expectEqual(@as(usize, 0), suppressed.count);
    setup.shared.pair.advance(100);
    try std.testing.expect(!setup.shared.server.gossipsub.messages.known(id, setup.shared.pair.now.millis()));
    const second = try publishAdmissionA(&setup);
    try std.testing.expectEqual(@as(usize, 1), second.count);
    const current = second.handle.?;
    const retained = setup.shared.server.gossipsub.messages.validation.entries[current.index].state.pending.message;
    for (0..8) |i| {
        const payload = [_]u8{@as(u8, @intCast(i)) + 'C'};
        _ = try setup.shared.server.gossipsub.publish(test_topic, &payload, setup.shared.pair.now);
        try std.testing.expect(!setup.shared.server.gossipsub.messages.seen.contains(id, setup.shared.pair.now.millis()));
        const duplicate = try publishAdmissionA(&setup);
        try std.testing.expectEqual(@as(usize, 0), duplicate.count);
        var pending: usize = 0;
        for (setup.shared.server.gossipsub.messages.validation.recent) |entry| {
            if (entry.state == .pending and std.mem.eql(u8, &entry.id, &id)) pending += 1;
        }
        try std.testing.expectEqual(@as(usize, 1), pending);
        try std.testing.expectEqual(@as(usize, 2), setup.shared.server.gossipsub.messages.store.used_entries);
        try std.testing.expect(setup.shared.server.gossipsub.messages.store.get(retained).?.validation);
    }
    // Natural attribution expiry permits another free operation slot. The old
    // capability must stay stale regardless of which slot readmission obtains.
    try std.testing.expect(!std.meta.eql(old, current));
    try std.testing.expectEqual(Gossipsub.ReportOutcome.stale_handle, setup.shared.server.gossipsub.report(old, .accept, setup.shared.pair.now));
    try std.testing.expectEqual(Gossipsub.ReportOutcome{ .applied = .ignore }, setup.shared.server.gossipsub.report(current, .ignore, setup.shared.pair.now));
    try std.testing.expectEqual(Gossipsub.ReportOutcome.already_resolved, setup.shared.server.gossipsub.report(current, .accept, setup.shared.pair.now));
    try std.testing.expect(setup.shared.server.gossipsub.messages.store.get(retained) == null);
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.gossipsub.messages.store.used_entries);
    for (0..constants.mcache_len) |_| support.ageHistory(setup.shared.server.gossipsub);
    try std.testing.expectEqual(@as(usize, 0), setup.shared.server.gossipsub.messages.store.used_entries);
    try std.testing.expectEqual(setup.shared.server.gossipsub.messages.store.next.len, setup.shared.server.gossipsub.messages.store.free_pages);
}

test "gossipsub pending validation survives history churn and report publish event reuse" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .mcache_capacity = 1, .validation_capacity = 2, .seen_capacity = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const topic = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, topic);
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    try std.testing.expectEqual(@as(?usize, 1), try testMessage(&g, peer.index, "pending", 1));
    const event = inbox.last();
    for (0..20) |i| {
        var bytes: [8]u8 = undefined;
        std.mem.writeInt(u64, &bytes, i, .little);
        _ = try g.publish(topic, &bytes, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 1 }));
        support.ageHistory(&g);
    }
    try std.testing.expectEqual(@as(?usize, 0), try testMessage(&g, peer.index, "pending", 3));
    try std.testing.expectEqual(ReportOutcome{ .applied = .ignore }, g.report(event.handle, .ignore, Now.fromMilliseconds(.{ .mono_ms = 4, .unix_s = 1 })));
    _ = try g.publish("/eth2/01020304/voluntary_exit/ssz_snappy", "reuse", Now.fromMilliseconds(.{ .mono_ms = 5, .unix_s = 1 }));
    try std.testing.expectEqualStrings("pending", event.bytes);
    try std.testing.expectEqualStrings(topic, event.topic);
    try std.testing.expectEqual(ReportOutcome.already_resolved, g.report(event.handle, .accept, Now.fromMilliseconds(.{ .mono_ms = 6, .unix_s = 1 })));
    try std.testing.expectEqual(@as(?usize, 1), try testMessage(&g, peer.index, "expires", 7));
    const expires = inbox.last().handle;
    try std.testing.expectEqual(ReportOutcome.expired, g.report(expires, .accept, Now.fromMilliseconds(.{ .mono_ms = 30_007, .unix_s = 1 })));
    try std.testing.expectEqual(ReportOutcome.stale_handle, g.report(expires, .accept, Now.fromMilliseconds(.{ .mono_ms = 60_007, .unix_s = 1 })));
}

test "gossipsub validation attribution cannot penalize reused source or duplicate slots" {
    var g = try support.init(std.testing.allocator, .{
        .random_seed = 1,
    });
    defer g.deinit();
    const source_conn: Handle = .{ .index = 0, .generation = 1 };
    const duplicate_conn: Handle = .{ .index = 1, .generation = 1 };
    const source = support.addPeer(&g, source_conn, .v1_2).?;
    const duplicate = support.addPeer(&g, duplicate_conn, .v1_2).?;
    const topic = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, topic);
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    try std.testing.expectEqual(@as(?usize, 1), try testMessage(&g, source.index, "invalid", 1));
    const handle = inbox.last().handle;
    try std.testing.expectEqual(@as(?usize, 0), try testMessage(&g, duplicate.index, "invalid", 2));
    g.connectionClosed(source_conn);
    g.connectionClosed(duplicate_conn);
    const replacement1 = support.addPeer(&g, .{ .index = 0, .generation = 2 }, .v1_2).?;
    const replacement2 = support.addPeer(&g, .{ .index = 1, .generation = 2 }, .v1_2).?;
    try std.testing.expectEqual(ReportOutcome{ .applied = .reject }, g.report(handle, .reject, Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 1 })));
    try std.testing.expectEqual(@as(f64, 0), g.peers.score(g.sessions.rows[replacement1.index].logical, 3));
    try std.testing.expectEqual(@as(f64, 0), g.peers.score(g.sessions.rows[replacement2.index].logical, 3));
}

test "gossip duplicate fast path ignores host capacity and malformed bodies receive penalties" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .validation_capacity = 1 });
    defer g.deinit();
    const peer = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    try std.testing.expectEqual(@as(?usize, 1), try testMessage(&g, peer.index, "pending", 1));
    const handle = inbox.last().handle;
    inbox.full = true;
    try std.testing.expectEqual(@as(?usize, 0), try testMessage(&g, peer.index, "pending", 2));
    inbox.full = false;
    try std.testing.expectEqual(@as(u64, 0), g.messages.storage_refusals[@intFromEnum(StorageRefusal.processor_capacity)]);
    _ = g.report(handle, .ignore, Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 1 }));
    try std.testing.expectEqual(@as(?usize, 0), try testMessage(&g, peer.index, "pending", 4));
    for (0..20) |_| {
        _ = receiveForTest(&g, peer.index, .{ .topic = name, .data = &.{5} }, Now.fromMilliseconds(.{ .mono_ms = 5, .unix_s = 1 }));
    }
    try std.testing.expectEqual(@as(f64, 20), support.invalidDeliveries(&g));
}

test "gossip recent attribution survives validation slot reuse and duplicate pressure" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .validation_capacity = 1 });
    defer g.deinit();
    const source = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const duplicate = support.addPeer(&g, .{ .index = 1, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    try std.testing.expectEqual(@as(?usize, 1), try testMessage(&g, source.index, "rejected", 1));
    const old = inbox.last().handle;
    _ = g.report(old, .reject, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    try std.testing.expectEqual(@as(?usize, 1), try testMessage(&g, source.index, "pending", 3));
    const current = inbox.last();
    try std.testing.expectEqual(old.index, current.handle.index);
    try std.testing.expect(old.generation != current.handle.generation);
    try std.testing.expectEqual(@as(?usize, 0), try testMessage(&g, duplicate.index, "rejected", 4));
    try std.testing.expectEqual(@as(f64, 2), support.invalidDeliveries(&g));
    try std.testing.expectEqual(@as(?usize, 0), try testMessage(&g, duplicate.index, "rejected", 5));
    try std.testing.expectEqual(@as(f64, 2), support.invalidDeliveries(&g));
    try std.testing.expectEqual(ReportOutcome.stale_handle, g.report(old, .accept, Now.fromMilliseconds(.{ .mono_ms = 6, .unix_s = 0 })));
    @memset(g.messages.fast, .{});
    try std.testing.expectEqual(@as(?usize, 0), try testMessage(&g, source.index, "pending", 7));
    try std.testing.expectEqualStrings("pending", current.bytes);
    try std.testing.expectEqualStrings(name, current.topic);
    try std.testing.expectEqual(ReportOutcome{ .applied = .ignore }, g.report(current.handle, .ignore, Now.fromMilliseconds(.{ .mono_ms = 8, .unix_s = 0 })));
    g.messages.expire(&g.peers, 30_008);
    try std.testing.expectEqual(@as(u32, 0), g.peers.rows[g.sessions.rows[source.index].logical.index].pins);
    try std.testing.expectEqual(@as(u32, 0), g.peers.rows[g.sessions.rows[duplicate.index].logical.index].pins);
}
