const topic_fixture = @import("gossipsub/topic_fixture.zig");
const advertisement = @import("advertisement.zig");
const local_state = @import("local_state.zig");
const schedule_test_support = @import("schedule_test_support.zig");
const driver = @import("driver.zig");
const core_test = @import("network_core_test_support.zig");
const FaultIo = @import("fault_io");
const std = @import("std");
const NetworkCore = @import("network_core.zig").NetworkCore;
const t = @import("peers/types.zig");
const keys = @import("wire/keys.zig");
const d = @import("discv5");
const options = @import("network_core_test_support.zig").networkOptions;
const Inbox = @import("gossipsub/test_support.zig").Inbox;
const Now = @import("types.zig").Now;
const topic_policy = @import("gossipsub/topic_policy.zig");
const local_intent = @import("gossipsub/local_intent.zig");
const test_support = @import("gossipsub/test_support.zig");
const time = @import("time.zig");
const Dialing = @import("peers/dialing.zig").Dialing;
const transport = @import("transport.zig");
const catalog = @import("peers/catalog.zig");
const enr = @import("peers/enr.zig");
const ReqResp = @import("reqresp/root.zig").ReqResp;
const consensus_types = @import("consensus_types");
const policy_fixture = @import("reqresp/policy_fixture.zig");
const admission_fixture = @import("reqresp/admission_fixture.zig");
const configuration = @import("configuration.zig");
const CountingAllocator = @import("counting_allocator.zig").CountingAllocator;
const discovery = @import("peers/discovery.zig");
const PeerId = @import("wire/peer_id.zig").PeerId;

/// Applies a local update through the host intent path with the current subscriptions and demand.
fn applyLocal(node: *NetworkCore, update: *const local_state.LocalUpdate, now: Now) !bool {
    var boundaries: [topic_policy.boundary_max]local_intent.Boundary = undefined;
    var desired = core_test.intent(node, try test_support.subscriptionUpdate(node.protocols.gossipsub, null, false, &boundaries));
    desired.update = update.*;
    return node.applyIntent(&desired, now);
}

fn updateLocalWithEndpoints(node: *NetworkCore, local: *const t.LocalState, schedule: local_state.ForkSchedule, endpoints: ?advertisement.Endpoints, now: Now) !bool {
    return applyLocal(node, &.{ .local = local.*, .schedule = schedule, .endpoints = endpoints, .capabilities = node.protocols.router.capabilities() }, now);
}

fn updateLocal(node: *NetworkCore, local: *const t.LocalState, schedule: local_state.ForkSchedule, now: Now) !bool {
    return updateLocalWithEndpoints(node, local, schedule, node.advertisementEndpoints(), now);
}

const MaintenancePeers = struct {
    nodes: []NetworkCore,

    fn init(hub_allocator: std.mem.Allocator) !MaintenancePeers {
        const nodes = try std.testing.allocator.alloc(NetworkCore, 4);
        errdefer std.testing.allocator.free(nodes);
        var initialized: usize = 0;
        errdefer for (nodes[0..initialized]) |*node| node.deinit(std.testing.io);
        for (nodes, 0..) |*node, index| {
            const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{@as(u8, @intCast(80 + index))}));
            var opts = options(&key);
            opts.resolved.core.peers.target_peers = 3;
            opts.resolved.core.peers.max_peers = 4;
            opts.resolved.core.control.starts_per_turn_max = 1;
            opts.resolved.core.protocols.reqresp.outbound_max = 6;
            opts.resolved.core.protocols.control_reqresp.outbound_max = 4;
            opts.resolved.core.protocols.reqresp.outbound_per_connection_max = 2;
            opts.resolved.core.protocols.router = .{ .negotiations_max = 16, .outbound_control_reserved = 4, .outbound_reserved = 8 };
            try node.init(if (index == 0) hub_allocator else std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
            initialized += 1;
        }
        const hub = &nodes[0];
        errdefer |err| std.debug.print("maintenance bootstrap failed: {t}, peers={any}, operations={any}, requests={any}\n", .{ err, hub.peerCounts(), core_test.controlOperations(hub), hub.protocols.reqresp.pendingCounts() });
        for (nodes[1..]) |*remote| try hub.connectUntil(&remote.peerId(), &.{remote.transport.localAddress()}, hub.last_now, time.milliseconds(hub.last_now.millis() +| Dialing.connect_timeout_ms));
        for (0..3000) |_| {
            try step(&.{ &nodes[0], &nodes[1], &nodes[2], &nodes[3] });
            if (hub.peerCounts().relevant != 3 or core_test.controlOperations(hub) != 0) continue;
            var snapshots: [4]t.Snapshot = undefined;
            const count = hub.peer_manager.snapshots(&snapshots);
            var metadata = true;
            for (snapshots[0..count]) |snapshot| metadata = metadata and snapshot.metadata != null;
            var retired = true;
            for (hub.protocols.reqresp.outbound) |slot| retired = retired and !slot.request.occupied();
            for (hub.protocols.router.negotiator.entries) |entry| retired = retired and entry.state == .free;
            if (metadata and retired) return .{ .nodes = nodes };
        }
        return error.TestUnexpectedResult;
    }

    fn deinit(self: *MaintenancePeers) void {
        for (self.nodes) |*node| node.deinit(std.testing.io);
        std.testing.allocator.free(self.nodes);
    }

    fn step(nodes: []const *NetworkCore) !void {
        for (nodes) |node| {
            const now = try Now.read(std.testing.io);
            const result = driver.step(node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 1)));
            if (result.failure) |err| return err;
        }
    }
};

test "core rejects incomplete serving state before startup allocation" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{1}));
    var opts = options(&key);
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    var node: NetworkCore = undefined;
    opts.startup.local.metadata.custody_group_count = null;
    try std.testing.expectError(error.MissingCustodyAdvertisement, node.init(failing.allocator(), std.testing.io, &opts.resolved, opts.startup));
    opts.startup.local.metadata.custody_group_count = 1;
    opts.startup.local.status.earliest_available_slot = null;
    try std.testing.expectError(error.MissingAvailability, node.init(failing.allocator(), std.testing.io, &opts.resolved, opts.startup));
    try std.testing.expectEqual(@as(usize, 0), failing.alloc_index);
}

