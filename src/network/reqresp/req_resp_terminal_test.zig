const std = @import("std");
const schedule_test_support = @import("../schedule_test_support.zig");
const rr = @import("ReqResp.zig");
const codec = @import("codec.zig");
const Protocol = @import("protocol.zig").Protocol;
const Server = @import("Server.zig");
const Router = @import("../router.zig").Router;
const harness = @import("test_pair.zig");
const Pair = harness.Pair;
const Event = rr.Event;
const deneb_digest = harness.deneb_digest;
const requestBlocks = harness.requestBlocks;
const waitForRequest = harness.waitForRequest;
const time = @import("../time.zig");

fn incomingSlot(setup: *Pair, which: Protocol) *Server {
    for (setup.shared.server.requests(which).inbound) |*slot| if (slot.request.occupied()) return slot;
    unreachable;
}

test "reqresp complete incoming transfer deadline survives partial bytes and missing FIN" {
    for ([_]Protocol{ .ping_v1, .blocks_by_root_v2 }) |which| {
        for ([_]bool{ false, true }) |complete_body| {
            var setup: Pair = .{};
            try setup.init(.{}, .{ .progress_timeout_ms = 100, .host_timeout_ms = 1000 });
            defer setup.deinit();
            const stream = try setup.openRaw(which);
            try setup.awaitRawSelection(stream, which);
            setup.server_event_capacity = 0;
            const slot = incomingSlot(&setup, which);
            const started = slot.request.started_ms;
            const deadline = started + 100;
            var storage: [codec.encodedLengthMax(32) + 1]u8 = undefined;
            const body = [_]u8{0} ** 32;
            const encoded = try codec.encodeRequest(body[0..if (which == .ping_v1) 8 else 32], &storage);
            var sent: usize = 0;
            for ([_]u64{ 25, 50, 75, 99 }) |elapsed| {
                setup.shared.pair.now.monotonic = time.milliseconds(started + elapsed);
                const end = if (complete_body) encoded.len else sent + 1;
                if (end > sent) try std.testing.expectEqual(end - sent, try setup.shared.pair.client.write(stream, encoded[sent..end], false));
                sent = end;
                try setup.pumpOnce();
                try std.testing.expect(slot.request.running());
                try std.testing.expectEqual(@as(?u64, deadline), slot.deadline(setup.shared.server.requests(which)));
            }
            try std.testing.expect(slot.progress_ms > started);
            setup.shared.pair.now.monotonic = time.milliseconds(deadline);
            try setup.pumpOnce();
            try std.testing.expectEqual(rr.Failure.timeout, slot.request.terminalEvent().?.failed.reason);
            for (0..3) |_| try setup.pumpOnce();
            setup.server_event_capacity = 16;
            try setup.pumpOnce();
            try std.testing.expectEqual(@as(usize, 1), setup.serverEvents().len);
            try std.testing.expectEqual(rr.Failure.timeout, setup.serverEvents()[0].failed.reason);
            const fault = setup.serverEvents()[0].peerFault();
            if (which.isControl()) {
                try std.testing.expect(fault == null);
            } else {
                try std.testing.expectEqual(.non_completion, fault.?.kind);
            }
            try setup.pumpOnce();
            try std.testing.expectEqual(@as(u16, 0), setup.shared.server.requests(which).pendingCounts().inbound);
        }
    }
}

test "reqresp incoming transfer completed at the boundary starts the host deadline" {
    var setup: Pair = .{};
    try setup.init(.{}, .{ .progress_timeout_ms = 100, .host_timeout_ms = 1000 });
    defer setup.deinit();
    const stream = try setup.openRaw(.ping_v1);
    try setup.awaitRawSelection(stream, .ping_v1);
    const slot = incomingSlot(&setup, .ping_v1);
    const started = slot.request.started_ms;
    var storage: [codec.encodedLengthMax(8) + 1]u8 = undefined;
    const encoded = try codec.encodeRequest(&(@as([8]u8, @splat(0))), &storage);
    setup.shared.pair.now.monotonic = time.milliseconds(started + 99);
    try std.testing.expectEqual(encoded.len, try setup.shared.pair.client.write(stream, encoded, true));
    try setup.pumpOnce();
    try std.testing.expectEqual(@as(usize, 1), setup.serverEvents().len);
    try std.testing.expect(setup.serverEvents()[0] == .request);
    const handle = setup.serverEvents()[0].request.request;
    try std.testing.expectEqual(@as(?u64, started + 1099), slot.deadline(&setup.shared.server.control_reqresp));
    setup.shared.pair.now.monotonic = time.milliseconds(started + 100);
    try setup.pumpOnce();
    try std.testing.expect(slot.request.running());
    try std.testing.expect(setup.shared.server.control_reqresp.finish(handle, setup.shared.pair.now));
    for (0..20) |_| {
        try setup.pumpOnce();
        if (setup.serverEvents().len > 0) break;
    }
    try std.testing.expectEqual(@as(u32, 0), setup.serverEvents()[0].served.chunks);
}

