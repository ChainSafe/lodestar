const schedule_test_support = @import("schedule_test_support.zig");
const std = @import("std");
const SelectedDial = @import("peers/dialing.zig").Dialing.SelectedDial;
const localState = @import("network_core_test_support.zig").localState;
const Setup = @import("network_core_test_support.zig").Setup;
const t = @import("peers/types.zig");
const Control = @import("peers/control.zig").Control;
const wire = @import("control_wire.zig");
const rr = @import("reqresp/root.zig");
const Engine = @import("quic/Engine.zig");
const NetworkCore = @import("network_core.zig").NetworkCore;
const Now = @import("types.zig").Now;
const network_core_test_support = @import("network_core_test_support.zig");
const goodbye = @import("peers/goodbye.zig");
const InboundPhase = @import("reqresp/metrics.zig").InboundPhase;
const capabilities_mod = @import("capabilities.zig");
const time = @import("time.zig");

fn fillStartHistory(limiter: *@import("reqresp/admission.zig").Limiter, now: u64) void {
    for (0..limiter.options.global_starts.tokens) |index| {
        const source: @import("reqresp/admission.zig").Source = .{ .ip4 = .{ 198, 51, @truncate(index >> 8), @truncate(index) } };
        var identity: @import("wire/peer_id.zig").PeerId = .{ .bytes = @splat(0) };
        std.mem.writeInt(u32, identity.bytes[0..4], @intCast(index), .little);
        const key: @import("reqresp/admission.zig").Key = if (limiter.protocols.bits == rr.Protocol.Set.control.bits)
            .{ .peer = identity }
        else
            .{ .address = source };
        const row = limiter.retain(&key, now);
        const result = limiter.start(row, now);
        limiter.release(row);
        if (result == .global_quota) break;
        std.debug.assert(result == .allowed);
    }
}

test "core peer admission keeps idle peers through quota history churn" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..80) |_| try setup.step(1);
    setup.pair.advance(16_000);
    inline for (.{ "reqresp", "control_reqresp" }) |field| {
        const limiter = &@field(setup.client.protocols, field).admission.limiter;
        fillStartHistory(limiter, setup.pair.now.millis());
        try std.testing.expectEqual(@as(u16, 1), limiter.connections);
    }
    for (0..80) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
    try std.testing.expect(snapshots[0].relevant);
}

test "core peer admission survives exhausted quota history and global starts in both directions" {
    for ([_]bool{ false, true }) |inbound| {
        var setup: Setup = .{};
        try setup.initOwners(&.{});
        defer setup.deinit();
        const node = if (inbound) &setup.server else &setup.client;
        inline for (.{ "reqresp", "control_reqresp" }) |field| {
            fillStartHistory(&@field(node.protocols, field).admission.limiter, setup.pair.now.millis());
        }
        _ = try setup.pair.dial();
        for (0..80) |_| try setup.step(0);
        try std.testing.expectEqual(@as(u16, 1), node.peer_manager.catalog.connectedCount());
        inline for (.{ "reqresp", "control_reqresp" }) |field| {
            try std.testing.expectEqual(@as(u16, 1), @field(node.protocols, field).admission.limiter.connections);
        }
        setup.pair.advance(1000);
        for (0..80) |_| try setup.step(1);
        var snapshots: [4]t.Snapshot = undefined;
        try std.testing.expectEqual(@as(usize, 1), node.peer_manager.snapshots(&snapshots));
        try std.testing.expect(snapshots[0].relevant);
    }
}

fn reply(node: *NetworkCore, event: rr.ReqResp.Event, now: Now) void {
    const pm = &node.peer_manager;
    pm.control.receive(&pm.catalog, &pm.local, &.{ .reqresp = &node.protocols.control_reqresp, .router = &node.protocols.router, .engine = &node.transport.engine }, &.{event}, now, @intCast(@max(0, node.clock.read(now) catch unreachable)));
}

test "core fork revalidation protects retention but old replies never restore application relevance" {
    var setup: Setup = .{};
    try setup.init(&.{ .fork = .{ .fork = .fulu }, .metadata = .{ .custody_group_count = 1 } });
    defer setup.deinit();
    for (0..80) |_| try setup.step(0);
    setup.pair.advance(16_000);
    for (0..80) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
    const peer = snapshots[0];
    try std.testing.expect(peer.relevant);
    var next = setup.client.peer_manager.local;
    next.fork.digest = @splat(1);
    next.status.fork_digest = next.fork.digest;
    try network_core_test_support.updateLocal(&setup.client, &next, setup.pair.now);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    const deadline = setup.client.peer_manager.control.revalidationDeadline(peer.peer, peer.connection.?, setup.pair.now).?;
    try std.testing.expect(!setup.client.peer_manager.catalog.get(peer.peer).?.relevant);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().outbound);
    try std.testing.expect(setup.client.peer_manager.policy_scratch[0].revalidating);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.selection.qualified_count);
    try std.testing.expect(!setup.client.peer_manager.policy_scratch[0].evaluating);
    try std.testing.expectEqual(@as(usize, 0), setup.client.peer_manager.policy_scratch[0].coverage.custody_groups.count());
    _ = try setup.turn(&setup.client, .{});
    const op = &setup.client.peer_manager.control.connections[0];
    try std.testing.expectEqual(rr.Protocol.status_v2, op.protocol);
    var bytes: [wire.status_size_max]u8 = undefined;
    const length = try wire.encodeStatus(.status_v2, &setup.server.peer_manager.local.status, &bytes);
    const old: rr.ReqResp.Event = .{ .chunk = .{ .request = op.request.?, .bytes = bytes[0..length], .fork = null, .origin = .{ .connection = op.conn, .endpoint = null } } };
    reply(&setup.client, old, setup.pair.now);
    try std.testing.expect(!setup.client.peer_manager.catalog.get(peer.peer).?.relevant);
    try std.testing.expect(setup.client.peer_manager.catalog.get(peer.peer).?.disconnect_reason == null);
    try std.testing.expectEqual(setup.pair.now.millis() + setup.client.peer_manager.control.options.local_retry_ms, setup.client.peer_manager.control.connections[peer.peer.index].retry_ms);
    try std.testing.expectEqual(deadline, setup.client.peer_manager.control.revalidationDeadline(peer.peer, peer.connection.?, setup.pair.now).?);
    setup.pair.advance(deadline - setup.pair.now.millis());
    reply(&setup.client, old, setup.pair.now);
    try std.testing.expectEqual(t.DisconnectReason.incompatible_fork, setup.client.peer_manager.catalog.get(peer.peer).?.disconnect_reason.?);
}

test "core fork revalidation excludes peers that never established relevance" {
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    const identity = setup.server.peerId();
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    const peer = setup.client.peer_manager.catalog.admit(&identity, &setup.client.peer_manager.local_identity, conn, &.{ .direction = .inbound, .endpoint = .unspecified, .now_ms = setup.pair.now.millis() }).admitted.peer;
    setup.client.peer_manager.control.connected(&setup.client.peer_manager.catalog, peer, conn, .inbound, setup.pair.now);
    var next = setup.client.peer_manager.local;
    next.fork.digest = @splat(3);
    next.status.fork_digest = next.fork.digest;
    try network_core_test_support.updateLocal(&setup.client, &next, setup.pair.now);
    try std.testing.expectEqual(@as(?u64, null), setup.client.peer_manager.control.revalidationDeadline(peer, conn, setup.pair.now));
}

test "core production fork capabilities defer rejected Status probes only during revalidation" {
    const capabilities = @import("capabilities.zig");
    var setup: Setup = .{};
    var opts = network_core_test_support.resolvedOptions();
    opts.core.protocols.router.capabilities = try capabilities.forFork(.electra, false, &.{.v1_2});
    try setup.initOwnersWithOptions(&.{ .fork = .{ .fork = .electra } }, opts);
    defer setup.deinit();
    _ = try setup.pair.dial();
    for (0..80) |_| try setup.step(0);
    const peer = setup.client.peer_manager.catalog.find(&setup.server.peerId()).?;
    try std.testing.expect(setup.client.peer_manager.catalog.get(peer).?.relevant);
    var next = setup.client.peer_manager.local;
    next.fork.fork = .fulu;
    next.fork.digest = @splat(1);
    next.status.fork_digest = next.fork.digest;
    setup.client.protocols.router.setCapabilities(try capabilities.forFork(.fulu, false, &.{.v1_2}));
    try network_core_test_support.updateLocal(&setup.client, &next, setup.pair.now);
    const deadline = setup.client.peer_manager.control.connections[peer.index].transition_until_ms;
    for (0..80) |_| try setup.step(0);
    const waiting = setup.client.peer_manager.catalog.get(peer).?;
    try std.testing.expect(!waiting.relevant and waiting.disconnect_reason == null);
    const retry = setup.client.peer_manager.control.connections[peer.index].retry_ms;
    try std.testing.expect(retry > setup.pair.now.millis() and retry <= deadline);
    setup.pair.advance(retry - setup.pair.now.millis());
    for (0..80) |_| try setup.step(0);
    try std.testing.expectEqual(deadline, setup.client.peer_manager.control.connections[peer.index].transition_until_ms);
    try std.testing.expect(setup.client.peer_manager.catalog.get(peer).?.disconnect_reason == null);
    setup.pair.advance(deadline - setup.pair.now.millis());
    for (0..80) |_| try setup.step(0);
    try std.testing.expectEqual(t.DisconnectReason.health_error, setup.client.peer_manager.catalog.get(peer).?.disconnect_reason.?);
}

