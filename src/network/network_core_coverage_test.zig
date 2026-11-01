const schedule_test_support = @import("schedule_test_support.zig");
const std = @import("std");
const manager = @import("peer_manager.zig");
const core_test = @import("network_core_test_support.zig");
const t = @import("peers/types.zig");
const expect = std.testing.expect;
const equal = std.testing.expectEqual;
const attestation = "/eth2/00000000/beacon_attestation_7/ssz_snappy";
const gossip_test = @import("gossipsub/test_support.zig");
const PeerManager = @import("peer_manager.zig").PeerManager;
const SelectedDial = @import("peers/dialing.zig").Dialing.SelectedDial;
const support = @import("quic/test_support.zig");
const resolvedOptions = @import("network_core_test_support.zig").resolvedOptions;
const Setup = @import("network_core_test_support.zig").Setup;
const updateDemand = @import("network_core_test_support.zig").updateDemand;
const clientWakeup = @import("network_core_test_support.zig").clientWakeup;
const preset = @import("preset");
const enr = @import("peers/enr.zig");
const custody = @import("peers/custody.zig");
const session_io = @import("gossipsub/session_io.zig");
const KeyPair = @import("wire/keys.zig").KeyPair;
const time = @import("time.zig");
const topic_fixture = @import("gossipsub/topic_fixture.zig");
const Gossipsub = @import("gossipsub/Gossipsub.zig");

fn init(setup: *core_test.Setup, local: *const t.LocalState) !void {
    var opts = core_test.resolvedOptions();
    const full = @import("gossipsub/topic_fixture.zig").full;
    opts.core.protocols.gossipsub.topic_policy = &.{ full(@splat(0)), full(@splat(1)) };
    opts.core.protocols.gossipsub.score_params.topic.weight = 0;
    try setup.initOwnersWithOptions(local, opts);
    errdefer setup.deinit();
    _ = try setup.pair.dial();
}

fn settle(setup: *core_test.Setup) !void {
    for (0..80) |_| {
        try setup.step(0);
        setup.pair.advance(25);
    }
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
}