test "reqresp rejected wire requests retain diagnostics and count terminal outcomes once" {
    const Case = enum { varint, truncated, trailing };
    for (std.enums.values(Case)) |case| {
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        const stream = try setup.openRaw(.ping_v1);
        try setup.awaitRawSelection(stream, .ping_v1);
        setup.server_event_capacity = 0;
        const slot = incomingSlot(&setup, .ping_v1);
        var storage: [codec.encodedLengthMax(8) + 1]u8 = undefined;
        const encoded = try codec.encodeRequest(&(@as([8]u8, @splat(0))), &storage);
        const bytes: []const u8 = switch (case) {
            .varint => &(@as([11]u8, @splat(0x80))),
            .truncated => encoded[0..3],
            .trailing => extra: {
                storage[encoded.len] = 0;
                break :extra storage[0 .. encoded.len + 1];
            },
        };
        const expected: codec.Error = switch (case) {
            .varint => error.VarintTooLong,
            .truncated => error.Truncated,
            .trailing => error.TooManyBytes,
        };
        try std.testing.expectEqual(bytes.len, try setup.shared.pair.client.write(stream, bytes, true));
        for (0..20) |_| {
            try setup.pumpOnce();
            if (slot.request.terminalEvent() != null) break;
        }
        try std.testing.expectEqual(expected, slot.rejection.?);
        try std.testing.expectEqual(@as(u32, 0), slot.request.terminalEvent().?.served.chunks);
        try std.testing.expectEqual(@as(u64, 1), setup.shared.server.control_reqresp.protocol_counters[@intFromEnum(Protocol.ping_v1)].incoming_errors);
        for (0..3) |_| try setup.pumpOnce();
        setup.server_event_capacity = 16;
        try setup.pumpOnce();
        try std.testing.expect(setup.serverEvents()[0] == .served);
        const fault = setup.serverEvents()[0].peerFault().?;
        try std.testing.expectEqual(.protocol, fault.kind);
        try std.testing.expect(fault.identity.eql(&slot.identity));
        try setup.pumpOnce();
        try std.testing.expectEqual(@as(u16, 0), setup.shared.server.control_reqresp.pendingCounts().inbound);
        try std.testing.expectEqual(@as(u64, 1), setup.shared.server.control_reqresp.protocol_counters[@intFromEnum(Protocol.ping_v1)].incoming_errors);
    }
}

test "reqresp incoming error responses and failed writes count once through terminal retention" {
    const Outcome = enum { success, error_response, failed_write };
    for (std.enums.values(Outcome)) |outcome| {
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        const bytes = [_]u8{0} ** 8;
        var sink: [8]u8 = undefined;
        _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
        try waitForRequest(&setup);
        const handle = setup.serverEvents()[0].request.request;
        const slot = &setup.shared.server.control_reqresp.inbound[handle.index];
        const counts = &setup.shared.server.control_reqresp.protocol_counters[@intFromEnum(Protocol.ping_v1)];
        setup.server_event_capacity = 0;
        if (outcome == .success) {
            try std.testing.expect(setup.shared.server.control_reqresp.finish(handle, setup.shared.pair.now));
        } else {
            try setup.shared.server.control_reqresp.respondError(handle, 2, "local serving failure", setup.shared.pair.now);
        }
        try std.testing.expectEqual(@as(u64, 0), counts.incoming_errors);
        if (outcome == .failed_write) {
            setup.shared.server.control_reqresp.connectionClosed(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.handles.server, setup.shared.pair.now);
        }
        for (0..20) |_| {
            try setup.pumpOnce();
            if (slot.request.terminalEvent() != null) break;
        }
        const terminal = slot.request.terminalEvent() orelse return error.TestUnexpectedResult;
        if (outcome == .failed_write) {
            try std.testing.expectEqual(rr.Failure.connection_closed, terminal.failed.reason);
        } else try std.testing.expect(terminal == .served);
        const expected: u64 = if (outcome == .success) 0 else 1;
        try std.testing.expectEqual(expected, counts.incoming_errors);
        for (0..3) |_| try setup.pumpOnce();
        setup.shared.server.control_reqresp.connectionClosed(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.handles.server, setup.shared.pair.now);
        setup.server_event_capacity = 16;
        try setup.pumpOnce();
        try std.testing.expectEqual(@as(usize, 1), setup.serverEvents().len);
        try setup.pumpOnce();
        try std.testing.expectEqual(@as(u16, 0), setup.shared.server.control_reqresp.pendingCounts().inbound);
        try std.testing.expectEqual(expected, counts.incoming_errors);
    }
}

