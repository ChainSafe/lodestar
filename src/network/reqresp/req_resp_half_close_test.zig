const std = @import("std");
const codec = @import("codec.zig");
const protocol = @import("protocol.zig");
const rr = @import("ReqResp.zig");
const harness = @import("test_pair.zig");
const Engine = @import("../quic/Engine.zig");
const Router = @import("../router.zig").Router;
const policy_fixture = @import("policy_fixture.zig");
const ErrorReason = @import("metrics.zig").ErrorReason;
const admission_fixture = @import("admission_fixture.zig");

const Pair = harness.Pair;
const Request = struct { protocol: protocol.Protocol, handle: rr.RequestHandle, remote: Engine.StreamHandle };

fn negotiate(pair: *Pair, method: protocol.Protocol, bytes: []const u8, sink: []u8, options: rr.RequestOptions) !Request {
    const handle = try pair.shared.client.requests(method).request(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.handles.client, method, bytes, sink, options, pair.shared.pair.now);
    var remote: ?Engine.StreamHandle = null;
    for (0..10) |_| {
        try pair.shared.pair.pump();
        var events: [16]Engine.Event = undefined;
        for (pair.shared.pair.events(&pair.shared.pair.server, &events)) |event| switch (event) {
            .stream_opened => |stream| try pair.shared.server.router.negotiator.acceptInbound(&pair.shared.pair.server, stream, pair.shared.pair.now),
            else => {},
        };
        var outcomes: [8]Router.Outcome = undefined;
        pair.forwardEvents();
        const clients = pair.shared.client.router.pump(&pair.shared.pair.client, pair.shared.pair.now, &outcomes);
        for (outcomes[0..clients]) |outcome| try std.testing.expect(pair.shared.client.requests(method).negotiated(&pair.shared.pair.client, &pair.shared.client.router, outcome, pair.shared.pair.now));
        pair.forwardEvents();
        const servers = pair.shared.server.router.pump(&pair.shared.pair.server, pair.shared.pair.now, &outcomes);
        for (outcomes[0..servers]) |outcome| switch (outcome.result) {
            .ready => remote = outcome.stream,
            else => return error.TestUnexpectedResult,
        };
        if (remote != null and pair.shared.client.requests(method).outbound[handle.index].phase == .request) break;
    }
    try std.testing.expect(remote != null);
    try std.testing.expectEqual(.request, pair.shared.client.requests(method).outbound[handle.index].phase);
    return .{ .protocol = method, .handle = handle, .remote = remote.? };
}

fn pump(pair: *Pair) ![]const rr.Event {
    try pair.shared.pair.pump();

    pair.forwardEvents();
    const controls = pair.shared.client.control_reqresp.pump(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.pair.now, pair.client_events[16..]);
    const applications = pair.shared.client.reqresp.pump(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.pair.now, pair.client_events[0..16]);
    std.mem.copyForwards(rr.Event, pair.client_events[applications..], pair.client_events[16..][0..controls]);
    pair.client_count = applications + controls;
    return pair.clientEvents();
}

fn reply(pair: *Pair, request: Request, result: u8, bytes: []const u8, fin: bool) !void {
    var wire: [codec.frame_scratch_max]u8 = undefined;
    const encoded = try codec.encodeChunk(result, null, bytes, &wire);
    try std.testing.expectEqual(encoded.len, try pair.shared.pair.server.write(request.remote, encoded, fin));
}

fn expectDone(pair: *Pair, request: Request, expected: []const u8) !void {
    var chunks: u32 = 0;
    var done = false;
    for (0..16) |_| {
        for (try pump(pair)) |event| switch (event) {
            .chunk => |chunk| {
                try std.testing.expectEqualSlices(u8, expected, chunk.bytes);
                chunks += 1;
                try std.testing.expect(pair.shared.client.requests(request.protocol).consume(&pair.shared.pair.client, &pair.shared.client.router, chunk.request, pair.shared.pair.now));
            },
            .done => |event_done| {
                try std.testing.expectEqual(@as(u32, 1), event_done.chunks);
                done = true;
            },
            .failed => |failed| {
                std.debug.print("unexpected failure {any} detail={s}\n", .{ failed, pair.shared.client.requests(request.protocol).outbound[request.handle.index].request.failure_detail });
                return error.TestUnexpectedResult;
            },
            else => {},
        };
        if (done) break;
    }
    try std.testing.expect(done);
    try std.testing.expectEqual(@as(u32, 1), chunks);

    try std.testing.expect(!pair.shared.client.requests(request.protocol).outbound[request.handle.index].request.occupied());
    try std.testing.expect(!pair.shared.pair.client.registry.slots[pair.shared.handles.client.index].table.matches(
        pair.shared.client.requests(request.protocol).outbound[request.handle.index].request.stream.slot,
        pair.shared.client.requests(request.protocol).outbound[request.handle.index].request.stream.id,
    ));
}

