const std = @import("std");
const rr = @import("ReqResp.zig");
const codec = @import("codec.zig");
const Protocol = @import("protocol.zig").Protocol;
const harness = @import("test_pair.zig");
const Pair = harness.Pair;
const time = @import("../time.zig");

fn awaitRequest(pair: *Pair) !rr.RequestHandle {
    for (0..40) |_| {
        try pair.pumpOnce();
        for (pair.serverEvents()) |event| if (event == .request) return event.request.request;
    }
    return error.MissingRequest;
}

fn awaitChunk(pair: *Pair) !void {
    for (0..40) |_| {
        try pair.pumpOnce();
        for (pair.clientEvents()) |event| if (event == .chunk) {
            try std.testing.expectEqual(pair.shared.handles.client, event.chunk.origin.connection);
            try std.testing.expectEqual(pair.shared.pair.client.peerAddress(pair.shared.handles.client).?, event.chunk.origin.endpoint.?);
            return;
        };
    }
    return error.MissingChunk;
}

test "reqresp attribution keeps absolute deadlines while excluding host holds and unread bytes" {
    const Case = enum { remote, host_hold, native_buffer, transport_buffer };
    for (std.enums.values(Case)) |case| {
        var pair: Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        const which = Protocol.blocks_by_root_v2;
        const sink = try std.testing.allocator.alloc(u8, which.info().response_max);
        defer std.testing.allocator.free(sink);
        const handle = try pair.shared.client.reqresp.request(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.handles.client, which, &(@as([64]u8, @splat(0))), sink, .{ .timeouts = .{ .response = .fromMilliseconds(100) } }, pair.shared.pair.now);
        const incoming = try awaitRequest(&pair);
        const stream = pair.shared.server.reqresp.inbound[incoming.index].request.stream;
        const client = &pair.shared.client.reqresp.outbound[handle.index];
        try std.testing.expectEqual(.response, client.phase);
        const deadline = client.deadline().?;
        if (case == .host_hold or case == .native_buffer) {
            const payload = [_]u8{0} ** 3000;
            var encoded: [codec.frame_scratch_max]u8 = undefined;
            const first = try codec.encodeChunk(0, harness.deneb_digest, &payload, &encoded);
            const length = if (case == .native_buffer) first.len + (try codec.encodeChunk(0, harness.deneb_digest, &payload, encoded[first.len..])).len else first.len;
            try std.testing.expectEqual(length, try pair.shared.pair.server.write(stream, encoded[0..length], false));
            try awaitChunk(&pair);
            if (case == .host_hold) pair.shared.pair.now.monotonic = time.milliseconds(deadline - 1);
            try std.testing.expect(pair.shared.client.reqresp.consume(&pair.shared.pair.client, &pair.shared.client.router, handle, pair.shared.pair.now));
            if (case == .host_hold) try std.testing.expect(client.host_held_ms > 0);
            if (case == .native_buffer) {
                try std.testing.expectEqual(@as(u64, 0), client.host_held_ms);
                try std.testing.expect(client.request.io.buffered_end > client.request.io.buffered_start);
            }
        }
        if (case == .transport_buffer) {
            try std.testing.expectEqual(@as(usize, 1), try pair.shared.pair.server.write(stream, &.{0}, false));
            try pair.shared.pair.pump();
            try std.testing.expect(try pair.shared.pair.client.streamReadable(client.request.stream));
        }
        pair.shared.pair.now.monotonic = time.milliseconds(deadline);
        var events: [1]rr.Event = undefined;
        const count = pair.shared.client.reqresp.pump(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.pair.now, &events);
        try std.testing.expectEqual(@as(usize, 1), count);
        try std.testing.expectEqual(rr.Failure.timeout, events[0].failed.reason);
        const fault = events[0].peerFault();
        if (case == .remote) {
            try std.testing.expectEqual(.non_completion, fault.?.kind);
            try std.testing.expectEqual(pair.shared.handles.client, fault.?.origin.connection);
            try std.testing.expectEqual(pair.shared.pair.client.peerAddress(pair.shared.handles.client).?, fault.?.origin.endpoint.?);
            try std.testing.expectEqual(fault.?.origin, events[0].failed.origin.?);
            try std.testing.expect(fault.?.identity.eql(&pair.shared.pair.client.peerId(pair.shared.handles.client).?));
        } else try std.testing.expect(fault == null);
        const old = events[0];
        const next = try pair.shared.client.reqresp.request(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.handles.client, which, &(@as([64]u8, @splat(0))), sink, .{}, pair.shared.pair.now);
        try std.testing.expectEqual(handle.index, next.index);
        try std.testing.expect(next.generation != handle.generation);
        events[0] = .{ .done = .{ .request = next, .chunks = 0 } };
        if (case == .remote) {
            try std.testing.expectEqual(.non_completion, old.peerFault().?.kind);
            try std.testing.expect(old.peerFault().?.identity.eql(&pair.shared.pair.client.peerId(pair.shared.handles.client).?));
        } else try std.testing.expect(old.peerFault() == null);
    }
}

