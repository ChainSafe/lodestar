const std = @import("std");
const rr = @import("ReqResp.zig");
const codec = @import("codec.zig");
const Protocol = @import("protocol.zig").Protocol;
const PeerId = @import("../wire/peer_id.zig").PeerId;
const Handle = @import("../types.zig").Handle;
const harness = @import("test_pair.zig");
const policy = @import("policy_fixture.zig").config;
const quotas = @import("admission_fixture.zig").quotas;
const StreamHandle = @import("../types.zig").StreamHandle;
const multistream = @import("../wire/multistream.zig");

/// Two starts per second for each source and class, so each start past a burst of two waits
/// for a 500 ms refill. Protocol quotas stay out of the way.
const refill_ms = 500;

fn limits() rr.Options.Admission {
    return .{ .policy = policy(), .limits = .{
        .source = quotas(100, 1000),
        .global = quotas(100, 1000),
        .starts = .{ .tokens = 2, .period_ms = 1000 },
    } };
}

const ping = [_]u8{0} ** 8;

fn request(setup: *harness.Pair, which: Protocol, sink: []u8) !rr.RequestHandle {
    const bytes: []const u8 = if (which == .ping_v1) &ping else &.{};
    return setup.shared.client.requests(which).request(&setup.shared.pair.client, &setup.shared.client.router, setup.shared.handles.client, which, bytes, sink, .{}, setup.shared.pair.now);
}

/// Serves every request the server host receives, and records when each arrived.
const Exchange = struct {
    setup: *harness.Pair,
    delivered: [16]struct { index: u16, protocol: Protocol, at_ms: u64 } = undefined,
    delivered_len: usize = 0,
    done: usize = 0,
    client_failure: ?rr.Failure = null,
    server_failures: usize = 0,

    fn serve(self: *Exchange, owner: *rr, events: []const rr.Event) !void {
        const now = self.setup.shared.pair.now;
        for (events) |event| switch (event) {
            .request => |incoming| {
                self.delivered[self.delivered_len] = .{ .index = incoming.request.index, .protocol = incoming.protocol, .at_ms = now.millis() };
                self.delivered_len += 1;
                if (incoming.protocol.requiresResponse()) {
                    try owner.respond(incoming.request, &ping, null, now);
                } else try std.testing.expect(owner.finish(incoming.request, now));
            },
            .chunk_sent => |sent| try std.testing.expect(owner.finish(sent.request, now)),
            .failed => self.server_failures += 1,
            else => {},
        };
    }

    fn pump(self: *Exchange) !void {
        try self.setup.pumpOnce();
        try self.serve(&self.setup.shared.server.reqresp, self.setup.serverEvents()[0..self.setup.server_application_count]);
        try self.serve(&self.setup.shared.server.control_reqresp, self.setup.serverEvents()[self.setup.server_application_count..]);
        for (self.setup.clientEvents(), 0..) |event, index| switch (event) {
            .chunk => |chunk| try std.testing.expect((if (index < self.setup.client_application_count) &self.setup.shared.client.reqresp else &self.setup.shared.client.control_reqresp).consume(&self.setup.shared.pair.client, &self.setup.shared.client.router, chunk.request, self.setup.shared.pair.now)),
            .done => self.done += 1,
            .failed => |failed| self.client_failure = failed.reason,
            else => {},
        };
    }

    fn pumps(self: *Exchange, count: usize) !void {
        for (0..count) |_| try self.pump();
    }
};

fn refusals(owner: *const rr, which: Protocol, reason: rr.metrics.AdmissionRefusal) u64 {
    return owner.protocol_counters[@intFromEnum(which)].admission_refusals[@intFromEnum(reason)];
}

fn allRefusals(owner: *const rr) u64 {
    var total: u64 = 0;
    for (owner.protocol_counters) |counts| for (counts.admission_refusals) |count| {
        total += count;
    };
    return total;
}

