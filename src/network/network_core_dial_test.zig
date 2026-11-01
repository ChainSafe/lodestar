const failStatusRound = @import("network_core_test_support.zig").failStatusRound;
const failStatus = @import("network_core_test_support.zig").failStatus;
const schedule_test_support = @import("schedule_test_support.zig");
const std = @import("std");
const SelectedDial = @import("peers/dialing.zig").Dialing.SelectedDial;
const support = @import("quic/test_support.zig");
const t = @import("peers/types.zig");
const Engine = @import("quic/Engine.zig");
const resolvedOptions = @import("network_core_test_support.zig").resolvedOptions;
const Setup = @import("network_core_test_support.zig").Setup;
const clientWakeup = @import("network_core_test_support.zig").clientWakeup;
const enr = @import("peers/enr.zig");
const control = @import("peers/control.zig");
const KeyPair = @import("wire/keys.zig").KeyPair;
const custody = @import("peers/custody.zig");
const NetworkCore = @import("network_core.zig").NetworkCore;
const network_core_test_support = @import("network_core_test_support.zig");

/// Dials the discovered server, so the client's connection has a dialed endpoint.
fn dialServer(setup: *Setup) !void {
    var intents: [1]SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents));
    const handle = try setup.pair.client.dial(&intents[0].address, intents[0].peer, setup.pair.now);
    try std.testing.expect(setup.client.peer_manager.dialStarted(intents[0].token, handle));
}

fn serverStrikes(setup: *Setup, server: *const enr.Candidate) u8 {
    const history = &setup.client.peer_manager.catalog.history;
    return history.strikesFor(history.endpointKey(&server.peer, support.server_address), server.hints.sequence, setup.pair.now.millis());
}

fn discoverServer(setup: *Setup) !enr.Candidate {
    const server = try discoveredAt(2, support.server_address);
    try std.testing.expect(server.peer.eql(&setup.server.peerId()));
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.discoveredBatch(setup.client.protocols.gossipsub, &.{server}, setup.pair.now).accepted);
    return server;
}

/// Refuses the client's Status in flight at negotiation, then runs the close it starts.
fn refuseStatus(setup: *Setup) !void {
    try failStatus(setup, .negotiation_rejected);
    for (0..4) |_| try setup.step(1);
    setup.pair.advance(2_001);
    for (0..8) |_| try setup.step(1);
}

/// Checks that the client counted and closed `count` refused Status probes and recorded `rejections` early closes.
fn expectRefusals(setup: *Setup, count: u64, rejections: u64) !void {
    const manager = &setup.client.peer_manager;
    try std.testing.expectEqual(@as(u16, 0), manager.catalog.connectedCount());
    try std.testing.expectEqual(count, manager.control.counters.health_failures[@intFromEnum(control.Control.HealthProbe.status)]);
    try std.testing.expectEqual(count, manager.control.counters.closed[@intFromEnum(t.DisconnectReason.health_error)]);
    try std.testing.expectEqual(rejections, manager.catalog.rejections[@intFromEnum(t.Rejection.early_close)]);
}

fn discoveredAt(tag: u8, endpoint: t.Address) !enr.Candidate {
    var secret: [32]u8 = @splat(0);
    secret[31] = tag;
    const key = try KeyPair.fromSecretKey(&secret);
    const peer = t.PeerId.fromPublicKey(&key.publicKey());
    return .{ .peer = peer, .node_id = try custody.nodeId(&peer), .addresses = .{ endpoint, .unspecified }, .address_count = 1, .hints = .{ .sequence = 1, .record_hash = @splat(0), .fork = .{ .digest = @splat(0), .next_version = @splat(0), .next_epoch = 0 }, .next_fork_digest = null, .attnets = null, .syncnets = 0, .custody_group_count = null } };
}

