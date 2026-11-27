const schedule_test_support = @import("schedule_test_support.zig");
const Router = @import("router.zig").Router;
const std = @import("std");
const support = @import("quic/test_support.zig");
const Engine = @import("quic/Engine.zig");
const rr = @import("reqresp/root.zig");
const multistream = @import("wire/multistream.zig");
const types = @import("types.zig");
const protocol = @import("gossipsub/protocol.zig");
const binding = @import("quic/binding.zig");
const protocols_test_support = @import("protocols_test_support.zig");
const negotiate = @import("negotiate.zig");

test "router selects typed outbound protocol independently of offer indexes" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var client = try Router.init(std.testing.allocator, .{});
    defer client.deinit();
    var server = try Router.init(std.testing.allocator, .{});
    defer server.deinit();
    const stream = try client.beginOutbound(&pair.client, handles.client, .{ .reqresp = .ping_v1 }, pair.now);
    var accepted = false;
    for (0..16) |_| {
        var out: [16]Router.Outcome = undefined;
        const count = pumpRouter(&client, &pair, &pair.client, pair.now, &out);
        for (out[0..count]) |outcome| {
            try std.testing.expectEqual(stream, outcome.stream);
            try std.testing.expectEqual(types.Direction.outbound, outcome.direction);
            try std.testing.expectEqual(rr.Protocol.ping_v1, outcome.protocol.?.reqresp);
            try std.testing.expectEqual(rr.Protocol.ping_v1, outcome.result.ready.protocol.reqresp);
            accepted = true;
        }
        try pair.pump();
        var events: [16]Engine.Event = undefined;
        server.transportEvents(&pair.server, pair.events(&pair.server, &events), pair.now);
        _ = pumpRouter(&server, &pair, &pair.server, pair.now, &out);
        try pair.pump();
    }
    try std.testing.expect(accepted);
}

test "router rejects unknown protocol and preserves one-byte fragmented handoff" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var router = try Router.init(std.testing.allocator, .{});
    defer router.deinit();
    const stream = try pair.client.openStream(handles.client);
    var hello: [256]u8 = undefined;
    const header = try multistream.encodeMessage(multistream.header, &hello);
    const missing = try multistream.encodeMessage("/unknown/1.0.0", hello[header.len..]);
    const ping = try multistream.encodeMessage(rr.Protocol.ping_v1.id(), hello[header.len + missing.len ..]);
    const length = header.len + missing.len + ping.len;
    hello[length] = 42;
    var accepted = false;
    var inbound: Engine.StreamHandle = undefined;
    for (hello[0 .. length + 1], 0..) |_, index| {
        try std.testing.expectEqual(@as(usize, 1), try pair.client.write(stream, hello[index..][0..1], index == length));
        try pair.pump();
        var events: [16]Engine.Event = undefined;
        router.transportEvents(&pair.server, pair.events(&pair.server, &events), pair.now);
        var out: [16]Router.Outcome = undefined;
        const count = pumpRouter(&router, &pair, &pair.server, pair.now, &out);
        for (out[0..count]) |outcome| {
            try std.testing.expectEqual(rr.Protocol.ping_v1, outcome.result.ready.protocol.reqresp);
            accepted = true;
            inbound = outcome.stream;
        }
        try pair.pump();
    }
    try std.testing.expect(accepted);
    var response: [256]u8 = undefined;
    const read = try pair.client.read(stream, &response);
    const got_header = (try multistream.decodeMessage(response[0..read.len])).?;
    try std.testing.expectEqualStrings(multistream.header, got_header.token);
    const rejected = (try multistream.decodeMessage(response[got_header.consumed..read.len])).?;
    try std.testing.expectEqualStrings("na", rejected.token);
    const selected = (try multistream.decodeMessage(response[got_header.consumed + rejected.consumed .. read.len])).?;
    try std.testing.expectEqualStrings(rr.Protocol.ping_v1.id(), selected.token);
    const payload = try pair.server.read(inbound, &response);
    try std.testing.expectEqual(@as(usize, 1), payload.len);
    try std.testing.expectEqual(@as(u8, 42), response[0]);
    try std.testing.expect(payload.fin);
}