fn waitingStarts(owner: *const rr) usize {
    return owner.resourceSnapshot().inbound_phases[@intFromEnum(rr.metrics.InboundPhase.waiting_start)];
}

/// The slot of the request accepted at `now_ms` that still waits for its start.
fn waiterAt(owner: *const rr, now_ms: u64) !u16 {
    var found: ?u16 = null;
    for (owner.inbound, 0..) |*slot, index| if (slot.request.running() and slot.admission.start_pending and slot.request.started_ms == now_ms) {
        if (found != null) return error.TestUnexpectedResult;
        found = @intCast(index);
    };
    return found orelse error.TestUnexpectedResult;
}

test "reqresp request start sequential requests past the quota negotiate, wait for their start, then complete" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .admission = limits() });
    defer setup.deinit();
    var exchange: Exchange = .{ .setup = &setup };
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    for ([_]u64{ 0, 0, refill_ms, refill_ms }, 0..) |wait, ordinal| {
        const handle = try request(&setup, .blocks_by_root_v2, sink);
        const sent = setup.shared.pair.now.millis();
        if (wait > 0) {
            try exchange.pumps(20);
            try std.testing.expectEqual(@as(?rr.Failure, null), exchange.client_failure);
            try std.testing.expectEqual(rr.RequestPhase.response, setup.shared.client.reqresp.outbound[handle.index].phase);
            try std.testing.expectEqual(ordinal, exchange.delivered_len);
            setup.shared.pair.advance(wait - 1);
            try exchange.pumps(5);
            try std.testing.expectEqual(ordinal, exchange.delivered_len);
            setup.shared.pair.advance(1);
        }
        for (0..20) |_| {
            try exchange.pump();
            if (exchange.done == ordinal + 1) break;
        }
        try std.testing.expectEqual(@as(?rr.Failure, null), exchange.client_failure);
        try std.testing.expectEqual(ordinal + 1, exchange.done);
        try std.testing.expectEqual(sent + wait, exchange.delivered[ordinal].at_ms);
    }
    try std.testing.expectEqual(@as(usize, 0), exchange.server_failures);
    try std.testing.expectEqual(@as(u64, 0), allRefusals(&setup.shared.server.reqresp));
}

test "reqresp request start waiters take one refill each in arrival order, not slot order" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .admission = limits() });
    defer setup.deinit();
    var exchange: Exchange = .{ .setup = &setup };
    const owner = &setup.shared.server.reqresp;
    const methods = [_]Protocol{ .blocks_by_root_v2, .blob_sidecars_by_root_v1, .blob_sidecars_by_root_v1, .blocks_by_root_v2, .blob_sidecars_by_root_v1, .blocks_by_root_v2 };
    var sinks: [methods.len][]u8 = undefined;
    for (methods, &sinks) |which, *sink| sink.* = try std.testing.allocator.alloc(u8, which.info().response_max);
    defer for (sinks) |sink| std.testing.allocator.free(sink);
    const start = setup.shared.pair.now.millis();
    for (methods[0..2], sinks[0..2]) |which, sink| _ = try request(&setup, which, sink);
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 2), exchange.done);
    var arrivals: [4]u16 = undefined;
    for (methods[2..], sinks[2..], &arrivals, 0..) |which, sink, *arrival, ordinal| {
        setup.shared.pair.advance(@intFromBool(ordinal > 0));
        _ = try request(&setup, which, sink);
        try exchange.pumps(20);
        arrival.* = try waiterAt(owner, setup.shared.pair.now.millis());
    }
    try std.testing.expectEqual(@as(usize, 4), waitingStarts(owner));
    try std.testing.expect(arrivals[1] < arrivals[0] and arrivals[3] < arrivals[2]);
    for (arrivals, 0..) |arrival, refill| {
        const due = start + (refill + 1) * refill_ms;
        setup.shared.pair.advance(due - 1 - setup.shared.pair.now.millis());
        try exchange.pumps(5);
        try std.testing.expectEqual(2 + refill, exchange.delivered_len);
        setup.shared.pair.advance(1);
        try exchange.pumps(5);
        try std.testing.expectEqual(3 + refill, exchange.delivered_len);
        try std.testing.expectEqual(arrival, exchange.delivered[2 + refill].index);
        try std.testing.expectEqual(due, exchange.delivered[2 + refill].at_ms);
        try std.testing.expectEqual(3 - refill, waitingStarts(owner));
    }
    try exchange.pumps(10);
    try std.testing.expectEqual(@as(usize, 6), exchange.done);
    try std.testing.expectEqual(@as(?rr.Failure, null), exchange.client_failure);
    try std.testing.expectEqual(@as(u64, 0), allRefusals(owner));
}

