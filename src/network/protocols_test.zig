const schedule_test_support = @import("schedule_test_support.zig");
const gossip_test = @import("gossipsub/test_support.zig");
const std = @import("std");
const support = @import("quic/test_support.zig");
const Engine = @import("quic/Engine.zig");
const rr = @import("reqresp/root.zig");
const gs = @import("gossipsub/root.zig");
const topic_mod = @import("gossipsub/topic.zig");
const multistream = @import("wire/multistream.zig");
const protobuf = @import("gossipsub/protobuf.zig");
const protocols_mod = @import("protocols.zig");
const control_fixture = @import("reqresp/control_fixture.zig");
const policy_fixture = @import("reqresp/policy_fixture.zig");
const protocols_test_support = @import("protocols_test_support.zig");
const topic_fixture = @import("gossipsub/topic_fixture.zig");
const peer_id = @import("wire/peer_id.zig");
const ForkEntry = @import("types.zig").ForkEntry;
const ForkSeq = @import("config").ForkSeq;
const admission_fixture = @import("reqresp/admission_fixture.zig");

fn rrOptions() !protocols_mod.Protocols.Options {
    return .{ .gossipsub = .{ .random_seed = 1 }, .control_reqresp = try control_fixture.controlOptions(), .reqresp = .{
        .protocols = .application,
        .outbound_max = 4,
        .serving_max = 4,
        .inbound_per_connection_max = 4,
        .forks = &.{},
        .admission = try rr.ReqResp.Options.Admission.defaults(&policy_fixture.config(), 1),
    } };
}

test "protocol stack requires independent control peer quotas" {
    var options = try rrOptions();
    options.gossipsub.topic_policy = &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })};
    try protocols_mod.Protocols.validateOptions(options);
    options.control_reqresp.admission.scope = .address;
    try std.testing.expectError(error.InvalidOptions, protocols_mod.Protocols.validateOptions(options));
}

test "protocol stack composes simultaneous ping and meshsub on one connection" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    var client = try protocols_test_support.initProtocols(std.testing.allocator, try rrOptions(), &pair.client);
    defer client.deinit();
    var server = try protocols_test_support.initProtocols(std.testing.allocator, .{ .gossipsub = .{ .random_seed = 1, .topic_policy = &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })} }, .reqresp = (try rrOptions()).reqresp, .control_reqresp = (try rrOptions()).control_reqresp }, &pair.server);
    defer server.deinit();
    const requests = &server.control_reqresp;
    const gossip = server.gossipsub;
    const handles = try support.connectPair(&pair);
    _ = gossip.peerConnected(&pair.server, handles.server, false, pair.now);
    var topic_buf: [topic_mod.topic_max_len]u8 = undefined;
    const topic = topic_mod.build(.{ 1, 2, 3, 4 }, "beacon_block", &topic_buf);
    try gossip_test.subscribe(gossip, topic);
    const ping = [_]u8{ 42, 0, 0, 0, 0, 0, 0, 0 };
    var response: [8]u8 = undefined;
    _ = try client.control_reqresp.request(&pair.client, &client.router, handles.client, .ping_v1, &ping, &response, .{}, pair.now);
    const stream = try pair.client.openStream(handles.client);
    const dialer = try multistream.Dialer.init("/meshsub/1.2.0");
    var bytes: [512]u8 = undefined;
    const hello = try dialer.initialWrite(&bytes);
    var writer = protobuf.Writer.init(bytes[hello.len..]);
    writer.varint(protobuf.subscriptionSize(topic));
    protobuf.writeSubscription(&writer, true, topic);
    const len = hello.len + writer.len;
    try std.testing.expectEqual(len, try pair.client.write(stream, bytes[0..len], true));
    var pong = false;
    for (0..32) |_| {
        var transport_events: [16]Engine.Event = undefined;
        var request_events: [16]rr.ReqResp.Event = undefined;
        const client_count = client.process(&pair.client, pair.events(&pair.client, &transport_events), pair.now, .{ .control = &request_events }).control;
        for (request_events[0..client_count]) |event| switch (event) {
            .chunk => |chunk| {
                try std.testing.expectEqualSlices(u8, &ping, chunk.bytes);
                try std.testing.expect(client.control_reqresp.consume(&pair.client, &client.router, chunk.request, pair.now));
                pong = true;
            },
            else => {},
        };
        try pair.pump();
        const events = pair.events(&pair.server, &transport_events);
        const counts = server.process(&pair.server, events, pair.now, .{ .application = &.{}, .control = &request_events });
        try std.testing.expectEqual(0, counts.application);
        const request_count = counts.control;
        for (request_events[0..request_count]) |event| switch (event) {
            .request => |incoming| {
                try std.testing.expectEqual(rr.Protocol.ping_v1, incoming.protocol);
                try requests.respond(incoming.request, &ping, null, pair.now);
            },
            .chunk_sent => |sent| _ = requests.finish(sent.request, pair.now),
            else => {},
        };
        try pair.pump();
    }
    try std.testing.expect(pong);
}

