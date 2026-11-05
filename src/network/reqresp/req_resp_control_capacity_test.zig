const std = @import("std");
const RequestIO = @import("RequestIO.zig");
const rr = @import("ReqResp.zig");
const protocol = @import("protocol.zig");
const Router = @import("../router.zig").Router;
const support = @import("../quic/test_support.zig");
const policy_fixture = @import("policy_fixture.zig");
const Endpoint = @import("test_pair.zig").Endpoint;
const codec = @import("codec.zig");
const status_size = @import("consensus_types").fulu.StatusV2.fixed_size;

const control_fixture = @import("control_fixture.zig");
const applicationOptions = control_fixture.applicationOptions;

test "reqresp decoder captures configured root byte bounds before reading a body" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var router = try Router.init(std.testing.allocator, .{});
    defer router.deinit();
    var options = try applicationOptions();
    options.admission.policy.blob_identifiers_deneb = 2;
    options.admission.policy.blob_identifiers_electra = 3;
    options.request_fork = .deneb;
    var requests = try rr.init(std.testing.allocator, options);
    defer requests.deinit();
    defer requests.cancelAll(&pair.server, &router, pair.now);
    const first = try requests.accept(&pair.server, try inboundStream(&pair, handles.client), .{
        .protocol = .{ .reqresp = .blob_sidecars_by_root_v1 },
        .leftover = &.{},
        .fin = false,
    }, pair.now);
    requests.setRequestFork(.electra);
    const second = try requests.accept(&pair.server, try inboundStream(&pair, handles.client), .{
        .protocol = .{ .reqresp = .blob_sidecars_by_root_v1 },
        .leftover = &.{},
        .fin = false,
    }, pair.now);
    const older = &requests.inbound[first.index].request.io.decoder;
    const newer = &requests.inbound[second.index].request.io.decoder;
    try std.testing.expectError(error.LengthOutOfBounds, older.feed(&.{120}));
    try std.testing.expectEqual(@as(usize, 0), older.written);
    const prefix = try newer.feed(&.{120});
    try std.testing.expectEqual(@as(usize, 1), prefix.consumed);
    try std.testing.expect(!prefix.done);
    try std.testing.expectEqual(@as(usize, 0), newer.written);
}

test "reqresp instances size outbound storage from their own protocols" {
    var application = try rr.init(std.testing.allocator, try applicationOptions());
    defer application.deinit();
    var control = try rr.init(std.testing.allocator, try control_fixture.controlOptions());
    defer control.deinit();
    for (control.outbound) |*slot| {
        try std.testing.expectEqual(protocol.control_scratch_length, slot.request.io.scratch.len);
        try std.testing.expectEqual(RequestIO.control_read_buffer_length, slot.request.io.read_buffer.len);
    }
    for (application.outbound) |*slot| {
        try std.testing.expectEqual(RequestIO.scratch_length, slot.request.io.scratch.len);
        try std.testing.expectEqual(RequestIO.read_buffer_length, slot.request.io.read_buffer.len);
    }
}

test "reqresp compact control admission rejects oversized handoffs before claiming a slot" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var router = try Router.init(std.testing.allocator, .{});
    defer router.deinit();
    var requests = try rr.init(std.testing.allocator, try control_fixture.controlOptions());
    defer requests.deinit();
    defer requests.cancelAll(&pair.server, &router, pair.now);
    const stream = try inboundStream(&pair, handles.client);
    var bytes: [RequestIO.control_read_buffer_length + 1]u8 = @splat(0);
    try std.testing.expectError(error.InvalidHandoff, requests.accept(&pair.server, stream, .{
        .protocol = .{ .reqresp = .ping_v1 },
        .leftover = &bytes,
        .fin = false,
    }, pair.now));
    try std.testing.expectEqual(@as(usize, 0), requests.pendingCounts().inbound);
    _ = try requests.accept(&pair.server, stream, .{ .protocol = .{ .reqresp = .ping_v1 }, .leftover = &.{}, .fin = false }, pair.now);
}

