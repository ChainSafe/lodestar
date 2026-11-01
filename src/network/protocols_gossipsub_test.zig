const topic_fixture = @import("gossipsub/topic_fixture.zig");
const schedule_test_support = @import("schedule_test_support.zig");
const gossip_test = @import("gossipsub/test_support.zig");
const std = @import("std");
const Protocols = @import("protocols.zig").Protocols;
const topic_mod = @import("gossipsub/topic.zig");
const Engine = @import("quic/Engine.zig");
const support = @import("quic/test_support.zig");
const negotiate = @import("negotiate.zig");
const multistream = @import("wire/multistream.zig");
const sessions = @import("gossipsub/sessions.zig");
const protocols_test_support = @import("protocols_test_support.zig");
const control_fixture = @import("reqresp/control_fixture.zig");
const ReqResp = @import("reqresp/ReqResp.zig");
const policy_fixture = @import("reqresp/policy_fixture.zig");
const session_io = @import("gossipsub/session_io.zig");
const peer_book = @import("gossipsub/peer_book.zig");
const configuration = @import("configuration.zig");
const router = @import("router.zig");

const digest = topic_mod.ForkDigest{ 0x6a, 0x95, 0xa1, 0xa9 };
const heartbeat = @import("gossipsub/constants.zig").heartbeat_interval_ms;

const Pair = @import("gossipsub/test_pair.zig").Pair;

test "gossipsub protocol stack composes the mesh and delivers a message" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();

    var buf: [topic_mod.topic_max_len]u8 = undefined;
    const beacon_block = topic_mod.build(digest, "beacon_block", &buf);
    try gossip_test.subscribe(setup.shared.client.gossipsub, beacon_block);
    try gossip_test.subscribe(setup.shared.server.gossipsub, beacon_block);

    var rounds: usize = 0;
    while (rounds < 10) : (rounds += 1) try setup.pumpOnce();
    setup.shared.pair.advance(heartbeat + 100);
    rounds = 0;
    while (rounds < 10) : (rounds += 1) try setup.pumpOnce();

    const payload = "a block delivered through the gossipsub service";
    _ = try setup.shared.client.gossipsub.publish(beacon_block, payload, setup.shared.pair.now);

    var received = false;
    rounds = 0;
    while (rounds < 20 and !received) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverMessages()) |m| {
            try std.testing.expectEqualStrings(payload, m.bytes);
            _ = setup.shared.server.gossipsub.report(m.handle, .accept, setup.shared.pair.now);
            received = true;
        }
    }
    try std.testing.expect(received);
    try std.testing.expectEqual(@as(u64, 1), setup.shared.server.gossipsub.topic_metrics.get(beacon_block).accepted);
}

test "gossipsub protocol stack does not retry a closed outbound stream" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    for (0..16) |_| try setup.pumpOnce();
    const index = setup.shared.client.gossipsub.sessions.find(setup.shared.handles.client).?;
    const first = setup.shared.client.gossipsub.sessions.outStream(index).?;
    const remote = setup.shared.server.gossipsub.sessions.rows[setup.shared.server.gossipsub.sessions.find(setup.shared.handles.server).?].in_stream.?;
    try std.testing.expectEqual(first.id, remote.id);
    setup.shared.pair.server.closeStream(remote, 0);
    for (0..4) |_| try setup.pumpOnce();
    try std.testing.expect(setup.shared.client.gossipsub.sessions.outStream(index) == null);
    const started = setup.shared.client.gossipsub.counters.negotiation_started;
    for (0..10) |_| {
        setup.shared.pair.advance(30_000);
        for (0..16) |_| try setup.pumpOnce();
        try std.testing.expect(!setup.shared.client.gossipsub.deliveryAvailable(setup.shared.handles.client));
    }
    try std.testing.expectEqual(started, setup.shared.client.gossipsub.counters.negotiation_started);
}

