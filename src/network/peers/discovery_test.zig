const advertisement = @import("../advertisement.zig");
const std = @import("std");
const schedule_test_support = @import("../schedule_test_support.zig");
const d = @import("discv5");
const adapter = @import("enr.zig");
const discovery = @import("discovery.zig");
const types = @import("types.zig");
const context = types.ForkContext{ .digest = .{ 1, 2, 3, 4 } };
const Sockets = @import("udp").Sockets;
const fault_io = @import("fault_io");

const support = @import("discovery_test_support.zig");
const Node = support.Node;
const handoff = support.handoff;
const Network = @import("discovery_test_network.zig");

test "peer discovery seeds the configured list without claiming reachability or starting walks" {
    var network: Network = .{};
    const io = network.io();
    var records: [17]d.identity.enr.Record = undefined;
    for (&records, 2..) |*record, index| {
        const scalar: u8 = @intCast(index);
        const key = try d.identity.crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{scalar}));
        record.* = try d.identity.enr.Record.create(&key, 1, .{ .ip4 = .{ .octets = .{ 203, scalar, 1, 1 }, .port = 9000 } });
    }
    const now = try d.Transport.monotonicMilliseconds(io);
    var owner: discovery.Discovery = undefined;
    var sockets = try Sockets.bind(io, .{ .ip4 = .loopback(0) });
    var sockets_owned = true;
    defer if (sockets_owned) sockets.close(io);
    const key = try d.identity.crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{1}));
    const local_record = try d.identity.enr.Record.create(&key, 1, sockets.localAddress());
    try owner.initBound(std.testing.allocator, sockets, &key, &local_record, &context, &records, now, .{}, .{ .session_capacity = 8, .challenge_capacity = 8, .call_capacity = 8 });
    sockets_owned = false;
    defer owner.deinit(io);
    const controller = &owner;
    try std.testing.expectEqual(records.len, owner.transport.engine.peerCount());
    for (&records) |*record| {
        const entry = owner.transport.engine.peerRecord(&record.node_id).?;
        try std.testing.expect(entry.last_verified_ms == null);
        try std.testing.expectEqualDeep(record.*, entry.record);
    }
    const idle = try support.advance(controller, io, now, &.{});
    if (idle.failure) |failure| return failure.cause;
    try std.testing.expectEqual(@as(usize, 0), owner.transport.engine.calls.count());
    try std.testing.expectEqual(@as(u64, 0), controller.counters.lookups_started);
    var output: [1280]u8 = undefined;
    var entropy: d.Engine.StartEntropy = undefined;
    try std.Io.randomSecure(io, std.mem.asBytes(&entropy));
    try std.testing.expect((try controller.maintenance.startNext(&owner.transport.engine, &output, try .init(&.{1}), now + 600_000, &entropy)) == null);
    try std.testing.expectEqual(@as(usize, 0), owner.transport.engine.calls.count());
}

test "peer discovery counts selected observation probes but not ordinary matched PONGs" {
    var network: Network = .{};
    const io = network.io();
    var remote: Node = undefined;
    try remote.init(io, 2, 9002, &.{});
    defer remote.deinit();
    var local: Node = undefined;
    try local.init(io, 1, 9001, &.{
        .bootstrap = &.{remote.transport.engine.localRecord().*},
        .discovery = .{ .observations = .{ .{ .enabled = true }, .{} } },
    });
    defer local.deinit();
    const peer: d.types.Endpoint = .{
        .node_id = remote.transport.engine.localRecord().node_id,
        .address = remote.transport.localAddress(),
    };
    const probe_ms = local.owner.maintenance.config.probe_interval_ms;
    for (0..3) |phase| {
        network.now_ms = if (phase == 0) 0 else probe_ms + phase - 1;
        if (phase != 1) {
            _ = try local.transport.startCall(io, peer, remote.transport.engine.localRecord(), &.{ .ping = .{
                .request_id = try .init(&.{@intCast(phase + 1)}),
                .enr_sequence = local.transport.engine.localRecord().sequence,
            } }, network.now_ms);
        } else {
            const result = try support.advance(&local.owner, io, network.now_ms, &.{});
            if (result.failure) |failure| return failure.cause;
            try std.testing.expectEqual(@as(usize, 1), local.transport.engine.calls.count());
            try std.testing.expect(!local.owner.storage.observations.canProbe(&peer, network.now_ms));
        }
        for (0..100) |_| {
            const response = try support.advance(&remote.owner, io, network.now_ms, &.{});
            if (response.failure) |failure| return failure.cause;
            const result = try support.advance(&local.owner, io, network.now_ms, &.{});
            if (result.failure) |failure| return failure.cause;
            if (local.transport.engine.calls.count() == 0) break;
        }
        try std.testing.expectEqual(@as(usize, 0), local.transport.engine.calls.count());
        try std.testing.expectEqual(@as(usize, if (phase == 0) 0 else 1), local.owner.storage.observations.count(0, network.now_ms));
    }
    try std.testing.expectEqual(@as(usize, 0), local.owner.storage.observations.count(0, probe_ms + d.AddressVotes.lifetime_ms));
}

test "peer discovery answers unknown TALK protocols without demand or candidate output" {
    var network: Network = .{};
    const io = network.io();
    var requester: Node = undefined;
    try requester.init(io, 31, 9031, &.{});
    defer requester.deinit();
    var responder: Node = undefined;
    try responder.init(io, 32, 9032, &.{});
    defer responder.deinit();
    const controller = &responder.owner;
    var expiries: [d.CallTable.capacity_max]d.CallTable.Expired = undefined;
    for ([_][]const u8{ "portal/test", "" }, 0..) |protocol, index| {
        const request_id = try d.wire.message.RequestId.init(&.{@intCast(index + 1)});
        const request: d.wire.message.Message = .{ .talk_request = .{
            .request_id = request_id,
            .protocol = protocol,
            .request = "unsupported application data",
        } };
        const handle = try requester.transport.startCall(io, .{
            .node_id = responder.transport.engine.localRecord().node_id,
            .address = responder.transport.localAddress(),
        }, responder.transport.engine.localRecord(), &request, try d.Transport.monotonicMilliseconds(io));
        var completed = false;
        for (0..100) |_| {
            const tick = try d.Transport.monotonicMilliseconds(io);
            const result = try support.advance(controller, io, tick, &.{});
            if (result.failure) |failure| return failure.cause;
            try std.testing.expectEqual(@as(usize, 0), result.candidates);
            const received = try d.driver.step(requester.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, tick) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
            if (received.failure) |failure| return failure.cause;
            if (received.event == .response) {
                const response = received.event.response.matched;
                try std.testing.expectEqual(handle, response.handle);
                try std.testing.expect(response.terminal);
                try std.testing.expectEqualDeep(request_id, response.response.talk_response.request_id);
                try std.testing.expectEqual(@as(usize, 0), response.response.talk_response.response.len);
                completed = true;
                break;
            }
        }
        try std.testing.expect(completed);
        try std.testing.expectEqual(@as(usize, 0), requester.transport.engine.calls.count());
    }
}