test "core production Fulu receives old Status only with established revalidation semantics" {
    const capabilities = @import("capabilities.zig");
    for ([_]bool{ false, true }) |established| {
        var setup: Setup = .{};
        var opts = network_core_test_support.resolvedOptions();
        opts.core.protocols.router.capabilities = try capabilities.forFork(.electra, false, &.{.v1_2});
        try setup.initOwnersWithOptions(&.{ .fork = .{ .fork = .electra } }, opts);
        defer setup.deinit();
        _ = try setup.pair.dial();
        for (0..80) |_| try setup.step(0);
        const peer = setup.server.peer_manager.catalog.find(&setup.client.peerId()).?;
        const conn = setup.server.peer_manager.catalog.get(peer).?.connection.?;
        if (!established) try std.testing.expect(setup.server.peer_manager.catalog.invalidateStatus(peer, conn));
        var next = setup.server.peer_manager.local;
        next.fork.fork = .fulu;
        next.fork.digest = @splat(1);
        next.status.fork_digest = next.fork.digest;
        setup.server.protocols.router.setCapabilities(try capabilities.forFork(.fulu, false, &.{.v1_2}));
        try network_core_test_support.updateLocal(&setup.server, &next, setup.pair.now);
        const deadline = setup.server.peer_manager.control.connections[peer.index].transition_until_ms;
        setup.server.peer_manager.control.connections[peer.index].retry_ms = std.math.maxInt(u64);
        setup.server.peer_manager.control.rekey(&setup.server.peer_manager.catalog, peer.index);
        try previousStatus(&setup);
        const snapshot = setup.server.peer_manager.catalog.get(peer).?;
        try std.testing.expect(!snapshot.relevant);
        if (established) {
            try std.testing.expect(snapshot.disconnect_reason == null);
            try std.testing.expectEqual(deadline, setup.server.peer_manager.control.connections[peer.index].transition_until_ms);
            setup.pair.advance(deadline - setup.pair.now.millis());
            setup.server.peer_manager.control.connections[peer.index].retry_ms = std.math.maxInt(u64);
            setup.server.peer_manager.control.rekey(&setup.server.peer_manager.catalog, peer.index);
            try previousStatus(&setup);
        }
        try std.testing.expectEqual(t.DisconnectReason.incompatible_fork, setup.server.peer_manager.catalog.get(peer).?.disconnect_reason.?);
    }
}

test "core local pruning records automatic redial backoff separately from peer faults" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..60) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
    const peer = snapshots[0].peer;
    try std.testing.expect(setup.client.peer_manager.disconnect(peer, .count_pruning, setup.pair.now));
    const pruned = setup.client.peer_manager.catalog.get(peer).?;
    try std.testing.expectEqual(setup.pair.now.millis() + 300_000, pruned.redial_until_ms);
    try std.testing.expectEqual(@as(u64, 0), pruned.goodbye_until_ms);
    try std.testing.expectEqual(@as(f64, 0), pruned.score);
    try std.testing.expectEqual(t.DisconnectReason.count_pruning, pruned.disconnect_reason.?);
    try std.testing.expectEqual(t.ReputationDecision.ban, setup.client.peer_manager.reportPeer(&.{ .identity = setup.client.peer_manager.catalog.get(peer).?.identity, .action = .fatal }, setup.pair.now).?);
    try std.testing.expect(setup.client.peer_manager.catalog.get(peer).?.ban_until_ms > pruned.redial_until_ms);
}

test "core admission evaluation expires without protocol progress" {
    var setup: Setup = .{};
    var opts = network_core_test_support.resolvedOptions();
    opts.core.peers.target_peers = 0;
    opts.core.peers.min_outbound = 0;
    try setup.initOwnersWithOptions(&.{}, opts);
    defer setup.deinit();
    _ = try setup.pair.dial();
    var snapshots: [4]t.Snapshot = undefined;
    var count: usize = 0;
    for (0..60) |_| {
        try setup.step(0);
        count = setup.client.peer_manager.snapshots(&snapshots);
        if (count > 0) break;
    }
    try std.testing.expectEqual(@as(usize, 1), count);
    try std.testing.expect(!snapshots[0].relevant);
    const peer = snapshots[0].peer;
    const grace = snapshots[0].connected_at_ms + setup.client.peer_manager.control.options.inbound_status_grace_ms;
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.selection.retained_count);
    try std.testing.expectEqual(grace, setup.client.peer_manager.selection_deadline.?);
    setup.pair.advance(grace - setup.pair.now.millis() - 1);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expect(setup.client.peer_manager.catalog.get(peer).?.disconnect_reason == null);
    setup.pair.advance(1);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.selection.retained_count);
    try std.testing.expectEqual(t.DisconnectReason.count_pruning, setup.client.peer_manager.catalog.get(peer).?.disconnect_reason.?);
}

test "core records a buffered Goodbye before transport cancellation and preserves selected local reasons" {
    const multistream = @import("wire/multistream.zig");
    const codec = @import("reqresp/codec.zig");
    for ([_]bool{ false, true }) |local_ban| {
        var setup: Setup = .{};
        try setup.init(&.{});
        defer setup.deinit();
        for (0..50) |_| try setup.step(1);
        var snapshots: [4]t.Snapshot = undefined;
        _ = setup.client.peer_manager.snapshots(&snapshots);
        const conn = snapshots[0].connection.?;
        _ = setup.server.peer_manager.snapshots(&snapshots);
        const peer = snapshots[0].peer;
        const stream = try setup.pair.client.openStream(conn);
        var wire_bytes: [512]u8 = undefined;
        const header = try multistream.encodeMessage(multistream.header, &wire_bytes);
        const selected = try multistream.encodeMessage(rr.Protocol.goodbye_v1.id(), wire_bytes[header.len..]);
        const size = header.len + selected.len;
        try std.testing.expectEqual(size, try setup.pair.client.write(stream, wire_bytes[0..size], false));
        var ready = false;
        for (0..40) |_| {
            try setup.step(0);
            for (setup.server.protocols.control_reqresp.inbound) |slot| if (slot.request.running() and slot.state == .receiving_request and slot.request.protocol == .goodbye_v1) {
                ready = true;
            };
            if (ready) break;
        }
        try std.testing.expect(ready);
        var reason: [8]u8 = undefined;
        std.mem.writeInt(u64, &reason, 129, .little);
        const body = try codec.encodeRequest(&reason, &wire_bytes);
        try std.testing.expectEqual(body.len, try setup.pair.client.write(stream, body, true));
        try setup.pair.pump();
        if (local_ban) try std.testing.expectEqual(t.ReputationDecision.ban, setup.server.peer_manager.reportPeer(&.{ .identity = setup.server.peer_manager.catalog.get(peer).?.identity, .action = .fatal }, setup.pair.now).?);
        try std.testing.expect(setup.pair.client.close(conn, 0));
        try setup.pair.pump();
        _ = try setup.turn(&setup.server, .{});
        const snapshot = setup.server.peer_manager.catalog.get(peer).?;
        try std.testing.expect(snapshot.connection == null);
        var closed: [1]t.Event = undefined;
        try std.testing.expectEqual(@as(usize, 1), setup.server.peer_manager.catalog.pollEvents(&closed));
        try std.testing.expectEqual(if (local_ban) t.DisconnectReason.banned else .remote_goodbye, closed[0].closed.reason);
        const identity = setup.server.peer_manager.catalog.history.identityKey(&snapshot.identity);
        const blocked_until = setup.pair.now.millis() + if (local_ban) @as(u64, 600_000) else 300_000;
        try std.testing.expectEqual(if (local_ban) blocked_until else 0, snapshot.goodbye_until_ms);
        try std.testing.expectEqual(if (local_ban) null else @as(?t.Rejection, .too_many_peers), setup.server.peer_manager.catalog.history.rejection(identity, blocked_until - 1));
        try std.testing.expectEqual(@as(?t.Rejection, null), setup.server.peer_manager.catalog.history.rejection(identity, blocked_until));
        try std.testing.expectEqual(@as(u64, 1), setup.server.peer_manager.control.counters.events.goodbyes[@intFromEnum(goodbye.Reason.too_many_peers)]);
    }
}

test "core local head and metadata updates preserve periodic status scheduling" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..80) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
    const peer = snapshots[0].peer;
    try std.testing.expect(snapshots[0].relevant);
    const due = setup.client.peer_manager.control.connections[peer.index].status_due_ms;
    const started = setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.status_v1)].outgoing;
    for (0..3) |_| {
        var local = setup.client.peer_manager.local;
        local.status.head_slot += 1;
        local.metadata.seq_number += 1;
        try network_core_test_support.updateLocal(&setup.client, &local, setup.pair.now);
        for (0..40) |_| try setup.step(1);
        try std.testing.expectEqual(due, setup.client.peer_manager.control.connections[peer.index].status_due_ms);
        try std.testing.expectEqual(started, setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.status_v1)].outgoing);
    }
    setup.pair.advance(1);
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    for (0..40) |_| try setup.step(1);
    try std.testing.expectEqual(started + 1, setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.status_v1)].outgoing);
    try std.testing.expect(setup.client.peer_manager.control.connections[peer.index].status_due_ms > due);
}

