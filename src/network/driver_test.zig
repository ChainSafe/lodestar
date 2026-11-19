const schedule_test_support = @import("schedule_test_support.zig");
const driver = @import("driver.zig");
const std = @import("std");
const NetworkCore = @import("network_core.zig").NetworkCore;
const keys = @import("wire/keys.zig");
const options = @import("network_core_test_support.zig").networkOptions;
const Now = @import("types.zig").Now;
const Inbox = @import("gossipsub/test_support.zig").Inbox;
const transport = @import("transport.zig");
const time = @import("time.zig");
const local_intent = @import("gossipsub/local_intent.zig");
const topic_fixture = @import("gossipsub/topic_fixture.zig");
const configuration = @import("configuration.zig");
const policy_fixture = @import("reqresp/policy_fixture.zig");
const network_core_test_support = @import("network_core_test_support.zig");
const fault_io = @import("fault_io");
const Sockets = @import("udp").Sockets;
const udp = @import("udp");
const PeerId = @import("wire/peer_id.zig").PeerId;

fn currentTime() !Now {
    return Now.read(std.testing.io);
}

/// A scripted host: a nonblocking wake pipe, and an apply that drains it and then runs the
/// test's host work.
const TestHost = struct {
    pipe: [2]std.c.fd_t = .{ -1, -1 },
    applies: u32 = 0,
    /// The next applies that report a per-turn cap.
    more: u32 = 0,
    /// The next apply writes its own wake after draining, as a concurrent submission would.
    resubmit: bool = false,
    publication: ?[]const u8 = null,
    published: usize = 0,
    failure: ?anyerror = null,

    fn init(self: *TestHost) !void {
        if (std.c.pipe(&self.pipe) != 0) return error.PipeFailed;
        const flags = std.c.fcntl(self.pipe[0], std.c.F.GETFL);
        const nonblock: c_int = @bitCast(std.c.O{ .NONBLOCK = true });
        if (flags < 0 or std.c.fcntl(self.pipe[0], std.c.F.SETFL, flags | nonblock) < 0) return error.PipeFailed;
    }

    fn deinit(self: *TestHost) void {
        for (self.pipe) |fd| _ = std.c.close(fd);
    }

    fn signal(self: *const TestHost) void {
        std.debug.assert(std.c.write(self.pipe[1], "w", 1) == 1);
    }

    fn seam(self: *TestHost, deadline_ms: ?u64) NetworkCore.Host {
        return .{ .handler = .{ .context = self, .apply = apply }, .deadline = time.optionalMilliseconds(deadline_ms) };
    }

    fn apply(context: *anyopaque, core: *NetworkCore, now: Now) NetworkCore.HostProgress {
        const self: *TestHost = @ptrCast(@alignCast(context));
        self.applies += 1;
        var buffer: [64]u8 = undefined;
        _ = std.c.read(self.pipe[0], &buffer, buffer.len);
        if (self.resubmit) {
            self.resubmit = false;
            self.signal();
        }
        if (self.publication) |topic| {
            self.publication = null;
            const outcome = core.publishGossipWithOptions(topic, "host publication", .{}, now) catch |err| {
                self.failure = err;
                return .{};
            };
            self.published = outcome.queued;
        }
        const more = self.more > 0;
        self.more -|= 1;
        return .{ .runnable = more };
    }
};

const Pair = struct {
    a: NetworkCore = undefined,
    b: NetworkCore = undefined,
    a_inbox: Inbox = .{},
    b_inbox: Inbox = .{},

    fn pump(self: *Pair) !void {
        self.a_inbox.clear();
        self.b_inbox.clear();
        for ([_]*NetworkCore{ &self.a, &self.b }) |node| {
            const now = try currentTime();
            const result = driver.step(node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 1)));
            if (result.failure) |err| return err;
        }
    }
};

fn intent(node: *const NetworkCore, subscriptions: []const local_intent.Boundary) NetworkCore.LocalIntent {
    return .{
        .update = .{ .local = node.localState(), .schedule = node.fork_schedule, .endpoints = node.advertisementEndpoints(), .capabilities = node.protocols.router.capabilities() },
        .demand = node.peer_manager.demand,
        .subscriptions = subscriptions,
    };
}