fn expectFailure(pair: *Pair, expected: rr.Failure) !void {
    var failure: ?rr.Failure = null;
    for (0..8) |_| {
        for (try pump(pair)) |event| switch (event) {
            .failed => |failed| failure = failed.reason,
            .chunk, .done => return error.TestUnexpectedResult,
            else => {},
        };
        if (failure != null) break;
    }
    try std.testing.expect(failure != null);
    try std.testing.expectEqualDeep(expected, failure.?);
}

test "reqresp recovers only complete Goodbye bytes retained by a closed authenticated connection" {
    for ([_]bool{ false, true }) |truncated| for ([_]bool{ false, true }) |fin| {
        var pair: Pair = .{};
        const quotas = admission_fixture.quotas(100, 1000);
        try pair.init(.{}, .{ .admission = .{ .policy = policy_fixture.config(), .limits = .{ .source = quotas, .global = quotas } } });
        defer pair.deinit();
        var payload: [8]u8 = undefined;
        std.mem.writeInt(u64, &payload, 129, .little);
        var sink: [8]u8 = undefined;
        const request = try negotiate(&pair, .goodbye_v1, &payload, &sink, .{});
        _ = try pair.shared.server.control_reqresp.accept(&pair.shared.pair.server, request.remote, .{ .protocol = .{ .reqresp = .goodbye_v1 }, .leftover = &.{}, .fin = false }, pair.shared.pair.now);
        var wire: [128]u8 = undefined;
        const encoded = try codec.encodeRequest(&payload, &wire);
        const bytes = encoded[0 .. encoded.len - @intFromBool(truncated)];
        try std.testing.expectEqual(bytes.len, try pair.shared.pair.client.write(pair.shared.client.control_reqresp.outbound[request.handle.index].request.stream, bytes, fin));
        try pair.shared.pair.pump();
        try std.testing.expect(pair.shared.pair.client.close(pair.shared.handles.client, 0));
        try pair.shared.pair.pump();
        try std.testing.expectEqual(.closed, pair.shared.pair.server.registry.slots[pair.shared.handles.server.index].state);
        const result = pair.shared.server.control_reqresp.closingGoodbye(&pair.shared.pair.server, &pair.shared.server.router, pair.shared.handles.server, pair.shared.pair.now);
        try std.testing.expectEqual(if (truncated) @as(?u64, null) else @as(?u64, 129), result);
        try std.testing.expect(pair.shared.server.control_reqresp.closingGoodbye(&pair.shared.pair.server, &pair.shared.server.router, pair.shared.handles.server, pair.shared.pair.now) == null);
        pair.shared.server.control_reqresp.connectionClosed(&pair.shared.pair.server, &pair.shared.server.router, pair.shared.handles.server, pair.shared.pair.now);
    };
}

