const gossip_test = @import("gossipsub/test_support.zig");
const std = @import("std");
const Setup = @import("network_core_test_support.zig").Setup;
const t = @import("peers/types.zig");
const rr = @import("reqresp/root.zig");
const Engine = @import("quic/Engine.zig");
const PeerManager = @import("peer_manager.zig").PeerManager;
const SelectedDial = @import("peers/dialing.zig").Dialing.SelectedDial;
const DiscoveryNeed = @import("peer_manager.zig").DiscoveryNeed;
const support = @import("quic/test_support.zig");
const resolvedOptions = @import("network_core_test_support.zig").resolvedOptions;
const localState = @import("network_core_test_support.zig").localState;
const updateDemand = @import("network_core_test_support.zig").updateDemand;
const policy_fixture = @import("reqresp/policy_fixture.zig");
const snappy = @import("snappy");
const multistream_mod = @import("wire/multistream.zig");
const network_core_test_support = @import("network_core_test_support.zig");
const policy = @import("peers/policy.zig");
const admission_fixture = @import("reqresp/admission_fixture.zig");

/// No application request reaches serving while the Goodbye goes out; `serving` is the serving
/// occupancy when quiescence began.
fn expectQuiescentGoodbye(setup: *Setup, serving: usize) !void {
    var received = false;
    for (0..80) |_| {
        try setup.pair.pump();
        var transport: [32]Engine.Event = undefined;
        _ = try setup.turn(&setup.client, .{});
        try std.testing.expectEqual(@as(usize, 0), setup.client_inbox.messages().len);
        try std.testing.expectEqual(@as(usize, 0), setup.client.protocols.gossipsub.messages.pendingValidations());
        try std.testing.expect(setup.client.protocols.reqresp.resourceSnapshot().serving_occupied <= serving);
        for (setup.client.protocols.reqresp.inbound) |slot| {
            if (slot.request.occupied() and !slot.request.protocol.isControl()) try std.testing.expect(slot.request.pendingEvent() == null);
        }
        var control: [8]rr.ReqResp.Event = undefined;
        const counts = setup.server.protocols.process(setup.pair.server, setup.pair.events(setup.pair.server, &transport), setup.pair.now, .{ .application = &.{}, .control = &control });
        for (control[0..counts.control]) |event| {
            if (event != .request or event.request.protocol != .goodbye_v1) continue;
            try std.testing.expectEqual(@as(u64, 1), std.mem.readInt(u64, event.request.bytes[0..8], .little));
            received = true;
        }
    }
    try std.testing.expect(received);
}

fn quiescenceRequest(mode: enum { fin, selection, delivered }) !void {
    const hold_selection = mode == .selection;
    const multistream = @import("wire/multistream.zig");
    var setup: Setup = .{};
    var opts = resolvedOptions();

    const quotas = admission_fixture.quotas(1000, 1000);
    opts.core.protocols.reqresp.admission = .{ .policy = policy_fixture.config(), .limits = .{ .source = quotas, .global = quotas } };
    try setup.initOwnersWithOptions(&.{}, opts);
    defer setup.deinit();
    _ = try setup.pair.dial();
    for (0..50) |_| try setup.step(0);
    var peers: [4]t.Snapshot = undefined;
    _ = setup.server.peer_manager.snapshots(&peers);
    const stream = try setup.pair.server.openStream(peers[0].connection.?);
    var bytes: [512]u8 = undefined;
    const header = try multistream.encodeMessage(multistream.header, &bytes);
    const proposal = try multistream.encodeMessage(rr.Protocol.blocks_by_root_v2.id(), bytes[header.len..]);
    const body = try rr.codec.encodeRequest(&([_]u8{7} ** 32), bytes[header.len + proposal.len ..]);
    const total = header.len + proposal.len + body.len;
    const first = if (hold_selection) header.len else total;
    try std.testing.expectEqual(first, try setup.pair.server.write(stream, bytes[0..first], mode == .delivered));
    for (0..20) |_| try setup.step(0);
    var held = false;
    if (hold_selection) {
        for (setup.client.protocols.router.negotiator.entries) |entry| {
            if (entry.state == .negotiating and entry.role == .listener and entry.stream.id == stream.id) held = true;
        }
    } else {
        for (setup.client.protocols.reqresp.inbound) |slot| {
            if (slot.request.running() and slot.request.protocol == .blocks_by_root_v2 and (slot.state == .receiving_request or mode == .delivered) and slot.request.io.decoder.isDone()) held = true;
        }
    }
    try std.testing.expect(held);
    var delivered: ?rr.ReqResp.RequestHandle = null;
    if (mode == .delivered) {
        var application: [1]rr.ReqResp.Event = undefined;
        const counts = (try setup.turn(&setup.client, .{ .application = &application })).counts;
        try std.testing.expectEqual(@as(usize, 1), counts.application);
        try std.testing.expectEqualSlices(u8, &([_]u8{7} ** 32), application[0].request.bytes);
        delivered = application[0].request.request;
    }
    const serving = setup.client.protocols.reqresp.resourceSnapshot().serving_occupied;
    setup.client.beginGracefulClose(setup.pair.now);
    if (delivered) |handle| {
        const request = &setup.client.protocols.reqresp.inbound[handle.index].request;
        try std.testing.expectEqual(.closed, request.stream_owner);
        try std.testing.expectEqual(.cancelled, request.terminalEvent().?.failed.reason);
    } else try std.testing.expectEqual(total - first, try setup.pair.server.write(stream, bytes[first..total], true));
    try expectQuiescentGoodbye(&setup, serving);
}

