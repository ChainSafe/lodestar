const failStatusRound = @import("network_core_test_support.zig").failStatusRound;
const schedule_test_support = @import("schedule_test_support.zig");
const gossip_test = @import("gossipsub/test_support.zig");
const std = @import("std");
const PeerManager = @import("peer_manager.zig").PeerManager;
const SelectedDial = @import("peers/dialing.zig").Dialing.SelectedDial;
const support = @import("quic/test_support.zig");
const t = @import("peers/types.zig");
const rr = @import("reqresp/root.zig");
const gossip = @import("gossipsub/root.zig");
const resolvedOptions = @import("network_core_test_support.zig").resolvedOptions;
const localState = @import("network_core_test_support.zig").localState;
const Setup = @import("network_core_test_support.zig").Setup;
const ForkSeq = @import("config").ForkSeq;
const network_core_test_support = @import("network_core_test_support.zig");
const control = @import("peers/control.zig");
const time = @import("time.zig");
const session_io = @import("gossipsub/session_io.zig");
const goodbye = @import("peers/goodbye.zig");
const NetworkCore = @import("network_core.zig").NetworkCore;
const router = @import("router.zig");

test "core native two owners establish relevance and fetch initial metadata without public output" {
    for ([_]ForkSeq{ .phase0, .altair, .fulu }) |fork| {
        const local: t.LocalState = .{
            .fork = .{ .fork = fork },
            .status = .{ .earliest_available_slot = if (fork.gte(.fulu)) 0 else null },
            .metadata = .{
                .seq_number = 3,
                .attnets = @splat(7),
                .custody_group_count = if (fork.gte(.fulu)) 1 else null,
            },
        };
        var setup: Setup = .{};
        try setup.init(&local);
        defer setup.deinit();
        for (0..60) |_| try setup.step(0);
        try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
        try std.testing.expectEqual(@as(u16, 1), setup.server.peer_manager.peerCounts().relevant);
        try std.testing.expectEqualSlices(u64, &.{ 0, 1 }, &setup.client.peer_manager.control.counters.events.connected);
        try std.testing.expectEqualSlices(u64, &.{ 1, 0 }, &setup.server.peer_manager.control.counters.events.connected);
        var snapshots: [4]t.Snapshot = undefined;
        try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
        try std.testing.expectEqualDeep(local.metadata, snapshots[0].metadata.?);
        try std.testing.expectEqual(t.Direction.outbound, snapshots[0].direction);
        _ = setup.server.peer_manager.snapshots(&snapshots);
        try std.testing.expectEqual(t.Direction.inbound, snapshots[0].direction);
        try std.testing.expectEqualDeep(local.metadata, snapshots[0].metadata.?);
    }
}

test "core publishes the authenticated endpoint after QUIC rebinding" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..60) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.server.peer_manager.snapshots(&snapshots));
    const before = snapshots[0];
    try std.testing.expect(before.relevant);
    const rebound: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4003 } };
    setup.pair.client_source = rebound;
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    for (0..60) |_| try setup.step(0);
    try std.testing.expectEqual(rebound, setup.pair.server.peerAddress(before.connection.?).?);
    const after = setup.server.peer_manager.catalog.get(before.peer).?;
    try std.testing.expectEqual(before.connection, after.connection);
    try std.testing.expectEqual(rebound, after.endpoint);
    var event: [1]t.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.server.peer_manager.pollEvents(&event));
    try std.testing.expectEqual(before.peer, event[0].updated.peer);
    try std.testing.expectEqual(rebound, event[0].updated.endpoint);
}

