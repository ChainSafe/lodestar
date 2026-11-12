const std = @import("std");
const schedule_test_support = @import("schedule_test_support.zig");
const ct = @import("consensus_types");
const protocol = @import("reqresp/protocol.zig");
const reqresp = @import("reqresp/ReqResp.zig");
const Engine = @import("quic/Engine.zig");
const harness = @import("protocols_reqresp_test_support.zig");
const policy_fixture = @import("reqresp/policy_fixture.zig");
const admission_fixture = @import("reqresp/admission_fixture.zig");
const protocols_test_support = @import("protocols_test_support.zig");
const stream_trace = @import("stream_trace.zig");
const codec = @import("reqresp/codec.zig");

const support = @import("quic/test_support.zig");
const control_fixture = @import("reqresp/control_fixture.zig");
const applicationOptions = control_fixture.applicationOptions;

const Event = reqresp.Event;
const Protocol = protocol.Protocol;
const statusBytes = harness.statusBytes;

const Pair = harness.Pair;

fn roundTrip(setup: *Pair, seed: u8) !void {
    const request_ssz = statusBytes(seed);
    var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        .status_v1,
        &request_ssz,
        &sink,
        .{},
        setup.shared.pair.now,
    );
    const reply = statusBytes(seed +% 1);
    var done = false;
    var rounds: usize = 0;
    while (rounds < 40 and !done) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                try std.testing.expectEqual(Protocol.status_v1, incoming.protocol);
                try setup.shared.server.control_reqresp.respond(incoming.request, &reply, null, setup.shared.pair.now);
            },
            .chunk_sent => |sent| try std.testing.expect(setup.shared.server.control_reqresp.finish(sent.request, setup.shared.pair.now)),
            else => {},
        };
        for (setup.clientEvents()) |event| switch (event) {
            .chunk => |chunk| {
                try std.testing.expectEqualSlices(u8, &reply, chunk.bytes);
                try std.testing.expect(setup.shared.client.control_reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, chunk.request, setup.shared.pair.now));
            },
            .done => done = true,
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
    }
    try std.testing.expect(done);
}

test "protocol stack round trips a status request through the collapsed host loop" {
    var setup: Pair = .{};
    try setup.init(.{ .outbound_max = 4, .serving_max = 4 }, .{ .outbound_max = 4, .serving_max = 4 });
    defer setup.deinit();

    try roundTrip(&setup, 5);
    try std.testing.expectEqual(@as(u16, 0), setup.shared.client.control_reqresp.pendingCounts().outbound);
    try std.testing.expectEqual(@as(u16, 0), setup.shared.server.control_reqresp.pendingCounts().inbound);
}

test "protocol stack stream capture contains application framing exactly once" {
    var setup: Pair = .{};
    try setup.init(.{ .outbound_max = 4, .serving_max = 4 }, .{ .outbound_max = 4, .serving_max = 4 });
    defer setup.deinit();
    var capture = try stream_trace.Capture.init(std.testing.allocator, std.testing.io, setup.shared.pair.client.limits.connections_max);
    defer capture.deinit(std.testing.allocator);
    capture.connected(setup.shared.handles.client, &setup.shared.pair.server_ctx.local_peer_id, support.server_address, support.client_address, .outbound);
    setup.shared.pair.client.stream_capture = &capture;
    defer setup.shared.pair.client.stream_capture = null;
    try roundTrip(&setup, 5);
    const batch = capture.drain();
    try std.testing.expect(!batch.reset and !batch.pending);
    var alias: ?u64 = null;
    var outgoing: [1024]u8 = undefined;
    var incoming: [1024]u8 = undefined;
    var sent: usize = 0;
    var received: usize = 0;
    var closed: usize = 0;
    for (batch.events) |event| switch (event.payload) {
        .stream => |stream| if (stream.protocol == .reqresp and stream.protocol.reqresp == .status_v1) {
            try std.testing.expect(alias == null);
            alias = stream.id;
        },
        .data => |data| if (data.stream == alias) {
            try std.testing.expectEqual(@as(usize, 0), closed);
            const bytes = batch.data[data.offset..][0..data.length];
            if (data.direction == .outbound) {
                @memcpy(outgoing[sent..][0..bytes.len], bytes);
                sent += bytes.len;
            } else {
                @memcpy(incoming[received..][0..bytes.len], bytes);
                received += bytes.len;
            }
        },
        .stream_closed => |stream| if (stream.stream == alias) {
            try std.testing.expect(!stream.reset);
            closed += 1;
        },
        else => {},
    };
    try std.testing.expectEqual(@as(usize, 1), closed);
    try std.testing.expect(alias != null);
    var encoded: [1024]u8 = undefined;
    try std.testing.expectEqualSlices(u8, try codec.encodeRequest(&statusBytes(5), &encoded), outgoing[0..sent]);
    try std.testing.expectEqualSlices(u8, try codec.encodeChunk(0, null, &statusBytes(6), &encoded), incoming[0..received]);
}