test "gossipsub active send deadline is absolute and direct peers do not retry streams" {
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1, .active_send_timeout_ms = 100 }, .{ .random_seed = 1 });
    defer setup.deinit();
    try setup.connectMesh();
    const g = setup.shared.client.gossipsub;
    const index = g.sessions.find(setup.shared.handles.client).?;
    const row = &g.sessions.rows[index];
    g.markDirect(row.conn);
    for (0..4) |_| try setup.pumpOnce();
    const started = g.counters.negotiation_started;
    const before = g.peers.scores.penalties;
    g.options.output_per_peer = 1;
    _ = try g.publish("/eth2/01020304/beacon_block/ssz_snappy", "a partially written payload", setup.shared.pair.now);
    try setup.pumpOnce();
    const deadline = row.io.tx.active_deadline_ms.?;
    const sent = row.io.tx.active.data.sent();
    setup.shared.pair.advance(99);
    try setup.pumpOnce();
    try std.testing.expect(row.io.tx.active.data.sent() > sent);
    try std.testing.expectEqual(deadline, row.io.tx.active_deadline_ms.?);
    setup.shared.pair.advance(1);
    try setup.pumpOnce();
    try std.testing.expectEqual(.send_timeout, g.deliveryStatus(row.conn));
    try std.testing.expectEqual(@as(usize, 0), row.io.tx.data.count);
    try std.testing.expect(row.io.tx.active_deadline_ms == null);
    try std.testing.expectEqualDeep(before, g.peers.scores.penalties);
    setup.shared.pair.advance(60_000);
    for (0..4) |_| try setup.pumpOnce();
    try std.testing.expectEqual(started, g.counters.negotiation_started);
}

fn propose(pair: *support.Pair, conn: Engine.Handle, version: []const u8, payload: []const u8) !Engine.StreamHandle {
    const stream = try pair.client.openStream(conn);
    const dialer = try multistream.Dialer.init(version);
    var bytes: [512]u8 = undefined;
    const hello = try dialer.initialWrite(&bytes);
    @memcpy(bytes[hello.len..][0..payload.len], payload);
    const len = hello.len + payload.len;
    try std.testing.expectEqual(len, try pair.client.write(stream, bytes[0..len], false));
    return stream;
}

test "gossipsub replacement resets a partial frame and keeps directional versions" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    var topic_buf: [topic_mod.topic_max_len]u8 = undefined;
    const topic = topic_mod.build(digest, "beacon_block", &topic_buf);
    try gossip_test.subscribe(setup.shared.server.gossipsub, topic);
    for (0..16) |_| try setup.pumpOnce();
    const index = setup.shared.server.gossipsub.sessions.find(setup.shared.handles.server).?;
    const first = try propose(&setup.shared.pair, setup.shared.handles.client, "/meshsub/1.1.0", &.{ 0x80, 0x01, 0x08 });
    for (0..8) |_| try setup.pumpOnce();
    try std.testing.expectEqual(@as(?usize, 128), setup.shared.server.gossipsub.sessions.rows[index].io.reader.declaredLen());
    try std.testing.expectEqual(sessions.Version.v1_2, setup.shared.server.gossipsub.sessions.rows[index].outbound.live.version);
    var bytes: [160]u8 = undefined;
    const protobuf = @import("gossipsub/protobuf.zig");
    var writer = protobuf.Writer.init(&bytes);
    writer.varint(protobuf.subscriptionSize(topic));
    protobuf.writeSubscription(&writer, true, topic);
    _ = try propose(&setup.shared.pair, setup.shared.handles.client, "/meshsub/1.2.0", writer.written());
    for (0..16) |_| try setup.pumpOnce();
    try std.testing.expectEqual(@as(?usize, null), setup.shared.server.gossipsub.sessions.rows[index].io.reader.declaredLen());
    try std.testing.expectError(error.StreamStopped, setup.shared.pair.client.write(first, "x", false));
}