test "reqresp response FIN stops complete written responses but do not hide an empty stopped response" {
    const Case = enum { empty, chunk, refused };
    for (std.enums.values(Case)) |case| {
        var pair: Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        const payload = [_]u8{7} ** 8;
        var sink: [8]u8 = undefined;
        const request = try pair.shared.client.control_reqresp.request(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.handles.client, .ping_v1, &payload, &sink, .{}, pair.shared.pair.now);
        var incoming: ?rr.RequestHandle = null;
        var sent = false;
        for (0..32) |_| {
            try pair.pumpOnce();
            for (pair.serverEvents()) |event| switch (event) {
                .request => |value| {
                    incoming = value.request;
                    if (case == .chunk) try pair.shared.server.control_reqresp.respond(value.request, &payload, null, pair.shared.pair.now);
                },
                .chunk_sent => sent = true,
                .failed => return error.TestUnexpectedResult,
                else => {},
            };
            if (incoming != null and (case != .chunk or sent)) break;
        }
        try std.testing.expect(incoming != null);
        var events: [8]rr.Event = undefined;
        if (case == .refused) {
            try pair.shared.server.control_reqresp.respondError(incoming.?, 2, "refused", pair.shared.pair.now);
            // Writes the error chunk, leaving its FIN for a later pump.
            const slot = &pair.shared.server.control_reqresp.inbound[incoming.?.index];
            for (0..4) |_| {
                try std.testing.expectEqual(0, pair.shared.server.control_reqresp.pump(&pair.shared.pair.server, &pair.shared.server.router, pair.shared.pair.now, &events));
                if (slot.state == .finishing) break;
            }
            try std.testing.expectEqual(.finishing, slot.state);
        }
        const stream = pair.shared.client.control_reqresp.outbound[request.index].request.stream;
        pair.shared.pair.client.shutdown(stream, .read, 0);
        try pair.shared.pair.pump();
        if (case != .refused) try std.testing.expect(pair.shared.server.control_reqresp.finish(incoming.?, pair.shared.pair.now));
        var terminal = false;
        for (0..8) |_| {
            const count = pair.shared.server.control_reqresp.pump(&pair.shared.pair.server, &pair.shared.server.router, pair.shared.pair.now, &events);
            for (events[0..count]) |event| switch (event) {
                .served => |value| {
                    try std.testing.expect(case != .empty);
                    try std.testing.expectEqual(@as(u32, @intFromBool(case == .chunk)), value.chunks);
                    terminal = true;
                },
                .failed => |value| {
                    try std.testing.expectEqual(.empty, case);
                    try std.testing.expectEqual(rr.Failure.stream_closed, value.reason);
                    terminal = true;
                },
                else => {},
            };
            if (terminal) break;
        }
        try std.testing.expect(terminal);
    }
}

test "reqresp dispatches a complete Goodbye before FIN and keeps other request framing strict" {
    const Case = enum { goodbye, ping, truncated, trailing };
    for (std.enums.values(Case)) |case| {
        var pair: Pair = .{};
        try pair.init(.{ .outbound_max = 1 }, .{ .serving_max = 1 });
        defer pair.deinit();
        const method: protocol.Protocol = if (case == .ping) .ping_v1 else .goodbye_v1;
        var payload: [8]u8 = undefined;
        std.mem.writeInt(u64, &payload, 129, .little);
        var sink: [8]u8 = undefined;
        const request = try negotiate(&pair, method, &payload, &sink, .{});
        _ = try pair.shared.server.control_reqresp.accept(&pair.shared.pair.server, request.remote, .{ .protocol = .{ .reqresp = method }, .leftover = &.{}, .fin = false }, pair.shared.pair.now);
        const local = pair.shared.client.control_reqresp.outbound[request.handle.index].request.stream;
        var wire: [128]u8 = undefined;
        const encoded = try codec.encodeRequest(&payload, &wire);
        var len = encoded.len;
        if (case == .truncated) len -= 1;
        if (case == .trailing) {
            wire[len] = 0;
            len += 1;
        }
        try std.testing.expectEqual(len, try pair.shared.pair.client.write(local, wire[0..len], false));
        var requests: usize = 0;
        for (0..8) |_| {
            try pair.shared.pair.pump();
            harness.forward(&pair.shared.pair, &pair.shared.pair.server, &pair.shared.server.control_reqresp);
            const count = pair.shared.server.control_reqresp.pump(&pair.shared.pair.server, &pair.shared.server.router, pair.shared.pair.now, &pair.server_events);
            for (pair.server_events[0..count]) |event| if (event == .request) {
                try std.testing.expectEqualSlices(u8, &payload, event.request.bytes);
                requests += 1;
            };
        }
        try std.testing.expectEqual(@as(usize, @intFromBool(case == .goodbye)), requests);
        if (case == .trailing) {
            try std.testing.expectError(error.StreamStopped, pair.shared.pair.client.write(local, &.{}, true));
        } else {
            _ = try pair.shared.pair.client.write(local, &.{}, true);
        }
        for (0..8) |_| {
            try pair.shared.pair.pump();
            harness.forward(&pair.shared.pair, &pair.shared.pair.server, &pair.shared.server.control_reqresp);
            const count = pair.shared.server.control_reqresp.pump(&pair.shared.pair.server, &pair.shared.server.router, pair.shared.pair.now, &pair.server_events);
            for (pair.server_events[0..count]) |event| if (event == .request) {
                try std.testing.expectEqualSlices(u8, &payload, event.request.bytes);
                requests += 1;
            };
        }
        try std.testing.expectEqual(@as(usize, @intFromBool(case == .goodbye or case == .ping)), requests);
    }
}