test "router wakeups separate negotiation work from outcome capacity" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var router = try Router.init(std.testing.allocator, .{});
    defer router.deinit();
    const stream = try router.beginOutbound(&pair.client, handles.client, .{ .reqresp = .ping_v1 }, pair.now);
    try std.testing.expectEqual(@as(?u64, pair.now.millis()), schedule_test_support.wakeupMilliseconds(router.schedule(0), pair.now.millis()));
    _ = pumpRouter(&router, &pair, &pair.client, pair.now, &.{});
    try std.testing.expectEqual(@as(?u64, pair.now.millis() + 10_000), schedule_test_support.wakeupMilliseconds(router.schedule(0), pair.now.millis()));
    pair.advance(10_000);
    _ = pumpRouter(&router, &pair, &pair.client, pair.now, &.{});
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(router.schedule(0), pair.now.millis()));
    try std.testing.expectEqual(@as(?u64, pair.now.millis()), schedule_test_support.wakeupMilliseconds(router.schedule(1), pair.now.millis()));
    try std.testing.expect(!pair.client.registry.slots[stream.conn.index].table.matches(stream.slot, stream.id));
    router.cancel(&pair.client, stream);
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(router.schedule(1), pair.now.millis()));
}

test "router accepted selection survives capability changes behind outcome pressure" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var client = try Router.init(std.testing.allocator, .{});
    defer client.deinit();
    var server = try Router.init(std.testing.allocator, .{});
    defer server.deinit();
    _ = try client.beginOutbound(&pair.client, handles.client, .{ .reqresp = .ping_v1 }, pair.now);
    for (0..16) |_| {
        _ = pumpRouter(&client, &pair, &pair.client, pair.now, &.{});
        try pair.pump();
        var events: [16]Engine.Event = undefined;
        server.transportEvents(&pair.server, pair.events(&pair.server, &events), pair.now);
        _ = pumpRouter(&server, &pair, &pair.server, pair.now, &.{});
        try pair.pump();
    }
    client.setCapabilities(.{ .receive = .initEmpty(), .request = .initEmpty() });
    server.setCapabilities(.{ .receive = .initEmpty(), .request = .initEmpty() });
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(client.schedule(0), pair.now.millis()));
    try std.testing.expectEqual(@as(?u64, pair.now.millis()), schedule_test_support.wakeupMilliseconds(client.schedule(1), pair.now.millis()));
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(server.schedule(0), pair.now.millis()));
    try std.testing.expectEqual(@as(?u64, pair.now.millis()), schedule_test_support.wakeupMilliseconds(server.schedule(1), pair.now.millis()));
    var out: [1]Router.Outcome = undefined;
    try std.testing.expectEqual(@as(usize, 1), pumpRouter(&client, &pair, &pair.client, pair.now, &out));
    try std.testing.expect(out[0].result == .ready);
    try std.testing.expectEqual(rr.Protocol.ping_v1, out[0].result.ready.protocol.reqresp);
    client.cancel(&pair.client, out[0].stream);
    try std.testing.expectEqual(@as(usize, 1), pumpRouter(&server, &pair, &pair.server, pair.now, &out));
    try std.testing.expect(out[0].result == .ready);
    try std.testing.expectEqual(rr.Protocol.ping_v1, out[0].result.ready.protocol.reqresp);
    server.cancel(&pair.server, out[0].stream);
}

test "router capabilities validate protocol limits and preserve configured preference" {
    const caps = @import("capabilities.zig");
    var active: caps.Directional = .{ .receive = .initEmpty(), .request = .initEmpty() };
    active.receive.insert(.{ .reqresp = .ping_v1 });
    active.request.insert(.{ .meshsub = .v1_0 });
    active.request.insert(.{ .meshsub = .v1_2 });
    var versions = [_]protocol.Version{ .v1_0, .v1_2 };
    var router = try Router.init(std.testing.allocator, .{ .capabilities = active, .meshsub_versions = &versions });
    defer router.deinit();
    versions[0] = .v1_1;
    try std.testing.expectEqualDeep(active, router.capabilities());
    try std.testing.expectEqualStrings("/meshsub/1.0.0", router.meshsub_candidates[0].id);
    try std.testing.expectEqualStrings("/meshsub/1.2.0", router.meshsub_candidates[1].id);
    try std.testing.expectEqual(1, router.supported_count);
    try std.testing.expectEqualStrings(rr.Protocol.ping_v1.id(), router.supported[0].id);
    var invalid = active;
    invalid.receive.insert(.{ .meshsub = .v1_1 });
    try std.testing.expectError(error.InvalidCapabilities, router.validateCapabilities(invalid));
    try std.testing.expectEqualDeep(active, router.capabilities());
    active.receive = .initEmpty();
    active.request = .initEmpty();
    try router.validateCapabilities(active);
    router.setCapabilities(active);
    try std.testing.expectEqual(0, router.supported_count);
    try std.testing.expectEqual(0, router.meshsub_count);
    try std.testing.expect(Router.Protocol.fromId(rr.Protocol.ping_v1.id()) != null);
}

