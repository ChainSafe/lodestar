const std = @import("std");
const Now = @import("../types.zig").Now;
const RequestIO = @import("RequestIO.zig");
const rr = @import("ReqResp.zig");
const Protocol = @import("protocol.zig").Protocol;
const PeerId = @import("../wire/peer_id.zig").PeerId;
const types = @import("../types.zig");
const support = @import("../quic/test_support.zig");
const Router = @import("../router.zig").Router;
const quotas = @import("admission_fixture.zig").quotas;
const policy_fixture = @import("policy_fixture.zig");
const Engine = @import("../quic/Engine.zig");
const constants = @import("constants.zig");

test "reqresp source connection replacement ignores stale retirement and keeps its admission source" {
    var owner = try rr.init(std.testing.allocator, options(1));
    defer owner.deinit();
    const endpoint: @import("udp").Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
    const other: @import("udp").Address = .{ .ip4 = .{ .octets = .{ 198, 51, 100, 1 }, .port = 2 } };
    const now = Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 });
    const old: types.Handle = .{ .index = 0, .generation = 1 };
    const replacement: types.Handle = .{ .index = 0, .generation = 2 };
    owner.connectionOpened(old, &.{ .bytes = @splat(1) }, &endpoint, now);
    const original = owner.admission.sourceRow(old);
    owner.connectionOpened(old, &.{ .bytes = @splat(1) }, &other, now);
    try std.testing.expectEqual(original, owner.admission.sourceRow(old));
    try std.testing.expectEqual(.allowed, owner.admission.limiter.start(original, 0));
    owner.connectionOpened(replacement, &.{ .bytes = @splat(1) }, &endpoint, now);
    owner.admission.disconnected(old);
    try std.testing.expectEqual(original, owner.admission.sourceRow(replacement));
    try std.testing.expectEqual(@as(u16, 1), owner.admission.limiter.connections);
    owner.admission.disconnected(replacement);
    owner.admission.disconnected(replacement);
    try std.testing.expectEqual(@as(u16, 0), owner.admission.limiter.connections);
    try std.testing.expect(owner.admission.limiter.rows[original].expires_ns > 0);
}

fn options(connections: u16) rr.Options {
    return .{
        .connections = connections,
        .outbound_max = 1,
        .serving_max = 4,
        .inbound_per_connection_max = 8,
        .forks = &.{},
        .admission = .{ .policy = policy_fixture.config(), .limits = .{
            .source = quotas(4, 1000),
            .global = quotas(4, 1000),
            .starts = .{ .tokens = 2, .period_ms = 1000 },
        } },
    };
}

