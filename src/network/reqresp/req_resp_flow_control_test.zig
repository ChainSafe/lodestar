const std = @import("std");
const schedule_test_support = @import("../schedule_test_support.zig");
const ct = @import("consensus_types");
const codec = @import("codec.zig");
const protocol = @import("protocol.zig");
const reqresp = @import("ReqResp.zig");
const harness = @import("test_pair.zig");
const Engine = @import("../quic/Engine.zig");
const multistream = @import("../wire/multistream.zig");
const Router = @import("../router.zig").Router;
const Event = reqresp.Event;
const Protocol = protocol.Protocol;
const Pair = harness.Pair;
const deneb_digest = harness.deneb_digest;
const statusBytes = harness.statusBytes;
const requestStatus = harness.requestStatus;
const requestBlocks = harness.requestBlocks;
const waitForRequest = harness.waitForRequest;

const RawReply = fn (*Pair, Engine.StreamHandle) anyerror!void;

fn pumpRawServer(setup: *Pair, comptime reply: RawReply) !usize {
    try setup.shared.pair.pump();
    const now = setup.shared.pair.now;
    var storage: [16]Engine.Event = undefined;
    for (setup.shared.pair.events(&setup.shared.pair.server, &storage)) |event| switch (event) {
        .stream_opened => |stream| try setup.shared.server.router.negotiator.acceptInbound(&setup.shared.pair.server, stream, now),
        else => {},
    };
    var leftover: usize = 0;
    var outcomes: [8]Router.Outcome = undefined;
    setup.forwardEvents();
    const dialed = setup.shared.client.router.pump(&setup.shared.pair.client, now, &outcomes);
    for (outcomes[0..dialed]) |outcome| {
        if (outcome.result == .ready) leftover += outcome.result.ready.leftover.len;
        try std.testing.expect(setup.shared.client.control_reqresp.negotiated(&setup.shared.pair.client, &setup.shared.client.router, outcome, now));
    }
    setup.forwardEvents();
    const listened = setup.shared.server.router.pump(&setup.shared.pair.server, now, &outcomes);
    for (outcomes[0..listened]) |outcome| switch (outcome.result) {
        .ready => try reply(setup, outcome.stream),
        else => return error.TestUnexpectedResult,
    };
    setup.client_count = setup.shared.client.control_reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, now, &setup.client_events);
    try setup.shared.pair.pump();
    return leftover;
}

fn replyMetadataEarly(setup: *Pair, stream: Engine.StreamHandle) !void {
    var out: [256]u8 = undefined;
    const metadata = [_]u8{5} ** ct.altair.MetaDataV2.fixed_size;
    const chunk = try codec.encodeChunk(0, null, &metadata, &out);
    try std.testing.expectEqual(chunk.len, try setup.shared.pair.server.write(stream, chunk, true));
}

fn expectSingleChunk(setup: *Pair, comptime reply: RawReply, expected: []const u8) !usize {
    var leftover: usize = 0;
    var done = false;
    var rounds: usize = 0;
    while (rounds < 20 and !done) : (rounds += 1) {
        leftover += try pumpRawServer(setup, reply);
        for (setup.clientEvents()) |event| switch (event) {
            .chunk => |chunk| {
                try std.testing.expectEqualSlices(u8, expected, chunk.bytes);
                try std.testing.expect(setup.shared.client.control_reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, chunk.request, setup.shared.pair.now));
            },
            .done => |finished| {
                try std.testing.expectEqual(@as(u32, 1), finished.chunks);
                done = true;
            },
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
    }
    try std.testing.expect(done);
    return leftover;
}