test "router capabilities changes apply before inbound protocol selection" {
    const caps = @import("capabilities.zig");
    for ([_]bool{ false, true }) |enable| {
        var pair: support.Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        const handles = try support.connectPair(&pair);
        var active: caps.Directional = .{ .receive = .initEmpty(), .request = .initEmpty() };
        if (!enable) active.receive.insert(.{ .reqresp = .ping_v1 });
        var server = try Router.init(std.testing.allocator, .{ .capabilities = active });
        defer server.deinit();
        const stream = try pair.client.openStream(handles.client);
        var bytes: [256]u8 = undefined;
        const header = try multistream.encodeMessage(multistream.header, &bytes);
        try std.testing.expectEqual(header.len, try pair.client.write(stream, header, false));
        try pair.pump();
        var events: [16]Engine.Event = undefined;
        server.transportEvents(&pair.server, pair.events(&pair.server, &events), pair.now);
        _ = pumpRouter(&server, &pair, &pair.server, pair.now, &.{});
        _ = pumpRouter(&server, &pair, &pair.server, pair.now, &.{});
        try pair.pump();
        const greeting = try pair.client.read(stream, &bytes);
        const reply_header = (try multistream.decodeMessage(bytes[0..greeting.len])).?;
        try std.testing.expectEqualStrings(multistream.header, reply_header.token);
        try std.testing.expectEqual(greeting.len, reply_header.consumed);

        active.receive = .initEmpty();
        if (enable) active.receive.insert(.{ .reqresp = .ping_v1 });
        server.setCapabilities(active);
        const proposal = try multistream.encodeMessage(rr.Protocol.ping_v1.id(), &bytes);
        try std.testing.expectEqual(proposal.len, try pair.client.write(stream, proposal, false));
        try pair.pump();
        var out: [1]Router.Outcome = undefined;
        const count = pumpRouter(&server, &pair, &pair.server, pair.now, &out);
        try std.testing.expectEqual(@as(usize, if (enable) 1 else 0), count);
        if (enable) {
            try std.testing.expect(out[0].result == .ready);
            try std.testing.expectEqual(rr.Protocol.ping_v1, out[0].result.ready.protocol.reqresp);
        }
        _ = pumpRouter(&server, &pair, &pair.server, pair.now, &.{});
        try pair.pump();
        const response = try pair.client.read(stream, &bytes);
        const reply = (try multistream.decodeMessage(bytes[0..response.len])).?;
        try std.testing.expectEqualStrings(if (enable) rr.Protocol.ping_v1.id() else multistream.na, reply.token);
        try std.testing.expectEqual(response.len, reply.consumed);
    }
}

