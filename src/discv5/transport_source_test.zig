const std = @import("std");
const net = std.Io.net;
const CallTable = @import("CallTable.zig");
const Engine = @import("Engine.zig");
const Transport = @import("Transport.zig");
const enr = @import("identity/enr.zig");
const message = @import("wire/message.zig");
const Sockets = @import("udp").Sockets;
const test_support = @import("test_support.zig");
const types = @import("types.zig");
const endpoint = test_support.endpoint;
const waitForDatagram = @import("socket_test_support").waitForDatagram;
const io = std.testing.io;

/// Two transports without sessions. Each record advertises `advertised` with its socket's port.
const Nodes = struct {
    records: [2]enr.Record,
    transports: [2]Transport,

    fn init(self: *Nodes, bindings: [2]net.Ip4Address, advertised: [2]u8) !void {
        var bound: usize = 0;
        errdefer for (self.transports[0..bound]) |*transport| transport.sockets.close(io);
        for (&self.transports, bindings) |*transport, binding| {
            transport.sockets = try Sockets.bind(io, .{ .ip4 = binding });
            bound += 1;
        }
        var started: usize = 0;
        errdefer for (self.transports[0..started]) |*transport| transport.engine.deinit(std.testing.allocator);
        for (&self.transports, &self.records, advertised, [2]u8{ 0x11, 0x22 }) |*transport, *record, last, seed| {
            const key = try test_support.keyPair(seed);
            record.* = try enr.Record.create(&key, 1, loopback(last, transport.localAddress().port()));
            try transport.init(std.testing.allocator, transport.sockets, key, record.*, .{
                .session_capacity = 4,
                .challenge_capacity = 4,
                .call_capacity = 4,
                .request_timeout_ms = 1_000,
                .challenge_timeout_ms = 1_000,
                .session_idle_timeout_ms = std.math.maxInt(u64),
            });
            started += 1;
        }
    }

    fn deinit(self: *Nodes) void {
        for (&self.transports) |*transport| transport.deinit(std.testing.allocator, io);
    }

    /// Advances `node` over its next datagram and returns that datagram's source.
    fn step(self: *Nodes, through: std.Io, node: usize, result: *Transport.AdvanceResult) !types.Address {
        const transport = &self.transports[node];
        try waitForDatagram(transport.sockets.primary());
        var ready: [2]bool = @splat(true);
        const input = transport.receive(through, &ready);
        const from = (try input).?.from;
        var expired: [4]CallTable.Expired = undefined;
        result.* = try transport.advance(through, try Transport.monotonicMilliseconds(io), &expired, input);
        try std.testing.expectEqual(@as(?Transport.Failure, null), result.failure);
        try std.testing.expect(result.datagram == .accepted);
        return from;
    }
};

fn loopback(last: u8, port: u16) types.Address {
    return .{ .ip4 = .{ .octets = .{ 127, 0, 0, last }, .port = port } };
}

fn ping(id: u8, sequence: u64) !message.Message {
    return .{ .ping = .{ .request_id = try message.RequestId.init(&.{id}), .enr_sequence = sequence } };
}

/// Records whether each datagram carried a source pin, then sends it.
const Pins = struct {
    pinned: [8]bool = undefined,
    len: usize = 0,

    fn send(context: ?*anyopaque, handle: net.Socket.Handle, messages: []net.OutgoingMessage, flags: net.SendFlags) struct { ?net.Socket.SendError, usize } {
        const self: *Pins = @ptrCast(@alignCast(context.?));
        for (messages) |outgoing| {
            self.pinned[self.len] = outgoing.control.len > 0;
            self.len += 1;
        }
        return io.vtable.netSend(io.userdata, handle, messages, flags);
    }
};

