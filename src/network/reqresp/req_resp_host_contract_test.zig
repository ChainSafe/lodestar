const std = @import("std");
const Protocol = @import("protocol.zig").Protocol;
const rr = @import("ReqResp.zig");
const Pair = @import("test_pair.zig").Pair;

fn request(pair: *Pair, bytes: []const u8, sink: []u8) !rr.RequestHandle {
    _ = try pair.shared.client.control_reqresp.request(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.handles.client, .ping_v1, bytes, sink, .{}, pair.shared.pair.now);
    pair.server_event_capacity = 0;
    for (0..32) |_| {
        try pair.pumpOnce();
        for (pair.shared.server.control_reqresp.inbound, 0..) |*slot, index| {
            if (slot.request.pendingEvent()) |event| if (event == .request) return slot.request.handle(@intCast(index));
        }
    }
    return error.RequestNotReceived;
}

fn drain(pair: *Pair, output: []rr.Event) usize {
    return pair.shared.server.control_reqresp.pump(&pair.shared.pair.server, &pair.shared.server.router, pair.shared.pair.now, output);
}

test "reqresp host readiness distinguishes notification pressure terminal race and stale handles" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const bytes = [_]u8{9} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try request(&pair, &bytes, &sink);
    const owner = &pair.shared.server.control_reqresp;
    try std.testing.expectEqual(.backpressured, owner.responseReadiness(handle));
    try std.testing.expectError(error.Busy, owner.respond(handle, &bytes, null, pair.shared.pair.now));
    var events: [1]rr.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), drain(&pair, &events));
    try std.testing.expect(events[0] == .request);
    const borrowed = events[0].request.bytes;
    try std.testing.expectEqual(.ready, owner.responseReadiness(handle));
    const before = owner.resourceSnapshot();
    try std.testing.expectEqual(.ready, owner.responseReadiness(handle));
    try std.testing.expectEqualDeep(before, owner.resourceSnapshot());
    try std.testing.expect(owner.retainServing(handle) == null);
    try std.testing.expect(owner.cancel(&pair.shared.pair.server, &pair.shared.server.router, handle, pair.shared.pair.now));
    try std.testing.expect(!owner.cancel(&pair.shared.pair.server, &pair.shared.server.router, handle, pair.shared.pair.now));
    try std.testing.expectEqual(.closed, owner.inbound[handle.index].request.stream_owner);
    try std.testing.expectEqual(.terminal, owner.responseReadiness(handle));
    try std.testing.expectError(error.Terminal, owner.respond(handle, &bytes, null, pair.shared.pair.now));
    try std.testing.expectError(error.Terminal, owner.respondError(handle, 2, "closed", pair.shared.pair.now));
    try std.testing.expect(!owner.finish(handle, pair.shared.pair.now));
    var stale = handle;
    stale.generation += 1;
    try std.testing.expectEqual(.stale, owner.responseReadiness(stale));
    try std.testing.expectError(error.StaleHandle, owner.respond(stale, &bytes, null, pair.shared.pair.now));
    stale = handle;
    stale.direction = .outbound;
    try std.testing.expectEqual(.stale, owner.responseReadiness(stale));

    try std.testing.expectEqualSlices(u8, &bytes, borrowed);
    try std.testing.expectEqual(@as(usize, 0), drain(&pair, &.{}));
    try std.testing.expectEqual(.terminal, owner.responseReadiness(handle));
    try std.testing.expectEqual(@as(usize, 1), drain(&pair, &events));
    try std.testing.expectEqual(rr.Failure.cancelled, events[0].failed.reason);
    try std.testing.expectEqual(.stale, owner.responseReadiness(handle));
    try std.testing.expectError(error.StaleHandle, owner.respond(handle, &bytes, null, pair.shared.pair.now));
    try std.testing.expect(!owner.inbound[handle.index].request.occupied());
    try std.testing.expectEqual(@as(usize, 0), drain(&pair, &events));
    try std.testing.expectEqual(@as(usize, 0), owner.resourceSnapshot().serving_occupied);
}

test "reqresp queued chunk acknowledgement precedes cancellation terminal after I/O detachment" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const bytes = [_]u8{7} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try request(&pair, &bytes, &sink);
    const owner = &pair.shared.server.control_reqresp;
    var events: [1]rr.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), drain(&pair, &events));
    try owner.respond(handle, &bytes, null, pair.shared.pair.now);
    try std.testing.expectEqual(.backpressured, owner.responseReadiness(handle));
    for (0..8) |_| {
        _ = drain(&pair, &.{});
        if (owner.inbound[handle.index].request.pendingEvent() != null) break;
    }
    try std.testing.expectEqual(.chunk_sent, std.meta.activeTag(owner.inbound[handle.index].request.pendingEvent().?));
    try std.testing.expectEqual(.backpressured, owner.responseReadiness(handle));
    try std.testing.expect(owner.cancel(&pair.shared.pair.server, &pair.shared.server.router, handle, pair.shared.pair.now));

    try std.testing.expectEqual(.terminal, owner.responseReadiness(handle));
    try std.testing.expectEqual(@as(usize, 1), drain(&pair, &events));
    try std.testing.expectEqual(@as(u32, 1), events[0].chunk_sent.chunks);
    try std.testing.expectEqual(.terminal, owner.responseReadiness(handle));
    try std.testing.expectEqual(@as(usize, 1), drain(&pair, &events));
    try std.testing.expectEqual(rr.Failure.cancelled, events[0].failed.reason);
    try std.testing.expectEqual(@as(usize, 0), drain(&pair, &events));
}