fn quiescenceGossip(hold_selection: bool) !void {
    const protobuf = @import("gossipsub/protobuf.zig");
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    const topic = "/eth2/00000000/beacon_block/ssz_snappy";
    try gossip_test.subscribe(setup.client.protocols.gossipsub, topic);
    try gossip_test.subscribe(setup.server.protocols.gossipsub, topic);
    for (0..50) |_| try setup.step(0);
    setup.pair.advance(1001);
    for (0..30) |_| try setup.step(0);
    var peers: [4]t.Snapshot = undefined;
    _ = setup.server.peer_manager.snapshots(&peers);
    const index = setup.server.protocols.gossipsub.sessions.find(peers[0].connection.?).?;
    var stream = setup.server.protocols.gossipsub.sessions.outStream(index).?;
    if (hold_selection) {
        stream = try setup.pair.server.openStream(peers[0].connection.?);
        var header_bytes: [64]u8 = undefined;
        const ms = @import("wire/multistream.zig");
        const header = try ms.encodeMessage(ms.header, &header_bytes);
        try std.testing.expectEqual(header.len, try setup.pair.server.write(stream, header, false));
        for (0..10) |_| try setup.step(0);
        var held = false;
        for (setup.client.protocols.router.negotiator.entries) |entry| {
            if (entry.state == .negotiating and entry.role == .listener and entry.stream.id == stream.id) held = true;
        }
        try std.testing.expect(held);
    }
    var compressed: [128]u8 = undefined;
    const size = try snappy.raw.compress("quiescence wire payload", &compressed);
    var bytes: [256]u8 = undefined;
    var writer = protobuf.Writer.init(&bytes);
    writer.varint(protobuf.messageSize(compressed[0..size], topic));
    protobuf.writeMessage(&writer, compressed[0..size], topic);
    const frame = writer.written();
    if (!hold_selection) try std.testing.expectEqual(frame.len - 1, try setup.pair.server.write(stream, frame[0 .. frame.len - 1], false));
    for (0..10) |_| try setup.step(0);
    try std.testing.expectEqual(@as(usize, 0), setup.client.protocols.gossipsub.resourceSnapshot().pending_validations);
    const serving = setup.client.protocols.reqresp.resourceSnapshot().serving_occupied;
    setup.client.beginGracefulClose(setup.pair.now);
    if (hold_selection) {
        var proposal_bytes: [64]u8 = undefined;
        const proposal = try multistream_mod.encodeMessage("/meshsub/1.2.0", &proposal_bytes);
        try std.testing.expectEqual(proposal.len, try setup.pair.server.write(stream, proposal, false));
    }
    const remaining = if (hold_selection) frame else frame[frame.len - 1 ..];
    try std.testing.expectEqual(remaining.len, try setup.pair.server.write(stream, remaining, false));
    try expectQuiescentGoodbye(&setup, serving);
    try std.testing.expectEqual(@as(usize, 0), setup.client.protocols.gossipsub.resourceSnapshot().pending_validations);
}

