const std = @import("std");
const ct = @import("consensus_types");
const rr = @import("ReqResp.zig");
const Protocol = @import("protocol.zig").Protocol;
const harness = @import("test_pair.zig");
const support = @import("../quic/test_support.zig");
const policy = @import("policy_fixture.zig").config;
const Pair = harness.Pair;
const requestStatus = harness.requestStatus;
const requestBlocks = harness.requestBlocks;
const waitForRequest = harness.waitForRequest;
const types = @import("../types.zig");
const admission_fixture = @import("admission_fixture.zig");

fn application(setup: *harness.Pair, which: Protocol, bytes: []const u8, sink: []u8) !rr.RequestHandle {
    return setup.shared.client.reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, which, bytes, sink, .{}, setup.shared.pair.now);
}

test "reqresp admission counts release native slots on terminal delivery" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    const outbound = try application(&setup, .blocks_by_root_v2, &.{}, sink);
    const inbound = (try receive(&setup)).request;
    const client = &setup.shared.client.reqresp;
    const server = &setup.shared.server.reqresp;
    const client_conn = setup.shared.handles.client;
    const server_conn = setup.shared.handles.server;
    try std.testing.expectEqual(1, client.outboundProtocolPendingCount(client_conn, .blocks_by_root_v2));
    try std.testing.expectEqual(1, server.inboundProtocolRunningCount(server_conn, .blocks_by_root_v2));
    try std.testing.expectEqual(1, server.inboundPendingCount(server_conn));
    try std.testing.expect(client.cancel(&setup.shared.pair.client, &setup.shared.client.router, outbound, setup.shared.pair.now));
    try std.testing.expect(server.cancel(&setup.shared.pair.server, &setup.shared.server.router, inbound, setup.shared.pair.now));
    try std.testing.expectEqual(1, client.outboundProtocolPendingCount(client_conn, .blocks_by_root_v2));
    try std.testing.expectEqual(0, server.inboundProtocolRunningCount(server_conn, .blocks_by_root_v2));
    try std.testing.expectEqual(1, server.inboundPendingCount(server_conn));
    try std.testing.expectEqual(1, client.outboundOccupiedCount(client_conn));
    try std.testing.expectEqual(1, server.inboundPendingCount(server_conn));
    try setup.pumpOnce();
    try std.testing.expectEqual(0, client.outboundProtocolPendingCount(client_conn, .blocks_by_root_v2));
    try std.testing.expectEqual(0, server.inboundPendingCount(server_conn));
    try std.testing.expectEqual(0, client.pendingCounts().outbound);
    try std.testing.expectEqual(0, server.pendingCounts().inbound);
    try std.testing.expectEqual(0, client.outboundOccupiedCount(client_conn));
    try std.testing.expectEqual(0, server.inboundPendingCount(server_conn));
}

fn receive(setup: *harness.Pair) !@FieldType(rr.Event, "request") {
    for (0..100) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| {
            if (event == .request) return event.request;
            if (event == .failed) return error.UnexpectedFailure;
        }
    }
    return error.RequestNotDelivered;
}

test "reqresp admission lifecycle incomplete requests cannot consume another connection's receive reservation" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .serving_max = 1 });
    defer setup.deinit();
    for (0..2) |_| {
        const stream = try setup.openRaw(.blocks_by_root_v2);
        try setup.awaitRawSelection(stream, .blocks_by_root_v2);
    }
    try std.testing.expectEqual(@as(u16, 2), setup.shared.server.reqresp.pendingCounts().inbound);
    try std.testing.expectEqual(@as(usize, 0), setup.shared.server.reqresp.resourceSnapshot().serving_occupied);
    // Let gossip on the first connection settle so the dial reports only the new connection.
    for (0..8) |_| try setup.pumpOnce();
    const second = try support.connectPair(&setup.shared.pair);
    setup.shared.handles = .{ .client = second.client, .server = second.server };
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    _ = try application(&setup, .blocks_by_root_v2, &.{}, sink);
    const incoming = try receive(&setup);
    try std.testing.expectEqual(second.server, incoming.conn);
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.reqresp.resourceSnapshot().serving_occupied);
    try std.testing.expectEqual(@as(usize, 2), setup.shared.server.reqresp.resourceSnapshot().inbound_phases[@intFromEnum(rr.metrics.InboundPhase.receiving_request)]);
}