test "core native ping coalesces metadata and confirms unchanged freshness then periodic Status" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const before = snapshots[0].metadata_at_ms;
    setup.pair.advance(21_000);
    for (0..50) |_| try setup.step(1);
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expect(snapshots[0].metadata_at_ms > before);
    try network_core_test_support.updateLocal(&setup.server, &metadataUpdate(&setup.server, &localState(.{ .metadata = .{ .attnets = @splat(9) } }).metadata), setup.pair.now);
    var changed = setup.server.localState().metadata;
    try std.testing.expectEqual(@as(u64, 1), changed.seq_number);
    // Phase0 Metadata carries no custody count.
    changed.custody_group_count = null;
    setup.pair.advance(21_000);
    for (0..50) |_| try setup.step(0);
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expectEqualDeep(changed, snapshots[0].metadata.?);
    const status: t.Status = .{ .head_slot = 80 };
    try setup.server.updateStatus(&localState(.{ .status = status }).status);
    setup.pair.advance(300_000);
    for (0..50) |_| try setup.step(1);
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expectEqualDeep(status, snapshots[0].status.?);
}

test "core native immutable metadata response survives local update during pending writer" {
    var setup: Setup = .{};
    const old: t.LocalState = .{ .metadata = .{ .seq_number = 4, .attnets = @splat(8) } };
    try setup.init(&old);
    defer setup.deinit();
    var pending = false;
    for (0..40) |_| {
        try setup.step(0);
        for (setup.server.protocols.control_reqresp.inbound) |*slot| {
            if (!slot.request.occupied() or !slot.request.io.writing) continue;
            if (slot.request.protocol != .metadata_v1) continue;
            try std.testing.expect(slot.request.io.writing);
            const changed: t.Metadata = .{ .seq_number = 5, .attnets = @splat(9) };
            try network_core_test_support.updateLocal(&setup.server, &metadataUpdate(&setup.server, &localState(.{ .metadata = changed }).metadata), setup.pair.now);
            pending = true;
            break;
        }
        if (pending) break;
    }
    try std.testing.expect(pending);
    for (0..40) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expectEqualDeep(old.metadata, snapshots[0].metadata.?);
    setup.pair.advance(21_000);
    for (0..50) |_| try setup.step(0);
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expectEqual(@as(u64, 5), snapshots[0].metadata.?.seq_number);
}

test "core native control timeout releases owners independent of public output" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    setup.client.peer_manager.control.options.health_failures_max = 1;
    for (0..50) |_| try setup.step(0);
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    try setup.step(0);
    setup.pair.drop_to_server = true;
    setup.pair.advance(10_001);
    for (0..4) |_| try setup.step(0);
    setup.pair.advance(2_001);
    for (0..4) |_| try setup.step(0);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.catalog.connectedCount());
    var events: [1]t.Event = undefined;
    _ = setup.client.peer_manager.catalog.pollEvents(&events);
    try std.testing.expectEqual(t.DisconnectReason.health_timeout, events[0].closed.reason);
}

test "core native control disconnects only after consecutive health failures" {
    const status = @intFromEnum(control.Control.HealthProbe.status);
    const Case = struct { failure: rr.ReqResp.Failure, reason: ?t.DisconnectReason };
    for ([_]Case{
        .{ .failure = .stream_closed, .reason = .health_error },
        .{ .failure = .{ .invalid_response = error.Truncated }, .reason = .health_error },
        .{ .failure = .empty_response, .reason = .health_error },
        .{ .failure = .{ .negotiation_failed = .timeout }, .reason = .health_timeout },
        .{ .failure = .timeout, .reason = .health_timeout },
        .{ .failure = .host_timeout, .reason = null },
        .{ .failure = .quota_timeout, .reason = null },
        .{ .failure = .cancelled, .reason = null },
    }) |case| {
        var setup: Setup = .{};
        try setup.init(&.{});
        defer setup.deinit();
        for (0..50) |_| try setup.step(0);
        try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
        const limit = setup.client.peer_manager.control.options.health_failures_max;
        for (0..limit) |round| {
            try failStatusRound(&setup, case.failure);
            if (case.reason != null and round + 1 == limit) break;
            try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
            try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.catalog.connectedCount());
            setup.pair.advance(setup.client.peer_manager.control.options.failure_retry_ms);
        }
        if (case.reason) |reason| {
            try std.testing.expectEqual(@as(u64, limit), setup.client.peer_manager.control.counters.health_failures[status]);
            setup.pair.advance(2_001);
            for (0..12) |_| try setup.step(0);
            try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.catalog.connectedCount());
            var events: [1]t.Event = undefined;
            try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.catalog.pollEvents(&events));
            try std.testing.expectEqual(reason, events[0].closed.reason);
        } else {
            try std.testing.expectEqual(@as(u64, 0), setup.client.peer_manager.control.counters.health_failures[status]);
            try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
        }
    }
}