test "inbound application quotas isolate neighboring sources and retain debt across identity changes" {
    for ([_]bool{ false, true }) |ipv6| {
        var opts = options(3);
        opts.admission.limits.global = quotas(8, 1000);
        var owner = try rr.init(std.testing.allocator, opts);
        defer owner.deinit();
        const endpoint: types.Address = if (ipv6)
            .{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1 }, .port = 1 } }
        else
            .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
        var neighbor = endpoint;
        if (ipv6) neighbor.ip6.octets[7] = 2 else neighbor.ip4.octets[3] = 2;
        var alias: types.Address = if (ipv6) endpoint else .{ .ip6 = .{ .octets = .{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 192, 0, 2, 1 }, .port = 2 } };
        if (ipv6) {
            alias.ip6.octets[15] = 2;
            alias.ip6.port = 2;
        }
        const now = Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 });
        const original: types.Handle = .{ .index = 0, .generation = 1 };
        const independent: types.Handle = .{ .index = 1, .generation = 1 };
        const colocated: types.Handle = .{ .index = 2, .generation = 1 };
        const reconnect: types.Handle = .{ .index = 0, .generation = 2 };
        const limiter = &owner.admission.limiter;
        owner.connectionOpened(original, &.{ .bytes = @splat(1) }, &endpoint, now);
        const row = owner.admission.sourceRow(original);
        for (0..2) |_| try std.testing.expectEqual(.allowed, limiter.start(row, 0));
        try std.testing.expectEqual(.allowed, limiter.take(row, .blocks_by_root_v2, 4, .fulu, 0));
        owner.connectionOpened(original, &.{ .bytes = @splat(1) }, &neighbor, now);
        try std.testing.expectEqual(row, owner.admission.sourceRow(original));

        owner.connectionOpened(independent, &.{ .bytes = @splat(1) }, &neighbor, now);
        const other_row = owner.admission.sourceRow(independent);
        try std.testing.expect(other_row != row);
        try std.testing.expectEqual(.allowed, limiter.start(other_row, 0));
        try std.testing.expectEqual(.allowed, limiter.take(other_row, .blocks_by_root_v2, 4, .fulu, 0));
        owner.connectionOpened(colocated, &.{ .bytes = @splat(2) }, &alias, now);
        try std.testing.expectEqual(row, owner.admission.sourceRow(colocated));
        try std.testing.expectEqual(.source_quota, limiter.start(row, 0));
        try std.testing.expectEqual(.source_quota, limiter.take(row, .blocks_by_root_v2, 1, .fulu, 0));
        owner.admission.disconnected(original);
        owner.admission.disconnected(colocated);
        owner.connectionOpened(reconnect, &.{ .bytes = @splat(3) }, &endpoint, now);
        owner.admission.disconnected(original);
        try std.testing.expectEqual(@as(u16, 2), limiter.connections);
        try std.testing.expectEqual(row, owner.admission.sourceRow(reconnect));
        try std.testing.expectEqual(.source_quota, limiter.take(row, .blocks_by_root_v2, 1, .fulu, 249));
        try std.testing.expectEqual(.allowed, limiter.take(row, .blocks_by_root_v2, 1, .fulu, 250));
        try std.testing.expectEqual(.source_quota, limiter.start(row, 499));
        try std.testing.expectEqual(.allowed, limiter.start(row, 500));
        owner.admission.disconnected(reconnect);
        owner.admission.disconnected(independent);
        try std.testing.expectEqual(@as(u16, 0), limiter.connections);
    }
}

fn inboundStream(pair: *support.Pair, conn: types.Handle) !types.StreamHandle {
    const stream = try pair.client.openStream(conn);
    try std.testing.expectEqual(1, try pair.client.write(stream, &.{0}, false));
    try pair.pump();
    var events: [16]Engine.Event = undefined;
    for (pair.events(&pair.server, &events)) |event| {
        if (event == .stream_opened) return event.stream_opened;
    }
    return error.TestUnexpectedResult;
}

test "inbound admission receive exhaustion and selected handoff checks precede the start debit" {
    for ([_]bool{ false, true }) |handoff| {
        var pair: support.Pair = .{};
        try pair.init(.{}, .{});
        defer pair.deinit();
        const handles = try support.connectPair(&pair);
        var owner = try rr.init(std.testing.allocator, options(128));
        defer owner.deinit();
        var router = try Router.init(std.testing.allocator, .{});
        defer router.deinit();
        defer owner.cancelAll(&pair.server, &router, pair.now);
        const source = &owner.admission;
        _ = try owner.accept(&pair.server, try inboundStream(&pair, handles.client), .{
            .protocol = .{ .reqresp = .ping_v1 },
            .leftover = &.{},
            .fin = false,
        }, pair.now);
        const first = owner.receive_layout.first(handles.server.index, .metadata_v1);
        owner.inbound[first].request.generation = std.math.maxInt(u32);
        if (!handoff) owner.inbound[first + 1].request.generation = std.math.maxInt(u32);
        var bytes: [RequestIO.read_buffer_length]u8 = @splat(0);
        const leftover: []const u8 = if (handoff) bytes[0 .. owner.inbound[first + 1].receive.read.len + 1] else &.{};
        const refused = try inboundStream(&pair, handles.client);
        defer pair.server.closeStream(refused, 0);
        try std.testing.expectError(if (handoff) error.InvalidHandoff else error.SlotsExhausted, owner.accept(&pair.server, refused, .{
            .protocol = .{ .reqresp = .metadata_v1 },
            .leftover = leftover,
            .fin = false,
        }, pair.now));
        try std.testing.expectEqual(pair.now.millis(), owner.admission.limiter.startAt(source.sourceRow(handles.server), pair.now.millis()));
        const third = try owner.accept(&pair.server, try inboundStream(&pair, handles.client), .{
            .protocol = .{ .reqresp = .metadata_v2 },
            .leftover = &.{},
            .fin = false,
        }, pair.now);
        try std.testing.expect(!owner.inbound[third.index].admission.start_pending);
        try std.testing.expectEqual(pair.now.millis() + 500, owner.admission.limiter.startAt(source.sourceRow(handles.server), pair.now.millis()));
    }
}