test "core native application response borrows survive same turn hard close" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const peer = snapshots[0].peer;
    const size = rr.Protocol.blocks_by_root_v2.info().response_max;
    const sink = try std.testing.allocator.alloc(u8, size);
    defer std.testing.allocator.free(sink);
    defer setup.client.deinit(setup.pair.io());
    const request = try setup.client.sendReqRespRequest(
        &setup.server.peerId(),
        .blocks_by_root_v2,
        &([_]u8{0} ** 32),
        sink,
        .{ .expected_chunks = 1 },
        setup.pair.now,
    );
    var response = [_]u8{7} ** rr.Protocol.blocks_by_root_v2.info().response_min;
    var received = false;
    var sent = false;
    for (0..50) |_| {
        try setup.pair.pump();
        var output: [1]rr.ReqResp.Event = undefined;
        const server = (try setup.turn(&setup.server, .{ .application = &output })).counts;
        if (server.application == 1) switch (output[0]) {
            .request => |incoming| {
                try setup.server.protocols.reqresp.respond(incoming.request, &response, .{ .digest = @splat(0), .fork = .phase0 }, setup.pair.now);
            },
            .chunk_sent => |chunk| {
                _ = setup.server.protocols.reqresp.finish(chunk.request, setup.pair.now);
                sent = true;
            },
            else => {},
        };
        if (sent and !received) {
            _ = setup.client.peer_manager.disconnect(peer, .host, setup.pair.now);
            // The queued application response and hard-close cleanup share the next owner turn.
            setup.pair.advance(2_000);
            try setup.pair.pump();
        }
        const client = (try setup.turn(&setup.client, .{ .application = &output })).counts;
        if (client.application == 1 and output[0] == .chunk) {
            try std.testing.expectEqualDeep(request, output[0].chunk.request);
            try std.testing.expectEqualSlices(u8, &response, output[0].chunk.bytes);
            try std.testing.expect(setup.client.protocols.reqresp.consume(setup.pair.client, &setup.client.protocols.router, request, setup.pair.now));
            try std.testing.expectEqualSlices(u8, &response, output[0].chunk.bytes);
            received = true;
            break;
        }
    }
    try std.testing.expect(received);
    try std.testing.expectError(
        error.StaleHandle,
        setup.server.protocols.reqresp.respondError(
            .{ .index = 65535, .generation = 42, .direction = .inbound },
            2,
            "busy",
            setup.pair.now,
        ),
    );
}

test "core native shutdown cancels shared negotiations before deinit" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const conn = snapshots[0].connection.?;
    _ = try setup.client.protocols.router.beginMeshsub(setup.pair.client, conn, setup.pair.now);
    try std.testing.expect(setup.client.protocols.router.negotiator.active() > 0);
    setup.client.shutdown(setup.pair.now);
    setup.client.shutdown(setup.pair.now);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peerCounts().connected);
    try std.testing.expectEqual(@as(u64, 1), setup.client.peer_manager.control.counters.closed[@intFromEnum(t.DisconnectReason.shutdown)]);
    try std.testing.expectEqual(@as(usize, 0), setup.client.protocols.router.negotiator.active());
    setup.client.deinit(setup.pair.io());
    try std.testing.expect(!setup.client.initialized);
}

test "core native application response borrows survive immediate public close" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const size = rr.Protocol.blocks_by_root_v2.info().response_max;
    const sink = try std.testing.allocator.alloc(u8, size);
    defer std.testing.allocator.free(sink);
    defer setup.client.deinit(setup.pair.io());
    const request = try setup.client.sendReqRespRequest(
        &setup.server.peerId(),
        .blocks_by_root_v2,
        &([_]u8{0} ** 32),
        sink,
        .{ .expected_chunks = 1 },
        setup.pair.now,
    );
    var response = [_]u8{7} ** rr.Protocol.blocks_by_root_v2.info().response_min;
    var received = false;
    for (0..50) |_| {
        try setup.pair.pump();
        var output: [1]rr.ReqResp.Event = undefined;
        const server = (try setup.turn(&setup.server, .{ .application = &output })).counts;
        if (server.application == 1) switch (output[0]) {
            .request => |incoming| {
                try setup.server.protocols.reqresp.respond(incoming.request, &response, .{ .digest = @splat(0), .fork = .phase0 }, setup.pair.now);
            },
            .chunk_sent => |chunk| {
                _ = setup.server.protocols.reqresp.finish(chunk.request, setup.pair.now);
            },
            else => {},
        };
        const client = (try setup.turn(&setup.client, .{ .application = &output })).counts;
        if (client.application == 1 and output[0] == .chunk) {
            try std.testing.expectEqualDeep(request, output[0].chunk.request);
            try std.testing.expectEqualSlices(u8, &response, output[0].chunk.bytes);
            try std.testing.expect(setup.client.closePeer(&snapshots[0].identity, setup.pair.now));
            try std.testing.expectEqualSlices(u8, &response, output[0].chunk.bytes);
            try std.testing.expect(setup.client.protocols.reqresp.consume(setup.pair.client, &setup.client.protocols.router, request, setup.pair.now));
            try std.testing.expectEqualSlices(u8, &response, output[0].chunk.bytes);
            received = true;
            break;
        }
    }
    try std.testing.expect(received);
}

