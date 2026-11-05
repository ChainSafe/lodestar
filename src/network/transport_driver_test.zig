const Now = @import("types.zig").Now;
const std = @import("std");
const Transport = @import("transport.zig").Transport;
const Engine = @import("quic/Engine.zig");
const support = @import("transport_test_support.zig");
const Node = support.Node;
const quic_test = @import("quic/test_support.zig");
const FaultIo = @import("fault_io");
const transport_driver = @import("transport_driver.zig");

test "transport bounds an idle step by the requested wait" {
    var node: Node = .{};
    try node.init(6);
    defer node.deinit();

    var events: [4]Engine.Event = undefined;
    const started = std.Io.Clock.awake.now(std.testing.io).toMilliseconds();
    const result = try support.step(&node.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(5) });
    const elapsed = std.Io.Clock.awake.now(std.testing.io).toMilliseconds() - started;
    try std.testing.expect(elapsed < 200);
    try std.testing.expectEqual(@as(usize, 0), result.events);
    try std.testing.expect(!result.backlog);
    try std.testing.expect(node.transport.nextDeadlineNs() == null);

    const floored = try support.step(&node.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expectEqual(@as(u32, 0), floored.datagrams_received);
}

test "transport progress early clock failure does not begin or publish a turn" {
    var node: Node = .{};
    try node.init(39);
    defer node.deinit();
    const now = try Now.read(std.testing.io);
    const failed = try node.transport.engine.dial(&quic_test.server_address, node.transport.peerId(), now);
    try std.testing.expect(node.transport.engine.failSend(failed));
    var faults: FaultIo = .{ .clock = .{} };
    const io = faults.io();
    var events: [4]Engine.Event = undefined;
    const result = transport_driver.step(&node.transport, io, &events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expectEqual(error.ClockOutOfRange, result.failure.?);
    try std.testing.expectEqual(@as(u64, 0), result.progress.now.millis());
    try std.testing.expectEqual(@as(usize, 0), result.progress.events);
    try std.testing.expectEqual(@as(u32, 0), result.progress.datagrams_sent);
    try std.testing.expect(node.transport.engine.eventsPending());
    const next = transport_driver.step(&node.transport, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expectEqual(@as(usize, 1), next.progress.events);
    try std.testing.expectEqual(failed, events[0].closed.conn);
}

test "transport driver keeps receive progress when the post-wait clock read fails" {
    var node: Node = .{};
    try node.init(40);
    defer node.deinit();
    try node.transport.sockets.primary().send(std.testing.io, &node.transport.sockets.primary().address, "invalid");
    var vtable = std.testing.io.vtable.*;
    vtable.now = ReceiveClockFault.clock;
    const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
    ReceiveClockFault.calls = 0;
    const result = transport_driver.step(&node.transport, io, &.{}, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expectEqual(error.ClockOutOfRange, result.failure.?);
    try std.testing.expectEqual(@as(u32, 1), result.progress.datagrams_received);
    try std.testing.expectEqual(@as(u32, 1), result.progress.datagrams_dropped);
    try std.testing.expect(result.progress.now.millis() > 0);
}

const ReceiveClockFault = struct {
    threadlocal var calls: usize = 0;
    fn clock(userdata: ?*anyopaque, value: std.Io.Clock) std.Io.Timestamp {
        calls += 1;
        if (calls > 2) return .{ .nanoseconds = -1 };
        return std.testing.io.vtable.now(userdata, value);
    }
};

test "transport schedule waits for event capacity but always retires delivered events" {
    var node: Node = .{};
    try node.init(41);
    defer node.deinit();
    const now = try Now.read(std.testing.io);
    const handle = try node.transport.engine.dial(&quic_test.server_address, node.transport.peerId(), now);
    try std.testing.expect(node.transport.engine.failSend(handle));
    const before = node.transport.engine.resourceSnapshot();
    const visits = node.transport.engine.visits;
    for (0..3) |_| {
        const blocked = node.transport.schedule(0);
        try std.testing.expect(!blocked.runnable);
        try std.testing.expect(blocked.timeout(now.monotonic, .fromSeconds(1)).deadline.compare(.gt, now.monotonic));
        try std.testing.expect(node.transport.schedule(1).runnable);
    }
    try std.testing.expectEqualDeep(before, node.transport.engine.resourceSnapshot());
    try std.testing.expectEqualDeep(visits, node.transport.engine.visits);
    const blocked = node.transport.advance(std.testing.io, .{ .now = now }, &.{});
    try std.testing.expectEqual(@as(usize, 0), blocked.progress.events);
    try std.testing.expect(blocked.progress.events_pending);
    var events: [1]Engine.Event = undefined;
    const delivered = node.transport.advance(std.testing.io, .{ .now = now }, &events);
    try std.testing.expectEqual(@as(usize, 1), delivered.progress.events);
    try std.testing.expectEqual(handle, events[0].closed.conn);
    try std.testing.expect(node.transport.schedule(0).runnable);
    const retired = node.transport.advance(std.testing.io, .{ .now = now }, &.{});
    try std.testing.expectEqual(@as(usize, 0), retired.progress.events);
    try std.testing.expectEqual(@as(u16, 0), node.transport.engine.resourceSnapshot().active);
    try std.testing.expect(!node.transport.schedule(0).runnable);
}