test "reqresp finish while writing retains its independent host operation contract" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const bytes = [_]u8{4} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try request(&pair, &bytes, &sink);
    const owner = &pair.shared.server.control_reqresp;
    var events: [1]rr.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), drain(&pair, &events));
    try owner.respond(handle, &bytes, null, pair.shared.pair.now);
    try std.testing.expectEqual(.backpressured, owner.responseReadiness(handle));
    try std.testing.expect(owner.finish(handle, pair.shared.pair.now));
    try std.testing.expect(!owner.finish(handle, pair.shared.pair.now));
    for (0..8) |_| {
        _ = drain(&pair, &.{});
        if (owner.responseReadiness(handle) == .terminal) break;
    }
    try std.testing.expectEqual(.terminal, owner.responseReadiness(handle));
    try std.testing.expectEqual(@as(usize, 1), drain(&pair, &events));
    try std.testing.expectEqual(@as(u32, 1), events[0].served.chunks);
    try std.testing.expectEqual(@as(usize, 0), drain(&pair, &events));
}

test "reqresp abandonment releases negotiating request buffers and ignores stale generations" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const owner = &pair.shared.client.control_reqresp;
    const engine = &pair.shared.pair.client;
    const router = &pair.shared.client.router;
    var bytes = [_]u8{1} ** 8;
    var sink: [8]u8 = undefined;
    const first = try owner.request(engine, router, pair.shared.handles.client, .ping_v1, &bytes, &sink, .{}, pair.shared.pair.now);
    try std.testing.expect(owner.outbound[first.index].request.stream_owner == .router);
    try std.testing.expect(owner.abandon(engine, router, first, pair.shared.pair.now) == null);
    try std.testing.expect(owner.outbound[first.index].request.io.payload.len == 0);
    try std.testing.expect(owner.outbound[first.index].request.io.sink.len == 0);
    @memset(&bytes, 2);
    const second = try owner.request(engine, router, pair.shared.handles.client, .ping_v1, &bytes, &sink, .{}, pair.shared.pair.now);
    try std.testing.expectEqual(first.index, second.index);
    try std.testing.expectEqual(first.generation + 1, second.generation);
    try std.testing.expect(owner.abandon(engine, router, first, pair.shared.pair.now) == null);
    try std.testing.expect(owner.outbound[second.index].request.running());
    try std.testing.expectEqual(second, owner.outbound[second.index].request.handle(second.index));
    try std.testing.expect(owner.abandon(engine, router, second, pair.shared.pair.now) == null);
    var events: [4]rr.Event = undefined;
    try std.testing.expectEqual(@as(usize, 0), owner.pump(engine, router, pair.shared.pair.now, &events));
}

test "reqresp abandonment returns recorded peer faults exactly once" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const bytes = [_]u8{7} ** 8;
    var sink: [8]u8 = undefined;
    const owner = &pair.shared.client.control_reqresp;
    const engine = &pair.shared.pair.client;
    const router = &pair.shared.client.router;
    const handle = try owner.request(engine, router, pair.shared.handles.client, .ping_v1, &bytes, &sink, .{}, pair.shared.pair.now);
    const slot = &owner.outbound[handle.index];
    slot.request.peer_fault = .protocol;
    slot.fail(owner, engine, router, handle.index, .{ .negotiation_failed = .malformed }, pair.shared.pair.now);
    const recorded = slot.request.terminalEvent().?.peerFault().?.*;
    const before = owner.protocol_counters[@intFromEnum(Protocol.ping_v1)];
    const fault = owner.abandon(engine, router, handle, pair.shared.pair.now).?;
    try std.testing.expectEqualDeep(recorded, fault);
    try std.testing.expect(owner.abandon(engine, router, handle, pair.shared.pair.now) == null);
    try std.testing.expectEqualDeep(before, owner.protocol_counters[@intFromEnum(Protocol.ping_v1)]);
    var events: [1]rr.Event = undefined;
    try std.testing.expectEqual(@as(usize, 0), owner.pump(engine, router, pair.shared.pair.now, &events));
}

test "reqresp abandonment ends queued and delivered outbound chunk borrows" {
    for ([_]bool{ false, true }) |delivered| {
        var pair: Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        const bytes = [_]u8{5} ** 8;
        var sink: [8]u8 = undefined;
        const incoming = try request(&pair, &bytes, &sink);
        const owner = &pair.shared.client.control_reqresp;
        const client = &owner.outbound[0];
        const handle = client.request.handle(0);
        var events: [1]rr.Event = undefined;
        try std.testing.expectEqual(@as(usize, 1), drain(&pair, &events));
        try pair.shared.server.control_reqresp.respond(incoming, &bytes, null, pair.shared.pair.now);
        for (0..32) |_| {
            _ = pair.shared.processServer(.{});
            try pair.shared.pair.pump();
            _ = pair.shared.processClient(.{});
            if (client.request.pendingEvent() != null) break;
        }
        try std.testing.expect(client.request.pendingEvent().? == .chunk);
        const engine = &pair.shared.pair.client;
        const router = &pair.shared.client.router;
        if (delivered) {
            try std.testing.expectEqual(@as(usize, 1), owner.pump(engine, router, pair.shared.pair.now, &events));
            try std.testing.expectEqualSlices(u8, &bytes, events[0].chunk.bytes);
        }
        try std.testing.expect(owner.cancel(engine, router, handle, pair.shared.pair.now));
        try std.testing.expect(owner.abandon(engine, router, handle, pair.shared.pair.now) == null);
        @memset(&sink, 99);
        try std.testing.expectEqual(@as(usize, 0), owner.pump(engine, router, pair.shared.pair.now, &events));
        try std.testing.expectEqualSlices(u8, &([_]u8{99} ** 8), &sink);
        try std.testing.expect(client.request.available());
    }
}