test "reqresp half close preserves early metadata and nonempty request responses" {
    for ([_]protocol.Protocol{ .metadata_v1, .metadata_v2, .metadata_v3, .ping_v1 }) |method| {
        for ([_]bool{ false, true }) |stop| {
            for ([_]bool{ false, true }) |buffered| {
                errdefer std.debug.print("half close case method={s} stop={any} buffered={any}\n", .{ @tagName(method), stop, buffered });
                var pair: Pair = .{};
                try pair.init(.{ .outbound_max = 1, .serving_max = 1 }, .{});
                defer pair.deinit();
                const bytes = [_]u8{7} ** 25;
                var sink: [25]u8 = undefined;
                const request = try negotiate(&pair, method, bytes[0..method.info().request_min], &sink, .{});
                const response = bytes[0..method.info().response_min];
                try reply(&pair, request, 0, response, true);
                if (stop) pair.shared.pair.server.shutdown(request.remote, .read, 0);
                if (buffered) {
                    try pair.shared.pair.pump();
                    const slot = &pair.shared.client.control_reqresp.outbound[request.handle.index];
                    const input = try slot.request.io.read(&pair.shared.pair.client, slot.request.stream);
                    try std.testing.expect(input.bytes.len > 0 and input.fin);
                }
                try expectDone(&pair, request, response);
            }
        }
    }
}

test "reqresp half close accepts a later response and releases the request buffer" {
    var pair: Pair = .{};
    try pair.init(.{ .outbound_max = 1, .serving_max = 1 }, .{});
    defer pair.deinit();
    const bytes = [_]u8{7} ** 8;
    var sink: [8]u8 = undefined;
    const request = try negotiate(&pair, .ping_v1, &bytes, &sink, .{});
    pair.shared.pair.server.shutdown(request.remote, .read, 0);
    for (0..4) |_| try std.testing.expectEqual(@as(usize, 0), (try pump(&pair)).len);
    const slot = &pair.shared.client.control_reqresp.outbound[request.handle.index];
    try std.testing.expectEqual(.response, slot.phase);
    try std.testing.expectEqual(@as(usize, 0), slot.request.io.payload.len);
    try std.testing.expect(!slot.request.io.writing and slot.request.io.outbox.idle());
    pair.shared.pair.advance(100);
    try reply(&pair, request, 0, &bytes, true);
    try expectDone(&pair, request, &bytes);
}

test "reqresp half close still reports peer errors malformed responses and response resets" {
    const Case = enum { peer_error, malformed, truncated, reset };
    for (std.enums.values(Case)) |case| {
        var pair: Pair = .{};
        try pair.init(.{ .outbound_max = 1, .serving_max = 1 }, .{});
        defer pair.deinit();
        var sink: [25]u8 = undefined;
        const request = try negotiate(&pair, .metadata_v3, &.{}, &sink, .{});
        const expected: rr.Failure = switch (case) {
            .peer_error => value: {
                try reply(&pair, request, 2, "busy", true);
                break :value .{ .peer_error = .{ .code = 2, .message_len = 4 } };
            },
            .malformed => value: {
                try reply(&pair, request, 0, "short", true);
                break :value .{ .invalid_response = error.LengthOutOfBounds };
            },
            .truncated => value: {
                _ = try pair.shared.pair.server.write(request.remote, &.{0}, true);
                break :value .{ .invalid_response = error.Truncated };
            },
            .reset => value: {
                pair.shared.pair.server.shutdown(request.remote, .write, 7);
                break :value .stream_closed;
            },
        };
        pair.shared.pair.server.shutdown(request.remote, .read, 0);
        try expectFailure(&pair, expected);
    }
}

