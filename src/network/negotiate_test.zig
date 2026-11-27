const schedule_test_support = @import("schedule_test_support.zig");
const protocols_test = @import("protocols_test_support.zig");
const std = @import("std");
const constants = @import("constants.zig");
const Engine = @import("quic/Engine.zig");
const multistream = @import("wire/multistream.zig");
const Negotiator = @import("negotiate.zig").Negotiator;
const support = @import("quic/test_support.zig");
const types = @import("types.zig");
const time = @import("time.zig");

const Pair = support.Pair;
const Outcome = Negotiator.Outcome;
const connectPair = support.connectPair;

const ping = "/ipfs/ping/1.0.0";
const ping_protocol = Negotiator.Protocol{ .id = ping, .index = 7 };
const other_protocol = Negotiator.Protocol{ .id = "/other/1.0.0", .index = 29 };
const supported = [_]Negotiator.Protocol{ ping_protocol, other_protocol };

const Setup = struct {
    pair: Pair = .{},
    dialer: Negotiator = undefined,
    listener: Negotiator = undefined,
    handles: struct { client: Engine.Handle, server: Engine.Handle } = undefined,

    fn init(self: *Setup, negotiations_max: u16) !void {
        try self.pair.init(.{}, .{});
        errdefer self.pair.deinit();
        self.dialer = try Negotiator.init(std.testing.allocator, .{ .negotiations_max = negotiations_max });
        errdefer self.dialer.deinit();
        self.listener = try Negotiator.init(std.testing.allocator, .{ .negotiations_max = negotiations_max });
        const handles = try connectPair(&self.pair);
        self.handles = .{ .client = handles.client, .server = handles.server };
    }

    fn deinit(self: *Setup) void {
        self.listener.deinit();
        self.dialer.deinit();
        self.pair.deinit();
    }

    /// Delivers one side's engine events: stream events to its negotiator by route and, on the
    /// listener, new streams to acceptInbound.
    fn deliver(self: *Setup, engine: *Engine, negotiator: *Negotiator) !void {
        var storage: [64]Engine.Event = undefined;
        const events = self.pair.events(engine, &storage);
        for (events) |event| {
            if (event == .stream_opened and negotiator == &self.listener) try negotiator.acceptInbound(engine, event.stream_opened, self.pair.now);
            if (event == .closed) negotiator.connectionClosed(engine, event.closed.conn);
        }
        (protocols_test.Owners{ .negotiator = negotiator }).route(engine, events);
    }

    fn pumpDialer(self: *Setup, protocols: []const Negotiator.Protocol, outcomes: []Outcome) usize {
        self.deliver(&self.pair.client, &self.dialer) catch unreachable;
        return self.dialer.pump(&self.pair.client, self.pair.now, protocols, outcomes);
    }

    fn pumpListener(self: *Setup, protocols: []const Negotiator.Protocol, outcomes: []Outcome) usize {
        self.deliver(&self.pair.server, &self.listener) catch unreachable;
        return self.listener.pump(&self.pair.server, self.pair.now, protocols, outcomes);
    }

    fn acceptOpened(self: *Setup) !void {
        try self.deliver(&self.pair.server, &self.listener);
    }

    fn run(self: *Setup, rounds_max: usize) !struct { dialer: ?Outcome, listener: ?Outcome } {
        var dialer_outcome: ?Outcome = null;
        var listener_outcome: ?Outcome = null;
        var rounds: usize = 0;
        while (rounds < rounds_max and (dialer_outcome == null or listener_outcome == null)) : (rounds += 1) {
            var outcomes: [4]Outcome = undefined;
            const dialed = self.pumpDialer(&supported, &outcomes);
            if (dialed > 0) dialer_outcome = outcomes[0];
            try self.pair.pump();
            const listened = self.pumpListener(&supported, &outcomes);
            if (listened > 0) listener_outcome = outcomes[0];
            try self.pair.pump();
        }
        return .{ .dialer = dialer_outcome, .listener = listener_outcome };
    }
};

