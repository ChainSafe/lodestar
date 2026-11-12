const std = @import("std");
const Now = @import("../types.zig").Now;
const t = @import("types.zig");
const enr = @import("enr.zig");
const Catalog = @import("catalog.zig").Catalog;
const dialing = @import("dialing.zig");
const a = std.testing.allocator;
const address: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9001 } };
const local: t.PeerId = .{ .bytes = @splat(0) };
const opts: Catalog.Options = .{ .capacity = 4, .max_peers = 4, .target_peers = 4, .min_outbound = 0, .outbound_reserve = 1 };

const support = @import("dialing_catalog_test_support.zig");
const candidate = support.candidate;
const admit = support.admit;

const remembered = @import("remembered.zig");
const unix_s: u64 = 1_700_000_000;

fn at(ms: u64) Now {
    return Now.fromMilliseconds(.{ .mono_ms = ms, .unix_s = @intCast(unix_s + ms / 1000) });
}

fn funnel(c: *const Catalog, origin: remembered.Origin) [3]u64 {
    return c.remembered.counters.funnel[@intFromEnum(origin)];
}

fn rememberedAt(c: *Catalog, now_ms: u64) []remembered.Record {
    const records = struct {
        var buffer: [remembered.capacity]remembered.Record = undefined;
    };
    return records.buffer[0..c.remembered.snapshot(remembered.seconds(at(now_ms)), &records.buffer)];
}

/// Dials each discovered candidate and lands its connection at `now_ms`, on connection index i.
fn dialAll(c: *Catalog, d: *dialing.Dialing, candidates: []const enr.Candidate, now_ms: u64) ![8]t.PeerRef {
    var peers: [8]t.PeerRef = undefined;
    for (candidates) |*value| try d.enqueueDiscovered(c, value, &.{}, &.{}, now_ms);
    var out: [8]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(candidates.len, d.poll(c, now_ms, out[0..candidates.len]));
    for (out[0..candidates.len]) |intent| {
        var index: u16 = 0;
        while (!candidates[index].peer.eql(&intent.peer)) index += 1;
        const conn: t.Handle = .{ .index = index, .generation = 1 };
        try std.testing.expect(d.dialStarted(intent.token, conn));
        peers[index] = admit(c, &intent.peer, index, .outbound, now_ms).admitted.peer;
        d.accepted(c, peers[index], conn, now_ms);
    }
    return peers;
}

test "remembered qualification takes our dialed endpoint once a ready connection served five minutes" {
    var c = try Catalog.initWithIntents(a, opts, 2, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 1 });
    const dialed = try candidate(1, 0);
    const peer = (try dialAll(&c, &d, &.{dialed}, 0))[0];
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    // A path change moves the connection, not the endpoint our dial proved.
    const moved: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 9002 } };
    try std.testing.expect(try c.updateEndpoint(peer, conn, &moved));
    const inbound = try candidate(2, 0);
    const inbound_conn: t.Handle = .{ .index = 1, .generation = 1 };
    const inbound_peer = admit(&c, &inbound.peer, inbound_conn.index, .inbound, 0).admitted.peer;
    for ([_]t.PeerRef{ peer, inbound_peer }, [_]t.Handle{ conn, inbound_conn }) |ref, handle| {
        try std.testing.expect(c.updateStatus(ref, handle, &.{}, 0));
    }
    c.rememberConnected(at(remembered.qualify_ms));
    try std.testing.expectEqual(@as(u16, 0), c.remembered.count);
    for ([_]t.PeerRef{ peer, inbound_peer }, [_]t.Handle{ conn, inbound_conn }) |ref, handle| {
        try std.testing.expect(c.updateMetadata(ref, handle, &.{}, 0));
    }
    c.rememberConnected(at(remembered.qualify_ms - 1));
    try std.testing.expectEqual(@as(u16, 0), c.remembered.count);
    try std.testing.expectEqual([3]u64{ 1, 1, 0 }, funnel(&c, .fresh));
    c.rememberConnected(at(remembered.qualify_ms));
    const qualified: remembered.Record = .{ .peer = dialed.peer, .address = address, .qualified_at_s = unix_s + 300 };
    try std.testing.expectEqualDeep(@as([]const remembered.Record, &.{qualified}), rememberedAt(&c, remembered.qualify_ms));
    c.rememberConnected(at(remembered.qualify_ms + 60_000));
    try std.testing.expectEqual(unix_s + 360, rememberedAt(&c, remembered.qualify_ms + 60_000)[0].qualified_at_s);
    try std.testing.expectEqual([3]u64{ 1, 1, 1 }, funnel(&c, .fresh));
    try std.testing.expectEqual([3]u64{ 0, 0, 0 }, funnel(&c, .remembered));
    // A local ban forgets the peer at once, and service no longer requalifies it.
    try std.testing.expectEqual(t.ReputationDecision.ban, c.report(peer, .fatal, remembered.qualify_ms + 60_000).?);
    try std.testing.expectEqual(@as(usize, 0), rememberedAt(&c, remembered.qualify_ms + 60_000).len);
    c.rememberConnected(at(remembered.qualify_ms + 120_000));
    try std.testing.expectEqual(@as(usize, 0), rememberedAt(&c, remembered.qualify_ms + 120_000).len);
}