test "protocol stack handles native stream events past empty request capacity" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    var client = try protocols_test_support.initProtocols(std.testing.allocator, .{ .gossipsub = .{ .random_seed = 1 }, .control_reqresp = try control_fixture.controlOptions(), .reqresp = .{
        .protocols = .application,
        .forks = &.{},
        .outbound_max = 64,
        .serving_max = 64,
        .work_per_pump_max = 1,
        .admission = try rr.ReqResp.Options.Admission.defaults(&policy_fixture.config(), 16),
    } }, &pair.client);
    defer client.deinit();
    defer client.control_reqresp.cancelAll(&pair.client, &client.router, pair.now);
    var server = try protocols_test_support.initProtocols(std.testing.allocator, try rrOptions(), &pair.server);
    defer server.deinit();
    defer server.control_reqresp.cancelAll(&pair.server, &server.router, pair.now);
    const handles = try support.connectPair(&pair);
    const ping = [_]u8{3} ** 8;
    var sink: [8]u8 = undefined;
    _ = try client.control_reqresp.request(&pair.client, &client.router, handles.client, .ping_v1, &ping, &sink, .{}, pair.now);
    var incoming: ?rr.ReqResp.RequestHandle = null;
    var transport: [16]Engine.Event = undefined;
    var requests: [8]rr.ReqResp.Event = undefined;
    for (0..64) |_| {
        try pair.pump();
        _ = client.process(&pair.client, pair.events(&pair.client, &transport), pair.now, .{ .control = &requests });
        const count = server.process(&pair.server, pair.events(&pair.server, &transport), pair.now, .{ .control = &requests }).control;
        for (requests[0..count]) |event| if (event == .request) {
            incoming = event.request.request;
        };
        if (incoming != null and schedule_test_support.wakeupMilliseconds(schedule_test_support.protocolsSchedule(&client, .{ .control = 1 }), pair.now.millis()) != pair.now.millis()) break;
    }
    try std.testing.expect(incoming != null);
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(schedule_test_support.protocolsSchedule(&client, .{ .control = 1 }), pair.now.millis()).? > pair.now.millis());
    var wire: [rr.codec.frame_scratch_max]u8 = undefined;
    const encoded = try rr.codec.encodeChunk(0, null, &ping, &wire);
    const stream = server.control_reqresp.inbound[incoming.?.index].request.stream;
    try std.testing.expectEqual(encoded.len, try pair.server.write(stream, encoded, false));
    try pair.pump();
    const polled = pair.events(&pair.client, &transport);
    try std.testing.expect(polled.len > 0);
    const counts = client.process(&pair.client, polled, pair.now, .{ .control = &requests });
    try std.testing.expectEqual(@as(usize, 1), counts.control);
    try std.testing.expectEqualSlices(u8, &ping, requests[0].chunk.bytes);
}