fn readySlot(owner: *rr, peer: u16, which: Protocol, ordinal: u16, identity: PeerId, accepted_ms: u64) u16 {
    std.debug.assert(peer < owner.options.connections);
    std.debug.assert(ordinal < constants.MAX_CONCURRENT_REQUESTS);
    const index: u16 = @intCast(owner.receive_layout.first(peer, which) + ordinal);
    const slot = &owner.inbound[index];
    std.debug.assert(slot.request.available());
    const conn: types.Handle = .{ .index = peer, .generation = 1 };
    const endpoint: @import("udp").Address = .{ .ip4 = .{ .octets = .{ 192, 0, identity.bytes[0], 1 }, .port = 1 } };
    owner.admission.connected(conn, &identity, &endpoint, accepted_ms);
    slot.admission.start_pending = true;
    slot.identity = identity;
    slot.state = .ready;
    slot.progress_ms = accepted_ms;
    slot.request = .{
        .direction = .inbound,
        .completion = .running,
        .generation = 1,
        .conn = conn,
        .stream = .{ .conn = conn, .id = ordinal * 4, .slot = @intCast(ordinal) },
        .protocol = which,
        .started_ms = accepted_ms,
    };
    return index;
}

fn deferStart(owner: *rr, index: u16, now_ms: u64) void {
    const slot = &owner.inbound[index];
    slot.admission.start_pending = true;
    slot.admission.eligible_ms = owner.admission.limiter.startAt(owner.admission.sourceRow(slot.request.conn), now_ms);
    slot.admission.wait = if (slot.admission.eligible_ms > now_ms) .start else .none;
    owner.settleSlot(.inbound, index);
}

test "inbound control admission gives colocated peers independent maintenance allowances" {
    for ([_]bool{ false, true }) |ipv6| {
        for (std.enums.values(Protocol)) |which| {
            if (!which.isControl()) continue;
            var opts = try @import("control_fixture.zig").controlOptions();
            opts.connections = 8;
            opts.admission = try rr.Options.Admission.defaults(&policy_fixture.config(), 8);
            opts.admission.scope = .peer;
            var owner = try rr.init(std.testing.allocator, opts);
            defer owner.deinit();
            const now = Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 });
            const endpoint: @import("udp").Address = if (ipv6)
                .{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1 }, .port = 1 } }
            else
                .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
            for (0..opts.connections) |peer| {
                const conn: types.Handle = .{ .index = @intCast(peer), .generation = 1 };
                const identity: PeerId = .{ .bytes = @splat(@as(u8, @intCast(peer + 1))) };
                owner.connectionOpened(conn, &identity, &endpoint, now);
                const index = readySlot(&owner, @intCast(peer), which, 0, identity, 0);
                try std.testing.expectEqual(.admitted, owner.admission.promote(&owner, index, now));
                const event = owner.inbound[index].request.pendingEvent().?;
                try std.testing.expect(event == .request);
                try std.testing.expectEqual(which, event.request.protocol);
                try std.testing.expectEqual(conn, event.request.conn);
            }
        }
    }
}

