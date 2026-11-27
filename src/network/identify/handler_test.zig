const std = @import("std");
const schedule_test_support = @import("../schedule_test_support.zig");
const support = @import("../quic/test_support.zig");
const Engine = @import("../quic/Engine.zig");
const identify = @import("root.zig");
const fixtures = @import("test_support.zig");
const options = fixtures.protocolsOptions;
const step = fixtures.step;
const protocols_test_support = @import("../protocols_test_support.zig");
const router_mod = @import("../router.zig");
const PeerRef = @import("../peers/types.zig").PeerRef;
const time = @import("../time.zig");
const binding = @import("../quic/binding.zig");

fn allocationCheck(allocator: std.mem.Allocator) !void {
    var handler = try identify.Handler.init(allocator, .{ .inbound_max = 2, .outbound_max = 3 }, &try protocols_test_support.fixtureLocal(.{}));
    defer handler.deinit();
    try std.testing.expectEqual(2 * @sizeOf(@TypeOf(handler.inbound[0])) + 3 * @sizeOf(@TypeOf(handler.outbound[0])), handler.allocatedBytes());
}

test "identify delivers retained completions before recycled lower slots" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    var router = try router_mod.Router.init(std.testing.allocator, .{});
    defer router.deinit();
    var handler = try identify.Handler.init(std.testing.allocator, .{ .outbound_max = 4 }, &try protocols_test_support.fixtureLocal(.{}));
    defer handler.deinit();
    const conn: Engine.Handle = .{ .index = 0, .generation = 1 };
    for (handler.outbound, 0..) |*slot, index| {
        const peer: PeerRef = .{ .index = @intCast(index), .generation = 1 };
        slot.* = .{ .stream = .{ .conn = conn, .id = index * 4, .slot = @intCast(index) }, .peer = peer, .phase = .terminal, .result = .{ .peer = peer, .conn = conn, .outcome = .{ .success = .{} } } };
    }
    try std.testing.expectEqual(@as(usize, 0), handler.pump(&router, &pair.client, pair.now, &.{}));
    var out: [1]identify.Handler.Result = undefined;
    for (0..4) |index| {
        try std.testing.expectEqual(@as(usize, 1), handler.pump(&router, &pair.client, pair.now, &out));
        try std.testing.expectEqual(index, out[0].peer.index);
        try std.testing.expectEqual(@as(u64, 1), out[0].peer.generation);
        if (index == 3) break;
        const peer: PeerRef = .{ .index = @intCast(index), .generation = 2 };
        handler.outbound[index] = .{ .stream = .{ .conn = conn, .id = (index + 4) * 4, .slot = @intCast(index) }, .peer = peer, .phase = .terminal, .result = .{ .peer = peer, .conn = conn, .outcome = .{ .failed = .timeout } } };
    }
    var remaining: [4]identify.Handler.Result = undefined;
    try std.testing.expectEqual(@as(usize, 3), handler.pump(&router, &pair.client, pair.now, &remaining));
    for (remaining[0..3]) |result| {
        try std.testing.expectEqual(@as(u64, 2), result.peer.generation);
        try std.testing.expectEqual(identify.Handler.Failure.timeout, result.outcome.failed);
    }
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(handler.schedule(1), pair.now.millis()) == null);
}

test "identify validates capacities and cleans every allocation prefix" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocationCheck, .{});
    for ([_]u16{ 0, 65 }) |invalid| {
        try std.testing.expectError(error.InvalidLimits, identify.Handler.init(std.testing.allocator, .{ .inbound_max = invalid }, &try protocols_test_support.fixtureLocal(.{})));
        try std.testing.expectError(error.InvalidLimits, identify.Handler.init(std.testing.allocator, .{ .outbound_max = invalid }, &try protocols_test_support.fixtureLocal(.{})));
    }
    var local = try protocols_test_support.fixtureLocal(.{ .agent = "a" });
    var handler = try identify.Handler.init(std.testing.allocator, .{ .inbound_max = 64, .outbound_max = 64 }, &local);
    defer handler.deinit();
    local.agent = try .init("b");
    local.address_count = 0;
    try std.testing.expectEqualStrings("a", handler.local.agent.slice());
    try std.testing.expectEqual(@as(u8, 1), handler.local.address_count);
}