test "negotiator selects a shared protocol on both sides and hands over usable streams" {
    var setup: Setup = .{};
    try setup.init(4);
    defer setup.deinit();

    const stream = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{});
    try std.testing.expectEqual(@as(usize, 1), setup.dialer.active());
    const outcomes = try setup.run(16);
    const accepted = outcomes.dialer orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(stream, accepted.stream);
    try std.testing.expectEqual(@as(?u8, ping_protocol.index), accepted.protocol_index);
    try std.testing.expectEqual(@as(usize, 0), accepted.result.ready.leftover.len);
    const selected = outcomes.listener orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(?u8, ping_protocol.index), selected.protocol_index);
    try std.testing.expectEqual(@as(usize, 0), selected.result.ready.leftover.len);

    try std.testing.expectEqual(@as(usize, 2), try setup.pair.client.write(stream, "hi", false));
    try setup.pair.pump();
    var buffer: [8]u8 = undefined;
    const read = try setup.pair.server.read(selected.stream, &buffer);
    try std.testing.expectEqualStrings("hi", buffer[0..read.len]);

    var storage: [4]Outcome = undefined;
    try std.testing.expectEqual(@as(usize, 0), setup.pumpDialer(&supported, &storage));
    try std.testing.expectEqual(@as(usize, 0), setup.dialer.active());
    try std.testing.expectEqual(@as(usize, 0), setup.listener.active());
}

test "negotiator reports rejection to the dialer and a closed stream to the listener" {
    var setup: Setup = .{};
    try setup.init(4);
    defer setup.deinit();

    _ = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{.{ .id = "/missing/1.0.0", .index = 81 }}, setup.pair.now, .{});
    const outcomes = try setup.run(16);
    const rejected = outcomes.dialer orelse return error.TestUnexpectedResult;
    try std.testing.expect(rejected.result == .rejected);
    try std.testing.expectEqual(@as(?u8, 81), rejected.protocol_index);
    const closed = outcomes.listener orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(Negotiator.Failure.stream_closed, closed.result.failed);
    try std.testing.expectEqual(@as(?u8, null), closed.protocol_index);
}

test "negotiator fails a listener fed with garbage" {
    var setup: Setup = .{};
    try setup.init(4);
    defer setup.deinit();

    const stream = try setup.pair.client.openStream(setup.handles.client);
    const garbage = [_]u8{ 3, 'a', 'b', 'c' };
    try std.testing.expectEqual(garbage.len, try setup.pair.client.write(stream, &garbage, false));
    const outcomes = try setup.run(8);
    try std.testing.expect(outcomes.dialer == null);
    const failed = outcomes.listener orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(Negotiator.Failure.malformed, failed.result.failed);
}

test "negotiator expires a stalled negotiation" {
    var setup: Setup = .{};
    try setup.init(4);
    defer setup.deinit();

    const stream = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{});
    setup.pair.advance(Negotiator.negotiate_timeout_ms);
    var outcomes: [4]Outcome = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.pumpDialer(&supported, &outcomes));
    try std.testing.expectEqual(stream, outcomes[0].stream);
    try std.testing.expectEqual(Negotiator.Failure.timeout, outcomes[0].result.failed);
    try std.testing.expectEqual(@as(?u8, ping_protocol.index), outcomes[0].protocol_index);
    try std.testing.expectEqual(@as(usize, 0), setup.pumpDialer(&supported, &outcomes));
    try std.testing.expectEqual(@as(usize, 0), setup.dialer.active());
}

test "negotiator delivers payload bytes that arrive with the proposal as leftover" {
    var setup: Setup = .{};
    try setup.init(4);
    defer setup.deinit();

    const stream = try setup.pair.client.openStream(setup.handles.client);
    var dialer = try multistream.Dialer.init(ping);
    var hello: [2 * multistream.message_length_max + 8]u8 = undefined;
    const prefix = try dialer.initialWrite(&hello);
    @memcpy(hello[prefix.len..][0..5], "ping!");
    const message = hello[0 .. prefix.len + 5];
    try std.testing.expectEqual(message.len, try setup.pair.client.write(stream, message, true));
    const outcomes = try setup.run(8);
    const selected = outcomes.listener orelse return error.TestUnexpectedResult;
    try std.testing.expectEqualStrings("ping!", selected.result.ready.leftover);
    try std.testing.expect(selected.result.ready.fin);
}

test "negotiator refuses to track more negotiations than its table holds" {
    var setup: Setup = .{};
    try setup.init(2);
    defer setup.deinit();

    _ = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{});
    _ = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{});
    try std.testing.expectError(
        error.NegotiationTableFull,
        setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{}),
    );
    try std.testing.expectEqual(@as(usize, 2), setup.dialer.active());
    try std.testing.expectError(error.InvalidLimits, Negotiator.init(std.testing.allocator, .{ .negotiations_max = 0 }));
}