test "core status validation follows its clock without host intents" {
    var setup: Setup = .{};
    try setup.init(&.{ .status = .{ .head_slot = 100 } });
    defer setup.deinit();
    for (0..80) |_| try setup.step(1);
    try std.testing.expectEqual(1, setup.client.peerCounts().relevant);

    setup.pair.now.wall.raw.nanoseconds += 100 * 12 * std.time.ns_per_s;
    var status = setup.server.localState().status;
    status.head_slot = 200;
    try setup.server.updateStatus(&status);
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    for (0..80) |_| try setup.step(1);
    var peers: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(1, setup.client.peer_manager.snapshots(&peers));
    try std.testing.expect(peers[0].relevant);
    try std.testing.expectEqual(200, peers[0].status.?.head_slot);

    status.head_slot = 202;
    try setup.server.updateStatus(&status);
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    for (0..80) |_| try setup.step(1);
    try std.testing.expectEqual(0, setup.client.peerCounts().relevant);
}

test "core stale metadata finishes one refresh while periodic Status and later changes progress" {
    for ([_]u64{ 9, 10 }) |reply_sequence| {
        var setup: Setup = .{};
        try setup.init(&.{ .metadata = .{ .seq_number = 10 } });
        defer setup.deinit();
        for (0..80) |_| try setup.step(0);
        var snapshots: [4]t.Snapshot = undefined;
        try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
        const peer = snapshots[0].peer;
        const row = &setup.client.peer_manager.control.connections[peer.index];
        const started = setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.metadata_v1)].outgoing;
        const statuses = setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.status_v1)].outgoing;
        row.status_due_ms = setup.pair.now.millis() + 2000;
        setup.client.peer_manager.control.rekey(&setup.client.peer_manager.catalog, peer.index);
        try std.testing.expectEqual(@as(usize, 1), setup.server.peer_manager.snapshots(&snapshots));
        const remote = snapshots[0].peer;
        remoteSequence(&setup.server, 11);
        setup.server.peer_manager.control.connections[remote.index].ping_due_ms = setup.pair.now.millis();
        setup.server.peer_manager.control.rekey(&setup.server.peer_manager.catalog, remote.index);
        for (0..80) |_| {
            try setup.step(0);
            if (setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.metadata_v1)].outgoing > started) break;
        }
        try std.testing.expectEqual(started + 1, setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.metadata_v1)].outgoing);
        remoteSequence(&setup.server, reply_sequence);
        for (0..80) |_| try setup.step(0);
        try std.testing.expect(row.metadata_due_ms == null);
        try std.testing.expectEqual(@as(u64, 10), setup.client.peer_manager.catalog.get(peer).?.metadata.?.seq_number);
        setup.pair.advance(1000);
        for (0..80) |_| try setup.step(0);
        try std.testing.expectEqual(started + 1, setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.metadata_v1)].outgoing);
        setup.pair.advance(1000);
        for (0..80) |_| try setup.step(0);
        try std.testing.expectEqual(statuses + 1, setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.status_v1)].outgoing);
        try std.testing.expectEqual(started + 1, setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.metadata_v1)].outgoing);
        const requests = &setup.server.protocols.control_reqresp;
        setup.pair.advance(requests.admission.limiter.options.source.get(.metadata_v1, requests.request_fork).period_ms);
        remoteSequence(&setup.server, 12);
        setup.client.peer_manager.control.connections[peer.index].ping_due_ms = setup.pair.now.millis();
        setup.client.peer_manager.control.rekey(&setup.client.peer_manager.catalog, peer.index);
        for (0..80) |_| try setup.step(0);
        try std.testing.expectEqual(started + 2, setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.metadata_v1)].outgoing);
        try std.testing.expectEqual(@as(u64, 12), setup.client.peer_manager.catalog.get(peer).?.metadata.?.seq_number);
        row.metadata_due_ms = setup.pair.now.millis();
        row.ping_due_ms = setup.pair.now.millis();
        row.status_due_ms = setup.pair.now.millis() - 1;
        setup.client.peer_manager.control.rekey(&setup.client.peer_manager.catalog, peer.index);
        _ = try setup.turn(&setup.client, .{});
        try std.testing.expectEqual(statuses + 2, setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.status_v1)].outgoing);
        try std.testing.expectEqual(started + 2, setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(rr.Protocol.metadata_v1)].outgoing);
    }
}

test "core control accepts zero custody metadata without retaining previous custody credit" {
    const fork: t.ForkContext = .{ .fork = .fulu, .custody_requirement = 4, .minimum_sampling_groups = 8 };
    var setup: Setup = .{};
    try setup.init(&.{ .fork = fork, .metadata = .{ .custody_group_count = fork.custody_groups } });
    defer setup.deinit();
    for (0..80) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
    const peer = snapshots[0].peer;
    const conn = snapshots[0].connection.?;
    try std.testing.expectEqual(@as(usize, fork.custody_groups), snapshots[0].custody_groups.?.count());
    const row = &setup.client.peer_manager.control.connections[peer.index];
    row.metadata_due_ms = setup.pair.now.millis();
    setup.client.peer_manager.control.rekey(&setup.client.peer_manager.catalog, peer.index);
    _ = try setup.turn(&setup.client, .{});
    var response: [25]u8 = @splat(0);
    response[0] = 1;
    response[8] = 1;
    response[16] = 1;
    var served = false;
    for (0..80) |_| {
        try setup.pair.pump();
        var transport: [32]Engine.Event = undefined;
        var output: [16]rr.ReqResp.Event = undefined;
        const counts = setup.server.protocols.process(setup.pair.server, setup.pair.events(setup.pair.server, &transport), setup.pair.now, .{ .control = &output });
        for (output[0..counts.control]) |event| switch (event) {
            .request => |incoming| {
                try std.testing.expectEqual(rr.Protocol.metadata_v3, incoming.protocol);
                try setup.server.protocols.control_reqresp.respond(incoming.request, &response, null, setup.pair.now);
            },
            .chunk_sent => |chunk| try std.testing.expect(setup.server.protocols.control_reqresp.finish(chunk.request, setup.pair.now)),
            .served => served = true,
            else => return error.TestUnexpectedResult,
        };
        _ = try setup.turn(&setup.client, .{});
    }
    try std.testing.expect(served);
    const snapshot = setup.client.peer_manager.catalog.get(peer).?;
    try std.testing.expectEqual(@as(?u64, 0), snapshot.metadata.?.custody_group_count);
    try std.testing.expectEqual(@as(u8, 1), snapshot.metadata.?.attnets[0]);
    try std.testing.expectEqual(@as(u8, 1), snapshot.metadata.?.syncnets);
    try std.testing.expectEqual(conn, snapshot.connection.?);
    try std.testing.expect(snapshot.relevant);
    try std.testing.expect(snapshot.disconnect_reason == null);
    try std.testing.expect(snapshot.custody_groups == null and snapshot.sampling_groups == null);
    try std.testing.expect(row.closing == null and row.metadata_due_ms == null);
}

test "core native stalled fork transition only wakes for eligible work" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..80) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const peer = snapshots[0].peer;
    const conn = snapshots[0].connection.?;
    try std.testing.expect(snapshots[0].relevant);
    try std.testing.expect(setup.client.protocols.gossipsub.admitted(conn));
    const updated: t.LocalState = .{
        .fork = .{ .fork = .fulu, .digest = @splat(1) },
        .status = .{ .fork_digest = @splat(1), .earliest_available_slot = 0 },
        .metadata = .{ .seq_number = 1, .custody_group_count = 1 },
    };
    try network_core_test_support.updateLocal(&setup.client, &updated, setup.pair.now);
    setup.pair.advance(1500);
    for (0..8) |_| {
        _ = try setup.turn(&setup.client, .{});
    }
    try std.testing.expect(!setup.client.peer_manager.catalog.get(peer).?.relevant);
    try std.testing.expect(setup.client.protocols.gossipsub.admitted(conn));
    var active: usize = 0;
    for (setup.client.peer_manager.control.connections) |op| if (op.request != null) {
        active += 1;
    };
    try std.testing.expect(active > 0);
    const service_due = schedule_test_support.wakeupMilliseconds(schedule_test_support.protocolsSchedule(&setup.client.protocols, .{ .application = 0, .control = 32 }), setup.pair.now.millis()).?;
    try std.testing.expect(service_due > setup.pair.now.millis());
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.control.schedule(&setup.client.peer_manager.catalog, setup.pair.now), setup.pair.now.millis()) == null);
    const core_due = schedule_test_support.wakeupMilliseconds(setup.client.schedule(setup.pair.now, .{}), setup.pair.now.millis()).?;
    try std.testing.expect(core_due > setup.pair.now.millis() and core_due <= service_due);
    try network_core_test_support.updateLocal(&setup.server, &updated, setup.pair.now);
    for (0..80) |_| try setup.step(0);
    try std.testing.expect(setup.client.peer_manager.catalog.get(peer).?.relevant);
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.control.schedule(&setup.client.peer_manager.catalog, setup.pair.now), setup.pair.now.millis()).? > setup.pair.now.millis());
}