test "core Status and Metadata clear dial failures that QUIC admission keeps" {
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    const server = try discoverServer(&setup);
    const history = &setup.client.peer_manager.catalog.history;
    history.recordEndpoint(history.endpointKey(&server.peer, support.server_address), .unanswered, server.hints.sequence, setup.pair.now.millis());
    try dialServer(&setup);
    for (0..20) |_| {
        try setup.step(1);
        if (setup.client.peer_manager.catalog.connectedCount() == 1) break;
    }
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.catalog.connectedCount());
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.peerCounts().relevant);
    try std.testing.expectEqual(@as(u8, 1), serverStrikes(&setup, &server));
    for (0..50) |_| try setup.step(1);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
    try std.testing.expectEqual(@as(u8, 0), serverStrikes(&setup, &server));
    const peer = setup.client.peer_manager.catalog.find(&server.peer).?;
    try std.testing.expect(setup.client.peer_manager.control.connections[peer.index].evidence == .ready);
    setup.pair.advance(21_000);
    for (0..50) |_| try setup.step(1);
    try std.testing.expect(setup.client.peer_manager.control.connections[peer.index].evidence == .proven);
    try std.testing.expectEqual(@as(u8, 0), serverStrikes(&setup, &server));
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
}

test "core health strikes survive rediscovery and reconnect until a later probe succeeds" {
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    const server = try discoverServer(&setup);
    try dialServer(&setup);
    for (0..50) |_| try setup.step(1);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
    const limit = setup.client.peer_manager.control.options.health_failures_max;
    for (0..limit) |round| {
        try failStatusRound(&setup, .timeout);
        if (round + 1 < limit) setup.pair.advance(setup.client.peer_manager.control.options.failure_retry_ms);
    }
    setup.pair.advance(2_001);
    for (0..12) |_| try setup.step(1);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.catalog.connectedCount());
    try std.testing.expectEqual(@as(u8, 1), serverStrikes(&setup, &server));
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.catalog.intent_count);
    // Both sides hold a Goodbye cooldown after the health close.
    setup.pair.advance(60_000);
    _ = try discoverServer(&setup);
    try dialServer(&setup);
    for (0..50) |_| try setup.step(1);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
    try std.testing.expectEqual(@as(u64, 1), setup.client.peer_manager.dialing.retries[@intFromEnum(t.DialFailure.health)]);
    try std.testing.expectEqual(@as(u8, 1), serverStrikes(&setup, &server));
    setup.pair.advance(21_000);
    for (0..50) |_| try setup.step(1);
    try std.testing.expectEqual(@as(u8, 0), serverStrikes(&setup, &server));
}

test "core local probe stalls add no health strike" {
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    const server = try discoverServer(&setup);
    try dialServer(&setup);
    for (0..50) |_| try setup.step(1);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
    for (0..setup.client.peer_manager.control.options.health_failures_max + 1) |_| {
        try failStatusRound(&setup, .host_timeout);
        setup.pair.advance(setup.client.peer_manager.control.options.local_retry_ms);
    }
    setup.pair.advance(2_001);
    for (0..12) |_| try setup.step(1);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.catalog.connectedCount());
    try std.testing.expectEqual(@as(u8, 0), serverStrikes(&setup, &server));
}

test "core native leased dial retires uncompleted handshake and rejects late acknowledgements" {
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    var identity = setup.server.peerId();
    var address = support.server_address;
    try setup.client.peer_manager.connect(&identity, &.{address}, setup.pair.now);
    identity.bytes[0] ^= 1;
    address = .unspecified;
    var output: [1]SelectedDial = undefined;
    try std.testing.expectEqual(
        @as(usize, 1),
        setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &output),
    );
    const intent = output[0];
    try std.testing.expect(intent.peer.eql(&setup.server.peerId()));
    try std.testing.expect(intent.address.eql(support.server_address));
    const conn = try setup.pair.client.dial(
        &intent.address,
        intent.peer,
        setup.pair.now,
    );
    try std.testing.expect(setup.client.peer_manager.dialStarted(intent.token, conn));
    setup.pair.advance(10_000);
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(@as(u16, 0), setup.pair.client.registry.dialing);
    try std.testing.expectEqual(@as(u16, 0), setup.pair.client.registry.active_len);
    try std.testing.expect(setup.pair.client.registry.slots[conn.index].conn == null);
    try std.testing.expect(!setup.client.peer_manager.dialStarted(intent.token, conn));
    try std.testing.expect(!setup.client.peer_manager.dialFailed(intent.token, setup.pair.now));
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.dialing.schedule(&setup.client.peer_manager.catalog, 1), setup.pair.now.millis()).? >
        setup.pair.now.millis());
}

