const std = @import("std");
const schedule_test_support = @import("../schedule_test_support.zig");
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
const waitForRequest = harness.waitForRequest;
const StreamOwner = @import("../types.zig").StreamOwner;

test "reqresp wakeup distinguishes host and quota waits and bounds idle scans" {
    var setup: Pair = .{};
    try setup.init(.{}, .{ .host_timeout_ms = 2000 });
    defer setup.deinit();
    setup.shared.client.control_reqresp.options.work_per_pump_max = 1;
    for (0..16) |_| _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(1), setup.shared.pair.now.millis()));
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    setup.shared.client.control_reqresp.options.work_per_pump_max = 32;
    try waitForRequest(&setup);
    const due = setup.shared.pair.now.millis() + 2000;
    try std.testing.expectEqual(@as(?u64, due), schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(1), setup.shared.pair.now.millis()));
    setup.shared.pair.advance(2000);
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events));
    try std.testing.expect(events[0].failed.reason == .host_timeout);
    try std.testing.expect(events[0].peerFault() == null);
}

test "reqresp terminal notification rotates fairly and exhausted generations never wrap" {
    var setup: Pair = .{};
    try setup.init(.{ .outbound_max = 2 }, .{});
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sinks: [2][8]u8 = undefined;
    var handles: [2]reqresp.RequestHandle = undefined;
    for (&handles, 0..) |*handle, index| handle.* = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sinks[index], .{}, setup.shared.pair.now);
    setup.shared.client.control_reqresp.cancelAll(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now);
    var seen = [_]bool{false} ** 2;
    var events: [1]Event = undefined;
    for (0..2) |_| {
        try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
        const index = events[0].failed.request.index;
        try std.testing.expect(!seen[index]);
        seen[index] = true;
    }
    _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
    for (setup.shared.client.control_reqresp.outbound) |*slot| slot.request.generation = std.math.maxInt(u32);
    try std.testing.expectError(error.SlotsExhausted, setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sinks[0], .{}, setup.shared.pair.now));
}

test "reqresp terminal pressure quiesces without capacity and wakes when host unblocks" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    try std.testing.expect(setup.shared.client.control_reqresp.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(0), setup.shared.pair.now.millis()));
    _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(0), setup.shared.pair.now.millis()));
    try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(1), setup.shared.pair.now.millis()));
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    try std.testing.expect(events[0].failed.reason == .cancelled);
    _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(0), setup.shared.pair.now.millis()));
}

test "reqresp empty capacity does not delay buffered response chunks" {
    var setup: Pair = .{};
    try setup.init(.{ .outbound_max = 64, .serving_max = 64 }, .{});
    defer setup.deinit();
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    const handle = try setup.shared.client.reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .blocks_by_root_v2, &([_]u8{0} ** 64), sink, .{}, setup.shared.pair.now);
    try waitForRequest(&setup);
    const stream = setup.shared.server.reqresp.inbound[setup.serverEvents()[0].request.request.index].request.stream;
    const first = [_]u8{1} ** 3000;
    const second = [_]u8{2} ** 3000;
    var wire: [codec.frame_scratch_max]u8 = undefined;
    const a = try codec.encodeChunk(0, deneb_digest, &first, &wire);
    const b = try codec.encodeChunk(0, deneb_digest, &second, wire[a.len..]);
    const length = a.len + b.len;
    try std.testing.expectEqual(length, try setup.shared.pair.server.write(stream, wire[0..length], false));
    try setup.shared.pair.pump();
    setup.forwardEvents();
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    try std.testing.expectEqualSlices(u8, &first, events[0].chunk.bytes);
    setup.shared.client.reqresp.options.work_per_pump_max = 1;
    _ = setup.shared.client.reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
    try std.testing.expect(setup.shared.client.reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    const due = schedule_test_support.wakeupMilliseconds(setup.shared.client.reqresp.schedule(1), setup.shared.pair.now.millis());
    try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), due);
    const count = setup.shared.client.reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events);
    try std.testing.expectEqual(@as(usize, 1), count);
    try std.testing.expectEqualSlices(u8, &second, events[0].chunk.bytes);
    try std.testing.expect(setup.shared.client.reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
}