test "core native host fork transition cancels old maintenance without reviving closing peers" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const before = snapshots[0];
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    setup.server.peer_manager.reStatusPeers(setup.pair.now);
    try setup.step(0);
    var old_operations: usize = 0;
    for (setup.client.peer_manager.control.connections) |op| if (op.request != null) {
        old_operations += 1;
    };
    try std.testing.expect(old_operations > 0);
    const updated: t.LocalState = .{
        .fork = .{ .fork = .fulu, .digest = @splat(1) },
        .status = .{ .fork_digest = @splat(1), .earliest_available_slot = 0 },
        .metadata = .{ .seq_number = 1, .custody_group_count = 1 },
    };
    try network_core_test_support.updateLocal(&setup.client, &updated, setup.pair.now);
    try network_core_test_support.updateLocal(&setup.server, &updated, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.peerCounts().relevant);
    const invalidated = setup.client.peer_manager.catalog.get(before.peer).?;
    try std.testing.expectEqualDeep(before.connection, invalidated.connection);
    try std.testing.expect(invalidated.status == null and invalidated.disconnect_reason == null);
    for (setup.client.peer_manager.control.connections) |op| try std.testing.expect(op.request == null);
    for (0..80) |_| try setup.step(1);
    const confirmed = setup.client.peer_manager.catalog.get(before.peer).?;
    try std.testing.expect(confirmed.relevant);
    try std.testing.expectEqualDeep(before.connection, confirmed.connection);
    try std.testing.expectEqual(@as(u64, 0), confirmed.status.?.earliest_available_slot.?);
    try std.testing.expectEqual(setup.server.localState().metadata.seq_number, confirmed.metadata.?.seq_number);
    try std.testing.expect(setup.client.peer_manager.disconnect(before.peer, .host, setup.pair.now));
    const deadline = setup.client.peer_manager.control.connections[before.peer.index].closing.?.deadline_ms;
    var next = updated;
    next.fork.digest = @splat(2);
    next.status.fork_digest = @splat(2);
    try network_core_test_support.updateLocal(&setup.client, &next, setup.pair.now);
    try std.testing.expectEqual(t.DisconnectReason.host, setup.client.peer_manager.catalog.get(before.peer).?.disconnect_reason.?);
    try std.testing.expectEqual(deadline, setup.client.peer_manager.control.connections[before.peer.index].closing.?.deadline_ms);
}

test "core native previous fork request grace does not refresh relevance and expires" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.server.peer_manager.snapshots(&snapshots);
    const peer = snapshots[0].peer;
    const updated: t.LocalState = .{
        .fork = .{ .fork = .fulu, .digest = @splat(1) },
        .status = .{ .fork_digest = @splat(1), .earliest_available_slot = 0 },
        .metadata = .{ .seq_number = 1, .custody_group_count = 1 },
    };
    try network_core_test_support.updateLocal(&setup.client, &updated, setup.pair.now);
    try network_core_test_support.updateLocal(&setup.server, &updated, setup.pair.now);
    for (0..80) |_| try setup.step(1);
    const before = setup.server.peer_manager.catalog.get(peer).?;
    const deadline = setup.server.peer_manager.control.connections[peer.index].transition_until_ms;
    setup.pair.advance(100);
    try previousStatus(&setup);
    const after = setup.server.peer_manager.catalog.get(peer).?;
    try std.testing.expectEqualDeep(before.status, after.status);
    try std.testing.expectEqual(before.status_at_ms, after.status_at_ms);
    try std.testing.expectEqual(before.metadata_at_ms, after.metadata_at_ms);
    try std.testing.expect(after.relevant and after.disconnect_reason == null);
    try std.testing.expectEqual(deadline, setup.server.peer_manager.control.connections[peer.index].transition_until_ms);
    setup.pair.advance(10_001);
    try previousStatus(&setup);
    try std.testing.expectEqual(t.DisconnectReason.incompatible_fork, setup.server.peer_manager.catalog.get(peer).?.disconnect_reason.?);
}

fn previousStatus(setup: *Setup) !void {
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    var bytes: [84]u8 = @splat(0);
    var sink: [84]u8 = undefined;
    const handle = try setup.client.protocols.control_reqresp.request(setup.pair.client, &setup.client.protocols.router, snapshots[0].connection.?, .status_v1, &bytes, &sink, .{}, setup.pair.now);
    var done = false;
    for (0..80) |_| {
        try setup.pair.pump();
        var events: [32]Engine.Event = undefined;
        _ = try setup.turn(&setup.server, .{});
        var out: [1]rr.ReqResp.Event = undefined;
        const count = setup.client.protocols.process(setup.pair.client, setup.pair.events(setup.pair.client, &events), setup.pair.now, .{ .application = &.{}, .control = &out });
        for (out[0..count.control]) |event| switch (event) {
            .chunk => |chunk| {
                try std.testing.expectEqualDeep(handle, chunk.request);
                try std.testing.expect(setup.client.protocols.control_reqresp.consume(setup.pair.client, &setup.client.protocols.router, handle, setup.pair.now));
            },
            .done => {
                done = true;
            },
            .request => |request| {
                try setup.client.protocols.control_reqresp.respond(request.request, &.{ 1, 0, 0, 0, 0, 0, 0, 0 }, null, setup.pair.now);
            },
            .chunk_sent => |sent| {
                _ = setup.client.protocols.control_reqresp.finish(sent.request, setup.pair.now);
            },
            else => {},
        };
        if (done) break;
    }
    try std.testing.expect(done);
}

test "core control native Fulu serves older schemas but old Status cannot establish relevance" {
    const local: t.LocalState = .{
        .fork = .{ .fork = .fulu },
        .status = .{ .earliest_available_slot = 0 },
        .metadata = .{ .seq_number = 8, .custody_group_count = 1 },
    };
    for ([_]rr.Protocol{
        .status_v1,
        .status_v2,
        .metadata_v1,
        .metadata_v2,
        .metadata_v3,
        .ping_v1,
        .goodbye_v1,
    }) |protocol| {
        var setup: Setup = .{};
        try setup.init(&local);
        defer setup.deinit();
        for (0..50) |_| try setup.step(0);
        var snapshots: [4]t.Snapshot = undefined;
        _ = setup.client.peer_manager.snapshots(&snapshots);
        const conn = snapshots[0].connection.?;
        var request_bytes: [92]u8 = @splat(0);
        const length: usize = switch (protocol) {
            .status_v1, .status_v2 => try wire.encodeStatus(
                protocol,
                &local.status,
                &request_bytes,
            ),
            .ping_v1, .goodbye_v1 => 8,
            else => 0,
        };
        var sink: [92]u8 = undefined;
        const request = try setup.client.protocols.control_reqresp.request(
            setup.pair.client,
            &setup.client.protocols.router,
            conn,
            protocol,
            request_bytes[0..length],
            &sink,
            .{},
            setup.pair.now,
        );
        defer setup.client.deinit(setup.pair.io());
        var chunks: usize = 0;
        var terminal = false;
        var goodbye_writer = false;
        const goodbye_reply: [8]u8 = .{ 1, 0, 0, 0, 0, 0, 0, 0 };
        for (0..50) |_| {
            try setup.pair.pump();
            var transport: [32]Engine.Event = undefined;
            _ = try setup.turn(&setup.server, .{});
            if (protocol == .goodbye_v1) {
                for (setup.server.protocols.control_reqresp.inbound) |*owner| {
                    if (!owner.request.occupied()) continue;
                    if (owner.request.protocol != .goodbye_v1 or !owner.request.io.writing) continue;
                    try std.testing.expectEqualSlices(u8, &goodbye_reply, owner.request.inline_bytes[0..8]);
                    goodbye_writer = true;
                }
            }
            var output: [1]rr.ReqResp.Event = undefined;
            const counts = setup.client.protocols.process(setup.pair.client, setup.pair.events(
                setup.pair.client,
                &transport,
            ), setup.pair.now, .{ .application = &.{}, .control = &output });
            if (counts.control == 0) continue;
            switch (output[0]) {
                .chunk => |chunk| {
                    try std.testing.expectEqualDeep(request, chunk.request);
                    try std.testing.expectEqual(protocol.info().response_min, chunk.bytes.len);
                    if (protocol == .goodbye_v1) {
                        try std.testing.expectEqual(@as(u64, 1), std.mem.readInt(u64, chunk.bytes[0..8], .little));
                    }
                    try std.testing.expect(setup.client.protocols.control_reqresp.consume(setup.pair.client, &setup.client.protocols.router, request, setup.pair.now));
                    chunks += 1;
                },
                .done => terminal = true,
                .request => |incoming| {
                    try std.testing.expectEqual(rr.Protocol.goodbye_v1, incoming.protocol);
                    try setup.client.protocols.control_reqresp.respond(incoming.request, &goodbye_reply, null, setup.pair.now);
                },
                .chunk_sent => |sent| {
                    try std.testing.expect(setup.client.protocols.control_reqresp.finish(sent.request, setup.pair.now));
                },
                .served => {},
                else => return error.UnexpectedControlResult,
            }
        }
        try std.testing.expect(terminal);
        try std.testing.expectEqual(@as(usize, 1), chunks);
        if (protocol == .goodbye_v1) try std.testing.expect(goodbye_writer);
        if (protocol == .status_v1 or protocol == .goodbye_v1) {
            setup.pair.advance(2_001);
            _ = (try setup.turn(&setup.server, .{})).counts;
            var event: [1]t.Event = undefined;
            try std.testing.expectEqual(@as(usize, 1), setup.server.peer_manager.catalog.pollEvents(&event));
            try std.testing.expectEqual(if (protocol == .status_v1)
                t.DisconnectReason.missing_availability
            else
                t.DisconnectReason.remote_goodbye, event[0].closed.reason);
        }
    }
}