test "core native control retries a failed probe on the turn its retry deadline passes" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    const peer = setup.client.peer_manager.catalog.find(&setup.server.peerId()).?;
    const row = &setup.client.peer_manager.control.connections[peer.index];
    const status = @intFromEnum(control.Control.HealthProbe.status);
    try failStatusRound(&setup, .timeout);
    try std.testing.expectEqual(@as(u8, 1), row.health_failures[status]);
    const retry = row.retry_ms;
    try std.testing.expectEqual(setup.pair.now.millis() + setup.client.peer_manager.control.options.failure_retry_ms, retry);
    try std.testing.expectEqual(retry, schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.control.schedule(&setup.client.peer_manager.catalog, setup.pair.now), setup.pair.now.millis()).?);
    const counter = &setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.status_v1)].outgoing;
    const started = counter.*;
    const visits = setup.client.peer_manager.control.visits;
    setup.pair.now.monotonic = time.milliseconds(retry - 1);
    try setup.step(0);
    try std.testing.expectEqual(started, counter.*);
    try std.testing.expectEqual(visits, setup.client.peer_manager.control.visits);
    setup.pair.now.monotonic = time.milliseconds(retry);
    try setup.step(0);
    try std.testing.expectEqual(started + 1, counter.*);
    try std.testing.expectEqual(visits + 1, setup.client.peer_manager.control.visits);
    try std.testing.expectEqual(@as(u8, 1), row.health_failures[status]);
}

test "core native control success clears a health failure streak" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    const peer = setup.client.peer_manager.catalog.find(&setup.server.peerId()).?;
    const status = @intFromEnum(control.Control.HealthProbe.status);
    const limit = setup.client.peer_manager.control.options.health_failures_max;
    for (0..2) |_| {
        for (0..limit - 1) |_| {
            try failStatusRound(&setup, .timeout);
            setup.pair.advance(setup.client.peer_manager.control.options.failure_retry_ms);
        }
        try std.testing.expectEqual(limit - 1, setup.client.peer_manager.control.connections[peer.index].health_failures[status]);
        setup.client.peer_manager.reStatusPeers(setup.pair.now);
        for (0..20) |_| try setup.step(0);
        try std.testing.expectEqual(@as(u8, 0), setup.client.peer_manager.control.connections[peer.index].health_failures[status]);
    }
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
}

fn allocationCheck(a: std.mem.Allocator) !void {
    const identity: t.PeerId = .{ .bytes = @splat(1) };
    const opts = resolvedOptions().core;
    const receive = router.Router.initialCapabilities(opts.protocols.router).receive;
    var core = try PeerManager.init(a, &identity, &localState(.{}), opts.peerManager(), receive, 4);
    defer core.deinit();
}

test "core startup allocation failure cleans every prefix" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocationCheck, .{});
}