test "reqresp host response retains write work behind a partial cursor" {
    var setup: Pair = .{};
    try setup.init(.{}, .{ .outbound_max = 1, .serving_max = 2 });
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    try waitForRequest(&setup);
    const incoming = setup.serverEvents()[0].request.request;
    setup.shared.server.control_reqresp.options.work_per_pump_max = 1;
    for (0..2) |_| _ = setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &.{});
    try setup.shared.server.control_reqresp.respond(incoming, &bytes, null, setup.shared.pair.now);
    var events: [1]Event = undefined;
    var sent = false;
    for (0..10) |_| {
        try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(1), setup.shared.pair.now.millis()));
        const count = setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events);
        if (count == 1) {
            try std.testing.expect(events[0] == .chunk_sent);
            sent = true;
            break;
        }
    }
    try std.testing.expect(sent);
    try std.testing.expect(setup.shared.server.control_reqresp.finish(incoming, setup.shared.pair.now));
    var done = false;
    for (0..4) |_| {
        try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(1), setup.shared.pair.now.millis()));
        if (setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events) == 1) {
            try std.testing.expect(events[0] == .served);
            done = true;
            break;
        }
    }
    try std.testing.expect(done);
}

test "reqresp native bytes arriving behind cursor remain ready after a routed readable event" {
    var setup: Pair = .{};
    try setup.init(.{ .outbound_max = 1, .serving_max = 1 }, .{});
    defer setup.deinit();
    const bytes = [_]u8{7} ** 8;
    var sink: [8]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    try waitForRequest(&setup);
    const stream = setup.shared.server.control_reqresp.inbound[setup.serverEvents()[0].request.request.index].request.stream;
    setup.shared.client.control_reqresp.options.work_per_pump_max = 1;
    _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
    var wire: [codec.frame_scratch_max]u8 = undefined;
    const encoded = try codec.encodeChunk(0, null, &bytes, &wire);
    try std.testing.expectEqual(encoded.len, try setup.shared.pair.server.write(stream, encoded, false));
    try setup.shared.pair.pump();
    harness.forward(&setup.shared.pair, &setup.shared.pair.client, &setup.shared.client.control_reqresp);
    var events: [1]Event = undefined;
    var received = false;
    for (0..3) |_| {
        try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(1), setup.shared.pair.now.millis()));
        const emitted = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events);
        if (emitted == 1) {
            try std.testing.expectEqualSlices(u8, &bytes, events[0].chunk.bytes);
            received = true;
            break;
        }
    }
    try std.testing.expect(received);
}

test "reqresp native write credit behind cursor resumes from a routed writable event" {
    var setup: Pair = .{};
    try setup.init(.{}, .{ .outbound_max = 1, .serving_max = 2 });
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    try waitForRequest(&setup);
    const incoming = setup.serverEvents()[0].request.request;
    const stream = setup.shared.server.control_reqresp.inbound[incoming.index].request.stream;
    const client_stream = setup.shared.client.control_reqresp.outbound[handle.index].request.stream;
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
    setup.shared.server.control_reqresp.options.work_per_pump_max = 1;
    for (0..2) |_| _ = setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &.{});
    var drain: [65536]u8 = undefined;
    var writable = false;
    for (0..512) |_| {
        try setup.shared.pair.pump();
        _ = try setup.shared.pair.client.read(client_stream, &drain);
        try setup.shared.pair.pump();
        if (try setup.shared.pair.server.streamCapacity(stream) > 0) {
            writable = true;
            break;
        }
    }
    try std.testing.expect(writable);
    harness.forward(&setup.shared.pair, &setup.shared.pair.server, &setup.shared.server.control_reqresp);
    var events: [1]Event = undefined;
    var sent = false;
    for (0..10) |_| {
        try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(1), setup.shared.pair.now.millis()));
        const emitted = setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events);
        if (emitted == 1) {
            try std.testing.expect(events[0] == .chunk_sent);
            sent = true;
            break;
        }
    }
    try std.testing.expect(sent);
}

test "reqresp routed readiness checks the stream generation and quiets after one service" {
    var setup: Pair = .{};
    try setup.init(.{ .outbound_max = 1, .serving_max = 1 }, .{});
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    try waitForRequest(&setup);
    setup.shared.client.control_reqresp.options.work_per_pump_max = 1;
    const deadline = schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(0), setup.shared.pair.now.millis());
    try std.testing.expect(deadline.? > setup.shared.pair.now.millis());
    const stream = setup.shared.client.control_reqresp.outbound[handle.index].request.stream;
    const route = setup.shared.pair.client.route(stream).?;
    try std.testing.expectEqual(StreamOwner.reqresp_control_outbound, route.owner);
    var stale = stream;
    stale.conn.generation += 1;
    setup.shared.client.control_reqresp.streamReady(route, stale);
    try std.testing.expectEqual(deadline, schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(0), setup.shared.pair.now.millis()));
    setup.shared.client.control_reqresp.streamReady(route, stream);
    for (0..4) |_| {
        if (schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(0), setup.shared.pair.now.millis()) != setup.shared.pair.now.millis()) break;
        _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
    }
    try std.testing.expectEqual(deadline, schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(0), setup.shared.pair.now.millis()));
}