test "reqresp admission lifecycle cancellation retains execution until host retirement" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .serving_max = 1, .serving_per_source_max = 1 });
    defer setup.deinit();
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    const first = try application(&setup, .blocks_by_root_v2, &.{}, sink);
    const incoming = try receive(&setup);
    const owner = &setup.shared.server.reqresp;
    const serving = owner.retainServing(incoming.request) orelse return error.TestUnexpectedResult;
    try std.testing.expect(owner.retainServing(incoming.request) == null);
    const extra = try std.testing.allocator.alloc(u8, Protocol.blob_sidecars_by_root_v1.info().response_max);
    defer std.testing.allocator.free(extra);
    _ = try application(&setup, .blob_sidecars_by_root_v1, &.{}, extra);
    for (0..30) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| try std.testing.expect(event != .request);
    }
    try std.testing.expectEqual(@as(usize, 1), owner.resourceSnapshot().inbound_phases[@intFromEnum(rr.metrics.InboundPhase.ready)]);
    try std.testing.expect(setup.shared.client.reqresp.cancel(&setup.shared.pair.client, &setup.shared.client.router, first, setup.shared.pair.now));
    var terminal = false;
    for (0..30) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| {
            try std.testing.expect(event != .request);
            if (event == .failed and std.meta.eql(event.failed.request, incoming.request)) terminal = true;
        }
    }
    try std.testing.expect(terminal);
    try std.testing.expectEqual(@as(usize, 1), owner.resourceSnapshot().retiring);
    try std.testing.expectEqual(@as(usize, 1), owner.resourceSnapshot().serving_occupied);
    try std.testing.expect(owner.releaseServing(serving));
    try std.testing.expect(!owner.releaseServing(serving));
    const resumed = try receive(&setup);
    try std.testing.expectEqual(Protocol.blob_sidecars_by_root_v1, resumed.protocol);
    try std.testing.expectEqual(@as(usize, 0), owner.resourceSnapshot().retiring);
}

fn allocation(allocator: std.mem.Allocator, protocols: Protocol.Set) !void {
    var owner = try rr.init(allocator, .{
        .protocols = protocols,
        .connections = 2,
        .forks = &.{},
        .admission = try rr.Options.Admission.defaults(&policy(), 1),
        .outbound_max = 2,
        .serving_max = if (protocols.bits & Protocol.Set.application.bits != 0) 2 else 0,
    });
    defer owner.deinit();
    for (0..2) |peer| for (std.enums.values(Protocol)) |which| {
        if (!protocols.contains(which)) continue;
        const first = owner.receive_layout.first(@intCast(peer), which);
        const bounds = owner.policy.requestMaxFor(which);
        try std.testing.expectEqual(bounds, owner.inbound[first].receive.sink.len);
        try std.testing.expectEqual(bounds, owner.inbound[first + 1].receive.sink.len);
    };
}