test "protocol stack pinned identity churn preserves gossip and reqresp admission" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    var client = try protocols_test_support.initProtocols(std.testing.allocator, try rrOptions(), &pair.client);
    defer client.deinit();
    defer client.control_reqresp.cancelAll(&pair.client, &client.router, pair.now);
    var server = try protocols_test_support.initProtocols(std.testing.allocator, .{ .gossipsub = .{ .random_seed = 1 }, .reqresp = (try rrOptions()).reqresp, .control_reqresp = (try rrOptions()).control_reqresp }, &pair.server);
    defer server.deinit();
    defer server.control_reqresp.cancelAll(&pair.server, &server.router, pair.now);
    const handles = try support.connectPair(&pair);
    const peers = @import("gossipsub/peer_book.zig");
    var retained: [peers.pinned_capacity]peers.Ref = undefined;
    for (0..server.gossipsub.peers.pin_limit) |i| {
        var metadata: peers.Metadata = .{ .identity = .{ .bytes = [_]u8{0} ** peer_id.length }, .address = .unspecified, .direction = .inbound };
        std.mem.writeInt(u16, metadata.identity.bytes[0..2], @intCast(i), .little);
        metadata.address = .{ .ip4 = .{ .octets = .{ 192, 0, @intCast(i / 16), @intCast(i % 16) }, .port = 1 } };
        const ref = server.gossipsub.peers.admit(.{ .index = 0, .generation = 1 }, &metadata, pair.now.millis()).admitted.peer;
        retained[i] = ref;
        try std.testing.expect(server.gossipsub.peers.retain(ref));
        server.gossipsub.peers.scores.penalize(ref.index, 20);
        server.gossipsub.peers.disconnect(ref, pair.now.millis());
    }
    try std.testing.expectEqual(gs.Gossipsub.ConnectionAdmission.admitted, server.gossipsub.peerConnected(&pair.server, handles.server, false, pair.now));
    try std.testing.expect(server.gossipsub.admitted(handles.server));
    const ping = [_]u8{7} ** 8;
    var sink: [8]u8 = undefined;
    _ = try client.control_reqresp.request(&pair.client, &client.router, handles.client, .ping_v1, &ping, &sink, .{}, pair.now);
    var pong = false;
    for (0..64) |_| {
        var transport: [16]Engine.Event = undefined;
        var requests: [16]rr.ReqResp.Event = undefined;
        try pair.pump();
        const count = client.process(&pair.client, pair.events(&pair.client, &transport), pair.now, .{ .control = &requests }).control;
        for (requests[0..count]) |event| if (event == .chunk) {
            try std.testing.expectEqualSlices(u8, &ping, event.chunk.bytes);
            try std.testing.expect(client.control_reqresp.consume(&pair.client, &client.router, event.chunk.request, pair.now));
            pong = true;
        };
        const counts = server.process(&pair.server, pair.events(&pair.server, &transport), pair.now, .{ .control = &requests });
        for (requests[0..counts.control]) |event| switch (event) {
            .request => |request| try server.control_reqresp.respond(request.request, &ping, null, pair.now),
            .chunk_sent => |sent| _ = server.control_reqresp.finish(sent.request, pair.now),
            else => {},
        };
        if (pong) break;
    }
    try std.testing.expect(pong);
    try std.testing.expect(server.gossipsub.admitted(handles.server));
    for (retained) |ref| server.gossipsub.peers.release(ref);
}

test "protocol stack capabilities disabled outbound preserves stream and request owners" {
    const caps = @import("capabilities.zig");
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var protocols = try protocols_test_support.initProtocols(std.testing.allocator, .{
        .reqresp = (try rrOptions()).reqresp,
        .control_reqresp = (try rrOptions()).control_reqresp,
        .gossipsub = .{ .random_seed = 1 },
        .router = .{ .capabilities = caps.Directional{ .receive = .initEmpty(), .request = .initEmpty() } },
    }, &pair.client);
    defer protocols.deinit();
    const before = pair.client.resourceSnapshot();
    const requests = protocols.control_reqresp.pendingCounts();
    const negotiations = protocols.router.negotiator.active();
    var sink: [8]u8 = undefined;
    try std.testing.expectError(error.ProtocolDisabled, protocols.control_reqresp.request(&pair.client, &protocols.router, handles.client, .ping_v1, &(@as([8]u8, @splat(0))), &sink, .{}, pair.now));
    try std.testing.expectError(error.ProtocolDisabled, protocols.router.beginOutbound(&pair.client, handles.client, .{ .reqresp = .status_v1 }, pair.now));
    try std.testing.expectError(error.ProtocolDisabled, protocols.router.beginMeshsub(&pair.client, handles.client, pair.now));
    try std.testing.expectEqualDeep(before, pair.client.resourceSnapshot());
    try std.testing.expectEqualDeep(requests, protocols.control_reqresp.pendingCounts());
    try std.testing.expectEqual(negotiations, protocols.router.negotiator.active());
}