test "peer discovery refused TALK reply fails only its destination and preserves call expiry progress" {
    var network: Network = .{};
    const io = network.io();
    var requester: Node = undefined;
    try requester.init(io, 33, 9033, &.{});
    defer requester.deinit();
    var responder: Node = undefined;
    try responder.init(io, 34, 9034, &.{});
    defer responder.deinit();
    const now = try d.Transport.monotonicMilliseconds(io);
    const from: d.types.Endpoint = .{ .node_id = requester.transport.engine.localRecord().node_id, .address = requester.transport.localAddress() };
    const to: d.types.Endpoint = .{ .node_id = responder.transport.engine.localRecord().node_id, .address = responder.transport.localAddress() };
    const session: d.SessionStore.Session = .{ .read_key = @splat(7), .write_key = @splat(7) };
    requester.transport.engine.channel.sessions.install(to, &session, now);
    responder.transport.engine.channel.sessions.install(from, &session, now);
    const controller = &responder.owner;
    const request: d.wire.message.Message = .{ .talk_request = .{
        .request_id = try d.wire.message.RequestId.init(&.{1}),
        .protocol = "unknown",
        .request = &.{},
    } };
    _ = try requester.transport.startCall(io, to, responder.transport.engine.localRecord(), &request, try d.Transport.monotonicMilliseconds(io));
    const expired = try responder.transport.engine.calls.begin(from, &requester.transport.engine.localRecord().public_key, &request, now, d.wire.constants.ordinary_plaintext_size_max);
    var host: SendFailure = .{ .base = io, .receive_enabled = true };
    const result = try support.advance(controller, host.io(), now, &.{});
    if (result.failure) |failure| return failure.cause;
    try std.testing.expectEqual(@as(usize, 1), host.sends);
    try std.testing.expectEqual(@as(usize, 0), result.candidates);
    try std.testing.expect(responder.transport.engine.calls.endpoint(expired) == null);
}

test "peer discovery publishes signed referrals before their discovery endpoint responds" {
    try referralCase(null, false);
}

test "peer discovery referrals retain fork demand endpoint and output bounds" {
    for ([_]discovery.Discovery.Rejection{ .incompatible_fork, .demand, .endpoint_scope, .no_quic, .output_capacity }) |reason| {
        try referralCase(reason, false);
    }
}

test "peer discovery retains absent custody advertisements for conservative Fulu discovery" {
    try referralCase(null, true);
}

fn referralCase(rejection: ?discovery.Discovery.Rejection, custody_only: bool) !void {
    var network: Network = .{};
    const io = network.io();
    var b: Node = undefined;
    try b.init(io, 2, 9002, &.{});
    defer b.deinit();
    var c: Node = undefined;
    try c.init(io, 7, if (rejection == .no_quic) null else if (rejection == .endpoint_scope) 1024 else 9003, &.{});
    defer c.deinit();
    const now = try d.Transport.monotonicMilliseconds(io);
    const b_peer: d.types.Endpoint = .{ .node_id = b.transport.engine.localRecord().node_id, .address = b.transport.localAddress() };
    const c_peer: d.types.Endpoint = .{ .node_id = c.transport.engine.localRecord().node_id, .address = c.transport.localAddress() };
    _ = try b.transport.engine.confirmPeer(&c_peer, c.transport.engine.localRecord(), now);
    var fork = context;
    if (custody_only) {
        fork.fork = .fulu;
        fork.custody_requirement = 4;
    }
    if (rejection == .incompatible_fork) fork.digest[0] = 9;
    var a: Node = undefined;
    try a.init(io, 1, 9001, &.{ .fork = fork });
    defer a.deinit();
    _ = try a.transport.engine.confirmPeer(&b_peer, b.transport.engine.localRecord(), now);
    const controller = &a.owner;
    try controller.request(if (rejection == .demand) .{ .syncnets = 1 } else if (custody_only) .{ .custody = true } else .{ .general = true });
    const seed = a.transport.engine.peerRecord(&b_peer.node_id).?;
    var lookup: d.Lookup = undefined;
    try lookup.init(&controller.storage.candidates, a.transport.engine.localRecord().node_id, c_peer.node_id, &.{seed}, .dual);
    controller.lookup = lookup;
    var output: [16]adapter.Candidate = undefined;
    var expiries: [d.CallTable.capacity_max]d.CallTable.Expired = undefined;
    var found: ?adapter.Candidate = null;
    for (0..100) |_| {
        const tick = try d.Transport.monotonicMilliseconds(io);
        const result = try support.advance(controller, io, tick, output[0..if (rejection == .output_capacity) @as(usize, 0) else output.len]);
        if (result.failure) |failure| return failure.cause;
        const remote = try d.driver.step(b.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, tick) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
        if (remote.failure) |failure| return failure.cause;
        for (output[0..result.candidates]) |candidate| {
            if (std.mem.eql(u8, &candidate.node_id, &c_peer.node_id)) found = candidate;
        }
        if (found != null or (if (rejection) |reason| controller.rejections[@intFromEnum(reason)] > 0 else false)) break;
    }
    try std.testing.expect(a.transport.engine.peerRecord(&c_peer.node_id) == null);
    if (rejection) |reason| {
        try std.testing.expect(found == null);
        try std.testing.expect(controller.rejections[@intFromEnum(reason)] > 0);
        return;
    }
    try std.testing.expect(found != null);
    if (custody_only) try std.testing.expect(found.?.hints.custody_group_count == null);
    _ = try d.driver.step(a.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, now) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
    try adapter.requireIdentity(c.transport.engine.localRecord(), &found.?.peer);
    try std.testing.expectEqual(@as(u16, 9003), found.?.addresses[0].port());
    try handoff(&found.?);
}