test "reqresp half close without a response retains the transfer deadline" {
    for ([_]u64{ 100, 10_000 }) |duration| {
        var pair: Pair = .{};
        try pair.init(.{ .outbound_max = 1, .serving_max = 1 }, .{});
        defer pair.deinit();
        var sink: [25]u8 = undefined;
        const request = try negotiate(&pair, .metadata_v3, &.{}, &sink, if (duration == 100)
            .{ .timeouts = .{ .response = .fromMilliseconds(@intCast(duration)) } }
        else
            .{});
        pair.shared.pair.server.shutdown(request.remote, .read, 0);
        for (0..4) |_| try std.testing.expectEqual(@as(usize, 0), (try pump(&pair)).len);
        try std.testing.expectEqual(.response, pair.shared.client.control_reqresp.outbound[request.handle.index].phase);
        pair.shared.pair.advance(duration - 1);
        try std.testing.expectEqual(@as(usize, 0), (try pump(&pair)).len);
        pair.shared.pair.advance(1);
        try expectFailure(&pair, .timeout);
        try std.testing.expectEqual(@as(u64, 1), pair.shared.client.control_reqresp.outgoing_error_reasons[@intFromEnum(ErrorReason.REQUEST_ERROR_RESP_TIMEOUT)]);
    }
}

test "reqresp half close cancellation frees the only slot for a subsequent request" {
    var pair: Pair = .{};
    try pair.init(.{ .outbound_max = 1, .serving_max = 1 }, .{});
    defer pair.deinit();
    var sink: [25]u8 = undefined;
    const first = try negotiate(&pair, .metadata_v3, &.{}, &sink, .{});
    pair.shared.pair.server.shutdown(first.remote, .read, 0);
    for (0..4) |_| try std.testing.expectEqual(@as(usize, 0), (try pump(&pair)).len);
    try std.testing.expect(pair.shared.client.control_reqresp.cancel(&pair.shared.pair.client, &pair.shared.client.router, first.handle, pair.shared.pair.now));
    try expectFailure(&pair, .cancelled);

    try std.testing.expectEqual(@as(usize, 0), (try pump(&pair)).len);
    const second = try negotiate(&pair, .metadata_v3, &.{}, &sink, .{});
    try std.testing.expectEqual(first.handle.index, second.handle.index);
    try std.testing.expect(second.handle.generation > first.handle.generation);
    const bytes = [_]u8{0} ** 25;
    try reply(&pair, second, 0, &bytes, true);
    pair.shared.pair.server.shutdown(second.remote, .read, 0);
    try expectDone(&pair, second, &bytes);
}