test "core native gossip admission precedes Status without establishing relevance" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    try setup.pair.pump();
    var transport: [32]Engine.Event = undefined;
    const client_events = setup.pair.events(setup.pair.client, &transport);
    var conn: ?Engine.Handle = null;
    for (client_events) |event| if (event == .connected) {
        conn = event.connected.conn;
    };
    try std.testing.expect(conn != null);
    _ = setup.client.protocols.gossipsub.peerConnected(setup.pair.client, conn.?, false, setup.pair.now);
    for (0..30) |_| {
        try setup.pair.pump();
        _ = try setup.turn(&setup.server, .{});
        _ = setup.client.protocols.process(setup.pair.client, setup.pair.events(
            setup.pair.client,
            &transport,
        ), setup.pair.now, .{ .application = &.{}, .control = &.{} });
    }
    var snapshots: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.server.peer_manager.snapshots(&snapshots));
    try std.testing.expect(!snapshots[0].relevant);
    try std.testing.expect(setup.server.protocols.gossipsub.admitted(snapshots[0].connection.?));
    try std.testing.expectEqual(@as(f64, 0), snapshots[0].score);
    try std.testing.expectEqual(@as(u16, 0), setup.server.peer_manager.peerCounts().relevant);
}

test "core native inbound application per connection cap protects control from extra raw bulk owners" {
    var setup: Setup = .{};
    var options = network_core_test_support.resolvedOptions();
    options.core.protocols.reqresp.serving_max = 24;
    options.core.protocols.reqresp.outbound_max = 24;
    options.core.protocols.reqresp.inbound_per_connection_max = 8;
    options.core.protocols.reqresp.outbound_per_connection_max = 0;
    try setup.initOwnersWithOptions(&.{}, options);
    defer setup.deinit();
    _ = try setup.pair.dial();
    for (0..50) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const conn = snapshots[0].connection.?;
    const size = rr.Protocol.blocks_by_root_v2.info().response_max;
    const sinks = try std.testing.allocator.alloc(u8, size * 9);
    defer std.testing.allocator.free(sinks);
    defer setup.client.deinit(setup.pair.io());
    const protocols = [_]rr.Protocol{
        .blocks_by_range_v2,
        .blocks_by_root_v2,
        .blob_sidecars_by_range_v1,
        .blob_sidecars_by_root_v1,
        .data_column_sidecars_by_root_v1,
    };
    const bytes = [_]u8{0} ** 8 ++ [_]u8{1} ++ [_]u8{0} ** 15;
    for (0..9) |index| {
        const protocol = protocols[index / 2];
        _ = try setup.client.protocols.request(
            setup.pair.client,
            conn,
            protocol,
            bytes[0..protocol.info().request_min],
            sinks[index * size ..][0..size],
            .{},
            setup.pair.now,
        );
    }
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    for (0..40) |_| try setup.step(0);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
    var count: usize = 0;
    var first: ?rr.ReqResp.RequestHandle = null;
    for (0..20) |_| {
        var output: [1]rr.ReqResp.Event = undefined;
        const result = (try setup.turn(&setup.server, .{ .application = &output })).counts;
        if (result.application == 1 and output[0] == .request) {
            count += 1;
            first = first orelse output[0].request.request;
        }
    }
    try std.testing.expectEqual(@as(usize, 4), count);
    const ready = @intFromEnum(InboundPhase.ready);
    try std.testing.expectEqual(@as(usize, 4), setup.server.protocols.reqresp.resourceSnapshot().inbound_phases[ready]);
    _ = setup.server.peer_manager.snapshots(&snapshots);
    const server_conn = snapshots[0].connection.?;
    try std.testing.expect(setup.server.protocols.reqresp.cancel(setup.pair.server, &setup.server.protocols.router, first.?, setup.pair.now));

    try std.testing.expectEqual(
        @as(u16, 8),
        setup.server.protocols.reqresp.inboundPendingCount(server_conn),
    );
    var stale = server_conn;
    stale.generation += 1;
    try std.testing.expectEqual(
        @as(u16, 0),
        setup.server.protocols.reqresp.inboundPendingCount(stale),
    );
}

test "core native older Ping sequence cannot confirm cached metadata freshness" {
    var setup: Setup = .{};
    try setup.init(&.{ .metadata = .{ .seq_number = 10 } });
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const before = snapshots[0].metadata_at_ms;
    remoteSequence(&setup.server, 9);
    setup.pair.advance(21_000);
    for (0..50) |_| try setup.step(0);
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expectEqual(@as(u64, 10), snapshots[0].metadata.?.seq_number);
    try std.testing.expectEqual(before, snapshots[0].metadata_at_ms);
    try std.testing.expect(snapshots[0].relevant);
}

test "core native immutable Status writer survives local update" {
    var setup: Setup = .{};
    const original: t.LocalState = .{ .status = .{ .head_slot = 40 } };
    try setup.init(&original);
    defer setup.deinit();
    var pending = false;
    for (0..40) |_| {
        try setup.step(0);
        for (setup.server.protocols.control_reqresp.inbound) |*slot| {
            if (!slot.request.occupied() or !slot.request.io.writing) continue;
            if (slot.request.protocol != .status_v1) continue;
            try std.testing.expect(slot.request.io.writing);
            try setup.server.updateStatus(&localState(.{ .status = .{ .head_slot = 80 } }).status);
            pending = true;
            break;
        }
        if (pending) break;
    }
    try std.testing.expect(pending);
    for (0..40) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expectEqualDeep(original.status, snapshots[0].status.?);
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    for (0..40) |_| try setup.step(0);
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expectEqual(@as(u64, 80), snapshots[0].status.?.head_slot);
}

test "core control native Goodbye maps shutdown incompatibility and fault wire reasons" {
    const cases = [_]struct { reason: t.DisconnectReason, wire_reason: u64 }{
        .{ .reason = .shutdown, .wire_reason = 1 },
        .{ .reason = .incompatible_fork, .wire_reason = 2 },
        .{ .reason = .invalid_metadata, .wire_reason = 3 },
        .{ .reason = .count_pruning, .wire_reason = 129 },
        .{ .reason = .reputation, .wire_reason = 250 },
        .{ .reason = .banned, .wire_reason = 251 },
    };
    for (cases) |case| {
        var setup: Setup = .{};
        try setup.init(&.{});
        defer setup.deinit();
        for (0..50) |_| try setup.step(0);
        var snapshots: [4]t.Snapshot = undefined;
        _ = setup.client.peer_manager.snapshots(&snapshots);
        try std.testing.expect(setup.client.peer_manager.disconnect(snapshots[0].peer, case.reason, setup.pair.now));
        var received = false;
        for (0..40) |_| {
            try setup.pair.pump();
            var transport: [32]Engine.Event = undefined;
            _ = try setup.turn(&setup.client, .{});
            var control: [1]rr.ReqResp.Event = undefined;
            const counts = setup.server.protocols.process(setup.pair.server, setup.pair.events(setup.pair.server, &transport), setup.pair.now, .{ .application = &.{}, .control = &control });
            if (counts.control == 0) continue;
            try std.testing.expectEqual(rr.Protocol.goodbye_v1, control[0].request.protocol);
            try std.testing.expectEqual(@as(usize, 8), control[0].request.bytes.len);
            try std.testing.expectEqual(case.wire_reason, std.mem.readInt(u64, control[0].request.bytes[0..8], .little));
            received = true;
            break;
        }
        try std.testing.expect(received);
    }
}

test "core control irrelevant metadata cannot create an ineligible wakeup" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..80) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const peer = snapshots[0].peer;
    const conn = snapshots[0].connection.?;
    try std.testing.expect(setup.client.peer_manager.catalog.invalidateStatus(peer, conn));
    const row = &setup.client.peer_manager.control.connections[peer.index];
    row.metadata_due_ms = setup.pair.now.millis();
    row.status_due_ms = setup.pair.now.millis() + 100;
    row.ping_due_ms = setup.pair.now.millis() + 200;
    setup.client.peer_manager.control.rekey(&setup.client.peer_manager.catalog, peer.index);
    const started = setup.client.peer_manager.control.counters.started;
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(started, setup.client.peer_manager.control.counters.started);
    try std.testing.expectEqual(setup.pair.now.millis() + 100, schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.control.schedule(&setup.client.peer_manager.catalog, setup.pair.now), setup.pair.now.millis()).?);
    setup.pair.advance(100);
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(started + 1, setup.client.peer_manager.control.counters.started);
}

test "core control does not schedule gossip admission alongside active request" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..80) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const peer = snapshots[0].peer;
    const row = &setup.client.peer_manager.control.connections[peer.index];
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    _ = try setup.turn(&setup.client, .{});
    const started = setup.client.peer_manager.control.counters.started;
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.control.schedule(&setup.client.peer_manager.catalog, setup.pair.now), setup.pair.now.millis()) == null);
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(started, setup.client.peer_manager.control.counters.started);
    try std.testing.expect(setup.client.peer_manager.disconnect(peer, .host, setup.pair.now));
    const deadline = row.closing.?.deadline_ms;
    try std.testing.expectEqual(deadline, schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.control.schedule(&setup.client.peer_manager.catalog, setup.pair.now), setup.pair.now.millis()).?);
    setup.pair.advance(2000);
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expect(setup.client.peer_manager.catalog.get(peer).?.connection == null);
}

