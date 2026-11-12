const std = @import("std");
const config = @import("config");
const ct = @import("consensus_types");
const codec = @import("codec.zig");
const protocol = @import("protocol.zig");
const response_bounds = @import("response_bounds.zig");
const reqresp = @import("ReqResp.zig");
const harness = @import("test_pair.zig");
const ForkEntry = @import("../types.zig").ForkEntry;
const StreamHandle = @import("../quic/Engine.zig").StreamHandle;
const control_fixture = @import("control_fixture.zig");

const first: ForkEntry = .{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu };
const second: ForkEntry = .{ .digest = .{ 5, 6, 7, 8 }, .fork = .fulu };
const phase0: ForkEntry = .{ .digest = .{ 9, 10, 11, 12 }, .fork = .phase0 };

/// Admission refusals for `reason`, summed over every method.
fn refusals(owner: *const reqresp, reason: reqresp.metrics.AdmissionRefusal) u64 {
    var total: u64 = 0;
    for (owner.protocol_counters) |counts| total += counts.admission_refusals[@intFromEnum(reason)];
    return total;
}

fn request(setup: *harness.Pair, which: protocol.Protocol, bytes: []const u8, sink: []u8, options: reqresp.RequestOptions) !reqresp.RequestHandle {
    return setup.shared.client.requests(which).request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, which, bytes, sink, options, setup.shared.pair.now);
}

test "reqresp active new methods enforce request ceilings through real exchanges and reuse" {
    const cases = .{
        .{ protocol.Protocol.blocks_by_head_v1, 40, 2, ct.fulu.SignedBeaconBlock.min_size },
        .{ protocol.Protocol.light_client_bootstrap_v1, 32, 1, ct.fulu.LightClientBootstrap.min_size },
        .{ protocol.Protocol.light_client_updates_by_range_v1, 16, 0, ct.fulu.LightClientUpdate.min_size },
        .{ protocol.Protocol.light_client_finality_update_v1, 0, 1, ct.fulu.LightClientFinalityUpdate.min_size },
        .{ protocol.Protocol.light_client_optimistic_update_v1, 0, 1, ct.fulu.LightClientOptimisticUpdate.min_size },
    };
    var setup: harness.Pair = .{};
    try setup.init(.{ .outbound_max = 1, .forks = &.{ first, second, phase0 } }, .{ .serving_max = 1, .inbound_per_connection_max = 1, .forks = &.{ first, second, phase0 } });
    defer setup.deinit();
    inline for (cases) |case| {
        for ([_]ForkEntry{ first, second }) |context| {
            var bytes = [_]u8{0} ** case[1];
            if (case[0] == .blocks_by_head_v1) std.mem.writeInt(u64, bytes[32..40], 2, .little);
            var payload = [_]u8{0} ** (case[3] + 1);
            const sink = try std.testing.allocator.alloc(u8, case[0].info().response_max);
            defer std.testing.allocator.free(sink);
            try std.testing.expectError(error.InvalidRequestOptions, request(&setup, case[0], &bytes, sink, .{ .expected_chunks = case[2] + 1 }));
            _ = try request(&setup, case[0], &bytes, sink, .{});
            var chunks: u32 = 0;
            var done = false;
            var served = false;
            for (0..60) |_| {
                try setup.pumpOnce();
                for (setup.serverEvents()) |event| switch (event) {
                    .request => |incoming| {
                        try std.testing.expectEqualSlices(u8, &bytes, incoming.bytes);
                        if (case[2] == 0) {
                            try std.testing.expectError(error.TooManyChunks, setup.shared.server.reqresp.respond(incoming.request, payload[0..case[3]], context, setup.shared.pair.now));
                            try std.testing.expect(setup.shared.server.reqresp.finish(incoming.request, setup.shared.pair.now));
                        } else {
                            try std.testing.expectError(error.UnknownFork, setup.shared.server.reqresp.respond(incoming.request, payload[0..case[3]], .{ .digest = context.digest, .fork = .deneb }, setup.shared.pair.now));
                            if (case[0] != .blocks_by_head_v1) try std.testing.expectError(error.InvalidContext, setup.shared.server.reqresp.respond(incoming.request, payload[0..case[3]], phase0, setup.shared.pair.now));
                            try std.testing.expectError(error.ChunkTooSmall, setup.shared.server.reqresp.respond(incoming.request, payload[0 .. case[3] - 1], context, setup.shared.pair.now));
                            try setup.shared.server.reqresp.respond(incoming.request, payload[0..case[3]], context, setup.shared.pair.now);
                        }
                    },
                    .chunk_sent => |sent| {
                        if (sent.chunks == case[2]) {
                            try std.testing.expectError(error.TooManyChunks, setup.shared.server.reqresp.respond(sent.request, payload[0..case[3]], context, setup.shared.pair.now));
                            try std.testing.expect(setup.shared.server.reqresp.finish(sent.request, setup.shared.pair.now));
                        } else try setup.shared.server.reqresp.respond(sent.request, payload[0..case[3]], context, setup.shared.pair.now);
                    },
                    .served => |terminal| {
                        try std.testing.expectEqual(@as(u32, case[2]), terminal.chunks);
                        served = true;
                    },
                    .failed => return error.TestUnexpectedResult,
                    else => {},
                };
                for (setup.clientEvents()) |event| switch (event) {
                    .chunk => |chunk| {
                        chunks += 1;
                        try std.testing.expectEqual(@as(?config.ForkSeq, .fulu), chunk.fork);
                        try std.testing.expectEqualSlices(u8, payload[0..case[3]], chunk.bytes);
                        try std.testing.expect(setup.shared.client.reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, chunk.request, setup.shared.pair.now));
                    },
                    .done => |terminal| {
                        try std.testing.expect(!done);
                        try std.testing.expectEqual(@as(u32, case[2]), terminal.chunks);
                        done = true;
                    },
                    .failed => return error.TestUnexpectedResult,
                    else => {},
                };
                if (done and served) break;
            }
            try std.testing.expect(done and served);
            try std.testing.expectEqual(@as(u32, case[2]), chunks);
            try setup.pumpOnce();
            try std.testing.expectEqual(@as(u16, 0), setup.shared.client.reqresp.pendingCounts().outbound);
            try std.testing.expectEqual(@as(u16, 0), setup.shared.server.reqresp.pendingCounts().inbound);
        }
    }
}