test "core coverage counts real duty subscriptions separately from custodians" {
    var setup: core_test.Setup = .{};
    const local: t.LocalState = .{ .fork = .{ .fork = .fulu, .minimum_sampling_groups = 8 }, .status = .{ .earliest_available_slot = 0 }, .metadata = .{ .custody_group_count = 4 } };
    try init(&setup, &local);
    defer setup.deinit();
    try settle(&setup);
    var snapshots: [4]t.Snapshot = undefined;
    try equal(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
    const peer = snapshots[0];
    try equal(@as(usize, 8), peer.sampling_groups.?.count());
    var demand: t.Demand = .{ .attnets = 1 << 7 };
    for (0..128) |group| if (peer.sampling_groups.?.isSet(group)) {
        demand.group_targets[group] = 1;
        demand.custody_group_targets[group] = 1;
    };
    try core_test.updateDemand(&setup.client, &demand, setup.pair.now);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try equal(@as(u16, 8), setup.client.peer_manager.coverageDeficits().groups);
    try equal(@as(u16, 4), setup.client.peer_manager.coverageDeficits().custody_groups);
    try equal(@as(u16, 1), setup.client.peer_manager.coverageDeficits().attestation);
    try gossip_test.subscribe(setup.server.protocols.gossipsub, attestation);
    try gossip_test.subscribe(setup.server.protocols.gossipsub, "/eth2/01010101/beacon_attestation_8/ssz_snappy");
    for (0..preset.NUMBER_OF_COLUMNS) |column| {
        if (!peer.sampling_groups.?.isSet(column % local.fork.custody_groups)) continue;
        var buffer: [80]u8 = undefined;
        const name = try std.fmt.bufPrint(&buffer, "/eth2/00000000/data_column_sidecar_{d}/ssz_snappy", .{column});
        try gossip_test.subscribe(setup.server.protocols.gossipsub, name);
    }
    try settle(&setup);
    try equal(@as(u16, 0), setup.client.peer_manager.coverageDeficits().groups);
    try equal(@as(u16, 4), setup.client.peer_manager.coverageDeficits().custody_groups);
    try equal(@as(u16, 0), setup.client.peer_manager.coverageDeficits().attestation);
    try expect(setup.client.peer_manager.discoveryNeed().custody);
    try equal(@as(u16, 0), setup.client.peer_manager.selection.coverage.attestation[8]);
    try expect(setup.client.protocols.gossipsub.overlay.findTopic(attestation) == null);
    try equal(@as(u64, 0), setup.client.peer_manager.policy_scratch[0].stable.attnets);
    setup.pair.advance(setup.client.peer_manager.metadata_freshness_ms);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try equal(@as(u16, 8), setup.client.peer_manager.coverageDeficits().custody_groups);
    try equal(@as(u16, 0), setup.client.peer_manager.coverageDeficits().groups);
    try equal(@as(f64, 0), setup.client.peer_manager.catalog.get(peer.peer).?.score);
}

test "core custody coverage tolerates negative gossip scores but excludes poor request service" {
    var setup: core_test.Setup = .{};
    const local: t.LocalState = .{ .fork = .{ .fork = .fulu, .minimum_sampling_groups = 8 }, .status = .{ .earliest_available_slot = 0 }, .metadata = .{ .custody_group_count = 4 } };
    try init(&setup, &local);
    defer setup.deinit();
    try settle(&setup);
    var snapshots: [4]t.Snapshot = undefined;
    try equal(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
    const peer = snapshots[0];
    var demand: t.Demand = .{};
    for (0..128) |group| if (peer.custody_groups.?.isSet(group)) {
        demand.custody_group_targets[group] = 1;
    };
    try core_test.updateDemand(&setup.client, &demand, setup.pair.now);
    const g = setup.client.protocols.gossipsub;
    setup.client.peer_manager.reconcile(g, setup.pair.now);
    try equal(@as(u16, 0), setup.client.peer_manager.coverageDeficits().custody_groups);

    gossip_test.penalize(g, peer.connection.?, 7);
    setup.pair.advance(manager.policy_interval_ms);
    setup.client.peer_manager.reconcile(g, setup.pair.now);
    try expect(setup.client.peer_manager.gossipScore(g, peer.peer, setup.pair.now).? < 0);
    try equal(@as(u16, 0), setup.client.peer_manager.coverageDeficits().custody_groups);

    try equal(.none, setup.client.peer_manager.reportPeer(&.{ .identity = setup.client.peer_manager.catalog.get(peer.peer).?.identity, .action = .mid_tolerance }, setup.pair.now).?);
    setup.client.peer_manager.reconcile(g, setup.pair.now);
    try equal(@as(u16, 4), setup.client.peer_manager.coverageDeficits().custody_groups);
}

test "core coverage observes reputation recovery on the policy tick and bans immediately" {
    var setup: core_test.Setup = .{};
    const local: t.LocalState = .{ .fork = .{ .fork = .fulu, .minimum_sampling_groups = 8 }, .status = .{ .earliest_available_slot = 0 }, .metadata = .{ .custody_group_count = 4 } };
    try init(&setup, &local);
    defer setup.deinit();
    try settle(&setup);
    const owner = &setup.client.peer_manager;
    const g = setup.client.protocols.gossipsub;
    var snapshots: [4]t.Snapshot = undefined;
    try equal(@as(usize, 1), owner.snapshots(&snapshots));
    const peer = snapshots[0];
    var demand: t.Demand = .{};
    for (0..128) |group| if (peer.custody_groups.?.isSet(group)) {
        demand.custody_group_targets[group] = 1;
    };
    try updateDemand(&setup.client, &demand, setup.pair.now);
    try equal(.none, owner.reportPeer(&.{ .identity = peer.identity, .action = .high_tolerance }, setup.pair.now).?);
    owner.catalog.edit(peer.peer).?.reputation.score = -2.001;
    owner.reconcile(g, setup.pair.now);
    try equal(@as(u16, 4), owner.coverageDeficits().custody_groups);

    setup.pair.advance(500);
    owner.reconcile(g, setup.pair.now);
    try expect(owner.catalog.get(peer.peer).?.score > -2);
    try equal(@as(u16, 4), owner.coverageDeficits().custody_groups);
    setup.pair.advance(500);
    owner.reconcile(g, setup.pair.now);
    try equal(@as(u16, 0), owner.coverageDeficits().custody_groups);

    try equal(.ban, owner.reportPeer(&.{ .identity = peer.identity, .action = .fatal }, setup.pair.now).?);
    try equal(t.DisconnectReason.banned, owner.catalog.get(peer.peer).?.disconnect_reason.?);
    owner.reconcile(g, setup.pair.now);
    try equal(@as(u16, 0), owner.selection.retained_count);
}

test "core coverage coalesces subscription and score changes with operation eligibility" {
    var setup: core_test.Setup = .{};
    try init(&setup, &.{ .fork = .{ .fork = .altair } });
    defer setup.deinit();
    try settle(&setup);
    try core_test.updateDemand(&setup.client, &.{ .attnets = 1 << 7 }, setup.pair.now);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    const g = setup.client.protocols.gossipsub;
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const conn = snapshots[0].connection.?;
    const index = g.sessions.find(conn).?;
    gossip_test.control(g, index, .{ .subscription = .{ .topic = attestation, .subscribe = true } }, setup.pair.now);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try equal(@as(u16, 1), setup.client.peer_manager.coverageDeficits().attestation);
    const due = schedule_test_support.wakeupMilliseconds(setup.client.peer_manager.schedule(g, setup.pair.now, .{ .peers = 0, .dials = 0 }), setup.pair.now.millis()).?;
    try equal(setup.pair.now.millis() + manager.policy_interval_ms, due);
    for (0..100) |_| gossip_test.control(g, index, .{ .subscription = .{ .topic = attestation, .subscribe = true } }, setup.pair.now);
    setup.pair.advance(manager.policy_interval_ms - 1);
    setup.client.peer_manager.reconcile(g, setup.pair.now);
    try equal(@as(u16, 1), setup.client.peer_manager.coverageDeficits().attestation);
    setup.pair.advance(1);
    setup.client.peer_manager.reconcile(g, setup.pair.now);
    try equal(@as(u16, 0), setup.client.peer_manager.coverageDeficits().attestation);
    gossip_test.penalize(g, conn, 7);
    setup.pair.advance(manager.policy_interval_ms);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try equal(@as(u16, 0), setup.client.peer_manager.coverageDeficits().attestation);
    try gossip_test.subscribe(g, attestation);
    setup.pair.advance(manager.policy_interval_ms);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try equal(@as(u16, 1), setup.client.peer_manager.coverageDeficits().attestation);
    try gossip_test.unsubscribe(g, attestation);
    gossip_test.penalize(g, conn, 40);
    setup.pair.advance(manager.policy_interval_ms);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try equal(@as(u16, 1), setup.client.peer_manager.coverageDeficits().attestation);
    g.peers.scores.rows[g.sessions.rows[index].logical.index].behaviour = 0;
    gossip_test.penalize(g, conn, 0);
    setup.pair.advance(manager.policy_interval_ms);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try equal(@as(u16, 0), setup.client.peer_manager.coverageDeficits().attestation);
    gossip_test.control(g, index, .{ .subscription = .{ .topic = attestation, .subscribe = false } }, setup.pair.now);
    setup.pair.advance(manager.policy_interval_ms);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try equal(@as(u16, 1), setup.client.peer_manager.coverageDeficits().attestation);
    try equal(@as(f64, 0), setup.client.peer_manager.catalog.get(snapshots[0].peer).?.score);
}

test "core coverage gives initial subscriptions finite grace even after metadata arrives" {
    var setup: core_test.Setup = .{};
    var opts = core_test.resolvedOptions();
    opts.core.peers.target_peers = 0;
    opts.core.peers.max_peers = 2;
    opts.core.peers.min_outbound = 0;
    try setup.initOwnersWithOptions(&.{}, opts);
    defer setup.deinit();
    try core_test.updateDemand(&setup.client, &.{ .attnets = 1 }, setup.pair.now);
    _ = try setup.pair.dial();
    try settle(&setup);
    var snapshots: [4]t.Snapshot = undefined;
    try equal(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
    try expect(snapshots[0].metadata != null);
    try equal(@as(u16, 1), setup.client.peer_manager.selection.retained_count);
    const grace = snapshots[0].connected_at_ms + setup.client.peer_manager.control.options.inbound_status_grace_ms;
    setup.pair.advance(grace - setup.pair.now.millis() - 1);
    try core_test.updateDemand(&setup.client, &.{ .attnets = 3 }, setup.pair.now);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try equal(@as(u16, 1), setup.client.peer_manager.selection.retained_count);
    setup.pair.advance(1);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try equal(@as(u16, 0), setup.client.peer_manager.selection.retained_count);
    const closing = &setup.client.peer_manager.control.connections[snapshots[0].peer.index];
    try expect(closing.closing != null);
    try equal(setup.pair.now.millis() + manager.replacement_interval_ms, setup.client.peer_manager.replacement_after_ms);
    try equal(@as(u16, 0), setup.client.peer_manager.selection.dial_budget);
    try equal(@as(u16, 2), setup.client.peer_manager.coverageDeficits().attestation);
    const closed = closing.closing.?;
    for (0..10) |_| setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqualDeep(closed, closing.closing.?);
    setup.pair.advance(manager.replacement_interval_ms - 1);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try equal(@as(u16, 0), setup.client.peer_manager.selection.dial_budget);
    setup.pair.advance(1);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try equal(@as(u16, 1), setup.client.peer_manager.selection.dial_budget);
}

fn subscribeServer(setup: *Setup, name: []const u8) !void {
    const g = setup.client.protocols.gossipsub;
    g.peers.scores.applyValidatedTopic(gossip_test.activate(g, name).?, .{ .weight = 0 });
    try gossip_test.subscribe(setup.server.protocols.gossipsub, name);
}

fn candidateFor(peer: *const t.PeerId, count: ?u64) !enr.Candidate {
    return .{ .peer = peer.*, .node_id = try custody.nodeId(peer), .addresses = .{ support.server_address, .unspecified }, .address_count = 1, .hints = .{ .sequence = 1, .record_hash = @splat(0), .fork = .{ .digest = @splat(0), .next_version = @splat(0), .next_epoch = 0 }, .next_fork_digest = null, .attnets = null, .syncnets = null, .custody_group_count = count } };
}

fn waitSampling(setup: *Setup) !t.Snapshot {
    var snapshots: [4]t.Snapshot = undefined;
    for (0..200) |_| {
        try setup.step(0);
        if (setup.client.peer_manager.snapshots(&snapshots) == 1) {
            const snapshot = snapshots[0];
            if (snapshot.sampling_groups != null and snapshot.relevant and
                setup.client.protocols.gossipsub.deliveryAvailable(snapshot.connection.?)) return snapshot;
        }
        setup.pair.advance(25);
    }
    return error.SamplingReadinessTimeout;
}

test "core coverage demand copies persists across slots and keeps general discovery independent" {
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    var demand: t.Demand = .{ .syncnets = 1 };
    try updateDemand(&setup.client, &demand, setup.pair.now);
    demand.syncnets = 2;
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.coverageDeficits().sync);
    try std.testing.expectEqual(@as(u8, 1), setup.client.peer_manager.discoveryNeed().syncnets);
    try std.testing.expect(setup.client.peer_manager.discoveryNeed().general);
    setup.pair.advance(60_000);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.coverageDeficits().sync);
    try std.testing.expectEqual(@as(u8, 1), setup.client.peer_manager.discoveryNeed().syncnets);
    setup.pair.now.wall.raw.nanoseconds += 10_000 * 12 * std.time.ns_per_s;
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.coverageDeficits().sync);
    try std.testing.expectEqual(@as(u8, 1), setup.client.peer_manager.discoveryNeed().syncnets);
    try updateDemand(&setup.client, &.{}, setup.pair.now);
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().sync);
    try std.testing.expectEqual(@as(u8, 0), setup.client.peer_manager.discoveryNeed().syncnets);
    try std.testing.expect(setup.client.peer_manager.discoveryNeed().general);
    const due = clientWakeup(&setup);
    try std.testing.expect(due == null or due.? > setup.pair.now.millis());
}