test "core maintenance isolates slow peers and full application capacity" {
    const rr = @import("reqresp/root.zig");
    var backing_hub = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    var fixture = try MaintenancePeers.init(backing_hub.allocator());
    defer fixture.deinit();
    const hub = &fixture.nodes[0];
    errdefer |err| std.debug.print("maintenance isolation failed: {t}, peers={any}, operations={any}, requests={any}\n", .{ err, hub.peerCounts(), core_test.controlOperations(hub), hub.protocols.reqresp.pendingCounts() });
    const healthy = &fixture.nodes[3];
    const slow = hub.peer_manager.catalog.find(&fixture.nodes[1].peerId()).?;
    const healthy_peer = hub.peer_manager.catalog.find(&healthy.peerId()).?;
    const conn = hub.peer_manager.catalog.get(slow).?.connection.?;
    const size = rr.Protocol.blocks_by_root_v2.info().response_max;
    const sinks = try std.testing.allocator.alloc(u8, 2 * size);
    defer {
        hub.protocols.reqresp.cancelAll(&hub.transport.engine, &hub.protocols.router, hub.last_now);
        std.testing.allocator.free(sinks);
    }
    const calls = backing_hub.allocations;
    for (0..2) |index| _ = try hub.sendReqRespRequest(&fixture.nodes[1].peerId(), .blocks_by_root_v2, &([_]u8{1} ** 32), sinks[index * size ..][0..size], .{}, hub.last_now);
    for (0..10) |_| _ = try hub.protocols.router.beginMeshsub(&hub.transport.engine, conn, hub.last_now);
    try std.testing.expectError(error.NegotiationTableFull, hub.protocols.router.beginMeshsub(&hub.transport.engine, conn, hub.last_now));
    var status = healthy.localState().status;
    status.head_slot = 42;
    try healthy.updateStatus(&status);
    hub.peer_manager.reStatusPeers(hub.last_now);
    const control = &hub.peer_manager.control;
    const started = control.counters.started;
    for (0..3) |turn| {
        const now = try Now.read(std.testing.io);
        _ = driver.step(hub, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
        try std.testing.expectEqual(started + turn + 1, control.counters.started);
    }
    try std.testing.expectEqual(@as(usize, 3), core_test.controlOperations(hub));
    for (0..1000) |_| {
        try MaintenancePeers.step(&.{ hub, healthy });
        const snapshot = hub.peer_manager.catalog.get(healthy_peer).?;
        if (snapshot.status.?.head_slot == 42 and core_test.controlOperations(hub) == 2) break;
    }
    try std.testing.expectEqual(@as(u64, 42), hub.peer_manager.catalog.get(healthy_peer).?.status.?.head_slot);
    try std.testing.expectEqual(@as(usize, 2), core_test.controlOperations(hub));
    try std.testing.expectEqual(@as(u16, 2), hub.protocols.reqresp.outboundOccupiedCount(conn));
    try std.testing.expectEqual(calls, backing_hub.allocations);
}

test "core validates capacities and current application fork before allocation" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{1}));
    var node: NetworkCore = undefined;
    var opts = options(&key);
    opts.resolved.core.peers.capacity = 5;
    opts.resolved.core.peers.max_peers = 5;
    opts.resolved.core.protocols.reqresp.connections = 5;
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    try std.testing.expectError(error.InvalidOptions, node.init(failing.allocator(), std.testing.io, &opts.resolved, opts.startup));
    opts = options(&key);
    opts.resolved.core.protocols.reqresp.forks = &.{};
    try std.testing.expectError(error.UnknownFork, node.init(failing.allocator(), std.testing.io, &opts.resolved, opts.startup));
}

test "core loads at most 256 remembered peers and snapshots them" {
    const remembered = @import("peers/remembered.zig");
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{1}));
    var node: NetworkCore = undefined;
    var opts = options(&key);
    const now = try Now.read(std.testing.io);
    var records: [remembered.capacity + 1]remembered.Record = undefined;
    for (&records, 0..) |*record, i| record.* = .{
        .peer = .{ .bytes = @splat(@truncate(i + 2)) },
        .address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = @intCast(9 + i) } },
        .qualified_at_s = remembered.seconds(now) - 60,
    };
    opts.startup.remembered = &records;
    try std.testing.expectError(error.InvalidOptions, node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup));
    opts.startup.remembered = records[0..2];
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    var out: [remembered.capacity]remembered.Record = undefined;
    try std.testing.expectError(error.OutputTooSmall, node.rememberedPeers(node.last_now, out[0 .. remembered.capacity - 1]));
    try std.testing.expectEqual(@as(usize, 2), try node.rememberedPeers(node.last_now, &out));
    try std.testing.expectEqual(@as(u64, 2), node.peer_manager.catalog.remembered.counters.seeds[@intFromEnum(remembered.Seed.loaded)]);
}

test "core metrics copy peer processing work without advancing it" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{1}));
    var node: NetworkCore = undefined;
    const opts = options(&key);
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    node.peer_manager.reconcile(node.protocols.gossipsub, node.last_now);
    const peer_work = node.peer_manager.counters;
    const selection = node.peer_manager.selection;
    const policy_due = node.peer_manager.policy_due_ms;
    const metrics = @import("metrics/export.zig");
    const context = metrics.Context.init(&node, node.last_now);
    const bytes = try std.testing.allocator.alloc(u8, metrics.fixed_text_capacity);
    defer std.testing.allocator.free(bytes);
    var writer = std.Io.Writer.fixed(bytes);
    try metrics.write(&context, &writer);
    try std.testing.expectEqualDeep(peer_work, node.peer_manager.counters);
    try std.testing.expectEqualDeep(selection, node.peer_manager.selection);
    try std.testing.expectEqual(policy_due, node.peer_manager.policy_due_ms);
}

test "core signed bootstrap reaches relevant peer with zero and one outputs" {
    const key_a = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{11}));
    const key_b = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{12}));
    var opts_b = options(&key_b);
    opts_b.startup.discovery = .{ .bind = .{ .ip4 = .loopback(0) } };
    var b: NetworkCore = undefined;
    var backing_b = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    try b.init(backing_b.allocator(), std.testing.io, &opts_b.resolved, opts_b.startup);
    defer b.deinit(std.testing.io);
    var opts_a = options(&key_a);
    opts_a.startup.discovery = opts_b.startup.discovery;
    opts_a.startup.discovery.?.bootstrap = &.{b.localRecord().?.*};
    var a: NetworkCore = undefined;
    var backing_a = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    try a.init(backing_a.allocator(), std.testing.io, &opts_a.resolved, opts_a.startup);
    defer a.deinit(std.testing.io);
    var a_inbox: Inbox = .{};
    defer a_inbox.deinit();
    a_inbox.attach(a.protocols.gossipsub);
    var b_inbox: Inbox = .{};
    defer b_inbox.deinit();
    b_inbox.attach(b.protocols.gossipsub);
    const calls_a = backing_a.allocations;
    const calls_b = backing_b.allocations;
    var events: [1]t.Event = undefined;
    var ready = false;
    const start = try Now.read(std.testing.io);
    errdefer std.debug.print("core scenario elapsed={}ms a={any} b={any}\n", .{ a.last_now.millis() -| start.millis(), a.peerCounts(), b.peerCounts() });
    for (0..3000) |turn| {
        const now = try Now.read(std.testing.io);
        if (now.millis() - start.millis() > 10_000) break;
        const result_a = driver.step(&a, std.testing.io, now, .{ .peers = events[0..@intFromBool(turn > 10)] }, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 1)));
        if (result_a.failure) |err| return err;
        if (result_a.counts.peers > 0 and events[0] == .ready) ready = true;
        const result_b = driver.step(&b, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 1)));
        if (result_b.failure) |err| return err;
        if (ready and a.peerCounts().relevant == 1 and b.peerCounts().relevant == 1) break;
    }
    try std.testing.expect(ready);
    try std.testing.expectEqual(@as(u16, 1), a.peerCounts().relevant);
    try std.testing.expectEqual(@as(u16, 1), b.peerCounts().relevant);
    const hint_now = try Now.read(std.testing.io);
    const accepted = a.peer_manager.catalog.rowFor(a.peer_manager.catalog.find(&b.peerId()).?).?;
    try std.testing.expect(hint_now.millis() < accepted.dial.hints_at_ms +| catalog.Catalog.hint_freshness_ms);
    const hints = accepted.dial.hints.?;
    const candidate = try enr.decode(b.localRecord().?, &a.localState().fork);
    try std.testing.expectEqualDeep(candidate.hints.fork, hints.fork);
    try std.testing.expectEqualDeep(candidate.hints.next_fork_digest, hints.next_fork_digest);
    const local = a.localState();
    _ = try updateLocal(&a, &local, .{ .next_version = .{ 1, 1, 1, 1 }, .next_epoch = 123, .next_digest = .{ 1, 2, 3, 4 } }, hint_now);
    try std.testing.expectEqual(@as(u16, 1), a.peerCounts().relevant);
    _ = try updateLocal(&a, &local, .{}, hint_now);
    try applicationAndFork(&a, &b, &b_inbox);
    try failureAndReplacement(&a, &b);
    try std.testing.expectEqual(calls_a, backing_a.allocations);
    try std.testing.expectEqual(calls_b, backing_b.allocations);
    a.shutdown(a.last_now);
    a.shutdown(a.last_now);
    b.shutdown(b.last_now);
    a.deinit(std.testing.io);
    b.deinit(std.testing.io);
    _ = d;
}