test "core native dial expiry closes authenticated attempt before connected event delivery" {
    for ([_]bool{ false, true }) |shutdown| {
        var setup: Setup = .{};
        try setup.initOwners(&.{});
        defer setup.deinit();
        try setup.client.peer_manager.connect(
            &setup.server.peerId(),
            &.{support.server_address},
            setup.pair.now,
        );
        var output: [1]SelectedDial = undefined;
        _ = setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &output);
        const intent = output[0];
        const conn = try setup.pair.client.dial(
            &intent.address,
            intent.peer,
            setup.pair.now,
        );
        try std.testing.expect(setup.client.peer_manager.dialStarted(intent.token, conn));
        try setup.pair.pump();
        try std.testing.expect(setup.pair.client.peerId(conn) != null);
        if (shutdown) {
            setup.client.shutdown(setup.pair.now);
            try std.testing.expectEqual(@as(u16, 0), setup.client.peerCounts().connected);
            setup.client.deinit(setup.pair.io());
            continue;
        }
        setup.pair.advance(10_000);
        const progress = setup.client.advance(setup.pair.io(), .{ .now = setup.pair.now, .readiness = .{} }, .{}, .{});
        try std.testing.expect(progress.failure == null);
        _ = setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &output);
        for (0..8) |_| {
            try setup.pair.pump();
            var events: [32]Engine.Event = undefined;
            _ = setup.pair.events(setup.pair.client, &events);
            _ = setup.pair.events(setup.pair.server, &events);
        }
        try std.testing.expect(setup.pair.client.registry.slots[conn.index].conn == null);
        try std.testing.expectEqual(@as(u16, 0), setup.pair.client.registry.outbound);
        try std.testing.expectEqual(@as(u16, 0), setup.pair.client.registry.active_len);
    }
}

test "core simultaneous selected dials consume one commitment and preserve duplicate tie breaking" {
    var setup: Setup = .{};
    var opts = resolvedOptions();
    opts.core.peers.target_peers = 1;
    opts.core.peers.max_peers = 2;
    opts.core.peers.min_outbound = 0;
    try setup.initOwnersWithOptions(&.{}, opts);
    defer setup.deinit();
    const nodes = [_]*NetworkCore{ &setup.client, &setup.server };
    const identities = [_]t.PeerId{ setup.server.peerId(), setup.client.peerId() };
    const addresses = [_]t.Address{ support.server_address, support.client_address };
    const blocker: t.PeerId = .{ .bytes = @splat(99) };
    for (nodes, &identities, addresses) |node, *identity, address| {
        const owner = &node.peer_manager;
        try std.testing.expect(owner.catalog.admit(&blocker, &owner.local_identity, .{ .index = 3, .generation = 1 }, &.{
            .direction = .inbound,
            .endpoint = .unspecified,
            .now_ms = setup.pair.now.millis(),
            .outbound_reserved = 1,
        }) == .admitted);
        try owner.connect(identity, &.{address}, setup.pair.now);
        var intents: [1]SelectedDial = undefined;
        try std.testing.expectEqual(@as(usize, 1), owner.selectDials(node.protocols.gossipsub, &node.transport.engine, setup.pair.now, &intents));
        const conn = try node.transport.engine.dial(&intents[0].address, intents[0].peer, setup.pair.now);
        try std.testing.expect(owner.dialStarted(intents[0].token, conn));
    }
    try setup.pair.pump();
    for (nodes, &identities) |node, *identity| {
        const owner = &node.peer_manager;
        _ = try setup.turn(node, .{});
        try std.testing.expectEqual(@as(u16, 2), owner.catalog.connectedCount());
        try std.testing.expectEqual(@as(u16, 0), owner.dialing.pendingPeers(&owner.catalog, null));
        const row = owner.catalog.rowFor(owner.catalog.find(identity).?).?;
        const expected: t.Direction = if (std.mem.order(u8, &owner.local_identity.bytes, &identity.bytes) == .lt) .outbound else .inbound;
        try std.testing.expectEqual(expected, row.direction);
        try std.testing.expectEqual(@as(u16, 0), owner.dialing.attempts().total);
        try std.testing.expectEqual(@as(u8, 0), row.dial.failures);
    }
    for (0..8) |_| {
        try setup.step(0);
        for (nodes) |node| try std.testing.expectEqual(@as(u16, 2), node.peer_manager.catalog.connectedCount());
    }
}