test "inbound control quotas follow peer identity across overlapping connections and reconnects" {
    var opts = try @import("control_fixture.zig").controlOptions();
    opts.connections = 2;
    opts.admission.limits.starts.tokens = 2;
    var owner = try rr.init(std.testing.allocator, opts);
    defer owner.deinit();
    const first: PeerId = .{ .bytes = @splat(1) };
    const second: PeerId = .{ .bytes = @splat(2) };
    const endpoint: @import("udp").Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
    const moved: @import("udp").Address = .{ .ip4 = .{ .octets = .{ 198, 51, 100, 2 }, .port = 2 } };
    const now = Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 });
    const old: types.Handle = .{ .index = 0, .generation = 1 };
    const overlap: types.Handle = .{ .index = 1, .generation = 1 };
    const reconnect: types.Handle = .{ .index = 0, .generation = 2 };
    const newcomer: types.Handle = .{ .index = 1, .generation = 2 };
    const limiter = &owner.admission.limiter;
    owner.connectionOpened(old, &first, &endpoint, now);
    const row = owner.admission.sourceRow(old);
    for (0..2) |_| try std.testing.expectEqual(.allowed, limiter.start(row, 0));
    try std.testing.expectEqual(.allowed, limiter.take(row, .ping_v1, 2, .fulu, 0));
    owner.connectionOpened(overlap, &first, &moved, now);
    try std.testing.expectEqual(row, owner.admission.sourceRow(overlap));
    try std.testing.expectEqual(.source_quota, limiter.start(row, 0));
    owner.admission.disconnected(old);
    owner.admission.disconnected(overlap);
    owner.connectionOpened(reconnect, &first, &moved, now);
    try std.testing.expectEqual(row, owner.admission.sourceRow(reconnect));
    try std.testing.expectEqual(.source_quota, limiter.start(row, 4999));
    try std.testing.expectEqual(.source_quota, limiter.take(row, .ping_v1, 1, .fulu, 4999));
    owner.connectionOpened(newcomer, &second, &moved, now);
    const independent = owner.admission.sourceRow(newcomer);
    try std.testing.expect(independent != row);
    try std.testing.expectEqual(.allowed, limiter.start(independent, 0));
    try std.testing.expectEqual(.allowed, limiter.take(independent, .ping_v1, 2, .fulu, 0));
    owner.admission.disconnected(old);
    owner.admission.disconnected(overlap);
    try std.testing.expectEqual(@as(u16, 2), limiter.connections);
    try std.testing.expectEqual(.allowed, limiter.start(row, 5000));
    try std.testing.expectEqual(.allowed, limiter.take(row, .ping_v1, 1, .fulu, 5000));
    owner.admission.disconnected(reconnect);
    owner.admission.disconnected(newcomer);
    try std.testing.expectEqual(@as(u16, 0), limiter.connections);
}

test "inbound admission shares serving capacity across identities at one source" {
    for ([_]bool{ false, true }) |ipv6| {
        var opts = options(6);
        opts.serving_max = 8;
        opts.admission.limits.starts.tokens = 16;
        opts.admission.limits.source = quotas(16, 1000);
        opts.admission.limits.global = quotas(16, 1000);
        var owner = try rr.init(std.testing.allocator, opts);
        defer owner.deinit();
        const now = Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 });
        for (0..6) |peer| {
            const source: u8 = if (peer == 5) 2 else 1;
            const endpoint: @import("udp").Address = if (ipv6)
                .{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8, 0, 1, 0, source, 0, 0, 0, 0, 0, 0, 0, @intCast(peer + 1) }, .port = @intCast(peer + 1) } }
            else
                .{ .ip4 = .{ .octets = .{ 192, 0, 2, source }, .port = @intCast(peer + 1) } };
            owner.connectionOpened(.{ .index = @intCast(peer), .generation = 1 }, &.{ .bytes = @splat(1) }, &endpoint, now);
            const index = readySlot(&owner, @intCast(peer), .blocks_by_root_v2, 0, .{ .bytes = @splat(@as(u8, @intCast(peer + 1))) }, 0);
            owner.inbound[index].admission.decoded(1, now.millis());
            _ = owner.admission.promote(&owner, index, now);
            const slot = &owner.inbound[index];
            if (peer == 4) {
                try std.testing.expectEqual(.ready, slot.state);
                try std.testing.expectEqual(.serving, slot.admission.wait);
                try std.testing.expectEqual(@as(u128, 0), slot.admission.paid);
                try std.testing.expect(slot.request.peer_fault == null);
            } else {
                try std.testing.expectEqual(.serving, slot.state);
                try std.testing.expectEqual(@as(u128, 1), slot.admission.paid);
            }
        }
        try std.testing.expectEqual(@as(usize, 5), owner.resourceSnapshot().serving_occupied);
    }
}