fn applicationAndFork(a: *NetworkCore, b: *NetworkCore, b_inbox: *Inbox) !void {
    var stage: enum { transition, application, gossip } = .transition;
    const begun = try Now.read(std.testing.io);
    errdefer std.debug.print("core stage={s} elapsed={}ms a={any} b={any}\n", .{ @tagName(stage), a.last_now.millis() -| begun.millis(), a.peerCounts(), b.peerCounts() });
    const rr = @import("reqresp/root.zig");
    var rows: [4]t.Snapshot = undefined;
    const now = try Now.read(std.testing.io);
    for ([_]*NetworkCore{ a, b }) |node| {
        var local = node.localState();
        local.fork.fork = .fulu;
        local.fork.digest = .{ 1, 2, 3, 4 };
        local.status.fork_digest = local.fork.digest;
        local.status.earliest_available_slot = 0;
        local.metadata.custody_group_count = local.fork.custody_groups;
        local.metadata.attnets[0] = 0x81;
        _ = try updateLocal(node, &local, .{ .fulu_scheduled = true }, now);
        node.peer_manager.reStatusPeers(now);
    }
    var peer_a: ?t.PeerRef = null;
    var peer_b: ?t.PeerRef = null;
    for (0..2000) |_| {
        const tick = try Now.read(std.testing.io);
        _ = driver.step(a, std.testing.io, tick, .{}, .deadlineOnly(time.optionalMilliseconds(tick.millis() +| 1)));
        _ = driver.step(b, std.testing.io, tick, .{}, .deadlineOnly(time.optionalMilliseconds(tick.millis() +| 1)));
        for (rows[0..a.peer_manager.snapshots(&rows)]) |row| {
            if (row.relevant and row.status != null and row.status.?.earliest_available_slot != null and row.custody_groups != null) peer_a = row.peer;
        }
        for (rows[0..b.peer_manager.snapshots(&rows)]) |row| {
            if (row.relevant and row.status != null and row.status.?.earliest_available_slot != null and row.custody_groups != null) peer_b = row.peer;
        }
        if (peer_a != null and peer_b != null) break;
    }
    try std.testing.expect(peer_a != null and peer_b != null);
    stage = .application;
    var request: [24]u8 = @splat(0);
    request[8] = 1;
    request[16] = 1;
    const sink_size = rr.Protocol.blocks_by_range_v2.info().response_max;
    const sinks = try std.testing.allocator.alloc(u8, 4 * sink_size);
    defer std.testing.allocator.free(sinks);
    var handles: [4]rr.ReqResp.RequestHandle = undefined;
    for (&handles, 0..) |*handle, i| {
        const protocol: rr.Protocol = if (i < 2) .blocks_by_range_v2 else .blocks_by_root_v2;
        handle.* = try a.sendReqRespRequest(&b.peerId(), protocol, if (i < 2) &request else &([_]u8{0} ** 32), sinks[i * sink_size ..][0..sink_size], .{ .expected_chunks = 1 }, now);
    }
    try std.testing.expectError(error.TooManyRequests, a.sendReqRespRequest(&b.peerId(), .blocks_by_range_v2, &request, sinks[0..sink_size], .{}, now));
    a.peer_manager.reStatusPeers(now);
    b.peer_manager.reStatusPeers(now);
    for (0..20) |_| {
        const tick = try Now.read(std.testing.io);
        _ = driver.step(a, std.testing.io, tick, .{}, .deadlineOnly(time.optionalMilliseconds(tick.millis() +| 1)));
        _ = driver.step(b, std.testing.io, tick, .{}, .deadlineOnly(time.optionalMilliseconds(tick.millis() +| 1)));
    }
    const response = [_]u8{9} ** consensus_types.fulu.SignedBeaconBlock.min_size;
    var app: [1]rr.ReqResp.Event = undefined;
    var peer_events: [1]t.Event = undefined;
    var done: usize = 0;
    var chunks: usize = 0;
    for (0..3000) |_| {
        const tick = try Now.read(std.testing.io);
        const received = driver.step(b, std.testing.io, tick, .{ .application = &app }, .deadlineOnly(time.optionalMilliseconds(tick.millis() +| 1)));
        if (received.failure) |err| return err;
        for (app[0..received.counts.application]) |event| switch (event) {
            .request => |value| try b.respond(value.request, &response, .{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu }, tick),
            .chunk_sent => |value| try std.testing.expect(b.finishResponse(value.request, tick)),
            .failed => return error.ApplicationFailed,
            else => {},
        };
        const sent = driver.step(a, std.testing.io, tick, .{ .application = &app, .peers = &peer_events }, .deadlineOnly(time.optionalMilliseconds(tick.millis() +| 1)));
        if (sent.failure) |err| return err;
        for (app[0..sent.counts.application]) |event| switch (event) {
            .chunk => |value| {
                try std.testing.expectEqual(t.ForkSeq.fulu, value.fork.?);
                try std.testing.expectEqualSlices(u8, &response, value.bytes);
                try std.testing.expect(a.consumeResponse(value.request, try Now.read(std.testing.io)));
                chunks += 1;
            },
            .done => done += 1,
            .failed => return error.ApplicationFailed,
            else => {},
        };
        if (done == 4) break;
    }
    try std.testing.expectEqual(@as(usize, 4), done);
    try std.testing.expectEqual(@as(usize, 4), chunks);
    stage = .gossip;
    try a.addDirectPeer(&b.peerId(), &.{b.transport.localAddress()}, now);
    try b.addDirectPeer(&a.peerId(), &.{a.transport.localAddress()}, now);
    const topic = "/eth2/01020304/beacon_block/ssz_snappy";
    try core_test.subscribe(a, topic);
    try core_test.subscribe(b, topic);
    var got = false;
    var published = false;
    for (0..3000) |turn| {
        const tick = try Now.read(std.testing.io);
        _ = driver.step(a, std.testing.io, tick, .{}, .deadlineOnly(time.optionalMilliseconds(tick.millis() +| 1)));
        if (!published and turn > 20 and a.protocols.gossipsub.resourceSnapshot().remote_subscriptions > 0 and
            a.protocols.gossipsub.peers.rows[0].direct)
        {
            const sent = try a.publishGossipWithOptions(topic, &response, .{ .allow_zero_peers = false }, tick);
            try std.testing.expectError(error.Duplicate, a.publishGossipWithOptions(topic, &response, .{}, tick));
            try std.testing.expect((try a.publishGossipWithOptions(topic, &response, .{ .ignore_duplicate = true }, tick)).duplicate);
            published = sent.queued > 0;
        }
        b_inbox.clear();
        _ = driver.step(b, std.testing.io, tick, .{}, .deadlineOnly(time.optionalMilliseconds(tick.millis() +| 1)));
        for (b_inbox.messages()) |message| {
            try std.testing.expectEqualSlices(u8, &response, message.bytes);
            try std.testing.expect(b.reportValidation(message.handle, .accept, tick) == .applied);
            got = true;
        }
        if (got) break;
        // QUIC retransmission requires elapsed time.
        try std.testing.io.sleep(.fromMilliseconds(1), .awake);
    }
    if (!published or !got) std.debug.print("gossip published={} received={} subscriptions={} direct={}\n", .{ published, got, a.protocols.gossipsub.resourceSnapshot().remote_subscriptions, a.protocols.gossipsub.peers.rows[0].direct });
    try std.testing.expect(published);
    try std.testing.expect(got);
    try core_test.unsubscribe(a, topic);
    try core_test.unsubscribe(b, topic);
    _ = a.removeDirectPeer(&b.peerId());
    _ = b.removeDirectPeer(&a.peerId());
}