test "reqresp request start a request arriving as a refill falls due cannot take it from the waiter" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .admission = limits() });
    defer setup.deinit();
    var exchange: Exchange = .{ .setup = &setup };
    const owner = &setup.shared.server.reqresp;
    const blocks = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(blocks);
    const blobs = try std.testing.allocator.alloc(u8, Protocol.blob_sidecars_by_root_v1.info().response_max);
    defer std.testing.allocator.free(blobs);
    const start = setup.shared.pair.now.millis();
    for (0..2) |_| _ = try request(&setup, .blocks_by_root_v2, blocks);
    try exchange.pumps(20);
    _ = try request(&setup, .blob_sidecars_by_root_v1, blobs);
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 1), waitingStarts(owner));
    // The fresh stream and the waiter's due key reach the server in one turn, the stream first.
    setup.shared.pair.advance(refill_ms);
    const fresh = try setup.openRaw(.blocks_by_root_v2);
    try setup.shared.pair.pump();
    var application: [4]rr.Event = undefined;
    var control: [4]rr.Event = undefined;
    const counts = setup.shared.processServer(.{ .application = &application, .control = &control });
    try std.testing.expectEqual(@as(usize, 1), counts.application);
    try std.testing.expectEqual(Protocol.blob_sidecars_by_root_v1, application[0].request.protocol);
    try exchange.serve(owner, application[0..counts.application]);
    const deferred = try waiterAt(owner, start + refill_ms);
    try std.testing.expectEqual(Protocol.blocks_by_root_v2, owner.inbound[deferred].request.protocol);
    var wire: [codec.frame_scratch_max]u8 = undefined;
    const encoded = try codec.encodeRequest(&.{}, &wire);
    try std.testing.expectEqual(encoded.len, try setup.shared.pair.client.write(fresh, encoded, true));
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 3), exchange.delivered_len);
    setup.shared.pair.advance(refill_ms);
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 4), exchange.delivered_len);
    try std.testing.expectEqual(deferred, exchange.delivered[3].index);
    try std.testing.expectEqual(start + 2 * refill_ms, exchange.delivered[3].at_ms);
    try std.testing.expectEqual(@as(u64, 0), allRefusals(owner));
}

test "reqresp request start control requests keep their own starts while application requests wait" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .admission = limits() });
    defer setup.deinit();
    var exchange: Exchange = .{ .setup = &setup };
    const owner = &setup.shared.server.reqresp;
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    var pongs: [3][8]u8 = undefined;
    const start = setup.shared.pair.now.millis();
    for (0..3) |_| {
        _ = try request(&setup, .blocks_by_root_v2, sink);
        try exchange.pumps(20);
    }
    try std.testing.expectEqual(@as(usize, 2), exchange.done);
    try std.testing.expectEqual(@as(usize, 1), waitingStarts(owner));
    for (&pongs) |*pong| {
        _ = try request(&setup, .ping_v1, pong);
        try exchange.pumps(20);
    }
    try std.testing.expectEqual(@as(usize, 4), exchange.done);
    for (exchange.delivered[2..4]) |delivered| {
        try std.testing.expectEqual(Protocol.ping_v1, delivered.protocol);
        try std.testing.expectEqual(start, delivered.at_ms);
    }
    try std.testing.expectEqual(@as(usize, 2), waitingStarts(owner) + waitingStarts(&setup.shared.server.control_reqresp));
    setup.shared.pair.advance(refill_ms);
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 6), exchange.done);
    for (exchange.delivered[4..6]) |delivered| try std.testing.expectEqual(start + refill_ms, delivered.at_ms);
    try std.testing.expectEqual(@as(?rr.Failure, null), exchange.client_failure);
    try std.testing.expectEqual(@as(u64, 0), allRefusals(owner));
}