test "core native deterministic replacement abandons old control and ignores stale physical close" {
    var setup: Setup = .{};
    const local: t.LocalState = .{ .fork = .{ .fork = .fulu, .minimum_sampling_groups = 8 }, .status = .{ .earliest_available_slot = 0 }, .metadata = .{ .custody_group_count = 4 } };
    try setup.initDirection(&local, true);
    defer setup.deinit();
    for (0..60) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const old = snapshots[0];
    try std.testing.expect(old.relevant);
    try std.testing.expectEqual(@as(usize, 4), old.custody_groups.?.count());
    try std.testing.expectEqual(@as(usize, 8), old.sampling_groups.?.count());
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    try setup.step(1);
    var old_request: ?rr.ReqResp.RequestHandle = null;
    for (setup.client.peer_manager.control.connections) |op| if (op.request != null) {
        old_request = op.request;
        break;
    };
    try std.testing.expect(old_request != null);
    _ = try setup.pair.dial();
    for (0..60) |_| try setup.step(1);
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expectEqualDeep(old.peer, snapshots[0].peer);
    try std.testing.expect(!std.meta.eql(old.connection, snapshots[0].connection));
    try std.testing.expect(snapshots[0].relevant);
    const selected = snapshots[0];
    try std.testing.expectEqual(old.custody_groups, selected.custody_groups);
    try std.testing.expectEqual(old.sampling_groups, selected.sampling_groups);
    try std.testing.expect(setup.pair.client.registry.slots[old.connection.?.index].conn == null);
    try std.testing.expectEqual(@as(u16, 1), setup.pair.client.registry.active_len);
    try std.testing.expectError(error.StaleHandle, setup.pair.client.openStream(old.connection.?));
    // The old Status has been abandoned and its physical connection has closed.
    for (setup.client.peer_manager.control.connections) |op| try std.testing.expect(!std.meta.eql(old_request, op.request));
    for (0..8) |_| try setup.step(1);
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expectEqualDeep(selected, snapshots[0]);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
}

test "core native saturated app requests retain partitioned borrows while controls progress" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const server_id = setup.server.peerId();
    const bytes = [_]u8{0} ** 8 ++ [_]u8{1} ++ [_]u8{0} ** 15;
    const sink_size = rr.Protocol.blocks_by_range_v2.info().response_max;
    const sinks = try std.testing.allocator.alloc(u8, sink_size * 8);
    defer std.testing.allocator.free(sinks);
    defer setup.client.deinit(setup.pair.io());
    const protocols = [_]rr.Protocol{
        .blocks_by_range_v2,
        .blocks_by_root_v2,
        .blob_sidecars_by_range_v1,
        .blob_sidecars_by_root_v1,
    };
    for (0..8) |index| {
        const protocol = protocols[index / 2];
        _ = try setup.client.sendReqRespRequest(
            &server_id,
            protocol,
            bytes[0..protocol.info().request_min],
            sinks[index * sink_size ..][0..sink_size],
            .{},
            setup.pair.now,
        );
    }
    try std.testing.expectError(
        error.TooManyRequests,
        setup.client.sendReqRespRequest(
            &server_id,
            .blocks_by_range_v2,
            &bytes,
            sinks[0..sink_size],
            .{},
            setup.pair.now,
        ),
    );
    try std.testing.expectError(
        error.ProtocolDisabled,
        setup.client.sendReqRespRequest(
            &server_id,
            .ping_v1,
            &([_]u8{0} ** 8),
            sinks[0..sink_size],
            .{},
            setup.pair.now,
        ),
    );
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    for (0..40) |_| try setup.step(0);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
    var applications: [1]rr.ReqResp.Event = undefined;
    var delivered: usize = 0;
    for (0..16) |_| {
        const counts = (try setup.turn(&setup.server, .{ .application = &applications })).counts;
        if (counts.application == 0) continue;
        if (applications[0] != .request) continue;
        const request = applications[0].request;
        try std.testing.expect(!request.protocol.isControl());
        try std.testing.expectEqualSlices(
            u8,
            bytes[0..request.protocol.info().request_min],
            request.bytes,
        );
        delivered += 1;
        _ = setup.server.protocols.reqresp.cancel(setup.pair.server, &setup.server.protocols.router, request.request, setup.pair.now);
    }
    try std.testing.expectEqual(@as(usize, 8), delivered);
}