test "a host publication submitted after wait planning leaves in the turn that observes the wake" {
    if (!NetworkCore.wait.supported) return error.SkipZigTest;
    const topic = "/eth2/00000000/beacon_block/ssz_snappy";
    const key_a = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{61}));
    const key_b = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{62}));
    const pair = try std.testing.allocator.create(Pair);
    defer std.testing.allocator.destroy(pair);
    pair.* = .{};
    var opts = options(&key_a);
    opts.resolved.core.protocols.gossipsub.topic_policy = &.{topic_fixture.full(@splat(0))};
    try pair.a.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer pair.a.deinit(std.testing.io);
    opts.startup.host = &key_b;
    try pair.b.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer pair.b.deinit(std.testing.io);
    pair.a_inbox.attach(pair.a.protocols.gossipsub);
    pair.b_inbox.attach(pair.b.protocols.gossipsub);
    defer {
        pair.b_inbox.deinit();
        pair.a_inbox.deinit();
    }
    const subscriptions = topic_fixture.subscriptions(&.{topic});
    _ = try pair.a.applyIntent(&intent(&pair.a, subscriptions), pair.a.last_now);
    _ = try pair.b.applyIntent(&intent(&pair.b, subscriptions), pair.b.last_now);
    try pair.a.addDirectPeer(&pair.b.peerId(), &.{pair.b.transport.localAddress()}, pair.a.last_now);
    const ga = pair.a.protocols.gossipsub;
    const gb = pair.b.protocols.gossipsub;
    var ready = false;
    for (0..3000) |_| {
        try pair.pump();
        const subscribed = ga.resourceSnapshot().remote_subscriptions > 0 and gb.resourceSnapshot().remote_subscriptions > 0;
        if (subscribed and ga.sessions.rows[0].outStream() != null and gb.sessions.rows[0].outStream() != null) {
            ready = true;
            break;
        }
    }
    try std.testing.expect(ready);
    for (0..20) |_| try pair.pump();

    var host: TestHost = .{};
    try host.init();
    defer host.deinit();
    try pair.b.setHostWake(host.pipe[0]);
    defer pair.b.setHostWake(null) catch unreachable;
    host.publication = topic;
    const SubmitAtPoll = struct {
        threadlocal var target: ?*TestHost = null;

        fn checkCancel(userdata: ?*anyopaque) std.Io.Cancelable!void {
            // The native wait checks cancellation after planning and before polling.
            if (target) |pending| {
                target = null;
                std.debug.assert(pending.applies == 0);
                pending.signal();
            }
            return std.testing.io.vtable.checkCancel(userdata);
        }
    };
    SubmitAtPoll.target = &host;
    defer SubmitAtPoll.target = null;
    var vtable = std.testing.io.vtable.*;
    vtable.checkCancel = SubmitAtPoll.checkCancel;
    const io: std.Io = .{ .userdata = std.testing.io.userdata, .vtable = &vtable };
    const submitted_at = try currentTime();
    const turn = driver.step(&pair.b, io, submitted_at, .{}, host.seam(submitted_at.millis() +| 5_000));
    try std.testing.expect(SubmitAtPoll.target == null);
    try std.testing.expect(turn.failure == null);
    try std.testing.expect(turn.readiness.host);
    try std.testing.expect(host.failure == null);
    try std.testing.expectEqual(@as(u32, 1), host.applies);
    try std.testing.expectEqual(@as(usize, 1), host.published);
    try std.testing.expect(turn.transport.datagrams_sent > 0);
    try std.testing.expect(!turn.transport.backlog);

    var delivered = false;
    for (0..3000) |_| {
        const now = try currentTime();
        _ = driver.step(&pair.a, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 1)));
        for (pair.a_inbox.messages()) |message| {
            try std.testing.expectEqualStrings("host publication", message.bytes);
            _ = pair.a.reportValidation(message.handle, .accept, pair.a.last_now);
            delivered = true;
        }
        pair.a_inbox.clear();
        if (delivered) break;
    }
    try std.testing.expect(delivered);
}

