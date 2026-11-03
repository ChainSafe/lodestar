const topic_fixture = @import("gossipsub/topic_fixture.zig");
const Now = @import("types.zig").Now;
const schedule_test_support = @import("schedule_test_support.zig");
const driver = @import("driver.zig");
const transport_test = @import("transport_test_support.zig");
const std = @import("std");
const NetworkCore = @import("network_core.zig").NetworkCore;
const keys = @import("wire/keys.zig");
const options = @import("network_core_test_support.zig").networkOptions;
const stepAfter = @import("network_core_test_support.zig").stepAfter;
const time = @import("time.zig");
const transport = @import("transport.zig");
const Engine = @import("quic/Engine.zig");
const multistream = @import("wire/multistream.zig");
const reqresp = @import("reqresp/root.zig");
const configuration = @import("configuration.zig");
const policy_fixture = @import("reqresp/policy_fixture.zig");
const network_core_test_support = @import("network_core_test_support.zig");
const udp = @import("udp");

fn delayedRuntimeDatagram(sender: std.Io.net.Socket, address: std.Io.net.IpAddress) void {
    std.testing.io.sleep(.fromMilliseconds(10), .awake) catch unreachable;
    sender.send(std.testing.io, &address, "invalid") catch unreachable;
}

test "core native readiness wakes for either delayed protocol socket" {
    if (!NetworkCore.wait.supported) return error.SkipZigTest;
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{31}));
    var opts = options(&key);
    opts.startup.discovery = .{ .bind = .{ .ip4 = .loopback(0) } };
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    const sender = try (std.Io.net.IpAddress{ .ip4 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer sender.close(std.testing.io);
    for (0..2) |source| {
        for (0..2) |_| {
            const settled = try stepAfter(&node, 0);
            try std.testing.expect(settled.failure == null);
        }
        const target = if (source == 0) node.transport.sockets.primary() else node.discovery.?.transport.sockets.primary();
        const task = try std.Thread.spawn(.{}, delayedRuntimeDatagram, .{ sender, target.address });
        defer task.join();
        const result = try stepAfter(&node, 100);
        try std.testing.expect(result.failure == null);
        if (source == 0) {
            try std.testing.expectEqual([2]bool{ true, false }, result.readiness.quic);
            try std.testing.expectEqual(@as(u32, 1), result.transport.datagrams_received);
        } else {
            try std.testing.expect(result.readiness.discoveryReady());
            try std.testing.expectEqualSlices(u8, "invalid", node.discovery.?.transport.receive_buffer[0..7]);
        }
    }
}

test "core native host wake validates rollback stays attached through shutdown and preserves bytes" {
    if (!NetworkCore.wait.supported) return error.SkipZigTest;
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{32}));
    var opts = options(&key);
    opts.startup.discovery = .{ .bind = .{ .ip4 = .loopback(0) } };
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    const host = try (std.Io.net.IpAddress{ .ip4 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer host.close(std.testing.io);
    try node.setHostWake(host.handle);
    defer node.setHostWake(null) catch unreachable;
    try std.testing.expectError(error.InvalidWakeSource, node.setHostWake(-1));
    try std.testing.expectError(error.InvalidWakeSource, node.setHostWake(node.transport.sockets.primary().handle));
    try std.testing.expectError(error.InvalidWakeSource, node.setHostWake(node.discovery.?.transport.sockets.primary().handle));
    _ = try stepAfter(&node, 0);
    const sender = try std.Thread.spawn(.{}, delayedRuntimeDatagram, .{ host, host.address });
    defer sender.join();
    const result = try stepAfter(&node, 100);
    try std.testing.expect(result.failure == null and result.readiness.host);
    const repeated = try stepAfter(&node, 0);
    try std.testing.expect(repeated.readiness.host);
    try node.setHostWake(null);
    const detached = try stepAfter(&node, 0);
    try std.testing.expect(!detached.readiness.host);
    try node.setHostWake(host.handle);
    node.shutdown(node.last_now);
    try std.testing.expect(node.host_wake == null);
    try std.testing.expectError(error.Stopped, node.setHostWake(host.handle));
    try node.setHostWake(null);
    var buffer: [8]u8 = undefined;
    const message = try host.receiveTimeout(std.testing.io, &buffer, .{ .duration = .{ .clock = .awake, .raw = .fromMilliseconds(0) } });
    try std.testing.expectEqualStrings("invalid", message.data);
}

test "core native wait source failure retains completed protocol progress" {
    const runner = @import("root");
    if (!NetworkCore.wait.supported) return error.SkipZigTest;
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{34}));
    var opts = options(&key);
    opts.startup.discovery = .{ .bind = .{ .ip4 = .loopback(0) } };
    var node: NetworkCore = undefined;
    var backing_node = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    try node.init(backing_node.allocator(), std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    var pipe: [2]std.c.fd_t = undefined;
    try std.testing.expectEqual(@as(c_int, 0), std.c.pipe(&pipe));
    defer _ = std.c.close(pipe[0]);
    try node.setHostWake(pipe[0]);
    defer node.setHostWake(null) catch unreachable;
    try std.testing.expectEqual(@as(c_int, 0), std.c.close(pipe[1]));
    try node.transport.sockets.primary().send(std.testing.io, &node.transport.sockets.primary().address, "invalid");
    try node.transport.sockets.primary().send(std.testing.io, &node.discovery.?.transport.sockets.primary().address, "invalid");
    const allocations = backing_node.allocations;
    var buffer: [128]u8 = undefined;
    var expected: runner.LogExpectation = .{ .level = .err, .scope = "network_runtime", .message = try std.fmt.bufPrint(&buffer, "owner_poll_source_failed role=host family=none descriptor={d} revents={x}", .{ pipe[0], @as(c_short, std.c.POLL.HUP) }) };
    const previous = runner.expected_log;
    defer runner.expected_log = previous;
    runner.expected_log = &expected;
    const result = try stepAfter(&node, 100);
    try std.testing.expectEqual(error.WaitSourceClosed, result.failure.?);
    try std.testing.expect(expected.matched);
    try std.testing.expect(result.readiness.quicReady() and result.readiness.discoveryReady());
    try std.testing.expectEqual(@as(u32, 1), result.transport.datagrams_received);
    try std.testing.expectEqualSlices(u8, "invalid", node.discovery.?.transport.receive_buffer[0..7]);
    try std.testing.expectEqual(allocations, backing_node.allocations);
    try node.setHostWake(null);
    const clean = driver.step(&node, std.testing.io, node.last_now, .{}, .deadlineOnly(time.optionalMilliseconds(node.last_now.millis())));
    try std.testing.expect(clean.failure == null);
    try std.testing.expectEqual(@as(u64, 1), node.counters.readiness_failures);
}

