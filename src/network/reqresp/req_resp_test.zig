const std = @import("std");
const ct = @import("consensus_types");
const protocol = @import("protocol.zig");
const ReqResp = @import("ReqResp.zig");
const Engine = @import("../quic/Engine.zig");
const Protocol = protocol.Protocol;
const test_pair = @import("test_pair.zig");
const Pair = test_pair.Pair;
const deneb_digest = test_pair.deneb_digest;
const ForkSeq = @import("config").ForkSeq;

const statusBytes = test_pair.statusBytes;

const Exchange = struct {
    request_seen: bool = false,
    served: bool = false,
    chunks: u32 = 0,
    done: bool = false,
    failed: ?ReqResp.Failure = null,
};

fn serveStatus(setup: *Pair, reply: []const u8, exchange: *Exchange) !void {
    for (setup.serverEvents()) |event| switch (event) {
        .request => |incoming| {
            exchange.request_seen = true;
            try std.testing.expectError(error.InvalidContext, setup.shared.server.control_reqresp.respond(incoming.request, reply, .{ .digest = deneb_digest, .fork = .deneb }, setup.shared.pair.now));
            try setup.shared.server.control_reqresp.respond(incoming.request, reply, null, setup.shared.pair.now);
            try std.testing.expect(setup.shared.server.control_reqresp.finish(incoming.request, setup.shared.pair.now));
        },
        .served => exchange.served = true,
        .failed => |failure| exchange.failed = failure.reason,
        else => {},
    };
}

fn drainClient(setup: *Pair, expected: []const u8, exchange: *Exchange) !void {
    for (setup.clientEvents()) |event| switch (event) {
        .chunk => |chunk| {
            try std.testing.expectEqualSlices(u8, expected, chunk.bytes);
            exchange.chunks += 1;
            try std.testing.expect(setup.shared.client.control_reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, chunk.request, setup.shared.pair.now));
        },
        .done => |finished| {
            exchange.done = true;
            try std.testing.expectEqual(exchange.chunks, finished.chunks);
        },
        .failed => |failure| exchange.failed = failure.reason,
        else => {},
    };
}

test "reqresp rejects non-null status context then completes a status round trip" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    const request_ssz = statusBytes(3);
    const reply_ssz = statusBytes(9);
    var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
    const handle = try setup.shared.client.control_reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        .status_v1,
        &request_ssz,
        &sink,
        .{},
        setup.shared.pair.now,
    );
    try std.testing.expectEqual(Engine.Direction.outbound, handle.direction);

    var exchange = Exchange{};
    var rounds: usize = 0;
    while (rounds < 30 and !(exchange.done and exchange.served)) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                try std.testing.expectEqual(Protocol.status_v1, incoming.protocol);
                try std.testing.expectEqual(setup.shared.handles.server, incoming.conn);
                try std.testing.expectEqualSlices(u8, &request_ssz, incoming.bytes);
            },
            else => {},
        };
        try serveStatus(&setup, &reply_ssz, &exchange);
        try drainClient(&setup, &reply_ssz, &exchange);
    }
    try std.testing.expect(exchange.request_seen);
    try std.testing.expect(exchange.served);
    try std.testing.expect(exchange.done);
    try std.testing.expectEqual(@as(u32, 1), exchange.chunks);
    try std.testing.expect(exchange.failed == null);
    try std.testing.expectEqual(@as(u64, 1), setup.shared.client.control_reqresp.protocol_counters[@intFromEnum(Protocol.status_v1)].outgoing);
    try std.testing.expectEqual(@as(u64, 1), setup.shared.server.control_reqresp.protocol_counters[@intFromEnum(Protocol.status_v1)].incoming);
    try std.testing.expectEqual(@as(u64, 1), setup.shared.client.control_reqresp.protocol_counters[@intFromEnum(Protocol.status_v1)].outgoing_time.count);
    try std.testing.expectEqual(@as(u64, 1), setup.shared.server.control_reqresp.protocol_counters[@intFromEnum(Protocol.status_v1)].incoming_time.count);
    try setup.pumpOnce();
    try std.testing.expectEqual(@as(u16, 0), setup.shared.client.control_reqresp.pendingCounts().outbound);
    try std.testing.expectEqual(@as(u16, 0), setup.shared.server.control_reqresp.pendingCounts().inbound);
}