test "core coverage authenticated custody differs from gossip delivery and invalidates fork groups" {
    var setup: Setup = .{};
    var local: t.LocalState = .{ .fork = .{ .fork = .fulu }, .status = .{ .earliest_available_slot = 0 }, .metadata = .{ .syncnets = 1, .custody_group_count = 128 } };
    try setup.init(&local);
    defer setup.deinit();
    try subscribeServer(&setup, "/eth2/00000000/sync_committee_0/ssz_snappy");
    try subscribeServer(&setup, "/eth2/00000000/data_column_sidecar_0/ssz_snappy");
    var demand: t.Demand = .{ .syncnets = 1 };
    demand.group_targets[0] = 1;
    try updateDemand(&setup.client, &demand, setup.pair.now);
    for (0..60) |_| try setup.step(0);
    setup.pair.advance(1_000);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().groups);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().sync);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expect(setup.client.peer_manager.catalog.setDirect(snapshots[0].peer, true));
    const connection = snapshots[0].connection.?;
    const index = setup.client.protocols.gossipsub.sessions.find(connection).?;
    session_io.resetOutbound(setup.client.protocols.gossipsub, setup.pair.client, index);
    try std.testing.expect(!setup.client.protocols.gossipsub.deliveryAvailable(connection));
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.coverageDeficits().groups);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.coverageDeficits().sync);
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.coverageDeficits().sync);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.coverageDeficits().groups);
    local.fork.custody_groups = 64;
    local.metadata.custody_group_count = 64;
    try core_test.updateLocal(&setup.client, &local, setup.pair.now);
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.coverageDeficits().groups);
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expect(snapshots[0].custody_groups == null);
}