test "application graceful quiescence sends shutdown Goodbye and suppresses admission" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    setup.client.beginGracefulClose(setup.pair.now);
    try std.testing.expect(setup.client.phase() == .quiescing);
    try std.testing.expectEqual(@as(u8, 0), setup.client.protocols.router.capabilities().receive.count());
    var received = false;
    for (0..80) |_| {
        try setup.pair.pump();
        var transport: [32]Engine.Event = undefined;
        _ = try setup.turn(&setup.client, .{});
        var control: [1]rr.ReqResp.Event = undefined;
        const counts = setup.server.protocols.process(setup.pair.server, setup.pair.events(setup.pair.server, &transport), setup.pair.now, .{ .application = &.{}, .control = &control });
        if (counts.control == 0) continue;
        try std.testing.expectEqual(rr.Protocol.goodbye_v1, control[0].request.protocol);
        try std.testing.expectEqual(@as(u64, 1), std.mem.readInt(u64, control[0].request.bytes[0..8], .little));
        received = true;
        break;
    }
    try std.testing.expect(received);
}

test "application quiescence rejects the final request FIN on an existing application stream" {
    try quiescenceRequest(.fin);
}

test "application quiescence rejects a held listener application selection" {
    try quiescenceRequest(.selection);
}

test "application quiescence rejects a partial message on an existing gossip stream" {
    try quiescenceGossip(false);
}

test "application quiescence rejects a held gossip listener message handoff" {
    try quiescenceGossip(true);
}

test "application quiescence immediately cancels a consumed request" {
    try quiescenceRequest(.delivered);
}

test "core native wrong fork Goodbye hard closes with zero output and shutdown repeats" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    try network_core_test_support.updateLocal(&setup.server, &localState(.{ .fork = .{ .digest = @splat(3) }, .status = .{ .fork_digest = @splat(3) } }), setup.pair.now);
    for (0..40) |_| try setup.step(0);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.peerCounts().relevant);
    setup.pair.advance(2_001);
    for (0..5) |_| try setup.step(0);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.catalog.connectedCount());
    try std.testing.expectEqual(@as(u16, 0), setup.server.peer_manager.catalog.connectedCount());
    var events: [1]t.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.catalog.pollEvents(&events));
    try std.testing.expectEqual(t.DisconnectReason.incompatible_fork, events[0].closed.reason);
    setup.client.shutdown(setup.pair.now);
    setup.client.shutdown(setup.pair.now);
}

test "core native hard close retires QUIC routes streams and registry with zero public output" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const conn = snapshots[0].connection.?;
    try std.testing.expect(setup.client.peer_manager.disconnect(snapshots[0].peer, .host, setup.pair.now));
    setup.pair.advance(2_000);
    for (0..8) |_| try setup.step(0);
    try std.testing.expect(setup.pair.client.registry.slots[conn.index].conn == null);
    try std.testing.expectEqual(@as(u16, 0), setup.pair.client.registry.active_len);
    try std.testing.expectEqual(@as(u16, 0), setup.pair.client.registry.outbound);
    try std.testing.expectEqual(@as(usize, 0), setup.pair.client.registry.routes.count);
    try std.testing.expectError(error.StaleHandle, setup.pair.client.openStream(conn));
}