test "core control fork change abandons obsolete requests before reusing buffers" {
    var setup: Setup = .{};
    var opts = network_core_test_support.resolvedOptions();
    opts.core.peers.max_peers = 2;
    opts.core.peers.target_peers = 1;
    opts.core.peers.min_outbound = 0;
    opts.core.protocols.control_reqresp.outbound_max = 2;
    try setup.initOwnersWithOptions(&.{}, opts);
    defer setup.deinit();
    _ = try setup.pair.dial();
    for (0..80) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const peer = snapshots[0].peer;
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    _ = try setup.turn(&setup.client, .{});
    const op = &setup.client.peer_manager.control.connections[0];
    const request = op.request.?;
    const updated: t.LocalState = .{
        .fork = .{ .fork = .fulu, .digest = @splat(1) },
        .status = .{ .fork_digest = @splat(1), .earliest_available_slot = 0 },
        .metadata = .{ .custody_group_count = 1 },
    };
    try network_core_test_support.updateLocal(&setup.client, &updated, setup.pair.now);
    try std.testing.expect(op.request == null);
    try std.testing.expect(!setup.client.protocols.control_reqresp.outbound[request.index].request.occupied());
    try std.testing.expectEqual(setup.pair.now.millis(), schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.control.schedule(&setup.client.peer_manager.catalog, setup.pair.now), setup.pair.now.millis()).?);
    const started = setup.client.peer_manager.control.counters.started;
    const deferred = setup.client.peer_manager.control.counters.deferred;
    const grace = setup.client.peer_manager.control.connections[peer.index].transition_until_ms;
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(started + 1, setup.client.peer_manager.control.counters.started);
    try std.testing.expectEqual(deferred, setup.client.peer_manager.control.counters.deferred);
    try std.testing.expect(op.request != null);
    try std.testing.expect(!std.meta.eql(request, op.request.?));
    try std.testing.expectEqual(grace, setup.client.peer_manager.control.connections[peer.index].transition_until_ms);
}

test "control replacement retirement rekeys the current schedule without crediting stale evidence" {
    var setup: Setup = .{};
    try setup.initDirection(&.{}, true);
    defer setup.deinit();
    for (0..60) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const peer = snapshots[0].peer;
    const old = snapshots[0].connection.?;
    const control = &setup.client.peer_manager.control;
    const requests = control;
    try std.testing.expect(snapshots[0].relevant);
    try std.testing.expect(control.connections[peer.index].evidence == .ready);
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    _ = try setup.turn(&setup.client, .{});
    const op = for (requests.connections) |*op| {
        if (op.request != null) break op;
    } else return error.TestUnexpectedResult;
    const stale = op.request.?;
    try std.testing.expectEqualDeep(old, op.conn);
    try std.testing.expect(op.after_ready);
    // The replacement reuses the operation, so keep the old one as peer control would see it.
    const previous = op.*;
    const started = control.counters.started;
    // The client's own dial replaces the connection whose Status is unanswered.
    _ = try setup.pair.dial();
    try setup.pair.pump();
    _ = try setup.turn(&setup.client, .{});
    const current = setup.client.peer_manager.catalog.get(peer).?.connection.?;
    const row = &control.connections[peer.index];
    try std.testing.expect(!std.meta.eql(old, current));
    try std.testing.expectEqualDeep(current, row.conn);
    // The new Status starts immediately without inheriting retry, strike or health evidence.
    try std.testing.expectEqual(started + 1, control.counters.started);
    var in_flight: usize = 0;
    for (requests.connections) |*candidate| if (candidate.request) |request| {
        in_flight += 1;
        try std.testing.expect(!std.meta.eql(stale, request));
        try std.testing.expectEqualDeep(current, candidate.conn);
        try std.testing.expect(!candidate.after_ready);
    };
    try std.testing.expectEqual(@as(usize, 1), in_flight);
    try std.testing.expectEqual(@as(u64, 0), row.retry_ms);
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 0 }, &row.health_failures);
    try std.testing.expect(row.evidence == .pending);
    try std.testing.expect(!setup.client.peer_manager.catalog.get(peer).?.relevant);
    // A successful Status reply on the replaced connection, even uncancelled, credits nothing to
    // the replacement: its schedule, deadline, relevance and evidence stay as they were.
    const schedule = row.*;
    const key = control.deadlines.get(peer.index);
    var bytes: [wire.status_size_max]u8 = undefined;
    const length = try wire.encodeStatus(.status_v1, &setup.server.peer_manager.local.status, &bytes);
    reply(&setup.client, .{ .chunk = .{ .request = stale, .bytes = bytes[0..length], .fork = null, .origin = .{ .connection = previous.conn, .endpoint = null } } }, setup.pair.now);
    reply(&setup.client, .{ .done = .{ .request = stale, .chunks = 1 } }, setup.pair.now);
    try std.testing.expectEqualDeep(schedule, row.*);
    try std.testing.expectEqual(key, control.deadlines.get(peer.index));
    try std.testing.expect(!setup.client.peer_manager.catalog.get(peer).?.relevant);
    try std.testing.expect(row.evidence == .pending);
}

test "core control capabilities pre-Fulu Metadata3 serves configured custody count" {
    const local: t.LocalState = .{ .metadata = .{ .custody_group_count = 1 } };
    var setup: Setup = .{};
    try setup.init(&local);
    defer setup.deinit();
    const active = try capabilities_mod.forFork(.phase0, false, &.{ .v1_2, .v1_1 });
    setup.client.protocols.router.setCapabilities(active);
    setup.server.protocols.router.setCapabilities(active);
    for (0..50) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    var sink: [32]u8 = undefined;
    const request = try setup.client.protocols.control_reqresp.request(setup.pair.client, &setup.client.protocols.router, snapshots[0].connection.?, .metadata_v3, &.{}, &sink, .{}, setup.pair.now);
    var received = false;
    var done = false;
    for (0..50) |_| {
        try setup.pair.pump();
        var events: [32]Engine.Event = undefined;
        _ = try setup.turn(&setup.server, .{});
        var out: [1]rr.ReqResp.Event = undefined;
        const counts = setup.client.protocols.process(setup.pair.client, setup.pair.events(setup.pair.client, &events), setup.pair.now, .{ .application = &.{}, .control = &out });
        for (out[0..counts.control]) |event| switch (event) {
            .chunk => |chunk| {
                try std.testing.expectEqualDeep(request, chunk.request);
                const metadata = try wire.decodeMetadata(.metadata_v3, chunk.bytes, local.fork);
                try std.testing.expectEqual(local.metadata.custody_group_count, metadata.custody_group_count);
                try std.testing.expect(setup.client.protocols.control_reqresp.consume(setup.pair.client, &setup.client.protocols.router, request, setup.pair.now));
                received = true;
            },
            .done => done = true,
            else => return error.TestUnexpectedResult,
        };
        if (done) break;
    }
    try std.testing.expect(received and done);
}

test "core native targeted Status only schedules the full current nonclosing owner" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..60) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const selected = snapshots[0];
    const other_peer: t.PeerRef = .{ .index = 3, .generation = 55 };
    const other_conn: t.Handle = .{ .index = 3, .generation = 56 };
    setup.client.peer_manager.control.connected(&setup.client.peer_manager.catalog, other_peer, other_conn, .inbound, setup.pair.now);
    const other_before = setup.client.peer_manager.control.connections[3];
    const before = setup.client.peer_manager.control.connections[selected.peer.index];
    var stale_peer = selected.peer;
    stale_peer.generation += 1;
    var stale_conn = selected.connection.?;
    stale_conn.generation += 1;
    try std.testing.expect(!setup.client.peer_manager.reStatusPeer(stale_peer, selected.connection.?, setup.pair.now));
    try std.testing.expect(!setup.client.peer_manager.reStatusPeer(selected.peer, stale_conn, setup.pair.now));
    try std.testing.expectEqualDeep(before, setup.client.peer_manager.control.connections[selected.peer.index]);
    try std.testing.expect(setup.client.peer_manager.reStatusPeer(selected.peer, selected.connection.?, setup.pair.now));
    var expected = before;
    expected.status_due_ms = setup.pair.now.millis();
    try std.testing.expectEqualDeep(expected, setup.client.peer_manager.control.connections[selected.peer.index]);
    try std.testing.expectEqualDeep(other_before, setup.client.peer_manager.control.connections[3]);
    _ = try setup.turn(&setup.client, .{});
    var selected_started = false;
    for (setup.client.peer_manager.control.connections) |op| {
        if (op.request != null and op.protocol == .status_v1 and std.meta.eql(op.peer, selected.peer)) selected_started = true;
    }
    try std.testing.expect(selected_started);
    try std.testing.expect(setup.client.peer_manager.disconnect(selected.peer, .host, setup.pair.now));
    try std.testing.expect(!setup.client.peer_manager.reStatusPeer(selected.peer, selected.connection.?, setup.pair.now));
    try std.testing.expect(setup.client.closePeer(&selected.identity, setup.pair.now));
    try std.testing.expect(!setup.client.peer_manager.reStatusPeer(selected.peer, selected.connection.?, setup.pair.now));
}