test "core coverage physical closing capacity blocks new leased intents" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expect(setup.client.peer_manager.disconnect(snapshots[0].peer, .host, setup.pair.now));
    setup.pair.client.limits.dialing_max = 3;
    setup.pair.client.outbound_max = 4;
    for (0..3) |_| _ = try setup.pair.client.dial(&support.server_address, setup.server.peerId(), setup.pair.now);
    try std.testing.expectEqual(@as(u16, 4), setup.pair.client.registry.active_len);
    var secret: [32]u8 = @splat(0);
    secret[31] = 17;
    const key = (try KeyPair.fromSecretKey(&secret)).publicKey();
    const peer = t.PeerId.fromPublicKey(&key);
    try setup.client.peer_manager.connect(&peer, &.{support.server_address}, setup.pair.now);
    var out: [2]SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 0), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &out));
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.dialing.attempts().total);
}

test "core coverage direct candidate dials at soft target and respects physical hard capacity" {
    var setup: Setup = .{};
    var opts = resolvedOptions();
    opts.core.peers.target_peers = 1;
    opts.core.peers.min_outbound = 0;
    try setup.initOwnersWithOptions(&.{}, opts);
    defer setup.deinit();
    _ = try setup.pair.dial();
    for (0..50) |_| try setup.step(0);
    var secret: [32]u8 = @splat(0);
    secret[31] = 17;
    const key = (try KeyPair.fromSecretKey(&secret)).publicKey();
    const peer = t.PeerId.fromPublicKey(&key);
    try setup.client.addDirectPeer(&peer, &.{support.server_address}, setup.pair.now);
    var out: [1]SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &out));
    try std.testing.expect(out[0].peer.eql(&peer));
    try setup.client.addDirectPeer(&peer, &.{support.server_address}, setup.pair.now);
    try std.testing.expectError(error.DirectPeerCapacity, setup.client.addDirectPeer(&setup.server.peerId(), &.{support.server_address}, setup.pair.now));
}

test "core coverage automatic retention renews only at authenticated Status success" {
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    var candidate = try candidateFor(&setup.server.peerId(), null);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.discoveredBatch(setup.client.protocols.gossipsub, &.{candidate}, setup.pair.now).accepted);
    _ = try setup.pair.dial();
    for (0..50) |_| try setup.step(0);
    const horizon = setup.client.peer_manager.catalog.rows[0].dial.replacement_after_ms;
    setup.pair.advance(1000);
    for (0..10) |_| try setup.step(0);
    try std.testing.expectEqual(horizon, setup.client.peer_manager.catalog.rows[0].dial.replacement_after_ms);
    candidate.hints.sequence = 2;
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.discoveredBatch(setup.client.protocols.gossipsub, &.{candidate}, setup.pair.now).accepted);
    setup.pair.advance(21_000);
    for (0..50) |_| try setup.step(0);
    try std.testing.expectEqual(horizon, setup.client.peer_manager.catalog.rows[0].dial.replacement_after_ms);
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    for (0..50) |_| try setup.step(0);
    try std.testing.expect(setup.client.peer_manager.catalog.rows[0].dial.replacement_after_ms > horizon);
}