test "router capabilities enable a fallback after rejecting an earlier proposal" {
    const caps = @import("capabilities.zig");
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var active: caps.Directional = .{ .receive = .initEmpty(), .request = .initEmpty() };
    active.receive.insert(.{ .reqresp = .ping_v1 });
    var server = try Router.init(std.testing.allocator, .{ .capabilities = active });
    defer server.deinit();
    const stream = try pair.client.openStream(handles.client);
    const dialer = try multistream.Dialer.init("/meshsub/1.2.0");
    var bytes: [256]u8 = undefined;
    const hello = try dialer.initialWrite(&bytes);
    try std.testing.expectEqual(hello.len, try pair.client.write(stream, hello, false));
    try pair.pump();
    var events: [16]Engine.Event = undefined;
    server.transportEvents(&pair.server, pair.events(&pair.server, &events), pair.now);
    var out: [1]Router.Outcome = undefined;
    try std.testing.expectEqual(0, pumpRouter(&server, &pair, &pair.server, pair.now, &out));
    try std.testing.expectEqual(0, pumpRouter(&server, &pair, &pair.server, pair.now, &out));
    try pair.pump();
    const rejected = try pair.client.read(stream, &bytes);
    const header = (try multistream.decodeMessage(bytes[0..rejected.len])).?;
    try std.testing.expectEqualStrings(multistream.header, header.token);
    const refusal = (try multistream.decodeMessage(bytes[header.consumed..rejected.len])).?;
    try std.testing.expectEqualStrings(multistream.na, refusal.token);
    try std.testing.expectEqual(rejected.len, header.consumed + refusal.consumed);

    active.receive = .initEmpty();
    active.receive.insert(.{ .meshsub = .v1_1 });
    server.setCapabilities(active);
    const fallback = try multistream.encodeMessage("/meshsub/1.1.0", &bytes);
    bytes[fallback.len] = 42;
    try std.testing.expectEqual(fallback.len + 1, try pair.client.write(stream, bytes[0 .. fallback.len + 1], true));
    try pair.pump();
    try std.testing.expectEqual(1, pumpRouter(&server, &pair, &pair.server, pair.now, &out));
    try std.testing.expect(out[0].result == .ready);
    try std.testing.expectEqual(protocol.Version.v1_1, out[0].result.ready.protocol.meshsub);
    try std.testing.expectEqualSlices(u8, &.{42}, out[0].result.ready.leftover);
    try std.testing.expect(out[0].result.ready.fin);
    try pair.pump();
    const accepted = try pair.client.read(stream, &bytes);
    const acknowledgement = (try multistream.decodeMessage(bytes[0..accepted.len])).?;
    try std.testing.expectEqualStrings("/meshsub/1.1.0", acknowledgement.token);
    try std.testing.expectEqual(accepted.len, acknowledgement.consumed);
}

test "router accepted selection survives capability changes while ACK is flow controlled" {
    const caps = @import("capabilities.zig");
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    binding.c.quiche_config_set_initial_max_stream_data_bidi_local(pair.client.config.ptr, 8);
    const handles = try support.connectPair(&pair);
    var active: caps.Directional = .{ .receive = .initEmpty(), .request = .initEmpty() };
    active.receive.insert(.{ .reqresp = .ping_v1 });
    var server = try Router.init(std.testing.allocator, .{ .capabilities = active });
    defer server.deinit();
    const stream = try pair.client.openStream(handles.client);
    const dialer = try multistream.Dialer.init(rr.Protocol.ping_v1.id());
    var bytes: [256]u8 = undefined;
    const hello = try dialer.initialWrite(&bytes);
    const payload = "tail";
    @memcpy(bytes[hello.len..][0..payload.len], payload);
    try std.testing.expectEqual(hello.len + payload.len, try pair.client.write(stream, bytes[0 .. hello.len + payload.len], true));
    try pair.pump();
    var event_storage: [16]Engine.Event = undefined;
    const events = pair.events(&pair.server, &event_storage);
    const inbound = try support.expectStreamOpened(events[0], handles.server);
    server.transportEvents(&pair.server, events, pair.now);
    var out: [1]Router.Outcome = undefined;
    try std.testing.expectEqual(0, pumpRouter(&server, &pair, &pair.server, pair.now, &out));
    try std.testing.expect(server.negotiator.entries[0].selected != null);
    try std.testing.expectEqual(0, try pair.server.streamCapacity(inbound));
    server.setCapabilities(.{ .receive = .initEmpty(), .request = .initEmpty() });

    var ack: [256]u8 = undefined;
    var ack_len: usize = 0;
    var ready = false;
    for (0..32) |_| {
        try pair.pump();
        const read = try pair.client.read(stream, ack[ack_len..]);
        ack_len += read.len;
        const count = pumpRouter(&server, &pair, &pair.server, pair.now, &out);
        if (count == 1) {
            try std.testing.expect(!ready);
            try std.testing.expect(out[0].result == .ready);
            try std.testing.expectEqual(rr.Protocol.ping_v1, out[0].result.ready.protocol.reqresp);
            try std.testing.expectEqualSlices(u8, payload, out[0].result.ready.leftover);
            try std.testing.expect(out[0].result.ready.fin);
            ready = true;
        }
        if (ready and ack_len == hello.len) break;
    }
    try std.testing.expect(ready);
    try std.testing.expectEqualSlices(u8, hello, ack[0..ack_len]);
}

fn pumpRouter(router: *Router, pair: *support.Pair, transport: *Engine, now: types.Now, outcomes: []Router.Outcome) usize {
    protocols_test_support.forward(pair, transport, .{ .negotiator = &router.negotiator });
    return router.pump(transport, now, outcomes);
}