test "peer control retires each connection's schedule once across connection generations" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const peer = snapshots[0].peer;
    const old = snapshots[0].connection.?;
    const replacement: t.Handle = .{ .index = old.index, .generation = old.generation + 1 };
    const control = &setup.client.peer_manager.control;
    const schedule = &control.connections[peer.index];
    const io: Control.Io = .{ .reqresp = &setup.client.protocols.control_reqresp, .router = &setup.client.protocols.router, .engine = &setup.client.transport.engine };
    try std.testing.expect(control.releaseConnection(&io, peer, replacement, setup.pair.now) == null);
    try std.testing.expectEqualDeep(old, schedule.conn);
    try std.testing.expect(schedule.peer != null);
    try std.testing.expect(control.releaseConnection(&io, peer, old, setup.pair.now) == null);
    try std.testing.expect(schedule.peer == null);
    control.connected(&setup.client.peer_manager.catalog, peer, replacement, .inbound, setup.pair.now);
    try std.testing.expect(control.releaseConnection(&io, peer, old, setup.pair.now) == null);
    try std.testing.expectEqualDeep(replacement, schedule.conn);
    try std.testing.expect(schedule.peer != null);
    try std.testing.expect(control.releaseConnection(&io, peer, replacement, setup.pair.now) == null);
    try std.testing.expect(schedule.peer == null);
    try std.testing.expect(control.releaseConnection(&io, peer, replacement, setup.pair.now) == null);
    try std.testing.expect(schedule.peer == null);
    try std.testing.expectEqualSlices(u64, &.{ 1, 1 }, &control.counters.events.connected);
}

test "core control response deadline survives continuous peer progress" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..80) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
    const peer = snapshots[0].peer;
    const conn = snapshots[0].connection.?;
    try std.testing.expect(setup.client.peer_manager.reStatusPeer(peer, conn, setup.pair.now));
    _ = try setup.turn(&setup.client, .{});
    var request: ?rr.ReqResp.RequestHandle = null;
    for (setup.client.peer_manager.control.connections) |op| if (op.request != null and op.protocol == .status_v1) {
        request = op.request;
    };
    const handle = request orelse return error.TestUnexpectedResult;
    var remote_stream: ?Engine.StreamHandle = null;
    for (0..80) |_| {
        try setup.pair.pump();
        var transport: [32]Engine.Event = undefined;
        var incoming: [16]rr.ReqResp.Event = undefined;
        const counts = setup.server.protocols.process(setup.pair.server, setup.pair.events(setup.pair.server, &transport), setup.pair.now, .{ .control = &incoming });
        for (incoming[0..counts.control]) |event| if (event == .request and event.request.protocol == .status_v1) {
            remote_stream = setup.server.protocols.control_reqresp.inbound[event.request.request.index].request.stream;
        };
        _ = try setup.turn(&setup.client, .{});
        if (remote_stream != null) break;
    }
    const stream = remote_stream orelse return error.TestUnexpectedResult;
    const client = &setup.client.protocols.control_reqresp.outbound[handle.index];
    try std.testing.expectEqual(.response, client.phase);
    const due = client.deadline().?;
    try std.testing.expectEqual(@as(u64, 10_000), due - setup.pair.now.millis());
    var payload: [wire.status_size_max]u8 = undefined;
    const length = try wire.encodeStatus(.status_v1, &setup.server.peer_manager.local.status, &payload);
    var storage: [rr.codec.frame_scratch_max]u8 = undefined;
    const encoded = try rr.codec.encodeChunk(0, null, payload[0..length], &storage);
    try std.testing.expect(encoded.len > 9);
    for (0..9) |i| {
        setup.pair.now.monotonic = time.milliseconds(due - 90 + i * 10);
        try std.testing.expectEqual(@as(usize, 1), try setup.pair.server.write(stream, encoded[i .. i + 1], false));
        try setup.pair.pump();
        _ = try setup.turn(&setup.client, .{});
        try std.testing.expectEqual(@as(?u64, due), client.deadline());
    }
    setup.pair.now.monotonic = time.milliseconds(due);
    _ = try setup.turn(&setup.client, .{});
    for (setup.client.peer_manager.control.connections) |op| if (op.request) |active| {
        try std.testing.expect(!std.meta.eql(handle, active));
    };
}

test "core coalesces silent inbound request owners before host request delivery" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    var peers: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&peers);
    const connection = peers[0].connection.?;
    const multistream = @import("wire/multistream.zig");
    var bytes: [512]u8 = undefined;
    const header = try multistream.encodeMessage(multistream.header, &bytes);
    const proposal = try multistream.encodeMessage(rr.Protocol.blocks_by_root_v2.id(), bytes[header.len..]);
    for (0..2) |_| {
        const stream = try setup.pair.client.openStream(connection);
        try std.testing.expectEqual(header.len + proposal.len, try setup.pair.client.write(stream, bytes[0 .. header.len + proposal.len], false));
    }
    for (0..30) |_| try setup.step(0);
    try std.testing.expectEqual(@as(u16, 2), setup.server.protocols.reqresp.pendingCounts().inbound);
    setup.pair.advance(10_000);
    // Both expired slots are serviced from the deadline heap in one turn.
    var events: [2]rr.ReqResp.Event = undefined;
    const result = (try setup.turn(&setup.server, .{ .application = &events })).counts;
    try std.testing.expectEqual(@as(usize, 2), result.application);
    for (events) |event| try std.testing.expect(event == .failed and event.failed.reason == .timeout);
    _ = setup.server.peer_manager.snapshots(&peers);
    try std.testing.expectEqual(@as(f64, -1), peers[0].score);
    try std.testing.expect(setup.server.peer_manager.catalog.rows[peers[0].peer.index].closing_reason == null);
}

/// Makes the remote advertise `sequence` in its Ping and Metadata replies, including a sequence
/// an owner never assigns, as a misbehaving peer would.
fn remoteSequence(node: *NetworkCore, sequence: u64) void {
    node.peer_manager.local.metadata.seq_number = sequence;
}

test "core control scores intrinsic decoding once and keeps custody schema limits separate" {
    for ([_]bool{ false, true }) |intrinsic| {
        var setup: Setup = .{};
        try setup.init(&.{ .fork = .{ .fork = .fulu }, .metadata = .{ .custody_group_count = 1 } });
        defer setup.deinit();
        for (0..80) |_| try setup.step(0);
        var snapshots: [4]t.Snapshot = undefined;
        _ = setup.client.peer_manager.snapshots(&snapshots);
        const peer = snapshots[0].peer;
        const schedule = &setup.client.peer_manager.control.connections[peer.index];
        schedule.metadata_due_ms = setup.pair.now.millis();
        setup.client.peer_manager.control.rekey(&setup.client.peer_manager.catalog, peer.index);
        _ = try setup.turn(&setup.client, .{});
        var response: [25]u8 = @splat(0);
        if (intrinsic) {
            response[16] = 0x10;
        } else {
            std.mem.writeInt(u64, response[17..25], @as(u64, setup.client.peer_manager.local.fork.custody_groups) + 1, .little);
        }
        var sent = false;
        for (0..80) |_| {
            try setup.pair.pump();
            var transport: [32]Engine.Event = undefined;
            var output: [16]rr.ReqResp.Event = undefined;
            const counts = setup.server.protocols.process(setup.pair.server, setup.pair.events(setup.pair.server, &transport), setup.pair.now, .{ .control = &output });
            for (output[0..counts.control]) |event| switch (event) {
                .request => |incoming| {
                    if (incoming.protocol == .goodbye_v1) {
                        _ = setup.server.protocols.control_reqresp.finish(incoming.request, setup.pair.now);
                        continue;
                    }
                    try std.testing.expectEqual(rr.Protocol.metadata_v3, incoming.protocol);
                    try setup.server.protocols.control_reqresp.respond(incoming.request, &response, null, setup.pair.now);
                    sent = true;
                },
                .chunk_sent => |chunk| _ = setup.server.protocols.control_reqresp.finish(chunk.request, setup.pair.now),
                else => {},
            };
            _ = try setup.turn(&setup.client, .{});
        }
        try std.testing.expect(sent);
        const snapshot = setup.client.peer_manager.catalog.get(peer).?;
        try std.testing.expectEqual(@as(f64, if (intrinsic) -10 else 0), snapshot.score);
        try std.testing.expect(schedule.closing != null or snapshot.connection == null);
    }
}

test "core request terminal scores captured identity without a JavaScript consumer" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    var peers: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&peers);
    const peer = peers[0].peer;
    const conn = peers[0].connection.?;
    const sink = try std.testing.allocator.alloc(u8, rr.Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    _ = try setup.client.protocols.request(setup.pair.client, conn, .blocks_by_root_v2, &(@as([32]u8, @splat(0))), sink, .{}, setup.pair.now);
    var sent = false;
    var terminal = false;
    for (0..60) |_| {
        try setup.pair.pump();
        var transport: [32]Engine.Event = undefined;
        var incoming: [16]rr.ReqResp.Event = undefined;
        const accepted = setup.server.protocols.process(setup.pair.server, setup.pair.events(setup.pair.server, &transport), setup.pair.now, .{ .application = &incoming });
        for (incoming[0..accepted.application]) |event| if (event == .request) {
            const stream = setup.server.protocols.reqresp.inbound[event.request.request.index].request.stream;
            try std.testing.expectEqual(@as(usize, 5), try setup.pair.server.write(stream, &.{ 0, 99, 99, 99, 99 }, true));
            sent = true;
        };
        var output: [32]rr.ReqResp.Event = undefined;
        const received = (try setup.turn(&setup.client, .{ .application = &output })).counts;
        for (output[0..received.application]) |event| if (event == .failed) {
            try std.testing.expect(!terminal);
            terminal = true;
        };
    }
    try std.testing.expect(sent and terminal);
    try std.testing.expectEqual(@as(f64, -10), setup.client.peer_manager.catalog.get(peer).?.score);
}