test "core every allocation prefix cleans up and reservations count owned storage" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{21}));
    var opts = options(&key);
    opts.startup.discovery = .{ .bind = .{ .ip4 = .loopback(0) } };

    opts.resolved.core.protocols.reqresp.admission = .{ .policy = policy_fixture.config(), .limits = .{
        .source = admission_fixture.quotas(100, 1000),
        .global = admission_fixture.quotas(1000, 1000),
    } };
    var allocation = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    var node: NetworkCore = undefined;
    try node.init(allocation.allocator(), std.testing.io, &opts.resolved, opts.startup);
    const allocated = node.allocations.bytes;
    std.debug.print("local intent memory: allocated={} inline={} workspace={} prefixes={}\n", .{ allocated, @sizeOf(NetworkCore), @sizeOf(local_intent.Workspace), allocation.alloc_index });
    try std.testing.expectEqual(allocation.allocated_bytes, allocated);
    const allocations = allocation.alloc_index;
    const runtime_calls = allocation.allocations;
    const now = try Now.read(std.testing.io);
    for (0..4) |_| _ = driver.step(&node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
    try std.testing.expectEqual(allocation.allocated_bytes, allocated);
    try std.testing.expectEqual(runtime_calls, allocation.allocations);
    node.deinit(std.testing.io);
    node.deinit(std.testing.io);
    try std.testing.expectEqual(allocation.allocated_bytes, allocation.freed_bytes);
    try std.testing.expect(allocations < 128);
    for (0..allocations) |index| {
        var failed = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = index });
        try std.testing.expectError(error.OutOfMemory, node.init(failed.allocator(), std.testing.io, &opts.resolved, opts.startup));
        try std.testing.expectEqual(failed.allocated_bytes, failed.freed_bytes);
    }
}

test "core demand persists until replacement and reaches discovery after selection" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{23}));
    var opts = options(&key);
    opts.resolved.core.peers.target_peers = 0;
    opts.resolved.core.peers.min_outbound = 0;
    opts.startup.discovery = .{ .bind = .{ .ip4 = .loopback(0) } };
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    var desired = core_test.intent(&node, &.{});
    desired.demand = .{ .attnets = 1 };
    _ = try node.applyIntent(&desired, node.last_now);
    const now = try Now.read(std.testing.io);
    _ = driver.step(&node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
    try std.testing.expectEqual(@as(u8, 1), node.discovery.?.demand.attnets[0]);
    const view: *const NetworkCore = &node;
    const evaluated = view.peer_manager.coverageDeficits();
    desired.demand = .{ .attnets = 2 };
    _ = try node.applyIntent(&desired, node.last_now);
    try std.testing.expectEqual(node.last_now.millis(), schedule_test_support.wakeupMilliseconds(node.schedule(node.last_now, .{}), node.last_now.millis()).?);
    try std.testing.expectEqualDeep(evaluated, view.peer_manager.coverageDeficits());
    try std.testing.expectEqual(@as(u8, 1), view.peer_manager.discoveryNeed().attnets[0]);
    try std.testing.expectEqual(@as(u8, 1), node.discovery.?.demand.attnets[0]);
    _ = driver.step(&node, std.testing.io, node.last_now, .{}, .deadlineOnly(time.optionalMilliseconds(node.last_now.millis())));
    try std.testing.expectEqual(@as(u8, 2), view.peer_manager.discoveryNeed().attnets[0]);
    try std.testing.expectEqual(@as(u8, 2), node.discovery.?.demand.attnets[0]);
    _ = driver.step(&node, std.testing.io, node.last_now, .{}, .deadlineOnly(time.optionalMilliseconds(node.last_now.millis())));
    try std.testing.expectEqual(@as(u16, 1), view.peer_manager.coverageDeficits().attestation);
    try std.testing.expectEqual(@as(u8, 2), view.peer_manager.discoveryNeed().attnets[0]);
    try std.testing.expectEqual(@as(u8, 2), node.discovery.?.demand.attnets[0]);
    desired.demand = .{ .attnets = 4, .attestation_target = 0 };
    try std.testing.expectError(error.InvalidDemand, node.applyIntent(&desired, node.last_now));
    _ = driver.step(&node, std.testing.io, node.last_now, .{}, .deadlineOnly(time.optionalMilliseconds(node.last_now.millis())));
    try std.testing.expectEqual(@as(u16, 1), view.peer_manager.coverageDeficits().attestation);
    try std.testing.expectEqual(@as(u8, 2), view.peer_manager.discoveryNeed().attnets[0]);
    try std.testing.expectEqual(@as(u8, 2), node.discovery.?.demand.attnets[0]);
    desired.demand = .{};
    _ = try node.applyIntent(&desired, node.last_now);
    _ = driver.step(&node, std.testing.io, node.last_now, .{}, .deadlineOnly(time.optionalMilliseconds(node.last_now.millis())));
    try std.testing.expectEqual(@as(u16, 0), view.peer_manager.coverageDeficits().attestation);
    try std.testing.expectEqual(@as(u8, 0), view.peer_manager.discoveryNeed().attnets[0]);
    try std.testing.expectEqual(@as(u8, 0), node.discovery.?.demand.attnets[0]);
}