test "reqresp request start a cancelled waiter leaves no start reserved" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .admission = limits() });
    defer setup.deinit();
    var exchange: Exchange = .{ .setup = &setup };
    const owner = &setup.shared.server.reqresp;
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    const start = setup.shared.pair.now.millis();
    for (0..2) |_| _ = try request(&setup, .blocks_by_root_v2, sink);
    try exchange.pumps(20);
    try std.testing.expectEqual(start + refill_ms, owner.admission.limiter.startAt(owner.admission.sourceRow(setup.shared.handles.server), start));
    var cancelled: [2]rr.RequestHandle = undefined;
    for (&cancelled) |*handle| handle.* = try request(&setup, .blocks_by_root_v2, sink);
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 2), waitingStarts(owner));
    for (cancelled) |handle| try std.testing.expect(setup.shared.client.reqresp.cancel(&setup.shared.pair.client, &setup.shared.client.router, handle, setup.shared.pair.now));
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 2), exchange.server_failures);
    try std.testing.expectEqual(@as(u16, 0), owner.pendingCounts().inbound);
    try std.testing.expectEqual(@as(usize, 2), exchange.delivered_len);
    try std.testing.expectEqual(start + refill_ms, owner.admission.limiter.startAt(owner.admission.sourceRow(setup.shared.handles.server), start));
    setup.shared.pair.advance(refill_ms);
    _ = try request(&setup, .blocks_by_root_v2, sink);
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 3), exchange.delivered_len);
    try std.testing.expectEqual(start + refill_ms, exchange.delivered[2].at_ms);
    try std.testing.expectEqual(@as(usize, 3), exchange.done);
}

test "reqresp request start shutdown cancels its waiters without charging them" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .admission = limits() });
    defer setup.deinit();
    var exchange: Exchange = .{ .setup = &setup };
    const owner = &setup.shared.server.reqresp;
    const controls = &setup.shared.server.control_reqresp;
    const sink = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(sink);
    var pongs: [3][8]u8 = undefined;
    const start = setup.shared.pair.now.millis();
    for (0..2) |_| _ = try request(&setup, .blocks_by_root_v2, sink);
    for (pongs[0..2]) |*pong| _ = try request(&setup, .ping_v1, pong);
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 4), exchange.done);
    _ = try request(&setup, .blocks_by_root_v2, sink);
    _ = try request(&setup, .ping_v1, &pongs[2]);
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 2), waitingStarts(owner) + waitingStarts(controls));
    controls.cancelAll(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now);
    owner.cancelAll(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now);
    var application: [4]rr.Event = undefined;
    var control: [4]rr.Event = undefined;
    var cancelled: usize = 0;
    for (0..2) |_| {
        const application_count = owner.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &application);
        const control_count = controls.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, &control);
        for (application[0..application_count]) |event| try std.testing.expect(event.failed.reason == .cancelled);
        for (control[0..control_count]) |event| try std.testing.expect(event.failed.reason == .cancelled);
        cancelled += application_count + control_count;
    }
    try std.testing.expectEqual(@as(usize, 2), cancelled);
    try std.testing.expectEqual(@as(u16, 0), owner.pendingCounts().inbound);
    try std.testing.expectEqual(@as(usize, 0), waitingStarts(owner) + waitingStarts(controls));
    try std.testing.expectEqual(@as(usize, 4), exchange.delivered_len);
    for ([_]*rr{ owner, controls }) |instance| try std.testing.expectEqual(start + refill_ms, instance.admission.limiter.startAt(instance.admission.sourceRow(setup.shared.handles.server), start));
}

