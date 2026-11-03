const topic_fixture = @import("../gossipsub/topic_fixture.zig");
const std = @import("std");
const schedule_test_support = @import("../schedule_test_support.zig");
const support = @import("../quic/test_support.zig");
const Engine = @import("../quic/Engine.zig");
const identify = @import("root.zig");
const fixtures = @import("test_support.zig");
const options = fixtures.protocolsOptions;
const step = fixtures.step;
const protocols_test_support = @import("../protocols_test_support.zig");
const binding = @import("../quic/binding.zig");

const Protocols = @import("../protocols.zig").Protocols;

test "identify protocol integration completes both directions with zero application output and retains pressured results" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var client = try protocols_test_support.initProtocols(std.testing.allocator, try options("client"), &pair.client);
    defer client.deinit();
    var server = try protocols_test_support.initProtocols(std.testing.allocator, try options("server"), &pair.server);
    defer server.deinit();
    try client.identify.start(&client.router, &pair.client, .{ .index = 0, .generation = 1 }, handles.client, pair.now);
    try server.identify.start(&server.router, &pair.server, .{ .index = 0, .generation = 1 }, handles.server, pair.now);
    try std.testing.expectError(error.PeerLimit, client.identify.start(&client.router, &pair.client, .{ .index = 0, .generation = 1 }, handles.client, pair.now));
    for (0..32) |_| {
        var events: [64]Engine.Event = undefined;
        _ = client.process(&pair.client, pair.events(&pair.client, &events), pair.now, .{});
        try pair.pump();
        _ = server.process(&pair.server, pair.events(&pair.server, &events), pair.now, .{});
        try pair.pump();
    }
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(client.identify.schedule(0), pair.now.millis()) == null);
    if (schedule_test_support.wakeupMilliseconds(schedule_test_support.protocolsSchedule(&client, .{}), pair.now.millis())) |due| try std.testing.expect(due > pair.now.millis());
    try std.testing.expectEqual(pair.now.millis(), schedule_test_support.wakeupMilliseconds(client.identify.schedule(1), pair.now.millis()).?);
    var results: [1]identify.Handler.Result = undefined;
    var counts = client.process(&pair.client, &.{}, pair.now, .{ .identify = &results });
    try std.testing.expectEqual(@as(usize, 1), counts.identify);
    try std.testing.expectEqual(.success, std.meta.activeTag(results[0].outcome));
    try std.testing.expectEqualStrings("server", results[0].outcome.success.agent.?.slice());
    counts = server.process(&pair.server, &.{}, pair.now, .{ .identify = &results });
    try std.testing.expectEqual(@as(usize, 1), counts.identify);
    try std.testing.expectEqualStrings("client", results[0].outcome.success.agent.?.slice());
    counts = client.process(&pair.client, &.{}, pair.now, .{ .identify = &results });
    try std.testing.expectEqual(@as(usize, 0), counts.identify);
    try client.identify.start(&client.router, &pair.client, .{ .index = 0, .generation = 1 }, handles.client, pair.now);
    client.identify.shutdown(&client.router, &pair.client);
    try std.testing.expectEqual(@as(usize, 1), client.identify.pump(&client.router, &pair.client, pair.now, &results));
    try std.testing.expectEqual(identify.Handler.Failure.shutdown, results[0].outcome.failed);
}

test "identify configured handler controls default and explicit directional capabilities" {
    var opts = try options("");
    opts.gossipsub.topic_policy = comptime &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })};
    var enabled = try Protocols.init(std.testing.allocator, opts, &try protocols_test_support.fixtureLocal(opts.identify));
    defer enabled.deinit();
    try std.testing.expect(enabled.router.capabilities().receive.contains(.identify));
    try std.testing.expect(enabled.router.capabilities().request.contains(.identify));
    const caps = @import("../capabilities.zig");
    const empty: caps.Directional = .{ .receive = .initEmpty(), .request = .initEmpty() };
    const both = caps.withIdentify(empty);
    try std.testing.expect(both.receive.contains(.identify) and both.request.contains(.identify));
    for ([_]caps.Directional{ empty, .{ .receive = both.receive, .request = empty.request }, .{ .receive = empty.receive, .request = both.request } }) |active| {
        opts.router.capabilities = active;
        var configured = try Protocols.init(std.testing.allocator, opts, &try protocols_test_support.fixtureLocal(opts.identify));
        defer configured.deinit();
        try std.testing.expectEqualDeep(active, configured.router.capabilities());
    }
}

