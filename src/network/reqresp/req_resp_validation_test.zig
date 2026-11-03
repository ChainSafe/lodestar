const std = @import("std");
const ct = @import("consensus_types");
const protocol = @import("protocol.zig");
const reqresp = @import("ReqResp.zig");
const harness = @import("test_pair.zig");
const Protocol = protocol.Protocol;
const Pair = harness.Pair;
const deneb_digest = harness.deneb_digest;
const fulu_digest = harness.fulu_digest;
const statusBytes = harness.statusBytes;
const requestStatus = harness.requestStatus;
const requestBlocks = harness.requestBlocks;
const firstFailure = harness.firstFailure;
const waitForRequest = harness.waitForRequest;
const ForkEntry = @import("../types.zig").ForkEntry;
const policy_fixture = @import("policy_fixture.zig");
const ForkSeq = @import("config").ForkSeq;

test "reqresp rejects reserved error results before changing a serving response" {
    for ([_]u8{ 1, 3, 128, 255 }) |valid| {
        var setup: Pair = .{};
        try setup.init(.{}, .{});
        defer setup.deinit();
        var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
        var request: [ct.phase0.Status.fixed_size]u8 = undefined;
        _ = try requestStatus(&setup, &request, &sink);
        try waitForRequest(&setup);
        const server = &setup.shared.server.control_reqresp.inbound[0];
        const handle = server.request.handle(0);
        for ([_]u8{ 0, 4, 5, 127 }) |invalid| {
            try std.testing.expectError(error.InvalidError, setup.shared.server.control_reqresp.respondError(handle, invalid, "reserved", setup.shared.pair.now));
            try std.testing.expectEqual(.serving, server.state);
            try std.testing.expectEqual(@as(u16, 0), server.request.error_len);
            try std.testing.expect(server.request.io.outbox.idle());
        }
        try setup.shared.server.control_reqresp.respondError(handle, valid, "valid", setup.shared.pair.now);
        var failure: ?reqresp.Failure = null;
        for (0..30) |_| {
            try setup.pumpOnce();
            failure = firstFailure(setup.clientEvents());
            if (failure != null) break;
        }
        try std.testing.expectEqual(valid, failure.?.peer_error.code);
        try std.testing.expectEqual(@as(u16, 5), failure.?.peer_error.message_len);
    }
}

test "reqresp fails a response whose context bytes name an unknown fork" {
    var setup: Pair = .{};
    const only_deneb = [_]ForkEntry{.{ .digest = deneb_digest, .fork = .deneb }};
    try setup.init(.{ .forks = &only_deneb }, .{});
    defer setup.deinit();

    const size = Protocol.blocks_by_range_v2.info().response_max;
    const sink = try std.testing.allocator.alloc(u8, size);
    defer std.testing.allocator.free(sink);
    var request_storage_5: [24]u8 = undefined;
    _ = try requestBlocks(&setup, &request_storage_5, 1, sink);
    const block = [_]u8{7} ** 4_000;
    var failure: ?reqresp.Failure = null;
    var rounds: usize = 0;
    while (rounds < 40 and failure == null) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                try setup.shared.server.reqresp.respond(incoming.request, &block, .{ .digest = fulu_digest, .fork = .fulu }, setup.shared.pair.now);
            },
            .chunk_sent => |progress| try std.testing.expect(setup.shared.server.reqresp.finish(progress.request, setup.shared.pair.now)),
            else => {},
        };
        if (firstFailure(setup.clientEvents())) |reason| failure = reason;
    }
    const reason = failure orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(fulu_digest, reason.unknown_context);
}

test "reqresp caller cardinality rejects invalid bounds before opening a stream" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const bytes = [_]u8{0} ** 8;
    var sink: [8]u8 = undefined;
    const options = [_]reqresp.RequestOptions{
        .{ .expected_chunks = 2 }, .{ .timeouts = .{ .response = .fromMilliseconds(0) } },
    };
    for (options) |invalid| {
        try std.testing.expectError(error.InvalidRequestOptions, setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .ping_v1, &bytes, &sink, invalid, setup.shared.pair.now));
    }
    try std.testing.expectEqual(@as(u16, 0), setup.shared.client.control_reqresp.pendingCounts().outbound);
}