test "protocol stack reclaims inbound sinks across more requests than it has slots" {
    const admission: reqresp.Options.Admission = .{ .policy = policy_fixture.config(), .limits = .{
        .source = admission_fixture.quotas(1_000, 1_000),
        .global = admission_fixture.quotas(1_000, 1_000),
    } };
    var setup: Pair = .{};
    try setup.init(.{ .outbound_max = 4, .serving_max = 4 }, .{ .outbound_max = 4, .serving_max = 4, .admission = admission });
    defer setup.deinit();

    var seed: u8 = 0;
    while (seed < 12) : (seed += 1) try roundTrip(&setup, seed);
    try std.testing.expectEqual(@as(u16, 0), setup.shared.server.control_reqresp.pendingCounts().inbound);
}

test "protocol stack fails in-flight requests when the connection closes" {
    var setup: Pair = .{};
    try setup.init(.{ .outbound_max = 4, .serving_max = 4 }, .{ .outbound_max = 4, .serving_max = 4 });
    defer setup.deinit();

    const request_ssz = statusBytes(1);
    var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        .status_v1,
        &request_ssz,
        &sink,
        .{},
        setup.shared.pair.now,
    );
    var seen = false;
    var rounds: usize = 0;
    while (rounds < 12 and !seen) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| {
            if (event == .request) seen = true;
        }
    }
    try std.testing.expect(seen);

    try std.testing.expect(setup.shared.pair.client.close(setup.shared.handles.client, 0));
    var client_failed = false;
    var server_failed = false;
    rounds = 0;
    while (rounds < 20 and !(client_failed and server_failed)) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.clientEvents()) |event| {
            if (event == .failed and event.failed.reason == .connection_closed) client_failed = true;
        }
        for (setup.serverEvents()) |event| {
            if (event == .failed and event.failed.reason == .connection_closed) server_failed = true;
        }
    }
    try std.testing.expect(client_failed);
    try std.testing.expect(server_failed);
    try std.testing.expectEqual(@as(u16, 0), setup.shared.server.control_reqresp.pendingCounts().inbound);
}

test "protocol stack control wakeup includes negotiation after application quiescence" {
    var setup: Pair = .{};
    try setup.init(.{ .outbound_max = 4, .serving_max = 4 }, .{ .outbound_max = 4, .serving_max = 4 });
    defer setup.deinit();
    setup.shared.client.closeApplications(&setup.shared.pair.client, setup.shared.pair.now);
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{ .timeouts = .{ .response = .fromMilliseconds(60_000) } }, setup.shared.pair.now);
    _ = setup.shared.client.process(&setup.shared.pair.client, &.{}, setup.shared.pair.now, .{ .control = &.{} }).control;
    try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis() + 5_000), schedule_test_support.wakeupMilliseconds(schedule_test_support.protocolsSchedule(&setup.shared.client, .{ .control = 0 }), setup.shared.pair.now.millis()));
    try std.testing.expect(setup.shared.client.control_reqresp.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    _ = setup.shared.client.process(&setup.shared.pair.client, &.{}, setup.shared.pair.now, .{ .control = &.{} }).control;
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(schedule_test_support.protocolsSchedule(&setup.shared.client, .{ .control = 0 }), setup.shared.pair.now.millis()));
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.process(&setup.shared.pair.client, &.{}, setup.shared.pair.now, .{ .control = &events }).control);
    try std.testing.expect(events[0].failed.reason == .cancelled);
    setup.shared.server.closeApplications(&setup.shared.pair.server, setup.shared.pair.now);
    try roundTrip(&setup, 7);
}