test "reqresp active light client bounds select each actual fork type before decoding" {
    inline for (.{ .altair, .capella, .deneb, .electra, .fulu, .gloas }) |fork_tag| {
        const fork: config.ForkSeq = fork_tag;
        const types = @field(ct, @tagName(fork));
        const cases = .{
            .{ response_bounds.Family.light_client_bootstrap, types.LightClientBootstrap },
            .{ response_bounds.Family.light_client_update, types.LightClientUpdate },
            .{ response_bounds.Family.light_client_finality_update, types.LightClientFinalityUpdate },
            .{ response_bounds.Family.light_client_optimistic_update, types.LightClientOptimisticUpdate },
        };
        inline for (cases) |case| {
            const T = case[1];
            const min = if (@hasDecl(T, "fixed_size")) T.fixed_size else T.min_size;
            const max = if (@hasDecl(T, "fixed_size")) T.fixed_size else T.max_size;
            const bounds = try response_bounds.forFork(case[0], fork);
            try std.testing.expectEqual(min, bounds.min);
            try std.testing.expectEqual(max, bounds.max);
            try std.testing.expectError(error.InvalidResponseContext, response_bounds.forFork(case[0], .phase0));
            const sink = try std.testing.allocator.alloc(u8, response_bounds.unionFor(case[0]).max);
            defer std.testing.allocator.free(sink);
            const encoded = try std.testing.allocator.alloc(u8, codec.encodedLengthMax(max + 1));
            defer std.testing.allocator.free(encoded);
            const payload = try std.testing.allocator.alloc(u8, max + 1);
            defer std.testing.allocator.free(payload);
            @memset(payload, 0);
            var scratch: [codec.frame_scratch_max]u8 = undefined;
            for ([_]usize{ min - 1, min, max, max + 1 }) |length| {
                @memset(sink, 0xa5);
                const bytes = try codec.encodeChunk(0, first.digest, payload[0..length], encoded);
                var decoder = codec.Decoder.initResponseWithContext(response_bounds.unionFor(case[0]), sink, &scratch);
                try std.testing.expectEqual(@as(usize, 5), (try decoder.feed(bytes)).consumed);
                try decoder.setContextBounds(bounds);
                if (length < min or length > max) {
                    try std.testing.expectError(error.LengthOutOfBounds, decoder.feed(bytes[5..]));
                    try std.testing.expect(std.mem.allEqual(u8, sink, 0xa5));
                } else {
                    try std.testing.expect((try decoder.feed(bytes[5..])).done);
                    try std.testing.expectEqual(length, decoder.payload().len);
                }
            }
        }
    }
    try std.testing.expectError(error.InvalidResponseContext, response_bounds.forFork(.blob, .capella));
    try std.testing.expectError(error.InvalidResponseContext, response_bounds.forFork(.column, .electra));
    try std.testing.expectError(error.InvalidResponseContext, protocol.Protocol.ping_v1.responseBounds(.fulu));
}