test "reqresp validates transport capacity and copies its fork table" {
    var forks = [_]ForkEntry{.{ .digest = deneb_digest, .fork = .deneb }};
    var rr = try reqresp.init(std.testing.allocator, .{ .connections = 1, .forks = &forks, .admission = try reqresp.Options.Admission.defaults(&policy_fixture.config(), 16) });
    defer rr.deinit();
    forks[0].digest = fulu_digest;
    try std.testing.expectEqual(@as(?ForkSeq, .deneb), rr.forkFor(deneb_digest));
    try std.testing.expectEqual(@as(?ForkSeq, null), rr.forkFor(fulu_digest));
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    try std.testing.expectError(error.InvalidCapacity, rr.validateTransportCapacity(&setup.shared.pair.client));
    try std.testing.expectError(error.InvalidOptions, reqresp.init(std.testing.allocator, .{ .connections = 1025, .forks = &.{}, .admission = try reqresp.Options.Admission.defaults(&policy_fixture.config(), 16) }));
    const plan = rr.memoryPlan();
    try std.testing.expectEqual(plan.total_bytes, plan.facade_bytes + plan.slot_bytes + plan.io_bytes + plan.admission_bytes + plan.request_sink_bytes + plan.serving_bytes + plan.scheduler_bytes);
    try std.testing.expect(plan.io_bytes > 0 and plan.slot_bytes > 0);
}

test "reqresp explicit BPO context validates without consuming the serving slot" {
    const first: ForkEntry = .{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu };
    const second: ForkEntry = .{ .digest = .{ 5, 6, 7, 8 }, .fork = .fulu };
    const invalid = [_]?ForkEntry{
        null,
        .{ .digest = .{ 9, 9, 9, 9 }, .fork = .fulu },
        .{ .digest = second.digest, .fork = .deneb },
    };
    for ([_]ForkEntry{ first, second }) |selected| {
        for (invalid) |context| {
            var setup: Pair = .{};
            try setup.init(.{ .forks = &.{selected} }, .{ .forks = &.{ first, second } });
            defer setup.deinit();
            const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_range_v2.info().response_max);
            defer std.testing.allocator.free(sink);
            var request: [24]u8 = undefined;
            _ = try requestBlocks(&setup, &request, 1, sink);
            const block = [_]u8{7} ** 4_000;
            var chunks: u32 = 0;
            var done = false;
            for (0..80) |_| {
                try setup.pumpOnce();
                for (setup.serverEvents()) |event| switch (event) {
                    .request => |incoming| {
                        try std.testing.expectError(error.UnknownFork, setup.shared.server.reqresp.respond(incoming.request, &block, context, setup.shared.pair.now));
                        try setup.shared.server.reqresp.respond(incoming.request, &block, selected, setup.shared.pair.now);
                    },
                    .chunk_sent => |progress| try std.testing.expect(setup.shared.server.reqresp.finish(progress.request, setup.shared.pair.now)),
                    .failed => return error.TestUnexpectedResult,
                    else => {},
                };
                for (setup.clientEvents()) |event| switch (event) {
                    .chunk => |chunk| {
                        try std.testing.expectEqual(selected.fork, chunk.fork.?);
                        try std.testing.expectEqualSlices(u8, &block, chunk.bytes);
                        chunks += 1;
                        try std.testing.expect(setup.shared.client.reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, chunk.request, setup.shared.pair.now));
                    },
                    .done => done = true,
                    .failed => return error.TestUnexpectedResult,
                    else => {},
                };
                if (done) break;
            }
            try std.testing.expect(done);
            try std.testing.expectEqual(@as(u32, 1), chunks);
        }
    }
}

test "reqresp rejects duplicate digests before allocating" {
    const first: ForkEntry = .{ .digest = .{ 1, 2, 3, 4 }, .fork = .fulu };
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    for ([_]ForkSeq{ .fulu, .deneb }) |fork| {
        try std.testing.expectError(error.InvalidOptions, reqresp.init(failing.allocator(), .{
            .forks = &.{ first, .{ .digest = first.digest, .fork = fork } },
            .admission = try reqresp.Options.Admission.defaults(&policy_fixture.config(), 1),
        }));
    }
}

test "reqresp validates all timeout durations before stream admission" {
    var setup: Pair = .{};
    try setup.init(.{}, .{});
    defer setup.deinit();
    const request = statusBytes(5);
    var sink: [ct.phase0.Status.fixed_size]u8 = undefined;
    inline for (.{ "negotiation", "request", "response" }) |field| {
        for ([_]i96{ -1, 0, 60001, std.math.maxInt(u64) }) |invalid| {
            var policy: reqresp.RequestOptions.Timeouts = .{ .negotiation = .fromMilliseconds(1), .request = .fromMilliseconds(1), .response = .fromMilliseconds(1) };
            @field(policy, field) = .fromNanoseconds(@as(i96, invalid) * std.time.ns_per_ms);
            try std.testing.expectError(error.InvalidRequestOptions, setup.shared.client.control_reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .status_v1, &request, &sink, .{ .timeouts = policy }, setup.shared.pair.now));
        }
    }
    try std.testing.expectEqual(@as(usize, 0), setup.shared.client.router.negotiator.active());
}