fn finishAfterNotification(delay_ms: u64) !void {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    try waitForRequest(&setup);
    const incoming = setup.serverEvents()[0].request.request;
    try setup.shared.server.control_reqresp.respond(incoming, &bytes, null, setup.shared.pair.now);
    var pending = false;
    for (0..30) |_| {
        _ = setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &.{});
        try setup.shared.pair.pump();
        if (setup.shared.server.control_reqresp.inbound[incoming.index].request.pendingEvent() != null) {
            pending = true;
            break;
        }
    }
    try std.testing.expect(pending);
    try std.testing.expect(setup.shared.server.control_reqresp.finish(incoming, setup.shared.pair.now));
    try std.testing.expect(!setup.shared.server.control_reqresp.finish(incoming, setup.shared.pair.now));
    setup.shared.pair.advance(delay_ms);
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events));
    try std.testing.expect(events[0] == .chunk_sent);
    try std.testing.expectEqual(@as(?u64, setup.shared.pair.now.millis()), schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(1), setup.shared.pair.now.millis()));
    const next = schedule_test_support.wakeupMilliseconds(setup.shared.server.control_reqresp.schedule(1), setup.shared.pair.now.millis()).?;
    setup.shared.pair.advance(next - setup.shared.pair.now.millis());
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events));
    try std.testing.expect(events[0] == .served);
}

test "reqresp finishes after the last allowed chunk without waiting for the peer" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
    var request_storage_4: [ct.phase0.Status.fixed_size]u8 = undefined;
    _ = try requestStatus(&setup, &request_storage_4, &sink);
    const reply = statusBytes(2);
    var done = false;
    var stopped = false;
    var rounds: usize = 0;
    while (rounds < 30 and !done) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                try setup.shared.server.control_reqresp.respond(incoming.request, &reply, null, setup.shared.pair.now);
            },
            .failed => |failed| {
                try std.testing.expectEqual(reqresp.Failure.stream_closed, failed.reason);
                stopped = true;
            },
            .served => return error.TestUnexpectedResult,
            .chunk_sent => |progress| {
                try std.testing.expectError(
                    error.TooManyChunks,
                    setup.shared.server.control_reqresp.respond(progress.request, &reply, null, setup.shared.pair.now),
                );
            },
            else => {},
        };
        for (setup.clientEvents()) |event| switch (event) {
            .chunk => |chunk| try std.testing.expect(setup.shared.client.control_reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, chunk.request, setup.shared.pair.now)),
            .done => |finished| {
                try std.testing.expectEqual(@as(u32, 1), finished.chunks);
                done = true;
            },
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
    }
    try std.testing.expect(done);
    try std.testing.expect(stopped);
    try std.testing.expectEqual(@as(u16, 0), setup.shared.server.control_reqresp.pendingCounts().inbound);
}

test "reqresp holds the next chunk until the host consumes the previous one" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    const size = Protocol.blocks_by_range_v2.info().response_max;
    const sink = try std.testing.allocator.alloc(u8, size);
    defer std.testing.allocator.free(sink);
    var request_storage_10: [24]u8 = undefined;
    _ = try requestBlocks(&setup, &request_storage_10, 2, sink);
    const blocks = [2][3_000]u8{ [_]u8{1} ** 3_000, [_]u8{2} ** 3_000 };
    var held: ?reqresp.RequestHandle = null;
    var chunks: u32 = 0;
    var served = false;
    var rounds: usize = 0;
    while (rounds < 40 and !(served and chunks == 1)) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                try setup.shared.server.reqresp.respond(incoming.request, &blocks[0], .{ .digest = deneb_digest, .fork = .deneb }, setup.shared.pair.now);
            },
            .chunk_sent => |progress| {
                if (progress.chunks == 1) {
                    try setup.shared.server.reqresp.respond(progress.request, &blocks[1], .{ .digest = deneb_digest, .fork = .deneb }, setup.shared.pair.now);
                } else {
                    try std.testing.expect(setup.shared.server.reqresp.finish(progress.request, setup.shared.pair.now));
                }
            },
            .served => served = true,
            else => {},
        };
        for (setup.clientEvents()) |event| switch (event) {
            .chunk => |chunk| {
                chunks += 1;
                held = chunk.request;
                try std.testing.expectEqualSlices(u8, &blocks[0], chunk.bytes);
            },
            .done, .failed => return error.TestUnexpectedResult,
            else => {},
        };
    }
    try std.testing.expect(served);
    try std.testing.expectEqual(@as(u32, 1), chunks);
    rounds = 0;
    while (rounds < 10) : (rounds += 1) {
        try setup.pumpOnce();
        try std.testing.expectEqual(@as(usize, 0), setup.clientEvents().len);
    }
    try std.testing.expect(setup.shared.client.reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, held.?, setup.shared.pair.now));
    var done = false;
    rounds = 0;
    while (rounds < 20 and !done) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.clientEvents()) |event| switch (event) {
            .chunk => |chunk| {
                chunks += 1;
                try std.testing.expectEqualSlices(u8, &blocks[1], chunk.bytes);
                try std.testing.expect(setup.shared.client.reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, chunk.request, setup.shared.pair.now));
            },
            .done => |finished| {
                try std.testing.expectEqual(@as(u32, 2), finished.chunks);
                done = true;
            },
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
    }
    try std.testing.expect(done);
    try std.testing.expectEqual(@as(u32, 2), chunks);
}

