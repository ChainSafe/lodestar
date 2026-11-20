const std = @import("std");
const schedule_test_support = @import("../schedule_test_support.zig");
const ct = @import("consensus_types");
const codec = @import("codec.zig");
const protocol = @import("protocol.zig");
const reqresp = @import("ReqResp.zig");
const harness = @import("test_pair.zig");
const Engine = @import("../quic/Engine.zig");
const Router = @import("../router.zig").Router;
const Event = reqresp.Event;
const Protocol = protocol.Protocol;
const Pair = harness.Pair;
const deneb_digest = harness.deneb_digest;
const statusBytes = harness.statusBytes;
const requestBlocks = harness.requestBlocks;
const firstFailure = harness.firstFailure;
const waitForRequest = harness.waitForRequest;
const policy_fixture = @import("policy_fixture.zig");
const time = @import("../time.zig");

test "reqresp fails a request whose peer stops making progress" {
    var setup: Pair = .{};
    try setup.init(.{}, .{ .progress_timeout_ms = 2_000, .host_timeout_ms = 2_000 });
    defer setup.deinit();

    var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
    var request_storage_1: [ct.phase0.Status.fixed_size]u8 = undefined;
    request_storage_1 = statusBytes(5);
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .status_v1, &request_storage_1, &sink, .{ .timeouts = .{ .response = .fromMilliseconds(2000) } }, setup.shared.pair.now);
    try waitForRequest(&setup);

    setup.shared.pair.advance(1_000);
    try setup.pumpOnce();
    try std.testing.expect(firstFailure(setup.clientEvents()) == null);
    setup.shared.pair.advance(1_500);
    var client_failure: ?reqresp.Failure = null;
    var server_failure: ?reqresp.Failure = null;
    var rounds: usize = 0;
    while (rounds < 10 and (client_failure == null or server_failure == null)) : (rounds += 1) {
        try setup.pumpOnce();
        if (firstFailure(setup.clientEvents())) |failure| client_failure = failure;
        if (firstFailure(setup.serverEvents())) |failure| server_failure = failure;
    }
    try std.testing.expect(client_failure != null and client_failure.? == .timeout);
    try std.testing.expect(server_failure != null);
    try std.testing.expect(server_failure.? == .host_timeout or server_failure.? == .stream_closed);
    try setup.pumpOnce();
    try std.testing.expectEqual(@as(u16, 0), setup.shared.client.control_reqresp.pendingCounts().outbound);
    try std.testing.expectEqual(@as(u16, 0), setup.shared.server.control_reqresp.pendingCounts().inbound);
    const counts = &setup.shared.client.control_reqresp.protocol_counters[@intFromEnum(Protocol.status_v1)];
    try std.testing.expectEqual(@as(u64, 1), counts.outgoing_time.count);
    try std.testing.expect(counts.outgoing_time.sum >= 2500);
    try std.testing.expectEqual(@as(u64, 1), setup.shared.client.control_reqresp.outgoing_error_reasons[@intFromEnum(reqresp.metrics.ErrorReason.REQUEST_ERROR_RESP_TIMEOUT)]);
}

test "reqresp negotiated handoff starts a fresh progress interval" {
    var setup: Pair = .{};
    try setup.init(.{ .progress_timeout_ms = 1000 }, .{});
    defer setup.deinit();
    _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    var ready = false;
    for (0..30) |_| {
        try setup.shared.pair.pump();
        var storage: [16]Engine.Event = undefined;
        setup.shared.server.router.transportEvents(&setup.shared.pair.server, setup.shared.pair.events(&setup.shared.pair.server, &storage), setup.shared.pair.now);
        var outcomes: [8]Router.Outcome = undefined;
        setup.forwardEvents();
        _ = setup.shared.server.router.pump(&setup.shared.pair.server, setup.shared.pair.now, &outcomes);
        setup.forwardEvents();
        const count = setup.shared.client.router.pump(&setup.shared.pair.client, setup.shared.pair.now, &outcomes);
        if (count == 0) continue;
        try std.testing.expectEqual(@as(usize, 1), count);
        setup.shared.pair.advance(2000);
        try std.testing.expect(setup.shared.client.control_reqresp.negotiated(&setup.shared.pair.client, &setup.shared.client.router, outcomes[0], setup.shared.pair.now));
        try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(1), setup.shared.pair.now.millis()));
        ready = true;
        break;
    }
    try std.testing.expect(ready);
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 0), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    try std.testing.expect(setup.shared.client.control_reqresp.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
}

