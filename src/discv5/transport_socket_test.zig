const std = @import("std");
const CallTable = @import("CallTable.zig");
const Transport = @import("Transport.zig");
const enr = @import("identity/enr.zig");
const Maintenance = @import("Maintenance.zig");
const message = @import("wire/message.zig");
const Sockets = @import("udp").Sockets;
const test_support = @import("test_support.zig");
const Pair = @import("transport_test_support.zig").Pair;
const types = @import("types.zig");
const endpoint = test_support.endpoint;
const keyPair = test_support.keyPair;
const driver = @import("driver.zig");
const constants = @import("wire/constants.zig");
const fault_io = @import("fault_io");
const waitForDatagram = @import("socket_test_support").waitForDatagram;

test "maintenance retains a routing incumbent that answers through Transport" {
    var pair: Pair = undefined;
    try pair.init(std.testing.io, 1_000, true);
    defer pair.deinit();
    try pair.fillBucket();
    const now_ms = try Transport.monotonicMilliseconds(std.testing.io);
    var controller: Maintenance = undefined;
    try controller.init(now_ms, .{}, .ip4);
    defer controller.cancel(&pair.transport_a.engine);
    try std.testing.expectEqual(@as(?u64, 0), controller.nextDeadlineMs(&pair.transport_a.engine));
    var out: [1_280]u8 = undefined;
    const started = (try controller.startNext(&pair.transport_a.engine, &out, try .init(&.{1}), now_ms, &test_support.sealEntropy(10))).?;
    try pair.transport_a.transmit(std.testing.io, started.peer.address, out[0..started.call.packet_length]);
    var expired: [4]CallTable.Expired = undefined;
    const answered = try driver.step(&pair.transport_b, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expectEqual(@as(u8, 1), answered.standard_responses);
    const completed = try driver.step(&pair.transport_a, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expect(completed.event == .response);
    try std.testing.expect(controller.onEvent(&pair.transport_a.engine, &completed.event, completed.now_ms).consumed);
    try std.testing.expectEqual(@as(usize, 0), pair.transport_a.engine.routing.pendingCount());
    try std.testing.expect(pair.transport_a.engine.routing.contains(&pair.record_b.node_id));
    try std.testing.expect(!pair.transport_a.engine.routing.contains(&pair.candidate_id));
    try std.testing.expectEqual(@as(usize, 0), pair.transport_a.engine.calls.count());
}

test "transport completes a cold call through challenge and handshake" {
    var pair: Pair = undefined;
    try pair.init(std.testing.io, 1_000, false);
    defer pair.deinit();

    const request = message.Message{ .ping = .{
        .request_id = try message.RequestId.init(&.{0x42}),
        .enr_sequence = pair.record_a.sequence,
    } };
    const handle = try pair.transport_a.startCall(std.testing.io, endpoint(&pair.record_b), &pair.record_b, &request, try Transport.monotonicMilliseconds(std.testing.io));
    var expired: [4]CallTable.Expired = undefined;
    try std.testing.expect((try driver.step(&pair.transport_b, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(10) })).event == .none);
    try std.testing.expect((try driver.step(&pair.transport_a, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(10) })).event == .none);
    const request_step = try driver.step(&pair.transport_b, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expectEqual(@as(u8, 1), request_step.standard_responses);
    const response_step = try driver.step(&pair.transport_a, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expect(response_step.event == .response);
    try std.testing.expectEqual(handle, response_step.event.response.matched.handle);
    try std.testing.expect(response_step.event.response.matched.response == .pong);
    try std.testing.expectEqual(@as(usize, 0), pair.transport_a.engine.calls.count());
}

test "transport leaves TALK response policy with the application" {
    var pair: Pair = undefined;
    try pair.init(std.testing.io, 1_000, true);
    defer pair.deinit();

    const request_id = try message.RequestId.init(&.{0x43});
    const request = message.Message{ .talk_request = .{
        .request_id = request_id,
        .protocol = "test",
        .request = "request",
    } };
    const handle = try pair.transport_a.startCall(std.testing.io, endpoint(&pair.record_b), &pair.record_b, &request, try Transport.monotonicMilliseconds(std.testing.io));
    var expired: [4]CallTable.Expired = undefined;
    const received = try driver.step(&pair.transport_b, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expect(received.event == .request);
    try std.testing.expect(received.event.request.message == .talk_request);
    try std.testing.expectEqual(@as(u8, 0), received.standard_responses);

    const response = message.Message{ .talk_response = .{
        .request_id = request_id,
        .response = "response",
    } };
    try pair.transport_b.sendResponse(std.testing.io, endpoint(&pair.record_a), &response, try Transport.monotonicMilliseconds(std.testing.io));
    const completed = try driver.step(&pair.transport_a, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expect(completed.event == .response);
    try std.testing.expectEqual(handle, completed.event.response.matched.handle);
    try std.testing.expectEqualStrings(
        "response",
        completed.event.response.matched.response.talk_response.response,
    );
}

test "transport releases a malformed datagram before the next step" {
    var pair: Pair = undefined;
    try pair.init(std.testing.io, 1_000, true);
    defer pair.deinit();

    try pair.transport_b.sockets.sendTo(
        std.testing.io,
        pair.transport_a.localAddress(),
        &.{0xff},
        constants.packet_size_max,
    );
    var expired: [4]CallTable.Expired = undefined;
    const rejected = try driver.step(&pair.transport_a, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expect(rejected.datagram == .rejected);
    try std.testing.expectEqual(types.RejectReason.malformed_packet, rejected.datagram.rejected);

    const request = message.Message{ .ping = .{
        .request_id = try message.RequestId.init(&.{0x44}),
        .enr_sequence = pair.record_b.sequence,
    } };
    const handle = try pair.transport_b.startCall(std.testing.io, endpoint(&pair.record_a), &pair.record_a, &request, try Transport.monotonicMilliseconds(std.testing.io));
    const answered = try driver.step(&pair.transport_a, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expectEqual(@as(u8, 1), answered.standard_responses);
    const completed = try driver.step(&pair.transport_b, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(10) });
    try std.testing.expect(completed.event == .response);
    try std.testing.expectEqual(handle, completed.event.response.matched.handle);
}

test "transport drops replies its destination refuses and keeps the step's expiries" {
    for ([_]bool{ false, true }) |established| {
        var pair: Pair = undefined;
        try pair.init(std.testing.io, 1_000, established);
        defer pair.deinit();
        const request = message.Message{ .ping = .{
            .request_id = try message.RequestId.init(&.{0x48}),
            .enr_sequence = pair.record_a.sequence,
        } };
        var output: [1_280]u8 = undefined;
        const expiring = try pair.transport_a.engine.startCall(
            &output,
            endpoint(&pair.record_b),
            &pair.record_b,
            &request,
            0,
            &test_support.sealEntropy(0x33),
        );
        _ = try pair.transport_b.startCall(std.testing.io, endpoint(&pair.record_a), &pair.record_a, &request, try Transport.monotonicMilliseconds(std.testing.io));
        try waitForDatagram(pair.transport_a.sockets.primary());
        // A challenge answers the cold request and a PONG the established one.
        var host = fault_io{ .send = .{ .socket = pair.transport_a.sockets.primary().handle } };
        var expired: [4]CallTable.Expired = undefined;
        const result = try driver.step(&pair.transport_a, host.io(), &expired, .{ .wait_max = .fromMilliseconds(10) });
        try std.testing.expectEqual(@as(?Transport.Failure, null), result.failure);
        try std.testing.expect(result.datagram == .accepted);
        try std.testing.expect(result.event == .none);
        try std.testing.expectEqual(@as(u8, 0), result.standard_responses);
        try std.testing.expectEqual(@as(usize, 1), host.send_calls);
        try std.testing.expectEqual(@as(usize, 1), result.calls_expired);
        try std.testing.expectEqual(expiring.handle, expired[0].handle);
    }
}

test "transport fails a call whose handshake is not sent so maintenance keeps the incumbent" {
    // A refusal fails only the call; local resource pressure also reports a local step failure.
    for ([_]std.Io.net.Socket.SendError{ error.AddressFamilyUnsupported, error.SystemResources }) |send_failure| {
        var pair: Pair = undefined;
        try pair.init(std.testing.io, 1_000, false);
        defer pair.deinit();
        try pair.fillBucket();
        const incumbent = pair.transport_a.engine.peerRecord(&pair.record_b.node_id).?;
        const now_ms = try Transport.monotonicMilliseconds(std.testing.io);
        var controller: Maintenance = undefined;
        try controller.init(now_ms, .{}, .ip4);
        defer controller.cancel(&pair.transport_a.engine);
        var out: [1_280]u8 = undefined;
        const started = (try controller.startNext(&pair.transport_a.engine, &out, try .init(&.{1}), now_ms, &test_support.sealEntropy(10))).?;
        try std.testing.expectEqual(endpoint(&pair.record_b), started.peer);
        try pair.transport_a.transmit(std.testing.io, started.peer.address, out[0..started.call.packet_length]);
        var expired: [4]CallTable.Expired = undefined;
        const challenged = try driver.step(&pair.transport_b, std.testing.io, &expired, .{ .wait_max = .fromMilliseconds(10) });
        try std.testing.expect(challenged.failure == null and challenged.datagram == .accepted);
        var host = fault_io{ .send = .{ .socket = pair.transport_a.sockets.primary().handle }, .send_failure = send_failure };
        const unsent = try driver.step(&pair.transport_a, host.io(), &expired, .{ .wait_max = .fromMilliseconds(10) });
        try std.testing.expectEqual(if (send_failure == error.SystemResources) @as(?Transport.Error, error.SystemResources) else null, @as(?Transport.Error, if (unsent.failure) |failure| failure.cause else null));
        const dropped = &pair.transport_a.send_drops;
        const pressure = @intFromEnum(Sockets.SendDrops.Reason.system_resources);
        try std.testing.expectEqual(@as(u64, @intFromBool(send_failure == error.SystemResources)), dropped.datagrams[pressure]);
        try std.testing.expectEqual(send_failure == error.SystemResources, dropped.bytes[pressure] > 0);
        try std.testing.expectEqual(@as(usize, 1), host.send_calls);
        try std.testing.expect(unsent.event == .failed);
        try std.testing.expectEqual(started.call.handle, unsent.event.failed.handle);
        try std.testing.expectEqual(@as(usize, 0), pair.transport_a.engine.calls.count());
        try std.testing.expect(controller.onEvent(&pair.transport_a.engine, &unsent.event, unsent.now_ms).consumed);
        try std.testing.expect(pair.transport_a.engine.routing.contains(&pair.record_b.node_id));
        try std.testing.expect(!pair.transport_a.engine.routing.contains(&pair.candidate_id));
        try std.testing.expectEqual(@as(usize, 1), pair.transport_a.engine.routing.pendingCount());
        try std.testing.expectEqual(incumbent.last_verified_ms, pair.transport_a.engine.peerRecord(&pair.record_b.node_id).?.last_verified_ms);
        // A local failure retries the probe after its interval, and the failed call never expires.
        const retry_ms = controller.nextDeadlineMs(&pair.transport_a.engine).?;
        try std.testing.expect(retry_ms > unsent.now_ms);
        const retry = (try controller.startNext(&pair.transport_a.engine, &out, try .init(&.{2}), retry_ms, &test_support.sealEntropy(11))).?;
        try std.testing.expectEqual(started.peer, retry.peer);
        const later = pair.transport_a.engine.expire(retry_ms + 2_000, &expired);
        try std.testing.expectEqual(@as(usize, 1), later.calls);
        try std.testing.expectEqual(retry.call.handle, expired[0].handle);
    }
}

test "discovery ready steps expire calls with no eligible socket and preserve late arrivals" {
    var pair: Pair = undefined;
    try pair.init(std.testing.io, 1, true);
    defer pair.deinit();
    var output: [1280]u8 = undefined;
    const started = try pair.transport_a.engine.startCall(&output, endpoint(&pair.record_b), &pair.record_b, &.{ .ping = .{
        .request_id = try .init(&.{0x55}),
        .enr_sequence = pair.record_a.sequence,
    } }, 0, &test_support.sealEntropy(0x33));
    var faults: fault_io = .{ .receive = .{} };
    var eligible: [2]bool = @splat(false);
    var expired: [4]CallTable.Expired = undefined;
    const result = try pair.transport_a.advance(faults.io(), try Transport.monotonicMilliseconds(faults.io()), &expired, pair.transport_a.receive(faults.io(), &eligible));
    try std.testing.expect(result.failure == null);
    try std.testing.expectEqual(@as(usize, 1), result.calls_expired);
    try std.testing.expectEqual(started.handle, expired[0].handle);
    try std.testing.expectEqual(@as(usize, 0), faults.receive_calls);
    try pair.transport_b.sockets.sendTo(std.testing.io, pair.transport_a.localAddress(), &.{0xff}, 1280);
    const late = try pair.transport_a.advance(faults.io(), try Transport.monotonicMilliseconds(faults.io()), &expired, pair.transport_a.receive(faults.io(), &eligible));
    try std.testing.expect(late.datagram == .timeout and late.failure == null);
    try std.testing.expectEqual(@as(usize, 0), faults.receive_calls);
    try waitForDatagram(pair.transport_a.sockets.primary());
    eligible = .{ true, false };
    const next = try pair.transport_a.advance(std.testing.io, try Transport.monotonicMilliseconds(std.testing.io), &expired, pair.transport_a.receive(std.testing.io, &eligible));
    try std.testing.expect(next.datagram == .rejected and next.failure == null);
    try std.testing.expectEqual(@as(usize, 0), next.calls_expired);
}

test "discovery ready steps retain one family mask through the drain" {
    const key = try keyPair(0x66);
    var sockets = try Sockets.bind(std.testing.io, .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } });
    var owned = true;
    defer if (owned) sockets.close(std.testing.io);
    const record = try enr.Record.create(&key, 1, sockets.localAddress());
    var transport: Transport = undefined;
    try transport.init(std.testing.allocator, sockets, key, record, .{});
    owned = false;
    defer transport.deinit(std.testing.allocator, std.testing.io);
    const addresses = transport.sockets.localAddresses();
    for (addresses, transport.sockets.values) |address, socket| {
        try transport.sockets.sendTo(std.testing.io, address.?, &.{0xff}, 1280);
        try waitForDatagram(socket.?);
    }
    var faults: fault_io = .{ .receive = .{ .socket = transport.sockets.values[1].?.handle } };
    var eligible: [2]bool = .{ true, false };
    var expired: [4]CallTable.Expired = undefined;
    const first = try transport.advance(faults.io(), try Transport.monotonicMilliseconds(faults.io()), &expired, transport.receive(faults.io(), &eligible));
    try std.testing.expect(first.datagram == .rejected and first.failure == null);
    const empty = try transport.advance(faults.io(), try Transport.monotonicMilliseconds(faults.io()), &expired, transport.receive(faults.io(), &eligible));
    try std.testing.expect(empty.datagram == .timeout and empty.failure == null);
    try std.testing.expectEqual([2]bool{ false, false }, eligible);
    const reads = faults.receive_calls;
    _ = try transport.advance(faults.io(), try Transport.monotonicMilliseconds(faults.io()), &expired, transport.receive(faults.io(), &eligible));
    try std.testing.expectEqual(reads, faults.receive_calls);
    eligible = .{ false, true };
    const next = try transport.advance(std.testing.io, try Transport.monotonicMilliseconds(std.testing.io), &expired, transport.receive(std.testing.io, &eligible));
    try std.testing.expect(next.datagram == .rejected and next.failure == null);
}