test "peer discovery publishes authenticated lookup responders outside a full routing bucket" {
    var network: Network = .{};
    const io = network.io();
    var b: Node = undefined;
    try b.init(io, 2, 9002, &.{});
    defer b.deinit();
    const now = try d.Transport.monotonicMilliseconds(io);
    var a: Node = undefined;
    try a.init(io, 1, 9001, &.{ .discovery = .{ .query_interval_ms = 1, .local_retry_ms = 1 } });
    defer a.deinit();
    try fillResponderBucket(&a.transport.engine, b.transport.engine.localRecord(), now);
    const controller = &a.owner;
    try controller.request(.{ .general = true });
    const seed: d.RoutingTable.Entry = .{
        .direction = .outgoing,
        .peer = .{ .node_id = b.transport.engine.localRecord().node_id, .address = b.transport.localAddress() },
        .record = b.transport.engine.localRecord().*,
        .last_verified_ms = null,
    };
    var lookup: d.Lookup = undefined;
    try lookup.init(&controller.storage.candidates, a.transport.engine.localRecord().node_id, seed.peer.node_id, &.{seed}, .dual);
    controller.lookup = lookup;

    var output: [1]adapter.Candidate = undefined;
    var expiries: [d.CallTable.capacity_max]d.CallTable.Expired = undefined;
    var checked = false;
    for (0..300) |_| {
        const tick = try d.Transport.monotonicMilliseconds(io);
        const result = try support.advance(controller, io, tick, &output);
        if (result.failure) |failure| return failure.cause;
        const remote = try d.driver.step(b.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, tick) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
        if (remote.failure) |failure| return failure.cause;
        const progress = try d.driver.step(a.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, tick) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
        if (progress.failure) |failure| return failure.cause;
        const selected = progress.event == .response and progress.event.response.matched.terminal and
            progress.event.response.matched.response == .nodes;
        const consumed = controller.consume(&progress, expiries[0..progress.calls_expired], &output);
        if (consumed.failure) |failure| return failure.cause;
        if (selected) {
            try std.testing.expect(a.transport.engine.peerRecord(&b.transport.engine.localRecord().node_id) == null);
            try std.testing.expectEqual(@as(usize, 1), consumed.candidates);
            try adapter.requireIdentity(b.transport.engine.localRecord(), &output[0].peer);
            try std.testing.expectEqual(@as(u16, 9002), output[0].addresses[0].port());
            checked = true;
            break;
        }
    }
    try std.testing.expect(checked);
}

fn fillResponderBucket(engine: *d.Engine, responder: *const d.identity.enr.Record, now_ms: u64) !void {
    try std.testing.expect(engine.peerRecord(&responder.node_id) == null);
    try std.testing.expect(d.types.logDistance(&engine.localRecord().node_id, &responder.node_id) > 8);
    for (1..d.RoutingTable.bucket_size + 1) |index| {
        var record = std.mem.zeroes(d.identity.enr.Record);
        record.node_id = responder.node_id;
        record.node_id[31] ^= @intCast(index);
        record.ip4 = .{ 10, @intCast(index), 0, 1 };
        record.udp = 19_000;
        const peer: d.types.Endpoint = .{ .node_id = record.node_id, .address = record.endpoint().? };
        try std.testing.expectEqual(d.RoutingTable.PutResult.inserted, try engine.confirmPeer(&peer, &record, now_ms));
    }
}

test "peer discovery reserves output for the responder alongside a full referral batch" {
    var network: Network = .{};
    const io = network.io();
    var b: Node = undefined;
    try b.init(io, 2, 9002, &.{});
    defer b.deinit();
    const now = try d.Transport.monotonicMilliseconds(io);
    const peer: d.types.Endpoint = .{ .node_id = b.transport.engine.localRecord().node_id, .address = b.transport.localAddress() };
    var records: [d.types.findnode_result_max]d.identity.enr.Record = undefined;
    var raw: [records.len][]const u8 = undefined;
    for (&records, &raw, 3..) |*record, *bytes, scalar| {
        const key = try d.identity.crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{@as(u8, @intCast(scalar))}));
        record.* = try adapter.build(&key, 1, &.{ .fork = .{ .digest = context.digest, .next_version = @splat(0), .next_epoch = std.math.maxInt(u64) }, .ip4 = .{ 127, 0, 0, 1 }, .udp = 9000, .quic = 9001 }, &context);
        bytes.* = record.slice();
    }
    var output: [discovery.Discovery.candidates_per_step]adapter.Candidate = undefined;
    try std.testing.expectEqual(records.len + 1, output.len);
    for ([_]usize{ 0, 1, records.len, output.len }) |capacity| {
        for ([_]bool{ false, true }) |terminal| {
            var a: Node = undefined;
            try a.init(io, 1, 9001, &.{});
            defer a.deinit();
            _ = try a.transport.engine.confirmPeer(&peer, b.transport.engine.localRecord(), now);
            const seed = a.transport.engine.peerRecord(&peer.node_id).?;
            const controller = &a.owner;
            try controller.request(.{ .general = true });
            var lookup: d.Lookup = undefined;
            try lookup.init(&controller.storage.candidates, a.transport.engine.localRecord().node_id, peer.node_id, &.{seed}, .dual);
            var packet: [1280]u8 = undefined;
            var entropy: d.Engine.StartEntropy = undefined;
            try std.Io.randomSecure(io, std.mem.asBytes(&entropy));
            const id = try d.wire.message.RequestId.init(&.{1});
            const started = (try lookup.startNext(&a.transport.engine, &packet, id, now, &entropy)).?;
            defer _ = a.transport.engine.cancelCall(started.call.handle);
            controller.lookup = lookup;
            const progress: d.Transport.AdvanceResult = .{ .now_ms = now, .event = .{ .response = .{
                .peer = peer,
                .matched = .{ .handle = started.call.handle, .response = .{ .nodes = .{ .request_id = id, .total = if (terminal) 1 else 2, .enrs = &raw } }, .terminal = terminal },
                .record = null,
                .node_records = &records,
            } } };
            const result = controller.consume(&progress, &.{}, output[0..capacity]);
            if (result.failure) |failure| return failure.cause;
            const responders: usize = @intFromBool(terminal);
            const published = @min(capacity, records.len + responders);
            try std.testing.expectEqual(published, result.candidates);
            try std.testing.expectEqual(records.len + responders - published, controller.rejections[@intFromEnum(discovery.Discovery.Rejection.output_capacity)]);
            if (capacity > 0 and terminal) try adapter.requireIdentity(b.transport.engine.localRecord(), &output[0].peer);
            if (capacity == output.len) {
                for (records, output[responders..published]) |record, candidate| {
                    try std.testing.expectEqualSlices(u8, &record.node_id, &candidate.node_id);
                }
                try support.admitBatch(output[0..published]);
            }
        }
    }
}