test "reqresp admission wait expires as local policy and not peer timeout" {
    var admission = try reqresp.Options.Admission.defaults(&policy_fixture.config(), 2);
    admission.limits.source.protocols[@intFromEnum(Protocol.ping_v1)] = .{ .tokens = 1, .period_ms = 5000 };
    var setup: Pair = .{};
    try setup.init(.{}, .{ .quota_timeout_ms = 1000, .admission = admission });
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sinks: [2][8]u8 = undefined;
    for (&sinks) |*sink| _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, sink, .{}, setup.shared.pair.now);
    var requested: u32 = 0;
    for (0..30) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                try setup.shared.server.control_reqresp.respond(incoming.request, &bytes, null, setup.shared.pair.now);
                requested += 1;
            },
            else => {},
        };
    }
    try std.testing.expectEqual(@as(u32, 1), requested);
    var ready: usize = 0;
    for (setup.shared.server.control_reqresp.inbound) |*slot| ready += @intFromBool(slot.request.running() and slot.state == .ready);
    try std.testing.expectEqual(@as(usize, 1), ready);
    try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis() + 1000), schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(0), setup.shared.pair.now.millis()));
    setup.shared.pair.advance(1000);
    var events: [4]Event = undefined;
    const count = setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events);
    var expired = false;
    for (events[0..count]) |event| if (event == .failed) {
        try std.testing.expect(event.failed.reason == .quota_timeout);
        try std.testing.expect(event.peerFault() == null);
        expired = true;
    };
    try std.testing.expect(expired);
}

test "reqresp blocked response writes expire and do not advertise ready local work" {
    var setup: Pair = .{};
    try setup.init(.{}, .{ .progress_timeout_ms = 2000 });
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    try waitForRequest(&setup);
    const incoming = setup.serverEvents()[0].request.request;
    const stream = setup.shared.server.control_reqresp.inbound[incoming.index].request.stream;
    const padding = [_]u8{0} ** 65536;
    var blocked = false;
    for (0..1024) |_| {
        _ = setup.shared.pair.server.write(stream, &padding, false) catch |err| switch (err) {
            error.WouldBlock => {
                blocked = true;
                break;
            },
            else => return err,
        };
    }
    try std.testing.expect(blocked);
    try setup.shared.server.control_reqresp.respond(incoming, &bytes, null, setup.shared.pair.now);
    try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(0), setup.shared.pair.now.millis()));
    const due = setup.shared.pair.now.millis() + 2000;
    for (0..3) |_| {
        setup.shared.pair.advance(500);
        _ = setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &.{});
        try std.testing.expectEqual(@as(?u64, due), schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(0), setup.shared.pair.now.millis()));
    }
    setup.shared.pair.advance(500);
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events));
    try std.testing.expect(events[0].failed.reason == .timeout);
    try std.testing.expect(!setup.shared.pair.server.registry.slots[stream.conn.index].table.matches(stream.slot, stream.id));
}

