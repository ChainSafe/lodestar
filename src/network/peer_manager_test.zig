const std = @import("std");
const schedule_test_support = @import("schedule_test_support.zig");
const PeerManager = @import("peer_manager.zig").PeerManager;
const t = @import("peers/types.zig");
const control_test_support = @import("peers/control_test_support.zig");
const wire = @import("control_wire.zig");
const rr = @import("reqresp/root.zig");
const Now = @import("types.zig").Now;
const remembered = @import("peers/remembered.zig");
const history = @import("peers/dial_history.zig");
const Dialing = @import("peers/dialing.zig").Dialing;
const Engine = @import("quic/Engine.zig");
const limits = @import("quic/limits.zig");
const Control = @import("peers/control.zig").Control;

const identity: t.PeerId = .{ .bytes = @splat(1) };
const endpoint: t.Address = .{ .ip4 = .{ .octets = .{ 203, 0, 113, 1 }, .port = 9000 } };

const Fixture = struct {
    manager: PeerManager = undefined,
    io: control_test_support.Io = .{},

    fn init(self: *Fixture) !void {
        self.manager = try PeerManager.init(std.testing.allocator, &.{ .bytes = @splat(0) }, &.{}, .{
            .peers = .{ .capacity = 4, .outbound_reserve = 0, .target_peers = 3, .max_peers = 4, .min_outbound = 0 },
            .dial = .{ .capacity = 4, .concurrent_max = 2, .seed = 1 },
        }, .initEmpty(), 4);
        errdefer self.manager.deinit();
        try self.io.init();
    }
    fn deinit(self: *Fixture) void {
        self.io.deinit();
        self.manager.deinit();
    }
};
fn at(ms: u64) Now {
    return Now.fromMilliseconds(.{ .mono_ms = ms, .unix_s = @intCast(1_000 + ms / 1_000) });
}
fn admit(fixture: *Fixture, connection: t.Handle, direction: t.Direction, now: Now) !t.PeerRef {
    const manager = &fixture.manager;
    const admitted = manager.admit(&.{ .conn = connection, .peer_id = identity, .direction = direction }, endpoint, &fixture.io.controlIo(), now) orelse return error.AdmissionRefused;
    return admitted.peer;
}
fn outbound(fixture: *Fixture, now: Now) !t.PeerRef {
    const conn = fixture.io.pair.shared.handles.client;
    const manager = &fixture.manager;
    try manager.connect(&identity, &.{endpoint}, now);
    // Select the operator's already-admitted dial without running gossip or transport. The owner
    // still receives the real started/admitted transitions and records the original dial endpoint.
    var intents: [1]Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), manager.dialing.poll(&manager.catalog, now.millis(), &intents));
    try std.testing.expect(manager.dialStarted(intents[0].token, conn));
    return admit(fixture, conn, .outbound, now);
}
const Probe = struct { request: rr.ReqResp.RequestHandle, conn: t.Handle, protocol: rr.Protocol, after_ready: bool };
fn startProbe(fixture: *Fixture, generation: u32, now: Now) !Probe {
    const manager = &fixture.manager;
    try fixture.io.maintain(&manager.control, &manager.catalog, &manager.local, now);
    const row = &manager.control.connections[manager.catalog.find(&identity).?.index];
    const request = row.request orelse return error.NoProbe;
    try std.testing.expectEqual(generation, request.generation);
    return .{ .request = request, .conn = row.conn, .protocol = row.protocol, .after_ready = row.after_ready };
}
fn reply(fixture: *Fixture, probe: Probe, bytes: []const u8, now: Now) !void {
    const manager = &fixture.manager;
    try fixture.io.reply(&manager.control, &manager.catalog, &manager.local, probe.request, bytes, now);
}
fn qualify(fixture: *Fixture, now: Now) !void {
    const manager = &fixture.manager;
    var bytes: [wire.status_size_max]u8 = undefined;
    const status = try startProbe(fixture, 1, now);
    try std.testing.expectEqual(rr.Protocol.status_v1, status.protocol);
    try reply(fixture, status, bytes[0..try wire.encodeStatus(.status_v1, &manager.local.status, &bytes)], now);
    const metadata = try startProbe(fixture, 2, now);
    try std.testing.expectEqual(rr.Protocol.metadata_v1, metadata.protocol);
    try reply(fixture, metadata, bytes[0..try wire.encodeMetadata(.metadata_v1, &manager.local.metadata, manager.local.fork, &bytes)], now);
}