test "core coverage bounded custody work resumes without output and stale metadata cannot satisfy demand" {
    var setup: Setup = .{};
    const local: t.LocalState = .{ .fork = .{ .fork = .fulu }, .status = .{ .earliest_available_slot = 0 }, .metadata = .{ .custody_group_count = 127, .syncnets = 1 } };
    try setup.init(&local);
    defer setup.deinit();
    var demand: t.Demand = .{ .syncnets = 1 };
    demand.group_targets[0] = 1;
    try updateDemand(&setup.client, &demand, setup.pair.now);
    for (0..50) |_| try setup.step(0);
    var initial: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&initial);
    try std.testing.expect(setup.client.peer_manager.catalog.updateMetadata(initial[0].peer, initial[0].connection.?, &.{ .seq_number = 10, .custody_group_count = 1 }, setup.pair.now.millis()));
    try std.testing.expect(setup.client.peer_manager.catalog.updateMetadata(initial[0].peer, initial[0].connection.?, &.{ .seq_number = 11, .custody_group_count = 127, .syncnets = 1 }, setup.pair.now.millis()));
    for (0..4) |i| {
        var secret: [32]u8 = @splat(0);
        secret[31] = @intCast(i + 20);
        const key = (try KeyPair.fromSecretKey(&secret)).publicKey();
        const peer = t.PeerId.fromPublicKey(&key);
        const candidate = try candidateFor(&peer, 127);
        try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.discoveredBatch(setup.client.protocols.gossipsub, &.{candidate}, setup.pair.now).accepted);
    }
    var saw_pending = false;
    for (0..80) |_| {
        const before = setup.client.peer_manager.counters.custody_hashes;
        try setup.step(0);
        try std.testing.expect(setup.client.peer_manager.counters.custody_hashes - before <= 256);
        if (setup.client.peer_manager.custody_pending) {
            saw_pending = true;
            try std.testing.expect(clientWakeup(&setup).? <= setup.pair.now.millis() +| 1);
        }
    }
    try std.testing.expect(saw_pending);
    try std.testing.expect(!setup.client.peer_manager.custody_pending);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expectEqual(@as(usize, 127), snapshots[0].custody_groups.?.count());
    setup.pair.advance(60_000);
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.coverageDeficits().groups);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.coverageDeficits().sync);
}

test "core coverage outbound deficit uses admission headroom while retaining existing inbound" {
    for ([_]u16{ 2, 3 }) |maximum| {
        var setup: Setup = .{};
        var opts = resolvedOptions();
        opts.core.peers.max_peers = maximum;
        opts.core.peers.target_peers = 1;
        opts.core.peers.min_outbound = 1;
        try setup.initOwnersWithOptions(&.{}, opts);
        defer setup.deinit();
        _ = try setup.pair.dial();
        for (0..60) |_| try setup.step(0);
        try std.testing.expectEqual(@as(u16, 1), setup.server.peer_manager.peerCounts().relevant);
        var secret: [32]u8 = @splat(0);
        secret[31] = 17;
        const key = (try KeyPair.fromSecretKey(&secret)).publicKey();
        const peer = t.PeerId.fromPublicKey(&key);
        const candidate = try candidateFor(&peer, null);
        try std.testing.expectEqual(@as(u16, 1), setup.server.peer_manager.discoveredBatch(setup.server.protocols.gossipsub, &.{candidate}, setup.pair.now).accepted);
        var out: [1]SelectedDial = undefined;
        try std.testing.expectEqual(@as(usize, 1), setup.server.peer_manager.selectDials(setup.server.protocols.gossipsub, setup.pair.server, setup.pair.now, &out));
        try std.testing.expect(out[0].peer.eql(&peer));
    }
}

test "core coverage review same-digest group update disables cached automatic candidate" {
    var setup: Setup = .{};
    var local: t.LocalState = .{ .fork = .{ .fork = .fulu }, .status = .{ .earliest_available_slot = 0 }, .metadata = .{ .custody_group_count = 128 } };
    try setup.initOwners(&local);
    defer setup.deinit();
    var candidate = try candidateFor(&setup.server.peerId(), 128);
    candidate.hints.syncnets = 1;
    try updateDemand(&setup.client, &.{ .syncnets = 1 }, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.discoveredBatch(setup.client.protocols.gossipsub, &.{candidate}, setup.pair.now).accepted);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    local.fork.custody_groups = 64;
    local.metadata.custody_group_count = 64;
    try core_test.updateLocal(&setup.client, &local, setup.pair.now);
    var out: [1]SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 0), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &out));
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.catalog.rows[0].dial.priority);
    try std.testing.expectEqual(@as(u64, 1), setup.client.peer_manager.catalog.rows[0].dial.hints.?.sequence);
    candidate.hints.sequence = 2;
    candidate.hints.custody_group_count = 64;
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.discoveredBatch(setup.client.protocols.gossipsub, &.{candidate}, setup.pair.now).accepted);
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &out));
    try std.testing.expect(out[0].peer.eql(&candidate.peer));
}

test "core reconciliation idle and candidate batch work" {
    var setup: Setup = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    for (0..8) |_| {
        try setup.step(0);
        _ = setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &.{});
    }
    const candidate = try candidateFor(&setup.server.peerId(), null);
    for (0..4) |_| try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.discoveredBatch(setup.client.protocols.gossipsub, &.{candidate}, setup.pair.now).accepted);
    var out: [1]SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &out));
    try std.testing.expect(out[0].peer.eql(&candidate.peer));
    try std.testing.expectEqual(@as(usize, 0), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &out));
}