test "reqresp partial beacon scans preserve host waits and elapsed deadlines" {
    var setup: Pair = .{};
    try setup.init(.{}, .{ .outbound_max = 64, .serving_max = 64, .host_timeout_ms = 2000 });
    defer setup.deinit();
    for (0..8) |_| {
        _ = setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &.{});
        try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(0), setup.shared.pair.now.millis()));
    }
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    try waitForRequest(&setup);
    const incoming = setup.serverEvents()[0].request.request;
    const due = setup.shared.server.control_reqresp.inbound[incoming.index].progress_ms + 2000;
    for (0..4) |_| {
        _ = setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &.{});
        try std.testing.expectEqual(@as(?u64, due), schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(1), setup.shared.pair.now.millis()));
    }
    setup.shared.pair.advance(2000);
    var events: [1]Event = undefined;
    var failed = false;
    for (0..4) |_| {
        try std.testing.expect(schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(1), setup.shared.pair.now.millis()).? <= setup.shared.pair.now.millis());
        if (setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events) == 1) {
            try std.testing.expect(events[0].failed.reason == .host_timeout);
            failed = true;
            break;
        }
    }
    try std.testing.expect(failed);
    _ = setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &.{});
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(1), setup.shared.pair.now.millis()));
}

test "reqresp request write preserves already readable native response" {
    var setup: Pair = .{};
    try setup.init(.{ .outbound_max = 1, .serving_max = 1 }, .{});
    defer setup.deinit();
    const bytes = [_]u8{7} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    var server_stream: ?Engine.StreamHandle = null;
    for (0..10) |_| {
        try setup.shared.pair.pump();
        var native_events: [16]Engine.Event = undefined;
        for (setup.shared.pair.events(&setup.shared.pair.server, &native_events)) |event| switch (event) {
            .stream_opened => |stream| try setup.shared.server.router.negotiator.acceptInbound(&setup.shared.pair.server, stream, setup.shared.pair.now),
            else => {},
        };
        var outcomes: [8]Router.Outcome = undefined;
        setup.forwardEvents();
        const client_count = setup.shared.client.router.pump(&setup.shared.pair.client, setup.shared.pair.now, &outcomes);
        for (outcomes[0..client_count]) |outcome| try std.testing.expect(setup.shared.client.control_reqresp.negotiated(&setup.shared.pair.client, &setup.shared.client.router, outcome, setup.shared.pair.now));
        setup.forwardEvents();
        const server_count = setup.shared.server.router.pump(&setup.shared.pair.server, setup.shared.pair.now, &outcomes);
        for (outcomes[0..server_count]) |outcome| switch (outcome.result) {
            .ready => server_stream = outcome.stream,
            else => return error.TestUnexpectedResult,
        };
        if (server_stream != null and setup.shared.client.control_reqresp.outbound[handle.index].phase == .request) break;
    }
    try std.testing.expect(server_stream != null);
    try std.testing.expectEqual(.request, setup.shared.client.control_reqresp.outbound[handle.index].phase);
    var wire: [codec.frame_scratch_max]u8 = undefined;
    const encoded = try codec.encodeChunk(0, null, &bytes, &wire);
    try std.testing.expectEqual(encoded.len, try setup.shared.pair.server.write(server_stream.?, encoded, false));
    try setup.shared.pair.pump();
    harness.forward(&setup.shared.pair, &setup.shared.pair.client, &setup.shared.client.control_reqresp);
    for (0..4) |_| {
        _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
        if (setup.shared.client.control_reqresp.outbound[handle.index].phase == .response) break;
    }
    try std.testing.expectEqual(.response, setup.shared.client.control_reqresp.outbound[handle.index].phase);
    try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(1), setup.shared.pair.now.millis()));
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    try std.testing.expectEqualSlices(u8, &bytes, events[0].chunk.bytes);
}