test "core native local control capacity defers with future wakeup and no peer penalty" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const conn = snapshots[0].connection.?;
    var streams: usize = 0;
    for (0..64) |_| {
        _ = setup.pair.client.openStream(conn) catch break;
        streams += 1;
    }
    try std.testing.expect(streams > 0);
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    _ = try setup.turn(&setup.client, .{});
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expectEqual(@as(f64, 0), snapshots[0].score);
    try std.testing.expect(snapshots[0].relevant);
    const control_due = schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.control.schedule(&setup.client.peer_manager.catalog, setup.pair.now), setup.pair.now.millis()).?;
    try std.testing.expect(control_due > setup.pair.now.millis());
    setup.client.shutdown(setup.pair.now);
}

test "core retains explicit direct connections without periodically resurrecting gossip" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const selected = snapshots[0];
    const conn = selected.connection.?;
    try std.testing.expect(setup.client.peer_manager.catalog.setDirect(selected.peer, true));
    var remote: [4]t.Snapshot = undefined;
    _ = setup.server.peer_manager.snapshots(&remote);
    try std.testing.expect(setup.server.peer_manager.catalog.setDirect(remote[0].peer, true));
    const driver = setup.client.protocols.gossipsub;
    session_io.retirePeer(driver, &setup.client.protocols.router, setup.pair.client, driver.sessions.find(conn).?);
    const started = driver.counters.negotiation_started;
    for (0..4) |_| {
        setup.pair.advance(1_000);
        setup.client.peer_manager.reStatusPeers(setup.pair.now);
        for (0..16) |_| try setup.step(0);
        try std.testing.expect(!driver.admitted(conn));
        const snapshot = setup.client.peer_manager.catalog.get(selected.peer).?;
        try std.testing.expect(snapshot.relevant);
        try std.testing.expect(snapshot.disconnect_reason == null);
        try std.testing.expectEqual(@as(f64, 0), snapshot.score);
    }
    try std.testing.expectEqual(started, driver.counters.negotiation_started);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.selection.deficits.outbound);
}

test "core direct removal clears both pins and gossip score reads have no feedback" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    const identity = setup.server.peerId();
    try setup.client.addDirectPeer(&identity, &.{support.server_address}, setup.pair.now);
    setup.pair.advance(1_000);
    for (0..3) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expect(snapshots[0].direct);
    const conn = snapshots[0].connection.?;
    gossip_test.penalize(setup.client.protocols.gossipsub, conn, 7);
    const before = setup.client.peer_manager.gossipScore(setup.client.protocols.gossipsub, snapshots[0].peer, setup.pair.now).?;
    try std.testing.expect(std.math.isFinite(before));
    _ = setup.client.peer_manager.reportPeer(&.{ .identity = setup.client.peer_manager.catalog.get(snapshots[0].peer).?.identity, .action = .high_tolerance }, setup.pair.now);
    try std.testing.expectEqual(
        before,
        setup.client.peer_manager.gossipScore(setup.client.protocols.gossipsub, snapshots[0].peer, setup.pair.now).?,
    );
    _ = setup.client.removeDirectPeer(&identity);
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expect(!snapshots[0].direct);
    const logical = setup.client.protocols.gossipsub.peers.find(&identity).?;
    try std.testing.expect(!setup.client.protocols.gossipsub.peers.rows[logical.index].direct);
    var intents: [2]SelectedDial = undefined;
    try std.testing.expectEqual(
        @as(usize, 0),
        setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents),
    );
}