test "gossipsub protocol stack negotiates with a v1.1-only peer" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    setup.shared.server.deinit();
    setup.shared.server = try protocols_test_support.initProtocols(std.testing.allocator, .{ .control_reqresp = try control_fixture.controlOptions(), .reqresp = .{ .protocols = .application, .forks = &.{}, .connections = 4, .outbound_max = 1, .serving_max = 1, .inbound_per_connection_max = 1, .admission = try ReqResp.Options.Admission.defaults(&policy_fixture.config(), 1) }, .gossipsub = .{ .random_seed = 1 }, .router = .{ .meshsub_versions = &.{.v1_1} } }, &setup.shared.pair.server);
    setup.shared.server_inbox.attach(setup.shared.server.gossipsub);
    _ = setup.shared.server.gossipsub.peerConnected(&setup.shared.pair.server, setup.shared.handles.server, false, setup.shared.pair.now);
    for (0..24) |_| try setup.pumpOnce();
    const client_index = setup.shared.client.gossipsub.sessions.find(setup.shared.handles.client).?;
    const server_index = setup.shared.server.gossipsub.sessions.find(setup.shared.handles.server).?;
    try std.testing.expect(setup.shared.client.gossipsub.sessions.outStream(client_index) != null);
    try std.testing.expect(setup.shared.server.gossipsub.sessions.outStream(server_index) != null);
    try std.testing.expectEqual(sessions.Version.v1_1, setup.shared.client.gossipsub.sessions.rows[client_index].outbound.live.version);
    try std.testing.expectEqual(sessions.Version.v1_1, setup.shared.server.gossipsub.sessions.rows[server_index].outbound.live.version);
}

test "gossipsub protocol stack subscribes only after negotiation and retirement cancels the router" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    setup.shared.client.gossipsub.options.pressure_timeout_ms = 5;
    const topic = "/eth2/6a95a1a9/beacon_block/ssz_snappy";
    try gossip_test.subscribe(setup.shared.client.gossipsub, topic);
    _ = setup.shared.client.gossipsub.pump(&setup.shared.client.router, &setup.shared.pair.client, setup.shared.pair.now);
    const index = setup.shared.client.gossipsub.sessions.find(setup.shared.handles.client).?;
    const session = &setup.shared.client.gossipsub.sessions.rows[index];
    try std.testing.expect(session.outbound == .negotiating);
    try std.testing.expectEqual(@as(usize, 0), session.io.tx.subscription_dirty.count());
    setup.shared.pair.advance(6);
    _ = setup.shared.client.gossipsub.pump(&setup.shared.client.router, &setup.shared.pair.client, setup.shared.pair.now);
    try std.testing.expect(setup.shared.client.gossipsub.admitted(setup.shared.handles.client));
    session_io.retirePeer(setup.shared.client.gossipsub, &setup.shared.client.router, &setup.shared.pair.client, index);
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(setup.shared.client.router.schedule(16), setup.shared.pair.now.millis()));
    try std.testing.expect(setup.shared.pair.client.peerId(setup.shared.handles.client) != null);
}