test "reqresp decodes response bytes that arrive with the multistream echo" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    var sink: [ct.altair.MetaDataV2.fixed_size]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        .metadata_v2,
        "",
        &sink,
        .{},
        setup.shared.pair.now,
    );
    const expected = [_]u8{5} ** ct.altair.MetaDataV2.fixed_size;
    const leftover = try expectSingleChunk(&setup, replyMetadataEarly, &expected);
    try std.testing.expect(leftover > 0);
}

test "reqresp serves a request whose body and fin arrive with the proposal" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    const stream = try setup.shared.pair.client.openStream(setup.shared.handles.client);
    const dialer = try multistream.Dialer.init(Protocol.status_v1.id());
    var message: [512]u8 = undefined;
    const hello = try dialer.initialWrite(&message);
    const request_ssz = statusBytes(9);
    const encoded = try codec.encodeRequest(&request_ssz, message[hello.len..]);
    const total = hello.len + encoded.len;
    const written = try setup.shared.pair.client.write(stream, message[0..total], true);
    try std.testing.expectEqual(total, written);

    const reply = statusBytes(3);
    var served = false;
    var rounds: usize = 0;
    while (rounds < 20 and !served) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                try std.testing.expectEqual(Protocol.status_v1, incoming.protocol);
                try std.testing.expectEqualSlices(u8, &request_ssz, incoming.bytes);
                try setup.shared.server.control_reqresp.respond(incoming.request, &reply, null, setup.shared.pair.now);
            },
            .chunk_sent => |sent| try std.testing.expect(setup.shared.server.control_reqresp.finish(sent.request, setup.shared.pair.now)),
            .served => |finished| {
                try std.testing.expectEqual(@as(u32, 1), finished.chunks);
                served = true;
            },
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
    }
    try std.testing.expect(served);
}

test "reqresp retires a consumed terminal stream without FIN or event space" {
    var pair: Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    var request_bytes: [8]u8 = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    const h = try pair.shared.client.control_reqresp.request(
        &pair.shared.pair.client,
        &pair.shared.client.router,
        pair.shared.handles.client,
        .ping_v1,
        &request_bytes,
        &sink,
        .{},
        pair.shared.pair.now,
    );
    var consumed = false;
    for (0..50) |_| {
        try pair.pumpOnce();
        for (pair.serverEvents()) |event| switch (event) {
            .request => |r| try pair.shared.server.control_reqresp.respond(r.request, &request_bytes, null, pair.shared.pair.now),
            else => {},
        };
        for (pair.clientEvents()) |event| switch (event) {
            .chunk => |r| {
                consumed = pair.shared.client.control_reqresp.consume(&pair.shared.pair.client, &pair.shared.client.router, r.request, pair.shared.pair.now);
            },
            else => {},
        };
        if (consumed) break;
    }
    try std.testing.expect(consumed);
    const stream = pair.shared.client.control_reqresp.outbound[h.index].request.stream;
    var out: [8]Event = undefined;
    try std.testing.expectEqual(
        @as(usize, 0),
        pair.shared.client.control_reqresp.pump(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.pair.now, &.{}),
    );
    try std.testing.expect(
        !pair.shared.pair.client.registry.slots[stream.conn.index].table.matches(stream.slot, stream.id),
    );
    _ = pair.shared.client.control_reqresp.pump(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.pair.now, &out);
    _ = pair.shared.client.control_reqresp.pump(&pair.shared.pair.client, &pair.shared.client.router, pair.shared.pair.now, &out);
    try std.testing.expectEqual(@as(u16, 0), pair.shared.client.control_reqresp.pendingCounts().outbound);
    try std.testing.expect(
        !pair.shared.pair.client.registry.slots[stream.conn.index].table.matches(stream.slot, stream.id),
    );
}