test "core native preserves gossip events under one output and caller validation wrappers" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    const topic = "/eth2/00000000/beacon_block/ssz_snappy";
    try gossip_test.subscribe(setup.client.protocols.gossipsub, topic);
    try gossip_test.subscribe(setup.server.protocols.gossipsub, topic);
    for (0..50) |_| try setup.step(0);
    setup.pair.advance(1_001);
    for (0..30) |_| try setup.step(0);
    for (0..30) |_| {
        try setup.pair.pump();
        _ = try setup.turn(&setup.server, .{});
        _ = try setup.turn(&setup.client, .{});
    }
    setup.pair.advance(1_001);
    for (0..10) |_| try setup.step(0);
    const payload = "bounded core gossip payload";
    _ = try setup.client.publishGossipWithOptions(topic, payload, .{ .allow_zero_peers = false }, setup.pair.now);
    try std.testing.expectError(error.Duplicate, setup.client.publishGossipWithOptions(topic, payload, .{}, setup.pair.now));
    try std.testing.expect((try setup.client.publishGossipWithOptions(topic, payload, .{ .ignore_duplicate = true }, setup.pair.now)).duplicate);
    var received: usize = 0;
    for (0..50) |_| {
        try setup.pair.pump();
        _ = try setup.turn(&setup.server, .{});
        for (setup.server_inbox.messages()) |message| {
            try std.testing.expectEqualStrings(payload, message.bytes);
            try std.testing.expectEqual(
                gossip.Gossipsub.ReportOutcome{ .applied = .accept },
                setup.server.protocols.gossipsub.report(message.handle, .accept, setup.pair.now),
            );
            try std.testing.expectEqualStrings(payload, message.bytes);
            received += 1;
        }
        setup.server_inbox.clear();
        _ = try setup.turn(&setup.client, .{});
    }
    try std.testing.expectEqual(@as(usize, 1), received);
    try gossip_test.unsubscribe(setup.client.protocols.gossipsub, topic);
}

test "core native continuous reStatus cannot starve due metadata sequence confirmation" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    try network_core_test_support.updateLocal(&setup.server, &metadataUpdate(&setup.server, &localState(.{ .metadata = .{ .attnets = @splat(12) } }).metadata), setup.pair.now);
    const sequence = setup.server.localState().metadata.seq_number;
    try std.testing.expect(sequence > 0);
    setup.pair.advance(21_000);
    for (0..60) |_| {
        setup.client.peer_manager.reStatusPeers(setup.pair.now);
        try setup.step(0);
    }
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expectEqual(sequence, snapshots[0].metadata.?.seq_number);
}

test "core native Goodbye immediately removes relevance and delayed Status cannot revive it" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const peer = snapshots[0].peer;
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    try setup.step(0);
    try std.testing.expectEqual(
        t.ReputationDecision.none,
        setup.client.peer_manager.reportPeer(&.{ .identity = setup.client.peer_manager.catalog.get(peer).?.identity, .action = .low_tolerance }, setup.pair.now).?,
    );
    try std.testing.expectEqual(
        t.ReputationDecision.disconnect,
        setup.client.peer_manager.reportPeer(&.{ .identity = setup.client.peer_manager.catalog.get(peer).?.identity, .action = .low_tolerance }, setup.pair.now).?,
    );
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.peerCounts().relevant);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().connected);
    for (0..20) |_| try setup.step(0);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.peerCounts().relevant);
    var event: [1]t.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.catalog.pollEvents(&event));
    try std.testing.expect(!event[0].updated.relevant);
    setup.pair.advance(2_000);
    for (0..4) |_| try setup.step(0);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.peerCounts().connected);
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.catalog.pollEvents(&event));
    try std.testing.expectEqual(t.DisconnectReason.reputation, event[0].closed.reason);
    const fault = @intFromEnum(goodbye.Reason.bad_score);
    try std.testing.expectEqual(@as(u64, 1), setup.server.peer_manager.control.counters.events.goodbyes[fault]);
    for (0..4) |_| try setup.step(0);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.peerCounts().connected);
}