test "protocol stack capabilities activation preserves negotiated response context and captured ceiling" {
    const harness = @import("protocols_reqresp_test_support.zig");
    const ct = @import("consensus_types");
    const context: ForkEntry = .{ .digest = .{ 9, 10, 11, 12 }, .fork = .phase0 };
    var setup: harness.Pair = .{};
    const limits = admission_fixture.quotas(2048, 1000);
    const options: harness.Overrides = .{
        .forks = &.{context},

        .admission = .{ .policy = policy_fixture.config(), .limits = .{ .source = limits, .global = limits } },
    };
    try setup.init(options, options);
    defer setup.deinit();
    const sink = try std.testing.allocator.alloc(u8, rr.Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    const bytes: [129 * 32]u8 = @splat(0);
    const payload: [ct.phase0.SignedBeaconBlock.min_size]u8 = @splat(0);
    const handle = try setup.shared.client.reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .blocks_by_root_v2, &bytes, sink, .{}, setup.shared.pair.now);
    var activated = false;
    var done = false;
    var served = false;
    var chunks: u32 = 0;
    for (0..64) |_| {
        try setup.pumpOnce();
        for (setup.serverEvents()) |event| switch (event) {
            .request => |incoming| {
                try setup.shared.server.reqresp.respond(incoming.request, &payload, context, setup.shared.pair.now);
                setup.shared.client.router.setCapabilities(.{ .receive = .initEmpty(), .request = .initEmpty() });
                setup.shared.server.router.setCapabilities(.{ .receive = .initEmpty(), .request = .initEmpty() });
                setup.shared.client.reqresp.setRequestFork(.fulu);
                setup.shared.server.reqresp.setRequestFork(.fulu);
                try std.testing.expectEqual(129, setup.shared.client.reqresp.outbound[handle.index].request.chunks_max);
                const owner = &setup.shared.server.reqresp.inbound[incoming.request.index];
                try std.testing.expectEqual(129, owner.request.chunks_max);
                try std.testing.expectEqual(ForkSeq.phase0, owner.request_fork);
                activated = true;
            },
            .chunk_sent => |sent| {
                if (sent.chunks == 1) {
                    try setup.shared.server.reqresp.respond(sent.request, &payload, context, setup.shared.pair.now);
                } else try std.testing.expect(setup.shared.server.reqresp.finish(sent.request, setup.shared.pair.now));
            },
            .served => served = true,
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
        for (setup.clientEvents()) |event| switch (event) {
            .chunk => |chunk| {
                try std.testing.expect(activated);
                try std.testing.expectEqual(@as(?ForkSeq, .phase0), chunk.fork);
                try std.testing.expectEqualSlices(u8, &payload, chunk.bytes);
                chunks += 1;
                try std.testing.expect(setup.shared.client.reqresp.consume(&setup.shared.pair.client, &setup.shared.client.router, chunk.request, setup.shared.pair.now));
            },
            .done => done = true,
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
        if (done and served) break;
    }
    try std.testing.expect(activated and done and served);
    try std.testing.expectEqual(2, chunks);
    try std.testing.expectError(error.ProtocolDisabled, setup.shared.client.reqresp.request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, .blocks_by_root_v2, &bytes, sink, .{}, setup.shared.pair.now));
}