test "reqresp router negotiation timeout contributes once to aggregate timeout counters" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{ .timeouts = .{ .negotiation = .fromMilliseconds(100) } }, setup.shared.pair.now);
    setup.shared.pair.advance(100);
    var outcomes: [1]Router.Outcome = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.router.pump(&setup.shared.pair.client, setup.shared.pair.now, &outcomes));
    try std.testing.expectEqual(.timeout, outcomes[0].result.failed);
    try std.testing.expect(setup.shared.client.control_reqresp.negotiated(&setup.shared.pair.client, &setup.shared.client.router, outcomes[0], setup.shared.pair.now));
    try std.testing.expect(!setup.shared.client.control_reqresp.negotiated(&setup.shared.pair.client, &setup.shared.client.router, outcomes[0], setup.shared.pair.now));
    var events: [1]rr.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    try std.testing.expectEqual(handle, events[0].failed.request);
    try std.testing.expectEqual(rr.Failure.timeout, events[0].failed.reason);
    try std.testing.expectEqual(.negotiation, events[0].failed.phase.?);
    for (0..3) |_| _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events);
    try std.testing.expectEqual(@as(u64, 1), setup.shared.client.control_reqresp.outgoing_error_reasons[@intFromEnum(rr.metrics.ErrorReason.REQUEST_ERROR_DIAL_TIMEOUT)]);
}