test "core fails a dial the host refuses without failing the turn or penalizing the peer" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{24}));
    const remote = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{25}));
    var node: NetworkCore = undefined;
    const opts = options(&key);
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    const now = try Now.read(std.testing.io);
    const peer = t.PeerId.fromPublicKey(&remote.publicKey());
    try node.connectUntil(&peer, &.{.{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 19003 } }}, now, time.milliseconds(now.millis() +| Dialing.connect_timeout_ms));
    var faults: FaultIo = .{
        .send = .{ .socket = node.transport.sockets.primary().handle },
        .send_failure = error.AccessDenied,
    };
    const refused = driver.step(&node, faults.io(), now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
    try std.testing.expect(refused.failure == null);
    try std.testing.expectEqual(@as(u8, 1), refused.dial_failed);
    try std.testing.expectEqual(@as(u8, 0), refused.dial_deferred);
    try std.testing.expectEqual(@as(u8, 0), refused.dial_started);
    const row = &node.peer_manager.catalog.rows[0];
    try std.testing.expectEqual(@as(u8, 1), row.dial.failures);
    try std.testing.expect(row.attempt == null);
    try std.testing.expectEqual(@as(f64, 0), row.reputation.score);
    try std.testing.expect(!row.reputation.banned(now.millis()));
    const history = &node.peer_manager.catalog.history;
    try std.testing.expect(history.rejection(history.identityKey(&peer), now.millis()) == null);
}

test "core socket faults preserve the other owner and local dial refusal is deferred" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{22}));
    const remote_key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{23}));
    var opts = options(&key);
    opts.startup.discovery = .{ .bind = .{ .ip4 = .loopback(0) } };
    var node: NetworkCore = undefined;
    var backing_node = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    try node.init(backing_node.allocator(), std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    const now = try Now.read(std.testing.io);
    var faults: FaultIo = .{};
    const io = faults.io();
    const sender = try (std.Io.net.IpAddress{ .ip4 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer sender.close(std.testing.io);
    for ([_]std.Io.net.Socket{ node.transport.sockets.primary(), node.discovery.?.transport.sockets.primary() }) |socket| {
        // The owner receives only from a socket its poll reported readable.
        try sender.send(std.testing.io, &socket.address, "invalid");
        faults.receive = .{ .socket = socket.handle };
        faults.receive_calls = 0;
        const result = driver.step(&node, io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 1000)));
        try std.testing.expectEqual(error.Canceled, result.failure.?);
        try std.testing.expect(faults.receive_calls >= 1);
        try std.testing.expect(node.last_now.millis() >= now.millis());
        faults.receive = null;
        _ = driver.step(&node, io, node.last_now, .{}, .deadlineOnly(time.optionalMilliseconds(node.last_now.millis())));
    }
    faults.receive = null;
    const idle = driver.step(&node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
    try std.testing.expect(idle.failure == null);
    const settled = node.last_now;
    const discovery_due = schedule_test_support.wakeupMilliseconds(node.discovery.?.schedule(), settled.millis()).?;
    try std.testing.expect(discovery_due > settled.millis());
    const due = schedule_test_support.wakeupMilliseconds(node.schedule(settled, .{}), settled.millis()).?;
    try std.testing.expect(due > settled.millis() and due <= discovery_due);
    const peer = t.PeerId.fromPublicKey(&remote_key.publicKey());
    try node.connectUntil(&peer, &.{.{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 19003 } }}, settled, time.milliseconds(settled.millis() +| Dialing.connect_timeout_ms));
    try std.testing.expectEqual(settled.millis(), schedule_test_support.wakeupMilliseconds(node.schedule(settled, .{}), settled.millis()).?);
    faults.send = .{};
    faults.send_calls = 0;
    faults.send_failure = error.Unexpected;
    const refused = driver.step(&node, io, settled, .{}, .deadlineOnly(time.optionalMilliseconds(settled.millis())));
    try std.testing.expectEqual(@as(u8, 1), refused.dial_deferred);
    try std.testing.expectEqual(error.Unexpected, refused.failure.?);
    try std.testing.expectEqual(@as(u8, 0), refused.dial_started);
    for (node.peer_manager.catalog.rows) |row| if (row.occupied) {
        try std.testing.expectEqual(@as(u8, 0), row.dial.failures);
        try std.testing.expect(row.attempt == null);
    };
    const calls = backing_node.allocations;
    const clean = driver.step(&node, std.testing.io, settled, .{}, .deadlineOnly(time.optionalMilliseconds(settled.millis())));
    try std.testing.expect(clean.failure == null);
    try std.testing.expectEqual(calls, backing_node.allocations);
}