test "core native wait honors engine timers and pending lifecycle work" {
    if (!NetworkCore.wait.supported) return error.SkipZigTest;
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{35}));
    var opts = options(&key);
    opts.resolved.limits.handshake_timeout_ms = 80;
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    const remote = try (std.Io.net.IpAddress{ .ip4 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer remote.close(std.testing.io);
    const destination = udp.Address.fromNetwork(remote.address);
    const now = try Now.read(std.testing.io);
    _ = try node.transport.engine.dial(&destination, node.peerId(), now);
    try std.testing.expect(node.transport.engine.backlog());
    const first = driver.step(&node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 100)));
    try std.testing.expect(first.failure == null);
    try std.testing.expect(first.transport.datagrams_sent > 0);
    try std.testing.expect(!first.transport.backlog);
    const current = node.last_now;
    const deadline = node.transport.nextDeadlineNs().?;
    const deadline_ms = deadline / std.time.ns_per_ms + @intFromBool(deadline % std.time.ns_per_ms != 0);
    try std.testing.expect(deadline_ms <= now.millis() + 80);
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(node.schedule(current, .{}), current.millis()).? <= deadline_ms);
    const timer = driver.step(&node, std.testing.io, current, .{}, .deadlineOnly(time.optionalMilliseconds(current.millis() +| 100)));
    try std.testing.expect(timer.failure == null);
    const failed = try node.transport.engine.dial(&destination, node.peerId(), node.last_now);
    try std.testing.expect(node.transport.engine.failSend(failed));
    try std.testing.expect(node.transport.engine.eventsPending());
    const lifecycle = driver.step(&node, std.testing.io, node.last_now, .{}, .deadlineOnly(time.optionalMilliseconds(node.last_now.millis() +| 100)));
    try std.testing.expect(lifecycle.failure == null);
    try std.testing.expect(lifecycle.transport.events > 0);
    const repeated = driver.step(&node, std.testing.io, node.last_now, .{}, .deadlineOnly(time.optionalMilliseconds(node.last_now.millis())));
    try std.testing.expectEqual(@as(usize, 0), repeated.transport.events);
}