test "protocol stack preserves drained native stream events across a partial request sweep" {
    var setup: Pair = .{};
    try setup.init(.{ .outbound_max = 4, .serving_max = 4 }, .{ .outbound_max = 4, .serving_max = 4 });
    defer setup.deinit();
    const bytes = [_]u8{9} ** 8;
    var sink: [8]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    var incoming: ?reqresp.RequestHandle = null;
    for (0..30) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| if (event == .request) {
            incoming = event.request.request;
        };
        if (incoming != null) break;
    }
    try std.testing.expect(incoming != null);
    const stream = setup.shared.server.control_reqresp.inbound[incoming.?.index].request.stream;
    setup.shared.client.control_reqresp.options.work_per_pump_max = 1;
    _ = setup.shared.client.process(&setup.shared.pair.client, &.{}, setup.shared.pair.now, .{ .control = &.{} }).control;
    var wire: [codec.frame_scratch_max]u8 = undefined;
    const encoded = try codec.encodeChunk(0, null, &bytes, &wire);
    try std.testing.expectEqual(encoded.len, try setup.shared.pair.server.write(stream, encoded, false));
    try setup.shared.pair.pump();
    var events: [1]Event = undefined;
    var transport: [16]Engine.Event = undefined;
    const polled = setup.shared.pair.events(&setup.shared.pair.client, &transport);
    try std.testing.expect(polled.len > 0);
    const first_count = setup.shared.client.process(&setup.shared.pair.client, polled, setup.shared.pair.now, .{ .control = &events }).control;
    var received = first_count == 1;
    for (0..10) |_| {
        if (received) break;
        try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(schedule_test_support.protocolsSchedule(&setup.shared.client, .{ .control = 1 }), setup.shared.pair.now.millis()));
        const count = setup.shared.client.process(&setup.shared.pair.client, &.{}, setup.shared.pair.now, .{ .control = &events }).control;
        if (count == 1) {
            try std.testing.expectEqualSlices(u8, &bytes, events[0].chunk.bytes);
            received = true;
            break;
        }
    }
    try std.testing.expect(received);
    try std.testing.expectEqualSlices(u8, &bytes, events[0].chunk.bytes);
}

test "protocol stack request work remains bounded and rotates between live streams" {
    var setup: Pair = .{};
    try setup.init(.{ .outbound_max = 64, .serving_max = 64 }, .{});
    defer setup.deinit();
    const bytes = [_]u8{9} ** 8;
    var sinks: [2][8]u8 = undefined;
    var handles: [2]reqresp.RequestHandle = undefined;
    for (&sinks, &handles) |*sink, *handle| {
        handle.* = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, sink, .{}, setup.shared.pair.now);
    }
    var incoming: [2]reqresp.RequestHandle = undefined;
    var received: usize = 0;
    for (0..30) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| if (event == .request) {
            try std.testing.expect(received < incoming.len);
            incoming[received] = event.request.request;
            received += 1;
        };
        if (received == incoming.len) break;
    }
    try std.testing.expectEqual(incoming.len, received);
    var wire: [codec.frame_scratch_max]u8 = undefined;
    const encoded = try codec.encodeChunk(0, null, &bytes, &wire);
    for (incoming) |handle| {
        const stream = setup.shared.server.control_reqresp.inbound[handle.index].request.stream;
        try std.testing.expectEqual(encoded.len, try setup.shared.pair.server.write(stream, encoded, false));
    }
    try setup.shared.pair.pump();
    protocols_test_support.forward(&setup.shared.pair, &setup.shared.pair.client, .{ .reqresp = &setup.shared.client.control_reqresp });
    setup.shared.client.control_reqresp.options.work_per_pump_max = 1;
    var events: [2]Event = undefined;
    var delivered: [2]reqresp.RequestHandle = undefined;
    for (&delivered) |*handle| {
        const count = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events);
        try std.testing.expectEqual(@as(usize, 1), count);
        try std.testing.expectEqualSlices(u8, &bytes, events[0].chunk.bytes);
        handle.* = events[0].chunk.request;
    }
    try std.testing.expect(!std.meta.eql(delivered[0], delivered[1]));
    for (handles) |handle| try std.testing.expect(setup.shared.client.control_reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
}

test "protocol stack reqresp slot is serviced only after a stream event or its deadline" {
    var setup: Pair = .{};
    try setup.init(.{}, .{ .progress_timeout_ms = 1_000 });
    defer setup.deinit();
    const server = &setup.shared.server.control_reqresp;
    // Two accepted ping streams whose request bytes have not arrived.
    const fed = try setup.openRaw(.ping_v1);
    try setup.awaitRawSelection(fed, .ping_v1);
    const starved = try setup.openRaw(.ping_v1);
    try setup.awaitRawSelection(starved, .ping_v1);
    try std.testing.expectEqual(@as(u8, 2), server.inboundProtocolRunningCount(setup.shared.handles.server, .ping_v1));
    for (0..2) |_| try setup.pumpOnce();
    const idle = server.visits;
    for (0..8) |_| {
        try setup.pumpOnce();
        try std.testing.expectEqual(idle, server.visits);
        try std.testing.expect(schedule_test_support.wakeupMilliseconds(server.schedule(1), setup.shared.pair.now.millis()).? > setup.shared.pair.now.millis());
    }

    const ping = [_]u8{3} ** 8;
    var wire: [codec.frame_scratch_max]u8 = undefined;
    const encoded = try codec.encodeRequest(&ping, &wire);
    try std.testing.expectEqual(encoded.len, try setup.shared.pair.client.write(fed, encoded, true));
    var request: ?reqresp.RequestHandle = null;
    for (0..8) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| if (event == .request) {
            try std.testing.expectEqualSlices(u8, &ping, event.request.bytes);
            request = event.request.request;
        };
        if (request != null) break;
    }
    try std.testing.expect(request != null);
    try std.testing.expect(server.visits > idle);

    // The starved slot is next visited when its progress deadline passes.
    const waiting = server.visits;
    for (0..4) |_| {
        try setup.pumpOnce();
        try std.testing.expectEqual(waiting, server.visits);
    }
    setup.shared.pair.advance(1_000);
    var timed_out = false;
    for (0..4) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| if (event == .failed) {
            try std.testing.expect(!std.meta.eql(request.?, event.failed.request));
            try std.testing.expectEqual(reqresp.Failure.timeout, event.failed.reason);
            timed_out = true;
        };
        if (timed_out) break;
    }
    try std.testing.expect(timed_out);
    try std.testing.expect(server.visits > waiting);
}

