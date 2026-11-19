const topic_fixture = @import("topic_fixture.zig");
const Now = @import("../types.zig").Now;
const support = @import("test_support.zig");
const std = @import("std");
const Gossipsub = @import("Gossipsub.zig");
const topic_mod = @import("topic.zig");
const ReportOutcome = Gossipsub.ReportOutcome;
const constants = @import("constants.zig");
const snappy = @import("snappy");
const receiveForTest = support.receiveMessage;
const testMessage = support.message;
const test_pair = @import("test_pair.zig");
const configuration = @import("../configuration.zig");
const policy_fixture = @import("../reqresp/policy_fixture.zig");

test "gossipsub legal maximum host acceptance forwards retained pages through actual IO" {
    var setup: test_pair.Pair = .{};
    const fixture = try configuration.resolve(.{ .gossip = .{ .topic_policy = comptime &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })}, .receive_arena_bytes = 16 * 1024 * 1024 }, .limits = .{ .connections_max = 16, .handshaking_max = 8, .dialing_max = 4 }, .peers = .{ .capacity = 64, .outbound_reserve = 4, .target_peers = 8, .max_peers = 12, .min_outbound = 2 }, .seed = 1, .forks = &.{}, .admission_policy = policy_fixture.config() });
    try setup.initOpts(fixture.core.protocols.gossipsub, fixture.core.protocols.gossipsub);
    defer setup.deinit();
    const topic = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(setup.shared.client.gossipsub, topic);
    try support.subscribe(setup.shared.server.gossipsub, topic);
    for (0..20) |_| try setup.pumpOnce();
    const destination = setup.shared.server.gossipsub.sessions.find(setup.shared.handles.server).?;
    // Session lookup uses the configured 16 connection slots.
    const source = support.addPeer(setup.shared.server.gossipsub, .{ .index = 7, .generation = 1 }, .v1_2).?;
    setup.shared.server.gossipsub.overlay.rows[setup.shared.server.gossipsub.overlay.findTopic(topic).?].mesh.set(destination);
    const payload = try std.testing.allocator.alloc(u8, constants.MAX_PAYLOAD_SIZE);
    defer std.testing.allocator.free(payload);
    var rng = std.Random.DefaultPrng.init(91);
    rng.random().bytes(payload);
    _ = support.pump(setup.shared.server.gossipsub, &setup.shared.pair.server, setup.shared.pair.now);
    // The sink path decodes into msg_scratch, so the wire bytes live elsewhere.
    const compressed = try std.testing.allocator.alloc(u8, constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE));
    defer std.testing.allocator.free(compressed);
    const len = try snappy.raw.compress(payload, compressed);
    try std.testing.expectEqual(@as(?usize, 1), receiveForTest(setup.shared.server.gossipsub, source.index, .{ .topic = topic, .data = compressed[0..len] }, setup.shared.pair.now));
    const handle = setup.shared.server_inbox.last().handle;
    const message = setup.shared.server.gossipsub.messages.validation.entries[handle.index].state.pending.message;
    try std.testing.expectEqual(ReportOutcome{ .applied = .accept }, setup.shared.server.gossipsub.report(handle, .accept, setup.shared.pair.now));
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.gossipsub.sessions.rows[destination].io.tx.data.count);
    var received = false;
    for (0..2000) |_| {
        try setup.pumpOnce();
        for (setup.clientMessages()) |delivered| {
            try std.testing.expectEqualSlices(u8, payload, delivered.bytes);
            received = true;
        }
        if (received) break;
    }
    try std.testing.expect(received);
    for (0..constants.mcache_len) |_| support.ageHistory(setup.shared.server.gossipsub);
    try std.testing.expect(setup.shared.server.gossipsub.messages.store.get(message) == null);
}

test "gossipsub configured IDONTWANT uses admitted compressed wire bytes" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .idontwant_min_data_size = 128 });
    defer g.deinit();
    const source = support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const destination = support.addPeer(&g, .{ .index = 1, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    g.overlay.rows[g.overlay.findTopic(name).?].mesh.set(destination.index);
    var payload: [126]u8 = undefined;
    for (&payload, 0..) |*byte, index| byte.* = @intCast(index);
    var compressed: [constants.maxCompressedLen(256)]u8 = undefined;
    for ([_]usize{ 124, 125, 126 }, [_]usize{ 127, 128, 129 }) |size, wire_size| {
        g.sessions.rows[destination.index].io.tx.cancelStream();
        const len = try snappy.raw.compress(payload[0..size], &compressed);
        try std.testing.expectEqual(wire_size, len);
        try std.testing.expectEqual(@as(?usize, 1), receiveForTest(&g, source.index, .{ .topic = name, .data = compressed[0..len] }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })));
        try std.testing.expectEqual(wire_size >= 128, g.sessions.rows[destination.index].io.tx.control.used > 0);
        g.sessions.rows[destination.index].io.tx.cancelStream();
        try std.testing.expectEqual(@as(?usize, 0), receiveForTest(&g, source.index, .{ .topic = name, .data = compressed[0..len] }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })));
        try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[destination.index].io.tx.control.used);
    }
    const len = try snappy.raw.compress(&([_]u8{0} ** 256), &compressed);
    try std.testing.expect(len < 128);
    try std.testing.expectEqual(@as(?usize, 1), receiveForTest(&g, source.index, .{ .topic = name, .data = compressed[0..len] }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })));
    try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[destination.index].io.tx.control.used);
    _ = receiveForTest(&g, source.index, .{ .topic = name, .data = &.{ 5, 0 } }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[destination.index].io.tx.control.used);
    const fresh_len = try snappy.raw.compress("nonadmitted", &compressed);
    g.options.idontwant_min_data_size = 0;
    inbox.full = true;
    try std.testing.expectEqual(@as(?usize, 0), receiveForTest(&g, source.index, .{ .topic = name, .data = compressed[0..fresh_len] }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })));
    try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[destination.index].io.tx.control.used);
    inbox.full = false;
    try std.testing.expectEqual(@as(?usize, 1), receiveForTest(&g, source.index, .{ .topic = name, .data = compressed[0..fresh_len] }, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 })));
    try std.testing.expect(g.sessions.rows[destination.index].io.tx.control.used > 0);
}

