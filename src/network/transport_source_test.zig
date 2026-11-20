const std = @import("std");
const FaultIo = @import("fault_io");
const constants = @import("constants.zig");
const Engine = @import("quic/Engine.zig");
const KeyPair = @import("wire/keys.zig").KeyPair;
const Transport = @import("transport.zig").Transport;
const support = @import("transport_test_support.zig");
const transport_driver = @import("transport_driver.zig");
const types = @import("types.zig");

const Now = types.Now;
const io = std.testing.io;
const step_options = transport_driver.Options{ .wait_max = .fromMilliseconds(10) };

fn wildcard(transport: *Transport, seed: u8) !void {
    const key = try KeyPair.fromSecretKey(&([_]u8{0} ** 31 ++ [_]u8{seed}));
    try transport.init(std.testing.allocator, io, .{ .host = &key, .bind = .{ .ip4 = .unspecified(0) } });
}

fn loopback(last: u8, port: u16) types.Address {
    return .{ .ip4 = .{ .octets = .{ 127, 0, 0, last }, .port = port } };
}

test "a wildcard listener handshakes on the address it was dialed at and both ends report the same pair" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var listener: Transport = .{};
    try wildcard(&listener, 61);
    defer listener.deinit(io);
    var dialer: Transport = .{};
    try wildcard(&dialer, 62);
    defer dialer.deinit(io);
    const dialed = loopback(3, listener.localAddress().port());
    const source = loopback(1, dialer.localAddress().port());
    const handle = try dialer.dialPeer(io, dialed, listener.peerId(), try Now.read(io));
    try std.testing.expectEqualDeep(@as(?types.Address, source), dialer.engine.localAddress(handle));

    var events: [8]Engine.Event = undefined;
    var accepted: ?Engine.Handle = null;
    var connected = false;
    for (0..200) |_| {
        const listened = try support.step(&listener, io, &events, step_options);
        for (events[0..listened.events]) |event| if (event == .connected) {
            accepted = event.connected.conn;
        };
        const stepped = try support.step(&dialer, io, &events, step_options);
        for (events[0..stepped.events]) |event| connected = connected or event == .connected;
        if (connected and accepted != null) break;
    }
    try std.testing.expect(connected);
    try std.testing.expectEqualDeep(@as(?types.Address, dialed), listener.engine.localAddress(accepted.?));
    try std.testing.expectEqualDeep(@as(?types.Address, source), listener.engine.peerAddress(accepted.?));
    try std.testing.expectEqualDeep(@as(?types.Address, source), dialer.engine.localAddress(handle));
    try std.testing.expectEqualDeep(@as(?types.Address, dialed), dialer.engine.peerAddress(handle));
}

test "retry and version negotiation leave from the address the Initial was sent to" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var listener: Transport = .{};
    try wildcard(&listener, 63);
    defer listener.deinit(io);
    var dialer: Transport = .{};
    try wildcard(&dialer, 64);
    defer dialer.deinit(io);
    const dialed = loopback(2, listener.localAddress().port());
    var events: [8]Engine.Event = undefined;
    var buffer: [constants.datagram_size_max]u8 = undefined;

    var unsupported = [_]u8{0} ** 1_200;
    unsupported[0..5].* = .{ 0xc0, 0x1a, 0x2a, 0x3a, 0x4a };
    unsupported[5] = 8;
    unsupported[14] = 8;
    try dialer.sockets.sendTo(io, dialed, null, &unsupported, constants.datagram_size_max);
    const negotiated = try support.step(&listener, io, &events, step_options);
    try std.testing.expectEqual(@as(u32, 1), negotiated.version_negotiations);
    const negotiation = try dialer.sockets.receiveDatagram(io, &buffer, .{ .duration = .{ .raw = .fromSeconds(1), .clock = .awake } });
    try std.testing.expectEqualDeep(dialed, negotiation.from);
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 0, 0 }, negotiation.bytes[1..5]);

    _ = try dialer.dialPeer(io, dialed, listener.peerId(), try Now.read(io));
    _ = try support.step(&listener, io, &events, step_options);
    const retry = try dialer.sockets.receiveDatagram(io, &buffer, .{ .duration = .{ .raw = .fromSeconds(1), .clock = .awake } });
    try std.testing.expectEqualDeep(dialed, retry.from);
    try std.testing.expectEqual(@as(u8, 0xf0), retry.bytes[0] & 0xf0);
    try std.testing.expectEqual(@as(u16, 0), listener.engine.resourceSnapshot().active);
}

test "a dial with no source for its peer fails before any connection or datagram" {
    if (@import("builtin").os.tag != .linux) return error.SkipZigTest;
    var node: Transport = .{};
    try wildcard(&node, 65);
    defer node.deinit(io);
    var faults: FaultIo = .{};
    // Connecting a socket to the broadcast address needs a socket option the probe never sets.
    const broadcast: types.Address = .{ .ip4 = .{ .octets = @splat(255), .port = 9 } };
    try std.testing.expectError(error.SourceUnavailable, node.dialPeer(faults.io(), broadcast, node.peerId(), try Now.read(io)));
    try std.testing.expectEqual(@as(usize, 0), faults.send_calls);
    try std.testing.expectEqual(@as(u16, 0), node.engine.resourceSnapshot().active);
    try std.testing.expectEqual(@as(u16, 0), node.engine.registry.outbound);
    const handle = try node.dialPeer(io, loopback(1, 9), node.peerId(), try Now.read(io));
    try std.testing.expectEqualDeep(@as(?types.Address, loopback(1, node.localAddress().port())), node.engine.localAddress(handle));
}