test "reqresp control capacity protects outbound slots and retains terminal owners" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var router = try Router.init(std.testing.allocator, .{});
    defer router.deinit();
    var requests = try rr.init(std.testing.allocator, try applicationOptions());
    defer requests.deinit();
    var controls = try rr.init(std.testing.allocator, try control_fixture.controlOptions());
    defer controls.deinit();
    defer controls.cancelAll(&pair.client, &router, pair.now);
    const size = protocol.Protocol.blocks_by_root_v2.info().response_max;
    const sinks = try std.testing.allocator.alloc(u8, size * 3);
    defer {
        requests.cancelAll(&pair.client, &router, pair.now);
        std.testing.allocator.free(sinks);
    }
    const first = try requests.request(
        &pair.client,
        &router,
        handles.client,
        .blocks_by_root_v2,
        &.{},
        sinks[0..size],
        .{},
        pair.now,
    );
    _ = try requests.request(
        &pair.client,
        &router,
        handles.client,
        .blocks_by_range_v2,
        &([_]u8{0} ** 8 ++ [_]u8{1} ++ [_]u8{0} ** 15),
        sinks[size..][0..size],
        .{},
        pair.now,
    );
    try std.testing.expectError(
        error.SlotsExhausted,
        requests.request(
            &pair.client,
            &router,
            handles.client,
            .blocks_by_root_v2,
            &.{},
            sinks[size * 2 ..],
            .{},
            pair.now,
        ),
    );
    var pong: [8]u8 = undefined;
    const ping = try controls.request(
        &pair.client,
        &router,
        handles.client,
        .ping_v1,
        &([_]u8{0} ** 8),
        &pong,
        .{},
        pair.now,
    );
    try std.testing.expectEqual(.outbound, ping.direction);
    try std.testing.expect(requests.cancel(&pair.client, &router, first, pair.now));

    try std.testing.expectError(
        error.SlotsExhausted,
        requests.request(
            &pair.client,
            &router,
            handles.client,
            .blocks_by_root_v2,
            &.{},
            sinks[size * 2 ..],
            .{},
            pair.now,
        ),
    );
    var events: [1]rr.Event = undefined;
    try std.testing.expectEqual(1, requests.pump(&pair.client, &router, pair.now, &events));
    try std.testing.expectEqual(first, events[0].failed.request);
    _ = try requests.request(
        &pair.client,
        &router,
        handles.client,
        .blocks_by_root_v2,
        &.{},
        sinks[size * 2 ..],
        .{},
        pair.now,
    );
}

test "reqresp bounds application requests per connection across protocols" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var router = try Router.init(std.testing.allocator, .{});
    defer router.deinit();
    var options: rr.Options = .{ .admission = try rr.Options.Admission.defaults(&policy_fixture.config(), 1), .outbound_max = 4, .serving_max = 4, .forks = &.{} };
    options.outbound_per_connection_max = 2;
    var requests = try rr.init(std.testing.allocator, options);
    defer requests.deinit();
    var controls = try rr.init(std.testing.allocator, try control_fixture.controlOptions());
    defer controls.deinit();
    defer controls.cancelAll(&pair.client, &router, pair.now);
    const size = protocol.Protocol.blocks_by_root_v2.info().response_max;
    const sinks = try std.testing.allocator.alloc(u8, 3 * size);
    defer {
        requests.cancelAll(&pair.client, &router, pair.now);
        std.testing.allocator.free(sinks);
    }
    const first = try requests.request(
        &pair.client,
        &router,
        handles.client,
        .blocks_by_root_v2,
        &.{},
        sinks[0..size],
        .{},
        pair.now,
    );
    _ = try requests.request(
        &pair.client,
        &router,
        handles.client,
        .blocks_by_range_v2,
        &([_]u8{0} ** 8 ++ [_]u8{1} ++ [_]u8{0} ** 15),
        sinks[size..][0..size],
        .{},
        pair.now,
    );
    try std.testing.expectError(
        error.TooManyRequests,
        requests.request(
            &pair.client,
            &router,
            handles.client,
            .blocks_by_root_v2,
            &.{},
            sinks[2 * size ..],
            .{},
            pair.now,
        ),
    );
    var pong: [8]u8 = undefined;
    _ = try controls.request(
        &pair.client,
        &router,
        handles.client,
        .ping_v1,
        &([_]u8{0} ** 8),
        &pong,
        .{},
        pair.now,
    );
    try std.testing.expect(requests.cancel(&pair.client, &router, first, pair.now));
    var events: [1]rr.Event = undefined;
    _ = requests.pump(&pair.client, &router, pair.now, &.{});
    try std.testing.expectError(
        error.TooManyRequests,
        requests.request(
            &pair.client,
            &router,
            handles.client,
            .blocks_by_root_v2,
            &.{},
            sinks[2 * size ..],
            .{},
            pair.now,
        ),
    );
    try std.testing.expectEqual(1, requests.pump(&pair.client, &router, pair.now, &events));
    try std.testing.expectEqual(first, events[0].failed.request);
    _ = try requests.request(
        &pair.client,
        &router,
        handles.client,
        .blocks_by_root_v2,
        &.{},
        sinks[2 * size ..],
        .{},
        pair.now,
    );
}