test "a wildcard node answers every packet from the address its request was sent to" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var nodes: Nodes = undefined;
    try nodes.init(.{ .loopback(0), .unspecified(0) }, .{ 1, 2 });
    defer nodes.deinit();
    const local = endpoint(&nodes.records[1]).address;
    try std.testing.expectEqual(@as(u8, 2), local.ip4.octets[3]);
    const now_ms = try Transport.monotonicMilliseconds(io);
    const handle = try nodes.transports[0].startCall(io, endpoint(&nodes.records[1]), &nodes.records[1], &try ping(0x42, 1), now_ms);
    var result: Transport.AdvanceResult = undefined;

    // WHOAREYOU, then PONG after the handshake. The caller matches both on the address it called.
    _ = try nodes.step(io, 1, &result);
    try std.testing.expectEqualDeep(@as(?types.Address, local), result.local);
    try std.testing.expectEqualDeep(local, try nodes.step(io, 0, &result));
    try std.testing.expect(result.event == .none);
    _ = try nodes.step(io, 1, &result);
    try std.testing.expectEqual(@as(u8, 1), result.standard_responses);
    try std.testing.expectEqualDeep(local, try nodes.step(io, 0, &result));
    try std.testing.expectEqual(handle, result.event.response.matched.handle);

    const request_id = try message.RequestId.init(&.{0x43});
    const talk: message.Message = .{ .talk_request = .{ .request_id = request_id, .protocol = "test", .request = "request" } };
    _ = try nodes.transports[0].startCall(io, endpoint(&nodes.records[1]), &nodes.records[1], &talk, now_ms);
    _ = try nodes.step(io, 1, &result);
    try std.testing.expect(result.event.request.message == .talk_request);
    const response: message.Message = .{ .talk_response = .{ .request_id = request_id, .response = "response" } };
    try nodes.transports[1].sendResponse(io, result.event.request.peer, result.local, &response, now_ms);
    try std.testing.expectEqualDeep(local, try nodes.step(io, 0, &result));
    try std.testing.expectEqualStrings("response", result.event.response.matched.response.talk_response.response);
}

test "requests leave the source to the kernel and replies pin it" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var nodes: Nodes = undefined;
    try nodes.init(.{ .unspecified(0), .unspecified(0) }, .{ 1, 2 });
    defer nodes.deinit();
    var pins: Pins = .{};
    var vtable = io.vtable.*;
    vtable.netSend = Pins.send;
    const recorded: std.Io = .{ .userdata = &pins, .vtable = &vtable };
    const now_ms = try Transport.monotonicMilliseconds(io);
    _ = try nodes.transports[0].startCall(recorded, endpoint(&nodes.records[1]), &nodes.records[1], &try ping(0x44, 1), now_ms);
    var result: Transport.AdvanceResult = undefined;
    // Request, WHOAREYOU, handshake answering it, PONG.
    try std.testing.expectEqualDeep(loopback(1, nodes.transports[0].localAddress().port()), try nodes.step(recorded, 1, &result));
    _ = try nodes.step(recorded, 0, &result);
    _ = try nodes.step(recorded, 1, &result);
    _ = try nodes.step(recorded, 0, &result);
    try std.testing.expect(result.event == .response);
    try std.testing.expectEqualSlices(bool, &.{ false, true, true, true }, pins.pinned[0..pins.len]);
}

test "a response arriving on another local address completes its call" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var nodes: Nodes = undefined;
    try nodes.init(.{ .unspecified(0), .loopback(0) }, .{ 1, 1 });
    defer nodes.deinit();
    const caller = &nodes.transports[0];
    const other = loopback(3, caller.localAddress().port());
    const peer = endpoint(&nodes.records[1]);
    var output: [1_280]u8 = undefined;
    const now_ms = try Transport.monotonicMilliseconds(io);
    const started = try caller.engine.startCall(&output, peer, &nodes.records[1], &try ping(0x45, 1), now_ms, &test_support.sealEntropy(0x33));
    try caller.transmit(io, peer.address, other, output[0..started.packet_length]);
    var result: Transport.AdvanceResult = undefined;
    try std.testing.expectEqualDeep(other, try nodes.step(io, 1, &result));
    _ = try nodes.step(io, 0, &result);
    try std.testing.expectEqualDeep(@as(?types.Address, other), result.local);
    _ = try nodes.step(io, 1, &result);
    try std.testing.expectEqualDeep(peer.address, try nodes.step(io, 0, &result));
    try std.testing.expectEqualDeep(@as(?types.Address, other), result.local);
    try std.testing.expectEqual(started.handle, result.event.response.matched.handle);
    try std.testing.expectEqual(@as(usize, 0), caller.engine.calls.count());
}