test "core competing one-shot attempt expires during selected peer ban cooldown" {
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    // The attempt's datagrams never arrive, so the server's own dial authenticates first.
    const unanswered: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4_009 } };
    setup.pair.drop_to_address = unanswered;
    try setup.client.peer_manager.connect(&setup.server.peerId(), &.{unanswered}, setup.pair.now);
    var intents: [1]SelectedDial = undefined;
    _ = setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents);
    const token = intents[0].token;
    const attempt = try setup.pair.client.dial(&intents[0].address, intents[0].peer, setup.pair.now);
    try std.testing.expect(setup.client.peer_manager.dialStarted(token, attempt));
    _ = try setup.pair.server.dial(&support.client_address, setup.client.peerId(), setup.pair.now);
    try setup.pair.pump();
    _ = try setup.turn(&setup.client, .{});
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expect(!std.meta.eql(attempt, snapshots[0].connection.?));
    try std.testing.expectEqual(t.ReputationDecision.ban, setup.client.peer_manager.reportPeer(&.{ .identity = setup.client.peer_manager.catalog.get(snapshots[0].peer).?.identity, .action = .fatal }, setup.pair.now).?);
    _ = try setup.turn(&setup.client, .{});
    setup.pair.advance(10_000);
    _ = setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents);
    for (0..8) |_| try setup.step(0);
    try std.testing.expect(setup.pair.client.registry.slots[attempt.index].conn == null);
    try std.testing.expect(!setup.client.peer_manager.dialStarted(token, attempt));
    try std.testing.expect(!setup.client.peer_manager.dialFailed(token, setup.pair.now));
    try std.testing.expectEqual(@as(u16, 0), setup.pair.client.registry.outbound);
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.dialing.schedule(&setup.client.peer_manager.catalog, 1), setup.pair.now.millis()));
    try std.testing.expectEqual(@as(usize, 0), setup.client.peer_manager.catalog.intent_count);
}

test "core review early native close preserves selected reason and counts it once" {
    for ([_]?t.DisconnectReason{ .host, .reputation, .banned, .incompatible_fork, null }) |reason| {
        var setup: Setup = .{};
        try setup.init(&.{});
        defer setup.deinit();
        for (0..50) |_| try setup.step(1);
        var snapshots: [4]t.Snapshot = undefined;
        _ = setup.server.peer_manager.snapshots(&snapshots);
        const remote_conn = snapshots[0].connection.?;
        _ = setup.client.peer_manager.snapshots(&snapshots);
        if (reason) |typed| {
            try std.testing.expect(setup.client.peer_manager.disconnect(snapshots[0].peer, typed, setup.pair.now));
            for (0..8) |_| try setup.step(0);
        }
        try std.testing.expect(setup.pair.server.close(remote_conn, 0));
        for (0..8) |_| try setup.step(0);
        var output: [1]t.Event = undefined;
        try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.catalog.pollEvents(&output));
        const expected = reason orelse .transport_closed;
        try std.testing.expectEqual(expected, output[0].closed.reason);
        try std.testing.expectEqual(@as(u64, 1), setup.client.peer_manager.control.counters.closed[@intFromEnum(expected)]);
        setup.pair.advance(2_000);
        for (0..8) |_| try setup.step(0);
        var total: u64 = 0;
        for (setup.client.peer_manager.control.counters.closed) |count| total += count;
        try std.testing.expectEqual(@as(u64, 1), total);
    }
}