test "reqresp half close preserves context and successive response chunks" {
    var pair: Pair = .{};
    try pair.init(.{ .outbound_max = 1, .serving_max = 1 }, .{});
    defer pair.deinit();
    const sink = try std.testing.allocator.alloc(u8, protocol.Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    const roots = [_]u8{7} ** 64;
    const request = try negotiate(&pair, .blocks_by_root_v2, &roots, sink, .{});
    pair.shared.pair.server.shutdown(request.remote, .read, 0);
    const block = [_]u8{7} ** 4000;
    var wire: [codec.frame_scratch_max]u8 = undefined;
    const encoded = try codec.encodeChunk(0, harness.deneb_digest, &block, &wire);
    var chunks: u32 = 0;
    var done = false;
    for (0..2) |index| {
        try std.testing.expectEqual(encoded.len, try pair.shared.pair.server.write(request.remote, encoded, index == 1));
        for (0..8) |_| {
            for (try pump(&pair)) |event| switch (event) {
                .chunk => |chunk| {
                    try std.testing.expectEqual(.deneb, chunk.fork.?);
                    try std.testing.expectEqualSlices(u8, &block, chunk.bytes);
                    chunks += 1;
                    try std.testing.expect(pair.shared.client.reqresp.consume(&pair.shared.pair.client, &pair.shared.client.router, chunk.request, pair.shared.pair.now));
                },
                .failed => return error.TestUnexpectedResult,
                else => {},
            };
            if (chunks == index + 1) break;
        }
        try std.testing.expectEqual(@as(u32, @intCast(index + 1)), chunks);
    }
    for (0..8) |_| {
        for (try pump(&pair)) |event| switch (event) {
            .done => |finished| {
                try std.testing.expectEqual(@as(u32, 2), finished.chunks);
                done = true;
            },
            .chunk, .failed => return error.TestUnexpectedResult,
            else => {},
        };
        if (done) break;
    }
    try std.testing.expect(done);
}

test "reqresp half close does not hide a retired stream without response EOF" {
    var pair: Pair = .{};
    try pair.init(.{ .outbound_max = 1, .serving_max = 1 }, .{});
    defer pair.deinit();
    var sink: [25]u8 = undefined;
    const request = try negotiate(&pair, .metadata_v3, &.{}, &sink, .{});
    pair.shared.pair.client.closeStream(pair.shared.client.control_reqresp.outbound[request.handle.index].request.stream, 0);
    try expectFailure(&pair, .stream_closed);
}

test "reqresp FIN before the first chunk fails single-response methods with empty_response" {
    for ([_]protocol.Protocol{ .ping_v1, .metadata_v2 }) |method| {
        var pair: Pair = .{};
        try pair.init(.{ .outbound_max = 1, .serving_max = 1 }, .{});
        defer pair.deinit();
        const bytes = [_]u8{7} ** 25;
        var sink: [25]u8 = undefined;
        const request = try negotiate(&pair, method, bytes[0..method.info().request_min], &sink, .{});
        _ = try pair.shared.pair.server.write(request.remote, &.{}, true);
        try expectFailure(&pair, .empty_response);
        try std.testing.expectEqual(@as(u64, 1), pair.shared.client.control_reqresp.outgoing_error_reasons[@intFromEnum(ErrorReason.REQUEST_ERROR_EMPTY_RESPONSE)]);
    }
}

test "reqresp FIN before the first chunk still completes Goodbye" {
    var pair: Pair = .{};
    try pair.init(.{ .outbound_max = 1, .serving_max = 1 }, .{});
    defer pair.deinit();
    var payload: [8]u8 = undefined;
    std.mem.writeInt(u64, &payload, 1, .little);
    var sink: [8]u8 = undefined;
    const request = try negotiate(&pair, .goodbye_v1, &payload, &sink, .{});
    _ = try pair.shared.pair.server.write(request.remote, &.{}, true);
    var done = false;
    for (0..8) |_| {
        for (try pump(&pair)) |event| switch (event) {
            .done => |value| {
                try std.testing.expectEqual(@as(u32, 0), value.chunks);
                done = true;
            },
            .chunk, .failed => return error.TestUnexpectedResult,
            else => {},
        };
        if (done) break;
    }
    try std.testing.expect(done);
}

test "reqresp closing Goodbye detaches I/O on read failure before returning outside pump" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const stream = try pair.openRaw(.goodbye_v1);
    try pair.awaitRawSelection(stream, .goodbye_v1);
    const owner = &pair.shared.server.control_reqresp;
    var handle: ?rr.RequestHandle = null;
    for (owner.inbound, 0..) |*slot, index| if (slot.request.running() and slot.request.protocol == .goodbye_v1) {
        handle = slot.request.handle(@intCast(index));
        break;
    };
    const active = handle orelse return error.RequestNotReceived;
    pair.shared.pair.client.closeStream(stream, 77);
    try pair.shared.pair.pump();
    try std.testing.expect(owner.closingGoodbye(&pair.shared.pair.server, &pair.shared.server.router, pair.shared.handles.server, pair.shared.pair.now) == null);
    const slot = &owner.inbound[active.index];
    try std.testing.expectEqual(rr.Failure.stream_closed, slot.request.terminalEvent().?.failed.reason);
    try std.testing.expectEqual(.closed, slot.request.stream_owner);
    try std.testing.expect(slot.request.occupied());
    try std.testing.expect(owner.closingGoodbye(&pair.shared.pair.server, &pair.shared.server.router, pair.shared.handles.server, pair.shared.pair.now) == null);
    var output: [1]rr.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), owner.pump(&pair.shared.pair.server, &pair.shared.server.router, pair.shared.pair.now, &output));
    try std.testing.expectEqual(rr.Failure.stream_closed, output[0].failed.reason);
}