test "reqresp active hostile coalesced context rejects before sink writes with one terminal" {
    const cases = .{
        .{ ForkEntry{ .digest = .{ 99, 99, 99, 99 }, .fork = .fulu }, reqresp.Failure{ .unknown_context = .{ 99, 99, 99, 99 } } },
        .{ phase0, reqresp.Failure{ .invalid_response = error.InvalidResponseContext } },
        .{ first, reqresp.Failure{ .invalid_response = error.LengthOutOfBounds } },
    };
    inline for (cases) |case| {
        for (0..7) |split| {
            var setup: harness.Pair = .{};
            try setup.init(.{ .forks = &.{ first, phase0 } }, .{ .forks = &.{ first, phase0 } });
            defer setup.deinit();
            const sink = try std.testing.allocator.alloc(u8, protocol.Protocol.light_client_optimistic_update_v1.info().response_max);
            defer std.testing.allocator.free(sink);
            @memset(sink, 0xaa);
            _ = try request(&setup, .light_client_optimistic_update_v1, "", sink, .{});
            const bytes = [_]u8{0} ++ case[0].digest ++ [_]u8{ 1, 0xff, 6, 0, 0 };
            var stream: ?StreamHandle = null;
            var sent_suffix = false;
            var failed = false;
            for (0..40) |_| {
                try setup.pumpOnce();
                for (setup.serverEvents()) |event| if (event == .request) {
                    const slot = &setup.shared.server.reqresp.inbound[event.request.request.index];
                    stream = slot.request.stream;
                    if (split > 0) try std.testing.expectEqual(split, try setup.shared.pair.server.write(slot.request.stream, bytes[0..split], false));
                };
                for (setup.clientEvents()) |event| switch (event) {
                    .failed => |failure| {
                        try std.testing.expect(!failed);
                        try std.testing.expectEqualDeep(case[1], failure.reason);
                        failed = true;
                    },
                    .chunk, .done => return error.TestUnexpectedResult,
                    else => {},
                };
                if (failed) break;
                if (stream) |raw| {
                    if (!sent_suffix) {
                        try std.testing.expectEqual(bytes.len - split, try setup.shared.pair.server.write(raw, bytes[split..], true));
                        sent_suffix = true;
                    }
                }
            }
            try std.testing.expect(failed);
            try std.testing.expect(std.mem.allEqual(u8, sink, 0xaa));
            setup.shared.server.reqresp.cancelAll(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now);
            try setup.pumpOnce();
            try setup.pumpOnce();
            try std.testing.expectEqual(@as(u16, 0), setup.shared.client.reqresp.pendingCounts().outbound);
            try std.testing.expectEqual(@as(u16, 0), setup.shared.server.reqresp.pendingCounts().inbound);
        }
    }
}