test "identify deadline includes stalled negotiation and retained completion does not hot wake" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var client = try protocols_test_support.initProtocols(std.testing.allocator, try options("client"), &pair.client);
    defer client.deinit();
    const start = pair.now.millis();
    try client.identify.start(&client.router, &pair.client, .{ .index = 0, .generation = 1 }, handles.client, pair.now);
    pair.now.monotonic = time.milliseconds(start + 4999);
    var results: [1]identify.Handler.Result = undefined;
    try std.testing.expectEqual(@as(usize, 0), client.identify.pump(&client.router, &pair.client, pair.now, &results));
    try std.testing.expectEqual(start + 5000, schedule_test_support.wakeupMilliseconds(client.identify.schedule(1), pair.now.millis()).?);
    pair.now.monotonic = time.milliseconds(pair.now.millis() + 1);
    try std.testing.expectEqual(@as(usize, 0), client.identify.pump(&client.router, &pair.client, pair.now, &.{}));
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(client.identify.schedule(0), pair.now.millis()) == null);
    try std.testing.expectEqual(@as(usize, 1), client.identify.pump(&client.router, &pair.client, pair.now, &results));
    try std.testing.expectEqual(identify.Handler.Failure.timeout, results[0].outcome.failed);
    try std.testing.expectEqual(@as(usize, 0), client.identify.pump(&client.router, &pair.client, pair.now, &results));
    try client.identify.start(&client.router, &pair.client, .{ .index = 0, .generation = 1 }, handles.client, pair.now);
    _ = pair.client.close(handles.client, 0);
    var closed = false;
    for (0..16) |_| {
        var events: [64]Engine.Event = undefined;
        const count = client.process(&pair.client, pair.events(&pair.client, &events), pair.now, .{ .identify = &results }).identify;
        if (count != 0) {
            try std.testing.expectEqual(@as(usize, 1), count);
            // The negotiator sees the local close before the transport emits its closed event.
            try std.testing.expectEqual(identify.Handler.Failure.negotiation, results[0].outcome.failed);
            try std.testing.expectEqual(handles.client, results[0].conn);
            closed = true;
            break;
        }
        try pair.pump();
    }
    try std.testing.expect(closed);
    try pair.pump();
    try std.testing.expectEqual(@as(usize, 0), step(&pair, &client, false, &results));
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(client.router.schedule(1), pair.now.millis()) == null);
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(client.identify.schedule(1), pair.now.millis()) == null);
    client.identify.shutdown(&client.router, &pair.client);
    try std.testing.expectEqual(@as(usize, 0), client.identify.pump(&client.router, &pair.client, pair.now, &results));
}