test "core discovery advancement does not wait for datagrams" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{26}));
    var opts = options(&key);
    opts.startup.discovery = .{ .bind = .{ .ip4 = .loopback(0) } };
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    var faults: FaultIo = .{};
    const sender = try (std.Io.net.IpAddress{ .ip4 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer sender.close(std.testing.io);
    try sender.send(std.testing.io, &node.discovery.?.transport.sockets.primary().address, "invalid");
    const now = try Now.read(std.testing.io);
    const received = driver.step(&node, faults.io(), now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
    try std.testing.expect(received.failure == null);
    const rejected = &node.discovery.?.datagram_rejections[@intFromEnum(d.types.RejectReason.malformed_packet)];
    try std.testing.expectEqual(@as(u64, 1), rejected.*);
    const after_datagram = faults.receive_calls;
    try std.testing.expectEqual(@as(usize, 1), after_datagram);
    const idle = driver.step(&node, faults.io(), node.last_now, .{}, .deadlineOnly(time.optionalMilliseconds(node.last_now.millis())));
    try std.testing.expect(idle.failure == null);
    try std.testing.expectEqual(@as(u64, 1), rejected.*);
    try std.testing.expectEqual(after_datagram, faults.receive_calls);
    try std.testing.expectEqual(@as(i64, 0), faults.longest_wait_ms);
}

fn failureAndReplacement(a: *NetworkCore, b: *NetworkCore) !void {
    var snapshots: [4]t.Snapshot = undefined;
    const count = a.peer_manager.snapshots(&snapshots);
    var target: ?t.PeerRef = null;
    for (snapshots[0..count]) |snapshot| if (snapshot.connection != null) {
        target = snapshot.peer;
    };
    const now = try Now.read(std.testing.io);
    try std.testing.expectEqual(t.ReputationDecision.ban, a.reportPeer(&.{ .identity = a.peer_manager.catalog.get(target.?).?.identity, .action = .fatal }, now).?);
    var faults: FaultIo = .{ .receive = .{ .socket = a.transport.sockets.primary().handle } };
    const faulty_io = faults.io();
    const deadline = a.peer_manager.control.connections[target.?.index].closing.?.deadline_ms;
    var after_deadline = now;
    after_deadline.monotonic = time.milliseconds(deadline);
    const result = driver.step(a, faulty_io, after_deadline, .{}, .deadlineOnly(time.optionalMilliseconds(after_deadline.millis())));
    try std.testing.expectEqual(error.Canceled, result.failure.?);
    try std.testing.expectEqual(@as(u16, 0), a.peerCounts().relevant);
    try std.testing.expect(a.peer_manager.catalog.get(target.?).?.connection == null);
    for (0..100) |_| {
        _ = driver.step(a, std.testing.io, a.last_now, .{}, .deadlineOnly(time.optionalMilliseconds(a.last_now.millis())));
        _ = driver.step(b, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
        if (a.peerCounts().connected == 0) break;
    }
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{24}));
    var opts = options(&key);
    opts.startup.local = a.localState();
    opts.startup.schedule = a.fork_schedule;
    var replacement: NetworkCore = undefined;
    try replacement.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer replacement.deinit(std.testing.io);
    try replacement.connectUntil(&a.peerId(), &.{a.transport.localAddress()}, now, time.milliseconds(now.millis() +| Dialing.connect_timeout_ms));
    for (0..2000) |_| {
        const tick = try Now.read(std.testing.io);
        const added = driver.step(&replacement, std.testing.io, tick, .{}, .deadlineOnly(time.optionalMilliseconds(tick.millis() +| 1)));
        if (added.failure) |err| return err;
        var host_tick = tick;
        host_tick.monotonic = time.milliseconds(@max(host_tick.millis(), a.last_now.millis()));
        const accepted = driver.step(a, std.testing.io, host_tick, .{}, .deadlineOnly(time.optionalMilliseconds(host_tick.millis() +| 1)));
        if (accepted.failure) |err| return err;
        if (a.peerCounts().relevant == 1 and replacement.peerCounts().relevant == 1) break;
    }
    try std.testing.expectEqual(@as(u16, 1), a.peerCounts().relevant);
    try std.testing.expectEqual(@as(u16, 1), replacement.peerCounts().relevant);
    replacement.shutdown(try Now.read(std.testing.io));
}

test "core receive capacities measure reservations and unwind byte exhaustion" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{21}));
    for ([_]usize{ 32 * 1024 * 1024, 128 * 1024 * 1024 }) |receive_bytes| {
        var ledger: CountingAllocator = .{ .backing = std.testing.allocator };
        var request: configuration.Options = .{ .gossip = .{ .topic_policy = comptime &.{topic_fixture.blocks(.{ 1, 2, 3, 4 })}, .receive_arena_bytes = receive_bytes }, .seed = 1, .forks = &.{.{ .digest = @splat(0), .fork = .phase0 }}, .admission_policy = policy_fixture.config() };
        const startup: NetworkCore.Startup = .{ .host = &key, .bind = .{ .ip4 = .loopback(0) }, .local = core_test.localState(.{}), .clock = core_test.slot_clock };
        var resolved = try configuration.resolve(request);
        var node: NetworkCore = undefined;
        try node.init(ledger.allocator(), std.testing.io, &resolved, startup);
        var initialized = true;
        defer if (initialized) node.deinit(std.testing.io);
        const measured = ledger.bytes;
        const mib = 1024 * 1024;
        std.debug.print("core receive memory {d}: total={d} reqresp={d} negotiations={d}\n", .{ receive_bytes, measured, node.protocols.reqresp.memoryPlan().total_bytes, node.protocols.router.negotiator.entries.len });
        try std.testing.expectEqual(@as(u64, 512 * mib), node.transport.engine.memoryPlan().receive_window_bytes);
        try std.testing.expect(measured <= node.allocations.byte_limit.?);
        node.deinit(std.testing.io);
        initialized = false;
        try std.testing.expectEqual(@as(usize, 0), ledger.bytes);
        request.byte_limit = measured - 1;
        resolved = try configuration.resolve(request);
        try std.testing.expectError(error.OutOfMemory, node.init(ledger.allocator(), std.testing.io, &resolved, startup));
        try std.testing.expectEqual(@as(usize, 0), ledger.bytes);
        request.byte_limit = measured;
        resolved = try configuration.resolve(request);
        try node.init(ledger.allocator(), std.testing.io, &resolved, startup);
        initialized = true;
        node.deinit(std.testing.io);
        initialized = false;
        try std.testing.expectEqual(@as(usize, 0), ledger.bytes);
    }
}

test "core cleans every failed allocation prefix" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, coreAllocationFailures, .{});
}

fn coreAllocationFailures(a: std.mem.Allocator) !void {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{22}));
    const resolved = try configuration.resolve(core_test.options());
    var node: NetworkCore = undefined;
    try node.init(a, std.testing.io, &resolved, .{ .host = &key, .bind = .{ .ip4 = .loopback(0) }, .local = core_test.localState(.{}), .clock = core_test.slot_clock });
    node.deinit(std.testing.io);
}

test "core BPO duplicate digest validation precedes allocation" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{1}));
    var node: NetworkCore = undefined;
    var opts = options(&key);
    opts.resolved.core.protocols.reqresp.forks = &.{
        .{ .digest = @splat(0), .fork = .phase0 },
        .{ .digest = @splat(0), .fork = .fulu },
    };
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    try std.testing.expectError(error.InvalidOptions, node.init(failing.allocator(), std.testing.io, &opts.resolved, opts.startup));
}

test "core targeted Status serves two current connections and immediate close is local" {
    const key_a = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{31}));
    const key_b = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{32}));
    const key_c = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{33}));
    var a: NetworkCore = undefined;
    var b: NetworkCore = undefined;
    var c: NetworkCore = undefined;
    var opts = options(&key_a);
    opts.resolved.core.peers.capacity = 3;
    opts.resolved.core.peers.min_outbound = 0;
    opts.resolved.core.protocols.identify = .{ .agent = "peer-operations" };
    var backing_a = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    try a.init(backing_a.allocator(), std.testing.io, &opts.resolved, opts.startup);
    defer a.deinit(std.testing.io);
    opts = options(&key_b);
    opts.resolved.core.protocols.identify = .{ .agent = "peer-operations" };
    try b.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer b.deinit(std.testing.io);
    opts = options(&key_c);
    opts.resolved.core.protocols.identify = .{ .agent = "peer-operations" };
    try c.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer c.deinit(std.testing.io);
    const start = try Now.read(std.testing.io);
    try a.addDirectPeer(&b.peerId(), &.{b.transport.localAddress()}, start);
    try a.addDirectPeer(&c.peerId(), &.{c.transport.localAddress()}, start);
    var rows: [4]t.Snapshot = undefined;
    var ready = false;
    for (0..3000) |_| {
        const now = try Now.read(std.testing.io);
        if (now.millis() - start.millis() > 10_000) break;
        for ([_]*NetworkCore{ &a, &b, &c }) |node| {
            const result = driver.step(node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 1)));
            if (result.failure) |err| return err;
        }
        const count = a.peer_manager.snapshots(&rows);
        if (count == 2 and a.peerCounts().relevant == 2 and rows[0].identify != null and rows[1].identify != null and
            core_test.controlOperations(&a) == 0)
        {
            ready = true;
            break;
        }
    }
    try std.testing.expect(ready);
    const calls = backing_a.allocations;
    const selected = rows[0];
    const other = rows[1];
    const now = try Now.read(std.testing.io);
    try std.testing.expect(a.reStatusPeer(&other.identity, now));
    const unselected = a.peer_manager.control.connections[other.peer.index];
    const before = a.peer_manager.control.connections[selected.peer.index];
    try std.testing.expect(a.reStatusPeer(&selected.identity, now));
    var expected = before;
    expected.status_due_ms = now.millis();
    try std.testing.expectEqualDeep(expected, a.peer_manager.control.connections[selected.peer.index]);
    try std.testing.expectEqualDeep(unselected, a.peer_manager.control.connections[other.peer.index]);
    const result = driver.step(&a, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
    if (result.failure) |err| return err;
    var status_started: usize = 0;
    for (a.peer_manager.control.connections) |op| if (op.request != null and op.protocol == .status_v1) {
        status_started += 1;
    };
    try std.testing.expectEqual(@as(usize, 2), status_started);
    try std.testing.expectEqual(before.identify_state, a.peer_manager.control.connections[selected.peer.index].identify_state);
    const after = a.last_now;
    try std.testing.expect(a.closePeer(&selected.identity, after));
    try std.testing.expect(!a.reStatusPeer(&selected.identity, after));
    try std.testing.expectEqual(@as(u16, 1), a.peerCounts().connected);
    var direct: [2]t.PeerId = undefined;
    const owner: *const NetworkCore = &a;
    try std.testing.expectEqual(@as(usize, 2), try owner.directPeers(&direct));
    try std.testing.expect(a.removeDirectPeer(&selected.identity));
    try std.testing.expect(!a.removeDirectPeer(&selected.identity));
    try std.testing.expectEqual(@as(usize, 1), try owner.directPeers(&direct));
    try std.testing.expectEqual(calls, backing_a.allocations);
    try recycledPeerOperations(&a, &b, &c, &selected);
}