test "core records a remote close of its dial before Status as an early close and none once ready" {
    for ([_]bool{ false, true }) |ready| {
        var setup: Setup = .{};
        try setup.init(&.{});
        defer setup.deinit();
        for (0..if (ready) 50 else 1) |_| try setup.step(0);
        var snapshots: [4]t.Snapshot = undefined;
        try std.testing.expectEqual(@as(usize, 1), setup.server.peer_manager.snapshots(&snapshots));
        const remote_conn = snapshots[0].connection.?;
        const server_view = setup.server.peer_manager.catalog.history.identityKey(&snapshots[0].identity);
        try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
        try std.testing.expectEqual(ready, snapshots[0].relevant);
        const client_view = setup.client.peer_manager.catalog.history.identityKey(&snapshots[0].identity);
        const gate: u64 = 0x47415445;
        try std.testing.expect(setup.pair.server.close(remote_conn, gate));
        for (0..8) |_| try setup.step(0);
        try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.catalog.connectedCount());
        const expected: ?t.Rejection = if (ready) null else .early_close;
        try std.testing.expectEqual(expected, setup.client.peer_manager.catalog.history.rejection(client_view, setup.pair.now.millis()));
        try std.testing.expectEqual(@as(u64, @intFromBool(!ready)), setup.client.peer_manager.catalog.rejections[@intFromEnum(t.Rejection.early_close)]);
        try std.testing.expectEqual(@as(?t.Rejection, null), setup.server.peer_manager.catalog.history.rejection(server_view, setup.pair.now.millis()));
    }
}

test "core records a refused Status on its dial before readiness as an early close that escalates across endpoints" {
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    const manager = &setup.client.peer_manager;
    const history = &manager.catalog.history;
    const second: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4_003 } };
    var server = try discoveredAt(2, support.server_address);
    server.addresses[1] = second;
    server.address_count = 2;
    const identity = history.identityKey(&server.peer);
    // Two health strikes block the first endpoint for 30 minutes, so the third dial takes the second.
    for ([_]struct { t.Address, u64 }{
        .{ support.server_address, 60_000 },
        .{ support.server_address, 15 * 60_000 },
        .{ second, 60 * 60_000 },
    }, 1..) |round, count| {
        try std.testing.expectEqual(@as(u16, 1), manager.discoveredBatch(setup.client.protocols.gossipsub, &.{server}, setup.pair.now).accepted);
        var intents: [1]SelectedDial = undefined;
        try std.testing.expectEqual(@as(usize, 1), manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents));
        try std.testing.expect(intents[0].address.eql(round[0]));
        const handle = try setup.pair.client.dial(&intents[0].address, intents[0].peer, setup.pair.now);
        try std.testing.expect(manager.dialStarted(intents[0].token, handle));
        setup.pair.server_source = round[0];
        for (0..20) |_| {
            try setup.step(1);
            if (manager.catalog.connectedCount() == 1) break;
        }
        try std.testing.expectEqual(@as(u16, 1), manager.catalog.connectedCount());
        const peer = manager.catalog.find(&server.peer).?;
        try std.testing.expect(manager.control.connections[peer.index].evidence == .pending);
        try refuseStatus(&setup);
        try expectRefusals(&setup, count, count);
        try std.testing.expectEqual(@as(?t.Rejection, .early_close), history.rejection(identity, setup.pair.now.millis()));
        try std.testing.expectEqual(setup.pair.now.millis() + round[1], history.rejectedUntil(identity, setup.pair.now.millis()));
        try std.testing.expectEqual(@as(u16, 1), manager.discoveredBatch(setup.client.protocols.gossipsub, &.{server}, setup.pair.now).refused);
        try std.testing.expectEqual(@as(u64, count), manager.dialing.refused.identity[@intFromEnum(t.Rejection.early_close)]);
        setup.pair.advance(round[1]);
    }
}