test "reqresp active zero ceiling rejects malicious success and permits remote error" {
    for ([_]u8{ 0, 3 }) |result| {
        var setup: harness.Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        const which = protocol.Protocol.light_client_updates_by_range_v1;
        const sink = try std.testing.allocator.alloc(u8, which.info().response_max);
        defer std.testing.allocator.free(sink);
        const bytes = [_]u8{0} ** 16;
        _ = try request(&setup, which, &bytes, sink, .{});
        const payload = [_]u8{0} ** ct.fulu.LightClientUpdate.min_size;
        var encoded: [codec.encodedLengthMax(payload.len)]u8 = undefined;
        const chunk = try codec.encodeChunk(result, if (result == 0) harness.fulu_digest else null, if (result == 0) &payload else "unavailable", &encoded);
        var failed = false;
        for (0..40) |_| {
            try setup.pumpOnce();
            for (setup.serverEvents()) |event| if (event == .request) {
                const slot = &setup.shared.server.reqresp.inbound[event.request.request.index];
                try std.testing.expectEqual(chunk.len, try setup.shared.pair.server.write(slot.request.stream, chunk, true));
            };
            for (setup.clientEvents()) |event| switch (event) {
                .failed => |failure| {
                    try std.testing.expect(!failed);
                    if (result == 0) {
                        try std.testing.expect(failure.reason == .too_many_chunks);
                    } else {
                        try std.testing.expectEqual(@as(u8, 3), failure.reason.peer_error.code);
                        try std.testing.expectEqualStrings("unavailable", failure.errorMessage());
                    }
                    failed = true;
                },
                .chunk, .done => return error.TestUnexpectedResult,
                else => {},
            };
            if (failed) break;
        }
        try std.testing.expect(failed);
        setup.shared.server.reqresp.cancelAll(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now);
        try setup.pumpOnce();
        try setup.pumpOnce();
        try std.testing.expectEqual(@as(u16, 0), setup.shared.client.reqresp.pendingCounts().outbound);
        try std.testing.expectEqual(@as(u16, 0), setup.shared.server.reqresp.pendingCounts().inbound);
    }
}

test "reqresp active inbound invalid head range and no-body requests never reach application" {
    const cases = .{
        .{ protocol.Protocol.blocks_by_head_v1, &([_]u8{0} ** 40) },
        .{ protocol.Protocol.light_client_updates_by_range_v1, &([_]u8{0xff} ** 16) },
        .{ protocol.Protocol.light_client_finality_update_v1, "\x00" },
        .{ protocol.Protocol.light_client_optimistic_update_v1, "\x00" },
    };
    inline for (cases) |case| {
        var setup: harness.Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        const raw = try setup.openRaw(case[0]);
        try setup.awaitRawSelection(raw, case[0]);
        var encoded: [256]u8 = undefined;
        const bytes = if (case[0].info().request_max == 0) case[1] else try codec.encodeRequest(case[1], &encoded);
        try std.testing.expectEqual(bytes.len, try setup.shared.pair.client.write(raw, bytes, true));
        var sink: [codec.error_message_max]u8 = undefined;
        var scratch: [codec.frame_scratch_max]u8 = undefined;
        var decoder = codec.Decoder.initResponseWithContext(.{ .min = 0, .max = sink.len }, &sink, &scratch);
        var buffer: [512]u8 = undefined;
        var served = false;
        for (0..30) |_| {
            try setup.pumpOnce();
            for (setup.serverEvents()) |event| switch (event) {
                .request => return error.TestUnexpectedResult,
                .served => served = true,
                else => {},
            };
            if (!decoder.isDone()) {
                const input = try setup.shared.pair.client.read(raw, &buffer);
                _ = try decoder.feed(buffer[0..input.len]);
            }
            if (served and decoder.isDone()) break;
        }
        try std.testing.expect(served and decoder.isDone());
        try std.testing.expectEqual(@as(u8, 1), decoder.result());
        try std.testing.expectEqualStrings("invalid request", decoder.payload());
        try setup.pumpOnce();
        try std.testing.expectEqual(@as(u16, 0), setup.shared.server.reqresp.pendingCounts().inbound);
    }
}