test "core reconciliation clears policy observations at quiescence and shutdown" {
    for ([_]bool{ false, true }) |graceful| {
        var setup: Setup = .{};
        try setup.initOwners(&.{});
        defer setup.deinit();
        try updateDemand(&setup.client, &.{ .syncnets = 1 }, setup.pair.now);
        _ = try setup.turn(&setup.client, .{});
        try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.coverageDeficits().sync);
        try std.testing.expect(setup.client.peer_manager.discoveryNeed().general);
        if (graceful) {
            setup.client.beginGracefulClose(setup.pair.now);
        } else setup.client.shutdown(setup.pair.now);
        const view: *const PeerManager = &setup.client.peer_manager;
        const counters = view.counters;
        setup.pair.advance(60_000);
        setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
        try std.testing.expectEqualDeep(policy.Deficits{}, view.coverageDeficits());
        try std.testing.expectEqualDeep(DiscoveryNeed{}, view.discoveryNeed());
        try std.testing.expectEqualDeep(counters, view.counters);
        if (graceful) _ = try setup.turn(&setup.client, .{});
        try std.testing.expectEqualDeep(policy.Deficits{}, view.coverageDeficits());
        try std.testing.expectEqualDeep(DiscoveryNeed{}, view.discoveryNeed());
    }
}

test "core native immediate close preserves direct membership and rejects stale generations" {
    for ([_]usize{ 0, 1 }) |capacity| {
        var setup: Setup = .{};
        try setup.init(&.{});
        defer setup.deinit();
        for (0..60) |_| try setup.step(1);
        var snapshots: [4]t.Snapshot = undefined;
        _ = setup.client.peer_manager.snapshots(&snapshots);
        const captured = snapshots[0];
        try setup.client.addDirectPeer(&captured.identity, &.{support.server_address}, setup.pair.now);
        var identities: [4]t.PeerId = undefined;
        try std.testing.expectEqual(@as(usize, 1), try setup.client.peer_manager.directPeers(&identities));
        try std.testing.expect(setup.client.closePeer(&captured.identity, setup.pair.now));
        try std.testing.expect(!setup.client.closePeer(&captured.identity, setup.pair.now));
        try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.peerCounts().connected);
        try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.peerCounts().relevant);
        try std.testing.expect(setup.client.peer_manager.catalog.get(captured.peer).?.connection == null);
        try std.testing.expect(setup.client.peer_manager.catalog.rows[0].connection == null);
        try std.testing.expect(setup.client.peer_manager.catalog.selection_dirty);
        try std.testing.expectError(error.StaleHandle, setup.pair.client.openStream(captured.connection.?));
        const sink = try std.testing.allocator.alloc(u8, rr.Protocol.blocks_by_root_v2.info().response_max);
        defer std.testing.allocator.free(sink);
        try std.testing.expectError(error.Disconnected, setup.client.sendReqRespRequest(
            &captured.identity,
            .blocks_by_root_v2,
            &.{},
            sink,
            .{},
            setup.pair.now,
        ));
        var closed: [4]t.Event = undefined;
        try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.catalog.pollEvents(&closed));
        try std.testing.expectEqualDeep(captured.connection.?, closed[0].closed.connection);
        try std.testing.expectEqual(t.DisconnectReason.host, closed[0].closed.reason);
        for (0..60) |_| try setup.step(capacity);
        try std.testing.expectEqual(@as(usize, 0), setup.client.peer_manager.catalog.pollEvents(&closed));
        try std.testing.expectEqual(@as(u16, 0), setup.server.peer_manager.peerCounts().connected);
        try std.testing.expectEqual(@as(u64, 0), setup.server.peer_manager.control.counters.closed[@intFromEnum(t.DisconnectReason.remote_goodbye)]);
        try std.testing.expectEqual(@as(usize, 1), try setup.client.peer_manager.directPeers(&identities));
        _ = setup.server.peer_manager.catalog.pollEvents(&closed);
        setup.pair.advance(60_000);
        var intents: [1]SelectedDial = undefined;
        try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents));
        const replacement = try setup.pair.client.dial(&intents[0].address, intents[0].peer, setup.pair.now);
        try std.testing.expect(setup.client.peer_manager.dialStarted(intents[0].token, replacement));
        for (0..60) |_| try setup.step(1);
        try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
        const current = setup.client.peer_manager.catalog.get(captured.peer).?;
        try std.testing.expect(!std.meta.eql(captured.connection, current.connection));
        // The first connection's physical close reached the owner during these turns.
        for (0..4) |_| try setup.step(1);
        try std.testing.expectEqualDeep(current, setup.client.peer_manager.catalog.get(captured.peer).?);
        setup.client.shutdown(setup.pair.now);
        try std.testing.expect(!setup.client.closePeer(&current.identity, setup.pair.now));
    }
}