const Engine = @import("../quic/Engine.zig");

fn inboundStream(pair: *support.Pair, conn: Engine.Handle) !Engine.StreamHandle {
    const stream = try pair.client.openStream(conn);
    try std.testing.expectEqual(1, try pair.client.write(stream, &.{0}, false));
    try pair.pump();
    var events: [16]Engine.Event = undefined;
    for (pair.events(&pair.server, &events)) |event| {
        if (event == .stream_opened) return event.stream_opened;
    }
    return error.TestUnexpectedResult;
}

test "reqresp inbound admission selects distinct reserved sinks" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var options = try applicationOptions();
    options.inbound_per_connection_max = 4;
    var server = try Endpoint.init(std.testing.allocator, options, try control_fixture.controlOptions(), .{});
    defer server.deinit();
    defer server.control_reqresp.cancelAll(&pair.server, &server.router, pair.now);
    defer server.reqresp.cancelAll(&pair.server, &server.router, pair.now);
    const ordinary: Router.Selection = .{
        .protocol = .{ .reqresp = .blocks_by_root_v2 },
        .leftover = &.{},
        .fin = false,
    };
    const first = (server.reqresp.accept(&pair.server, try inboundStream(&pair, handles.client), ordinary, pair.now) catch null).?;
    const second = (server.reqresp.accept(&pair.server, try inboundStream(&pair, handles.client), ordinary, pair.now) catch null).?;
    try std.testing.expect(first.index != second.index);
    const status = (server.control_reqresp.accept(&pair.server, try inboundStream(&pair, handles.client), .{ .protocol = .{ .reqresp = .status_v1 }, .leftover = &.{}, .fin = false }, pair.now) catch null).?;
    try std.testing.expect(server.control_reqresp.inbound[status.index].receive.sink.ptr != server.reqresp.inbound[first.index].receive.sink.ptr);
    try std.testing.expectEqual(
        server.control_reqresp.inbound[status.index].receive.sink.ptr,
        server.control_reqresp.inbound[status.index].request.io.sink.ptr,
    );
}

test "reqresp admission refusals distinguish capacity and concurrency without failing admitted work" {
    const Case = struct {
        slots: u16,
        connection_limit: u8,
        held: u8 = 2,
        accepted: protocol.Protocol = .ping_v1,
        refused: protocol.Protocol = .ping_v1,
        reason: rr.metrics.AdmissionRefusal,
        failure: rr.AcceptError,
    };
    const cases = [_]Case{
        .{ .slots = 4, .connection_limit = 2, .refused = .status_v1, .reason = .connection_capacity, .failure = error.ConnectionSlotsExhausted },
        .{ .slots = 4, .connection_limit = 1, .held = 1, .accepted = .blocks_by_root_v2, .refused = .blocks_by_range_v2, .reason = .connection_capacity, .failure = error.ConnectionSlotsExhausted },
        .{ .slots = 4, .connection_limit = 4, .reason = .protocol_concurrency, .failure = error.ProtocolConcurrency },
    };
    for (cases) |case| {
        var pair: support.Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        const handles = try support.connectPair(&pair);
        var router = try Router.init(std.testing.allocator, .{});
        defer router.deinit();
        var requests = try rr.init(std.testing.allocator, .{
            .outbound_max = 1,
            .serving_max = case.slots,
            .inbound_per_connection_max = case.connection_limit,
            .forks = &.{},
            .admission = try rr.Options.Admission.defaults(&policy_fixture.config(), @max(1, (case.slots) / 4)),
        });
        defer requests.deinit();
        defer requests.cancelAll(&pair.server, &router, pair.now);
        for (0..case.held) |_| {
            _ = try requests.accept(&pair.server, try inboundStream(&pair, handles.client), .{
                .protocol = .{ .reqresp = case.accepted },
                .leftover = &.{},
                .fin = false,
            }, pair.now);
        }
        const stream = try inboundStream(&pair, handles.client);
        defer pair.server.closeStream(stream, 0);
        try std.testing.expectError(case.failure, requests.accept(&pair.server, stream, .{
            .protocol = .{ .reqresp = case.refused },
            .leftover = &.{},
            .fin = false,
        }, pair.now));
        const counts = requests.protocol_counters[@intFromEnum(case.refused)];
        try std.testing.expectEqual(@as(u64, 1), counts.admission_refusals[@intFromEnum(case.reason)]);
        try std.testing.expectEqual(@as(u64, 1), @reduce(.Add, @as(@Vector(rr.metrics.admission_refusal_count, u64), counts.admission_refusals)));
        const resources = requests.resourceSnapshot();
        try std.testing.expectEqual(@as(usize, case.held), resources.inbound_phases[@intFromEnum(rr.metrics.InboundPhase.receiving_request)]);
    }
}