test "core native peer counts distinguish open relevant invalidated and closed without scratch mutation" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    try setup.step(0);
    const owner: *const PeerManager = &setup.client.peer_manager;
    try std.testing.expectEqual(@as(u16, 1), owner.peerCounts().connected);
    try std.testing.expectEqual(@as(u16, 0), owner.peerCounts().relevant);
    for (0..60) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const captured = snapshots[0];
    var sentinel = captured;
    sentinel.peer.generation += 1;
    @memset(setup.client.peer_manager.snapshot_scratch, sentinel);
    const before = setup.client.peer_manager.snapshot_scratch[0..4].*;
    try std.testing.expectEqualDeep(PeerManager.PeerCounts{ .connected = 1, .relevant = 1, .outbound_relevant = 1 }, owner.peerCounts());
    try std.testing.expectEqualDeep(before, setup.client.peer_manager.snapshot_scratch[0..4].*);
    try std.testing.expect(setup.client.peer_manager.catalog.invalidateStatus(captured.peer, captured.connection.?));
    try std.testing.expectEqualDeep(PeerManager.PeerCounts{ .connected = 1, .relevant = 0, .outbound_relevant = 0 }, owner.peerCounts());
    try std.testing.expect(setup.client.closePeer(&captured.identity, setup.pair.now));
    try std.testing.expectEqualDeep(PeerManager.PeerCounts{ .connected = 0, .relevant = 0, .outbound_relevant = 0 }, owner.peerCounts());
    const offline: t.PeerId = .{ .bytes = @splat(9) };
    try setup.client.addDirectPeer(&offline, &.{support.server_address}, setup.pair.now);
    try std.testing.expect(setup.client.peer_manager.catalog.get(setup.client.peer_manager.catalog.find(&offline).?) == null);
    var direct: [1]t.PeerId = undefined;
    try std.testing.expectEqual(@as(usize, 1), try owner.directPeers(&direct));
    try std.testing.expect(direct[0].eql(&offline));
    try std.testing.expect(setup.client.removeDirectPeer(&offline));
    try std.testing.expect(!setup.client.removeDirectPeer(&offline));
}

fn metadataUpdate(node: *const NetworkCore, metadata: *const t.Metadata) t.LocalState {
    var local = node.localState();
    local.metadata = metadata.*;
    return local;
}

test "compact peer scores retain disconnected peers and match diagnostic score components" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..60) |_| try setup.step(1);
    const core = &setup.client;
    const scores = try std.testing.allocator.alloc(NetworkCore.PeerScore, core.peer_manager.catalog.options.capacity);
    defer std.testing.allocator.free(scores);
    try std.testing.expectError(error.OutputTooSmall, core.peerScores(setup.pair.now, scores[0..0]));
    var snapshots: [4]t.Snapshot = undefined;
    _ = core.peer_manager.snapshots(&snapshots);
    const peer = snapshots[0];
    const book = &core.protocols.gossipsub.peers;
    const ref = book.find(&peer.identity).?;
    book.scores.rows[ref.index].behaviour = 3;
    try std.testing.expectEqual(@as(usize, 1), try core.peerScores(setup.pair.now, scores));
    try std.testing.expectEqual(peer.score, scores[0].score);
    try std.testing.expectEqual(peer.score_at_ms, scores[0].score_at_ms);
    try std.testing.expectEqual(book.snapshot(ref, setup.pair.now.millis()), scores[0].gossip_score);
    const captured = scores[0];
    _ = core.closePeer(&peer.identity, setup.pair.now);
    for (0..60) |_| try setup.step(1);
    try std.testing.expectEqual(@as(u16, 0), core.peerCounts().connected);
    try std.testing.expectEqual(@as(usize, 1), try core.peerScores(setup.pair.now, scores));
    try std.testing.expectEqualDeep(captured.identity, scores[0].identity);
    try std.testing.expectEqual(book.snapshot(ref, setup.pair.now.millis()), scores[0].gossip_score);
}