test "negotiator copies outbound preference and falls back on the same stream to meshsub v1.1" {
    var setup: Setup = .{};
    try setup.init(4);
    defer setup.deinit();
    var offered = [_]Negotiator.Protocol{
        .{ .id = "/meshsub/1.2.0", .index = 42 },
        .{ .id = "/meshsub/1.1.0", .index = 17 },
    };
    const stream = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &offered, setup.pair.now, .{});
    offered = .{ ping_protocol, other_protocol };
    var accepted = false;
    var selected = false;
    for (0..16) |_| {
        var out: [4]Outcome = undefined;
        const count = setup.pumpDialer(&supported, &out);
        for (out[0..count]) |result| {
            try std.testing.expect(result.result == .ready);
            try std.testing.expectEqual(stream, result.stream);
            try std.testing.expectEqual(@as(?u8, 17), result.protocol_index);
            accepted = true;
        }
        try setup.pair.pump();
        try setup.acceptOpened();
        const listened = setup.pumpListener(&.{.{ .id = "/meshsub/1.1.0", .index = 99 }}, &out);
        for (out[0..listened]) |result| {
            try std.testing.expect(result.result == .ready);
            try std.testing.expectEqual(@as(?u8, 99), result.protocol_index);
            selected = true;
        }
        try setup.pair.pump();
    }
    try std.testing.expect(accepted);
    try std.testing.expect(selected);
}

test "negotiator sends four outbound proposals in preference order" {
    var setup: Setup = .{};
    try setup.init(1);
    defer setup.deinit();
    const offered = [_]Negotiator.Protocol{
        .{ .id = "/first/1.0.0", .index = 83 },
        .{ .id = "/second/1.0.0", .index = 41 },
        .{ .id = "/third/1.0.0", .index = 9 },
        .{ .id = "/last/1.0.0", .index = 255 },
    };
    const too_many = offered ++ .{ping_protocol};
    try std.testing.expectError(error.InvalidLimits, setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{}, setup.pair.now, .{}));
    try std.testing.expectError(error.InvalidLimits, setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &too_many, setup.pair.now, .{}));
    try std.testing.expectEqual(@as(usize, 0), setup.dialer.active());
    const stream = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &offered, setup.pair.now, .{});
    try std.testing.expectEqual(@as(u64, 0), stream.id);
    var inbound: Engine.StreamHandle = undefined;
    var outcomes: [1]Outcome = undefined;
    for (offered, 0..) |protocol, index| {
        try std.testing.expectEqual(@as(usize, 0), setup.pumpDialer(&.{}, &outcomes));
        try setup.pair.pump();
        if (index == 0) {
            var events: [8]Engine.Event = undefined;
            inbound = try support.expectStreamOpened(setup.pair.events(&setup.pair.server, &events)[0], setup.handles.server);
        }
        var request: [256]u8 = undefined;
        const read = try setup.pair.server.read(inbound, &request);
        var offset: usize = 0;
        if (index == 0) {
            const header = (try multistream.decodeMessage(request[0..read.len])).?;
            try std.testing.expectEqualStrings(multistream.header, header.token);
            offset = header.consumed;
        }
        const proposal = (try multistream.decodeMessage(request[offset..read.len])).?;
        try std.testing.expectEqualStrings(protocol.id, proposal.token);
        try std.testing.expectEqual(read.len, offset + proposal.consumed);
        const last = index == offered.len - 1;
        var reply: [256]u8 = undefined;
        offset = if (index == 0) (try multistream.encodeMessage(multistream.header, &reply)).len else 0;
        offset += (try multistream.encodeMessage(if (last) protocol.id else multistream.na, reply[offset..])).len;
        try std.testing.expectEqual(offset, try setup.pair.server.write(inbound, reply[0..offset], false));
        try setup.pair.pump();
        try std.testing.expectEqual(@as(usize, if (last) 1 else 0), setup.pumpDialer(&.{}, &outcomes));
    }
    try std.testing.expectEqual(@as(?u8, 255), outcomes[0].protocol_index);
    try std.testing.expect(outcomes[0].result == .ready);
    try std.testing.expectEqual(stream, outcomes[0].stream);
}