test "reqresp refuses serving actions until the request notification is delivered" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    setup.server_event_capacity = 0;
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, .{}, setup.shared.pair.now);
    var incoming: ?reqresp.RequestHandle = null;
    for (0..50) |_| {
        try setup.pumpOnce();
        for (setup.shared.server.control_reqresp.inbound) |*slot| if (slot.request.pendingEvent()) |event| {
            if (event == .request) incoming = event.request.request;
        };
        if (incoming != null) break;
    }
    const request = incoming orelse return error.RequestNotReceived;
    try std.testing.expect(!setup.shared.server.control_reqresp.finish(request, setup.shared.pair.now));
    try std.testing.expectError(error.Busy, setup.shared.server.control_reqresp.respond(request, &bytes, null, setup.shared.pair.now));
    try std.testing.expectError(error.Busy, setup.shared.server.control_reqresp.respondError(request, 1, "early", setup.shared.pair.now));
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events));
    try std.testing.expectEqual(request, events[0].request.request);
    try std.testing.expectEqualSlices(u8, &bytes, events[0].request.bytes);
    try std.testing.expect(setup.shared.server.control_reqresp.finish(request, setup.shared.pair.now));
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.control_reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &events));
    try std.testing.expect(events[0] == .served);
}

test "reqresp finish survives a flushed chunk awaiting notification" {
    try finishAfterNotification(0);
}

test "reqresp finishing starts peer time after a legal host capacity wait" {
    try finishAfterNotification(20_000);
}

test "reqresp accepts legal empty by root content" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    _ = try setup.shared.client.reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .blocks_by_root_v2, &.{}, sink, .{}, setup.shared.pair.now);
    try waitForRequest(&setup);
    const incoming = setup.serverEvents()[0].request;
    try std.testing.expectEqual(@as(usize, 0), incoming.bytes.len);
    try std.testing.expectEqual(Protocol.blocks_by_root_v2, incoming.protocol);
}

test "reqresp narrowed chunks retire without FIN after a host pause" {
    var setup: Pair = .{};
    try setup.init(.{ .progress_timeout_ms = 1000 }, .{});
    defer setup.deinit();
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    const reply = try std.testing.allocator.alloc(u8, ct.deneb.SignedBeaconBlock.min_size);
    defer std.testing.allocator.free(reply);
    @memset(reply, 0);
    const handle = try setup.shared.client.reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .blocks_by_root_v2, &([_]u8{0} ** 32), sink, .{ .expected_chunks = 1 }, setup.shared.pair.now);
    var held = false;
    for (0..30) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| try setup.shared.server.reqresp.respond(incoming.request, reply, .{ .digest = deneb_digest, .fork = .deneb }, setup.shared.pair.now),
            else => {},
        };
        for (setup.clientEvents()) |event| if (event == .chunk) {
            held = true;
        };
        if (held) break;
    }
    try std.testing.expect(held);
    setup.shared.pair.advance(2000);
    var events: [1]Event = undefined;
    try std.testing.expectEqual(@as(usize, 0), setup.shared.client.reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    try std.testing.expect(setup.shared.client.reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    _ = setup.shared.client.reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &.{});
    const stream = setup.shared.client.reqresp.outbound[handle.index].request.stream;
    try std.testing.expect(!setup.shared.pair.client.registry.slots[stream.conn.index].table.matches(stream.slot, stream.id));
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.reqresp.pump(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now, &events));
    try std.testing.expectEqual(@as(u32, 1), events[0].done.chunks);
}