test "reqresp cancellation removes Router ownership before output delivery" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    const stream = setup.shared.client.control_reqresp.outbound[handle.index].request.stream;
    setup.shared.client.control_reqresp.options.work_per_pump_max = 1;
    try std.testing.expect(setup.shared.client.control_reqresp.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(setup.shared.client.control_reqresp.schedule(0), setup.shared.pair.now.millis()));
    try std.testing.expectEqual(.closed, setup.shared.client.control_reqresp.outbound[handle.index].request.stream_owner);
    try std.testing.expect(!setup.shared.client.router.schedule(1).runnable);
    try std.testing.expect(!setup.shared.client.control_reqresp.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.resourceSnapshot().outbound_occupied);
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.resourceSnapshot().pending_terminals);
    _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
    try std.testing.expect(!setup.shared.pair.client.registry.slots[stream.conn.index].table.matches(stream.slot, stream.id));
    var outcomes: [8]Router.Outcome = undefined;
    setup.forwardEvents();
    try std.testing.expectEqual(@as(usize, 0), setup.shared.client.router.pump(&setup.shared.pair.client, setup.shared.pair.now, &outcomes));
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    try std.testing.expect(events[0].failed.reason == .cancelled);
    try std.testing.expect(!setup.shared.client.control_reqresp.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    try std.testing.expectEqual(@as(usize, 0), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    try std.testing.expectEqual(@as(u64, 0), setup.shared.client.control_reqresp.protocol_counters[@intFromEnum(Protocol.ping_v1)].outgoing_errors);
    try std.testing.expectEqual(@as(usize, 0), setup.shared.client.control_reqresp.resourceSnapshot().outbound_occupied);
    try std.testing.expectEqual(@as(usize, 0), setup.shared.client.control_reqresp.resourceSnapshot().pending_terminals);
}

test "reqresp cancellation releases read held chunk and response write states once" {
    for ([_]bool{ false, true }) |hold_chunk| {
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        const bytes = [_]u8{0} ** 8;
        var sink: [8]u8 = undefined;
        const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
        try waitForRequest(&setup);
        const incoming = setup.serverEvents()[0].request.request;
        try setup.shared.server.control_reqresp.respond(incoming, &bytes, null, setup.shared.pair.now);
        if (hold_chunk) {
            var held = false;
            for (0..30) |_| {
                try setup.pumpOnce();
                for (setup.clientEvents()) |event| if (event == .chunk) {
                    held = true;
                };
                if (held) break;
            }
            try std.testing.expect(held);
        }
        const stream = setup.shared.client.control_reqresp.outbound[handle.index].request.stream;
        const server_stream = setup.shared.server.control_reqresp.inbound[incoming.index].request.stream;
        try std.testing.expect(setup.shared.client.control_reqresp.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
        try std.testing.expect(setup.shared.server.control_reqresp.cancel(&setup.shared.pair.server, &setup.shared.server.router, incoming, setup.shared.pair.now));
        setup.shared.client.control_reqresp.cancelAll(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now);
        setup.shared.server.control_reqresp.cancelAll(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now);
        try std.testing.expect(!setup.shared.client.control_reqresp.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
        try std.testing.expect(!setup.shared.server.control_reqresp.cancel(&setup.shared.pair.server, &setup.shared.server.router, incoming, setup.shared.pair.now));
        try std.testing.expect(!setup.shared.pair.client.registry.slots[stream.conn.index].table.matches(stream.slot, stream.id));
        try std.testing.expect(!setup.shared.pair.server.registry.slots[server_stream.conn.index].table.matches(server_stream.slot, server_stream.id));
        var events: [1]Event = undefined;
        try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
        try std.testing.expect(events[0].failed.reason == .cancelled);
        try std.testing.expectEqual(@as(u64, 0), setup.shared.server.control_reqresp.protocol_counters[@intFromEnum(Protocol.ping_v1)].incoming_errors);
        try std.testing.expectEqual(@as(usize, 1), setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events));
        try std.testing.expect(events[0].failed.reason == .cancelled);
    }
}

test "reqresp canonical cancel supersedes accepted unfinished finish and error" {
    for ([_]bool{ false, true }) |error_response| {
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        var request: [24]u8 = undefined;
        const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_range_v2.info().response_max);
        defer std.testing.allocator.free(sink);
        _ = try requestBlocks(&setup, &request, 2, sink);
        try waitForRequest(&setup);
        const handle = setup.serverEvents()[0].request.request;
        const response = [_]u8{7} ** 4000;
        try setup.shared.server.reqresp.respond(handle, &response, .{ .digest = deneb_digest, .fork = .deneb }, setup.shared.pair.now);
        var sent = false;
        for (0..20) |_| {
            try setup.pumpOnce();
            for (setup.serverEvents()) |event| if (event == .chunk_sent) {
                try std.testing.expectEqual(handle, event.chunk_sent.request);
                try std.testing.expectEqual(@as(u32, 1), event.chunk_sent.chunks);
                sent = true;
            };
            if (sent) break;
        }
        try std.testing.expect(sent);
        if (error_response) {
            try setup.shared.server.reqresp.respondError(handle, 139, "unfinished", setup.shared.pair.now);
        } else try std.testing.expect(setup.shared.server.reqresp.finish(handle, setup.shared.pair.now));
        const slot = &setup.shared.server.reqresp.inbound[handle.index];
        try std.testing.expectEqual(@as(@TypeOf(slot.state), if (error_response) .writing_chunk else .finishing), slot.state);
        try std.testing.expect(slot.request.terminalEvent() == null);
        try std.testing.expectEqual(@as(u32, 1), slot.request.chunks);
        try std.testing.expect(setup.shared.server.reqresp.cancel(&setup.shared.pair.server, &setup.shared.server.router, handle, setup.shared.pair.now));
        try std.testing.expectEqual(.cancelled, slot.request.terminalEvent().?.failed.reason);
        try std.testing.expectEqual(@as(u32, 1), slot.request.chunks);
        try std.testing.expect(!setup.shared.server.reqresp.cancel(&setup.shared.pair.server, &setup.shared.server.router, handle, setup.shared.pair.now));

        var events: [1]Event = undefined;
        try std.testing.expectEqual(@as(usize, 1), setup.shared.server.reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events));
        try std.testing.expectEqual(handle, events[0].failed.request);
        try std.testing.expectEqual(.cancelled, events[0].failed.reason);
        _ = setup.shared.server.reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events);
        try std.testing.expect(setup.shared.server.reqresp.responseReadiness(handle) == .stale);
        try std.testing.expectEqual(@as(u64, 0), setup.shared.server.reqresp.protocol_counters[@intFromEnum(Protocol.blocks_by_range_v2)].incoming_errors);
    }
}