test "peer discovery clears an active foreground walk when demand ends and can restart" {
    {
        var network: Network = .{};
        const io = network.io();
        var b: Node = undefined;
        try b.init(io, 62, 9062, &.{});
        defer b.deinit();
        var a: Node = undefined;
        try a.init(io, 61, 9061, &.{ .bootstrap = &.{b.transport.engine.localRecord().*} });
        defer a.deinit();
        const controller = &a.owner;
        try controller.request(.{ .general = true });
        var candidates: [discovery.Discovery.candidates_per_step]adapter.Candidate = undefined;
        var expiries: [d.CallTable.capacity_max]d.CallTable.Expired = undefined;
        var confirmed = false;
        for (0..100) |_| {
            const result = try support.advance(controller, io, network.now_ms, &candidates);
            if (result.failure) |failure| return failure.cause;
            const remote = try d.driver.step(b.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, network.now_ms) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
            if (remote.failure) |failure| return failure.cause;
            if (result.candidates > 0) {
                confirmed = true;
                break;
            }
        }
        try std.testing.expect(confirmed);
        try controller.request(.{});
        network.now_ms = 2_000;
        try controller.request(.{ .attnets = .{1} ++ .{0} ** 7 });
        _ = try support.advance(controller, io, network.now_ms, &candidates);
        try std.testing.expect(controller.lookup != null and controller.lookup.?.waitingCount() > 0);
        const waiting = controller.lookup.?.waitingCount();
        const count = a.transport.engine.calls.count();
        const background = controller.maintenance.pending;
        network.now_ms += 1;
        try controller.request(.{});
        try std.testing.expect(controller.lookup == null);
        try std.testing.expect(a.transport.engine.calls.count() <= count - waiting);
        try std.testing.expectEqualDeep(background, controller.maintenance.pending);
        try std.testing.expect(!controller.stopped);
        network.now_ms = 4_000;
        try controller.request(.{ .general = true });
        _ = try support.advance(controller, io, network.now_ms, &candidates);
        try std.testing.expect(controller.lookup != null and controller.lookup.?.waitingCount() > 0);
    }
}

test "peer discovery empty lookup backs off and counts completion once" {
    var network: Network = .{ .now_ms = 10 };
    const io = network.io();
    var a: Node = undefined;
    try a.init(io, 1, 9001, &.{ .discovery = .{ .maintenance = .{
        .probe_interval_ms = 100_000,
        .stale_after_ms = 100_000,
        .retry_interval_ms = 100_000,
    } } });
    defer a.deinit();
    const controller = &a.owner;
    try controller.request(.{ .general = true });
    var host: SendFailure = .{ .base = io, .receive_failure = error.Timeout };
    var out: [1]adapter.Candidate = undefined;
    for ([_]u64{ 2_000, 4_000, 8_000 }, 1..) |delay, completed| {
        const result = try support.advance(controller, host.io(), network.now_ms, &out);
        try std.testing.expect(result.failure == null);
        try std.testing.expectEqual(@as(usize, 0), result.candidates);
        const deadline = network.now_ms + delay;
        try std.testing.expectEqual(@as(?u64, deadline), schedule_test_support.wakeupMilliseconds(controller.schedule(), network.now_ms));
        try std.testing.expectEqual(completed, controller.lookup_finishes[@intFromEnum(d.Lookup.FinishReason.exhausted)]);
        try std.testing.expectEqual(completed, controller.counters.lookup_time.count);
        network.now_ms = deadline - 1;
        _ = try support.advance(controller, host.io(), network.now_ms, &out);
        try std.testing.expectEqual(completed, controller.counters.lookups_started);
        try std.testing.expectEqual(completed, controller.lookup_finishes[@intFromEnum(d.Lookup.FinishReason.exhausted)]);
        network.now_ms = deadline;
    }
    try std.testing.expectEqual(@as(u64, 0), controller.counters.candidates_published);
    try std.testing.expectEqual(@as(u128, 0), controller.counters.lookup_time.sum);
    try std.testing.expectEqual(@as(usize, 0), host.sends);
}

test "peer discovery counts every rejected datagram by reason" {
    var network: Network = .{ .now_ms = 10 };
    const io = network.io();
    var node: Node = undefined;
    try node.init(io, 41, 9041, &.{});
    defer node.deinit();
    const controller = &node.owner;
    var out: [1]adapter.Candidate = undefined;
    _ = controller.consume(&.{ .now_ms = 10, .datagram = .accepted }, &.{}, &out);
    _ = controller.consume(&.{ .now_ms = 11, .datagram = .{ .rejected = .unsolicited_response } }, &.{}, &out);
    _ = controller.consume(&.{ .now_ms = 12, .datagram = .{ .rejected = .unsolicited_response } }, &.{}, &out);
    _ = controller.consume(&.{ .now_ms = 13 }, &.{}, &out);
    try std.testing.expectEqual(@as(u64, 2), controller.datagram_rejections[@intFromEnum(d.types.RejectReason.unsolicited_response)]);
    for ([_]d.types.RejectReason{ .admission_limited, .record_admission_limited }) |reason| {
        _ = controller.consume(&.{ .now_ms = 14, .datagram = .{ .rejected = reason } }, &.{}, &out);
        try std.testing.expectEqual(@as(u64, 1), controller.datagram_rejections[@intFromEnum(reason)]);
    }
    var rejected: u64 = 0;
    for (controller.datagram_rejections) |count| rejected += count;
    try std.testing.expectEqual(@as(u64, 4), rejected);
}