test "reqresp absolute response deadline captures the live phase" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    setup.shared.pair.now.monotonic.raw.nanoseconds += 900_000;
    const started_ms = setup.shared.pair.now.millis();
    const request = statusBytes(5);
    var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
    const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .status_v1, &request, &sink, .{
        .timeouts = .{ .negotiation = .fromMilliseconds(5_000), .request = .fromMilliseconds(5_000), .response = .fromNanoseconds(500_000) },
    }, setup.shared.pair.now);
    try waitForRequest(&setup);
    const due = setup.shared.client.control_reqresp.outbound[handle.index].deadline().?;
    try std.testing.expectEqual(started_ms + 2, due);
    setup.shared.pair.now.monotonic = time.milliseconds(due - 1);
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 0), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    setup.shared.pair.now.monotonic = time.milliseconds(due);
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    try std.testing.expectEqual(.timeout, events[0].failed.reason);
    try std.testing.expectEqual(.response, events[0].failed.phase.?);
}

test "reqresp absolute request phase expires under real stream backpressure" {
    var setup: Pair = .{};
    try setup.init(.{ .progress_timeout_ms = 2_000 }, .{});
    defer setup.deinit();
    setup.shared.pair.now.monotonic.raw.nanoseconds += 900_000;
    _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
    const request = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try setup.shared.client.control_reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        .ping_v1,
        &request,
        &sink,
        .{ .timeouts = .{ .negotiation = .fromMilliseconds(5000), .request = .fromNanoseconds(2_000_500_000), .response = .fromMilliseconds(10000) } },
        setup.shared.pair.now,
    );
    var negotiated = false;
    for (0..50) |_| {
        try setup.shared.pair.pump();
        var storage: [16]Engine.Event = undefined;
        for (setup.shared.pair.events(&setup.shared.pair.server, &storage)) |event| switch (event) {
            .stream_opened => |stream| try setup.shared.server.router.negotiator.acceptInbound(
                &setup.shared.pair.server,
                stream,
                setup.shared.pair.now,
            ),
            else => {},
        };
        var outcomes: [8]Router.Outcome = undefined;
        setup.forwardEvents();
        const listened = setup.shared.server.router.pump(&setup.shared.pair.server, setup.shared.pair.now, &outcomes);
        for (outcomes[0..listened]) |outcome| try std.testing.expect(outcome.result == .ready);
        setup.forwardEvents();
        const dialed = setup.shared.client.router.pump(&setup.shared.pair.client, setup.shared.pair.now, &outcomes);
        for (outcomes[0..dialed]) |outcome| {
            try std.testing.expect(outcome.result == .ready);
            negotiated = setup.shared.client.control_reqresp.negotiated(&setup.shared.pair.client, &setup.shared.client.router, outcome, setup.shared.pair.now);
        }
        if (negotiated) break;
    }
    try std.testing.expect(negotiated);
    const stream = setup.shared.client.control_reqresp.outbound[handle.index].request.stream;
    const padding = [_]u8{0} ** 65536;
    var blocked = false;
    for (0..1024) |_| {
        _ = setup.shared.pair.client.write(stream, &padding, false) catch |err| switch (err) {
            error.WouldBlock => {
                blocked = true;
                break;
            },
            else => return err,
        };
    }
    try std.testing.expect(blocked);
    const deadline_ms = setup.shared.client.control_reqresp.outbound[handle.index].deadline();
    try std.testing.expectEqual(setup.shared.pair.now.millis() + 2002, deadline_ms.?);
    var events: [8]Event = undefined;
    _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events);
    try setup.shared.pair.flush(&setup.shared.pair.client);
    var stale = stream;
    stale.conn.generation += 1;
    setup.shared.client.control_reqresp.streamReady(setup.shared.pair.client.route(stream).?, stale);
    for (0..3) |_| {
        setup.shared.pair.advance(500);
        try std.testing.expectEqual(
            @as(usize, 0),
            setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events),
        );
        try std.testing.expectEqual(deadline_ms, setup.shared.client.control_reqresp.outbound[handle.index].deadline());
        try std.testing.expect(!setup.shared.pair.client.backlog());
    }
    setup.shared.pair.now.monotonic = time.milliseconds(deadline_ms.?);
    try std.testing.expectEqual(
        @as(usize, 1),
        setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events),
    );
    try std.testing.expect(events[0].failed.reason == .timeout);
    try std.testing.expectEqual(.request, events[0].failed.phase.?);
    try std.testing.expect(
        !setup.shared.pair.client.registry.slots[stream.conn.index].table.matches(stream.slot, stream.id),
    );
}