test "reqresp active light client traffic preserves control reserve and cancellation reuse" {
    const Router = @import("../router.zig").Router;
    const support = @import("../quic/test_support.zig");
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var router = try Router.init(std.testing.allocator, .{});
    defer router.deinit();
    var owner = try reqresp.init(std.testing.allocator, try control_fixture.applicationOptions());
    defer owner.deinit();
    var control_owner = try reqresp.init(std.testing.allocator, try control_fixture.controlOptions());
    defer control_owner.deinit();
    defer control_owner.cancelAll(&pair.client, &router, pair.now);
    const which = protocol.Protocol.light_client_finality_update_v1;
    const capacity = protocol.Protocol.light_client_updates_by_range_v1.info().response_max;
    const sink = try std.testing.allocator.alloc(u8, capacity * 2);
    defer {
        owner.cancelAll(&pair.client, &router, pair.now);
        std.testing.allocator.free(sink);
    }
    for (0..2) |_| {
        const a = try owner.request(&pair.client, &router, handles.client, which, "", sink[0..capacity], .{ .expected_chunks = 0 }, pair.now);
        const b = try owner.request(&pair.client, &router, handles.client, .light_client_optimistic_update_v1, "", sink[capacity..], .{}, pair.now);
        try std.testing.expectError(error.SlotsExhausted, owner.request(&pair.client, &router, handles.client, .light_client_updates_by_range_v1, &([_]u8{0} ** 16), sink, .{}, pair.now));
        var ping: [8]u8 = @splat(0);
        const control = try control_owner.request(&pair.client, &router, handles.client, .ping_v1, &ping, &ping, .{}, pair.now);
        try std.testing.expect(owner.cancel(&pair.client, &router, a, pair.now));
        try std.testing.expect(owner.cancel(&pair.client, &router, b, pair.now));
        try std.testing.expect(control_owner.cancel(&pair.client, &router, control, pair.now));
        var events: [2]reqresp.Event = undefined;
        const controls = control_owner.pump(&pair.client, &router, pair.now, &events);
        try std.testing.expectEqual(@as(usize, 1), controls);
        try std.testing.expectEqual(control, events[0].failed.request);
        const applications = owner.pump(&pair.client, &router, pair.now, &events);
        try std.testing.expectEqual(@as(usize, 2), applications);
        for (events) |event| try std.testing.expect(event.failed.reason == .cancelled);
        _ = owner.pump(&pair.client, &router, pair.now, &.{});
        try std.testing.expectEqual(@as(u16, 0), owner.pendingCounts().outbound);
        try std.testing.expectEqual(@as(usize, 0), router.negotiator.active());
    }
}

const policy_fixture = @import("policy_fixture.zig").config;
const admission_quotas = @import("admission_fixture.zig").quotas;

fn emptyExchange(setup: *harness.Pair, which: protocol.Protocol, bytes: []const u8, allowed: bool, code: u8) !void {
    if (!allowed and code == 139) return waitExchange(setup, which, bytes);
    const sink = try std.testing.allocator.alloc(u8, which.info().response_max);
    defer std.testing.allocator.free(sink);
    if (code == 1) {
        try std.testing.expectError(error.InvalidRequest, request(setup, which, bytes, sink, .{}));
        const stream = try setup.openRaw(which);
        try setup.awaitRawSelection(stream, which);
        var wire: [codec.frame_scratch_max]u8 = undefined;
        const encoded = try codec.encodeRequest(bytes, &wire);
        try std.testing.expectEqual(encoded.len, try setup.shared.pair.client.write(stream, encoded, true));
        var scratch: [codec.frame_scratch_max]u8 = undefined;
        var decoder = codec.Decoder.initResponse(.{ .min = which.info().response_min, .max = which.info().response_max }, false, sink, &scratch);
        var served = false;
        for (0..100) |_| {
            try setup.pumpOnce();
            for (setup.serverEvents()) |event| {
                try std.testing.expect(event != .request and event != .failed);
                if (event == .served) served = true;
            }
            if (!decoder.isDone()) {
                const input = try setup.shared.pair.client.read(stream, &wire);
                _ = try decoder.feed(wire[0..input.len]);
            }
            if (decoder.isDone() and served) break;
        }
        try std.testing.expect(served and decoder.isDone());
        try std.testing.expectEqual(code, decoder.result());
        try std.testing.expectEqualStrings("invalid request", decoder.payload());
        setup.shared.pair.client.closeStream(stream, 0);
        try setup.pumpOnce();
        return;
    }
    _ = try request(setup, which, bytes, sink, .{});
    var received: u32 = 0;
    var terminal = false;
    var served = false;
    for (0..100) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                received += 1;
                try std.testing.expect(allowed);
                try std.testing.expect(setup.shared.server.requests(which).finish(incoming.request, setup.shared.pair.now));
            },
            .served => served = true,
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
        for (setup.clientEvents()) |event| switch (event) {
            .done => |done| {
                try std.testing.expect(allowed and !which.requiresResponse());
                try std.testing.expectEqual(@as(u32, 0), done.chunks);
                terminal = true;
            },
            .failed => |failed| {
                if (allowed) {
                    try std.testing.expect(which.requiresResponse());
                    try std.testing.expectEqual(reqresp.Failure.empty_response, failed.reason);
                    terminal = true;
                    continue;
                }
                try std.testing.expectEqual(code, failed.reason.peer_error.code);
                const message = if (code == 139) "rate limited" else "invalid request";
                try std.testing.expectEqualSlices(u8, message, failed.errorMessage());
                terminal = true;
            },
            else => {},
        };
        if (terminal and served) break;
    }
    try std.testing.expect(terminal and served);
    try std.testing.expectEqual(@as(u32, if (allowed) 1 else 0), received);
    try setup.pumpOnce();
    try std.testing.expectEqual(@as(u16, 0), setup.shared.client.requests(which).pendingCounts().outbound);
    try std.testing.expectEqual(@as(u16, 0), setup.shared.server.requests(which).pendingCounts().inbound);
}