fn recycledPeerOperations(a: *NetworkCore, b: *NetworkCore, c: *NetworkCore, previous: *const t.Snapshot) !void {
    // Fill the spare established slot before requiring the disconnected generation to be reclaimed.
    for (0..2) |attempt| {
        const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{@as(u8, @intCast(34 + attempt))}));
        var replacement: NetworkCore = undefined;
        const opts = options(&key);
        try replacement.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
        defer replacement.deinit(std.testing.io);
        var events: [4]t.Event = undefined;
        _ = a.peer_manager.catalog.pollEvents(&events);
        const start = try Now.read(std.testing.io);
        try a.addDirectPeer(&replacement.peerId(), &.{replacement.transport.localAddress()}, start);
        var current: ?t.Snapshot = null;
        for (0..3000) |_| {
            const now = try Now.read(std.testing.io);
            if (now.millis() - start.millis() > 10_000) break;
            for ([_]*NetworkCore{ a, b, c, &replacement }) |node| {
                const result = driver.step(node, std.testing.io, now, .{ .peers = &events }, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 1)));
                if (result.failure) |err| return err;
            }
            const ref = a.peer_manager.catalog.find(&replacement.peerId()) orelse continue;
            const row = a.peer_manager.catalog.get(ref) orelse continue;
            if (!row.relevant) continue;
            current = row;
            break;
        }
        const selected = current orelse return error.ReplacementNotReady;
        try std.testing.expect(!std.meta.eql(previous.peer, selected.peer));
        if (attempt == 0) {
            try std.testing.expect(a.peer_manager.catalog.get(previous.peer).?.connection == null);
        } else {
            try std.testing.expect(a.peer_manager.catalog.get(previous.peer) == null);
        }
        try std.testing.expect(!a.closePeer(&previous.identity, a.last_now));
        try std.testing.expect(!a.reStatusPeer(&previous.identity, a.last_now));
        try std.testing.expectEqualDeep(selected, a.peer_manager.catalog.get(selected.peer).?);
        try std.testing.expect(a.closePeer(&selected.identity, a.last_now));
        try std.testing.expect(a.removeDirectPeer(&selected.identity));
    }
}

test "application transport borrow authenticates while remote Status remains unavailable" {
    const capability = @import("capabilities.zig");
    const rr = @import("reqresp/root.zig");
    const key_a = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{51}));
    const key_b = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{52}));
    var opts_b = options(&key_b);
    var active: capability.Set = .initEmpty();
    for (0..rr.Protocol.count) |i| {
        const protocol: rr.Protocol = @enumFromInt(i);
        if (protocol == .status_v1 or protocol == .status_v2) continue;
        active.insert(.{ .reqresp = protocol });
    }
    opts_b.resolved.core.protocols.router.capabilities = .{ .receive = active, .request = active };
    var a: NetworkCore = undefined;
    const opts_a = options(&key_a);
    try a.init(std.testing.allocator, std.testing.io, &opts_a.resolved, opts_a.startup);
    defer a.deinit(std.testing.io);
    var b: NetworkCore = undefined;
    try b.init(std.testing.allocator, std.testing.io, &opts_b.resolved, opts_b.startup);
    defer b.deinit(std.testing.io);
    const now = try Now.read(std.testing.io);
    try a.connectUntil(&b.peerId(), &.{b.transport.localAddress()}, now, time.milliseconds(now.millis() +| Dialing.connect_timeout_ms));
    var authenticated = false;
    for (0..300) |_| {
        const tick = try Now.read(std.testing.io);
        const result = driver.step(&a, std.testing.io, tick, .{}, .deadlineOnly(time.optionalMilliseconds(tick.millis() +| 1)));
        if (result.failure) |err| return err;
        for (result.transport_events) |event| if (event == .connected) {
            try std.testing.expect(event.connected.peer_id.eql(&b.peerId()));
            authenticated = true;
        };
        _ = driver.step(&b, std.testing.io, tick, .{}, .deadlineOnly(time.optionalMilliseconds(tick.millis() +| 1)));
    }
    try std.testing.expect(authenticated);
    try std.testing.expectEqual(@as(u16, 1), a.peerCounts().connected);
    try std.testing.expectEqual(@as(u16, 0), a.peerCounts().relevant);
    const peer = a.peer_manager.catalog.get(a.peer_manager.catalog.find(&b.peerId()).?).?;
    try std.testing.expect(peer.connection != null);
    try std.testing.expect(peer.status == null);
}

test "compact peer scores include all 512 occupied disconnected rows" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{1}));
    var opts = options(&key);
    opts.resolved.core.peers.capacity = 512;
    opts.resolved.core.protocols.gossipsub.retained_capacity = 512;
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    const local = node.peerId();
    var events: [2]t.Event = undefined;
    for (0..512) |i| {
        var secret: [32]u8 = @splat(0);
        std.mem.writeInt(u32, secret[28..32], @intCast(i + 2), .big);
        const remote_key = try keys.KeyPair.fromSecretKey(&secret);
        const remote = PeerId.fromPublicKey(&remote_key.publicKey());
        const handle: t.Handle = .{ .index = 0, .generation = @intCast(i + 1) };
        const peer = node.peer_manager.catalog.admit(&remote, &local, handle, &.{ .direction = .outbound, .endpoint = .unspecified, .now_ms = 0 }).admitted.peer;
        try std.testing.expectEqual(@as(u16, @intCast(i)), peer.index);
        _ = node.peer_manager.catalog.report(peer, .fatal, 0);
        try std.testing.expect(node.peer_manager.catalog.disconnect(peer, handle, .host, .{}, Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 })));
        _ = node.peer_manager.catalog.pollEvents(&events);
    }
    const scores = try std.testing.allocator.alloc(NetworkCore.PeerScore, 512);
    defer std.testing.allocator.free(scores);
    try std.testing.expectEqual(@as(usize, 512), try node.peerScores(node.last_now, scores));
    try std.testing.expectEqual(@as(u16, 0), node.peerCounts().connected);
    for (scores, 0..) |score, i| {
        const row = node.peer_manager.catalog.get(node.peer_manager.catalog.find(&score.identity).?).?;
        try std.testing.expectEqual(@as(u16, @intCast(i)), row.peer.index);
        try std.testing.expect(row.connection == null and row.ban_until_ms > 0);
        try std.testing.expectEqual(row.score, score.score);
    }
    try std.testing.expectError(error.OutputTooSmall, node.peerScores(node.last_now, scores[0..511]));
}