test "protocol stack reqresp deadline fires on time while more slots than the pump budget stay ready" {
    // One client identity opens every stream, so its request starts need a larger burst.
    var admission = try reqresp.Options.Admission.defaults(&policy_fixture.config(), 2);
    admission.limits.starts.tokens = 64;
    var setup: Pair = .{};
    try setup.init(.{}, .{ .progress_timeout_ms = 1_000, .admission = admission });
    defer setup.deinit();
    const server = &setup.shared.server.control_reqresp;
    // An accepted ping stream whose request never arrives.
    const stream = try setup.openRaw(.ping_v1);
    try setup.awaitRawSelection(stream, .ping_v1);
    var waiting: ?u16 = null;
    for (server.inbound, 0..) |*slot, index| if (slot.request.running()) {
        try std.testing.expect(waiting == null);
        waiting = @intCast(index);
    };
    const deadline = server.inbound[waiting.?].request.started_ms + 1_000;

    // Busy slots on other connections, accepted later so their deadlines fall after it.
    setup.shared.pair.advance(500);
    var connections: [9]Engine.Handle = undefined;
    var dialed: usize = 0;
    // The server admits a bounded number of handshakes per source address.
    while (dialed < connections.len) {
        const batch = @min(4, connections.len - dialed);
        for (connections[dialed..][0..batch]) |*conn| conn.* = try setup.shared.pair.dial();
        dialed += batch;
        for (0..2) |_| try setup.pumpOnce();
    }
    for (connections) |conn| for ([_]Protocol{ .ping_v1, .ping_v1, .status_v1, .status_v1 }) |which| {
        const opened = try setup.openRawOn(conn, which);
        try setup.awaitRawSelection(opened, which);
    };
    var busy: [4 * connections.len]u16 = undefined;
    var count: usize = 0;
    for (server.inbound, 0..) |*slot, index| if (slot.request.running() and index != waiting.?) {
        busy[count] = @intCast(index);
        count += 1;
    };
    try std.testing.expectEqual(busy.len, count);

    setup.shared.pair.advance(500);
    try std.testing.expectEqual(deadline, setup.shared.pair.now.millis());
    for (busy) |index| server.markReady(.inbound, index);
    try std.testing.expect(server.ready.len > server.options.work_per_pump_max);
    try setup.pumpOnce();
    var timed_out = false;
    for (setup.serverEvents()) |event| if (event == .failed) {
        try std.testing.expectEqual(waiting.?, event.failed.request.index);
        try std.testing.expectEqual(reqresp.Failure.timeout, event.failed.reason);
        timed_out = true;
    };
    try std.testing.expect(timed_out);
}