test "gossipsub protocol stack ignores stale outcomes after connection and peer slot reuse" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    for (0..16) |_| try setup.pumpOnce();
    const old_conn = setup.shared.handles.client;
    const old_index = setup.shared.client.gossipsub.sessions.find(old_conn).?;
    const old_generation = setup.shared.client.gossipsub.sessions.peerGeneration(old_index);
    const old_stream = setup.shared.client.gossipsub.sessions.outStream(old_index).?;
    try std.testing.expect(setup.shared.pair.client.close(old_conn, 0));
    for (0..16) |_| try setup.pumpOnce();
    setup.shared.pair.advance(30_000);
    for (0..4) |_| try setup.pumpOnce();
    const handles = try support.connectPair(&setup.shared.pair);
    setup.shared.handles = .{ .client = handles.client, .server = handles.server };
    _ = setup.shared.client.gossipsub.peerConnected(&setup.shared.pair.client, handles.client, false, setup.shared.pair.now);
    _ = setup.shared.server.gossipsub.peerConnected(&setup.shared.pair.server, handles.server, false, setup.shared.pair.now);
    for (0..16) |_| try setup.pumpOnce();
    const index = setup.shared.client.gossipsub.sessions.find(handles.client).?;
    try std.testing.expectEqual(old_index, index);
    try std.testing.expect(setup.shared.client.gossipsub.sessions.peerGeneration(index) != old_generation);
    try std.testing.expectEqual(old_conn.index, handles.client.index);
    try std.testing.expect(old_conn.generation != handles.client.generation);
    const live = setup.shared.client.gossipsub.sessions.outStream(index).?;
    setup.shared.client.gossipsub.negotiationResult(&setup.shared.pair.client, .{
        .stream = old_stream,
        .direction = .outbound,
        .protocol = .{ .meshsub = .v1_1 },
        .result = .{ .ready = .{ .protocol = .{ .meshsub = .v1_1 }, .leftover = "", .fin = false } },
    }, setup.shared.pair.now);
    _ = setup.shared.client.process(&setup.shared.pair.client, &.{.{ .stream_ready = .{ .stream = old_stream, .ready = .{ .writable = true } } }}, setup.shared.pair.now, .{});
    try std.testing.expectEqual(live, setup.shared.client.gossipsub.sessions.outStream(index).?);
    try std.testing.expectEqual(sessions.Version.v1_2, setup.shared.client.gossipsub.sessions.rows[index].outbound.live.version);
    const peer = setup.shared.client.gossipsub.peers.rows[setup.shared.client.gossipsub.sessions.rows[index].logical.index];
    try std.testing.expectEqual(setup.shared.pair.client.peerId(handles.client).?, peer.identity);
    try std.testing.expectEqual(setup.shared.pair.client.direction(handles.client).?, peer.direction);
    try std.testing.expectEqual(peer_book.normalize(setup.shared.pair.client.peerAddress(handles.client).?), peer.address);
}

test "gossipsub protocol stack detects an idle stop and reopens only on a new inbound stream" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    var topic_buffer: [topic_mod.topic_max_len]u8 = undefined;
    const topic = topic_mod.build(digest, "beacon_block", &topic_buffer);
    try gossip_test.subscribe(setup.shared.server.gossipsub, topic);
    for (0..16) |_| try setup.pumpOnce();
    const client_index = setup.shared.client.gossipsub.sessions.find(setup.shared.handles.client).?;
    const server_index = setup.shared.server.gossipsub.sessions.find(setup.shared.handles.server).?;
    const first = setup.shared.client.gossipsub.sessions.outStream(client_index).?;
    const remote = setup.shared.server.gossipsub.sessions.rows[server_index].in_stream.?;
    try std.testing.expectEqual(first.id, remote.id);
    const io = &setup.shared.client.gossipsub.sessions.rows[client_index].io;
    try std.testing.expect(!io.tx.pending());
    setup.shared.pair.server.closeStream(remote, 0);
    for (0..4) |_| try setup.pumpOnce();
    try std.testing.expect(setup.shared.client.gossipsub.sessions.outStream(client_index) == null);
    const started = setup.shared.client.gossipsub.counters.negotiation_started;
    setup.shared.pair.advance(30_000);
    for (0..16) |_| try setup.pumpOnce();
    try std.testing.expectEqual(started, setup.shared.client.gossipsub.counters.negotiation_started);
    try std.testing.expect(setup.shared.client.gossipsub.sessions.outStream(client_index) == null);
    const stream = try setup.shared.pair.server.openStream(setup.shared.handles.server);
    const dialer = try multistream.Dialer.init("/meshsub/1.2.0");
    var hello_buffer: [512]u8 = undefined;
    const hello = try dialer.initialWrite(&hello_buffer);
    try std.testing.expectEqual(hello.len, try setup.shared.pair.server.write(stream, hello, false));
    for (0..16) |_| try setup.pumpOnce();
    const replacement = setup.shared.client.gossipsub.sessions.outStream(client_index).?;
    try std.testing.expect(!std.meta.eql(first, replacement));
    try gossip_test.subscribe(setup.shared.client.gossipsub, topic);
    for (0..16) |_| try setup.pumpOnce();
}