test "reqresp sub-millisecond negotiation timeout agrees with the router deadline" {
    for ([_]bool{ false, true }) |router_first| {
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        setup.shared.pair.now.monotonic.raw.nanoseconds += 900_000;
        const started_ms = setup.shared.pair.now.millis();
        const request = statusBytes(5);
        var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
        const handle = try setup.shared.client.control_reqresp.request(
            &setup.shared.pair.client,
            &setup.shared.client.router,
            setup.shared.handles.client,
            .status_v1,
            &request,
            &sink,
            .{ .timeouts = .{ .negotiation = .fromNanoseconds(500_000) } },
            setup.shared.pair.now,
        );
        var outcomes: [1]Router.Outcome = undefined;
        var events: [1]Event = undefined;
        setup.shared.pair.now.monotonic = time.milliseconds(started_ms + 1);
        if (router_first) try std.testing.expectEqual(@as(usize, 0), setup.shared.client.router.pump(&setup.shared.pair.client, setup.shared.pair.now, &outcomes));
        try std.testing.expectEqual(@as(usize, 0), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
        setup.shared.pair.now.monotonic = time.milliseconds(started_ms + 2);
        if (router_first) {
            try std.testing.expectEqual(@as(usize, 1), setup.shared.client.router.pump(&setup.shared.pair.client, setup.shared.pair.now, &outcomes));
            try std.testing.expectEqual(.timeout, outcomes[0].result.failed);
            try std.testing.expect(setup.shared.client.control_reqresp.negotiated(&setup.shared.pair.client, &setup.shared.client.router, outcomes[0], setup.shared.pair.now));
        }
        try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
        try std.testing.expectEqual(handle, events[0].failed.request);
        try std.testing.expectEqual(.timeout, events[0].failed.reason);
        try std.testing.expectEqual(.negotiation, events[0].failed.phase.?);
    }
}

test "reqresp absolute negotiation timeout phase survives terminal cleanup" {
    for ([_]u64{ 50, 20_000 }) |duration| {
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        const request = statusBytes(5);
        var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
        const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .status_v1, &request, &sink, .{ .timeouts = .{ .negotiation = .fromMilliseconds(@intCast(duration)), .request = .fromMilliseconds(5000), .response = .fromMilliseconds(10000) } }, setup.shared.pair.now);
        const stream = setup.shared.client.control_reqresp.outbound[handle.index].request.stream;
        try std.testing.expectEqual(@as(usize, 1), setup.shared.client.router.negotiator.active());
        const due = setup.shared.pair.now.millis() + duration;
        var events: [1]Event = undefined;
        _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events);
        setup.shared.pair.now.monotonic = time.milliseconds(due - 1);
        try std.testing.expectEqual(@as(usize, 0), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
        setup.shared.pair.now.monotonic = time.milliseconds(due);
        try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
        try std.testing.expectEqual(handle, events[0].failed.request);
        try std.testing.expectEqual(.timeout, events[0].failed.reason);
        try std.testing.expectEqual(.negotiation, events[0].failed.phase.?);
        try std.testing.expectEqual(@as(usize, 0), setup.shared.client.router.negotiator.active());
        try std.testing.expect(!setup.shared.pair.client.registry.slots[stream.conn.index].table.matches(stream.slot, stream.id));
    }
}