test "protocol stack reqresp slots stay indexed by connection across a reconnect at the same index" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const server = &setup.shared.server.control_reqresp;
    const client = &setup.shared.client.control_reqresp;
    const old = setup.shared.handles;
    const bytes = [_]u8{4} ** 8;
    var sinks: [2][8]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, old.client, .ping_v1, &bytes, &sinks[0], .{}, setup.shared.pair.now);
    const stale = try awaitRequest(&setup);
    const slots_per_connection = server.receive_layout.slots_per_connection;
    try std.testing.expectEqual(@as(usize, old.server.index), stale.index / slots_per_connection);

    // The server holds its host events while the connection closes and a new one takes its index.
    setup.server_event_capacity = 0;
    try std.testing.expect(setup.shared.pair.client.close(old.client, 0));
    for (0..8) |_| try setup.pumpOnce();
    try std.testing.expectEqual(@as(usize, 0), setup.shared.pair.server.registry.active_len);
    const fresh_client = try setup.shared.pair.dial();
    for (0..8) |_| try setup.pumpOnce();
    try std.testing.expectEqual(@as(usize, 1), setup.shared.pair.server.registry.active_len);
    const fresh_server = setup.shared.pair.server.sendOwner(setup.shared.pair.server.registry.activeIndices()[0]).?;
    try std.testing.expectEqual(old.server.index, fresh_server.index);
    try std.testing.expect(old.server.generation != fresh_server.generation);

    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, fresh_client, .ping_v1, &bytes, &sinks[1], .{}, setup.shared.pair.now);
    for (0..8) |_| try setup.pumpOnce();
    try std.testing.expectEqual(@as(u8, 1), server.inboundProtocolRunningCount(fresh_server, .ping_v1));
    try std.testing.expectEqual(@as(u8, 1), server.inboundPendingCount(old.server));
    try std.testing.expectEqual(@as(u8, 1), client.outboundProtocolPendingCount(fresh_client, .ping_v1));
    try std.testing.expectEqual(@as(u8, 0), client.outboundProtocolPendingCount(old.client, .ping_v1));
    // A repeated close of the old connection leaves the new one's slot running.
    server.connectionClosed(&setup.shared.pair.server, &setup.shared.server.router, old.server, setup.shared.pair.now);
    try std.testing.expectEqual(@as(u8, 1), server.inboundProtocolRunningCount(fresh_server, .ping_v1));

    setup.server_event_capacity = 16;
    var fresh: ?reqresp.RequestHandle = null;
    var stale_failed = false;
    for (0..8) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                try std.testing.expectEqual(fresh_server, incoming.conn);
                try std.testing.expectEqual(stale.index / slots_per_connection, incoming.request.index / slots_per_connection);
                try std.testing.expect(incoming.request.index != stale.index);
                fresh = incoming.request;
            },
            .failed => |failed| {
                try std.testing.expectEqual(stale, failed.request);
                try std.testing.expectEqual(reqresp.Failure.connection_closed, failed.reason);
                stale_failed = true;
            },
            else => {},
        };
        if (fresh != null and stale_failed) break;
    }
    try std.testing.expect(fresh != null and stale_failed);
    try std.testing.expectError(error.StaleHandle, server.respond(stale, &bytes, null, setup.shared.pair.now));
    try server.respond(fresh.?, &bytes, null, setup.shared.pair.now);
    var done = false;
    for (0..16) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| if (event == .chunk_sent) {
            try std.testing.expect(server.finish(event.chunk_sent.request, setup.shared.pair.now));
        };
        for (setup.clientEvents()) |event| switch (event) {
            .chunk => |chunk| try std.testing.expect(client.consume(&setup.shared.pair.client, &setup.shared.client.router, chunk.request, setup.shared.pair.now)),
            .done => done = true,
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
        if (done) break;
    }
    try std.testing.expect(done);
}

fn awaitRequest(setup: *Pair) !reqresp.RequestHandle {
    for (0..16) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| if (event == .request) return event.request.request;
    }
    return error.TestUnexpectedResult;
}

test "protocol stack reqresp request on one connection among 64 visits only its own slots" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const server = &setup.shared.server.control_reqresp;
    const client = &setup.shared.client.control_reqresp;
    var connections: [64]Engine.Handle = undefined;
    connections[0] = setup.shared.handles.client;
    var dialed: usize = 1;
    // The server admits a bounded number of handshakes per source address.
    while (dialed < connections.len) {
        const batch = @min(4, connections.len - dialed);
        for (connections[dialed..][0..batch]) |*conn| conn.* = try setup.shared.pair.dial();
        dialed += batch;
        for (0..2) |_| try setup.pumpOnce();
    }
    try std.testing.expectEqual(@as(usize, connections.len), setup.shared.pair.server.registry.active_len);
    for (0..2) |_| try setup.pumpOnce();
    const idle = .{ client.visits, server.visits };
    for (0..4) |_| try setup.pumpOnce();
    try std.testing.expectEqual(idle[0], client.visits);
    try std.testing.expectEqual(idle[1], server.visits);

    const bytes = [_]u8{6} ** 8;
    var sink: [8]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, connections[41], .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    const incoming = try awaitRequest(&setup);
    try server.respond(incoming, &bytes, null, setup.shared.pair.now);
    var done = false;
    for (0..16) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| if (event == .chunk_sent) {
            try std.testing.expect(server.finish(event.chunk_sent.request, setup.shared.pair.now));
        };
        for (setup.clientEvents()) |event| switch (event) {
            .chunk => |chunk| try std.testing.expect(client.consume(&setup.shared.pair.client, &setup.shared.client.router, chunk.request, setup.shared.pair.now)),
            .done => done = true,
            else => {},
        };
        if (done) break;
    }
    try std.testing.expect(done);
    for (0..2) |_| try setup.pumpOnce();
    // One slot per side, each taken from a list a handful of times over its lifetime; a scan
    // would visit every slot of every connection.
    try std.testing.expect(client.visits - idle[0] <= 16);
    try std.testing.expect(server.visits - idle[1] <= 16);
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(server.schedule(1), setup.shared.pair.now.millis()));
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(client.schedule(1), setup.shared.pair.now.millis()));
}