test "remembered records refresh at a served close and drop on rejection, health, ban and identity mismatch" {
    const wide: Catalog.Options = .{ .capacity = 8, .max_peers = 8, .target_peers = 8, .min_outbound = 0, .outbound_reserve = 1 };
    var c = try Catalog.initWithIntents(a, wide, 8, 16, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 8, .concurrent_max = 8, .seed = 1 });
    var candidates: [7]enr.Candidate = undefined;
    var seeds: [7]remembered.Record = undefined;
    for (&candidates, &seeds, 0..) |*value, *seed, i| {
        value.* = try candidate(@intCast(i + 1), 0);
        seed.* = .{ .peer = value.peer, .address = address, .qualified_at_s = unix_s - 60 };
    }
    c.remembered.load(&seeds, &local, unix_s, c.random.random());
    const peers = try dialAll(&c, &d, candidates[0..6], 0);
    const now = at(remembered.qualify_ms);
    var conns: [6]t.Handle = undefined;
    for (&conns, 0..) |*conn, i| conn.* = .{ .index = @intCast(i), .generation = 1 };
    // A remote shutdown ends service without rejecting us, so it refreshes the record.
    try std.testing.expect(c.disconnect(peers[0], conns[0], .remote_goodbye, .{ .ready = true, .rejection = .shutdown }, now));
    // A close that shows the peer ineligible keeps the record as it was.
    try std.testing.expect(c.disconnect(peers[1], conns[1], .incompatible_fork, .{ .ready = true }, now));
    try std.testing.expect(c.disconnect(peers[2], conns[2], .remote_goodbye, .{ .ready = true, .rejection = .too_many_peers }, now));
    try std.testing.expect(c.disconnect(peers[3], conns[3], .health_timeout, .{ .ready = true }, now));
    // A ban during an already scheduled close forgets the peer, and the close does not restore it.
    try std.testing.expect(c.markUnavailable(peers[4], conns[4], .count_pruning));
    _ = c.report(peers[4], .fatal, now.millis());
    try std.testing.expect(c.disconnect(peers[4], conns[4], .count_pruning, .{ .ready = true }, now));
    // A host verdict can ban a peer after its connection closed.
    try std.testing.expect(c.disconnect(peers[5], conns[5], .transport_closed, .{ .ready = true }, now));
    try std.testing.expectEqual(@as(usize, 4), rememberedAt(&c, remembered.qualify_ms).len);
    try std.testing.expectEqual(t.ReputationDecision.ban, c.report(peers[5], .fatal, now.millis()).?);
    // Another identity answered at the seventh peer's endpoint.
    try d.enqueueDiscovered(&c, &candidates[6], &.{}, &.{}, 0);
    var out: [1]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), d.poll(&c, 0, &out));
    const handle: t.Handle = .{ .index = 6, .generation = 1 };
    try std.testing.expect(d.dialStarted(out[0].token, handle));
    try std.testing.expect(d.dialClosed(&c, handle, .peer_id_mismatch, 1));
    const records = rememberedAt(&c, remembered.qualify_ms);
    try std.testing.expectEqual(@as(usize, 2), records.len);
    for (records) |value| {
        const expected: u64 = if (value.peer.eql(&candidates[0].peer)) unix_s + 300 else unix_s - 60;
        try std.testing.expect(value.peer.eql(&candidates[0].peer) or value.peer.eql(&candidates[1].peer));
        try std.testing.expectEqual(expected, value.qualified_at_s);
    }
    try std.testing.expectEqual([3]u64{ 7, 6, 6 }, funnel(&c, .fresh));
}