test "inbound admission retains serving source through migration disconnect and quota row reuse" {
    var opts = options(2);
    opts.serving_per_source_max = 1;
    var owner = try rr.init(std.testing.allocator, opts);
    defer owner.deinit();
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    var router = try Router.init(std.testing.allocator, .{});
    defer router.deinit();
    const endpoint: @import("udp").Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
    const other: @import("udp").Address = .{ .ip4 = .{ .octets = .{ 198, 51, 100, 1 }, .port = 2 } };
    const source = @import("admission.zig").Source.fromAddress(&endpoint);
    const other_source = @import("admission.zig").Source.fromAddress(&other);
    const conn: types.Handle = .{ .index = 0, .generation = 1 };
    var now = Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 });
    owner.connectionOpened(conn, &.{ .bytes = @splat(1) }, &endpoint, now);
    const original_row = owner.admission.sourceRow(conn);
    const index = readySlot(&owner, 0, .blocks_by_root_v2, 0, .{ .bytes = @splat(1) }, 0);
    owner.connectionOpened(conn, &.{ .bytes = @splat(1) }, &other, now);
    try std.testing.expectEqual(.admitted, owner.admission.promote(&owner, index, now));
    const retained = owner.retainServing(owner.inbound[index].request.handle(index)).?;
    try std.testing.expect(owner.serving.?.available(source) == null);
    try std.testing.expect(owner.serving.?.available(other_source) != null);

    owner.connectionClosed(&pair.server, &router, conn, now);
    var events: [1]rr.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), owner.pump(&pair.server, &router, now, &events));
    try std.testing.expectEqual(rr.Failure.connection_closed, events[0].failed.reason);
    try std.testing.expectEqual(@as(usize, 1), owner.resourceSnapshot().retiring);
    now = Now.fromMilliseconds(.{ .mono_ms = 2000, .unix_s = 2 });
    const replacement: types.Handle = .{ .index = 0, .generation = 2 };
    owner.connectionOpened(replacement, &.{ .bytes = @splat(1) }, &other, now);
    try std.testing.expectEqual(original_row, owner.admission.sourceRow(replacement));
    try std.testing.expectEqual(other_source, owner.admission.limiter.rows[original_row].key.address);
    try std.testing.expect(owner.serving.?.available(source) == null);
    try std.testing.expect(owner.serving.?.available(other_source) != null);

    owner.connectionOpened(.{ .index = 1, .generation = 1 }, &.{ .bytes = @splat(1) }, &endpoint, now);
    const waiting = readySlot(&owner, 1, .blocks_by_root_v2, 0, .{ .bytes = @splat(2) }, now.millis());
    _ = owner.admission.promote(&owner, waiting, now);
    try std.testing.expectEqual(.serving, owner.inbound[waiting].admission.wait);
    owner.settleSlot(.inbound, waiting);
    try std.testing.expect(owner.releaseServing(retained));
    owner.admission.promoteReady(&owner, now);
    try std.testing.expectEqual(.serving, owner.inbound[waiting].state);
    try std.testing.expect(!owner.releaseServing(retained));
    try std.testing.expect(owner.serving.?.available(source) == null);
    try std.testing.expectEqual(@as(usize, 0), owner.resourceSnapshot().retiring);
}