test "reqresp request start preserves distinct protocol and connection capacity limits" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .inbound_per_connection_max = 3, .admission = limits() });
    defer setup.deinit();
    var exchange: Exchange = .{ .setup = &setup };
    const owner = &setup.shared.server.reqresp;
    const blocks = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(blocks);
    const blobs = try std.testing.allocator.alloc(u8, Protocol.blob_sidecars_by_root_v1.info().response_max);
    defer std.testing.allocator.free(blobs);
    const start = setup.shared.pair.now.millis();
    for (0..2) |_| _ = try request(&setup, .blocks_by_root_v2, blocks);
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 2), exchange.done);
    for (0..2) |_| _ = try request(&setup, .blocks_by_root_v2, blocks);
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 2), waitingStarts(owner));
    try std.testing.expectEqual(start + refill_ms, owner.admission.limiter.startAt(owner.admission.sourceRow(setup.shared.handles.server), start));
    _ = try setup.openRaw(.blocks_by_root_v2);
    try exchange.pumps(10);
    try std.testing.expectEqual(@as(u64, 1), refusals(owner, .blocks_by_root_v2, .protocol_concurrency));
    _ = try request(&setup, .blob_sidecars_by_root_v1, blobs);
    try exchange.pumps(10);
    try std.testing.expectEqual(@as(usize, 3), waitingStarts(owner));
    _ = try setup.openRaw(.blocks_by_range_v2);
    try exchange.pumps(10);
    try std.testing.expectEqual(@as(u64, 1), refusals(owner, .blocks_by_range_v2, .connection_capacity));
    try std.testing.expectEqual(@as(u64, 2), allRefusals(owner));
    try std.testing.expectEqual(start + refill_ms, owner.admission.limiter.startAt(owner.admission.sourceRow(setup.shared.handles.server), start));
    try std.testing.expectEqual(@as(?rr.Failure, null), exchange.client_failure);
    try std.testing.expectEqual(@as(u16, 3), owner.pendingCounts().inbound);
}

test "reqresp request start a slow waiter retains source accounting after debt expiry" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .admission = limits() });
    defer setup.deinit();
    var exchange: Exchange = .{ .setup = &setup };
    const owner = &setup.shared.server.reqresp;
    const blocks = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
    defer std.testing.allocator.free(blocks);
    const blobs = try std.testing.allocator.alloc(u8, Protocol.blob_sidecars_by_root_v1.info().response_max);
    defer std.testing.allocator.free(blobs);
    const start = setup.shared.pair.now.millis();
    for (0..2) |_| _ = try request(&setup, .blocks_by_root_v2, blocks);
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 2), exchange.done);
    // An unfinished request stays owed its start after the previous starts replenish.
    const slow = try setup.openRaw(.blocks_by_root_v2);
    try exchange.pumps(10);
    const waiter = try waiterAt(owner, start);
    setup.shared.pair.advance(2 * refill_ms);
    const stranger = owner.admission.limiter.retain(&.{ .address = .{ .ip4 = .{ 192, 0, 2, 1 } } }, setup.shared.pair.now.millis());
    try std.testing.expectEqual(.allowed, owner.admission.limiter.start(stranger, setup.shared.pair.now.millis()));
    owner.admission.limiter.release(stranger);
    _ = try request(&setup, .blob_sidecars_by_root_v1, blobs);
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(?rr.Failure, null), exchange.client_failure);
    try std.testing.expectEqual(@as(usize, 3), exchange.delivered_len);
    try std.testing.expectEqual(@as(u16, 1), owner.pendingCounts().inbound);
    try std.testing.expect(owner.inbound[waiter].request.running());
    var wire: [codec.frame_scratch_max]u8 = undefined;
    const encoded = try codec.encodeRequest(&.{}, &wire);
    try std.testing.expectEqual(encoded.len, try setup.shared.pair.client.write(slow, encoded, true));
    try exchange.pumps(20);
    try std.testing.expectEqual(@as(usize, 4), exchange.delivered_len);
    try std.testing.expectEqual(@as(usize, 0), waitingStarts(owner));
    try std.testing.expectEqual(waiter, exchange.delivered[3].index);
    try std.testing.expectEqual(start + 2 * refill_ms, exchange.delivered[3].at_ms);
}

