const std = @import("std");
const Setup = @import("network_core_test_support.zig").Setup;
const types = @import("types.zig");
const Dialing = @import("peers/dialing.zig").Dialing;
const time = @import("time.zig");
const test_support = @import("quic/test_support.zig");
const fault_io = @import("fault_io");

test "core connection deadlines preserve fractions through millisecond expiry" {
    const setup = try std.testing.allocator.create(Setup);
    defer std.testing.allocator.destroy(setup);
    setup.* = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    const core = &setup.client;
    var now = setup.pair.now;
    now.monotonic.raw.nanoseconds += 900_000;
    const identity = setup.server.peerId();
    const addresses = [_]types.Address{setup.server.transport.localAddress()};
    try std.testing.expectError(error.InvalidDeadline, core.connectUntil(&identity, &addresses, now, now.monotonic));
    const deadline = now.monotonic.addDuration(.{ .clock = .awake, .raw = .fromNanoseconds(500_000) });
    try core.connectUntil(&identity, &addresses, now, deadline);
    const catalog = &core.peer_manager.catalog;
    const peer = catalog.find(&identity).?;
    var close: [Dialing.attempts_max]types.Handle = undefined;
    const due_ms = now.millis() + 2;
    try std.testing.expectEqual(due_ms, catalog.rowFor(peer).?.dial.manual_until_ms);
    now.monotonic = time.milliseconds(due_ms - 1);
    try std.testing.expectEqual(@as(usize, 0), core.peer_manager.expireDials(now, &close).len);
    try std.testing.expectEqual(due_ms, catalog.rowFor(peer).?.dial.manual_until_ms);
    try std.testing.expectError(error.InvalidDeadline, core.connectUntil(&identity, &addresses, now, setup.pair.now.monotonic));
    now.monotonic = time.milliseconds(due_ms);
    try std.testing.expectEqual(@as(usize, 0), core.peer_manager.expireDials(now, &close).len);
    try std.testing.expect(catalog.find(&identity) == null);
}

test "core advance uses supplied time after immediate application shutdown" {
    const setup = try std.testing.allocator.create(Setup);
    defer std.testing.allocator.destroy(setup);
    setup.* = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    const core = &setup.client;
    core.beginGracefulClose(setup.pair.now);
    try std.testing.expect(!core.protocols.applications_open);
    var tick = setup.pair.now;
    tick.monotonic = time.milliseconds(tick.millis() + 1);
    const result = core.advance(setup.pair.io(), .{ .now = tick, .readiness = .{} }, .{}, .{});
    try std.testing.expect(result.failure == null);
    try std.testing.expectEqual(tick, result.transport.now);
    try std.testing.expect(!core.protocols.applications_open);
}

test "core peer close delivery schedules transport retirement" {
    const setup = try std.testing.allocator.create(Setup);
    defer std.testing.allocator.destroy(setup);
    setup.* = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    const core = &setup.client;
    const now = setup.pair.now;
    try std.testing.expect(core.closePeer(&setup.server.peerId(), now));
    try setup.pair.pump();
    const closed = core.advance(setup.pair.io(), .{ .now = now, .readiness = .{} }, .{}, .{});
    try std.testing.expect(closed.failure == null);
    var closed_count: usize = 0;
    for (closed.transport_events) |event| closed_count += @intFromBool(event == .closed);
    try std.testing.expectEqual(@as(usize, 1), closed_count);
    try std.testing.expect(core.transport.engine.releasesPending());
    try std.testing.expectEqual(@as(u16, 1), core.transport.engine.resourceSnapshot().active);
    const pending = core.schedule(now, .{});
    try std.testing.expect(pending.runnable);
    const retired = core.advance(setup.pair.io(), .{ .now = now, .readiness = .{} }, .{}, .{});
    try std.testing.expect(retired.failure == null);
    try std.testing.expectEqual(@as(usize, 0), retired.transport_events.len);
    try std.testing.expectEqual(@as(u16, 0), core.transport.engine.resourceSnapshot().active);
    try std.testing.expect(!core.transport.engine.releasesPending());
}