test "reqresp absolute response includes paused host time without renewing at chunks or consume" {
    for ([_]bool{ false, true }) |consume| {
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
        defer std.testing.allocator.free(sink);
        const block = [_]u8{7} ** 4000;
        const roots = [_]u8{0} ** 64;
        const handle = try setup.shared.client.reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .blocks_by_root_v2, &roots, sink, .{ .timeouts = .{ .negotiation = .fromMilliseconds(5000), .request = .fromMilliseconds(5000), .response = .fromMilliseconds(1000) } }, setup.shared.pair.now);
        var held = false;
        for (0..80) |_| {
            try setup.pumpOnce();
            for (setup.serverEvents()) |event| if (event == .request) try setup.shared.server.reqresp.respond(event.request.request, &block, .{ .digest = deneb_digest, .fork = .deneb }, setup.shared.pair.now);
            for (setup.clientEvents()) |event| if (event == .chunk) {
                held = true;
            };
            if (held) break;
        }
        try std.testing.expect(held);
        const due = setup.shared.client.reqresp.outbound[handle.index].deadline().?;
        setup.shared.pair.now.monotonic = time.milliseconds(due - 1);
        if (consume) try std.testing.expect(setup.shared.client.reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
        try std.testing.expectEqual(@as(?u64, due), setup.shared.client.reqresp.outbound[handle.index].deadline());
        var events: [1]Event = undefined;
        try std.testing.expectEqual(@as(usize, 0), setup.shared.client.reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
        setup.shared.pair.now.monotonic = time.milliseconds(due);
        try std.testing.expectEqual(@as(usize, 1), setup.shared.client.reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
        try std.testing.expectEqual(if (consume) std.meta.Tag(reqresp.Failure).timeout else .host_timeout, std.meta.activeTag(events[0].failed.reason));
        try std.testing.expectEqual(.response, events[0].failed.phase.?);
    }
}

test "reqresp partial response bytes cannot renew the completion deadline" {
    for ([_]u64{ 100, 10_000 }) |duration| {
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        const request = statusBytes(5);
        var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
        const options: reqresp.RequestOptions = if (duration == 100) .{ .timeouts = .{ .response = .fromMilliseconds(@intCast(duration)) } } else .{};
        const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .status_v1, &request, &sink, options, setup.shared.pair.now);
        try waitForRequest(&setup);
        const due = setup.shared.client.control_reqresp.outbound[handle.index].deadline().?;
        const stream = setup.shared.server.control_reqresp.inbound[0].request.stream;
        var wire: [codec.frame_scratch_max]u8 = undefined;
        const encoded = try codec.encodeChunk(0, null, &request, &wire);
        try std.testing.expect(encoded.len > 10);
        var events: [1]Event = undefined;
        for (0..9) |i| {
            setup.shared.pair.now.monotonic = time.milliseconds(due - 90 + i * 10);
            try std.testing.expectEqual(@as(usize, 1), try setup.shared.pair.server.write(stream, encoded[i .. i + 1], false));
            try setup.shared.pair.pump();
            harness.forward(&setup.shared.pair, &setup.shared.pair.client, &setup.shared.client.control_reqresp);
            try std.testing.expectEqual(@as(usize, 0), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
            try std.testing.expectEqual(@as(?u64, due), setup.shared.client.control_reqresp.outbound[handle.index].deadline());
        }
        setup.shared.pair.now.monotonic = time.milliseconds(due);
        const count = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events);
        try std.testing.expectEqual(@as(usize, 1), count);
        try std.testing.expectEqual(.timeout, events[0].failed.reason);
        try std.testing.expectEqual(.response, events[0].failed.phase.?);
    }
}

test "reqresp partial response writes cannot renew the chunk deadline" {
    var setup: Pair = .{};
    try setup.init(.{}, .{ .progress_timeout_ms = 2000 });
    defer setup.deinit();
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_range_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    var request: [24]u8 = undefined;
    _ = try requestBlocks(&setup, &request, 1, sink);
    try waitForRequest(&setup);
    const incoming = setup.serverEvents()[0].request.request;
    const slot = &setup.shared.server.reqresp.inbound[incoming.index];
    const payload = try std.testing.allocator.alloc(u8, 1024 * 1024);
    defer std.testing.allocator.free(payload);
    var random = std.Random.DefaultPrng.init(1);
    random.random().bytes(payload);
    try setup.shared.server.reqresp.respond(incoming, payload, .{ .digest = deneb_digest, .fork = .deneb }, setup.shared.pair.now);
    const due = slot.deadline(&setup.shared.server.reqresp).?;
    const before = try setup.shared.pair.server.streamCapacity(slot.request.stream);
    setup.shared.pair.advance(500);
    _ = setup.shared.server.reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &.{});
    try std.testing.expect((try setup.shared.pair.server.streamCapacity(slot.request.stream)) < before);
    try std.testing.expect(slot.request.io.writing);
    try std.testing.expectEqual(due, slot.deadline(&setup.shared.server.reqresp).?);
    setup.shared.pair.advance(1500);
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events));
    try std.testing.expect(events[0].failed.reason == .timeout);
}