test "reqresp validates headroom and cleans every allocation prefix" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocationFailures, .{});
    var options = try applicationOptions();
    options.outbound_per_connection_max = 3;
    try std.testing.expectError(
        error.InvalidOptions,
        rr.init(std.testing.allocator, options),
    );
    options = try applicationOptions();
    options.outbound_max = 64;
    options.outbound_per_connection_max = 61;
    try std.testing.expectError(
        error.InvalidOptions,
        rr.init(std.testing.allocator, options),
    );
    options.outbound_per_connection_max = 60;
    var valid = try rr.init(std.testing.allocator, options);
    defer valid.deinit();
    try std.testing.expectError(
        error.InvalidLimits,
        Router.init(
            std.testing.allocator,
            .{ .negotiations_max = 4, .outbound_control_reserved = 5 },
        ),
    );
}

test "reqresp available slots preserve admission rollback" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var requests = try rr.init(
        std.testing.allocator,
        .{ .outbound_max = 4, .serving_max = 4, .forks = &.{}, .admission = try rr.Options.Admission.defaults(&policy_fixture.config(), 1) },
    );
    defer requests.deinit();
    var router = try Router.init(std.testing.allocator, .{ .negotiations_max = 4 });
    defer router.deinit();
    const size = protocol.Protocol.blocks_by_root_v2.info().response_max;
    const sinks = try std.testing.allocator.alloc(u8, 4 * size);
    defer {
        requests.cancelAll(&pair.client, &router, pair.now);
        std.testing.allocator.free(sinks);
    }
    const dead = Engine.Handle{
        .index = handles.client.index,
        .generation = handles.client.generation + 1,
    };
    try std.testing.expectError(
        error.StaleHandle,
        requests.request(
            &pair.client,
            &router,
            dead,
            .blocks_by_root_v2,
            &.{},
            sinks[0..size],
            .{},
            pair.now,
        ),
    );
    const roots = [_]protocol.Protocol{ .blocks_by_root_v2, .blocks_by_root_v2 };
    for (roots, 0..) |which, index| {
        _ = try requests.request(
            &pair.client,
            &router,
            handles.client,
            which,
            &.{},
            sinks[index * size ..][0..size],
            .{},
            pair.now,
        );
    }
    for (2..4) |index| {
        _ = try requests.request(
            &pair.client,
            &router,
            handles.client,
            .blocks_by_range_v2,
            &([_]u8{0} ** 8 ++ [_]u8{1} ++ [_]u8{0} ** 15),
            sinks[index * size ..][0..size],
            .{},
            pair.now,
        );
    }
    try std.testing.expectEqual(4, requests.pendingCounts().outbound);
    var pong: [8]u8 = undefined;
    try std.testing.expectError(
        error.SlotsExhausted,
        requests.request(
            &pair.client,
            &router,
            handles.client,
            .ping_v1,
            &([_]u8{0} ** 8),
            &pong,
            .{},
            pair.now,
        ),
    );
    try std.testing.expectError(
        error.NegotiationTableFull,
        router.beginOutbound(&pair.client, handles.client, .{ .reqresp = .ping_v1 }, pair.now),
    );
    requests.cancelAll(&pair.client, &router, pair.now);
    try std.testing.expectEqual(0, router.negotiator.active());
    var events: [4]rr.Event = undefined;
    try std.testing.expectEqual(4, requests.pump(&pair.client, &router, pair.now, &events));
    for (events) |event| try std.testing.expectEqual(rr.Failure.cancelled, event.failed.reason);
}

fn allocationFailures(allocator: std.mem.Allocator) !void {
    var options = try applicationOptions();
    options.outbound_per_connection_max = 2;
    var requests = try rr.init(allocator, options);
    defer requests.deinit();
    const plan = requests.memoryPlan();
    try std.testing.expectEqual(plan.facade_bytes + plan.slot_bytes + plan.io_bytes +
        plan.admission_bytes + plan.request_sink_bytes + plan.serving_bytes + plan.scheduler_bytes, plan.total_bytes);
}