test "replayed remembered candidates meet the rejection memory, the endpoint history and general demand" {
    const wide: Catalog.Options = .{ .capacity = 8, .max_peers = 8, .target_peers = 8, .min_outbound = 0, .outbound_reserve = 1 };
    var c = try Catalog.initWithIntents(a, wide, 8, 16, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 8, .concurrent_max = 4, .seed = 1 });
    var seeds: [5]remembered.Record = undefined;
    for (&seeds, 0..) |*seed, i| seed.* = .{
        .peer = .{ .bytes = @splat(@intCast(i + 1)) },
        .address = .{ .ip4 = .{ .octets = .{ 10, @intCast(i + 1), 0, 1 }, .port = 9000 } },
        .qualified_at_s = unix_s,
    };
    const rejected, const failed, const known, const backoff, const clean = seeds;
    _ = c.history.reject(c.history.identityKey(&rejected.peer), .too_many_peers, 0);
    const key = c.history.endpointKey(&failed.peer, failed.address);
    for (0..2) |_| c.history.recordEndpoint(key, .health, 0, 0);
    _ = admit(&c, &known.peer, 0, .inbound, 0).admitted;
    // A connection that just closed leaves the peer's row backing off.
    const closed = admit(&c, &backoff.peer, 1, .inbound, 0).admitted.peer;
    try std.testing.expect(c.disconnect(closed, .{ .index = 1, .generation = 1 }, .transport_closed, .{}, at(0)));
    c.remembered.load(&seeds, &local, unix_s, c.random.random());
    try std.testing.expectEqual(@as(usize, 1), dialing.Dialing.replayRemembered(&c, &.{}, &.{}, at(0)));
    try std.testing.expect(c.remembered.nextReplay(unix_s) == null);
    try std.testing.expectEqual([5]u64{ 1, 1, 1, 2, 0 }, c.remembered.counters.replays);
    // Without general demand, selection holds back a candidate that has no ENR coverage.
    d.configureSelection(&c, &.{}, false, &.{}, 0);
    var out: [4]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 0), d.poll(&c, 0, &out));
    d.configureSelection(&c, &.{}, true, &.{}, 0);
    try std.testing.expectEqual(@as(usize, 1), d.poll(&c, 0, &out));
    try std.testing.expect(out[0].peer.eql(&clean.peer));
    try std.testing.expect(out[0].address.eql(clean.address));
    try std.testing.expectEqual([3]u64{ 1, 0, 0 }, funnel(&c, .remembered));
    // Replay neither loads nor refreshes a record's time.
    try std.testing.expectEqual(unix_s, rememberedAt(&c, 0)[0].qualified_at_s);
}

/// Seeds `count` remembered records tagged 1 to `count`, each in its own /24 across five /16s.
fn seedRemembered(c: *Catalog, comptime count: usize) void {
    var seeds: [count]remembered.Record = undefined;
    for (&seeds, 0..) |*seed, i| seed.* = .{
        .peer = .{ .bytes = @splat(@intCast(i + 1)) },
        .address = .{ .ip4 = .{ .octets = .{ 10, @intCast(i % 5), @intCast(i), 1 }, .port = 9000 } },
        .qualified_at_s = unix_s,
    };
    c.remembered.load(&seeds, &local, unix_s, c.random.random());
}

/// The tag of a seeded remembered identity, or null for any other peer.
fn seedTag(peer: *const t.PeerId, count: usize) ?u8 {
    const tag = peer.bytes[0];
    return if (tag >= 1 and tag <= count and std.mem.allEqual(u8, &peer.bytes, tag)) tag else null;
}

test "replay uses configured dial concurrency without a separate pacing deadline" {
    const wide: Catalog.Options = .{ .capacity = 64, .max_peers = 64, .target_peers = 64, .min_outbound = 0, .outbound_reserve = 1 };
    var c = try Catalog.initWithIntents(a, wide, 64, 64, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 64, .concurrent_max = 32, .seed = 1 });
    seedRemembered(&c, 48);
    try std.testing.expectEqual(@as(usize, 48), dialing.Dialing.replayRemembered(&c, &.{}, &.{}, at(0)));
    try std.testing.expectEqual(@as(usize, 0), dialing.Dialing.replayRemembered(&c, &.{}, &.{}, at(0)));
    d.configureSelection(&c, &.{}, true, &.{}, 0);
    var out: [64]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 32), d.poll(&c, 0, &out));
    try std.testing.expectEqual(@as(usize, 0), d.poll(&c, 0, out[32..]));
    try std.testing.expectEqual(@as(u16, 32), d.attempts().total);
    var seen: [49]bool = @splat(false);
    for (out[0..32]) |selected| {
        const tag = seedTag(&selected.peer, 48).?;
        try std.testing.expect(!seen[tag]);
        seen[tag] = true;
        try std.testing.expect(d.dialDeferred(&c, selected.token, 0));
    }
    try std.testing.expectEqual(@as(usize, 16), d.poll(&c, 0, &out));
    for (out[0..16]) |selected| {
        const tag = seedTag(&selected.peer, 48).?;
        try std.testing.expect(!seen[tag]);
        seen[tag] = true;
    }
    try std.testing.expect(std.mem.allEqual(bool, seen[1..], true));
    try std.testing.expectEqual(@as(usize, 0), d.poll(&c, 999, &out));
    try std.testing.expectEqual(at(1000).monotonic, d.schedule(&c, 1).deadline.?);
    try std.testing.expectEqual([3]u64{ 48, 0, 0 }, funnel(&c, .remembered));
}