test "inbound admission delayed decode and equal timestamps retain acceptance then slot ordering" {
    var owner = try rr.init(std.testing.allocator, options(1));
    defer owner.deinit();
    const identity: PeerId = .{ .bytes = @splat(1) };
    const late = readySlot(&owner, 0, .blocks_by_root_v2, 0, identity, 10);
    const early = readySlot(&owner, 0, .blob_sidecars_by_root_v1, 0, identity, 9);
    try std.testing.expect(late < early);
    // The older request decodes after the newer one has joined admission.
    deferStart(&owner, late, 10);
    deferStart(&owner, early, 10);
    owner.admission.promoteReady(&owner, Now.fromMilliseconds(.{ .mono_ms = 10, .unix_s = 0 }));
    try std.testing.expect(owner.inbound[early].request.pendingEvent() != null);
    try std.testing.expect(owner.inbound[late].admission.start_pending);
    owner.admission.promoteReady(&owner, Now.fromMilliseconds(.{ .mono_ms = 10, .unix_s = 0 }));
    try std.testing.expect(owner.inbound[late].request.pendingEvent() != null);

    var ties = try rr.init(std.testing.allocator, options(1));
    defer ties.deinit();
    const low = readySlot(&ties, 0, .blocks_by_root_v2, 0, identity, 20);
    const high = readySlot(&ties, 0, .blob_sidecars_by_root_v1, 0, identity, 20);
    // Reverse readiness order and start the round-robin scan at the higher slot.
    deferStart(&ties, high, 20);
    deferStart(&ties, low, 20);
    ties.admission.connection_cursors[0].admission = @intCast(high);
    ties.admission.promoteReady(&ties, Now.fromMilliseconds(.{ .mono_ms = 20, .unix_s = 0 }));
    try std.testing.expect(ties.inbound[low].request.pendingEvent() != null);
    try std.testing.expect(ties.inbound[high].admission.start_pending);
}

test "inbound admission keeps an incomplete older request out of the ready start order" {
    var owner = try rr.init(std.testing.allocator, options(1));
    defer owner.deinit();
    const identity: PeerId = .{ .bytes = @splat(2) };
    const early = readySlot(&owner, 0, .blocks_by_root_v2, 0, identity, 1);
    owner.inbound[early].state = .receiving_request;
    deferStart(&owner, early, 2);
    const complete = readySlot(&owner, 0, .blob_sidecars_by_root_v1, 0, identity, 2);
    deferStart(&owner, complete, 2);
    owner.admission.promoteReady(&owner, Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = 0 }));
    try std.testing.expect(owner.inbound[complete].request.pendingEvent() != null);
    try std.testing.expect(owner.inbound[early].admission.start_pending);
}

test "inbound admission wide costs keep incremental credit and share source quota across connections" {
    var owner = try rr.init(std.testing.allocator, options(2));
    defer owner.deinit();
    const identity: PeerId = .{ .bytes = @splat(3) };
    const large = readySlot(&owner, 0, .blocks_by_root_v2, 0, identity, 0);
    const small = readySlot(&owner, 1, .blocks_by_root_v2, 0, identity, 0);
    try std.testing.expectEqual(.allowed, owner.admission.limiter.start(owner.admission.sourceRow(owner.inbound[large].request.conn), 0));
    owner.inbound[large].admission.start_pending = false;
    owner.inbound[large].admission.decoded(@as(u128, std.math.maxInt(u64)) * 2, 0);
    try std.testing.expectEqual(.allowed, owner.admission.limiter.take(owner.admission.sourceRow(.{ .index = 0, .generation = 1 }), .blocks_by_root_v2, 4, .phase0, 0));
    owner.settleSlot(.inbound, large);
    owner.settleSlot(.inbound, small);
    owner.admission.promoteReady(&owner, Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 }));
    for (1..5) |installment| {
        const now: types.Now = Now.fromMilliseconds(.{ .mono_ms = installment * 250, .unix_s = 0 });
        owner.admission.waitEnded(&owner.inbound[large]);
        if (owner.inbound[small].state == .ready) owner.admission.waitEnded(&owner.inbound[small]);
        owner.admission.promoteReady(&owner, now);
        // The rotation lets the small request take the second refill; the large one keeps its credit.
        const expected: u128 = if (installment == 1) 1 else installment - 1;
        try std.testing.expectEqual(expected, owner.inbound[large].admission.paid);
        if (installment == 2) try std.testing.expect(owner.inbound[small].request.pendingEvent() != null);
        if (installment < 2) try std.testing.expect(owner.inbound[small].request.pendingEvent() == null);
    }
    try std.testing.expectEqual(@as(u128, std.math.maxInt(u64)) * 2, owner.inbound[large].admission.cost);
    owner.admission.waitEnded(&owner.inbound[large]);
    owner.admission.promoteReady(&owner, Now.fromMilliseconds(.{ .mono_ms = 1250, .unix_s = 0 }));
    try std.testing.expectEqual(@as(u128, 4), owner.inbound[large].admission.paid);
    try std.testing.expect(owner.inbound[large].request.pendingEvent() != null);
}