test "reqresp reserved physical sinks admit full native control wave and recycle by generation" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var options = try applicationOptions();
    options.inbound_per_connection_max = 8;
    var server = try Endpoint.init(std.testing.allocator, options, try control_fixture.controlOptions(), .{});
    defer server.deinit();
    defer server.control_reqresp.cancelAll(&pair.server, &server.router, pair.now);
    var wave: [8]rr.RequestHandle = undefined;
    for ([_]protocol.Protocol{ .status_v1, .status_v1, .ping_v1, .ping_v1, .metadata_v3, .metadata_v3, .goodbye_v1, .goodbye_v1 }, 0..) |which, i| {
        wave[i] = (server.control_reqresp.accept(&pair.server, try inboundStream(&pair, handles.client), .{ .protocol = .{ .reqresp = which }, .leftover = &.{}, .fin = false }, pair.now) catch null).?;
        try std.testing.expectEqual(server.control_reqresp.inbound[wave[i].index].receive.sink.ptr, server.control_reqresp.inbound[wave[i].index].request.io.sink.ptr);
        try std.testing.expect(server.control_reqresp.inbound[wave[i].index].receive.sink.len >= which.info().request_max);
    }
    try std.testing.expect(server.control_reqresp.cancel(&pair.server, &server.router, wave[0], pair.now));
    var events: [4]rr.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), server.control_reqresp.pump(&pair.server, &server.router, pair.now, &events));
    try std.testing.expectEqual(wave[0], events[0].failed.request);
    try std.testing.expectEqual(@as(usize, 0), server.control_reqresp.pump(&pair.server, &server.router, pair.now, &events));
    try std.testing.expect(server.control_reqresp.responseReadiness(wave[0]) == .stale);
    const replacement = (server.control_reqresp.accept(&pair.server, try inboundStream(&pair, handles.client), .{ .protocol = .{ .reqresp = .status_v1 }, .leftover = &.{}, .fin = false }, pair.now) catch null).?;
    try std.testing.expectEqual(wave[0].index, replacement.index);
    try std.testing.expectEqual(wave[0].generation + 1, replacement.generation);
}

const ControlRequest = struct { stream: Engine.StreamHandle, incoming: @FieldType(rr.Event, "request") };

fn receiveControlRequest(pair: *support.Pair, requests: *rr, router: *Router, conn: Engine.Handle, bytes: *const [status_size]u8) !ControlRequest {
    const stream = try pair.client.openStream(conn);
    var wire: [codec.encodedLengthMax(status_size)]u8 = undefined;
    const encoded = try codec.encodeRequest(bytes, &wire);
    try std.testing.expectEqual(encoded.len, try pair.client.write(stream, encoded, true));
    try pair.pump();
    const inbound = found: {
        var events: [16]Engine.Event = undefined;
        for (pair.events(&pair.server, &events)) |event| {
            if (event == .stream_opened and event.stream_opened.id == stream.id) break :found event.stream_opened;
        }
        return error.RequestStreamNotReceived;
    };
    const handle = try requests.accept(&pair.server, inbound, .{
        .protocol = .{ .reqresp = .status_v2 },
        .leftover = &.{},
        .fin = false,
    }, pair.now);
    for (0..16) |_| {
        @import("test_pair.zig").forward(pair, &pair.server, requests);
        var events: [1]rr.Event = undefined;
        if (requests.pump(&pair.server, router, pair.now, &events) == 0) continue;
        try std.testing.expect(events[0] == .request);
        try std.testing.expectEqual(handle, events[0].request.request);
        try std.testing.expectEqualSlices(u8, bytes, events[0].request.bytes);
        try std.testing.expectEqual(@as(u128, 1), requests.inbound[handle.index].admission.paid);
        return .{ .stream = stream, .incoming = events[0].request };
    }
    return error.RequestNotReceived;
}