test "negotiator bounds each inbound connection and reserves outbound application and control work" {
    var setup: Setup = .{};
    try setup.init(1);
    defer setup.deinit();
    var owner = try Negotiator.init(std.testing.allocator, .{
        .negotiations_max = 8,
        .outbound_reserved = 3,
        .outbound_control_reserved = 1,
        .inbound_per_connection_max = 2,
    });
    defer owner.deinit();
    for (0..5) |index| {
        const stream: Engine.StreamHandle = .{ .conn = .{ .index = @intCast(index / 2), .generation = 1 }, .slot = 0, .id = index * 4 };
        try owner.acceptInbound(&setup.pair.server, stream, setup.pair.now);
        if (index == 1) try std.testing.expectError(error.NegotiationTableFull, owner.acceptInbound(&setup.pair.server, .{ .conn = stream.conn, .slot = 0, .id = 100 }, setup.pair.now));
    }
    try std.testing.expectError(error.NegotiationTableFull, owner.acceptInbound(&setup.pair.server, .{ .conn = .{ .index = 7, .generation = 1 }, .slot = 0, .id = 0 }, setup.pair.now));
    for (0..2) |_| _ = try owner.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{});
    try std.testing.expectError(error.NegotiationTableFull, owner.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{}));
    _ = try owner.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{ .control = true });
}

test "negotiator per connection reservations survive saturation and isolate outbound work" {
    var setup: Setup = .{};
    try setup.init(1);
    defer setup.deinit();
    var owner = try Negotiator.init(std.testing.allocator, .{
        .negotiations_max = 2,
        .outbound_control_reserved = 1,
        .inbound_connections = 3,
        .inbound_per_connection_max = 2,
    });
    defer owner.deinit();
    for (0..3) |peer| {
        const conn: Engine.Handle = .{ .index = @intCast(peer), .generation = 1 };
        for (0..2) |i| try owner.acceptInbound(&setup.pair.server, .{ .conn = conn, .slot = @intCast(i), .id = i * 4 }, setup.pair.now);
        try std.testing.expectError(error.NegotiationTableFull, owner.acceptInbound(&setup.pair.server, .{ .conn = conn, .slot = 2, .id = 8 }, setup.pair.now));
    }
    _ = try owner.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{});
    _ = try owner.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{ .control = true });
    try std.testing.expectError(error.NegotiationTableFull, owner.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{}));
    try std.testing.expectEqual(@as(usize, 8), owner.active());
    for (0..2) |i| owner.cancel(&setup.pair.server, .{ .conn = .{ .index = 2, .generation = 1 }, .slot = @intCast(i), .id = i * 4 });
    try owner.acceptInbound(&setup.pair.server, .{ .conn = .{ .index = 2, .generation = 2 }, .slot = 0, .id = 0 }, setup.pair.now);
    try std.testing.expectError(error.InvalidLimits, owner.acceptInbound(&setup.pair.server, .{ .conn = .{ .index = 3, .generation = 1 }, .slot = 0, .id = 0 }, setup.pair.now));
}

test "negotiator expires with no outcome capacity and reports later" {
    var setup: Setup = .{};
    try setup.init(1);
    defer setup.deinit();
    _ = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{});
    setup.pair.advance(Negotiator.negotiate_timeout_ms);
    try std.testing.expectEqual(@as(usize, 0), setup.pumpDialer(&supported, &.{}));
    try std.testing.expectEqual(@as(usize, 0), setup.dialer.active());
    var out: [1]Outcome = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.pumpDialer(&supported, &out));
    try std.testing.expectEqual(Negotiator.Failure.timeout, out[0].result.failed);
}

test "negotiator delivers retained outcomes before recycled lower slots" {
    var setup: Setup = .{};
    try setup.init(5);
    defer setup.deinit();
    var initial: [5]Engine.StreamHandle = undefined;
    for (&initial) |*stream| stream.* = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{});
    setup.pair.advance(Negotiator.negotiate_timeout_ms);
    try std.testing.expectEqual(@as(usize, 0), setup.pumpDialer(&supported, &.{}));
    var out: [1]Outcome = undefined;
    for (initial, 0..) |stream, index| {
        if (index >= 2) {
            const replacement = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{});
            setup.pair.client.closeStream(replacement, 0);
        }
        try std.testing.expectEqual(@as(usize, 1), setup.pumpDialer(&supported, &out));
        try std.testing.expectEqual(stream, out[0].stream);
        try std.testing.expectEqual(Negotiator.Failure.timeout, out[0].result.failed);
    }
    var remaining: [5]Outcome = undefined;
    try std.testing.expectEqual(@as(usize, 3), setup.pumpDialer(&supported, &remaining));
    for (remaining[0..3]) |outcome| try std.testing.expectEqual(Negotiator.Failure.stream_closed, outcome.result.failed);
    try std.testing.expectEqual(@as(usize, 0), setup.pumpDialer(&supported, &remaining));
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(setup.dialer.schedule(1), setup.pair.now.millis()) == null);
}