fn connectSource(owner: *rr, connection: u16, identity: *const PeerId, now_ms: u64) u16 {
    const conn: Handle = .{ .index = connection, .generation = std.math.maxInt(u32) };
    const endpoint: @import("udp").Address = .{ .ip4 = .{ .octets = .{ 192, 0, identity.bytes[0], 1 }, .port = 1 } };
    owner.admission.connected(conn, identity, &endpoint, now_ms);
    return owner.admission.sourceRow(conn);
}

/// A `.ready` request on connection index `connection` whose start accept deferred.
fn deferredSlot(owner: *rr, connection: u16, which: Protocol, identity: *const PeerId, now_ms: u64) u16 {
    const index: u16 = @intCast(owner.receive_layout.first(connection, which));
    const slot = &owner.inbound[index];
    const conn: Handle = .{ .index = connection, .generation = std.math.maxInt(u32) };
    slot.identity = identity.*;
    slot.state = .ready;
    slot.progress_ms = now_ms;
    slot.admission.start_pending = true;
    slot.admission.eligible_ms = owner.admission.limiter.startAt(connectSource(owner, connection, identity, now_ms), now_ms);
    slot.admission.wait = if (slot.admission.eligible_ms > now_ms) .start else .none;
    slot.request = .{
        .direction = .inbound,
        .generation = 1,
        .completion = .running,
        .protocol = which,
        .conn = conn,
        .stream = .{ .conn = conn, .slot = 0, .id = 0 },
        .started_ms = now_ms,
    };
    owner.settleSlot(.inbound, index);
    return index;
}

fn pumpOwner(setup: *harness.Pair, events: []rr.Event) usize {
    return setup.shared.server.reqresp.pump(&setup.shared.pair.server, &setup.shared.server.router, setup.shared.pair.now, events);
}

test "reqresp request start another source progresses while one waits" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .admission = limits() });
    defer setup.deinit();
    const owner = &setup.shared.server.reqresp;
    const limiter = &owner.admission.limiter;
    const waiting: PeerId = .{ .bytes = @splat(1) };
    const other: PeerId = .{ .bytes = @splat(2) };
    const start = setup.shared.pair.now.millis();
    const waiting_source = connectSource(owner, 1, &waiting, start);
    const other_source = connectSource(owner, 2, &other, start);
    for (0..2) |_| try std.testing.expectEqual(.allowed, limiter.start(waiting_source, start));
    const held = deferredSlot(owner, 1, .blocks_by_root_v2, &waiting, start);
    const free = deferredSlot(owner, 2, .blocks_by_root_v2, &other, start);
    var events: [4]rr.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), pumpOwner(&setup, &events));
    try std.testing.expectEqual(free, events[0].request.request.index);
    try std.testing.expectEqual(start + refill_ms, owner.inbound[held].admission.eligible_ms);
    // The other source was charged one start, so one of its two remains.
    try std.testing.expectEqual(.allowed, limiter.start(other_source, start));
    try std.testing.expectEqual(start + refill_ms, limiter.startAt(other_source, start));
    setup.shared.pair.advance(refill_ms - 1);
    try std.testing.expectEqual(@as(usize, 0), pumpOwner(&setup, &events));
    setup.shared.pair.advance(1);
    try std.testing.expectEqual(@as(usize, 1), pumpOwner(&setup, &events));
    try std.testing.expectEqual(held, events[0].request.request.index);
    try std.testing.expectEqual(start + 2 * refill_ms, limiter.startAt(waiting_source, setup.shared.pair.now.millis()));
}