test "a host applies only on its wake, a carried-over cap or its deadline" {
    if (!NetworkCore.wait.supported) return error.SkipZigTest;
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{63}));
    const opts = options(&key);
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    var host: TestHost = .{};
    try host.init();
    defer host.deinit();
    try node.setHostWake(host.pipe[0]);
    defer node.setHostWake(null) catch unreachable;
    for (0..4) |_| {
        const now = try currentTime();
        _ = driver.step(&node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
    }

    // A turn woken by a QUIC datagram, with the host deadline in the future, leaves the host alone.
    const sender = try (std.Io.net.IpAddress{ .ip4 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer sender.close(std.testing.io);
    try sender.send(std.testing.io, &node.transport.sockets.primary().address, "junk");
    var now = try currentTime();
    const quic = driver.step(&node, std.testing.io, now, .{}, host.seam(now.millis() +| 5_000));
    try std.testing.expect(quic.failure == null and quic.readiness.quicReady() and !quic.readiness.host);
    try std.testing.expectEqual(@as(u32, 0), host.applies);

    // The host deadline bounds the wait and is applied when it passes.
    now = try currentTime();
    const expected = schedule_test_support.waitMilliseconds(node.schedule(now, .{}), now.millis(), 150);
    const timed = driver.step(&node, std.testing.io, now, .{}, host.seam(now.millis() + 150));
    try std.testing.expect(timed.failure == null and !timed.readiness.host);
    if (expected == 150) {
        try std.testing.expect(timed.transport.now.millis() >= now.millis() + 150);
        try std.testing.expectEqual(@as(u32, 1), host.applies);
    }
    const applied = host.applies;

    // A cap carried over makes the next turn due now under host, without a wake.
    host.more = 1;
    host.signal();
    now = try currentTime();
    const capped = driver.step(&node, std.testing.io, now, .{}, host.seam(now.millis() +| 5_000));
    try std.testing.expect(capped.readiness.host);
    try std.testing.expectEqual(applied + 1, host.applies);
    try std.testing.expect(node.schedule(now, .{}).runnable);
    now = try currentTime();
    const carried = driver.step(&node, std.testing.io, now, .{}, host.seam(now.millis() +| 5_000));
    try std.testing.expect(!carried.readiness.host);
    try std.testing.expect(!node.host_runnable);
    try std.testing.expectEqual(applied + 2, host.applies);

    // A submission that lands after the drain wakes the next poll.
    host.resubmit = true;
    host.signal();
    now = try currentTime();
    const drained = driver.step(&node, std.testing.io, now, .{}, host.seam(now.millis() +| 5_000));
    try std.testing.expect(drained.readiness.host);
    now = try currentTime();
    const rewoken = driver.step(&node, std.testing.io, now, .{}, host.seam(now.millis() +| 5_000));
    try std.testing.expect(rewoken.readiness.host);
    try std.testing.expectEqual(applied + 4, host.applies);
}

const Visits = struct {
    timer: u64,
    advance: u64,
    flush: u64,
    reqresp: u64,
    negotiation: u64,
    gossip: u64,
    control: u64,

    fn capture(node: *const NetworkCore) Visits {
        const engine = node.transport.engine.visits;
        return .{
            .timer = engine.timer,
            .advance = engine.advance,
            .flush = engine.flush,
            .reqresp = node.protocols.reqresp.visits,
            .negotiation = node.protocols.router.negotiator.visits,
            .gossip = node.protocols.gossipsub.sessions.visits,
            .control = node.peer_manager.control.visits,
        };
    }
};

fn datagramsCounted(node: *const NetworkCore) u64 {
    const coordinator = node.discovery.?;
    var total: u64 = 0;
    for (coordinator.datagram_rejections) |count| total += count;
    return total;
}

test "discovery returns to polling after each datagram within a bounded network turn" {
    if (!NetworkCore.wait.supported) return error.SkipZigTest;
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{64}));
    var opts = options(&key);
    opts.startup.discovery = .{ .bind = .{ .ip4 = .loopback(0) } };
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    for (0..4) |_| {
        const now = try currentTime();
        _ = driver.step(&node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
    }
    const settled = try currentTime();
    try std.testing.expect(schedule_test_support.wakeupMilliseconds(node.schedule(settled, .{}), settled.millis()).? > settled.millis());
    const sender = try (std.Io.net.IpAddress{ .ip4 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer sender.close(std.testing.io);
    const target = node.discovery.?.transport.sockets.primary().address;
    for (0..40) |_| try sender.send(std.testing.io, &target, "junk datagram");
    const visits = Visits.capture(&node);
    const counted = datagramsCounted(&node);
    for (0..40) |_| {
        const before = datagramsCounted(&node);
        const now = try currentTime();
        const result = driver.step(&node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 5_000)));
        try std.testing.expect(result.failure == null);
        try std.testing.expect(result.readiness.discoveryReady());
        try std.testing.expectEqual(@as(u64, 1), datagramsCounted(&node) - before);
        try std.testing.expectEqual(@as(u32, 0), result.transport.datagrams_sent);
    }
    try std.testing.expectEqual(counted + 40, datagramsCounted(&node));
    try std.testing.expectEqualDeep(visits, Visits.capture(&node));
}

test "discovery readiness with other work due runs a full turn" {
    if (!NetworkCore.wait.supported) return error.SkipZigTest;
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{65}));
    var opts = options(&key);
    opts.startup.discovery = .{ .bind = .{ .ip4 = .loopback(0) } };
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    for (0..4) |_| {
        const now = try currentTime();
        _ = driver.step(&node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
    }
    const remote = try (std.Io.net.IpAddress{ .ip4 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer remote.close(std.testing.io);
    const destination = udp.Address.fromNetwork(remote.address);
    _ = try node.transport.engine.dial(&destination, node.peerId(), node.last_now);
    try std.testing.expect(node.transport.engine.backlog());
    try remote.send(std.testing.io, &node.discovery.?.transport.sockets.primary().address, "junk datagram");
    const now = try currentTime();
    const result = driver.step(&node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 5_000)));
    try std.testing.expect(result.failure == null and result.readiness.discoveryReady());
    try std.testing.expectEqual(@as(u64, 1), datagramsCounted(&node));
    try std.testing.expect(result.transport.datagrams_sent > 0);
}