test "replay shares general discovery priority without claiming missing subnet coverage" {
    for ([_]bool{ false, true }) |general| {
        var c = try Catalog.initWithIntents(a, opts, 4, 8, 1);
        defer c.deinit(a);
        var d = try dialing.Dialing.init(.{ .capacity = 4, .concurrent_max = 4, .seed = 1 });
        const context: t.ForkContext = .{};
        const wanted: t.Coverage = .{ .groups = .full, .syncnets = 1 };
        var fresh = try candidate(31, 0);
        fresh.hints.custody_group_count = context.custody_groups;
        const needed = try candidate(32, 1);
        try d.enqueueDiscovered(&c, &fresh, &context, &wanted, 0);
        try d.enqueueDiscovered(&c, &needed, &context, &wanted, 0);
        seedRemembered(&c, 2);
        try std.testing.expectEqual(@as(usize, 2), dialing.Dialing.replayRemembered(&c, &context, &wanted, at(0)));
        d.configureSelection(&c, &wanted, general, &context, 0);
        var out: [4]dialing.Dialing.SelectedDial = undefined;
        try std.testing.expectEqual(@as(usize, if (general) 4 else 2), d.poll(&c, 0, &out));
        try std.testing.expect(out[0].peer.eql(&needed.peer));
        if (general) {
            try std.testing.expect(seedTag(&out[1].peer, 2) != null);
            try std.testing.expect(seedTag(&out[2].peer, 2) != null);
            try std.testing.expect(out[3].peer.eql(&fresh.peer));
        } else try std.testing.expect(out[1].peer.eql(&fresh.peer));
    }
}

test "remembered candidates replace failed intents for known and new identities" {
    for ([_]bool{ false, true }) |known| {
        var c = try Catalog.initWithIntents(a, opts, 1, 8, 1);
        defer c.deinit(a);
        var d = try dialing.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 1 });
        const incoming = try candidate(73, 0);
        var previous: ?t.PeerRef = null;
        if (known) {
            const peer = admit(&c, &incoming.peer, 0, .outbound, 0).admitted.peer;
            try std.testing.expect(c.disconnect(peer, .{ .index = 0, .generation = 1 }, .host, .{}, at(1)));
            var events: [1]t.Event = undefined;
            _ = c.pollEvents(&events);
            previous = peer;
        }
        const retained = try candidate(74, 0);
        try d.enqueueDiscovered(&c, &retained, &.{}, &.{}, 2);
        c.edit(c.find(&retained.peer).?).?.dial.failures = 1;
        const seeds = [_]remembered.Record{.{ .peer = incoming.peer, .address = address, .qualified_at_s = unix_s }};
        c.remembered.load(&seeds, &local, unix_s, c.random.random());
        try std.testing.expectEqual(@as(usize, 1), dialing.Dialing.replayRemembered(&c, &.{}, &.{}, at(10_000)));
        const accepted = c.find(&incoming.peer).?;
        if (previous) |peer| try std.testing.expectEqual(peer, accepted);
        try std.testing.expectEqual(remembered.Origin.remembered, c.rowFor(accepted).?.dial.origin);
        try std.testing.expect(c.intents.isSet(accepted.index));
        try std.testing.expect(c.find(&retained.peer) == null);
        try std.testing.expectEqual(@as(u16, 1), c.intent_count);
    }
}

test "remembered origin does not make unrelated ENR hints satisfy subnet demand" {
    var c = try Catalog.initWithIntents(a, opts, 2, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 1 });
    const rediscovered = try candidate(73, 2);
    const seed: remembered.Record = .{ .peer = rediscovered.peer, .address = address, .qualified_at_s = unix_s };
    c.remembered.load(&.{seed}, &local, unix_s, c.random.random());
    const wanted: t.Coverage = .{ .syncnets = 1 };
    try std.testing.expectEqual(@as(usize, 1), dialing.Dialing.replayRemembered(&c, &.{}, &wanted, at(0)));
    try d.enqueueDiscovered(&c, &rediscovered, &.{}, &wanted, 0);
    d.configureSelection(&c, &wanted, false, &.{}, 0);
    var out: [1]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 0), d.poll(&c, 0, &out));
    d.configureSelection(&c, &wanted, true, &.{ .digest = @splat(1) }, 0);
    try std.testing.expectEqual(@as(usize, 0), d.poll(&c, 0, &out));
    try std.testing.expectEqual(@as(u2, 0), c.rowFor(c.find(&rediscovered.peer).?).?.dial.priority);
    d.configureSelection(&c, &wanted, true, &.{}, 0);
    try std.testing.expectEqual(@as(usize, 1), d.poll(&c, 0, &out));
    try std.testing.expect(out[0].peer.eql(&rediscovered.peer));
}