test "reqresp request start a waiter that then waits for serving is charged its start once" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .serving_per_source_max = 1, .admission = limits() });
    defer setup.deinit();
    const owner = &setup.shared.server.reqresp;
    const limiter = &owner.admission.limiter;
    const identity: PeerId = .{ .bytes = @splat(1) };
    const start = setup.shared.pair.now.millis();
    const source = connectSource(owner, 1, &identity, start);
    for (0..2) |_| try std.testing.expectEqual(.allowed, limiter.start(source, start));
    // Retired but retained host work holds the source's only serving entry.
    const holder: rr.RequestHandle = .{ .index = 0, .generation = 1, .direction = .inbound };
    const address = limiter.accountKey(source).address;
    const entry = owner.serving.?.available(address).?;
    _ = owner.serving.?.acquire(entry, holder, address);
    const serving = owner.retainServing(holder) orelse return error.TestUnexpectedResult;
    owner.serving.?.retire(entry);
    const index = deferredSlot(owner, 1, .blocks_by_root_v2, &identity, start);
    var events: [4]rr.Event = undefined;
    try std.testing.expectEqual(@as(usize, 0), pumpOwner(&setup, &events));
    setup.shared.pair.advance(refill_ms);
    for (0..3) |_| try std.testing.expectEqual(@as(usize, 0), pumpOwner(&setup, &events));
    try std.testing.expectEqual(start + 2 * refill_ms, limiter.startAt(source, setup.shared.pair.now.millis()));
    setup.shared.pair.advance(refill_ms);
    try std.testing.expect(owner.releaseServing(serving));
    try std.testing.expectEqual(@as(usize, 1), pumpOwner(&setup, &events));
    try std.testing.expectEqual(index, events[0].request.request.index);
    try std.testing.expectEqual(start + 2 * refill_ms, limiter.startAt(source, setup.shared.pair.now.millis()));
}

test "reqresp protocol concurrency refusal preserves selection and returns a complete rate-limit response" {
    for ([_]u8{ 2, 8 }) |connection_limit| {
        var setup: harness.Pair = .{};
        try setup.init(.{}, .{ .inbound_per_connection_max = connection_limit });
        defer setup.deinit();
        for (0..2) |_| {
            const held = try setup.openRaw(.blocks_by_root_v2);
            try setup.awaitRawSelection(held, .blocks_by_root_v2);
        }
        const refused = try setup.openRaw(.blocks_by_root_v2);
        try expectRateLimitResponse(&setup, refused, "Rate limited: already 2 active requests for this protocol");
        const owner = &setup.shared.server.reqresp;
        try std.testing.expectEqual(@as(u64, 1), refusals(owner, .blocks_by_root_v2, .protocol_concurrency));
        try std.testing.expectEqual(@as(u16, 2), owner.pendingCounts().inbound);
    }
}

fn expectRateLimitResponse(setup: *harness.Pair, stream: StreamHandle, message: []const u8) !void {
    var dialer = try multistream.Dialer.init(Protocol.blocks_by_root_v2.id());
    var selected = false;
    var wire: [1024]u8 = undefined;
    var buffered: usize = 0;
    var scratch: [codec.frameLengthMax(codec.error_message_max)]u8 = undefined;
    var decoder = codec.Decoder.initResponse(.{ .min = 0, .max = 0 }, false, &.{}, &scratch);
    for (0..40) |_| {
        try setup.pumpOnce();
        const read = try setup.shared.pair.client.read(stream, wire[buffered..]);
        try std.testing.expectEqual(@as(?u64, null), read.reset_code);
        buffered += read.len;
        if (!selected) {
            const result = try dialer.feed(wire[0..buffered]);
            try std.testing.expect(result.status != .rejected);
            std.mem.copyForwards(u8, &wire, wire[result.consumed..buffered]);
            buffered -= result.consumed;
            selected = result.status == .accepted;
        }
        if (selected and buffered > 0) {
            const decoded = try decoder.feed(wire[0..buffered]);
            try std.testing.expectEqual(buffered, decoded.consumed);
            buffered = 0;
        }
        if (read.fin) {
            try std.testing.expect(selected and decoder.isDone());
            try std.testing.expectEqual(@as(u8, 139), decoder.result());
            try std.testing.expectEqualStrings(message, decoder.payload());
            return;
        }
    }
    return error.TestUnexpectedResult;
}