test "inbound admission cancellation removes each wait without refunding or spinning" {
    var pair: support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    var router = try Router.init(std.testing.allocator, .{});
    defer router.deinit();
    const Wait = enum { start, tokens, serving };
    for ([_]Wait{ .start, .tokens, .serving }) |wait| {
        var owner = try rr.init(std.testing.allocator, options(1));
        defer owner.deinit();
        const identity: PeerId = .{ .bytes = @splat(4) };
        const index = readySlot(&owner, 0, .blocks_by_root_v2, 0, identity, 0);
        const slot = &owner.inbound[index];
        var serving: ?rr.ServingHandle = null;
        const holder: rr.RequestHandle = .{ .direction = .inbound, .index = index + 1, .generation = 1 };
        switch (wait) {
            .start => {
                for (0..2) |_| try std.testing.expectEqual(.allowed, owner.admission.limiter.start(owner.admission.sourceRow(.{ .index = 0, .generation = 1 }), 0));
                deferStart(&owner, index, 0);
            },
            .tokens => {
                try std.testing.expectEqual(.allowed, owner.admission.limiter.start(owner.admission.sourceRow(slot.request.conn), 0));
                slot.admission.start_pending = false;
                slot.admission.decoded(4, 0);
                try std.testing.expectEqual(.allowed, owner.admission.limiter.take(owner.admission.sourceRow(.{ .index = 0, .generation = 1 }), .blocks_by_root_v2, 3, .phase0, 0));
            },
            .serving => {
                owner.serving.?.per_source_max = 1;
                const source = owner.admission.limiter.rows[owner.admission.sourceRow(slot.request.conn)].key.address;
                const execution = owner.serving.?.available(source).?;
                _ = owner.serving.?.acquire(execution, holder, source);
                serving = owner.retainServing(holder) orelse return error.TestUnexpectedResult;
                owner.serving.?.retire(execution);
            },
        }
        owner.settleSlot(.inbound, index);
        owner.admission.promoteReady(&owner, Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 }));
        try std.testing.expectEqualStrings(@tagName(wait), @tagName(slot.admission.wait));
        if (wait == .tokens) try std.testing.expectEqual(@as(u128, 1), slot.admission.paid);
        const start_due = owner.admission.limiter.startAt(owner.admission.sourceRow(.{ .index = 0, .generation = 1 }), 0);
        const tokens_due = owner.admission.limiter.eligibleAt(owner.admission.sourceRow(.{ .index = 0, .generation = 1 }), .blocks_by_root_v2, 1, .phase0, 0);
        try std.testing.expect(owner.cancel(&pair.server, &router, slot.request.handle(index), Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 0 })));
        if (wait == .serving) try std.testing.expect(owner.releaseServing(serving.?));
        try std.testing.expectEqual(start_due, owner.admission.limiter.startAt(owner.admission.sourceRow(.{ .index = 0, .generation = 1 }), 0));
        try std.testing.expectEqual(tokens_due, owner.admission.limiter.eligibleAt(owner.admission.sourceRow(.{ .index = 0, .generation = 1 }), .blocks_by_root_v2, 1, .phase0, 0));
        try std.testing.expect(!owner.admission.due());
        const visits = owner.visits;
        for (0..32) |_| owner.admission.promoteReady(&owner, Now.fromMilliseconds(.{ .mono_ms = 1000, .unix_s = 0 }));
        try std.testing.expectEqual(visits, owner.visits);
        try std.testing.expectEqual(@as(usize, 0), owner.resourceSnapshot().serving_occupied);
        try std.testing.expectEqual(@as(u32, 0), owner.admission.ready.len);
        owner.admission.checkSlot(slot, index);
    }
}