test "reqresp completes ping and metadata round trips" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    var ping_request: [8]u8 = undefined;
    std.mem.writeInt(u64, &ping_request, 41, .little);
    var ping_reply: [8]u8 = undefined;
    std.mem.writeInt(u64, &ping_reply, 42, .little);
    var ping_sink: [8]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &ping_request, &ping_sink, .{}, setup.shared.pair.now);

    var metadata_reply = [_]u8{0} ** 17;
    metadata_reply[0] = 8;
    metadata_reply[16] = 0x0f;
    var metadata_sink: [17]u8 = undefined;
    _ = try setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .metadata_v2, &.{}, &metadata_sink, .{}, setup.shared.pair.now);

    var pings = Exchange{};
    var metadatas = Exchange{};
    var rounds: usize = 0;
    while (rounds < 40 and !(pings.done and metadatas.done)) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| switch (incoming.protocol) {
                .ping_v1 => {
                    try std.testing.expectEqualSlices(u8, &ping_request, incoming.bytes);
                    try setup.shared.server.control_reqresp.respond(incoming.request, &ping_reply, null, setup.shared.pair.now);
                    try std.testing.expect(setup.shared.server.control_reqresp.finish(incoming.request, setup.shared.pair.now));
                    pings.request_seen = true;
                },
                .metadata_v2 => {
                    try std.testing.expectEqual(@as(usize, 0), incoming.bytes.len);
                    try setup.shared.server.control_reqresp.respond(incoming.request, &metadata_reply, null, setup.shared.pair.now);
                    try std.testing.expect(setup.shared.server.control_reqresp.finish(incoming.request, setup.shared.pair.now));
                    metadatas.request_seen = true;
                },
                else => return error.TestUnexpectedResult,
            },
            else => {},
        };
        for (setup.clientEvents()) |event| switch (event) {
            .chunk => |chunk| {
                if (chunk.bytes.len == 8) {
                    try std.testing.expectEqualSlices(u8, &ping_reply, chunk.bytes);
                    pings.chunks += 1;
                } else {
                    try std.testing.expectEqualSlices(u8, &metadata_reply, chunk.bytes);
                    metadatas.chunks += 1;
                }
                try std.testing.expect(setup.shared.client.control_reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, chunk.request, setup.shared.pair.now));
            },
            .done => |finished| {
                if (finished.chunks == 1 and pings.chunks == 1 and !pings.done) pings.done = true else metadatas.done = true;
            },
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
    }
    try std.testing.expect(pings.request_seen and metadatas.request_seen);
    try std.testing.expect(pings.done and metadatas.done);
    try std.testing.expectEqual(@as(u32, 1), pings.chunks);
    try std.testing.expectEqual(@as(u32, 1), metadatas.chunks);
}

test "reqresp streams blocks by range chunks with fork context" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    const request = ct.phase0.BeaconBlocksByRangeRequest.Type{ .start_slot = 100, .count = 3, .step = 1 };
    var request_ssz: [24]u8 = undefined;
    _ = ct.phase0.BeaconBlocksByRangeRequest.serializeIntoBytes(&request, &request_ssz);
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_range_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    _ = try setup.shared.client.reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .blocks_by_range_v2, &request_ssz, sink, .{}, setup.shared.pair.now);

    var blocks: [3][5_000]u8 = undefined;
    for (&blocks, 0..) |*block, which| {
        for (block, 0..) |*byte, index| byte.* = @truncate(index *% (which + 3) +% which);
    }
    var served_handle: ?ReqResp.RequestHandle = null;
    var sent: u32 = 0;
    var received: u32 = 0;
    var done = false;
    var served = false;
    var rounds: usize = 0;
    while (rounds < 200 and !(done and served)) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                try std.testing.expectEqual(Protocol.blocks_by_range_v2, incoming.protocol);
                try std.testing.expectEqualSlices(u8, &request_ssz, incoming.bytes);
                served_handle = incoming.request;
                try setup.shared.server.reqresp.respond(incoming.request, &blocks[0], .{ .digest = deneb_digest, .fork = .deneb }, setup.shared.pair.now);
            },
            .chunk_sent => |progress| {
                sent = progress.chunks;
                if (sent < 3) {
                    try setup.shared.server.reqresp.respond(served_handle.?, &blocks[sent], .{ .digest = deneb_digest, .fork = .deneb }, setup.shared.pair.now);
                } else {
                    try std.testing.expect(setup.shared.server.reqresp.finish(served_handle.?, setup.shared.pair.now));
                }
            },
            .served => |finished| {
                try std.testing.expectEqual(@as(u32, 3), finished.chunks);
                served = true;
            },
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
        for (setup.clientEvents()) |event| switch (event) {
            .chunk => |chunk| {
                try std.testing.expectEqual(@as(?ForkSeq, .deneb), chunk.fork);
                try std.testing.expectEqualSlices(u8, &blocks[received], chunk.bytes);
                received += 1;
                try std.testing.expect(setup.shared.client.reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, chunk.request, setup.shared.pair.now));
            },
            .done => |finished| {
                try std.testing.expectEqual(@as(u32, 3), finished.chunks);
                done = true;
            },
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
    }
    try std.testing.expect(done and served);
    try std.testing.expectEqual(@as(u32, 3), received);
}

test "reqresp rejects undersized sinks and stale handles" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();

    var small: [8]u8 = undefined;
    const request_ssz = statusBytes(1);
    try std.testing.expectError(error.SinkTooSmall, setup.shared.client.control_reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        .status_v1,
        &request_ssz,
        &small,
        .{},
        setup.shared.pair.now,
    ));
    try std.testing.expectError(error.RequestTooLarge, setup.shared.client.control_reqresp.request(
        &setup.shared.pair.client,
        &setup.shared.client.router,
        setup.shared.handles.client,
        .ping_v1,
        &request_ssz,
        &small,
        .{},
        setup.shared.pair.now,
    ));
    const stale = ReqResp.RequestHandle{ .index = 0, .generation = 99, .direction = .outbound };
    try std.testing.expect(!setup.shared.client.control_reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, stale, setup.shared.pair.now));
    try std.testing.expect(!setup.shared.server.control_reqresp.finish(.{ .index = 0, .generation = 99, .direction = .inbound }, setup.shared.pair.now));
    try std.testing.expectEqual(@as(u16, 0), setup.shared.client.control_reqresp.pendingCounts().outbound);
}