test "core refused Status records no rejection once ready or on an inbound connection" {
    for ([_]bool{ false, true }) |inbound| {
        var setup: Setup = .{};
        try setup.initDirection(&.{}, inbound);
        defer setup.deinit();
        const manager = &setup.client.peer_manager;
        // A dialer that starts no Status of its own leaves the connection short of readiness.
        if (inbound) setup.server.peer_manager.control.options.starts_per_turn_max = 0;
        for (0..50) |_| try setup.step(1);
        manager.reStatusPeers(setup.pair.now);
        try setup.step(1);
        const peer = manager.catalog.find(&setup.server.peerId()).?;
        try std.testing.expectEqual(!inbound, manager.control.connections[peer.index].evidence != .pending);
        try refuseStatus(&setup);
        try expectRefusals(&setup, 1, 0);
        try std.testing.expectEqual(@as(?t.Rejection, null), manager.catalog.history.rejection(manager.catalog.history.identityKey(&setup.server.peerId()), setup.pair.now.millis()));
    }
}

test "core refused Status inside the fork transition grace neither closes nor records" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    const manager = &setup.client.peer_manager;
    for (0..20) |_| {
        try setup.step(1);
        if (manager.peerCounts().relevant == 1) break;
    }
    const peer = manager.catalog.find(&setup.server.peerId()).?;
    const row = &manager.control.connections[peer.index];
    try std.testing.expect(row.evidence == .pending);
    var next = manager.local;
    next.fork.digest = @splat(3);
    next.status.fork_digest = next.fork.digest;
    try network_core_test_support.updateLocal(&setup.client, &next, setup.pair.now);
    try setup.step(1);
    try failStatus(&setup, .negotiation_rejected);
    for (0..4) |_| try setup.step(1);
    try std.testing.expect(setup.pair.now.millis() < row.transition_until_ms);
    try std.testing.expect(manager.catalog.get(peer).?.disconnect_reason == null);
    try std.testing.expectEqual(@as(?t.Rejection, null), row.rejection);
    try std.testing.expectEqual(@as(u64, 0), manager.control.counters.health_failures[@intFromEnum(control.Control.HealthProbe.status)]);
    // Past the grace, the same refusal closes and records.
    setup.pair.advance(row.transition_until_ms - setup.pair.now.millis());
    try setup.step(1);
    try refuseStatus(&setup);
    try expectRefusals(&setup, 1, 1);
}

test "core native public close cancels overlapping attempts and preserves bounded direct retry" {
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    // The attempt's datagrams never arrive, so the server's own dial authenticates first.
    const unanswered: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4_009 } };
    setup.pair.drop_to_address = unanswered;
    try setup.client.addDirectPeer(&setup.server.peerId(), &.{unanswered}, setup.pair.now);
    var intents: [1]SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents));
    const token = intents[0].token;
    const attempt = try setup.pair.client.dial(&intents[0].address, intents[0].peer, setup.pair.now);
    try std.testing.expect(setup.client.peer_manager.dialStarted(token, attempt));
    _ = try setup.pair.server.dial(&support.client_address, setup.client.peerId(), setup.pair.now);
    try setup.pair.pump();
    _ = try setup.turn(&setup.client, .{});
    var snapshots: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
    const accepted = snapshots[0];
    try std.testing.expect(!std.meta.eql(attempt, accepted.connection.?));
    const row = setup.client.peer_manager.catalog.rowFor(accepted.peer).?;
    try std.testing.expect(row.connection != null and row.attempt != null);
    try std.testing.expect(setup.client.closePeer(&accepted.identity, setup.pair.now));
    try std.testing.expect(row.connection == null and row.attempt == null);
    try std.testing.expect(setup.client.peer_manager.dialing.active[token.index].connection == null);
    try std.testing.expect(row.direct);
    try std.testing.expectEqual(token.generation, row.generation);
    try std.testing.expectError(error.StaleHandle, setup.pair.client.openStream(attempt));
    for (0..8) |_| try setup.step(0);
    try std.testing.expect(row.connection == null and row.attempt == null);
    try std.testing.expect(!setup.client.peer_manager.dialing.dialClosed(&setup.client.peer_manager.catalog, attempt, .handshake_timeout, setup.pair.now.millis()));
    const due = schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.dialing.schedule(&setup.client.peer_manager.catalog, 1), setup.pair.now.millis()) orelse return error.MissingRetryDeadline;
    try std.testing.expect(due >= setup.pair.now.millis() + 60_000);
    setup.pair.advance(due - setup.pair.now.millis());
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents));
    try std.testing.expectEqualDeep(accepted.identity, intents[0].peer);
    try std.testing.expectEqual(token.generation + 1, intents[0].token.generation);
}