test "gossipsub remote forwarding honors IDONTWANT and preserves borrowed event through local publication" {
    var pair: test_pair.Pair = .{};
    try pair.init();
    defer pair.deinit();
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(pair.shared.client.gossipsub, name);
    try support.subscribe(pair.shared.server.gossipsub, name);
    for (0..20) |_| try pair.pumpOnce();
    const destination = pair.shared.server.gossipsub.sessions.find(pair.shared.handles.server).?;
    const source = support.addPeer(pair.shared.server.gossipsub, .{ .index = 77, .generation = 1 }, .v1_2).?;
    pair.shared.server.gossipsub.overlay.rows[pair.shared.server.gossipsub.overlay.findTopic(name).?].mesh.set(destination);
    const suppressed_id = topic_mod.validMessageId(name, "remote suppressed", .{});
    pair.shared.server.gossipsub.sessions.suppress(destination, suppressed_id, pair.shared.pair.now.millis(), 60_000);
    try std.testing.expectEqual(@as(?usize, 1), try testMessage(pair.shared.server.gossipsub, source.index, "remote suppressed", pair.shared.pair.now.millis()));
    const borrowed = pair.shared.server_inbox.last();
    try std.testing.expectEqual(ReportOutcome{ .applied = .accept }, pair.shared.server.gossipsub.report(borrowed.handle, .accept, pair.shared.pair.now));
    try std.testing.expectEqual(@as(usize, 0), pair.shared.server.gossipsub.sessions.rows[destination].io.tx.data.count);
    const local = try pair.shared.server.gossipsub.publish(name, "local while borrowed", pair.shared.pair.now);
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .selected = 1, .queued = 1 }, local);
    try std.testing.expectError(error.Duplicate, pair.shared.server.gossipsub.publish(name, "local while borrowed", pair.shared.pair.now));
    try std.testing.expectEqual(Gossipsub.PublishOutcome{ .duplicate = true }, try pair.shared.server.gossipsub.publishWithOptions(name, "local while borrowed", .{ .ignore_duplicate = true }, pair.shared.pair.now));
    try std.testing.expectEqualStrings(name, borrowed.topic);
    try std.testing.expectEqualStrings("remote suppressed", borrowed.bytes);
    var received: usize = 0;
    for (0..30) |_| {
        try pair.pumpOnce();
        for (pair.clientMessages()) |message| {
            try std.testing.expectEqualStrings("local while borrowed", message.bytes);
            received += 1;
        }
    }
    try std.testing.expectEqual(@as(usize, 1), received);
    try std.testing.expectEqual(@as(u64, 0), pair.shared.server.gossipsub.topic_metrics.get(name).forwarded);
    try std.testing.expectEqual(@as(?usize, 1), try testMessage(pair.shared.server.gossipsub, source.index, "remote forwarded", pair.shared.pair.now.millis()));
    try std.testing.expectEqual(ReportOutcome{ .applied = .accept }, pair.shared.server.gossipsub.report(pair.shared.server_inbox.last().handle, .accept, pair.shared.pair.now));
    try std.testing.expectEqual(@as(usize, 1), pair.shared.server.gossipsub.sessions.rows[destination].io.tx.data.count);
    received = 0;
    for (0..30) |_| {
        try pair.pumpOnce();
        for (pair.clientMessages()) |message| {
            try std.testing.expectEqualStrings("remote forwarded", message.bytes);
            received += 1;
        }
    }
    try std.testing.expectEqual(@as(usize, 1), received);
    try std.testing.expectEqual(@as(u64, 1), pair.shared.server.gossipsub.topic_metrics.get(name).forwarded);
}

test "gossip forwarding excludes recorded duplicate senders but reaches other mesh peers" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1 });
    defer g.deinit();
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try support.subscribe(&g, name);
    var peers: [3]u16 = undefined;
    for (&peers, 0..) |*peer, index| {
        peer.* = support.addPeer(&g, .{ .index = @intCast(index), .generation = 1 }, .v1_2).?.index;
        g.overlay.rows[g.overlay.findTopic(name).?].mesh.set(peer.*);
    }
    var inbox: support.Inbox = .{};
    defer inbox.deinit();
    inbox.attach(&g);
    try std.testing.expectEqual(@as(?usize, 1), try testMessage(&g, peers[0], "shared payload", 1));
    const handle = inbox.last().handle;
    try std.testing.expectEqual(@as(?usize, 0), try testMessage(&g, peers[1], "shared payload", 2));
    try std.testing.expectEqual(ReportOutcome{ .applied = .accept }, g.report(handle, .accept, Now.fromMilliseconds(.{ .mono_ms = 3, .unix_s = 0 })));
    try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[peers[0]].io.tx.data.count);
    try std.testing.expectEqual(@as(usize, 0), g.sessions.rows[peers[1]].io.tx.data.count);
    try std.testing.expectEqual(@as(usize, 1), g.sessions.rows[peers[2]].io.tx.data.count);
}