test "peer discovery QUIC relay checks reject public to private and unscoped IPv6" {
    const public: d.types.Address = .{ .ip4 = .{ .octets = .{ 8, 8, 8, 8 }, .port = 9000 } };
    const local: d.types.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9000 } };
    for ([_][4]u8{ .{ 127, 0, 0, 1 }, .{ 10, 0, 0, 1 }, .{ 100, 64, 0, 1 }, .{ 169, 254, 0, 1 }, .{ 0, 0, 0, 0 }, .{ 224, 0, 0, 1 } }) |ip| {
        try std.testing.expect(!discovery.relayAllowed(public, .{ .ip4 = .{ .octets = ip, .port = 9001 } }));
    }
    try std.testing.expect(discovery.relayAllowed(local, .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9001 } }));
    try std.testing.expect(!discovery.relayAllowed(public, .{ .ip4 = .{ .octets = .{ 8, 8, 4, 4 }, .port = 1024 } }));
    const link: [16]u8 = .{ 0xfe, 0x80 } ++ .{0} ** 13 ++ .{1};
    try std.testing.expect(!discovery.relayAllowed(.{ .ip6 = .{ .octets = link, .port = 9000 } }, .{ .ip6 = .{ .octets = link, .port = 9001 } }));
    const mapped: [16]u8 = .{0} ** 10 ++ .{ 0xff, 0xff, 127, 0, 0, 1 };
    try std.testing.expect(!discovery.relayAllowed(public, .{ .ip6 = .{ .octets = mapped, .port = 9001 } }));
}

test "peer discovery consumes actual response and expiry alongside failure before borrowed scratch reuse" {
    var network: Network = .{};
    const io = network.io();
    var b: Node = undefined;
    try b.init(io, 2, 9002, &.{});
    defer b.deinit();
    const now = try d.Transport.monotonicMilliseconds(io);
    var a: Node = undefined;
    try a.init(io, 1, 9001, &.{ .bootstrap = &.{b.transport.engine.localRecord().*} });
    defer a.deinit();
    const controller = &a.owner;
    try controller.request(.{ .general = true });
    var output: [1]adapter.Candidate = undefined;
    _ = try support.advance(controller, io, now, &output);
    const active = a.transport.engine.calls.count();
    try std.testing.expectEqual(@as(usize, 1), active);
    var stale = controller.storage.candidates[0].state.waiting;
    stale.generation += 1;
    const stale_result = controller.consume(&.{ .now_ms = now, .event = .{ .failed = .{ .handle = stale, .peer = .{ .node_id = b.transport.engine.localRecord().node_id, .address = b.transport.localAddress() }, .reason = error.InvalidRecord } } }, &.{}, &output);
    try std.testing.expectEqual(@as(usize, 0), stale_result.candidates);
    try std.testing.expectEqual(@as(usize, 1), controller.lookup.?.waitingCount());
    try std.testing.expectEqual(active, a.transport.engine.calls.count());
    var expiries: [d.CallTable.capacity_max]d.CallTable.Expired = undefined;
    var candidate: ?adapter.Candidate = null;
    for (0..30) |_| {
        const tick = try d.Transport.monotonicMilliseconds(io);
        const remote = try d.driver.step(b.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, tick) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
        if (remote.failure) |failure| return failure.cause;
        var progress = try d.driver.step(a.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, tick) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
        const response = progress.event == .response;
        if (response) {
            progress.failure = .{ .cause = error.DestinationUnreachable, .stage = .process };
        }
        const consumed = controller.consume(&progress, expiries[0..progress.calls_expired], &output);
        if (response) {
            try std.testing.expectEqual(error.DestinationUnreachable, consumed.failure.?.cause);
            try std.testing.expectEqual(d.Transport.FailureStage.process, consumed.failure.?.stage);
            try std.testing.expectEqual(@as(usize, 1), consumed.candidates);
            candidate = output[0];
            break;
        }
    }
    try std.testing.expect(candidate != null);
    _ = try d.driver.step(a.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, now) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
    try adapter.requireIdentity(b.transport.engine.localRecord(), &candidate.?.peer);
    try std.testing.expectEqual(@as(u16, 9002), candidate.?.addresses[0].port());
    const completed_ms = try d.Transport.monotonicMilliseconds(io);
    _ = try support.advance(controller, io, completed_ms, &.{});
    try std.testing.expect(controller.lookup == null);
    network.now_ms = now + 60_000;
    _ = try support.advance(controller, io, network.now_ms, &.{});
    try std.testing.expect(a.transport.engine.calls.count() > 0);
    network.now_ms += 1_000;
    var progress = try d.driver.step(a.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, network.now_ms) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
    try std.testing.expect(progress.calls_expired > 0);
    progress.failure = .{ .cause = error.DestinationUnreachable, .stage = .process };
    const consumed = controller.consume(&progress, expiries[0..progress.calls_expired], &.{});
    try std.testing.expect(controller.lookup == null or controller.lookup.?.waitingCount() == 0);
    try std.testing.expect(controller.maintenance.pending == null);
    try std.testing.expectEqual(error.DestinationUnreachable, consumed.failure.?.cause);
    try std.testing.expect(a.transport.engine.peerRecord(&b.transport.engine.localRecord().node_id) != null);
    controller.shutdown();
    try std.testing.expectEqual(@as(usize, 0), a.transport.engine.calls.count());
}

test "peer discovery no QUIC nodes remain confirmed but produce no dial candidates" {
    var network: Network = .{};
    const io = network.io();
    var b: Node = undefined;
    try b.init(io, 2, null, &.{});
    defer b.deinit();
    var a: Node = undefined;
    try a.init(io, 1, 9001, &.{ .bootstrap = &.{b.transport.engine.localRecord().*} });
    defer a.deinit();
    const controller = &a.owner;
    try controller.request(.{ .general = true });
    var output: [1]adapter.Candidate = undefined;
    var expiries: [d.CallTable.capacity_max]d.CallTable.Expired = undefined;
    var rejected: usize = 0;
    for (0..30) |_| {
        const tick = try d.Transport.monotonicMilliseconds(io);
        const result = try support.advance(controller, io, tick, &output);
        if (result.failure) |failure| return failure.cause;
        rejected = @intCast(rejectionCount(controller));
        try std.testing.expectEqual(@as(usize, 0), result.candidates);
        const remote = try d.driver.step(b.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, tick) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
        if (remote.failure) |failure| return failure.cause;
        if (rejected > 0) break;
    }
    try std.testing.expect(rejected > 0);
    try std.testing.expectEqual(@as(usize, 1), a.transport.engine.peerCount());
    controller.shutdown();
    try std.testing.expectEqual(@as(usize, 0), a.transport.engine.calls.count());
}