fn initOwner(node: *NetworkCore) !void {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{94}));
    const resolved = try configuration.resolve(.{ .gossip = .{ .topic_policy = comptime &.{topic_fixture.blocks(.{ 1, 2, 3, 4 })} }, .seed = 7, .forks = &.{.{ .digest = @splat(0), .fork = .phase0 }}, .admission_policy = policy_fixture.config() });
    try node.init(std.testing.allocator, std.testing.io, &resolved, .{
        .host = &key,
        .bind = .{ .ip4 = .loopback(0) },
        .local = network_core_test_support.localState(.{}),
        .clock = network_core_test_support.slot_clock,
    });
}

test "an idle owner waits until the host deadline" {
    const node = try std.testing.allocator.create(NetworkCore);
    defer std.testing.allocator.destroy(node);
    try initOwner(node);
    defer node.deinit(std.testing.io);
    const now = try Now.read(std.testing.io);
    for (0..8) |_| try std.testing.expect(driver.step(node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis()))).failure == null);
    const settled = node.last_now;
    try std.testing.expect(!node.schedule(settled, .{}).due(settled.monotonic));
    const plan = node.waitPlan(settled, .{}, .deadlineOnly(time.optionalMilliseconds(settled.millis() + 2)));
    try std.testing.expectEqualDeep(time.milliseconds(settled.millis() + 2), plan.timeout.deadline);
}