test "core dial admission reserve counts only answered dials" {
    var setup: Setup = .{};
    var opts = resolvedOptions();
    opts.core.dial.concurrent_max = 2;
    opts.limits.dialing_max = 2;
    try setup.initOwnersWithOptions(&.{}, opts);
    defer setup.deinit();
    const dead: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4_999 } };
    setup.pair.drop_to_address = dead;
    const answering = try discoveredAt(9, support.server_address);
    const silent = try discoveredAt(10, dead);
    try std.testing.expectEqual(@as(u16, 2), setup.client.peer_manager.discoveredBatch(setup.client.protocols.gossipsub, &.{ answering, silent }, setup.pair.now).accepted);
    var intents: [2]SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 2), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents));
    for (intents) |intent| {
        const handle = try setup.pair.client.dial(&intent.address, intent.peer, setup.pair.now);
        try std.testing.expect(setup.client.peer_manager.dialStarted(intent.token, handle));
    }
    _ = setup.pair.transfer(setup.pair.client, setup.pair.server, support.client_address, false);
    setup.client.peer_manager.dialing.syncAnswered(setup.pair.client);
    try std.testing.expectEqual(@as(u16, 2), setup.client.peer_manager.dialing.pendingPeers(&setup.client.peer_manager.catalog, null));
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.dialing.answeredPeers(&setup.client.peer_manager.catalog, null));
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.dialing.answeredPeers(&setup.client.peer_manager.catalog, &answering.peer));
}

test "core inbound admission is not blocked by unanswered dials in flight" {
    var setup: Setup = .{};
    var opts = resolvedOptions();
    opts.core.dial.concurrent_max = 3;
    opts.limits.dialing_max = 3;
    try setup.initOwnersWithOptions(&.{}, opts);
    defer setup.deinit();
    setup.pair.client.limits.dialing_max = 3;
    const dead: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4_999 } };
    setup.pair.drop_to_address = dead;
    for (0..3) |index| {
        const silent = try discoveredAt(@intCast(20 + index), dead);
        try setup.client.peer_manager.connect(&silent.peer, &.{dead}, setup.pair.now);
    }
    var intents: [3]SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 3), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents));
    for (intents) |intent| {
        const handle = try setup.pair.client.dial(&intent.address, intent.peer, setup.pair.now);
        try std.testing.expect(setup.client.peer_manager.dialStarted(intent.token, handle));
    }
    _ = try setup.pair.server.dial(&support.client_address, setup.client.peerId(), setup.pair.now);
    for (0..60) |_| try setup.step(0);
    try std.testing.expectEqual(@as(u16, 3), setup.client.peer_manager.dialing.pendingPeers(&setup.client.peer_manager.catalog, null));
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.dialing.answeredPeers(&setup.client.peer_manager.catalog, null));
    const inbound = setup.client.peer_manager.catalog.find(&setup.server.peerId()) orelse return error.TestUnexpectedResult;
    try std.testing.expect(setup.client.peer_manager.catalog.rowFor(inbound).?.connection != null);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().connected);
}