fn waitExchange(setup: *harness.Pair, which: protocol.Protocol, bytes: []const u8) !void {
    const sink = try std.testing.allocator.alloc(u8, which.info().response_max);
    defer std.testing.allocator.free(sink);
    const handle = try request(setup, which, bytes, sink, .{});
    var waiting = false;
    for (0..50) |_| {
        try setup.pumpOnce();
        try std.testing.expectEqual(@as(usize, 0), setup.clientEvents().len);
        try std.testing.expectEqual(@as(usize, 0), setup.serverEvents().len);
        for (setup.shared.server.requests(which).inbound) |*slot| {
            if (slot.request.running() and slot.state == .ready and slot.admission.eligible_ms > setup.shared.pair.now.millis()) {
                waiting = true;
            }
        }
        if (waiting) break;
    }
    try std.testing.expect(waiting);
    try std.testing.expect(setup.shared.client.requests(which).cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    for (0..20) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| {
            try std.testing.expectEqual(.failed, std.meta.activeTag(event));
            try std.testing.expectEqual(reqresp.Failure.stream_closed, event.failed.reason);
        }
        if (setup.shared.server.requests(which).pendingCounts().inbound == 0) break;
    }
    try setup.pumpOnce();
    try std.testing.expectEqual(@as(u16, 0), setup.shared.server.requests(which).pendingCounts().inbound);
}

test "reqresp request admission empty success quota waiting malformed attempts and control independence" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{
        .request_fork = .fulu,
        .admission = .{ .policy = policy_fixture(), .limits = .{ .source = admission_quotas(2, 86_400_000), .global_starts = .{ .tokens = 40, .period_ms = 86_400_000 }, .global = admission_quotas(100, 86_400_000) } },
    });
    defer setup.deinit();
    try emptyExchange(&setup, .blocks_by_root_v2, &.{}, true, 0);
    try emptyExchange(&setup, .blocks_by_root_v2, &.{}, true, 0);
    try emptyExchange(&setup, .blocks_by_root_v2, &.{}, false, 139);
    try emptyExchange(&setup, .blocks_by_root_v2, &.{0}, false, 1);
    var bytes = [_]u8{0} ** 24;
    std.mem.writeInt(u64, bytes[8..16], 3, .little);
    try emptyExchange(&setup, .blocks_by_range_v2, &bytes, true, 0);
    std.mem.writeInt(u64, bytes[8..16], 1, .little);
    try emptyExchange(&setup, .blocks_by_range_v2, &bytes, false, 139);
    try emptyExchange(&setup, .ping_v1, bytes[0..8], true, 0);
    const status = harness.statusBytes(1);
    try emptyExchange(&setup, .status_v1, &status, true, 0);
    try emptyExchange(&setup, .blob_sidecars_by_root_v1, &.{0}, false, 1);
    try emptyExchange(&setup, .blob_sidecars_by_root_v1, &.{}, true, 0);
    try emptyExchange(&setup, .blob_sidecars_by_root_v1, &.{}, false, 139);
    std.mem.writeInt(u32, bytes[16..20], 20, .little);
    try emptyExchange(&setup, .data_column_sidecars_by_range_v1, bytes[0..20], true, 0);
    try emptyExchange(&setup, .data_column_sidecars_by_range_v1, bytes[0..20], true, 0);
    try emptyExchange(&setup, .data_column_sidecars_by_range_v1, bytes[0..20], false, 139);
    try std.testing.expectEqual(@as(u64, 1), refusals(&setup.shared.server.reqresp, .address_quota));
}

test "reqresp permits an empty contextual response below its payload minimum" {
    var policy = policy_fixture();
    policy.max_payload_size = 256;
    var setup: harness.Pair = .{};
    const options: harness.Overrides = .{ .admission = .{ .policy = policy, .limits = .{ .source = admission_quotas(2, 1000), .global = admission_quotas(2, 1000) } } };
    try setup.init(options, options);
    defer setup.deinit();
    try emptyExchange(&setup, .blob_sidecars_by_root_v1, &.{}, true, 0);
}