test "core flushes a protocol reply in the turn that wrote it" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{36}));
    const spoke_key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{37}));
    var opts = options(&key);
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    // A bare QUIC peer: it speaks multistream by hand and runs no protocol of its own.
    var spoke: transport.Transport = .{};
    try spoke.init(std.testing.allocator, std.testing.io, .{ .host = &spoke_key, .bind = .{ .ip4 = .loopback(0) } });
    defer spoke.deinit(std.testing.io);
    const conn = try spoke.dialPeer(std.testing.io, node.transport.localAddress(), node.peerId(), try Now.read(std.testing.io));
    var events: [32]Engine.Event = undefined;
    var connected = false;
    for (0..400) |_| {
        const stepped = try transport_test.step(&spoke, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(1) });
        for (events[0..stepped.events]) |event| connected = connected or event == .connected;
        _ = try stepAfter(&node, 1);
        if (connected) break;
    }
    try std.testing.expect(connected);
    for (0..20) |_| {
        _ = try transport_test.step(&spoke, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(1) });
        _ = try stepAfter(&node, 1);
    }

    const stream = try spoke.engine.openStream(conn);
    const dialer = try multistream.Dialer.init(reqresp.Protocol.ping_v1.id());
    var proposal: [256]u8 = undefined;
    const hello = try dialer.initialWrite(&proposal);
    try std.testing.expectEqual(hello.len, try spoke.engine.write(stream, hello, false));
    const flushed = try transport_test.step(&spoke, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(0) });
    try std.testing.expect(flushed.datagrams_sent > 0);

    const turn = try stepAfter(&node, 100);
    try std.testing.expect(turn.failure == null);
    try std.testing.expect(turn.transport.datagrams_received > 0);
    try std.testing.expect(turn.transport.datagrams_sent > 0);
    try std.testing.expect(!turn.transport.backlog);
    try std.testing.expect(!turn.transport.events_pending);
    try std.testing.expect(node.transport.nextDeadlineNs().? > node.last_now.nanos());

    // The spoke reads the reply without the node taking another turn.
    var reply: [256]u8 = undefined;
    var received: usize = 0;
    for (0..20) |_| {
        _ = try transport_test.step(&spoke, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(10) });
        received += (try spoke.engine.read(stream, reply[received..])).len;
        if (received >= hello.len) break;
    }
    try std.testing.expectEqualSlices(u8, hello, reply[0..hello.len]);
}

test "core beacon idle scans do not manufacture immediate deadlines" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{11}));
    const resolved = try configuration.resolve(.{ .gossip = .{ .topic_policy = comptime &.{topic_fixture.blocks(.{ 1, 2, 3, 4 })} }, .seed = 7, .forks = &.{.{ .digest = @splat(0), .fork = .phase0 }}, .admission_policy = policy_fixture.config() });
    var node: NetworkCore = undefined;
    var backing_node = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    try node.init(backing_node.allocator(), std.testing.io, &resolved, .{
        .host = &key,
        .bind = .{ .ip4 = .loopback(0) },
        .local = network_core_test_support.localState(.{}),
        .clock = network_core_test_support.slot_clock,
    });
    defer node.deinit(std.testing.io);
    const now = try Now.read(std.testing.io);
    const calls = backing_node.allocations;
    for (0..8) |_| {
        const result = driver.step(&node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
        try std.testing.expect(result.failure == null);
        try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(node.protocols.reqresp.schedule(0), now.millis()));
        try std.testing.expect(schedule_test_support.wakeupMilliseconds(node.schedule(now, .{}), now.millis()).? > now.millis());
    }
    try std.testing.expectEqual(calls, backing_node.allocations);
}

test "core idle turns with pending negotiations are never due for reqresp or negotiation" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{38}));
    const spoke_key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{39}));
    var opts = options(&key);
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    // A bare QUIC peer never answers the node's identify, meshsub and status proposals, so
    // their negotiations stay pending on future deadlines.
    var spoke: transport.Transport = .{};
    try spoke.init(std.testing.allocator, std.testing.io, .{ .host = &spoke_key, .bind = .{ .ip4 = .loopback(0) } });
    defer spoke.deinit(std.testing.io);
    _ = try spoke.dialPeer(std.testing.io, node.transport.localAddress(), node.peerId(), try Now.read(std.testing.io));
    var events: [32]Engine.Event = undefined;
    for (0..40) |_| {
        _ = try transport_test.step(&spoke, std.testing.io, &events, .{ .wait_max = .fromMilliseconds(1) });
        _ = try stepAfter(&node, 1);
    }
    try std.testing.expect(node.protocols.router.negotiator.active() > 0);
    const visits = .{ node.protocols.reqresp.visits, node.protocols.router.negotiator.visits };
    for (0..64) |_| {
        const now = try Now.read(std.testing.io);
        if (schedule_test_support.wakeupMilliseconds(node.protocols.reqresp.schedule(1), now.millis())) |wakeup| try std.testing.expect(wakeup > now.millis());
        try std.testing.expect(schedule_test_support.wakeupMilliseconds(node.protocols.router.schedule(1), now.millis()).? > now.millis());
        try std.testing.expect(driver.step(&node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis()))).failure == null);
    }
    try std.testing.expectEqual(visits[0], node.protocols.reqresp.visits);
    try std.testing.expectEqual(visits[1], node.protocols.router.negotiator.visits);
    try std.testing.expect(node.protocols.router.negotiator.active() > 0);
}