test "reqresp request start hard capacity refusal preserves an available start without a waiter" {
    {
        var setup: harness.Pair = .{};
        try setup.init(.{}, .{ .serving_max = 1, .inbound_per_connection_max = 1, .admission = limits() });
        defer setup.deinit();
        const owner = &setup.shared.server.reqresp;
        const now_ms = setup.shared.pair.now.millis();
        const held_stream = try setup.openRaw(.blocks_by_root_v2);
        try setup.awaitRawSelection(held_stream, .blocks_by_root_v2);
        const held_index: u16 = @intCast(owner.receive_layout.first(setup.shared.handles.server.index, .blocks_by_root_v2));
        const held = owner.inbound[held_index].request.handle(held_index);
        try std.testing.expectEqual(@as(usize, 0), waitingStarts(owner));
        var exchange: Exchange = .{ .setup = &setup };
        const blobs = try std.testing.allocator.alloc(u8, Protocol.blob_sidecars_by_root_v1.info().response_max);
        defer std.testing.allocator.free(blobs);
        _ = try request(&setup, .blob_sidecars_by_root_v1, blobs);
        try exchange.pumps(20);
        try std.testing.expectEqual(@as(u64, 1), refusals(owner, .blob_sidecars_by_root_v1, .connection_capacity));
        try std.testing.expectEqual(@as(?rr.Failure, .{ .peer_error = .{ .code = 139, .message_len = "Rate limited: connection receive capacity exhausted".len } }), exchange.client_failure);
        try std.testing.expect(owner.cancel(&setup.shared.pair.server, &setup.shared.server.router, held, setup.shared.pair.now));
        try exchange.pumps(10);
        exchange.client_failure = null;
        const blocks = try std.testing.allocator.alloc(u8, Protocol.blocks_by_root_v2.info().response_max);
        defer std.testing.allocator.free(blocks);
        _ = try request(&setup, .blocks_by_root_v2, blocks);
        try exchange.pumps(20);
        try std.testing.expectEqual(@as(usize, 1), exchange.delivered_len);
        try std.testing.expectEqual(now_ms, exchange.delivered[0].at_ms);
        try std.testing.expectEqual(now_ms, setup.shared.pair.now.millis());
        try std.testing.expectEqual(@as(usize, 0), waitingStarts(owner));
        try std.testing.expectEqual(@as(?rr.Failure, null), exchange.client_failure);
    }
}

test "reqresp connection capacity refusal preserves selection and finishes the error response" {
    var setup: harness.Pair = .{};
    try setup.init(.{}, .{ .inbound_per_connection_max = 1, .admission = limits() });
    defer setup.deinit();
    const owner = &setup.shared.server.reqresp;
    const held = try setup.openRaw(.blob_sidecars_by_root_v1);
    try setup.awaitRawSelection(held, .blob_sidecars_by_root_v1);
    const refused = try setup.openRaw(.blocks_by_root_v2);
    try expectRateLimitResponse(&setup, refused, "Rate limited: connection receive capacity exhausted");
    try std.testing.expectEqual(@as(u64, 1), refusals(owner, .blocks_by_root_v2, .connection_capacity));
    try std.testing.expectEqual(@as(u64, 1), allRefusals(owner));
    try std.testing.expectEqual(@as(u16, 1), owner.pendingCounts().inbound);
}