test "reqresp admission lifecycle control traffic preserves application quota fairness" {
    const quotas = admission_fixture.quotas(4, 1000);
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{
        .serving_max = 2,
        .admission = .{ .policy = policy(), .limits = .{ .source = quotas, .global = quotas } },
    });
    defer setup.deinit();
    for ([_]Protocol{ .blocks_by_root_v2, .blocks_by_root_v2, .ping_v1 }, 0..) |which, peer| {
        const owner = setup.shared.server.requests(which);
        const index = owner.receive_layout.first(@intCast(peer), which);
        const slot = &owner.inbound[index];
        defer owner.settleSlot(.inbound, @intCast(index));
        slot.identity = .{ .bytes = @splat(@as(u8, @intCast(peer + 1))) };
        slot.state = .ready;
        slot.admission.cost = if (peer == 0) 4 else 1;
        slot.progress_ms = setup.shared.pair.now.millis();
        const conn: types.Handle = .{ .index = @intCast(peer), .generation = std.math.maxInt(u32) };
        const endpoint: @import("udp").Address = .{ .ip4 = .{ .octets = .{ 192, 0, @intCast(peer), 1 }, .port = 1 } };
        owner.admission.connected(conn, &.{ .bytes = @splat(1) }, &endpoint, setup.shared.pair.now.millis());
        try std.testing.expectEqual(.allowed, owner.admission.limiter.start(owner.admission.sourceRow(conn), setup.shared.pair.now.millis()));
        slot.request = .{
            .direction = .inbound,
            .generation = 1,
            .completion = .running,
            .protocol = which,
            .conn = conn,
            .stream = .{ .conn = conn, .slot = 0, .id = 0 },
        };
    }
    const owner = &setup.shared.server.reqresp;
    const controls = &setup.shared.server.control_reqresp;
    const heavy = &owner.inbound[owner.receive_layout.first(0, .blocks_by_root_v2)];
    try std.testing.expectEqual(.allowed, owner.admission.limiter.take(owner.admission.sourceRow(heavy.request.conn), .blocks_by_root_v2, 4, .fulu, setup.shared.pair.now.millis()));
    var application_events: [4]rr.Event = undefined;
    var control_events: [4]rr.Event = undefined;
    setup.shared.pair.advance(250);
    const first_control = controls.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &control_events);
    const first = owner.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &application_events);
    try std.testing.expectEqual(@as(usize, 0), first);
    try std.testing.expectEqual(@as(usize, 1), first_control);
    try std.testing.expectEqual(@as(u128, 1), heavy.admission.paid);
    setup.shared.pair.advance(250);
    const second = owner.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &application_events);
    try std.testing.expectEqual(@as(usize, 1), second);
    try std.testing.expectEqual(@as(u16, 1), application_events[0].request.conn.index);
    try std.testing.expectEqual(@as(u128, 1), heavy.admission.paid);
}

test "reqresp admission lifecycle protocol buffers and all startup allocation failures" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocation, .{Protocol.Set.all});
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocation, .{Protocol.Set.control});
}

test "reqresp admission lifecycle a fresh burst starts full requests before splitting residual quota" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{
        .serving_max = 2,
        .admission = .{ .policy = policy(), .limits = .{
            .source = admission_fixture.quotas(4, 1000),
            .global = admission_fixture.quotas(8, 1000),
        } },
    });
    defer setup.deinit();
    const owner = &setup.shared.server.reqresp;
    for (0..4) |peer| {
        const index = owner.receive_layout.first(@intCast(peer), .blocks_by_root_v2);
        const slot = &owner.inbound[index];
        defer owner.settleSlot(.inbound, @intCast(index));
        slot.identity = .{ .bytes = @splat(@as(u8, @intCast(peer + 1))) };
        slot.state = .ready;
        slot.admission.cost = 4;
        slot.progress_ms = setup.shared.pair.now.millis();
        const conn: types.Handle = .{ .index = @intCast(peer), .generation = std.math.maxInt(u32) };
        const endpoint: @import("udp").Address = .{ .ip4 = .{ .octets = .{ 192, 0, @intCast(peer), 1 }, .port = 1 } };
        owner.admission.connected(conn, &.{ .bytes = @splat(1) }, &endpoint, setup.shared.pair.now.millis());
        try std.testing.expectEqual(.allowed, owner.admission.limiter.start(owner.admission.sourceRow(conn), setup.shared.pair.now.millis()));
        slot.request = .{
            .direction = .inbound,
            .generation = 1,
            .completion = .running,
            .protocol = .blocks_by_root_v2,
            .conn = conn,
            .stream = .{ .conn = conn, .slot = 0, .id = 0 },
        };
    }
    var events: [4]rr.Event = undefined;
    const result = owner.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events);
    try std.testing.expectEqual(@as(usize, 2), result);
    try std.testing.expectEqual(@as(u16, 0), events[0].request.conn.index);
    try std.testing.expectEqual(@as(u16, 1), events[1].request.conn.index);
}