test "a continuous QUIC flood on both families shares each receive quota and leaves the host progressing" {
    if (!NetworkCore.wait.supported) return error.SkipZigTest;
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{66}));
    var opts = options(&key);
    opts.startup.bind = .{ .dual = .{ .ip4 = .loopback(0), .ip6 = .loopback(0) } };
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    var host: TestHost = .{};
    try host.init();
    defer host.deinit();
    try node.setHostWake(host.pipe[0]);
    defer node.setHostWake(null) catch unreachable;
    for (0..4) |_| {
        const now = try currentTime();
        _ = driver.step(&node, std.testing.io, now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
    }
    const quota = node.transport.work_limits.receive_per_turn_max;
    const sockets = node.transport.sockets.values;
    const sender4 = try (std.Io.net.IpAddress{ .ip4 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer sender4.close(std.testing.io);
    const sender6 = try (std.Io.net.IpAddress{ .ip6 = .loopback(0) }).bind(std.testing.io, .{ .mode = .dgram, .protocol = .udp });
    defer sender6.close(std.testing.io);
    for (0..2 * quota + 6) |_| try sender4.send(std.testing.io, &sockets[0].?.address, "junk");
    for (0..4) |_| try sender6.send(std.testing.io, &sockets[1].?.address, "junk");

    // A wake, a due host deadline, then a wake again: each turn applies the host while the flood
    // lasts. Both families share the first quota, so IPv6 is drained by the second turn.
    const turns = [_]struct { wake: bool, due: bool, quic: [2]bool, received: u32 }{
        .{ .wake = true, .due = false, .quic = .{ true, true }, .received = quota },
        .{ .wake = false, .due = true, .quic = .{ true, false }, .received = quota },
        .{ .wake = true, .due = false, .quic = .{ true, false }, .received = 10 },
        .{ .wake = false, .due = false, .quic = .{ false, false }, .received = 0 },
    };
    for (turns, 0..) |expected, index| {
        if (expected.wake) host.signal();
        const now = try currentTime();
        const result = driver.step(&node, std.testing.io, now, .{}, host.seam(if (expected.due) now.millis() else now.millis() +| 5_000));
        try std.testing.expect(result.failure == null);
        try std.testing.expectEqual(expected.quic, result.readiness.quic);
        try std.testing.expectEqual(expected.received, result.transport.datagrams_received);
        try std.testing.expectEqual(expected.received, result.transport.datagrams_dropped);
        try std.testing.expectEqual(@as(u32, @intCast(@min(index + 1, 3))), host.applies);
    }
}

test "owner applies host work for a due host deadline and again for work the apply left" {
    const support = @import("network_core_test_support.zig");
    const setup = try std.testing.allocator.create(support.Setup);
    defer std.testing.allocator.destroy(setup);
    setup.* = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    const node = &setup.client;
    const Host = struct {
        applies: usize = 0,
        fn apply(context: *anyopaque, _: *NetworkCore, _: Now) NetworkCore.HostProgress {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.applies += 1;
            return .{ .runnable = self.applies == 1 };
        }
    };
    var host: Host = .{};
    setup.pair.advance(50);
    const now = setup.pair.now;
    try std.testing.expect(driver.step(node, setup.pair.io(), now, .{}, .{ .handler = .{ .context = &host, .apply = Host.apply }, .deadline = now.monotonic }).failure == null);
    try std.testing.expect(driver.step(node, setup.pair.io(), now, .{}, .{ .handler = .{ .context = &host, .apply = Host.apply } }).failure == null);
    try std.testing.expectEqual(@as(usize, 2), host.applies);
}

test "network owner progresses and shuts down while UDP sends are under local pressure" {
    const key = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{125}));
    const remote = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{126}));
    const identity = PeerId.fromPublicKey(&remote.publicKey());
    const opts = options(&key);
    var node: NetworkCore = undefined;
    try node.init(std.testing.allocator, std.testing.io, &opts.resolved, opts.startup);
    defer node.deinit(std.testing.io);
    var faults: fault_io = .{ .send = .{}, .send_failure = error.SystemResources };
    const now = node.last_now;
    try node.connectUntil(&identity, &.{.{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9 } }}, now, time.milliseconds(now.millis() + 5_000));
    const progress = driver.step(&node, faults.io(), now, .{}, .deadlineOnly(time.optionalMilliseconds(now.millis())));
    try std.testing.expect(progress.failure == null);
    try std.testing.expect(faults.send_calls > 0 and faults.send_calls <= transport.Transport.send_burst_max);
    try std.testing.expect(node.phase() == .running);
    try std.testing.expect(node.transport.send_drops.datagrams[@intFromEnum(Sockets.SendDrops.Reason.system_resources)] > 0);
    node.shutdown(node.last_now);
    const sends = faults.send_calls;
    node.deinit(faults.io());
    try std.testing.expectEqual(sends, faults.send_calls);
    try std.testing.expect(!node.initialized);
}