test "protocol stack reqresp retains request and chunk bytes through control progress" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var options = try applicationOptions();
    options.forks = &.{.{ .digest = .{ 1, 2, 3, 4 }, .fork = .deneb }};
    var client = try protocols_test_support.initProtocols(std.testing.allocator, .{ .reqresp = options, .control_reqresp = try control_fixture.controlOptions(), .gossipsub = .{ .random_seed = 1, .connected_capacity = 4, .retained_capacity = 9, .retained_outbound_reserve = 1 } }, &pair.client);
    defer client.deinit();
    var server = try protocols_test_support.initProtocols(std.testing.allocator, .{ .reqresp = options, .control_reqresp = try control_fixture.controlOptions(), .gossipsub = .{ .random_seed = 1, .connected_capacity = 4, .retained_capacity = 9, .retained_outbound_reserve = 1 } }, &pair.server);
    defer server.deinit();
    defer server.reqresp.cancelAll(&pair.server, &server.router, pair.now);
    const sink = try std.testing.allocator.alloc(
        u8,
        protocol.Protocol.blocks_by_root_v2.info().response_max,
    );
    defer {
        client.reqresp.cancelAll(&pair.client, &client.router, pair.now);
        std.testing.allocator.free(sink);
    }
    const root = [_]u8{0xa5} ** 32;
    const app = try client.request(
        &pair.client,
        handles.client,
        .blocks_by_root_v2,
        &root,
        sink,
        .{ .expected_chunks = 1 },
        pair.now,
    );
    const ping_bytes = [_]u8{42} ++ [_]u8{0} ** 7;
    var pong: [8]u8 = undefined;
    _ = try client.control_reqresp.request(
        &pair.client,
        &client.router,
        handles.client,
        .ping_v1,
        &ping_bytes,
        &pong,
        .{},
        pair.now,
    );
    var got_pong = false;
    var transport: [16]Engine.Event = undefined;
    var output: [1]reqresp.Event = undefined;
    for (0..24) |_| {
        try pair.pump();
        const received = client.process(&pair.client, pair.events(&pair.client, &transport), pair.now, .{ .application = &.{}, .control = &output });
        for (output[0..received.control]) |event| switch (event) {
            .chunk => |chunk| {
                try std.testing.expectEqualSlices(u8, &ping_bytes, chunk.bytes);
                try std.testing.expect(client.control_reqresp.consume(&pair.client, &client.router, chunk.request, pair.now));
                got_pong = true;
            },
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
        const incoming = server.process(&pair.server, pair.events(&pair.server, &transport), pair.now, .{ .application = &.{}, .control = &output });
        for (output[0..incoming.control]) |event| switch (event) {
            .request => |request| {
                try std.testing.expectEqual(protocol.Protocol.ping_v1, request.protocol);
                try server.control_reqresp.respond(request.request, &ping_bytes, null, pair.now);
            },
            .chunk_sent => |sent| _ = server.control_reqresp.finish(sent.request, pair.now),
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
    }
    try std.testing.expect(got_pong);
    try std.testing.expectEqual(
        1,
        server.reqresp.pump(&pair.server, &server.router, pair.now, &output),
    );
    const request = output[0].request;
    try std.testing.expectEqualSlices(u8, &root, request.bytes);
    const block = [_]u8{0x5a} ** ct.deneb.SignedBeaconBlock.min_size;
    try server.reqresp.respond(request.request, &block, .{ .digest = .{ 1, 2, 3, 4 }, .fork = .deneb }, pair.now);
    for (0..16) |_| {
        try pair.pump();
        _ = client.process(&pair.client, pair.events(&pair.client, &transport), pair.now, .{ .application = &.{}, .control = &output });
        const count = server.process(&pair.server, pair.events(&pair.server, &transport), pair.now, .{ .control = &output }).control;
        for (output[0..count]) |event| {
            if (event == .chunk_sent) _ = server.reqresp.finish(event.chunk_sent.request, pair.now);
        }
    }
    try std.testing.expect(client.reqresp.outbound[app.index].request.pendingEvent() != null);
    try std.testing.expectEqualSlices(u8, &block, sink[0..block.len]);
    try std.testing.expectEqual(
        pair.now.millis() + 60_000,
        schedule_test_support.wakeupMilliseconds(client.reqresp.schedule(0), pair.now.millis()),
    );
    try std.testing.expectEqual(
        pair.now.millis(),
        schedule_test_support.wakeupMilliseconds(client.reqresp.schedule(1), pair.now.millis()),
    );
    try std.testing.expect(client.reqresp.cancel(&pair.client, &client.router, app, pair.now));
    _ = client.reqresp.pump(&pair.client, &client.router, pair.now, &.{});
    try std.testing.expectEqual(
        1,
        client.reqresp.pump(&pair.client, &client.router, pair.now, &output),
    );
    try std.testing.expectEqualSlices(u8, &block, output[0].chunk.bytes);
    try std.testing.expectEqual(app, output[0].chunk.request);
    try std.testing.expectEqual(
        1,
        client.reqresp.pump(&pair.client, &client.router, pair.now, &output),
    );
    try std.testing.expectEqual(app, output[0].failed.request);
}

test "protocol stack routes failed control negotiations without disturbing the application instance" {
    for ([_]bool{ false, true }) |timeout| {
        const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
        defer std.testing.allocator.free(sink);
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        const shared = &setup.shared;
        var active = shared.server.router.capabilities();
        active.receive = .initEmpty();
        active.receive.insert(.{ .reqresp = .blocks_by_root_v2 });
        shared.server.router.setCapabilities(active);
        const root = [_]u8{1} ** 32;
        const application = try shared.client.request(&shared.pair.client, shared.handles.client, .blocks_by_root_v2, &root, sink, .{}, shared.pair.now);
        const status = statusBytes(1);
        var status_sink: [ct.phase0.Status.fixed_size]u8 = undefined;
        const control = try shared.client.control_reqresp.request(&shared.pair.client, &shared.client.router, shared.handles.client, .status_v1, &status, &status_sink, .{ .timeouts = .{ .negotiation = .fromMilliseconds(5) } }, shared.pair.now);
        try std.testing.expectEqual(application, control);
        var applications: [2]Event = undefined;
        var controls: [2]Event = undefined;
        var failed = false;
        for (0..32) |_| {
            const counts = if (timeout) blk: {
                shared.pair.advance(6);
                break :blk shared.client.process(&shared.pair.client, &.{}, shared.pair.now, .{ .application = &applications, .control = &controls });
            } else (try shared.step(.{ .application = &applications, .control = &controls }, .{})).client;
            try std.testing.expectEqual(@as(usize, 0), counts.application);
            if (counts.control == 0) continue;
            try std.testing.expectEqual(@as(usize, 1), counts.control);
            try std.testing.expectEqual(control, controls[0].failed.request);
            const expected: reqresp.Failure = if (timeout) .timeout else .negotiation_rejected;
            try std.testing.expectEqual(expected, controls[0].failed.reason);
            try std.testing.expectEqual(.negotiation, controls[0].failed.phase.?);
            failed = true;
            break;
        }
        try std.testing.expect(failed);
        try std.testing.expect(shared.client.reqresp.outbound[application.index].request.running());
        try std.testing.expectEqual(@as(u16, 1), shared.client.reqresp.pendingCounts().outbound);
        try std.testing.expectEqual(@as(u16, 0), shared.client.control_reqresp.pendingCounts().outbound);
    }
}

test "protocol stack serves pings with the application instance saturated or closed" {
    for ([_]bool{ false, true }) |closed| {
        const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
        defer std.testing.allocator.free(sink);
        var setup: Pair = .{};
        try setup.init(.{ .outbound_max = 1 }, .{ .serving_max = 1 });
        defer setup.deinit();
        const shared = &setup.shared;
        const root = [_]u8{1} ** 32;
        _ = try shared.client.request(&shared.pair.client, shared.handles.client, .blocks_by_root_v2, &root, sink, .{}, shared.pair.now);
        var incoming: ?reqresp.RequestHandle = null;
        var applications: [2]Event = undefined;
        for (0..32) |_| {
            const counts = try shared.step(.{}, .{ .application = &applications });
            if (counts.server.application == 0) continue;
            try std.testing.expectEqual(@as(usize, 1), counts.server.application);
            incoming = applications[0].request.request;
            break;
        }
        try std.testing.expect(incoming != null);
        try std.testing.expectEqual(@as(usize, 1), shared.server.reqresp.resourceSnapshot().serving_occupied);
        try std.testing.expectError(error.SlotsExhausted, shared.client.request(&shared.pair.client, shared.handles.client, .blocks_by_root_v2, &root, sink, .{}, shared.pair.now));
        if (closed) {
            shared.client.closeApplications(&shared.pair.client, shared.pair.now);
            shared.server.closeApplications(&shared.pair.server, shared.pair.now);
        }
        try pingRoundTrip(&setup);
        if (!closed) {
            try std.testing.expectEqual(@as(usize, 1), shared.server.reqresp.resourceSnapshot().serving_occupied);
            try std.testing.expect(shared.server.reqresp.inbound[incoming.?.index].request.running());
            try std.testing.expectEqual(@as(u16, 1), shared.client.reqresp.pendingCounts().outbound);
        }
    }
}

fn pingRoundTrip(setup: *Pair) !void {
    const shared = &setup.shared;
    const bytes = [_]u8{7} ** 8;
    var sink: [8]u8 = undefined;
    const request = try shared.client.control_reqresp.request(&shared.pair.client, &shared.client.router, shared.handles.client, .ping_v1, &bytes, &sink, .{}, shared.pair.now);
    defer _ = shared.client.control_reqresp.cancel(&shared.pair.client, &shared.client.router, request, shared.pair.now);
    var received: usize = 0;
    var chunks: usize = 0;
    var done = false;
    for (0..40) |_| {
        var client: [2]Event = undefined;
        var server: [2]Event = undefined;
        const counts = try shared.step(.{ .control = &client }, .{ .control = &server });
        for (server[0..counts.server.control]) |event| switch (event) {
            .request => |incoming| {
                try std.testing.expectEqual(Protocol.ping_v1, incoming.protocol);
                try std.testing.expectEqualSlices(u8, &bytes, incoming.bytes);
                received += 1;
                try shared.server.control_reqresp.respond(incoming.request, &bytes, null, shared.pair.now);
            },
            .chunk_sent => |sent| try std.testing.expect(shared.server.control_reqresp.finish(sent.request, shared.pair.now)),
            .served => {},
            else => return error.TestUnexpectedResult,
        };
        for (client[0..counts.client.control]) |event| switch (event) {
            .chunk => |chunk| {
                try std.testing.expectEqual(request, chunk.request);
                try std.testing.expectEqualSlices(u8, &bytes, chunk.bytes);
                chunks += 1;
                try std.testing.expect(shared.client.control_reqresp.consume(&shared.pair.client, &shared.client.router, chunk.request, shared.pair.now));
            },
            .done => done = true,
            else => return error.TestUnexpectedResult,
        };
        if (done) break;
    }
    try std.testing.expect(done);
    try std.testing.expectEqual(@as(usize, 1), received);
    try std.testing.expectEqual(@as(usize, 1), chunks);
}

test "protocol stack shutdown retains both instances terminals across graceful application close" {
    for ([_]bool{ false, true }) |graceful| {
        const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
        defer std.testing.allocator.free(sink);
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        const shared = &setup.shared;
        const root = [_]u8{1} ** 32;
        const application = try shared.client.request(&shared.pair.client, shared.handles.client, .blocks_by_root_v2, &root, sink, .{}, shared.pair.now);
        const bytes = [_]u8{7} ** 8;
        var pong: [8]u8 = undefined;
        const control = try shared.client.control_reqresp.request(&shared.pair.client, &shared.client.router, shared.handles.client, .ping_v1, &bytes, &pong, .{}, shared.pair.now);
        try std.testing.expectEqual(application, control);
        var controls: [1]Event = undefined;
        if (graceful) {
            shared.client.closeApplications(&shared.pair.client, shared.pair.now);
            const counts = shared.client.process(&shared.pair.client, &.{}, shared.pair.now, .{ .control = &controls });
            try std.testing.expectEqual(@as(usize, 0), counts.application);
            try std.testing.expectEqual(@as(usize, 0), counts.control);
            try std.testing.expect(shared.client.control_reqresp.outbound[control.index].request.running());
        }
        shared.client.shutdown(&shared.pair.client, shared.pair.now);
        try std.testing.expectEqual(@as(usize, 0), shared.client.router.negotiator.active());
        var applications: [1]Event = undefined;
        try std.testing.expectEqual(@as(usize, 1), shared.client.reqresp.pump(&shared.pair.client, &shared.client.router, shared.pair.now, &applications));
        try std.testing.expectEqual(@as(usize, 1), shared.client.control_reqresp.pump(&shared.pair.client, &shared.client.router, shared.pair.now, &controls));
        try std.testing.expectEqual(application, applications[0].failed.request);
        try std.testing.expectEqual(reqresp.Failure.cancelled, applications[0].failed.reason);
        try std.testing.expectEqual(control, controls[0].failed.request);
        try std.testing.expectEqual(reqresp.Failure.cancelled, controls[0].failed.reason);
        try std.testing.expectEqual(@as(usize, 0), shared.client.reqresp.pump(&shared.pair.client, &shared.client.router, shared.pair.now, &applications));
        try std.testing.expectEqual(@as(usize, 0), shared.client.control_reqresp.pump(&shared.pair.client, &shared.client.router, shared.pair.now, &controls));
        try std.testing.expectEqual(@as(u16, 0), shared.client.reqresp.pendingCounts().outbound);
        try std.testing.expectEqual(@as(u16, 0), shared.client.control_reqresp.pendingCounts().outbound);
    }
}