test "peer owner replacement rejects stale endpoint updates and retirement" {
    var fixture: Fixture = .{};
    try fixture.init();
    defer fixture.deinit();
    const manager = &fixture.manager;
    const conn = fixture.io.pair.shared.handles.client;
    const peer = try admit(&fixture, conn, .inbound, at(10));
    const replacement: t.Handle = .{ .index = 1, .generation = 2 };
    try std.testing.expectEqualDeep(peer, try admit(&fixture, replacement, .outbound, at(20_001)));
    try std.testing.expect(manager.endpointChanged(conn, &.{ .ip4 = .{ .octets = .{ 203, 0, 113, 2 }, .port = 9001 } }, at(20_001)) == null);
    try std.testing.expectEqualDeep(endpoint, manager.catalog.get(peer).?.endpoint);
    try std.testing.expect(manager.retireConnection(peer, conn, .health_error, at(20_001)) == null);
    try std.testing.expectEqual(at(20_001).millis(), schedule_test_support.wakeupMilliseconds(manager.control.schedule(&manager.catalog, at(20_001)), at(20_001).millis()).?);
    try std.testing.expect(manager.catalog.get(peer).?.status == null);

    try std.testing.expectEqual(@as(u64, 0), manager.control.counters.closed[@intFromEnum(t.DisconnectReason.health_error)]);
    try std.testing.expectEqual(@as(u8, 0), manager.catalog.rowFor(peer).?.dial.failures);
}

test "peer owner retires migration into a full inbound source without reputation penalty" {
    var fixture: Fixture = .{};
    try fixture.init();
    defer fixture.deinit();
    const manager = &fixture.manager;
    manager.catalog.options.inbound_per_source_max = 1;
    const conn = fixture.io.pair.shared.handles.client;
    const peer = try admit(&fixture, conn, .inbound, at(10));
    const other_identity: t.PeerId = .{ .bytes = @splat(2) };
    const other_conn: t.Handle = .{ .index = 1, .generation = 1 };
    const other_address: t.Address = .{ .ip4 = .{ .octets = .{ 203, 0, 113, 2 }, .port = 9000 } };
    const other = manager.admit(&.{ .conn = other_conn, .peer_id = other_identity, .direction = .inbound }, other_address, &fixture.io.controlIo(), at(10)).?;
    const retired = manager.endpointChanged(conn, &other_address, at(11)).?;
    try std.testing.expectEqualDeep(peer, retired.peer);
    try std.testing.expectEqualDeep(conn, retired.conn);
    try std.testing.expect(manager.catalog.findConnection(conn) == null);
    try std.testing.expectEqualDeep(other.peer, manager.catalog.findConnection(other_conn).?);
    try std.testing.expectEqual(@as(f64, 0), manager.catalog.get(peer).?.score);
    try std.testing.expectEqual(@as(u64, 0), manager.catalog.rowFor(peer).?.reputation.ban_until_ms);
    try std.testing.expectEqual(@as(u64, 1), manager.control.counters.closed[@intFromEnum(t.DisconnectReason.capacity)]);
    try std.testing.expect(manager.endpointChanged(conn, &other_address, at(12)) == null);
}