test "negotiator connection teardown invalidates an undelivered ready outcome" {
    var setup: Setup = .{};
    try setup.init(1);
    defer setup.deinit();
    const stream = try setup.pair.client.openStream(setup.handles.client);
    const dialer = try multistream.Dialer.init(ping);
    var bytes: [256]u8 = undefined;
    const hello = try dialer.initialWrite(&bytes);
    _ = try setup.pair.client.write(stream, hello, false);
    for (0..8) |_| {
        try setup.pair.pump();
        try setup.acceptOpened();
        _ = setup.pumpListener(&supported, &.{});
    }
    try std.testing.expectEqual(@as(usize, 0), setup.listener.active());
    setup.listener.connectionClosed(&setup.pair.server, setup.handles.server);
    var outcomes: [1]Outcome = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.pumpListener(&supported, &outcomes));
    try std.testing.expect(outcomes[0].result == .failed);
    try std.testing.expectEqual(Negotiator.Failure.stream_closed, outcomes[0].result.failed);
}

test "negotiator cancellation releases pending outcomes and checks full stream identity" {
    var setup: Setup = .{};
    try setup.init(1);
    defer setup.deinit();
    const stream = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{});
    setup.pair.advance(Negotiator.negotiate_timeout_ms);
    _ = setup.pumpDialer(&supported, &.{});
    var stale = stream;
    stale.conn.generation +%= 1;
    setup.dialer.cancel(&setup.pair.client, stale);
    try std.testing.expectError(error.NegotiationTableFull, setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{}));
    setup.dialer.cancel(&setup.pair.client, stream);
    var outcomes: [1]Outcome = undefined;
    try std.testing.expectEqual(@as(usize, 0), setup.pumpDialer(&supported, &outcomes));
    _ = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{});
}

test "negotiator preserves coalesced acceptance payload and FIN for the dialer" {
    var setup: Setup = .{};
    try setup.init(1);
    defer setup.deinit();
    _ = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &.{ping_protocol}, setup.pair.now, .{});
    var outcomes: [1]Outcome = undefined;
    _ = setup.pumpDialer(&supported, &outcomes);
    try setup.pair.pump();
    var events: [8]Engine.Event = undefined;
    var inbound: ?Engine.StreamHandle = null;
    for (setup.pair.events(&setup.pair.server, &events)) |event| {
        if (event == .stream_opened) inbound = event.stream_opened;
    }
    var buffer: [256]u8 = undefined;
    _ = try setup.pair.server.read(inbound.?, &buffer);
    const header = try multistream.encodeMessage(multistream.header, &buffer);
    const accepted = try multistream.encodeMessage(ping, buffer[header.len..]);
    const offset = header.len + accepted.len;
    @memcpy(buffer[offset..][0..4], "pong");
    try std.testing.expectEqual(offset + 4, try setup.pair.server.write(inbound.?, buffer[0 .. offset + 4], true));
    try setup.pair.pump();
    try std.testing.expectEqual(@as(usize, 1), setup.pumpDialer(&supported, &outcomes));
    try std.testing.expectEqualStrings("pong", outcomes[0].result.ready.leftover);
    try std.testing.expect(outcomes[0].result.ready.fin);
    try std.testing.expectEqual(types.Direction.outbound, outcomes[0].direction);
    try std.testing.expect(setup.dialer.schedule(0).runnable);
    try std.testing.expectEqual(@as(usize, 0), setup.pumpDialer(&supported, &.{}));
    try std.testing.expect(!setup.dialer.schedule(0).runnable);
}

test "negotiator uses current support for a fragmented proposal and its fallback" {
    var setup: Setup = .{};
    try setup.init(1);
    defer setup.deinit();
    const stream = try setup.pair.client.openStream(setup.handles.client);
    const dialer = try multistream.Dialer.init(ping);
    var request: [256]u8 = undefined;
    const hello = try dialer.initialWrite(&request);
    try std.testing.expectEqual(hello.len - 1, try setup.pair.client.write(stream, hello[0 .. hello.len - 1], false));
    try setup.pair.pump();
    try setup.acceptOpened();
    var outcomes: [1]Outcome = undefined;
    try std.testing.expectEqual(@as(usize, 0), setup.pumpListener(&supported, &outcomes));

    try std.testing.expectEqual(@as(usize, 1), try setup.pair.client.write(stream, hello[hello.len - 1 ..], false));
    try setup.pair.pump();
    try std.testing.expectEqual(@as(usize, 0), setup.pumpListener(supported[1..], &outcomes));
    try std.testing.expectEqual(@as(usize, 1), setup.listener.active());

    const fallback = try multistream.encodeMessage(other_protocol.id, &request);
    @memcpy(request[fallback.len..][0..5], "later");
    try std.testing.expectEqual(fallback.len + 5, try setup.pair.client.write(stream, request[0 .. fallback.len + 5], true));
    try setup.pair.pump();
    try std.testing.expectEqual(@as(usize, 1), setup.pumpListener(supported[1..], &outcomes));
    try std.testing.expectEqual(@as(?u8, other_protocol.index), outcomes[0].protocol_index);
    try std.testing.expectEqualStrings("later", outcomes[0].result.ready.leftover);
    try std.testing.expect(outcomes[0].result.ready.fin);
}