const SendFailure = struct {
    base: std.Io,
    sends: usize = 0,
    receive_enabled: bool = false,
    receive_failure: std.Io.Batch.AwaitConcurrentError = error.ConcurrencyUnavailable,
    /// Refuses only sends to this port and delivers the rest. Null refuses every send.
    refused_port: ?u16 = null,
    fn io(self: *SendFailure) std.Io {
        const vtable = comptime blk: {
            var value = std.Io.failing.vtable.*;
            value.randomSecure = random;
            value.batchAwaitConcurrent = receive;
            value.batchCancel = cancel;
            value.now = currentTime;
            value.netSend = send;
            break :blk value;
        };
        return .{ .userdata = self, .vtable = &vtable };
    }
    fn random(context_ptr: ?*anyopaque, buffer: []u8) std.Io.RandomSecureError!void {
        const self: *SendFailure = @ptrCast(@alignCast(context_ptr.?));
        return std.Io.randomSecure(self.base, buffer);
    }
    fn receive(context_ptr: ?*anyopaque, batch: *std.Io.Batch, timeout: std.Io.Timeout) std.Io.Batch.AwaitConcurrentError!void {
        const self: *SendFailure = @ptrCast(@alignCast(context_ptr.?));
        if (self.receive_enabled) return self.base.vtable.batchAwaitConcurrent(self.base.userdata, batch, timeout);
        return self.receive_failure;
    }
    fn cancel(context_ptr: ?*anyopaque, batch: *std.Io.Batch) void {
        const self: *SendFailure = @ptrCast(@alignCast(context_ptr.?));
        self.base.vtable.batchCancel(self.base.userdata, batch);
    }
    fn currentTime(context_ptr: ?*anyopaque, clock: std.Io.Clock) std.Io.Timestamp {
        const self: *SendFailure = @ptrCast(@alignCast(context_ptr.?));
        return self.base.vtable.now(self.base.userdata, clock);
    }
    fn send(context_ptr: ?*anyopaque, handle: std.Io.net.Socket.Handle, messages: []std.Io.net.OutgoingMessage, flags: std.Io.net.SendFlags) struct { ?std.Io.net.Socket.SendError, usize } {
        const self: *SendFailure = @ptrCast(@alignCast(context_ptr.?));
        if (self.refused_port) |port| if (messages[0].address.getPort() != port) {
            return self.base.vtable.netSend(self.base.userdata, handle, messages, flags);
        };
        self.sends += 1;
        return .{ error.NetworkUnreachable, 0 };
    }
};

test "peer discovery refused lookup send releases its call and continues with other candidates in the same step" {
    var network: Network = .{};
    const io = network.io();
    var b: Node = undefined;
    try b.init(io, 2, 9002, &.{});
    defer b.deinit();
    var c: Node = undefined;
    try c.init(io, 3, 9003, &.{});
    defer c.deinit();
    const refused = c.transport.engine.localRecord().node_id;
    const now = try d.Transport.monotonicMilliseconds(io);
    var a: Node = undefined;
    try a.init(io, 1, 9001, &.{ .bootstrap = &.{ b.transport.engine.localRecord().*, c.transport.engine.localRecord().* } });
    defer a.deinit();
    const controller = &a.owner;
    try controller.request(.{ .general = true });
    var host = SendFailure{ .base = io, .receive_enabled = true, .refused_port = c.transport.localAddress().port() };
    var output: [1]adapter.Candidate = undefined;
    const result = try support.advance(controller, host.io(), now, &output);
    if (result.failure) |failure| return failure.cause;
    try std.testing.expectEqual(@as(u16, 2), controller.lookup.?.queries_started);
    try std.testing.expectEqual(@as(usize, 1), host.sends);
    try std.testing.expectEqual(@as(u64, 0), controller.resource_retry_ms);
    const lookup = &controller.lookup.?;
    try std.testing.expectEqual(@as(usize, 1), lookup.waitingCount());
    try std.testing.expectEqual(@as(usize, 1), a.transport.engine.calls.count());
    for (controller.storage.candidates[0..lookup.candidateCount()]) |candidate| {
        if (std.mem.eql(u8, &candidate.peer.node_id, &refused)) try std.testing.expect(candidate.state == .failed);
    }
    try std.testing.expect(a.transport.engine.peerRecord(&refused) != null);
    var expiries: [d.CallTable.capacity_max]d.CallTable.Expired = undefined;
    var found = false;
    for (0..30) |_| {
        const tick = try d.Transport.monotonicMilliseconds(io);
        const remote = try d.driver.step(b.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, tick) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
        if (remote.failure) |failure| return failure.cause;
        const next = try support.advance(controller, io, tick, &output);
        if (next.failure) |failure| return failure.cause;
        if (next.candidates > 0) {
            try adapter.requireIdentity(b.transport.engine.localRecord(), &output[0].peer);
            found = true;
            break;
        }
    }
    try std.testing.expect(found);
}

test "peer discovery refused maintenance probe stays a local failure and the step goes on" {
    var network: Network = .{};
    const io = network.io();
    var b: Node = undefined;
    try b.init(io, 2, 9002, &.{});
    defer b.deinit();
    var c: Node = undefined;
    try c.init(io, 3, 9003, &.{});
    defer c.deinit();
    const now = try d.Transport.monotonicMilliseconds(io);
    const refused: d.types.Endpoint = .{ .node_id = c.transport.engine.localRecord().node_id, .address = c.transport.localAddress() };
    const interval = 10;
    var a: Node = undefined;
    try a.init(io, 1, 9001, &.{ .bootstrap = &.{b.transport.engine.localRecord().*}, .discovery = .{ .maintenance = .{ .probe_interval_ms = interval, .stale_after_ms = interval, .retry_interval_ms = interval } } });
    defer a.deinit();
    _ = try a.transport.engine.confirmPeer(&refused, c.transport.engine.localRecord(), now);
    const controller = &a.owner;
    try controller.request(.{ .general = true });
    network.now_ms = now + interval;
    const tick = network.now_ms;
    var host = SendFailure{ .base = io, .receive_enabled = true, .refused_port = refused.address.port() };
    const result = try support.advance(controller, host.io(), tick, &.{});
    if (result.failure) |failure| return failure.cause;
    // The stale probe to the verified peer and both lookup seeds start; both sends to it are refused.
    try std.testing.expectEqual(@as(u16, 2), controller.lookup.?.queries_started);
    try std.testing.expectEqual(@as(usize, 2), host.sends);
    try std.testing.expectEqual(@as(usize, 1), a.transport.engine.calls.count());
    try std.testing.expectEqual(@as(u64, 0), controller.resource_retry_ms);
    // A timeout would keep the probe for a retry and then mark the peer unresponsive.
    try std.testing.expect(controller.maintenance.pending == null);
    try std.testing.expectEqual(@as(?u64, now), a.transport.engine.peerRecord(&refused.node_id).?.last_verified_ms);
}