fn expectControlReply(pair: *support.Pair, requests: *rr, router: *Router, pending: *const ControlRequest, code: u8, expected: []const u8) !void {
    var sink: [status_size]u8 = undefined;
    var scratch: [protocol.control_scratch_length]u8 = undefined;
    var decoder = codec.Decoder.initResponse(.{ .min = status_size, .max = status_size }, false, &sink, &scratch);
    var finished = false;
    for (0..64) |_| {
        try pair.pump();
        @import("test_pair.zig").forward(pair, &pair.server, requests);
        _ = requests.pump(&pair.server, router, pair.now, &.{});
        try pair.pump();
        var wire: [codec.encodedLengthMax(codec.error_message_max)]u8 = undefined;
        const read = try pair.client.read(pending.stream, &wire);
        try std.testing.expect(read.reset_code == null);
        if (read.len > 0) {
            const decoded = try decoder.feed(wire[0..read.len]);
            try std.testing.expectEqual(read.len, decoded.consumed);
        }
        if (read.fin) {
            finished = true;
            break;
        }
    }
    try std.testing.expect(finished and decoder.isDone());
    try std.testing.expectEqual(code, decoder.result());
    try std.testing.expectEqualSlices(u8, expected, decoder.payload());
    for (0..16) |_| {
        @import("test_pair.zig").forward(pair, &pair.server, requests);
        var events: [1]rr.Event = undefined;
        if (requests.pump(&pair.server, router, pair.now, &events) == 0) continue;
        try std.testing.expect(events[0] == .served);
        try std.testing.expectEqual(pending.incoming.request, events[0].served.request);
        try std.testing.expectEqual(@as(u32, if (code == 0) 1 else 0), events[0].served.chunks);
        try std.testing.expectEqual(.stale, requests.responseReadiness(pending.incoming.request));
        return;
    }
    return error.RequestNotRetired;
}

test "reqresp control replies preserve blocked writes and decoded requests through reuse" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    @import("../quic/binding.zig").c.quiche_config_set_initial_max_stream_data_bidi_local(pair.client.config.ptr, 16);
    const handles = try support.connectPair(&pair);
    var router = try Router.init(std.testing.allocator, .{});
    defer router.deinit();
    var requests = try rr.init(std.testing.allocator, try control_fixture.controlOptions());
    defer requests.deinit();
    defer requests.cancelAll(&pair.server, &router, pair.now);

    const first_bytes = [_]u8{0x31} ** status_size;
    const second_bytes = [_]u8{0x72} ** status_size;
    const first = try receiveControlRequest(&pair, &requests, &router, handles.client, &first_bytes);
    var response: [status_size]u8 = undefined;
    for (&response, 0..) |*byte, index| byte.* = @intCast(index);
    try requests.respond(first.incoming.request, &response, null, pair.now);
    try std.testing.expect(requests.finish(first.incoming.request, pair.now));
    const expected_first = response;
    @memset(&response, 0xee);
    for (0..4) |_| _ = requests.pump(&pair.server, &router, pair.now, &.{});
    const blocked = &requests.inbound[first.incoming.request.index];
    try std.testing.expectEqual(.writing_chunk, blocked.state);
    try std.testing.expect(!blocked.request.io.outbox.idle());
    try std.testing.expectEqual(@as(usize, 0), try pair.server.streamCapacity(blocked.request.stream));

    const second = try receiveControlRequest(&pair, &requests, &router, handles.client, &second_bytes);
    try std.testing.expect(first.incoming.request.index != second.incoming.request.index);
    const expected_second = [_]u8{0xa7} ** status_size;
    try requests.respond(second.incoming.request, &expected_second, null, pair.now);
    try std.testing.expect(requests.finish(second.incoming.request, pair.now));
    try expectControlReply(&pair, &requests, &router, &second, 0, &expected_second);
    try std.testing.expectEqual(.writing_chunk, blocked.state);
    try std.testing.expect(!blocked.request.io.outbox.idle());
    try std.testing.expectEqualSlices(u8, &first_bytes, first.incoming.bytes);
    try expectControlReply(&pair, &requests, &router, &first, 0, &expected_first);

    const replacement = try receiveControlRequest(&pair, &requests, &router, handles.client, &second_bytes);
    try std.testing.expectEqual(first.incoming.request.index, replacement.incoming.request.index);
    try std.testing.expectEqual(first.incoming.request.generation + 1, replacement.incoming.request.generation);
    try std.testing.expectError(error.StaleHandle, requests.respond(first.incoming.request, &first_bytes, null, pair.now));
    var message: [codec.error_message_max]u8 = undefined;
    for (&message, 0..) |*byte, index| byte.* = @intCast(index);
    const expected_error = message;
    try requests.respondError(replacement.incoming.request, 2, &message, pair.now);
    @memset(&message, 0xee);
    try expectControlReply(&pair, &requests, &router, &replacement, 2, &expected_error);
    try std.testing.expectEqual(@as(u16, 0), requests.pendingCounts().inbound);
    try std.testing.expectEqual(@as(usize, 0), requests.memoryPlan().serving_bytes);
}
