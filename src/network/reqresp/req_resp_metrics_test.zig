const std = @import("std");
const ct = @import("consensus_types");
const Protocol = @import("protocol.zig").Protocol;
const harness = @import("test_pair.zig");
const time = @import("../time.zig");

test "reqresp duration includes the final chunk hold until consume" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    var request: [ct.phase0.Status.fixed_size]u8 = undefined;
    var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
    const reply = harness.statusBytes(9);
    const started = setup.shared.pair.now.millis();
    const handle = try harness.requestStatus(&setup, &request, &sink);
    const counts = &setup.shared.client.control_reqresp.protocol_counters[@intFromEnum(Protocol.status_v1)];
    try std.testing.expectEqual(0, counts.outgoing_opened);
    var got_chunk = false;
    for (0..30) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                try setup.shared.server.control_reqresp.respond(incoming.request, &reply, null, setup.shared.pair.now);
                try std.testing.expect(setup.shared.server.control_reqresp.finish(incoming.request, setup.shared.pair.now));
            },
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
        for (setup.clientEvents()) |event| switch (event) {
            .chunk => got_chunk = true,
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
        if (got_chunk) break;
    }
    try std.testing.expect(got_chunk);
    try std.testing.expectEqual(1, counts.outgoing_opened);
    try std.testing.expectEqual(0, counts.outgoing_closed);
    const owner = &setup.shared.client.control_reqresp;
    const times = &owner.protocol_counters[@intFromEnum(Protocol.status_v1)].outgoing_time;
    try std.testing.expectEqual(0, times.count);
    setup.shared.pair.now.monotonic = time.milliseconds(setup.shared.pair.now.millis() + 5000);
    try std.testing.expect(owner.consume(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    try std.testing.expectEqual(1, times.count);
    try std.testing.expectEqual(setup.shared.pair.now.millis() - started, times.sum);
    setup.shared.pair.now.monotonic = time.milliseconds(setup.shared.pair.now.millis() + 1000);
    try std.testing.expect(!owner.consume(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    try std.testing.expect(!owner.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    try std.testing.expectEqual(1, times.count);
    try std.testing.expectEqual(5000, times.sum);
    try std.testing.expectEqual(1, counts.outgoing_closed);
}

test "reqresp duration uses event time for cancellation negotiation and connection failure" {
    const Cause = enum { cancel, rejected, timeout, connection_closed };
    for (std.enums.values(Cause)) |cause| {
        var setup: harness.Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        var request: [ct.phase0.Status.fixed_size]u8 = undefined;
        var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
        const handle = try harness.requestStatus(&setup, &request, &sink);
        const owner = &setup.shared.client.control_reqresp;
        setup.shared.pair.now.monotonic = time.milliseconds(setup.shared.pair.now.millis() + 3000);
        const now = setup.shared.pair.now;
        switch (cause) {
            .cancel => try std.testing.expect(owner.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, now)),
            .rejected, .timeout => {
                const stream = owner.outbound[handle.index].request.stream;
                setup.shared.client.router.cancel(&setup.shared.pair.client, stream);
                try std.testing.expect(owner.negotiated(&setup.shared.pair.client, &setup.shared.client.router, .{
                    .stream = stream,
                    .direction = .outbound,
                    .protocol = .{ .reqresp = .status_v1 },
                    .result = if (cause == .rejected) .rejected else .{ .failed = .timeout },
                }, now));
            },
            .connection_closed => {
                _ = setup.shared.client.process(&setup.shared.pair.client, &.{.{ .closed = .{
                    .conn = setup.shared.handles.client,
                    .peer_id = null,
                    .direction = .outbound,
                    .reason = .host,
                } }}, now, .{});
            },
        }
        const counts = &owner.protocol_counters[@intFromEnum(Protocol.status_v1)];
        try std.testing.expectEqual(1, counts.outgoing_time.count);
        try std.testing.expectEqual(3000, counts.outgoing_time.sum);
        try std.testing.expectEqual(if (cause == .cancel) @as(u64, 0) else 1, counts.outgoing_errors);
        try std.testing.expectEqual(0, counts.outgoing_opened);
        try std.testing.expectEqual(0, counts.outgoing_closed);
        try std.testing.expect(!owner.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, now));
        try std.testing.expectEqual(1, counts.outgoing_time.count);
    }
}

test "reqresp stream metrics close a negotiated request exactly once on cancellation" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    var request: [ct.phase0.Status.fixed_size]u8 = undefined;
    var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
    const handle = try harness.requestStatus(&setup, &request, &sink);
    try harness.waitForRequest(&setup);
    const owner = &setup.shared.client.control_reqresp;
    const counts = &owner.protocol_counters[@intFromEnum(Protocol.status_v1)];
    try std.testing.expectEqual(1, counts.outgoing_opened);
    try std.testing.expectEqual(0, counts.outgoing_closed);
    try std.testing.expect(owner.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    try std.testing.expectEqual(1, counts.outgoing_closed);
    try std.testing.expect(!owner.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    try std.testing.expectEqual(1, counts.outgoing_closed);
}

test "reqresp duration uses current time for inbound termination" {
    const Cause = enum { cancel, reset, shutdown };
    for (std.enums.values(Cause)) |cause| {
        var setup: harness.Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        var request: [ct.phase0.Status.fixed_size]u8 = undefined;
        var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
        const outbound = try harness.requestStatus(&setup, &request, &sink);
        try harness.waitForRequest(&setup);
        const owner = &setup.shared.server.control_reqresp;
        const handle = setup.serverEvents()[0].request.request;
        const slot = &owner.inbound[handle.index];
        const started = slot.request.started_ms;
        setup.shared.pair.now.monotonic = time.milliseconds(setup.shared.pair.now.millis() + 2000);
        const now = setup.shared.pair.now;
        switch (cause) {
            .cancel => try std.testing.expect(owner.cancel(&setup.shared.pair.server, &setup.shared.server.router, handle, now)),
            .reset => {
                const peer = &setup.shared.client.control_reqresp.outbound[outbound.index];
                setup.shared.pair.client.closeStream(peer.request.stream, 7);
                try setup.pumpOnce();
                try setup.pumpOnce();
            },
            .shutdown => owner.cancelAll(&setup.shared.pair.server, &setup.shared.server.router, now),
        }
        const times = &owner.protocol_counters[@intFromEnum(Protocol.status_v1)].incoming_time;
        try std.testing.expectEqual(1, times.count);
        try std.testing.expectEqual(now.millis() - started, times.sum);
        try std.testing.expect(!owner.cancel(&setup.shared.pair.server, &setup.shared.server.router, handle, now));
        try std.testing.expectEqual(1, times.count);
    }
}