test "reqresp malformed requests without a paid source or global start cannot retain protocol debt" {
    for ([_]bool{ false, true }) |global_only| {
        var setup: harness.Pair = .{};
        try setup.init(.{}, .{
            .request_fork = .fulu,
            .admission = .{ .policy = policy_fixture(), .limits = .{
                .source = admission_quotas(1, 1000),
                .global = admission_quotas(100, 1000),
                .starts = .{ .tokens = 1, .period_ms = 100 },
                .global_starts = .{ .tokens = if (global_only) 1 else 2, .period_ms = 100 },
            } },
        });
        defer setup.deinit();
        const owner = &setup.shared.server.reqresp;
        const limiter = &owner.admission.limiter;
        if (global_only) {
            const stranger = limiter.retain(&.{ .address = .{ .ip4 = .{ 192, 0, 2, 1 } } }, setup.shared.pair.now.millis());
            try std.testing.expectEqual(.allowed, limiter.start(stranger, setup.shared.pair.now.millis()));
            limiter.release(stranger);
        } else try emptyExchange(&setup, .blocks_by_root_v2, &.{}, true, 0);
        const source = owner.admission.sourceRow(setup.shared.handles.server);
        const before = limiter.rows[source];
        const global_before = limiter.global_starts_ns;
        var bytes = [_]u8{0} ** 28;
        std.mem.writeInt(u64, bytes[8..16], 1, .little);
        try emptyExchange(&setup, .data_column_sidecars_by_range_v1, bytes[0..20], false, 1);
        try std.testing.expectEqualDeep(before, limiter.rows[source]);
        try std.testing.expectEqual(global_before, limiter.global_starts_ns);
        setup.shared.pair.advance(100);
        std.mem.writeInt(u32, bytes[16..20], 20, .little);
        try emptyExchange(&setup, .data_column_sidecars_by_range_v1, &bytes, true, 0);
    }
}

test "reqresp request admission outbound validation ceiling and owner fork snapshot" {
    var setup: harness.Pair = .{};
    const options: harness.Overrides = .{
        .request_fork = .phase0,
        .admission = .{ .policy = policy_fixture(), .limits = .{ .source = admission_quotas(2048, 1000), .global = admission_quotas(2048, 1000) } },
    };
    try setup.init(options, options);
    defer setup.deinit();
    const sink = try std.testing.allocator.alloc(u8, protocol.Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    var roots = [_]u8{0} ** (129 * 32);
    try std.testing.expectError(error.InvalidRequest, request(&setup, .blocks_by_root_v2, roots[0..1], sink, .{}));
    try std.testing.expectEqual(@as(u16, 0), setup.shared.client.reqresp.pendingCounts().outbound);
    try std.testing.expectError(error.InvalidRequestOptions, request(&setup, .blocks_by_root_v2, &roots, sink, .{ .expected_chunks = 130 }));
    const handle = try request(&setup, .blocks_by_root_v2, &roots, sink, .{});
    setup.shared.client.reqresp.setRequestFork(.fulu);
    try std.testing.expectEqual(@as(u32, 129), setup.shared.client.reqresp.outbound[handle.index].request.chunks_max);
    var accepted = false;
    var completed = false;
    for (0..60) |_| {
        try setup.pumpOnce();
        for (setup.shared.server.reqresp.inbound) |*slot| if (slot.request.running() and slot.state == .receiving_request) {
            accepted = true;
            try std.testing.expectEqual(config.ForkSeq.phase0, slot.request_fork);
            setup.shared.server.reqresp.setRequestFork(.fulu);
        };
        for (setup.serverEvents()) |event| if (event == .request) {
            try std.testing.expect(accepted);
            try std.testing.expectEqual(@as(u32, 129), setup.shared.server.reqresp.inbound[event.request.request.index].request.chunks_max);
            try std.testing.expect(setup.shared.server.reqresp.finish(event.request.request, setup.shared.pair.now));
        };
        if (setup.clientEvents().len > 0 and setup.clientEvents()[0] == .done) {
            completed = true;
            break;
        }
    }
    try std.testing.expect(accepted and completed);
    try std.testing.expectError(error.RequestTooLarge, request(&setup, .blocks_by_root_v2, &roots, sink, .{}));
    try emptyExchange(&setup, .blocks_by_root_v2, &.{}, true, 0);
}

fn admissionAllocation(allocator: std.mem.Allocator) !void {
    var owner = try reqresp.init(allocator, .{
        .forks = &.{},
        .outbound_max = 1,
        .serving_max = 1,

        .admission = .{ .policy = policy_fixture(), .limits = .{ .source = admission_quotas(2, 1000), .global = admission_quotas(100, 1000) } },
    });
    defer owner.deinit();
    try std.testing.expectEqual(owner.admission.limiter.memoryPlan().allocated_bytes, owner.memoryPlan().admission_bytes);
}

test "reqresp request admission owner allocation failure prefixes" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, admissionAllocation, .{});
}