test "core idle connected peers leave control visits and dial scheduling unchanged" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..80) |_| try setup.step(0);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.peerCounts().relevant);
    // A manual intent backing off after a failed dial keeps its retry deadline.
    const absent: t.PeerId = .{ .bytes = @splat(7) };
    try setup.client.peer_manager.connectUntil(&absent, &.{.{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9 } }}, setup.pair.now, setup.pair.now.millis() + 60_000);
    var intents: [4]SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents));
    try std.testing.expect(setup.client.peer_manager.dialFailed(intents[0].token, setup.pair.now));
    var control_visits: u64 = 0;
    for (0..33) |turn| {
        if (turn == 1) {
            control_visits = setup.client.peer_manager.control.visits;
        }
        try setup.step(0);
        try std.testing.expect(!setup.client.peer_manager.catalog.dial_schedule_dirty);
        try std.testing.expectEqual(@as(usize, 0), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &intents));
    }
    try std.testing.expectEqual(control_visits, setup.client.peer_manager.control.visits);
}

test "core control starts a due ping or Status on the turn its deadline passes" {
    for ([_]rr.Protocol{ .ping_v1, .status_v1 }) |protocol| {
        var opts = network_core_test_support.resolvedOptions();
        // A Status interval shorter than the ping interval makes Status the next probe.
        if (protocol == .status_v1) {
            opts.core.control.status_interval_ms = 30_000;
            opts.core.control.ping_outbound_ms = 600_000;
        }
        var setup: Setup = .{};
        try setup.initOwnersWithOptions(&.{}, opts);
        defer setup.deinit();
        _ = try setup.pair.dial();
        for (0..80) |_| try setup.step(0);
        const peer = setup.client.peer_manager.catalog.find(&setup.server.peerId()).?;
        const row = &setup.client.peer_manager.control.connections[peer.index];
        const due = if (protocol == .ping_v1) row.ping_due_ms else row.status_due_ms;
        try std.testing.expect(due > setup.pair.now.millis());
        try std.testing.expectEqual(due, schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.control.schedule(&setup.client.peer_manager.catalog, setup.pair.now), setup.pair.now.millis()).?);
        const counter = &setup.client.protocols.control_reqresp.protocol_counters[@intFromEnum(protocol)].outgoing;
        const started = counter.*;
        const visits = setup.client.peer_manager.control.visits;
        setup.pair.now.monotonic = time.milliseconds(due - 1);
        try setup.step(0);
        try std.testing.expectEqual(started, counter.*);
        try std.testing.expectEqual(visits, setup.client.peer_manager.control.visits);
        setup.pair.now.monotonic = time.milliseconds(due);
        try setup.step(0);
        try std.testing.expectEqual(started + 1, counter.*);
        try std.testing.expectEqual(visits + 1, setup.client.peer_manager.control.visits);
    }
}

test "core control retries a start refused for want of a request slot after the local retry delay" {
    var opts = network_core_test_support.resolvedOptions();
    opts.core.peers.max_peers = 2;
    opts.core.peers.target_peers = 1;
    opts.core.peers.min_outbound = 0;
    opts.core.protocols.control_reqresp.outbound_max = 2;
    opts.core.protocols.control_reqresp.outbound_per_connection_max = 0;
    var setup: Setup = .{};
    try setup.initOwnersWithOptions(&.{}, opts);
    defer setup.deinit();
    _ = try setup.pair.dial();
    for (0..80) |_| try setup.step(0);
    const peer = setup.client.peer_manager.catalog.find(&setup.server.peerId()).?;
    const row = &setup.client.peer_manager.control.connections[peer.index];
    try std.testing.expectEqual(row.ping_due_ms, schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.control.schedule(&setup.client.peer_manager.catalog, setup.pair.now), setup.pair.now.millis()).?);
    setup.pair.now.monotonic = time.milliseconds(row.ping_due_ms);
    // Requests the control does not own hold both control slots.
    var sinks: [2][wire.status_size_max]u8 = undefined;
    const ping = [_]u8{0} ** 8;
    _ = try setup.client.protocols.control_reqresp.request(setup.pair.client, &setup.client.protocols.router, row.conn, .ping_v1, &ping, &sinks[0], .{}, setup.pair.now);
    _ = try setup.client.protocols.control_reqresp.request(setup.pair.client, &setup.client.protocols.router, row.conn, wire.metadataProtocol(setup.client.peer_manager.local.fork), &.{}, &sinks[1], .{}, setup.pair.now);
    const deferred = setup.client.peer_manager.control.counters.deferred;
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(deferred + 1, setup.client.peer_manager.control.counters.deferred);
    try std.testing.expectEqual(setup.pair.now.millis() + opts.core.control.local_retry_ms, row.retry_ms);
    try std.testing.expectEqual(row.retry_ms, schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.control.schedule(&setup.client.peer_manager.catalog, setup.pair.now), setup.pair.now.millis()).?);
}

test "core control fork abandonment preserves a pending peer fault exactly once" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    const pm = &setup.client.peer_manager;
    const peer = pm.catalog.find(&setup.server.peerId()).?;
    const conn = pm.catalog.get(peer).?.connection.?;
    try std.testing.expect(pm.reStatusPeer(peer, conn, setup.pair.now));
    _ = try setup.turn(&setup.client, .{});
    const handle = pm.control.connections[peer.index].request.?;
    const requests = &setup.client.protocols.control_reqresp;
    const client = &requests.outbound[handle.index];
    client.request.peer_fault = .protocol;
    client.fail(requests, &setup.client.transport.engine, &setup.client.protocols.router, handle.index, .{ .invalid_response = error.InvalidCompressed }, setup.pair.now);
    const failures = requests.protocol_counters[@intFromEnum(rr.Protocol.status_v1)].outgoing_errors;
    try std.testing.expectEqual(@as(f64, 0), pm.catalog.get(peer).?.score);
    var local = pm.local;
    local.fork = .{ .fork = .fulu, .digest = @splat(1) };
    local.status.earliest_available_slot = 0;
    local.metadata.custody_group_count = 1;
    local.status.fork_digest = local.fork.digest;
    try network_core_test_support.updateLocal(&setup.client, &local, setup.pair.now);
    try std.testing.expect(!client.request.occupied());
    try std.testing.expectEqual(@as(f64, -10), pm.catalog.get(peer).?.score);
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(@as(f64, -10), pm.catalog.get(peer).?.score);
    try std.testing.expectEqual(failures, requests.protocol_counters[@intFromEnum(rr.Protocol.status_v1)].outgoing_errors);
}

test "core control replacement applies a pending fault to the new connection's policy" {
    var setup: Setup = .{};
    try setup.initDirection(&.{}, true);
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    const pm = &setup.client.peer_manager;
    const identity = setup.server.peerId();
    const peer = pm.catalog.find(&identity).?;
    const old = pm.catalog.get(peer).?.connection.?;
    _ = pm.reportPeer(&.{ .identity = identity, .action = .low_tolerance, .reason = .reqresp_protocol }, setup.pair.now);
    try std.testing.expect(pm.reStatusPeer(peer, old, setup.pair.now));
    _ = try setup.turn(&setup.client, .{});
    const handle = pm.control.connections[peer.index].request.?;
    const requests = &setup.client.protocols.control_reqresp;
    const request = &requests.outbound[handle.index];
    request.request.peer_fault = .protocol;
    request.fail(requests, &setup.client.transport.engine, &setup.client.protocols.router, handle.index, .{ .invalid_response = error.InvalidCompressed }, setup.pair.now);
    _ = try setup.pair.dial();
    try setup.pair.pump();
    _ = try setup.turn(&setup.client, .{});
    const current = pm.catalog.get(peer).?;
    try std.testing.expect(!std.meta.eql(old, current.connection.?));
    try std.testing.expectEqual(@as(f64, -20), current.score);
    try std.testing.expectEqual(t.DisconnectReason.reputation, current.disconnect_reason.?);
    try std.testing.expectEqual(t.DisconnectReason.reputation, pm.control.connections[peer.index].closing.?.reason);
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(@as(f64, -20), pm.catalog.get(peer).?.score);
}

test "core closes a gossip admission refusal and releases request connection reservations" {
    for ([_]bool{ false, true }) |inbound| {
        var setup: Setup = .{};
        try setup.initOwners(&.{});
        defer setup.deinit();
        const node = if (inbound) &setup.server else &setup.client;
        for (node.protocols.gossipsub.peers.rows) |*row| row.generation = std.math.maxInt(u64);
        _ = try setup.pair.dial();
        var closed = false;
        for (0..80) |_| {
            try setup.pair.pump();
            var events: [4]t.Event = undefined;
            const result = try setup.turn(node, .{ .peers = &events });
            for (events[0..result.counts.peers]) |event| if (event == .closed) {
                try std.testing.expectEqual(t.DisconnectReason.capacity, event.closed.reason);
                closed = true;
            };
            _ = try setup.turn(if (inbound) &setup.client else &setup.server, .{});
        }
        try std.testing.expect(closed);
        try std.testing.expectEqual(@as(u16, 0), node.peer_manager.catalog.connectedCount());
        inline for (.{ "reqresp", "control_reqresp" }) |field| {
            try std.testing.expectEqual(@as(u16, 0), @field(node.protocols, field).admission.limiter.connections);
        }
    }
}