test "peer owner qualification clears dial evidence before later proven health" {
    var fixture: Fixture = .{};
    try fixture.init();
    defer fixture.deinit();
    const manager = &fixture.manager;
    const key = manager.catalog.history.endpointKey(&identity, endpoint);
    manager.catalog.history.recordEndpoint(key, .unanswered, 1, 1);
    manager.catalog.history.recordEndpoint(key, .health, 1, 1);
    _ = try outbound(&fixture, at(10));
    try std.testing.expectEqual(@as(u8, 2), manager.catalog.history.strikesFor(key, 1, 10));
    try qualify(&fixture, at(10));
    try std.testing.expectEqual(@as(u8, 1), manager.catalog.history.strikesFor(key, 1, 10));
    const ping = try startProbe(&fixture, 3, at(20_010));
    try std.testing.expectEqual(rr.Protocol.ping_v1, ping.protocol);
    try std.testing.expect(ping.after_ready);
    try reply(&fixture, ping, &@as([8]u8, @splat(0)), at(20_010));
    try std.testing.expectEqual(@as(u8, 0), manager.catalog.history.strikesFor(key, 1, 20_010));
}

test "peer owner retirement preserves remembered and rejection lifetimes and settles once" {
    for ([_]bool{ false, true }) |ready| {
        for ([_]u64{ remembered.qualify_ms - 1, remembered.qualify_ms, history.kept_connection_ms - 1, history.kept_connection_ms }) |lifetime| {
            var fixture: Fixture = .{};
            try fixture.init();
            defer fixture.deinit();
            const manager = &fixture.manager;
            const conn = fixture.io.pair.shared.handles.client;
            const key = manager.catalog.history.identityKey(&identity);
            _ = manager.catalog.history.reject(key, .too_many_peers, 1);
            const peer = try outbound(&fixture, at(10));
            if (ready) try qualify(&fixture, at(10));
            const now = at(10 + lifetime);
            try std.testing.expect(manager.retireConnection(peer, conn, .host, now) != null);
            const failures = manager.catalog.rowFor(peer).?.dial.failures;
            const deadline = manager.catalog.rowFor(peer).?.dial.eligible_at_ms;
            try std.testing.expect(manager.retireConnection(peer, conn, .host, now) == null);
            try std.testing.expect(manager.transportClosed(&.{ .conn = conn, .peer_id = identity, .direction = .outbound, .reason = .{ .peer_closed = .{ .app = true, .code = 0 } } }, 129, now) == null);
            try std.testing.expectEqual(failures, manager.catalog.rowFor(peer).?.dial.failures);
            try std.testing.expectEqual(deadline, manager.catalog.rowFor(peer).?.dial.eligible_at_ms);
            try std.testing.expectEqual(@as(u64, 1), manager.control.counters.closed[@intFromEnum(t.DisconnectReason.host)]);
            var records: [remembered.capacity]remembered.Record = undefined;
            try std.testing.expectEqual(@as(usize, @intFromBool(ready and lifetime >= remembered.qualify_ms)), manager.rememberedPeers(now, &records));
            const block = manager.catalog.history.reject(key, .too_many_peers, now.millis());
            try std.testing.expectEqual(@as(u64, if (ready and lifetime >= history.kept_connection_ms) 5 * 60_000 else 15 * 60_000), block);
        }
    }
}

test "peer owner kept connection clears old rejections before recording its final goodbye once" {
    for ([_]u64{ history.kept_connection_ms - 1, history.kept_connection_ms }) |lifetime| {
        var fixture: Fixture = .{};
        try fixture.init();
        defer fixture.deinit();
        const manager = &fixture.manager;
        const conn = fixture.io.pair.shared.handles.client;
        const key = manager.catalog.history.identityKey(&identity);
        _ = manager.catalog.history.reject(key, .too_many_peers, 1);
        const peer = try outbound(&fixture, at(10));
        try qualify(&fixture, at(10));
        const now = at(10 + lifetime);
        const closed: @FieldType(Engine.Event, "closed") = .{ .conn = conn, .peer_id = identity, .direction = .outbound, .reason = .{ .peer_closed = .{ .app = true, .code = 0 } } };
        try std.testing.expect(manager.transportClosed(&closed, 129, now) != null);
        const block: u64 = if (lifetime >= history.kept_connection_ms) 5 * 60_000 else 15 * 60_000;
        try std.testing.expectEqual(now.millis() + block, manager.catalog.history.rejectedUntil(key, now.millis()));
        try std.testing.expect(manager.transportClosed(&closed, 129, now) == null);
        try std.testing.expect(manager.retireConnection(peer, conn, .remote_goodbye, now) == null);
        try std.testing.expectEqual(now.millis() + block, manager.catalog.history.rejectedUntil(key, now.millis()));
        try std.testing.expectEqual(@as(u64, 1), manager.catalog.rejections[@intFromEnum(t.Rejection.too_many_peers)]);
        try std.testing.expectEqual(@as(u64, 1), manager.control.counters.closed[@intFromEnum(t.DisconnectReason.remote_goodbye)]);
        var records: [remembered.capacity]remembered.Record = undefined;
        try std.testing.expectEqual(@as(usize, 0), manager.rememberedPeers(now, &records));
    }
}