test "gossipsub protocol stack preserves a remotely half-closed outbound stream without idle work hints" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    var topic_buffer: [topic_mod.topic_max_len]u8 = undefined;
    const topic = topic_mod.build(digest, "beacon_block", &topic_buffer);
    try gossip_test.subscribe(setup.shared.server.gossipsub, topic);
    for (0..16) |_| try setup.pumpOnce();
    const client_index = setup.shared.client.gossipsub.sessions.find(setup.shared.handles.client).?;
    const server_index = setup.shared.server.gossipsub.sessions.find(setup.shared.handles.server).?;
    const stream = setup.shared.client.gossipsub.sessions.outStream(client_index).?;
    const remote = setup.shared.server.gossipsub.sessions.rows[server_index].in_stream.?;
    try std.testing.expectEqual(@as(usize, 0), try setup.shared.pair.server.write(remote, "", true));
    for (0..16) |_| try setup.pumpOnce();
    setup.shared.pair.advance(1_000);
    for (0..16) |_| try setup.pumpOnce();
    try std.testing.expectEqual(stream, setup.shared.client.gossipsub.sessions.outStream(client_index).?);
    try setup.shared.pair.flush(&setup.shared.pair.client);
    for (0..8) |_| {
        _ = setup.shared.client.process(&setup.shared.pair.client, &.{}, setup.shared.pair.now, .{});
        try std.testing.expect(!setup.shared.pair.client.backlog());
    }
    try gossip_test.subscribe(setup.shared.client.gossipsub, topic);
    for (0..16) |_| try setup.pumpOnce();
    try std.testing.expectEqual(stream, setup.shared.client.gossipsub.sessions.outStream(client_index).?);
}

fn compositionAllocationPrefix(allocator: std.mem.Allocator) !void {
    const resolved = try configuration.resolve(.{ .gossip = .{ .topic_policy = comptime &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })}, .receive_arena_bytes = 16 * 1024 * 1024, .seen_capacity = 4096, .mcache_capacity = 256, .validation_capacity = 64, .mcache_arena_bytes = 16 * 1024 * 1024 }, .peers = .{ .capacity = 64, .outbound_reserve = 4, .target_peers = 8, .max_peers = 12, .min_outbound = 2 }, .seed = 1, .forks = &.{}, .admission_policy = policy_fixture.config() });
    var protocols = try Protocols.init(allocator, .{ .reqresp = resolved.core.protocols.reqresp, .control_reqresp = resolved.core.protocols.control_reqresp, .gossipsub = resolved.core.protocols.gossipsub, .router = .{ .negotiations_max = 2 } }, &try protocols_test_support.fixtureLocal(.{}));
    defer protocols.deinit();
    try std.testing.expectEqual(@as(usize, 12), protocols.gossipsub.sessions.rows.len);
    try std.testing.expectEqual(@as(usize, 2), protocols.router.negotiator.entries.len);
}

test "network composition with gossip cleans every initialization prefix" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, compositionAllocationPrefix, .{});
}

test "gossipsub rejected negotiation stays terminal without new inbound evidence" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    setup.shared.client.router.deinit();
    setup.shared.client.router = try router.Router.init(std.testing.allocator, .{ .meshsub_versions = &.{.v1_2} });
    setup.shared.server.router.deinit();
    setup.shared.server.router = try router.Router.init(std.testing.allocator, .{ .meshsub_versions = &.{.v1_1} });
    for (0..32) |_| try setup.pumpOnce();
    try std.testing.expectEqual(@as(u64, 1), setup.shared.client.gossipsub.counters.negotiation_started);
    const index = setup.shared.client.gossipsub.sessions.find(setup.shared.handles.client).?;
    try std.testing.expect(setup.shared.client.gossipsub.sessions.rows[index].outbound == .none);
    for (0..20) |_| {
        setup.shared.pair.advance(1_000);
        for (0..4) |_| try setup.pumpOnce();
    }
    try std.testing.expectEqual(@as(u64, 1), setup.shared.client.gossipsub.counters.negotiation_started);
    try std.testing.expect(setup.shared.pair.client.peerId(setup.shared.handles.client) != null);
}