test "inbound admission fair dispatch advances to the next peer before another request from a busy peer" {
    var opts = options(3);
    opts.work_per_pump_max = 1;
    var owner = try rr.init(std.testing.allocator, opts);
    defer owner.deinit();
    const now = Now.fromMilliseconds(.{ .mono_ms = 1000, .unix_s = 0 });
    var indexes: [4]u16 = undefined;
    for ([_]u16{ 0, 0, 1, 2 }, 0..) |peer, ordinal| {
        indexes[ordinal] = readySlot(&owner, peer, .blocks_by_root_v2, @intFromBool(ordinal == 1), .{ .bytes = @splat(@as(u8, @intCast(peer + 1))) }, now.millis());
        owner.settleSlot(.inbound, indexes[ordinal]);
        owner.admission.checkSlot(&owner.inbound[indexes[ordinal]], indexes[ordinal]);
    }
    var admitted: [4]bool = @splat(false);
    for ([_]usize{ 0, 2, 3, 1 }) |expected| {
        owner.admission.promoteReady(&owner, now);
        admitted[expected] = true;
        for (indexes, admitted) |index, ready| {
            const event = owner.inbound[index].request.pendingEvent();
            try std.testing.expectEqual(ready, event != null);
            if (event) |value| {
                try std.testing.expect(value == .request);
                try std.testing.expectEqual(index, value.request.request.index);
            }
            owner.admission.checkSlot(&owner.inbound[index], index);
        }
    }
    try std.testing.expect(!owner.admission.due());
}

test "inbound admission connection and port churn share one IPv4 or IPv6 source record" {
    for ([_]bool{ false, true }) |ipv6| {
        var owner = try rr.init(std.testing.allocator, options(1));
        defer owner.deinit();
        for (1..501) |generation| {
            const conn: types.Handle = .{ .index = 0, .generation = @intCast(generation) };
            const endpoint: @import("udp").Address = if (ipv6)
                .{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, @truncate(generation >> 8), @truncate(generation) }, .port = @intCast(generation) } }
            else
                .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = @intCast(generation) } };
            owner.admission.connected(conn, &.{ .bytes = @splat(@as(u8, @truncate(generation))) }, &endpoint, 0);
            const row = owner.admission.sourceRow(conn);
            try std.testing.expectEqual(@as(u16, 0), row);
            try std.testing.expectEqual(if (generation <= 2) .allowed else @as(@import("admission.zig").Decision, .source_quota), owner.admission.limiter.start(row, 0));
            owner.admission.disconnected(conn);
        }
        var occupied: usize = 0;
        for (owner.admission.limiter.rows) |row| occupied += @intFromBool(row.occupied);
        try std.testing.expectEqual(@as(usize, 1), occupied);
        try std.testing.expectEqual(@as(u16, 0), owner.admission.limiter.connections);
    }
}

test "inbound admission shares start ordering across identities in one source" {
    var owner = try rr.init(std.testing.allocator, options(2));
    defer owner.deinit();
    const endpoint: @import("udp").Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 1 } };
    for (0..2) |index| owner.admission.connected(.{ .index = @intCast(index), .generation = 1 }, &.{ .bytes = @splat(1) }, &endpoint, 0);
    const source = owner.admission.sourceRow(.{ .index = 0, .generation = 1 });
    for (0..2) |_| try std.testing.expectEqual(.allowed, owner.admission.limiter.start(source, 0));
    const early = readySlot(&owner, 1, .blocks_by_root_v2, 0, .{ .bytes = @splat(1) }, 1);
    const late = readySlot(&owner, 0, .blocks_by_root_v2, 0, .{ .bytes = @splat(2) }, 2);
    deferStart(&owner, late, 2);
    deferStart(&owner, early, 2);
    owner.admission.waitEnded(&owner.inbound[early]);
    owner.admission.waitEnded(&owner.inbound[late]);
    owner.admission.promoteReady(&owner, Now.fromMilliseconds(.{ .mono_ms = 500, .unix_s = 0 }));
    try std.testing.expect(owner.inbound[early].request.pendingEvent() != null);
    try std.testing.expect(owner.inbound[late].admission.start_pending);
    owner.admission.waitEnded(&owner.inbound[late]);
    owner.admission.promoteReady(&owner, Now.fromMilliseconds(.{ .mono_ms = 1000, .unix_s = 0 }));
    try std.testing.expect(owner.inbound[late].request.pendingEvent() != null);
}