test "peer discovery fork and subnet filtering plus output pressure preserve confirmed routing" {
    var network: Network = .{};
    const io = network.io();
    for (0..5) |mode| {
        var b: Node = undefined;
        try b.init(io, 2, 9002, &.{});
        defer b.deinit();
        if (mode >= 3) {
            const key = try d.identity.crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{2}));
            const dual = try adapter.build(&key, 2, &.{
                .fork = .{ .digest = context.digest, .next_version = @splat(0), .next_epoch = 0 },
                .ip4 = .{ 127, 0, 0, 1 },
                .udp = b.transport.localAddress().port(),
                .ip6 = .{0} ** 15 ++ .{1},
                .quic6 = 9003,
            }, &context);
            try b.transport.engine.updateLocalRecord(&dual);
        }
        var fork = context;
        if (mode == 0) fork.digest[0] = 9;
        var a: Node = undefined;
        try a.init(io, 1, 9001, &.{ .fork = fork, .bootstrap = &.{b.transport.engine.localRecord().*}, .discovery = .{ .quic_mode = if (mode == 4) .ip4 else .dual } });
        defer a.deinit();
        const controller = &a.owner;
        try controller.request(if (mode == 1) .{ .syncnets = 1 } else .{ .general = true });
        var output: [1]adapter.Candidate = undefined;
        var expiries: [d.CallTable.capacity_max]d.CallTable.Expired = undefined;
        var filtered: usize = 0;
        for (0..30) |_| {
            const tick = try d.Transport.monotonicMilliseconds(io);
            const result = try support.advance(controller, io, tick, output[0..if (mode == 2) @as(usize, 0) else 1]);
            if (result.failure) |failure| return failure.cause;
            filtered = @intCast(rejectionCount(controller));
            try std.testing.expectEqual(@as(usize, 0), result.candidates);
            const remote = try d.driver.step(b.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, tick) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
            if (remote.failure) |failure| return failure.cause;
            if (filtered > 0) break;
        }
        try std.testing.expect(filtered > 0);
        const reason: discovery.Discovery.Rejection = switch (mode) {
            0 => .incompatible_fork,
            1 => .demand,
            2 => .output_capacity,
            3 => .endpoint_scope,
            4 => .endpoint_family,
            else => unreachable,
        };
        try std.testing.expect(controller.rejections[@intFromEnum(reason)] > 0);
        try std.testing.expectEqual(@as(usize, 1), a.transport.engine.peerCount());
        controller.shutdown();
        try std.testing.expectEqual(@as(usize, 0), a.transport.engine.calls.count());
    }
}

test "peer discovery coalesced demand retains query deadline" {
    var network: Network = .{};
    const io = network.io();
    var a: Node = undefined;
    try a.init(io, 1, 9001, &.{});
    defer a.deinit();
    const controller = &a.owner;
    try std.testing.expectError(error.InvalidDemand, controller.request(.{ .syncnets = 0x10 }));
    try controller.request(.{ .general = true });
    const result = try support.advance(controller, io, 0, &.{});
    try std.testing.expectEqual(@as(usize, 0), result.candidates);
    const next = schedule_test_support.wakeupMilliseconds(controller.schedule(), 0);
    for (0..100) |_| try controller.request(.{ .general = true });
    try std.testing.expectEqual(next, schedule_test_support.wakeupMilliseconds(controller.schedule(), 0));
}

test "peer discovery foreground retains authenticated IPv6 source over alternate signed IPv4" {
    var network: Network = .{};
    const io = network.io();
    for ([_][4]u8{ .{ 10, 0, 0, 1 }, .{ 127, 0, 0, 1 } }) |alternate| {
        var a: Node = undefined;
        try a.init(io, 1, null, &.{ .bindings = .{ .ip6 = .loopback(0) } });
        defer a.deinit();
        var b: Node = undefined;
        try b.init(io, 2, 9001, &.{ .bindings = .{ .ip6 = .loopback(0) }, .alternate_ip4 = alternate });
        defer b.deinit();
        _ = try b.transport.startCall(io, .{ .node_id = a.transport.engine.localRecord().node_id, .address = a.transport.localAddress() }, a.transport.engine.localRecord(), &.{ .ping = .{ .request_id = try d.wire.message.RequestId.init(&.{1}), .enr_sequence = 1 } }, try d.Transport.monotonicMilliseconds(io));
        var expiries: [d.CallTable.capacity_max]d.CallTable.Expired = undefined;
        var authenticated = false;
        for (0..30) |_| {
            const now = try d.Transport.monotonicMilliseconds(io);
            const incoming = try d.driver.step(a.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, now) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
            if (incoming.failure) |failure| return failure.cause;
            const response = try d.driver.step(b.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, now) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
            if (response.failure) |failure| return failure.cause;
            if (response.event == .response) {
                authenticated = true;
                break;
            }
        }
        try std.testing.expect(authenticated);
        const entry = a.transport.engine.peerRecord(&b.transport.engine.localRecord().node_id).?;
        try std.testing.expectEqualDeep(b.transport.localAddress(), entry.peer.address);
        try std.testing.expect(entry.record.endpoint().? == .ip4);
        const controller = &a.owner;
        try controller.request(.{ .general = true });
        var output: [1]adapter.Candidate = undefined;
        var completed = false;
        for (0..30) |_| {
            const tick = try d.Transport.monotonicMilliseconds(io);
            const result = try support.advance(controller, io, tick, &output);
            if (result.failure) |failure| return failure.cause;
            try std.testing.expectEqual(@as(usize, 0), result.candidates);
            if (rejectionCount(controller) > 0) {
                completed = true;
                break;
            }
            const remote = try d.driver.step(b.transport, io, &expiries, .{ .deadline = .{ .clock = .awake, .raw = .fromNanoseconds(@as(i96, tick) * std.time.ns_per_ms) }, .wait_max = .fromMilliseconds(10) });
            if (remote.failure) |failure| return failure.cause;
        }
        try std.testing.expect(completed);
        try std.testing.expect(controller.lookup != null);
        controller.shutdown();
        try std.testing.expectEqual(@as(usize, 0), a.transport.engine.calls.count());
    }
}