test "negotiator enables a protocol after accepting a stream with no supported protocols" {
    var setup: Setup = .{};
    try setup.init(1);
    defer setup.deinit();
    const stream = try setup.pair.client.openStream(setup.handles.client);
    var request: [256]u8 = undefined;
    const header = try multistream.encodeMessage(multistream.header, &request);
    try std.testing.expectEqual(header.len, try setup.pair.client.write(stream, header, false));
    try setup.pair.pump();
    try setup.acceptOpened();
    var outcomes: [1]Outcome = undefined;
    try std.testing.expectEqual(@as(usize, 0), setup.pumpListener(&.{}, &outcomes));

    const proposal = try multistream.encodeMessage(ping, &request);
    try std.testing.expectEqual(proposal.len, try setup.pair.client.write(stream, proposal, true));
    try setup.pair.pump();
    try std.testing.expectEqual(@as(usize, 1), setup.pumpListener(&supported, &outcomes));
    try std.testing.expectEqual(@as(?u8, ping_protocol.index), outcomes[0].protocol_index);
    try std.testing.expect(outcomes[0].result.ready.fin);
}

test "negotiator retains an accepted tag across blocked acknowledgement and delayed delivery" {
    var setup: Setup = .{};
    try setup.init(1);
    defer setup.deinit();
    const stream = try setup.pair.client.openStream(setup.handles.client);
    const dialer = try multistream.Dialer.init(ping);
    var request: [256]u8 = undefined;
    const hello = try dialer.initialWrite(&request);
    @memcpy(request[hello.len..][0..4], "kept");
    try std.testing.expectEqual(hello.len + 4, try setup.pair.client.write(stream, request[0 .. hello.len + 4], true));
    try setup.pair.pump();
    var events: [8]Engine.Event = undefined;
    const inbound = try support.expectStreamOpened(setup.pair.events(&setup.pair.server, &events)[0], setup.handles.server);
    try setup.listener.acceptInbound(&setup.pair.server, inbound, setup.pair.now);

    const padding = [_]u8{0x55} ** 4096;
    var sent: usize = 0;
    for (0..64) |_| {
        sent += setup.pair.server.write(inbound, &padding, false) catch |err| switch (err) {
            error.WouldBlock => break,
            else => return err,
        };
    }
    try std.testing.expect(sent > 0);
    try std.testing.expectEqual(@as(usize, 0), try setup.pair.server.streamCapacity(inbound));
    var outcomes: [1]Outcome = undefined;
    try std.testing.expectEqual(@as(usize, 0), setup.pumpListener(&supported, &outcomes));
    try std.testing.expectEqual(@as(usize, 1), setup.listener.active());

    try setup.pair.flush(&setup.pair.server);
    const row = setup.pair.server.route(inbound).?.row;
    setup.listener.streamReady(row, .{ .conn = .{ .index = inbound.conn.index, .generation = inbound.conn.generation + 1 }, .id = inbound.id, .slot = inbound.slot });
    for (0..8) |_| {
        try std.testing.expectEqual(@as(usize, 0), setup.listener.pump(&setup.pair.server, setup.pair.now, &supported, &outcomes));
        try std.testing.expect(!setup.pair.server.backlog());
    }
    // A retry that blocks again re-dirties the connection; this stream-level block sends nothing.
    setup.listener.streamReady(row, inbound);
    _ = setup.listener.pump(&setup.pair.server, setup.pair.now, &supported, &outcomes);
    try std.testing.expect(setup.pair.server.backlog());
    var scratch: [constants.datagram_size_max]u8 = undefined;
    try std.testing.expect(setup.pair.server.sendOne(inbound.conn.index, setup.pair.now, &scratch) == null);
    setup.pair.server.sent(inbound.conn.index, setup.pair.now, true);
    try std.testing.expect(!setup.pair.server.backlog());
    try setup.pair.pump();
    var received: usize = 0;
    var buffer: [4096]u8 = undefined;
    for (0..64) |_| {
        const read = try setup.pair.client.read(stream, &buffer);
        try std.testing.expectEqualSlices(u8, padding[0..read.len], buffer[0..read.len]);
        received += read.len;
        if (read.len == 0) break;
    }
    try std.testing.expectEqual(sent, received);
    const reordered = [_]Negotiator.Protocol{ other_protocol, ping_protocol };
    try std.testing.expectEqual(@as(usize, 0), setup.pumpListener(&reordered, &.{}));
    try std.testing.expectEqual(@as(usize, 0), setup.listener.active());
    try std.testing.expectEqual(@as(usize, 1), setup.pumpListener(&.{}, &outcomes));
    try std.testing.expectEqual(@as(?u8, ping_protocol.index), outcomes[0].protocol_index);
    try std.testing.expectEqualStrings("kept", outcomes[0].result.ready.leftover);
    try std.testing.expect(outcomes[0].result.ready.fin);
}