test "identify inbound timeout closes only withheld writer and shutdown releases active owners" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    binding.c.quiche_config_set_initial_max_stream_data_bidi_local(pair.client.config.ptr, 96);
    const handles = try support.connectPair(&pair);
    var client = try protocols_test_support.initProtocols(std.testing.allocator, try options("client"), &pair.client);
    defer client.deinit();
    var server = try protocols_test_support.initProtocols(std.testing.allocator, try options("server"), &pair.server);
    defer server.deinit();
    try client.identify.start(&client.router, &pair.client, .{ .index = 0, .generation = 1 }, handles.client, pair.now);
    for (0..16) |_| {
        _ = step(&pair, &client, false, &.{});
        try pair.pump();
        _ = step(&pair, &server, true, &.{});
        if (server.identify.inbound[0].stream != null) break;
        try pair.pump();
    }
    const deadline = server.identify.inbound[0].deadline;
    try std.testing.expect(server.identify.inbound[0].stream != null);
    const retained = server.identify.inbound[0].stream.?;
    const duplicate = try client.router.beginOutbound(&pair.client, handles.client, .identify, pair.now);
    var refused = false;
    for (0..32) |_| {
        var outcomes: [8]router_mod.Router.Outcome = undefined;
        protocols_test_support.forward(&pair, &pair.client, .{ .negotiator = &client.router.negotiator });
        const count = client.router.pump(&pair.client, pair.now, &outcomes);
        for (outcomes[0..count]) |outcome| if (std.meta.eql(outcome.stream, duplicate)) {
            try std.testing.expectEqual(.stream_closed, outcome.result.failed);
            refused = true;
        };
        client.router.releaseOutcomes();
        try pair.pump();
        _ = step(&pair, &server, true, &.{});
        try pair.pump();
        var events: [64]Engine.Event = undefined;
        const received = pair.events(&pair.client, &events);
        (protocols_test_support.Owners{ .negotiator = &client.router.negotiator }).route(&pair.client, received);
        client.router.transportEvents(&pair.client, received, pair.now);
        try std.testing.expectEqual(retained, server.identify.inbound[0].stream.?);
        if (refused) break;
    }
    try std.testing.expect(refused);
    try std.testing.expectEqual(deadline, server.identify.inbound[0].deadline);
    pair.now.monotonic = time.milliseconds(deadline);
    _ = server.identify.pump(&server.router, &pair.server, pair.now, &.{});
    try std.testing.expect(server.identify.inbound[0].stream == null);
    try std.testing.expect(pair.server.peerId(handles.server) != null);
    client.identify.shutdown(&client.router, &pair.client);
    var results: [1]identify.Handler.Result = undefined;
    try std.testing.expectEqual(@as(usize, 1), client.identify.pump(&client.router, &pair.client, pair.now, &results));
    try std.testing.expectEqual(identify.Handler.Failure.shutdown, results[0].outcome.failed);
}

test "identify remote reset and transport close retain one failed result without metadata" {
    for ([_]bool{ false, true }) |close_connection| {
        var pair: support.Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        binding.c.quiche_config_set_initial_max_stream_data_bidi_local(pair.client.config.ptr, 96);
        const handles = try support.connectPair(&pair);
        var client = try protocols_test_support.initProtocols(std.testing.allocator, try options("client"), &pair.client);
        defer client.deinit();
        var server = try protocols_test_support.initProtocols(std.testing.allocator, try options("server"), &pair.server);
        defer server.deinit();
        try client.identify.start(&client.router, &pair.client, .{ .index = 0, .generation = 1 }, handles.client, pair.now);
        for (0..16) |_| {
            _ = step(&pair, &client, false, &.{});
            try pair.pump();
            _ = step(&pair, &server, true, &.{});
            if (server.identify.inbound[0].stream != null) break;
            try pair.pump();
        }
        const stream = server.identify.inbound[0].stream.?;
        try pair.pump();
        _ = step(&pair, &client, false, &.{});
        try std.testing.expectEqual(.reading, client.identify.outbound[0].phase);
        if (close_connection) {
            _ = pair.server.close(handles.server, 42);
        } else pair.server.closeStream(stream, 42);
        var results: [1]identify.Handler.Result = undefined;
        var completed = false;
        for (0..32) |_| {
            try pair.pump();
            if (step(&pair, &client, false, &results) == 1) {
                completed = true;
                break;
            }
            _ = step(&pair, &server, true, &.{});
        }
        try std.testing.expect(completed);
        try std.testing.expectEqual(.failed, std.meta.activeTag(results[0].outcome));
        try std.testing.expectEqual(if (close_connection) identify.Handler.Failure.transport else identify.Handler.Failure.reset, results[0].outcome.failed);
        try std.testing.expectEqual(@as(usize, 0), step(&pair, &client, false, &results));
        if (!close_connection) try std.testing.expect(pair.client.peerId(handles.client) != null);
    }
}