test "peer discovery ready step refills demand without reading an ineligible socket" {
    var network: Network = .{};
    const io = network.io();
    var b: Node = undefined;
    try b.init(io, 62, 9062, &.{});
    defer b.deinit();
    const now = try d.Transport.monotonicMilliseconds(io);
    var a: Node = undefined;
    try a.init(io, 61, 9061, &.{ .bootstrap = &.{b.transport.engine.localRecord().*} });
    defer a.deinit();
    const controller = &a.owner;
    try controller.request(.{ .general = true });
    var faults: fault_io = .{ .base = io, .receive = .{} };
    var ready: [2]bool = @splat(false);
    var candidates: [16]adapter.Candidate = undefined;
    const result = try controller.advance(faults.io(), now, &ready, &candidates);
    try std.testing.expect(result.failure == null);
    try std.testing.expect(a.transport.engine.calls.count() > 0);
    try std.testing.expectEqual(@as(usize, 0), faults.receive_calls);
}

test "peer discovery owning construction cleans every allocation prefix" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, constructOwner, .{});
}

fn constructOwner(allocator: std.mem.Allocator) !void {
    var network: Network = .{};
    const io = network.io();
    var sockets = try Sockets.bind(io, .{ .ip4 = .loopback(0) });
    var sockets_owned = true;
    defer if (sockets_owned) sockets.close(io);
    const key = try d.identity.crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{119}));
    const record = try d.identity.enr.Record.create(&key, 1, sockets.localAddress());
    var owner: discovery.Discovery = undefined;
    try owner.initBound(allocator, sockets, &key, &record, &context, &.{}, 0, .{}, .{ .session_capacity = 8, .challenge_capacity = 8, .call_capacity = 8 });
    sockets_owned = false;
    defer owner.deinit(io);
    try owner.request(.{ .general = true });
    _ = try support.advance(&owner, io, 0, &.{});
}

test "peer discovery validates complete bootstrap list before taking sockets" {
    var network: Network = .{};
    const io = network.io();
    var sockets = try Sockets.bind(io, .{ .ip4 = .loopback(0) });
    defer sockets.close(io);
    const key = try d.identity.crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{120}));
    const record = try d.identity.enr.Record.create(&key, 1, sockets.localAddress());
    const no_endpoint = try adapter.build(&key, 1, &.{ .fork = .{ .digest = context.digest, .next_version = @splat(0), .next_epoch = 0 } }, &context);
    var owner: discovery.Discovery = undefined;
    try std.testing.expectError(error.InvalidBootstrap, owner.initBound(std.testing.allocator, sockets, &key, &record, &context, &.{ record, no_endpoint }, 0, .{}, .{}));
    try std.testing.expectError(error.InvalidConfig, owner.initBound(std.testing.allocator, sockets, &key, &record, &context, &.{}, 0, .{ .maintenance = .{ .retry_interval_ms = 0 } }, .{}));
    var excess: [discovery.Discovery.bootstrap_max + 1]d.identity.enr.Record = undefined;
    try std.testing.expectError(error.TooManyBootstraps, owner.initBound(std.testing.allocator, sockets, &key, &record, &context, &excess, 0, .{}, .{}));
}

test "peer discovery prepares its advertisement before replacing local state" {
    var network: Network = .{};
    var node: Node = undefined;
    try node.init(network.io(), 111, 9011, &.{});
    defer node.deinit();
    const initial = node.owner.localRecord().*;
    node.owner.quic_bound[0] = true;
    const endpoints: advertisement.Endpoints = .{ .ip4 = initial.ip4, .udp = initial.udp, .quic = 9012 };
    var announced: adapter.LocalAdvertisement = .{ .fork = .{ .digest = context.digest, .next_version = @splat(0), .next_epoch = 0 }, .ip4 = initial.ip4, .udp = initial.udp, .quic = 9012 };
    announced.custody_group_count = 0;
    try std.testing.expectError(error.InvalidField, node.owner.prepareAdvertisement(&announced, endpoints, &context));
    try std.testing.expectEqualDeep(initial, node.owner.localRecord().*);
    try std.testing.expectEqualDeep(advertisement.Endpoints{}, node.owner.endpoints);
    announced.custody_group_count = null;
    const record = (try node.owner.prepareAdvertisement(&announced, endpoints, &context)).?;
    try std.testing.expectEqualDeep(initial, node.owner.localRecord().*);
    try std.testing.expectEqualDeep(advertisement.Endpoints{}, node.owner.endpoints);
    node.owner.advertise(&record, endpoints, &context);
    const installed = node.owner.localRecord().*;
    try std.testing.expectEqual(initial.sequence + 1, installed.sequence);
    try std.testing.expectEqualDeep(installed, try d.identity.enr.Record.init(installed.slice()));
    try std.testing.expectEqualDeep(endpoints, node.owner.endpoints);
    node.owner.advertise(null, endpoints, &context);
    try std.testing.expectEqualDeep(installed, node.owner.localRecord().*);
    node.owner.shutdown();
    try std.testing.expectError(error.Stopped, node.owner.prepareAdvertisement(&announced, endpoints, &context));
}

test "discovery keeps the refill failure when receive then cancels" {
    var network: Network = .{};
    var node: Node = undefined;
    try node.init(network.io(), 1, 9001, &.{});
    defer node.deinit();
    try node.owner.request(.{ .general = true });
    var faults: fault_io = .{ .base = network.io(), .entropy = .{}, .receive = .{} };
    var candidates: [1]adapter.Candidate = undefined;
    var ready: [2]bool = @splat(true);
    const result = try node.owner.advance(faults.io(), 0, &ready, &candidates);
    try std.testing.expect(result.cancelled);
    try std.testing.expectEqual(error.EntropyUnavailable, result.failure.?.cause);
    try std.testing.expectEqual(.coordinator, result.failure.?.stage);
    try std.testing.expectEqual(@as(usize, 1), faults.receive_calls);
    try std.testing.expectEqual(@as(usize, 0), faults.send_calls);
}

fn rejectionCount(owner: *const discovery.Discovery) u64 {
    var count: u64 = 0;
    for (owner.rejections) |value| count += value;
    return count;
}