test "core reconciliation reads do not decay reputation or schedule peer removal" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..60) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
    const snapshot = snapshots[0];
    const view: *const PeerManager = &setup.client.peer_manager;
    const deficits = view.coverageDeficits();
    const need = view.discoveryNeed();
    try std.testing.expectEqual(.none, setup.client.peer_manager.reportPeer(&.{ .identity = setup.client.peer_manager.catalog.get(snapshot.peer).?.identity, .action = .high_tolerance }, setup.pair.now).?);
    setup.pair.advance(100);
    try setup.client.addDirectPeer(&snapshot.identity, &.{support.server_address}, setup.pair.now);
    const incompatible: t.Status = .{ .fork_digest = @splat(1) };
    try std.testing.expect(setup.client.peer_manager.catalog.updateStatus(snapshot.peer, snapshot.connection.?, &incompatible, setup.pair.now.millis()));
    var events: [4]t.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.catalog.pollEvents(&events));
    const dirty = view.catalog.get(snapshot.peer).?;
    const counters = view.counters;
    for (0..8) |_| {
        try std.testing.expectEqualDeep(deficits, view.coverageDeficits());
        try std.testing.expectEqualDeep(need, view.discoveryNeed());
    }
    try std.testing.expectEqualDeep(dirty, view.catalog.get(snapshot.peer).?);
    try std.testing.expectEqualDeep(counters, view.counters);
    try std.testing.expect(!view.catalog.eventsPending());
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    const evaluated = view.catalog.get(snapshot.peer).?;
    try std.testing.expect(evaluated.score > dirty.score);
    try std.testing.expectEqual(t.DisconnectReason.incompatible_fork, evaluated.disconnect_reason.?);
    try std.testing.expectEqual(@as(u16, 1), view.coverageDeficits().outbound);
    try std.testing.expect(view.discoveryNeed().general);
    try std.testing.expect(view.catalog.eventsPending());
}

test "core reconciliation applies metadata direct membership and expiry" {
    var setup: Setup = .{};
    const local: t.LocalState = .{ .fork = .{ .fork = .altair }, .metadata = .{ .syncnets = 1 } };
    try setup.init(&local);
    defer setup.deinit();
    try subscribeServer(&setup, "/eth2/00000000/sync_committee_0/ssz_snappy");
    const demand: t.Demand = .{ .syncnets = 1 };
    try updateDemand(&setup.client, &demand, setup.pair.now);
    for (0..60) |_| try setup.step(0);
    setup.pair.advance(setup.client.peer_manager.control.options.inbound_status_grace_ms);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().sync);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const peer = snapshots[0].peer;
    const conn = snapshots[0].connection.?;
    for (0..8) |_| {
        setup.pair.advance(1);
        setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
        try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().sync);
    }
    try std.testing.expect(setup.client.peer_manager.catalog.updateMetadata(peer, conn, &.{ .seq_number = 10, .syncnets = 0 }, setup.pair.now.millis()));
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().sync);
    try std.testing.expectEqual(@as(u4, 0), setup.client.peer_manager.policy_scratch[0].stable.syncnets);
    try std.testing.expect(setup.client.peer_manager.catalog.updateMetadata(peer, conn, &.{ .seq_number = 11, .syncnets = 1 }, setup.pair.now.millis()));
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().sync);
    try std.testing.expectEqual(@as(u4, 1), setup.client.peer_manager.policy_scratch[0].stable.syncnets);
    const deadline = setup.client.peer_manager.selection_deadline.?;
    var clock = setup.pair.now;
    clock.monotonic = time.milliseconds(deadline - 1);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, clock);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().sync);
    try std.testing.expectEqual(@as(u8, 0), setup.client.peer_manager.discoveryNeed().syncnets);
    try std.testing.expectEqual(deadline, setup.client.peer_manager.selection_deadline.?);
    clock.monotonic = time.milliseconds(deadline);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, clock);
    try std.testing.expectEqual(@as(u4, 0), setup.client.peer_manager.policy_scratch[0].stable.syncnets);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().sync);
    try std.testing.expectEqual(@as(u8, 0), setup.client.peer_manager.discoveryNeed().syncnets);
    clock.monotonic = time.milliseconds(clock.millis() + 1);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, clock);

    gossip_test.penalize(setup.client.protocols.gossipsub, conn, 7);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, clock);
    _ = setup.client.protocols.gossipsub.scoreSnapshot(conn, clock);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, clock);
    _ = setup.client.peer_manager.reportPeer(&.{ .identity = setup.client.peer_manager.catalog.get(peer).?.identity, .action = .high_tolerance }, clock);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, clock);
    const health = setup.client.peer_manager.catalog.get(peer).?.score;
    clock.monotonic = time.milliseconds(clock.millis() + 100);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, clock);
    try std.testing.expect(setup.client.peer_manager.catalog.get(peer).?.score > health);

    try setup.client.addDirectPeer(&snapshots[0].identity, &.{support.server_address}, clock);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, clock);
    try std.testing.expect(setup.client.peer_manager.policy_scratch[0].direct);
    _ = setup.client.removeDirectPeer(&snapshots[0].identity);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, clock);
    try std.testing.expect(!setup.client.peer_manager.policy_scratch[0].direct);
    try updateDemand(&setup.client, &.{}, clock);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, clock);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().sync);
    try updateDemand(&setup.client, &.{}, clock);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, clock);
    try std.testing.expect(setup.client.peer_manager.disconnect(peer, .host, clock));
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, clock);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.selection.retained_count);
}