test "peer owner local probe refusal defers without peer evidence" {
    var fixture: Fixture = .{};
    try fixture.init();
    defer fixture.deinit();
    const manager = &fixture.manager;
    const conn = fixture.io.pair.shared.handles.client;
    const peer = try admit(&fixture, conn, .outbound, at(10));
    try std.testing.expect(fixture.io.pair.shared.pair.client.close(conn, 0));
    try fixture.io.maintain(&manager.control, &manager.catalog, &manager.local, at(10));
    try std.testing.expectEqual(@as(u64, 1_010), schedule_test_support.wakeupMilliseconds(manager.control.schedule(&manager.catalog, at(10)), at(10).millis()).?);
    try std.testing.expectEqual(@as(u64, 1), manager.control.counters.deferred);
    try std.testing.expectEqual(@as(u8, 0), manager.catalog.rowFor(peer).?.dial.failures);
    try std.testing.expectEqual(@as(f64, 0), manager.catalog.get(peer).?.score);
    try std.testing.expectEqual(@as(u64, 0), manager.catalog.history.rejectedUntil(manager.catalog.history.identityKey(&identity), 10));
}

test "peer owner shutdown retires published and unqualified connections once in catalog order" {
    var fixture: Fixture = .{};
    try fixture.init();
    defer fixture.deinit();
    const manager = &fixture.manager;
    try std.testing.expect(try manager.addDirectPeer(&identity, &.{endpoint}, at(10)) == null);
    const connections = [_]t.Handle{
        .{ .index = 3, .generation = 1 },
        .{ .index = 0, .generation = 2 },
        .{ .index = 2, .generation = 3 },
    };
    var peers: [connections.len]t.PeerRef = undefined;
    for (connections, 0..) |connection, index| {
        const remote: t.PeerId = .{ .bytes = @splat(@as(u8, @intCast(index + 1))) };
        const admission = manager.admit(&.{ .peer_id = remote, .conn = connection, .direction = .outbound }, endpoint, &fixture.io.controlIo(), at(10)) orelse return error.AdmissionRefused;
        try std.testing.expectEqual(index == 0, admission.direct);
        try std.testing.expect(admission.displaced == null);
        peers[index] = admission.peer;
    }
    try std.testing.expect(manager.catalog.updateStatus(peers[0], connections[0], &manager.local.status, 10));
    var events: [3]t.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), manager.pollEvents(&events));
    try std.testing.expect(events[0] == .ready);
    try std.testing.expect(manager.retireConnection(peers[1], connections[1], .host, at(20)) != null);
    try manager.connect(&.{ .bytes = @splat(4) }, &.{endpoint}, at(20));
    try std.testing.expect(manager.stop());

    var cursor: usize = 0;
    for ([_]usize{ 0, 2 }) |index| {
        const retired = manager.retireNextConnection(&cursor, at(30)) orelse return error.MissingRetirement;
        try std.testing.expectEqualDeep(PeerManager.Retired{ .peer = peers[index], .conn = connections[index] }, retired);
        try std.testing.expect(manager.catalog.findConnection(retired.conn) == null);
        try std.testing.expect(manager.control.connections[retired.peer.index].peer == null);
        try std.testing.expect(manager.retireConnection(retired.peer, retired.conn, .shutdown, at(30)) == null);
    }
    try std.testing.expect(manager.retireNextConnection(&cursor, at(30)) == null);
    try std.testing.expectEqual(manager.catalog.rows.len, cursor);
    try std.testing.expect(manager.retireNextConnection(&cursor, at(30)) == null);
    try std.testing.expectEqual(@as(u16, 0), manager.peerCounts().connected);
    try std.testing.expectEqual(@as(u64, 2), manager.control.counters.closed[@intFromEnum(t.DisconnectReason.shutdown)]);
    try std.testing.expectEqual(@as(usize, 3), manager.pollEvents(&events));
    for (events, 0..) |event, index| {
        try std.testing.expectEqualDeep(connections[index], event.closed.connection);
        try std.testing.expectEqual(if (index == 1) t.DisconnectReason.host else .shutdown, event.closed.reason);
    }
    try std.testing.expectEqual(@as(usize, 0), manager.pollEvents(&events));
    var direct: [4]t.PeerId = undefined;
    try std.testing.expectEqual(@as(usize, 1), try manager.directPeers(&direct));
    try std.testing.expectEqualDeep(identity, direct[0]);
}

