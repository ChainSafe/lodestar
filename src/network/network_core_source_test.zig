const std = @import("std");
const driver = @import("driver.zig");
const Engine = @import("quic/Engine.zig");
const Inbox = @import("gossipsub/test_support.zig").Inbox;
const NetworkCore = @import("network_core.zig").NetworkCore;
const core_test = @import("network_core_test_support.zig");
const keys = @import("wire/keys.zig");
const reqresp = @import("reqresp/root.zig");
const time = @import("time.zig");
const topic_fixture = @import("gossipsub/topic_fixture.zig");
const types = @import("types.zig");

const Now = types.Now;
const io = std.testing.io;

const Pair = struct {
    a: NetworkCore = undefined,
    b: NetworkCore = undefined,
    a_inbox: Inbox = .{},
    b_inbox: Inbox = .{},
    a_app: [4]reqresp.ReqResp.Event = undefined,
    b_app: [4]reqresp.ReqResp.Event = undefined,

    fn pump(self: *Pair) !struct { a: usize, b: usize } {
        self.a_inbox.clear();
        self.b_inbox.clear();
        const now = try Now.read(io);
        const a = driver.step(&self.a, io, now, .{ .application = &self.a_app }, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 1)));
        if (a.failure) |err| return err;
        const b = driver.step(&self.b, io, now, .{ .application = &self.b_app }, .deadlineOnly(time.optionalMilliseconds(now.millis() +| 1)));
        if (b.failure) |err| return err;
        return .{ .a = a.counts.application, .b = b.counts.application };
    }
};

fn loopback(last: u8, port: u16) types.Address {
    return .{ .ip4 = .{ .octets = .{ 127, 0, 0, last }, .port = port } };
}

fn onlyConnection(engine: *const Engine) !Engine.Handle {
    const active = engine.registry.activeIndices();
    try std.testing.expectEqual(@as(usize, 1), active.len);
    return engine.sendOwner(active[0]) orelse error.TestUnexpectedResult;
}

test "wildcard cores connect, answer a request and deliver gossip when one is dialed at another loopback address" {
    if (@import("builtin").os.tag != .linux or !NetworkCore.wait.supported) return error.SkipZigTest;
    const topic = "/eth2/00000000/beacon_block/ssz_snappy";
    const key_a = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{71}));
    const key_b = try keys.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{72}));
    const pair = try std.testing.allocator.create(Pair);
    defer std.testing.allocator.destroy(pair);
    pair.* = .{};
    var opts = core_test.networkOptions(&key_a);
    opts.resolved.core.protocols.gossipsub.topic_policy = &.{topic_fixture.full(@splat(0))};
    opts.startup.bind = .{ .ip4 = .unspecified(0) };
    try pair.a.init(std.testing.allocator, io, &opts.resolved, opts.startup);
    defer pair.a.deinit(io);
    opts.startup.host = &key_b;
    try pair.b.init(std.testing.allocator, io, &opts.resolved, opts.startup);
    defer pair.b.deinit(io);
    pair.a_inbox.attach(pair.a.protocols.gossipsub);
    pair.b_inbox.attach(pair.b.protocols.gossipsub);
    defer {
        pair.b_inbox.deinit();
        pair.a_inbox.deinit();
    }
    const subscriptions = topic_fixture.subscriptions(&.{topic});
    _ = try pair.a.applyIntent(&core_test.intent(&pair.a, subscriptions), pair.a.last_now);
    _ = try pair.b.applyIntent(&core_test.intent(&pair.b, subscriptions), pair.b.last_now);

    const listened = loopback(3, pair.b.transport.localAddress().port());
    const source = loopback(1, pair.a.transport.localAddress().port());
    try pair.a.addDirectPeer(&pair.b.peerId(), &.{listened}, pair.a.last_now);
    const ga = pair.a.protocols.gossipsub;
    const gb = pair.b.protocols.gossipsub;
    var ready = false;
    for (0..3000) |_| {
        _ = try pair.pump();
        const subscribed = ga.resourceSnapshot().remote_subscriptions > 0 and gb.resourceSnapshot().remote_subscriptions > 0;
        ready = subscribed and pair.a.peerCounts().relevant == 1 and pair.b.peerCounts().relevant == 1 and
            ga.sessions.rows[0].outStream() != null and gb.sessions.rows[0].outStream() != null;
        if (ready) break;
    }
    try std.testing.expect(ready);

    const dialed = try onlyConnection(&pair.a.transport.engine);
    const accepted = try onlyConnection(&pair.b.transport.engine);
    try std.testing.expectEqualDeep(@as(?types.Address, source), pair.a.transport.engine.localAddress(dialed));
    try std.testing.expectEqualDeep(@as(?types.Address, listened), pair.a.transport.engine.peerAddress(dialed));
    try std.testing.expectEqualDeep(@as(?types.Address, listened), pair.b.transport.engine.localAddress(accepted));
    try std.testing.expectEqualDeep(@as(?types.Address, source), pair.b.transport.engine.peerAddress(accepted));

    var request: [24]u8 = @splat(0);
    request[8] = 1;
    request[16] = 1;
    const sink = try std.testing.allocator.alloc(u8, reqresp.Protocol.blocks_by_range_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    _ = try pair.a.sendReqRespRequest(&pair.b.peerId(), .blocks_by_range_v2, &request, sink, .{}, pair.a.last_now);
    var served = false;
    var answered = false;
    for (0..3000) |_| {
        const counts = try pair.pump();
        for (pair.b_app[0..counts.b]) |event| if (event == .request) {
            try std.testing.expectEqualSlices(u8, &request, event.request.bytes);
            try std.testing.expect(pair.b.finishResponse(event.request.request, pair.b.last_now));
            served = true;
        };
        for (pair.a_app[0..counts.a]) |event| switch (event) {
            .done => answered = true,
            .failed => return error.TestUnexpectedResult,
            else => {},
        };
        if (answered) break;
    }
    try std.testing.expect(served and answered);

    const publication = try pair.b.publishGossipWithOptions(topic, "from the listener", .{ .allow_zero_peers = false }, pair.b.last_now);
    try std.testing.expectEqual(@as(usize, 1), publication.queued);
    var delivered = false;
    for (0..3000) |_| {
        _ = try pair.pump();
        for (pair.a_inbox.messages()) |message| {
            try std.testing.expectEqualStrings("from the listener", message.bytes);
            _ = pair.a.reportValidation(message.handle, .accept, pair.a.last_now);
            delivered = true;
        }
        if (delivered) break;
    }
    try std.testing.expect(delivered);
    try std.testing.expectEqual(dialed, try onlyConnection(&pair.a.transport.engine));
    try std.testing.expectEqualDeep(@as(?types.Address, listened), pair.b.transport.engine.localAddress(accepted));
}