test "core reconciliation batch counts refusal and fresh native room independently" {
    var setup: Setup = .{};
    var opts = resolvedOptions();
    opts.core.peers.max_peers = 2;
    opts.core.peers.target_peers = 1;
    opts.core.peers.min_outbound = 0;
    try setup.initOwnersWithOptions(&.{}, opts);
    defer setup.deinit();
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    const baseline = setup.client.peer_manager.counters;
    const candidate = try candidateFor(&setup.server.peerId(), null);
    const self_candidate = try candidateFor(&setup.client.peerId(), null);
    var invalid = candidate;
    invalid.address_count = 0;
    const result = setup.client.peer_manager.discoveredBatch(setup.client.protocols.gossipsub, &.{ candidate, self_candidate, invalid, candidate }, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 2), result.accepted);
    try std.testing.expectEqual(@as(u16, 2), result.refused);
    setup.pair.client.limits.dialing_max = 2;
    const conn = try setup.pair.dial();
    _ = try setup.pair.dial();
    setup.pair.client.limits.dialing_max = 4;
    setup.pair.client.outbound_max = 4;
    _ = try setup.pair.dial();
    _ = try setup.pair.dial();
    var out: [1]SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 0), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &out));
    try std.testing.expect(setup.pair.client.abandon(conn));
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, setup.pair.now, &out));
    try std.testing.expectEqual(baseline.candidate_selections + 1, setup.client.peer_manager.counters.candidate_selections);
}

test "core reconciliation ban expiry still defers until strict score recovery" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const peer = snapshots[0].peer;
    try std.testing.expectEqual(t.ReputationDecision.ban, setup.client.peer_manager.reportPeer(&.{ .identity = setup.client.peer_manager.catalog.get(peer).?.identity, .action = .fatal }, setup.pair.now).?);
    setup.pair.advance(2_001);
    for (0..4) |_| try setup.step(0);
    try std.testing.expect(setup.client.peer_manager.catalog.get(peer).?.connection == null);
    const candidate = try candidateFor(&snapshots[0].identity, null);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.discoveredBatch(setup.client.protocols.gossipsub, &.{candidate}, setup.pair.now).accepted);
    var out: [1]SelectedDial = undefined;
    const ban = setup.client.peer_manager.catalog.get(peer).?.ban_until_ms;
    var clock = setup.pair.now;
    clock.monotonic = time.milliseconds(ban - 1);
    try std.testing.expectEqual(@as(usize, 0), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, clock, &out));
    clock.monotonic = time.milliseconds(ban);
    try std.testing.expectEqual(@as(usize, 0), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, clock, &out));
    const recovery = time.ceilMilliseconds(setup.client.peer_manager.dialing.schedule(&setup.client.peer_manager.catalog, 1).deadline.?);
    try std.testing.expect(recovery > ban);
    clock.monotonic = time.milliseconds(recovery - 1);
    try std.testing.expectEqual(@as(usize, 0), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, clock, &out));
    clock.monotonic = time.milliseconds(recovery);
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.selectDials(setup.client.protocols.gossipsub, setup.pair.client, clock, &out));
    try std.testing.expect(setup.client.peer_manager.catalog.get(peer).?.score > -50);
    try std.testing.expect(out[0].peer.eql(&candidate.peer));
}

test "core sampling delivery follows real outbound stream retirement replacement and stale events" {
    var setup: Setup = .{};
    const local: t.LocalState = .{ .fork = .{ .fork = .fulu, .minimum_sampling_groups = 8 }, .status = .{ .earliest_available_slot = 0 }, .metadata = .{ .custody_group_count = 4 } };
    var opts = resolvedOptions();
    opts.core.protocols.gossipsub.topic_policy = &.{topic_fixture.full(@splat(0))};
    try setup.initOwnersWithOptions(&local, opts);
    defer setup.deinit();
    _ = try setup.pair.dial();
    const snapshot = try waitSampling(&setup);
    try std.testing.expectEqual(@as(usize, 4), snapshot.custody_groups.?.count());
    try std.testing.expectEqual(@as(usize, 8), snapshot.sampling_groups.?.count());
    var demand: t.Demand = .{};
    for (0..128) |i| if (snapshot.sampling_groups.?.isSet(i)) {
        demand.group_targets[i] = 1;
    };
    for (0..preset.NUMBER_OF_COLUMNS) |column| {
        if (!snapshot.sampling_groups.?.isSet(column % local.fork.custody_groups)) continue;
        var buffer: [80]u8 = undefined;
        const name = try std.fmt.bufPrint(&buffer, "/eth2/00000000/data_column_sidecar_{d}/ssz_snappy", .{column});
        try subscribeServer(&setup, name);
    }
    for (0..40) |_| {
        try setup.step(0);
        setup.pair.advance(25);
    }
    try updateDemand(&setup.client, &demand, setup.pair.now);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().groups);
    const handler = setup.client.protocols.gossipsub;
    const index = handler.sessions.find(snapshot.connection.?).?;
    const old_stream = handler.sessions.rows[index].outbound.live.stream;
    session_io.resetOutbound(handler, setup.pair.client, index);
    try std.testing.expect(!handler.deliveryAvailable(snapshot.connection.?));
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 8), setup.client.peer_manager.coverageDeficits().groups);
    try std.testing.expectEqual(snapshot.custody_groups, setup.client.peer_manager.catalog.get(snapshot.peer).?.custody_groups);
    handler.negotiationResult(setup.pair.client, .{ .stream = old_stream, .direction = .outbound, .protocol = .{ .meshsub = .v1_2 }, .result = .{ .ready = .{ .protocol = .{ .meshsub = .v1_2 }, .leftover = &.{}, .fin = false } } }, setup.pair.now);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 8), setup.client.peer_manager.coverageDeficits().groups);
    for (0..16) |_| try setup.step(1);
    setup.pair.advance(60_000);
    for (0..16) |_| try setup.step(1);
    _ = try setup.pair.dial();
    const replacement = try waitSampling(&setup);
    for (0..80) |_| {
        try setup.step(0);
        setup.pair.advance(25);
    }
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expect(!std.meta.eql(snapshot.connection, replacement.connection));
    const replacement_index = handler.sessions.find(replacement.connection.?).?;
    const replacement_stream = handler.sessions.rows[replacement_index].outbound.live.stream;
    try std.testing.expect(!std.meta.eql(old_stream, replacement_stream));
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().groups);
    handler.streamReady(setup.pair.client, .{ .owner = .gossip_outbound, .row = index }, old_stream, .{ .writable = true });
    try std.testing.expect(handler.deliveryAvailable(replacement.connection.?));
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.coverageDeficits().groups);
    try std.testing.expectEqual(snapshot.custody_groups, setup.client.peer_manager.catalog.get(snapshot.peer).?.custody_groups);
    setup.client.shutdown(setup.pair.now);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.peerCounts().connected);
    try std.testing.expect(!handler.deliveryAvailable(snapshot.connection.?));
}