fn exhaustStreams(fixture: *Fixture, conn: t.Handle) !void {
    const engine = &fixture.io.pair.shared.pair.client;
    for (0..limits.peer_streams_bidi) |_| {
        const stream = engine.openStream(conn) catch |err| switch (err) {
            error.StreamLimit => return,
            else => return err,
        };
        _ = try engine.write(stream, "x", false);
    }
    try std.testing.expectError(error.StreamLimit, engine.openStream(conn));
}

fn receiveStatus(fixture: *Fixture, conn: t.Handle, now: Now) !void {
    const manager = &fixture.manager;
    var bytes: [wire.status_size_max]u8 = undefined;
    const len = try wire.encodeStatus(.status_v1, &manager.local.status, &bytes);
    fixture.io.receive(&manager.control, &manager.catalog, &manager.local, .{ .request = .{
        .request = .{ .index = 0, .generation = 1, .direction = .inbound },
        .conn = conn,
        .protocol = .status_v1,
        .bytes = bytes[0..len],
    } }, now, 0);
}

test "peer owner qualification deadline survives unsolicited Status and an active request" {
    for ([_]t.Direction{ .inbound, .outbound }) |direction| {
        var fixture: Fixture = .{};
        try fixture.init();
        defer fixture.deinit();
        const manager = &fixture.manager;
        const conn = fixture.io.pair.shared.handles.client;
        const peer = try admit(&fixture, conn, direction, at(10));
        const deadline = 10 + manager.control.options.qualification_timeout_ms;
        try receiveStatus(&fixture, conn, at(10));
        try fixture.io.maintain(&manager.control, &manager.catalog, &manager.local, at(10));
        const row = &manager.control.connections[peer.index];
        try std.testing.expect(row.request != null);
        try std.testing.expectEqual(rr.Protocol.metadata_v1, row.protocol);
        try receiveStatus(&fixture, conn, at(deadline - 1));
        try fixture.io.maintain(&manager.control, &manager.catalog, &manager.local, at(deadline - 1));
        try std.testing.expect(manager.catalog.get(peer).?.disconnect_reason == null);
        try std.testing.expectEqual(deadline, schedule_test_support.wakeupMilliseconds(manager.control.schedule(&manager.catalog, at(deadline - 1)), deadline - 1).?);
        try fixture.io.maintain(&manager.control, &manager.catalog, &manager.local, at(deadline));
        const snapshot = manager.catalog.get(peer).?;
        try std.testing.expectEqual(t.DisconnectReason.count_pruning, snapshot.disconnect_reason.?);
        try std.testing.expectEqual(@as(f64, 0), snapshot.score);
        try std.testing.expectEqual(@as(u64, 0), snapshot.ban_until_ms);
    }
}