test "reqresp serving expires across progressing chunks without blaming host work on the peer" {
    var setup: Pair = .{};
    try setup.init(.{}, .{ .progress_timeout_ms = 80, .host_timeout_ms = 80 });
    defer setup.deinit();
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_range_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    var request: [24]u8 = undefined;
    const outbound = try requestBlocks(&setup, &request, 4, sink);
    try waitForRequest(&setup);
    const incoming = setup.serverEvents()[0].request.request;
    const started = setup.shared.pair.now.millis();
    const block: [5000]u8 = @splat(0);
    for (0..2) |_| {
        setup.shared.pair.advance(60);
        try setup.shared.server.reqresp.respond(incoming, &block, .{ .digest = deneb_digest, .fork = .deneb }, setup.shared.pair.now);
        var sent = false;
        var received = false;
        for (0..30) |_| {
            try setup.pumpOnce();
            for (setup.serverEvents()) |event| if (event == .chunk_sent) {
                sent = true;
            };
            for (setup.clientEvents()) |event| if (event == .chunk) {
                received = true;
                try std.testing.expect(setup.shared.client.reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, outbound, setup.shared.pair.now));
            };
            if (sent and received) break;
        }
        try std.testing.expect(sent and received);
    }
    setup.shared.pair.now.monotonic = time.milliseconds(started + 160);
    try setup.pumpOnce();
    try std.testing.expectEqual(reqresp.Failure.host_timeout, firstFailure(setup.serverEvents()).?);
    try std.testing.expect(setup.serverEvents()[0].peerFault() == null);
    for (0..3) |_| try setup.pumpOnce();
    try std.testing.expectEqual(@as(u16, 0), setup.shared.server.reqresp.pendingCounts().inbound);
}

fn receiveResponseChunk(setup: *Pair) !void {
    for (0..256) |_| {
        try setup.pumpOnce();
        for (setup.clientEvents()) |event| if (event == .chunk) return;
    }
    return error.MissingChunk;
}