fn refused(owner: *const rr, which: Protocol) u64 {
    var total: u64 = 0;
    for (owner.protocol_counters[@intFromEnum(which)].admission_refusals) |count| total += count;
    return total;
}

test "reqresp bounds concurrent requests per protocol on both sides" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    const size = Protocol.blocks_by_range_v2.info().response_max;
    const sinks = try std.testing.allocator.alloc(u8, 3 * size);
    defer std.testing.allocator.free(sinks);
    var request_storage_6: [24]u8 = undefined;
    const first = try requestBlocks(&setup, &request_storage_6, 1, sinks[0..size]);
    var request_storage_7: [24]u8 = undefined;
    _ = try requestBlocks(&setup, &request_storage_7, 1, sinks[size .. 2 * size]);
    var request_storage_8: [24]u8 = undefined;
    const third = requestBlocks(&setup, &request_storage_8, 1, sinks[2 * size ..]);
    try std.testing.expectError(error.TooManyRequests, third);
    var pings: [8]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        .ping_v1,
        &[_]u8{1} ** 8,
        &pings,
        .{},
        setup.shared.pair.now,
    );

    var first_incoming: ?rr.RequestHandle = null;
    for (0..40) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| if (event == .request and event.request.protocol == .blocks_by_range_v2) {
            first_incoming = first_incoming orelse event.request.request;
        };
        if (first_incoming != null and setup.shared.server.reqresp.inboundProtocolRunningCount(setup.shared.handles.server, .blocks_by_range_v2) == 2) break;
    }
    try std.testing.expect(first_incoming != null);
    _ = try setup.openRaw(.blocks_by_range_v2);
    for (0..40) |_| {
        try setup.pumpOnce();
        if (refused(&setup.shared.server.reqresp, .blocks_by_range_v2) > 0) break;
    }
    try std.testing.expectEqual(@as(u64, 1), refused(&setup.shared.server.reqresp, .blocks_by_range_v2));
    try std.testing.expectEqual(@as(u8, 2), setup.shared.server.reqresp.inboundProtocolRunningCount(setup.shared.handles.server, .blocks_by_range_v2));
    try std.testing.expect(setup.shared.server.reqresp.finish(first_incoming.?, setup.shared.pair.now));
    var rounds: usize = 0;
    var done = false;
    rounds = 0;
    while (rounds < 40 and !done) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.clientEvents()) |event| {
            if (event == .done and std.meta.eql(event.done.request, first)) done = true;
        }
    }
    try std.testing.expect(done);
    try setup.pumpOnce();
    var request_storage_9: [24]u8 = undefined;
    _ = try requestBlocks(&setup, &request_storage_9, 1, sinks[2 * size ..]);
}

test "reqresp exhausts outbound slots and per-connection inbound slots" {
    var setup: Pair = .{};
    try setup.init(.{ .control_outbound_max = 1 }, .{ .inbound_per_connection_max = 1 });
    defer setup.deinit();

    var sinks: [2][ct.phase0.Status.fixed_size]u8 = undefined;
    var request_storage_12: [ct.phase0.Status.fixed_size]u8 = undefined;
    _ = try requestStatus(&setup, &request_storage_12, &sinks[0]);
    var request_storage_13: [ct.phase0.Status.fixed_size]u8 = undefined;
    try std.testing.expectError(error.SlotsExhausted, requestStatus(&setup, &request_storage_13, &sinks[1]));
    try waitForRequest(&setup);

    const raw = try setup.openRaw(.ping_v1);
    for (0..10) |_| try setup.pumpOnce();
    try std.testing.expectEqual(@as(u8, 1), setup.shared.server.control_reqresp.inboundPendingCount(setup.shared.handles.server));
    var buffer: [256]u8 = undefined;
    var finished = false;
    for (0..4) |_| {
        const read = try setup.shared.pair.client.read(raw, &buffer);
        try std.testing.expectEqual(@as(?u64, null), read.reset_code);
        if (read.fin) {
            finished = true;
            break;
        }
    }
    try std.testing.expect(finished);
}