test "identify saturation leaves reserved Ping negotiation usable" {
    const rr = @import("../reqresp/root.zig");
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var opts = try options("small");
    opts.router = .{ .negotiations_max = 2, .outbound_control_reserved = 1 };
    opts.reqresp.outbound_max = 2;
    opts.control_reqresp.outbound_max = 1;
    var client = try protocols_test_support.initProtocols(std.testing.allocator, opts, &pair.client);
    defer client.deinit();
    opts.router.negotiations_max = 4;
    var server = try protocols_test_support.initProtocols(std.testing.allocator, opts, &pair.server);
    defer server.deinit();
    try client.identify.start(&client.router, &pair.client, .{ .index = 0, .generation = 1 }, handles.client, pair.now);
    const ping = [_]u8{1} ++ [_]u8{0} ** 7;
    var sink: [8]u8 = undefined;
    _ = try client.control_reqresp.request(&pair.client, &client.router, handles.client, .ping_v1, &ping, &sink, .{}, pair.now);
    var received = false;
    for (0..32) |_| {
        var events: [64]Engine.Event = undefined;
        var requests: [4]rr.ReqResp.Event = undefined;
        const cc = client.process(&pair.client, pair.events(&pair.client, &events), pair.now, .{ .control = &requests });
        for (requests[0..cc.control]) |event| if (event == .chunk) {
            try std.testing.expectEqualSlices(u8, &ping, event.chunk.bytes);
            try std.testing.expect(client.control_reqresp.consume(&pair.client, &client.router, event.chunk.request, pair.now));
            received = true;
        };
        try pair.pump();
        const sc = server.process(&pair.server, pair.events(&pair.server, &events), pair.now, .{ .control = &requests });
        for (requests[0..sc.control]) |event| switch (event) {
            .request => |request| try server.control_reqresp.respond(request.request, &ping, null, pair.now),
            .chunk_sent => |sent| _ = server.control_reqresp.finish(sent.request, pair.now),
            else => {},
        };
        try pair.pump();
    }
    try std.testing.expect(received);
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(client.identify.schedule(0), pair.now.millis()) == null);
    try std.testing.expectEqual(pair.now.millis(), schedule_test_support.wakeupMilliseconds(client.identify.schedule(1), pair.now.millis()).?);
}

test "identify blocked responder finishes immutable advertisement while new requests observe updates" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    binding.c.quiche_config_set_initial_max_stream_data_bidi_local(pair.client.config.ptr, 96);
    const handles = try support.connectPair(&pair);
    var client = try protocols_test_support.initProtocols(std.testing.allocator, try options("client"), &pair.client);
    defer client.deinit();
    var server = try protocols_test_support.initProtocols(std.testing.allocator, try options("old"), &pair.server);
    defer server.deinit();
    try client.identify.start(&client.router, &pair.client, .{ .index = 0, .generation = 1 }, handles.client, pair.now);
    var blocked = false;
    for (0..16) |_| {
        _ = step(&pair, &client, false, &.{});
        try pair.pump();
        _ = step(&pair, &server, true, &.{});
        if (server.identify.inbound[0].stream != null) {
            blocked = true;
            break;
        }
        try pair.pump();
    }
    try std.testing.expect(blocked);
    const inbound = &server.identify.inbound[0];
    try std.testing.expect(inbound.outbox.offset > 0 and inbound.outbox.offset < inbound.outbox.bytes.len);
    var retained: [identify.codec.encoded_frame_max]u8 = undefined;
    const length = inbound.outbox.bytes.len;
    @memcpy(retained[0..length], inbound.outbox.bytes);
    const deadline = inbound.deadline;
    server.identify.local.agent = try .init("new");
    try server.identify.local.setAddresses(&.{.{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 19001 } }});
    var active = server.router.capabilities();
    active.receive = .initEmpty();
    active.receive.insert(.identify);
    try server.router.validateCapabilities(active);
    server.router.setCapabilities(active);
    try std.testing.expectEqualSlices(u8, retained[0..length], inbound.outbox.bytes);
    try std.testing.expectEqual(deadline, inbound.deadline);
    var results: [1]identify.Handler.Result = undefined;
    var completed = false;
    for (0..256) |_| {
        try pair.pump();
        if (step(&pair, &client, false, &results) == 1) {
            completed = true;
            break;
        }
        _ = step(&pair, &server, true, &.{});
    }
    try std.testing.expect(completed);
    try std.testing.expectEqual(.success, std.meta.activeTag(results[0].outcome));
    try std.testing.expectEqualStrings("old", results[0].outcome.success.agent.?.slice());
    try std.testing.expect(results[0].outcome.success.protocols.contains(.{ .reqresp = .ping_v1 }));
    try client.identify.start(&client.router, &pair.client, .{ .index = 0, .generation = 1 }, handles.client, pair.now);
    completed = false;
    for (0..256) |_| {
        try pair.pump();
        if (step(&pair, &client, false, &results) == 1) {
            completed = true;
            break;
        }
        _ = step(&pair, &server, true, &.{});
    }
    try std.testing.expect(completed);
    try std.testing.expectEqual(.success, std.meta.activeTag(results[0].outcome));
    try std.testing.expectEqualStrings("new", results[0].outcome.success.agent.?.slice());
    try std.testing.expectEqual(@as(u8, 1), results[0].outcome.success.protocols.count());
}