test "reqresp completed chunks extend credit but partial responses cannot renew it" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const which = Protocol.blocks_by_root_v2;
    const sink = try std.testing.allocator.alloc(u8, which.info().response_max);
    defer std.testing.allocator.free(sink);
    const roots: [64]u8 = @splat(0);
    const handle = try setup.shared.client.reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        which,
        &roots,
        sink,
        .{},
        setup.shared.pair.now,
    );
    try waitForRequest(&setup);
    const incoming = setup.serverEvents()[0].request.request;
    const stream = setup.shared.server.reqresp.inbound[incoming.index].request.stream;
    const client = &setup.shared.client.reqresp.outbound[handle.index];
    const initial = client.deadline().?;
    const payload: [128 * 1024]u8 = @splat(7);
    const wire = try std.testing.allocator.alloc(u8, codec.encodedLengthMax(payload.len));
    defer std.testing.allocator.free(wire);
    const encoded = try codec.encodeChunk(0, deneb_digest, &payload, wire);
    setup.shared.pair.now.monotonic = time.milliseconds(initial - 2_000);
    const partial = encoded[0 .. encoded.len - 1];
    try std.testing.expectEqual(partial.len, try setup.shared.pair.server.write(stream, partial, false));
    for (0..4) |_| try setup.pumpOnce();
    try std.testing.expectEqual(@as(u32, 0), client.request.chunks);
    try std.testing.expectEqual(@as(?u64, initial), client.deadline());
    try std.testing.expectEqual(@as(usize, 1), try setup.shared.pair.server.write(
        stream,
        encoded[encoded.len - 1 ..],
        false,
    ));
    try receiveResponseChunk(&setup);
    try std.testing.expectEqual(initial + 125, client.response_budget.deadline_ms);
    try std.testing.expect(setup.shared.client.reqresp.consume(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        handle,
        setup.shared.pair.now,
    ));
    try std.testing.expectEqual(@as(?u64, initial + 125), client.deadline());
    var events: [1]Event = undefined;
    setup.shared.pair.now.monotonic = time.milliseconds(initial + 1);
    try std.testing.expectEqual(@as(usize, 0), setup.shared.client.reqresp.pump(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.pair.now,
        &events,
    ));
    setup.shared.pair.now.monotonic = time.milliseconds(initial + 125);
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.reqresp.pump(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.pair.now,
        &events,
    ));
    try std.testing.expectEqual(.timeout, events[0].failed.reason);
    try std.testing.expectEqual(.non_completion, events[0].peerFault().?.kind);
}

test "reqresp host holds pause chunk credit and late consumption cannot revive a request" {
    for ([_]bool{ false, true }) |late| {
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        const which = Protocol.blocks_by_root_v2;
        const sink = try std.testing.allocator.alloc(u8, which.info().response_max);
        defer std.testing.allocator.free(sink);
        const roots: [64]u8 = @splat(0);
        const handle = try setup.shared.client.reqresp.request(
            &setup.shared.pair.client,
            &setup.shared.client.router,
            setup.shared.handles.client,
            which,
            &roots,
            sink,
            .{},
            setup.shared.pair.now,
        );
        try waitForRequest(&setup);
        const incoming = setup.serverEvents()[0].request.request;
        try setup.shared.server.reqresp.respond(
            incoming,
            &(@as([4000]u8, @splat(7))),
            .{ .digest = deneb_digest, .fork = .deneb },
            setup.shared.pair.now,
        );
        try receiveResponseChunk(&setup);
        const client = &setup.shared.client.reqresp.outbound[handle.index];
        const due = client.response_budget.deadline_ms;
        const held_at = client.host_hold_started_ms.?;
        const limit = client.response_budget.limit_ms;
        try std.testing.expectEqual(@as(?u64, limit), client.deadline());
        setup.shared.pair.now.monotonic = time.milliseconds(if (late) limit else held_at + 15_000);
        try std.testing.expect(setup.shared.client.reqresp.consume(
            &setup.shared.pair.client,
            &setup.shared.client.router,
            handle,
            setup.shared.pair.now,
        ));
        if (!late) {
            try std.testing.expectEqual(@as(?u64, due + 15_000), client.deadline());
            try std.testing.expectEqual(limit, client.response_budget.limit_ms);
            setup.shared.pair.now.monotonic = time.milliseconds(due + 15_000);
        }
        var events: [1]Event = undefined;
        try std.testing.expectEqual(@as(usize, 1), setup.shared.client.reqresp.pump(
            &setup.shared.pair.client,
            &setup.shared.client.router,
            setup.shared.pair.now,
            &events,
        ));
        try std.testing.expectEqual(if (late) std.meta.Tag(reqresp.Failure).host_timeout else .timeout, std.meta.activeTag(events[0].failed.reason));
        try std.testing.expect(events[0].peerFault() == null);
    }
}