test "dual-stack runtime signs both bound discovery and QUIC endpoints" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{25}));
    var opts = options(&key);
    opts.startup.bind = .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } };
    opts.startup.discovery = .{ .bind = opts.startup.bind };
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    const record = node.localRecord().?;
    const quic = node.transport.sockets.localAddresses();
    const decoded = try enr.decode(record, &opts.startup.local.fork);
    try std.testing.expectEqual(@as(u8, 2), decoded.address_count);
    try std.testing.expectEqualDeep(quic[0].?, decoded.addresses[0]);
    try std.testing.expectEqualDeep(quic[1].?, decoded.addresses[1]);
    try std.testing.expectEqual(node.discovery.?.transport.sockets.values[0].?.address.getPort(), record.udp.?);
    try std.testing.expectEqual(node.discovery.?.transport.sockets.values[1].?.address.getPort(), record.udp6.?);
    try std.testing.expectEqualSlices(u8, &quic[0].?.ip4.octets, &record.ip4.?);
    try std.testing.expectEqualSlices(u8, &quic[1].?.ip6.octets, &record.ip6.?);
}

test "core candidate identities do not expose admitted APIs or enlarge score capacity" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{31}));
    const remote = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{32}));
    var node: NetworkCore = undefined;
    const opts = options(&key);
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    const peer = t.PeerId.fromPublicKey(&remote.publicKey());
    const now = node.last_now;
    try node.addDirectPeer(&peer, &.{.{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9001 } }}, now);
    try std.testing.expect(node.peer_manager.catalog.find(&peer) != null);
    try std.testing.expect(!node.isConnected(&peer));
    try std.testing.expect(!node.closePeer(&peer, now));
    try std.testing.expect(!node.reStatusPeer(&peer, now));
    try std.testing.expect(node.reportPeer(&.{ .identity = peer, .action = .fatal }, now) == null);
    try std.testing.expectError(error.StalePeer, node.sendReqRespRequest(&peer, .ping_v1, &.{}, &.{}, .{}, now));
    var scores: [4]NetworkCore.PeerScore = undefined;
    try std.testing.expectEqual(@as(usize, 0), try node.peerScores(now, &scores));
}

test "core discovery config bounds session capacity and idle lifetime" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{41}));
    var opts = options(&key);
    opts.startup.discovery = .{ .bind = .{ .ip4 = .loopback(0) } };
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    const config = node.discovery.?.transport.engine.config;
    try std.testing.expectEqual(discovery.Discovery.discovery_session_capacity, config.session_capacity);
    try std.testing.expectEqual(discovery.Discovery.discovery_session_idle_timeout_ms, config.session_idle_timeout_ms);
    try std.testing.expectEqual(@as(usize, 2_048), config.session_capacity);
    try std.testing.expectEqual(@as(u64, 600_000), config.session_idle_timeout_ms);
}

test "core cancellation releases every selected dial without blaming unstarted peers" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{121}));
    var node: NetworkCore = undefined;
    var opts = options(&key);
    opts.resolved.core.dial.concurrent_max = 3;
    opts.resolved.limits.dialing_max = 3;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    const now = try Now.read(std.testing.io);
    var peers: [3]t.PeerId = undefined;
    for (&peers, 122..) |*peer, seed| {
        const remote = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{@as(u8, @intCast(seed))}));
        peer.* = t.PeerId.fromPublicKey(&remote.publicKey());
        try node.connectUntil(peer, &.{.{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 19003 } }}, now, time.milliseconds(now.millis() + 30_000));
    }
    var faults: FaultIo = .{ .send = .{}, .send_failure = error.Canceled };
    const stopped = driver.step(&node, faults.io(), now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
    try std.testing.expectEqual(error.Canceled, stopped.failure.?);
    try std.testing.expectEqual(@as(u8, 3), stopped.dial_deferred);
    try std.testing.expectEqual(@as(u8, 0), stopped.dial_started);
    try std.testing.expectEqual(@as(u8, 0), stopped.dial_failed);
    try std.testing.expectEqual(@as(usize, 1), faults.send_calls);
    try std.testing.expectEqual(@as(u16, 0), node.peer_manager.dialing.held.total);
    try std.testing.expectEqual(@as(u16, 0), node.peer_manager.dialing.held.unstarted);
    try std.testing.expectEqual(@as(u16, 0), node.transport.engine.registry.active_len);
    var close: [Dialing.attempts_max]t.Handle = undefined;
    try std.testing.expectEqual(@as(usize, 0), node.peer_manager.expireDials(Now.fromMilliseconds(.{ .mono_ms = now.millis() + 10_001, .unix_s = now.unixSeconds() }), &close).len);
    for (peers) |peer| {
        const row = node.peer_manager.catalog.rowFor(node.peer_manager.catalog.find(&peer).?).?;
        try std.testing.expect(row.attempt == null);
        try std.testing.expectEqual(@as(u8, 0), row.dial.failures);
        try std.testing.expectEqual(@as(u8, 0), row.dial.address_index);
        try std.testing.expectEqual(@as(f64, 0), row.reputation.score);
    }
    try std.testing.expectEqual(@as(u64, 0), node.peer_manager.dialing.outcomes[@intFromEnum(t.DialOutcome.expired)]);
}

test "core unreachable destination backs off and rotates to its alternate address" {
    const setup = try std.testing.allocator.create(core_test.Setup);
    defer std.testing.allocator.destroy(setup);
    setup.* = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    const node = &setup.client;
    const now = setup.pair.now;
    const peer = setup.server.peerId();
    try node.connectUntil(&peer, &.{
        .{ .ip6 = .{ .octets = .{0} ** 15 ++ .{1}, .port = 19003 } },
        .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 19003 } },
    }, now, time.milliseconds(now.millis() +| Dialing.connect_timeout_ms));
    const refused = try setup.turn(node, .{});
    try std.testing.expectEqual(@as(u8, 1), refused.dial_failed);
    try std.testing.expectEqual(@as(u8, 0), refused.dial_deferred);
    const row = &node.peer_manager.catalog.rows[0];
    try std.testing.expectEqual(@as(u8, 1), row.dial.failures);
    try std.testing.expectEqual(@as(u8, 1), row.dial.address_index);
    try std.testing.expect(row.attempt == null);
    try std.testing.expect(row.dial.eligible_at_ms >= now.millis() + 1000);
    setup.pair.advance(row.dial.eligible_at_ms - now.millis() - 1);
    const early = try setup.turn(node, .{});
    try std.testing.expectEqual(@as(u8, 0), early.dial_started);
    try std.testing.expect(row.attempt == null);
    setup.pair.advance(1);
    const result = try setup.turn(node, .{});
    try std.testing.expectEqual(@as(u8, 1), result.dial_started);
    try std.testing.expect(node.peer_manager.dialing.active[row.attempt.?].connection != null);
}
