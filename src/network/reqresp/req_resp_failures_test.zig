const std = @import("std");
const ct = @import("consensus_types");
const codec = @import("codec.zig");
const reqresp = @import("ReqResp.zig");
const harness = @import("test_pair.zig");
const Event = reqresp.Event;
const Pair = harness.Pair;
const requestStatus = harness.requestStatus;
const firstFailure = harness.firstFailure;
const waitForRequest = harness.waitForRequest;

test "reqresp delivers error chunks with the peer's code and message" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
    var request_storage_2: [ct.phase0.Status.fixed_size]u8 = undefined;
    _ = try requestStatus(&setup, &request_storage_2, &sink);
    var saved_failure: ?Event.Failed = null;
    var client_failure: ?reqresp.Failure = null;
    var served: ?u32 = null;
    var rounds: usize = 0;
    while (rounds < 30 and (client_failure == null or served == null)) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                try setup.shared.server.control_reqresp.respondError(incoming.request, 3, "unavailable", setup.shared.pair.now);
                try std.testing.expectError(
                    error.Busy,
                    setup.shared.server.control_reqresp.respond(incoming.request, &sink, null, setup.shared.pair.now),
                );
            },
            .served => |finished| served = finished.chunks,
            else => {},
        };
        for (setup.clientEvents()) |event| switch (event) {
            .failed => |failure| {
                client_failure = failure.reason;
                saved_failure = failure;
                try std.testing.expectEqualStrings(
                    "unavailable",
                    failure.errorMessage(),
                );
            },
            .chunk => return error.TestUnexpectedResult,
            else => {},
        };
    }
    try std.testing.expectEqual(@as(?u32, 0), served);
    const reason = client_failure orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u8, 3), reason.peer_error.code);
    try std.testing.expectEqual(@as(u8, 11), reason.peer_error.message_len);

    var request_storage_3: [ct.phase0.Status.fixed_size]u8 = undefined;
    const next = try requestStatus(&setup, &request_storage_3, &sink);
    try std.testing.expectEqual(saved_failure.?.request.index, next.index);
    try std.testing.expect(saved_failure.?.request.generation != next.generation);
    try std.testing.expectEqualStrings("unavailable", saved_failure.?.errorMessage());
    client_failure = null;
    rounds = 0;
    while (rounds < 30 and client_failure == null) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                const stream = setup.shared.server.control_reqresp.inbound[incoming.request.index].request.stream;
                try std.testing.expectEqual(@as(usize, 2), try setup.shared.pair.server.write(stream, &.{ 5, 0 }, true));
            },
            else => {},
        };
        if (firstFailure(setup.clientEvents())) |failure| client_failure = failure;
    }
    const reserved = client_failure orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(u8, 5), reserved.peer_error.code);
}

test "reqresp fails every request on a connection that closes" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
    var request_storage_11: [ct.phase0.Status.fixed_size]u8 = undefined;
    _ = try requestStatus(&setup, &request_storage_11, &sink);
    try waitForRequest(&setup);
    try std.testing.expect(setup.shared.pair.client.close(setup.shared.handles.client, 0));
    var client_failure: ?reqresp.Failure = null;
    var server_failure: ?reqresp.Failure = null;
    var rounds: usize = 0;
    while (rounds < 20 and (client_failure == null or server_failure == null)) : (rounds += 1) {
        try setup.pumpOnce();
        if (firstFailure(setup.clientEvents())) |failure| client_failure = failure;
        if (firstFailure(setup.serverEvents())) |failure| server_failure = failure;
    }
    try std.testing.expect(client_failure != null and client_failure.? == .connection_closed);
    try std.testing.expect(server_failure != null and server_failure.? == .connection_closed);
}

test "reqresp answers a malformed request with an invalid request error" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    const raw = try setup.openRaw(.status_v1);
    try setup.awaitRawSelection(raw, .status_v1);
    var rounds: usize = 0;
    const garbage = [_]u8{0x80} ** 11;
    try std.testing.expectEqual(garbage.len, try setup.shared.pair.client.write(raw, &garbage, true));
    var served: ?u32 = null;
    rounds = 0;
    while (rounds < 20 and served == null) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .served => |finished| served = finished.chunks,
            .request => return error.TestUnexpectedResult,
            else => {},
        };
    }
    try std.testing.expectEqual(@as(?u32, 0), served);
    var sink: [codec.error_message_max]u8 = undefined;
    var scratch: [codec.frame_scratch_max]u8 = undefined;
    var decoder = codec.Decoder.initResponse(.{ .min = 84, .max = 84 }, false, &sink, &scratch);
    var buffer: [256]u8 = undefined;
    rounds = 0;
    while (rounds < 10 and !decoder.isDone()) : (rounds += 1) {
        try setup.shared.pair.pump();
        const read = try setup.shared.pair.client.read(raw, &buffer);
        if (read.len > 0) _ = try decoder.feed(buffer[0..read.len]);
    }
    try std.testing.expect(decoder.isDone());
    try std.testing.expectEqual(@as(u8, 1), decoder.result());
    try std.testing.expectEqualStrings("invalid request", decoder.payload());
}

test "reqresp retains all 256 bytes of a peer error" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const request = [_]u8{0} ** 8;
    const message = [_]u8{'e'} ** 256;
    var sink: [8]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        .ping_v1,
        &request,
        &sink,
        .{},
        setup.shared.pair.now,
    );
    for (0..50) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |r| try setup.shared.server.control_reqresp.respondError(r.request, 1, &message, setup.shared.pair.now),
            else => {},
        };
        for (setup.clientEvents()) |event| switch (event) {
            .failed => |failed| {
                try std.testing.expectEqual(@as(u16, 256), failed.reason.peer_error.message_len);
                try std.testing.expectEqualSlices(
                    u8,
                    &message,
                    failed.errorMessage(),
                );
                return;
            },
            else => {},
        };
    }
    return error.TestUnexpectedResult;
}

test "reqresp preserves pending chunk and reports connection closure without output space" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    const handle = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    try waitForRequest(&setup);
    const incoming = setup.serverEvents()[0].request.request;
    try setup.shared.server.control_reqresp.respond(incoming, &bytes, null, setup.shared.pair.now);
    var held = false;
    for (0..30) |_| {
        _ = setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &.{});
        try setup.shared.pair.pump();
        setup.forwardEvents();
        _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
        if (setup.shared.client.control_reqresp.outbound[handle.index].request.pendingEvent() != null) {
            held = true;
            break;
        }
    }
    try std.testing.expect(held);
    const stream = setup.shared.client.control_reqresp.outbound[handle.index].request.stream;
    setup.shared.client.control_reqresp.connectionClosed(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, setup.shared.pair.now);
    _ = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
    try std.testing.expect(!setup.shared.pair.client.registry.slots[stream.conn.index].table.matches(stream.slot, stream.id));
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    try std.testing.expectEqualSlices(u8, &bytes, events[0].chunk.bytes);
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    try std.testing.expect(events[0].failed.reason == .connection_closed);
    try std.testing.expectEqual(@as(usize, 0), setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
}