test "core advance preserves completed events when readiness fails" {
    const setup = try std.testing.allocator.create(Setup);
    defer std.testing.allocator.destroy(setup);
    setup.* = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    const core = &setup.client;
    const failed = try setup.pair.dial();
    try std.testing.expect(core.transport.engine.failSend(failed));
    const result = core.advance(setup.pair.io(), .{ .now = setup.pair.now, .readiness = .{ .failure = error.WaitFailed } }, .{}, .{});
    try std.testing.expectEqual(error.WaitFailed, result.failure.?);
    try std.testing.expectEqual(@as(usize, 1), result.transport_events.len);
    try std.testing.expect(result.transport_events[0] == .closed);
}

test "core shutdown discards an undelivered request result on deinit" {
    const rr = @import("reqresp/root.zig");
    const setup = try std.testing.allocator.create(Setup);
    defer std.testing.allocator.destroy(setup);
    setup.* = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    const core = &setup.client;
    const sink = try std.testing.allocator.alloc(u8, rr.Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    defer core.deinit(setup.pair.io());
    _ = try core.sendReqRespRequest(&setup.server.peerId(), .blocks_by_root_v2, &([_]u8{0} ** 32), sink, .{}, setup.pair.now);
    core.shutdown(setup.pair.now);
    try std.testing.expectEqual(.stopped, core.phase());
    try std.testing.expect(core.protocols.reqresp.pendingCounts().outbound > 0);
    core.deinit(setup.pair.io());
    try std.testing.expect(!core.initialized);
    try std.testing.expectEqual(@as(usize, 0), core.allocations.bytes);
}

test "core shutdown discards retained host serving work without a release" {
    const rr = @import("reqresp/root.zig");
    const setup = try std.testing.allocator.create(Setup);
    defer std.testing.allocator.destroy(setup);
    setup.* = .{};
    try setup.init(&.{});
    defer setup.deinit();
    for (0..50) |_| try setup.step(0);
    const sink = try std.testing.allocator.alloc(u8, rr.Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    defer setup.client.deinit(setup.pair.io());
    _ = try setup.client.sendReqRespRequest(&setup.server.peerId(), .blocks_by_root_v2, &([_]u8{0} ** 32), sink, .{}, setup.pair.now);
    const core = &setup.server;
    var output: [1]rr.ReqResp.Event = undefined;
    var serving: ?rr.ReqResp.ServingHandle = null;
    for (0..50) |_| {
        try setup.pair.pump();
        _ = try setup.turn(&setup.client, .{});
        const result = try setup.turn(core, .{ .application = &output });
        if (result.counts.application == 1 and output[0] == .request) {
            serving = core.retainServing(output[0].request.request) orelse return error.TestUnexpectedResult;
            break;
        }
    }
    try std.testing.expect(serving != null);
    core.shutdown(setup.pair.now);
    try std.testing.expectError(error.ProtocolDisabled, core.protocols.request(&core.transport.engine, .{ .index = 0, .generation = 1 }, .ping_v1, &.{}, &.{}, .{}, setup.pair.now));
    try std.testing.expect(core.protocols.reqresp.serving.?.entries[serving.?.index].retained);
    core.deinit(setup.pair.io());
    try std.testing.expect(!core.initialized);
    try std.testing.expectEqual(@as(usize, 0), core.allocations.bytes);
}

test "core clock failure preserves dial intent without starting a connection" {
    const setup = try std.testing.allocator.create(Setup);
    defer std.testing.allocator.destroy(setup);
    setup.* = .{};
    try setup.initOwners(&.{});
    defer setup.deinit();
    const core = &setup.client;
    try core.connectUntil(&setup.server.peerId(), &.{setup.server.transport.localAddress()}, setup.pair.now, time.milliseconds(setup.pair.now.millis() + 10_000));
    const pending = core.waitPlan(setup.pair.now, .{}, .{});
    const dirty = core.peer_manager.catalog.dial_schedule_dirty;
    try std.testing.expectEqualDeep(pending, core.waitPlan(setup.pair.now, .{}, .{}));
    try std.testing.expectEqual(dirty, core.peer_manager.catalog.dial_schedule_dirty);
    const failed = core.advance(setup.pair.io(), .{ .now = setup.pair.now, .clock_failure = error.ClockOutOfRange }, .{}, .{});
    try std.testing.expectEqual(error.ClockOutOfRange, failed.failure.?);
    try std.testing.expectEqual(@as(u8, 0), failed.dial_started);
    try std.testing.expectEqual(@as(u8, 0), failed.dial_failed);
    const resumed = core.advance(setup.pair.io(), .{ .now = setup.pair.now }, .{}, .{});
    try std.testing.expect(resumed.failure == null);
    try std.testing.expectEqual(@as(u8, 1), resumed.dial_started);
}

test "core lifecycle only advances and closed owners reject new connections" {
    for ([_]bool{ false, true }) |graceful| {
        const setup = try std.testing.allocator.create(Setup);
        defer std.testing.allocator.destroy(setup);
        setup.* = .{};
        try setup.initOwners(&.{});
        defer setup.deinit();
        const core = &setup.server;
        try std.testing.expectEqual(.running, core.phase());
        if (graceful) {
            core.beginGracefulClose(setup.pair.now);
            core.beginGracefulClose(setup.pair.now);
            try std.testing.expectEqual(.quiescing, core.phase());
            try std.testing.expectError(error.Stopped, core.connectUntil(&setup.client.peerId(), &.{}, setup.pair.now, time.milliseconds(setup.pair.now.millis() + 1)));
            try std.testing.expectError(error.Stopped, core.addDirectPeer(&setup.client.peerId(), &.{}, setup.pair.now));
        } else core.shutdown(setup.pair.now);
        _ = try setup.pair.dial();
        try setup.pair.pump();
        try std.testing.expectEqual(@as(u16, 0), core.transport.engine.resourceSnapshot().active);
        core.shutdown(setup.pair.now);
        core.shutdown(setup.pair.now);
        core.beginGracefulClose(setup.pair.now);
        try std.testing.expectEqual(.stopped, core.phase());
        try std.testing.expectError(error.Stopped, core.transport.engine.dial(&test_support.client_address, setup.client.peerId(), setup.pair.now));
        core.deinit(setup.pair.io());
        try std.testing.expect(!core.initialized);
    }
}

test "core cancellation preserves prior failure and events while stopping further I/O" {
    const Core = @import("network_core.zig").NetworkCore;
    const Host = struct {
        calls: usize = 0,
        fn apply(context: *anyopaque, _: *Core, _: types.Now) Core.HostProgress {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.calls += 1;
            return .{};
        }
    };
    for ([_]bool{ false, true }) |already_cancelled| {
        const setup = try std.testing.allocator.create(Setup);
        defer std.testing.allocator.destroy(setup);
        setup.* = .{};
        try setup.initOwners(&.{});
        defer setup.deinit();
        const core = &setup.client;
        const failed = try setup.pair.dial();
        try std.testing.expect(core.transport.engine.failSend(failed));
        try core.connectUntil(&setup.server.peerId(), &.{test_support.server_address}, setup.pair.now, time.milliseconds(setup.pair.now.millis() + 1000));
        var host: Host = .{};
        var faults: fault_io = .{ .base = setup.pair.io(), .receive = .{} };
        const result = core.advance(faults.io(), .{
            .now = setup.pair.now,
            .readiness = .{ .cancelled = already_cancelled, .failure = error.WaitFailed, .host = true },
        }, .{}, .{ .handler = .{ .context = &host, .apply = Host.apply } });
        try std.testing.expect(result.cancelled);
        try std.testing.expectEqual(error.WaitFailed, result.failure.?);
        try std.testing.expectEqual(@as(usize, if (already_cancelled) 0 else 1), faults.receive_calls);
        try std.testing.expectEqual(@as(usize, 0), faults.send_calls);
        try std.testing.expectEqual(@as(usize, 0), host.calls);
        try std.testing.expectEqual(@as(u8, 0), result.dial_started);
        try std.testing.expectEqual(@as(usize, 1), result.transport_events.len);
        try std.testing.expectEqual(failed, result.transport_events[0].closed.conn);
    }
}