test "reqresp attribution ignores locally unread incoming bodies at absolute expiry" {
    var pair: Pair = .{};
    try pair.init(.{}, .{ .progress_timeout_ms = 100 });
    defer pair.deinit();
    const stream = try pair.openRaw(.ping_v1);
    try pair.awaitRawSelection(stream, .ping_v1);
    const incoming = for (pair.shared.server.control_reqresp.inbound) |*slot| {
        if (slot.request.occupied()) break slot;
    } else return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(usize, 1), try pair.shared.pair.client.write(stream, &.{8}, false));
    try pair.shared.pair.pump();
    try std.testing.expect(try pair.shared.pair.server.streamReadable(incoming.request.stream));
    pair.shared.pair.now.monotonic = time.milliseconds(incoming.deadline(&pair.shared.server.control_reqresp).?);
    var events: [1]rr.Event = undefined;
    const count = pair.shared.server.control_reqresp.pump(&pair.shared.pair.server, &pair.shared.server.router, pair.shared.pair.now, &events);
    try std.testing.expectEqual(@as(usize, 1), count);
    try std.testing.expectEqual(rr.Failure.timeout, events[0].failed.reason);
    try std.testing.expect(events[0].peerFault() == null);
}

test "reqresp attribution distinguishes local response caps intrinsic bounds and error replies" {
    const Case = enum { local_payload, intrinsic_length, reserved_error, rate_limit, invalid_error_length, caller_chunks, protocol_chunks };
    for (std.enums.values(Case)) |case| {
        var pair: Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        const which = Protocol.blocks_by_root_v2;
        const sink = try std.testing.allocator.alloc(u8, which.info().response_max);
        defer std.testing.allocator.free(sink);
        if (case == .local_payload) pair.shared.client.reqresp.policy.config.max_payload_size = 4000;
        const empty: []const u8 = &.{};
        const roots: []const u8 = &(@as([32]u8, @splat(0)));
        const handle = try pair.shared.client.reqresp.request(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.handles.client, which, if (case == .protocol_chunks) empty else roots, sink, .{ .expected_chunks = if (case == .caller_chunks) 0 else null }, pair.shared.pair.now);
        const incoming = try awaitRequest(&pair);
        const stream = pair.shared.server.reqresp.inbound[incoming.index].request.stream;
        var storage: [codec.frame_scratch_max]u8 = undefined;
        const bytes: []const u8 = switch (case) {
            .local_payload => &([_]u8{0} ++ harness.deneb_digest ++ [_]u8{ 0x88, 0x27 }),
            .intrinsic_length => &([_]u8{0} ++ harness.deneb_digest ++ [_]u8{1}),
            .reserved_error, .rate_limit => encoded: {
                const encoded = try codec.encodeChunk(1, null, "rate limited", &storage);
                storage[0] = if (case == .reserved_error) 5 else 139;
                break :encoded encoded;
            },
            .invalid_error_length => &.{ 5, 0x81, 0x02 },
            .caller_chunks, .protocol_chunks => try codec.encodeChunk(0, harness.deneb_digest, &(@as([3000]u8, @splat(0))), &storage),
        };
        try std.testing.expectEqual(bytes.len, try pair.shared.pair.server.write(stream, bytes, true));
        var failed = false;
        for (0..40) |_| {
            try pair.pumpOnce();
            for (pair.clientEvents()) |event| if (event == .failed) {
                try std.testing.expectEqual(handle, event.failed.request);
                const fault = event.peerFault();
                switch (case) {
                    .intrinsic_length, .invalid_error_length, .protocol_chunks => try std.testing.expectEqual(.protocol, fault.?.kind),
                    .local_payload, .reserved_error, .rate_limit, .caller_chunks => try std.testing.expect(fault == null),
                }
                if (case == .reserved_error or case == .rate_limit) try std.testing.expectEqual(bytes[0], event.failed.reason.peer_error.code);
                failed = true;
            };
            if (failed) break;
        }
        try std.testing.expect(failed);
    }
}

test "reqresp attribution keeps local request bounds neutral and malformed SSZ strong" {
    const Case = enum { host_integer, local_payload, malformed_ssz };
    for (std.enums.values(Case)) |case| {
        var pair: Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        pair.shared.server.reqresp.policy.config.host_integer_max = 10;
        pair.shared.server.reqresp.policy.config.max_payload_size = 128;
        const which: Protocol = if (case == .host_integer) .blocks_by_range_v2 else .blocks_by_root_v2;
        const stream = try pair.openRaw(which);
        try pair.awaitRawSelection(stream, which);
        const payload: []const u8 = switch (case) {
            .host_integer => &.{ 11, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0 },
            .local_payload => &(@as([160]u8, @splat(0))),
            .malformed_ssz => &.{0},
        };
        var storage: [codec.encodedLengthMax(160)]u8 = undefined;
        const encoded = try codec.encodeRequest(payload, &storage);
        try std.testing.expectEqual(encoded.len, try pair.shared.pair.client.write(stream, encoded, true));
        var terminal = false;
        for (0..40) |_| {
            try pair.pumpOnce();
            for (pair.serverEvents()) |event| if (event == .served or event == .failed) {
                const fault = event.peerFault();
                if (case == .malformed_ssz) {
                    try std.testing.expectEqual(.protocol, fault.?.kind);
                } else try std.testing.expect(fault == null);
                terminal = true;
            };
            if (terminal) break;
        }
        try std.testing.expect(terminal);
    }
}