test "core replaces failed gossip below target without a reputation penalty or admission timer" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..80) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const snapshot = snapshots[0];
    const conn = snapshot.connection.?;
    const driver = setup.client.protocols.gossipsub;
    const index = driver.sessions.find(conn).?;
    const started = driver.counters.negotiation_started;
    try std.testing.expect(driver.deliveryAvailable(conn));
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.selection.retained_count);
    session_io.resetOutbound(driver, setup.pair.client, index);
    try std.testing.expectEqual(setup.pair.now.millis(), clientWakeup(&setup).?);
    setup.client.peer_manager.reconcile(setup.client.protocols.gossipsub, setup.pair.now);
    try std.testing.expectEqual(@as(u16, 0), setup.client.peer_manager.selection.retained_count);
    try std.testing.expectEqual(@as(u16, 1), setup.client.peer_manager.selection.deficits.outbound);
    const after = setup.client.peer_manager.catalog.get(snapshot.peer).?;
    try std.testing.expectEqual(t.DisconnectReason.gossip_unavailable, after.disconnect_reason.?);
    try std.testing.expectEqual(snapshot.score, after.score);
    try std.testing.expectEqual(@as(u64, 0), after.ban_until_ms);
    _ = try setup.turn(&setup.client, .{});
    try std.testing.expectEqual(started, driver.counters.negotiation_started);
}

test "core closes regular and direct connections on the active gossip send deadline" {
    for ([_]bool{ false, true }) |direct| {
        var setup: Setup = .{};
        try setup.init(&.{});
        defer setup.deinit();
        for (0..80) |_| try setup.step(0);
        var snapshots: [4]t.Snapshot = undefined;
        _ = setup.client.peer_manager.snapshots(&snapshots);
        const snapshot = snapshots[0];
        const conn = snapshot.connection.?;
        const g = setup.client.protocols.gossipsub;
        const index = g.sessions.find(conn).?;
        const tx = &g.sessions.rows[index].io.tx;
        if (direct) {
            try expect(setup.client.peer_manager.catalog.setDirect(snapshot.peer, true));
            g.markDirect(conn);
        }
        g.options.output_per_peer = 1;
        tx.active_send_timeout_ms = 100;
        _ = tx.injectFrame("\x80\x02" ++ ([_]u8{0} ** 256), false, setup.pair.now.millis()).?;
        g.settle(index);
        _ = try setup.turn(&setup.client, .{});
        const deadline = tx.active_deadline_ms.?;
        setup.pair.advance(99);
        _ = try setup.turn(&setup.client, .{});
        try equal(deadline, tx.active_deadline_ms.?);
        setup.pair.advance(1);
        _ = try setup.turn(&setup.client, .{});
        const after = setup.client.peer_manager.catalog.get(snapshot.peer).?;
        try equal(t.DisconnectReason.gossip_send_timeout, after.disconnect_reason.?);
        try equal(snapshot.score, after.score);
        try equal(@as(u64, 0), after.ban_until_ms);
        try expect(!tx.pending() and tx.active_deadline_ms == null);
        setup.pair.advance(2000);
        _ = try setup.turn(&setup.client, .{});
        try expect(!g.admitted(conn));
    }
}

test "core charges an incomplete large gossip frame once without a P7 penalty" {
    var setup: Setup = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..80) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const snapshot = snapshots[0];
    const g = setup.client.protocols.gossipsub;
    const index = g.sessions.find(snapshot.connection.?).?;
    const io = &g.sessions.rows[index].io;
    io.reader.declared = io.body.len + 4097;
    io.reader.filled = io.body.len + 4096;
    _ = g.sessions.receive_pool.writable(&io.overflow).?;
    io.overflow.len = 4096;
    io.frame_since = setup.pair.now.millis();
    io.progress_ms = setup.pair.now.millis();
    g.options.large_frame_timeout_ms = 100;
    g.settle(index);
    setup.pair.advance(100);
    _ = try setup.turn(&setup.client, .{});
    try equal(snapshot.score - 10, setup.client.peer_manager.catalog.get(snapshot.peer).?.score);
    try equal(@as(u64, 1), g.counters.receive_discards[@intFromEnum(Gossipsub.ReceiveDiscard.timeout)]);
    for (g.peers.scores.penalties) |count| try equal(@as(u64, 0), count);
    try equal(g.sessions.receive_pool.next.len, g.sessions.receive_pool.free_pages);
    _ = try setup.turn(&setup.client, .{});
    try equal(snapshot.score - 10, setup.client.peer_manager.catalog.get(snapshot.peer).?.score);
}