test "reqresp progressing chunks reach the absolute limit without a peer fault" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const which = Protocol.blocks_by_root_v2;
    const sink = try std.testing.allocator.alloc(u8, which.info().response_max);
    defer std.testing.allocator.free(sink);
    const payload = try std.testing.allocator.alloc(u8, 9 * 1024 * 1024);
    defer std.testing.allocator.free(payload);
    @memset(payload, 7);
    const roots: [96]u8 = @splat(0);
    const handle = try setup.shared.client.reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        which,
        &roots,
        sink,
        .{ .timeouts = .{ .response = .fromSeconds(20) } },
        setup.shared.pair.now,
    );
    try waitForRequest(&setup);
    const incoming = setup.serverEvents()[0].request.request;
    const client = &setup.shared.client.reqresp.outbound[handle.index];
    const limit = client.response_budget.limit_ms;
    for ([_]u64{ limit - 11_000, limit - 2_000 }) |at| {
        setup.shared.pair.now.monotonic = time.milliseconds(at);
        try setup.shared.server.reqresp.respond(
            incoming,
            payload,
            .{ .digest = deneb_digest, .fork = .deneb },
            setup.shared.pair.now,
        );
        try receiveResponseChunk(&setup);
        try std.testing.expect(setup.shared.client.reqresp.consume(
            &setup.shared.pair.client,
            &setup.shared.client.router,
            handle,
            setup.shared.pair.now,
        ));
    }
    try std.testing.expectEqual(@as(u32, 2), client.request.chunks);
    try std.testing.expectEqual(@as(u64, 0), client.host_held_ms);
    try std.testing.expectEqual(@as(?u64, limit), client.deadline());
    setup.shared.pair.now.monotonic = time.milliseconds(limit);
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.reqresp.pump(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.pair.now,
        &events,
    ));
    try std.testing.expectEqual(.timeout, events[0].failed.reason);
    try std.testing.expect(events[0].peerFault() == null);
}

test "reqresp rejected response chunks cannot earn time credit" {
    const Case = enum { peer_error, excess_chunk, corrupt };
    for (std.enums.values(Case)) |case| {
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        const which = Protocol.blocks_by_root_v2;
        const sink = try std.testing.allocator.alloc(u8, which.info().response_max);
        defer std.testing.allocator.free(sink);
        const roots: [32]u8 = @splat(0);
        const handle = try setup.shared.client.reqresp.request(
            &setup.shared.pair.client,
            &setup.shared.client.router,
            setup.shared.handles.client,
            which,
            &roots,
            sink,
            .{ .expected_chunks = if (case == .excess_chunk) 0 else null },
            setup.shared.pair.now,
        );
        try waitForRequest(&setup);
        const incoming = setup.serverEvents()[0].request.request;
        const stream = setup.shared.server.reqresp.inbound[incoming.index].request.stream;
        const client = &setup.shared.client.reqresp.outbound[handle.index];
        const before = client.response_budget;
        setup.shared.pair.now.monotonic = time.milliseconds(before.deadline_ms - 100);
        const payload: [4000]u8 = @splat(7);
        var wire: [codec.frame_scratch_max]u8 = undefined;
        const encoded = try codec.encodeChunk(
            if (case == .peer_error) 2 else 0,
            if (case == .peer_error) null else deneb_digest,
            if (case == .peer_error) "oops" else &payload,
            &wire,
        );
        if (case == .corrupt) {
            const identifier = std.mem.find(u8, encoded, &codec.identifier).?;
            wire[identifier + codec.identifier.len + codec.frame_header_length] ^= 1;
        }
        try std.testing.expectEqual(encoded.len, try setup.shared.pair.server.write(stream, encoded, false));
        var failure: ?reqresp.Failure = null;
        for (0..40) |_| {
            try setup.pumpOnce();
            failure = firstFailure(setup.clientEvents());
            if (failure != null) break;
        }
        const expected: std.meta.Tag(reqresp.Failure) = switch (case) {
            .peer_error => .peer_error,
            .excess_chunk => .too_many_chunks,
            .corrupt => .invalid_response,
        };
        try std.testing.expectEqual(expected, std.meta.activeTag(failure orelse return error.MissingFailure));
        try std.testing.expectEqualDeep(before, client.response_budget);
    }
}