test "core peer id mismatch releases the discovered endpoint and refuses its rediscovery" {
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    const stranger = try discoveredAt(9, support.server_address);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.discoveredBatch(setup.client.protocols.gossipsub, &.{stranger}, setup.pair.now).accepted);
    var intents: [1]SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents));
    const handle = try setup.pair.client.dial(&intents[0].address, intents[0].peer, setup.pair.now);
    try std.testing.expect(setup.client.peer_manager.dialStarted(intents[0].token, handle));
    for (0..20) |_| try setup.step(0);
    try std.testing.expect(setup.client.peer_manager.catalog.find(&stranger.peer) == null);
    try std.testing.expectEqual(@as(u64, 1), setup.client.peer_manager.dialing.outcomes[@intFromEnum(t.DialOutcome.peer_id_mismatch)]);
    var newer = stranger;
    newer.hints.sequence = 2;
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.discoveredBatch(setup.client.protocols.gossipsub, &.{newer}, setup.pair.now).refused);
    try std.testing.expectEqual(@as(usize, 0), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents));
    try std.testing.expectEqual(@as(u64, 0), setup.client.peer_manager.dialing.retries[@intFromEnum(t.DialFailure.peer_id_mismatch)]);
}

test "core remembers a served dial, keeps it through close, and replays it after a restart" {
    const remembered = @import("peers/remembered.zig");
    var records: [remembered.capacity]remembered.Record = undefined;
    var count: usize = 0;
    {
        var setup: Setup = .{};
        try setup.initOwners(&.{});
        defer setup.deinit();
        const server = try discoverServer(&setup);
        try dialServer(&setup);
        for (0..60) |_| try setup.step(1);
        try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
        // Pings keep the connection serving while five minutes pass.
        for (0..20) |_| {
            setup.pair.advance(15_000);
            for (0..10) |_| try setup.step(1);
        }
        try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
        count = setup.client.peer_manager.rememberedPeers(setup.pair.now, &records);
        try std.testing.expectEqual(@as(usize, 1), count);
        try std.testing.expect(records[0].peer.eql(&server.peer));
        try std.testing.expect(records[0].address.eql(support.server_address));
        try std.testing.expectEqual(@as(u64, support.now_unix), records[0].qualified_at_s);
        var inbound: [remembered.capacity]remembered.Record = undefined;
        try std.testing.expectEqual(@as(usize, 0), setup.server.peer_manager.rememberedPeers(setup.pair.now, &inbound));
        // Close clears the peer state but keeps the records a final snapshot reads.
        setup.client.shutdown(setup.pair.now);
        try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.catalog.connectedCount());
        try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.catalog.intent_count);
        try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.rememberedPeers(setup.pair.now, &inbound));
        try std.testing.expectEqualDeep(records[0], inbound[0]);
    }
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    setup.client.peer_manager.loadRemembered(records[0..count], setup.pair.now);
    var intents: [1]SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents));
    try std.testing.expect(intents[0].peer.eql(&records[0].peer));
    try std.testing.expect(intents[0].address.eql(support.server_address));
    const handle = try setup.pair.client.dial(&intents[0].address, intents[0].peer, setup.pair.now);
    try std.testing.expect(setup.client.peer_manager.dialStarted(intents[0].token, handle));
    for (0..60) |_| try setup.step(1);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
    const funnel = setup.client.peer_manager.catalog.remembered.counters.funnel;
    try std.testing.expectEqual([3]u64{ 1, 1, 0 }, funnel[@intFromEnum(remembered.Origin.remembered)]);
    try std.testing.expectEqual([3]u64{ 0, 0, 0 }, funnel[@intFromEnum(remembered.Origin.fresh)]);
    try std.testing.expect(setup.client.peer_manager.catalog.remembered.nextReplay(support.now_unix) == null);
}