test "negotiator reports the current outbound fallback tag on timeout" {
    var setup: Setup = .{};
    try setup.init(1);
    defer setup.deinit();
    const offered = [_]Negotiator.Protocol{
        .{ .id = "/missing/1.0.0", .index = 81 },
        ping_protocol,
    };
    _ = try setup.dialer.beginOutbound(&setup.pair.client, setup.handles.client, &offered, setup.pair.now, .{});
    var outcomes: [1]Outcome = undefined;
    try std.testing.expectEqual(@as(usize, 0), setup.pumpDialer(&.{}, &outcomes));
    try setup.pair.pump();
    try setup.acceptOpened();
    try std.testing.expectEqual(@as(usize, 0), setup.pumpListener(&.{}, &outcomes));
    try std.testing.expectEqual(@as(usize, 0), setup.pumpListener(&.{}, &outcomes));
    try setup.pair.pump();
    try std.testing.expectEqual(@as(usize, 0), setup.pumpDialer(&.{}, &outcomes));
    setup.pair.advance(Negotiator.negotiate_timeout_ms);
    try std.testing.expectEqual(@as(usize, 1), setup.pumpDialer(&.{}, &outcomes));
    try std.testing.expectEqual(Negotiator.Failure.timeout, outcomes[0].result.failed);
    try std.testing.expectEqual(@as(?u8, ping_protocol.index), outcomes[0].protocol_index);
}

test "negotiation timed entry owns exact expiry below and above the default" {
    for ([_]u64{ 50, 20_000 }) |duration| {
        var setup: Setup = .{};
        try setup.init(2);
        defer setup.deinit();
        const pair = &setup.pair;
        const negotiator = &setup.dialer;
        const stream = try negotiator.beginOutbound(&pair.client, setup.handles.client, &.{ping_protocol}, pair.now, .{ .control = true, .timeout_ms = duration });
        const due = pair.now.millis() + duration;
        var outcomes: [1]Outcome = undefined;
        try std.testing.expectEqual(@as(usize, 0), negotiator.pump(&pair.client, pair.now, &supported, &outcomes));
        try std.testing.expectEqual(@as(?u64, due), schedule_test_support.wakeupMilliseconds(negotiator.schedule(1), pair.now.millis()));
        pair.now.monotonic = time.milliseconds(due - 1);
        try std.testing.expectEqual(@as(usize, 0), negotiator.pump(&pair.client, pair.now, &supported, &outcomes));
        pair.now.monotonic = time.milliseconds(due);
        try std.testing.expectEqual(@as(usize, 1), negotiator.pump(&pair.client, pair.now, &supported, &outcomes));
        try std.testing.expectEqual(stream, outcomes[0].stream);
        try std.testing.expectEqual(.timeout, outcomes[0].result.failed);
    }
}

fn selectedRaw(setup: *Setup) !struct { client: Engine.StreamHandle, server: Engine.StreamHandle } {
    const stream = try setup.pair.client.openStream(setup.handles.client);
    const dialer = try multistream.Dialer.init(ping);
    var bytes: [256]u8 = undefined;
    const hello = try dialer.initialWrite(&bytes);
    try std.testing.expectEqual(hello.len, try setup.pair.client.write(stream, hello, false));
    var outcomes: [1]Outcome = undefined;
    for (0..16) |_| {
        try setup.pair.pump();
        if (setup.pumpListener(&supported, &outcomes) > 0) {
            try std.testing.expect(outcomes[0].result == .ready);
            return .{ .client = stream, .server = outcomes[0].stream };
        }
    }
    return error.TestUnexpectedResult;
}