test "reqresp request admission host capacity cancellation and queued cancellation retain debt" {
    var setup: Pair = .{};
    try setup.init(.{}, .{
        .admission = .{ .policy = policy(), .limits = .{ .source = admission_fixture.quotas(1, 86_400_000), .global_starts = .{ .tokens = 40, .period_ms = 86_400_000 }, .global = admission_fixture.quotas(100, 86_400_000) } },
    });
    defer setup.deinit();
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    setup.server_event_capacity = 0;
    const outbound = try setup.shared.client.reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .blocks_by_root_v2, &.{}, sink, .{}, setup.shared.pair.now);
    for (0..50) |_| {
        try setup.pumpOnce();
        if (setup.shared.server.reqresp.resourceSnapshot().serving_occupied == 1) break;
    }
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.reqresp.resourceSnapshot().serving_occupied);
    try std.testing.expectEqual(@as(usize, 0), setup.server_count);
    const slot = for (setup.shared.server.reqresp.inbound, 0..) |*candidate, index| {
        if (candidate.request.occupied()) break index;
    } else return error.TestUnexpectedResult;
    const first = &setup.shared.server.reqresp.inbound[slot];
    const incoming = first.request.handle(@intCast(slot));
    try std.testing.expect(first.request.pendingEvent().? == .request);
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.reqresp.resourceSnapshot().inbound_phases[@intFromEnum(rr.metrics.InboundPhase.waiting_host)]);
    try std.testing.expect(setup.shared.server.reqresp.cancel(&setup.shared.pair.server, &setup.shared.server.router, incoming, setup.shared.pair.now));
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.reqresp.resourceSnapshot().inbound_phases[@intFromEnum(rr.metrics.InboundPhase.terminal)]);
    try std.testing.expect(setup.shared.client.reqresp.cancel(&setup.shared.pair.client, &setup.shared.client.router, outbound, setup.shared.pair.now));
    setup.server_event_capacity = 16;
    for (0..4) |_| try setup.pumpOnce();
    try std.testing.expectEqual(@as(u16, 0), setup.shared.server.reqresp.pendingCounts().inbound);
    const queued = try setup.shared.client.reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .blocks_by_root_v2, &.{}, sink, .{}, setup.shared.pair.now);
    var waiting = false;
    for (0..50) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| try std.testing.expect(event != .request);
        if (setup.shared.server.reqresp.inbound[slot].request.running() and setup.shared.server.reqresp.inbound[slot].state == .ready) {
            waiting = true;
            break;
        }
    }
    try std.testing.expect(waiting);
    try std.testing.expectEqual(@as(u64, 0), setup.shared.server.reqresp.protocol_counters[@intFromEnum(Protocol.blocks_by_root_v2)].admission_refusals[@intFromEnum(rr.metrics.AdmissionRefusal.address_quota)]);
    const replacement = &setup.shared.server.reqresp.inbound[slot];
    try std.testing.expect(replacement.request.generation > incoming.generation);
    try std.testing.expectEqual(@as(usize, 0), replacement.request.io.payload.len);
    try std.testing.expect(setup.shared.client.reqresp.cancel(&setup.shared.pair.client, &setup.shared.client.router, queued, setup.shared.pair.now));
    var failed = false;
    for (0..20) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| {
            try std.testing.expect(event != .request);
            if (event == .failed) failed = true;
        }
        if (failed) break;
    }
    try std.testing.expect(failed);
    try setup.pumpOnce();
    try std.testing.expectEqual(@as(u16, 0), setup.shared.server.reqresp.pendingCounts().inbound);
    try std.testing.expectEqual(@as(usize, 0), setup.shared.server.reqresp.resourceSnapshot().pending_events);
}