test "gossipsub negotiation timeout releases resources without creating a retry deadline" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    setup.shared.client.gossipsub.markDirect(setup.shared.handles.client);
    try gossip_test.subscribe(setup.shared.client.gossipsub, "/eth2/6a95a1a9/beacon_block/ssz_snappy");
    _ = setup.shared.client.process(&setup.shared.pair.client, &.{}, setup.shared.pair.now, .{});
    setup.shared.pair.advance(negotiate.Negotiator.negotiate_timeout_ms + 1);
    _ = setup.shared.client.process(&setup.shared.pair.client, &.{}, setup.shared.pair.now, .{});
    _ = setup.shared.client.process(&setup.shared.pair.client, &.{}, setup.shared.pair.now, .{});
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(setup.shared.client.router.schedule(16), setup.shared.pair.now.millis()) == null);
    const index = setup.shared.client.gossipsub.sessions.find(setup.shared.handles.client).?;
    try std.testing.expect(setup.shared.client.gossipsub.sessions.rows[index].outbound == .none);
    try std.testing.expect(setup.shared.client.gossipsub.sessions.rows[index].io.deadlines(&setup.shared.client.gossipsub.options).next() == null);
    for (0..10) |_| {
        setup.shared.pair.advance(30_000);
        _ = setup.shared.client.process(&setup.shared.pair.client, &.{}, setup.shared.pair.now, .{});
    }
    try std.testing.expectEqual(@as(u64, 1), setup.shared.client.gossipsub.counters.negotiation_started);
}

test "gossipsub PRUNE exhaustion closes gossip streams and leaves the transport usable" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();
    const topic = "/eth2/6a95a1a9/beacon_block/ssz_snappy";
    try gossip_test.subscribe(setup.shared.client.gossipsub, topic);
    try gossip_test.subscribe(setup.shared.server.gossipsub, topic);
    for (0..32) |_| try setup.pumpOnce();
    const g = setup.shared.client.gossipsub;
    const index = g.sessions.find(setup.shared.handles.client).?;
    const topic_index = g.overlay.findTopic(topic).?;
    const generation = g.sessions.peerGeneration(index);
    const tx = &g.sessions.rows[index].io.tx;
    const full = try std.testing.allocator.alloc(u8, g.options.critical_bytes);
    defer std.testing.allocator.free(full);
    @memset(full, 0);
    try std.testing.expect(tx.injectFrame(full, true, setup.shared.pair.now.millis()) != null);
    g.overlay.prune(&g.overlayContext(setup.shared.pair.now.millis()), topic_index, index, 60_000, .excess);
    try std.testing.expect(g.sessions.rows[index].outbound == .closing);
    try std.testing.expect(!setup.shared.client.gossipsub.deliveryAvailable(setup.shared.handles.client));
    _ = setup.shared.client.gossipsub.pump(&setup.shared.client.router, &setup.shared.pair.client, setup.shared.pair.now);
    try std.testing.expect(!setup.shared.client.gossipsub.admitted(setup.shared.handles.client));
    try std.testing.expect(!g.sessions.matches(.{ .index = index, .generation = generation }));
    try std.testing.expect(!tx.pending());
    try std.testing.expectEqual(@as(usize, 0), tx.subscription_dirty.count());
    try std.testing.expect(!g.overlay.mesh(topic_index).isSet(index));
    try std.testing.expect(setup.shared.pair.client.peerId(setup.shared.handles.client) != null);
    _ = try setup.shared.pair.client.openStream(setup.shared.handles.client);
}