fn blockSelectedWrite(setup: *Setup, stream: Engine.StreamHandle) !usize {
    const padding = [_]u8{0x55} ** 4096;
    var sent: usize = 0;
    for (0..64) |_| {
        sent += setup.pair.server.write(stream, &padding, false) catch |err| switch (err) {
            error.WouldBlock => break,
            else => return err,
        };
    }
    try std.testing.expect(sent > 0);
    try std.testing.expectEqual(@as(usize, 0), try setup.pair.server.streamCapacity(stream));
    return sent;
}

test "negotiator retains final selected bytes through blocked writes and releases after FIN" {
    var setup: Setup = .{};
    try setup.init(1);
    defer setup.deinit();
    const streams = try selectedRaw(&setup);
    const padding = try blockSelectedWrite(&setup, streams.server);
    var response = "final selected response".*;
    try std.testing.expect(setup.listener.finishSelected(&setup.pair.server, streams.server, &response, setup.pair.now));
    @memset(&response, 0);
    setup.listener.releaseReported();
    try std.testing.expectEqual(@as(usize, 0), setup.pumpListener(&supported, &.{}));
    try std.testing.expectEqual(@as(usize, 1), setup.listener.active());
    const visits = setup.listener.visits;
    for (0..8) |_| _ = setup.listener.pump(&setup.pair.server, setup.pair.now, &supported, &.{});
    try std.testing.expectEqual(visits, setup.listener.visits);

    var received: usize = 0;
    var tail: ["final selected response".len]u8 = @splat(0);
    var bytes: [4096]u8 = undefined;
    var finished = false;
    for (0..128) |_| {
        try setup.pair.pump();
        const read = try setup.pair.client.read(streams.client, &bytes);
        try std.testing.expectEqual(@as(?u64, null), read.reset_code);
        for (bytes[0..read.len]) |byte| {
            std.mem.copyForwards(u8, &tail, tail[1..]);
            tail[tail.len - 1] = byte;
        }
        received += read.len;
        if (read.fin) {
            finished = true;
            break;
        }
        _ = setup.pumpListener(&supported, &.{});
    }
    try std.testing.expect(finished and received > padding);
    try std.testing.expectEqualStrings("final selected response", &tail);
    try std.testing.expectEqual(@as(usize, 0), setup.listener.active());
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(setup.listener.schedule(1), setup.pair.now.millis()));
}

test "negotiator final selected write retires on timeout reset connection close and shutdown" {
    const Case = enum { timeout, reset, connection_closed, shutdown };
    for ([_]Case{ .timeout, .reset, .connection_closed, .shutdown }) |case| {
        var setup: Setup = .{};
        try setup.init(1);
        defer setup.deinit();
        const streams = try selectedRaw(&setup);
        _ = try blockSelectedWrite(&setup, streams.server);
        try std.testing.expect(setup.listener.finishSelected(&setup.pair.server, streams.server, "refused", setup.pair.now));
        _ = setup.pumpListener(&supported, &.{});
        try std.testing.expectEqual(@as(usize, 1), setup.listener.active());
        switch (case) {
            .timeout => {
                setup.pair.advance(Negotiator.negotiate_timeout_ms);
                _ = setup.pumpListener(&supported, &.{});
            },
            .reset => {
                setup.pair.client.closeStream(streams.client, 1);
                try setup.pair.pump();
                _ = setup.pumpListener(&supported, &.{});
            },
            .connection_closed => {
                try std.testing.expect(setup.pair.client.close(setup.handles.client, 0));
                try setup.pair.pump();
                _ = setup.pumpListener(&supported, &.{});
            },
            .shutdown => setup.listener.cancelAll(&setup.pair.server),
        }
        try std.testing.expectEqual(@as(usize, 0), setup.listener.active());
        try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(setup.listener.schedule(1), setup.pair.now.millis()));
        if (case == .connection_closed) continue;
        const replacement = try setup.pair.client.openStream(setup.handles.client);
        var hello: [256]u8 = undefined;
        const dialer = try multistream.Dialer.init(ping);
        const proposal = try dialer.initialWrite(&hello);
        _ = try setup.pair.client.write(replacement, proposal, false);
        try setup.pair.pump();
        var outcomes: [1]Outcome = undefined;
        try std.testing.expectEqual(@as(usize, 1), setup.pumpListener(&supported, &outcomes));
        try std.testing.expect(outcomes[0].result == .ready);
    }
}