test "peer owner qualification expires without Status even below the peer target" {
    var fixture: Fixture = .{};
    try fixture.init();
    defer fixture.deinit();
    const manager = &fixture.manager;
    const conn = fixture.io.pair.shared.handles.client;
    const peer = try admit(&fixture, conn, .inbound, at(0));
    try fixture.io.maintain(&manager.control, &manager.catalog, &manager.local, at(manager.control.options.qualification_timeout_ms));
    try std.testing.expectEqual(t.DisconnectReason.count_pruning, manager.catalog.get(peer).?.disconnect_reason.?);
    const deadline = manager.control.connections[peer.index].closing.?.deadline_ms;
    var closes: [4]Control.Close = undefined;
    const closed = manager.control.maintain(&manager.catalog, &manager.local, &fixture.io.controlIo(), &fixture.io.handler, at(deadline), &closes);
    try std.testing.expectEqual(@as(usize, 1), closed.len);
    try std.testing.expectEqual(conn, closed[0].conn);
    try std.testing.expectEqual(t.DisconnectReason.count_pruning, closed[0].reason);
}

test "peer owner remote stream credit starvation becomes a health failure" {
    var fixture: Fixture = .{};
    try fixture.init();
    defer fixture.deinit();
    const manager = &fixture.manager;
    const peer = try outbound(&fixture, at(10));
    try qualify(&fixture, at(10));
    const row = &manager.control.connections[peer.index];
    try exhaustStreams(&fixture, row.conn);
    var now = row.ping_due_ms;
    for (0..manager.control.options.health_failures_max) |failure| {
        try fixture.io.maintain(&manager.control, &manager.catalog, &manager.local, at(now));
        try std.testing.expect(row.request == null);
        try std.testing.expectEqual(@as(u16, 0), fixture.io.pair.shared.client.control_reqresp.pendingCounts().outbound);
        now += manager.control.options.probe_start_timeout_ms;
        try receiveStatus(&fixture, row.conn, at(now - 1));
        try fixture.io.maintain(&manager.control, &manager.catalog, &manager.local, at(now - 1));
        try std.testing.expectEqual(failure, manager.control.counters.health_failures[@intFromEnum(Control.HealthProbe.ping)]);
        try fixture.io.maintain(&manager.control, &manager.catalog, &manager.local, at(now));
        try std.testing.expectEqual(failure + 1, manager.control.counters.health_failures[@intFromEnum(Control.HealthProbe.ping)]);
        now += manager.control.options.failure_retry_ms;
    }
    try std.testing.expectEqual(t.DisconnectReason.health_timeout, manager.catalog.get(peer).?.disconnect_reason.?);
}

test "peer owner local request slot pressure does not count as remote probe failure" {
    var fixture: Fixture = .{};
    try fixture.init();
    defer fixture.deinit();
    const manager = &fixture.manager;
    const peer = try outbound(&fixture, at(10));
    try qualify(&fixture, at(10));
    const row = &manager.control.connections[peer.index];
    const requests = &fixture.io.pair.shared.client.control_reqresp;
    requests.options.outbound_per_connection_max = 1;
    const io = fixture.io.controlIo();
    var sink: [wire.status_size_max]u8 = undefined;
    const occupied = try requests.request(io.engine, io.router, row.conn, .ping_v1, &@as([8]u8, @splat(0)), &sink, .{}, at(row.ping_due_ms));
    const first = row.ping_due_ms;
    for ([_]u64{ first, first + 10_000, first + 30_000, first + 60_000 }) |now| {
        try fixture.io.maintain(&manager.control, &manager.catalog, &manager.local, at(now));
        try std.testing.expect(row.request == null);
        try std.testing.expect(row.stream_blocked_since_ms == null);
        try std.testing.expectEqual(@as(u64, 0), manager.control.counters.health_failures[@intFromEnum(Control.HealthProbe.ping)]);
        try std.testing.expect(manager.catalog.get(peer).?.disconnect_reason == null);
    }
    try std.testing.expect(requests.abandon(io.engine, io.router, occupied, at(first + 60_000)) == null);
    try fixture.io.maintain(&manager.control, &manager.catalog, &manager.local, at(row.retry_ms));
    try std.testing.expect(row.request != null);
}