test "router control capacity protects outbound negotiations from unknown inbound" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var options: Router.Options = .{ .negotiations_max = 4 };
    options.outbound_control_reserved = 2;
    var router = try Router.init(std.testing.allocator, options);
    defer router.deinit();
    const first = try router.beginOutbound(
        &pair.client,
        handles.client,
        .{ .reqresp = .blocks_by_root_v2 },
        pair.now,
    );
    defer router.cancel(&pair.client, first);
    const second = try router.beginMeshsub(&pair.client, handles.client, pair.now);
    defer router.cancel(&pair.client, second);
    try std.testing.expectError(
        error.NegotiationTableFull,
        router.beginMeshsub(&pair.client, handles.client, pair.now),
    );
    try std.testing.expectError(
        error.NegotiationTableFull,
        router.negotiator.acceptInbound(&pair.client, first, pair.now),
    );
    const ping = try router.beginOutbound(
        &pair.client,
        handles.client,
        .{ .reqresp = .ping_v1 },
        pair.now,
    );
    defer router.cancel(&pair.client, ping);
}

test "router control capacity counts pending and reported negotiations until recycle" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    const handles = try support.connectPair(&pair);
    var router = try Router.init(
        std.testing.allocator,
        .{ .negotiations_max = 2, .outbound_control_reserved = 1 },
    );
    defer router.deinit();
    _ = try router.beginMeshsub(&pair.client, handles.client, pair.now);
    pair.advance(10_000);
    try std.testing.expectEqual(0, router.pump(&pair.client, pair.now, &.{}));
    try std.testing.expectEqual(0, router.negotiator.active());
    try std.testing.expectError(
        error.NegotiationTableFull,
        router.beginMeshsub(&pair.client, handles.client, pair.now),
    );
    var output: [1]Router.Outcome = undefined;
    try std.testing.expectEqual(1, router.pump(&pair.client, pair.now, &output));
    try std.testing.expectEqual(
        negotiate.Negotiator.Failure.timeout,
        output[0].result.failed,
    );
    try std.testing.expectError(
        error.NegotiationTableFull,
        router.beginMeshsub(&pair.client, handles.client, pair.now),
    );
    const ping = try router.beginOutbound(
        &pair.client,
        handles.client,
        .{ .reqresp = .ping_v1 },
        pair.now,
    );
    defer router.cancel(&pair.client, ping);
    _ = router.pump(&pair.client, pair.now, &.{});
    const ordinary = try router.beginMeshsub(&pair.client, handles.client, pair.now);
    defer router.cancel(&pair.client, ordinary);
}

test "router preserves the request protocol on outbound rejection and timeout" {
    for ([_]rr.Protocol{ .status_v2, .blocks_by_root_v2 }) |which| {
        for ([_]bool{ false, true }) |timeout| {
            var pair: support.Pair = .{};
            try pair.init(.{}, .{});
            defer pair.deinit();
            const handles = try support.connectPair(&pair);
            var client = try Router.init(std.testing.allocator, .{});
            defer client.deinit();
            var server = try Router.init(std.testing.allocator, .{
                .capabilities = .{ .receive = .initEmpty(), .request = .initEmpty() },
            });
            defer server.deinit();
            const stream = try client.beginOutbound(&pair.client, handles.client, .{ .reqresp = which }, pair.now);
            if (timeout) pair.advance(10_000);
            var delivered = false;
            for (0..16) |_| {
                var out: [1]Router.Outcome = undefined;
                if (pumpRouter(&client, &pair, &pair.client, pair.now, &out) == 1) {
                    try std.testing.expectEqual(stream, out[0].stream);
                    try std.testing.expectEqual(which, out[0].protocol.?.reqresp);
                    if (timeout) {
                        try std.testing.expectEqual(negotiate.Negotiator.Failure.timeout, out[0].result.failed);
                    } else try std.testing.expect(out[0].result == .rejected);
                    delivered = true;
                    break;
                }
                try pair.pump();
                var events: [16]Engine.Event = undefined;
                server.transportEvents(&pair.server, pair.events(&pair.server, &events), pair.now);
                _ = pumpRouter(&server, &pair, &pair.server, pair.now, &out);
                try pair.pump();
            }
            try std.testing.expect(delivered);
        }
    }
}