test "reqresp request admission concurrent connections and reconnect retain full identity debt" {
    const support = @import("../quic/test_support.zig");
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{
        .admission = .{ .policy = policy_fixture(), .limits = .{ .source = admission_quotas(2, 86_400_000), .global_starts = .{ .tokens = 40, .period_ms = 86_400_000 }, .global = admission_quotas(100, 86_400_000) } },
    });
    defer setup.deinit();
    try emptyExchange(&setup, .blocks_by_root_v2, &.{}, true, 0);
    const initial = setup.shared.handles;
    const second_connection = try support.connectPair(&setup.shared.pair);
    setup.shared.handles = .{ .client = second_connection.client, .server = second_connection.server };
    try std.testing.expect(!std.meta.eql(initial.server, setup.shared.handles.server));
    try std.testing.expect(setup.shared.pair.server.peerId(initial.server).?.eql(&setup.shared.pair.server.peerId(setup.shared.handles.server).?));
    try emptyExchange(&setup, .blocks_by_root_v2, &.{}, true, 0);
    try emptyExchange(&setup, .blocks_by_root_v2, &.{}, false, 139);
    try std.testing.expect(setup.shared.pair.client.close(initial.client, 0));
    try std.testing.expect(setup.shared.pair.client.close(setup.shared.handles.client, 0));
    for (0..8) |_| try setup.pumpOnce();
    const reconnected = try support.connectPair(&setup.shared.pair);
    setup.shared.handles = .{ .client = reconnected.client, .server = reconnected.server };
    try emptyExchange(&setup, .blocks_by_root_v2, &.{}, false, 139);
    try std.testing.expectEqual(@as(u64, 0), refusals(&setup.shared.server.reqresp, .address_quota));
}

fn changeClientIdentity(setup: *harness.Pair, seed: u8) !void {
    const support = @import("../quic/test_support.zig");
    const keys = @import("../wire/keys.zig");
    const tls = @import("../tls/context.zig");
    const Engine = @import("../quic/Engine.zig");
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{seed}));
    const ctx = try tls.Context.init(&key, support.now_unix, @splat(seed));
    const replacement = Engine.init(std.testing.allocator, .{
        .tls = ctx,
        .limits = .{},
        .local = .{ support.client_address, null },
        .seed = &@as([32]u8, @splat(seed)),
    }) catch |err| {
        var failed_context = ctx;
        failed_context.deinit();
        return err;
    };
    setup.shared.client.reqresp.cancelAll(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.pair.now);
    setup.shared.pair.client.deinit();
    setup.shared.pair.client = replacement;
    setup.shared.pair.client_ctx = ctx;
    const connection = try support.connectPair(&setup.shared.pair);
    setup.shared.handles = .{ .client = connection.client, .server = connection.server };
}

test "reqresp identity rotation preserves the source's protocol usage" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{
        .admission = .{ .policy = policy_fixture(), .limits = .{
            .source = admission_quotas(1, 86_400_000),
            .global = admission_quotas(100, 86_400_000),
            .global_starts = .{ .tokens = 40, .period_ms = 86_400_000 },
        } },
    });
    defer setup.deinit();
    try emptyExchange(&setup, .blocks_by_root_v2, &.{}, true, 0);
    try emptyExchange(&setup, .blob_sidecars_by_root_v1, &.{}, true, 0);
    try changeClientIdentity(&setup, 3);
    try waitExchange(&setup, .blocks_by_root_v2, &.{});
    try waitExchange(&setup, .blob_sidecars_by_root_v1, &.{});
    try std.testing.expectEqual(@as(u64, 0), refusals(&setup.shared.server.reqresp, .address_quota));
    try std.testing.expectEqual(@as(u64, 0), refusals(&setup.shared.server.reqresp, .global_quota));
}
