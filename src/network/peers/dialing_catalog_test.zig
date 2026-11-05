const std = @import("std");
const Now = @import("../types.zig").Now;
const t = @import("types.zig");
const custody = @import("custody.zig");
const Catalog = @import("catalog.zig").Catalog;
const dialing = @import("dialing.zig");
const history = @import("dial_history.zig");
const a = std.testing.allocator;
const dialing_test_support = @import("dialing_test_support.zig");
const preset = @import("preset");
const address: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9001 } };
const opts: Catalog.Options = .{ .capacity = 4, .max_peers = 4, .target_peers = 4, .min_outbound = 0, .outbound_reserve = 1 };

const support = @import("dialing_catalog_test_support.zig");
const candidate = support.candidate;
const admit = support.admit;
const expire = @import("dialing_test_support.zig").expire;

fn at(ms: u64) Now {
    return Now.fromMilliseconds(.{ .mono_ms = ms, .unix_s = 0 });
}

test "peer fold candidate promotion honors established quota and outbound reserve at time zero" {
    var c = try Catalog.initWithIntents(a, opts, 2, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 1 });
    const discovered = try candidate(1, 0);
    try d.enqueueDiscovered(&c, &discovered, &.{}, &.{}, 0);
    const peer = c.find(&discovered.peer).?;
    var snapshots: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 0), c.snapshots(&snapshots));
    try std.testing.expect(c.get(peer) == null);
    for (0..3) |i| {
        const identity: t.PeerId = .{ .bytes = @splat(@intCast(i + 1)) };
        try std.testing.expect(admit(&c, &identity, @intCast(i), .inbound, 0) == .admitted);
    }
    try std.testing.expectEqual(Catalog.Admission.capacity, admit(&c, &discovered.peer, 3, .inbound, 0));
    const accepted = admit(&c, &discovered.peer, 3, .outbound, 0).admitted;
    try std.testing.expectEqual(peer, accepted.peer);
    try std.testing.expect(accepted.fresh);
    d.accepted(&c, peer, .{ .index = 3, .generation = 1 }, 0);
    try std.testing.expectEqual(@as(usize, 4), c.snapshots(&snapshots));
    try std.testing.expectEqual(@as(u64, 0), c.get(peer).?.connected_at_ms);
    try std.testing.expectEqual(@as(u16, 0), c.intent_count);
    try std.testing.expectEqual(@as(u16, 4), c.connectedCount());
}

test "peer fold discovery capacity remains available while established bans and closure are retained" {
    var c = try Catalog.initWithIntents(a, opts, 1, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 1 });
    const first = try candidate(1, 1);
    const second = try candidate(2, 1);
    try d.enqueueDiscovered(&c, &first, &.{}, &.{ .syncnets = 1 }, 0);
    const peer = admit(&c, &first.peer, 0, .inbound, 0).admitted.peer;
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    d.accepted(&c, peer, conn, 0);
    _ = c.report(peer, .fatal, 0);
    try std.testing.expect(c.disconnect(peer, conn, .banned, .{}, at(0)));
    const rep = c.rowFor(peer).?.reputation;
    try d.enqueueDiscovered(&c, &second, &.{}, &.{ .syncnets = 1 }, 600_000);
    var events: [1]t.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&events));
    try std.testing.expectEqual(t.DisconnectReason.banned, events[0].closed.reason);
    try std.testing.expectEqual(peer, c.find(&first.peer).?);
    try std.testing.expectEqualDeep(rep, c.rowFor(peer).?.reputation);
    try std.testing.expectEqualDeep(first.hints, c.rowFor(peer).?.dial.hints.?);
    try std.testing.expect(!c.intents.isSet(peer.index));
    try std.testing.expectEqual(@as(u16, 1), c.intent_count);
    try std.testing.expectEqual(Catalog.Admission.banned, admit(&c, &first.peer, 0, .inbound, 600_000));
    const second_ref = c.find(&second.peer).?;
    c.rows[second_ref.index].dial.automatic = false;
    c.releaseIntent(second_ref);
    try d.enqueue(&c, &first.peer, &.{address}, true, 600_000);
    var out: [1]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 0), d.poll(&c, 600_000, &out));
    try std.testing.expect(dialing_test_support.refreshAndWakeup(&d, &c, 600_000, 1).? >= rep.ban_until_ms);
}

test "peer fold candidate selection revisits every retained intent after demand changes" {
    var c = try Catalog.initWithIntents(a, opts, 2, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 1 });
    const first = try candidate(1, 1);
    const second = try candidate(2, 2);
    try d.enqueueDiscovered(&c, &first, &.{}, &.{ .syncnets = 1 }, 0);
    try d.enqueueDiscovered(&c, &second, &.{}, &.{ .syncnets = 1 }, 0);
    d.configureSelection(&c, &.{ .syncnets = 1 }, false, &.{}, 0);
    try std.testing.expect(!c.rowFor(c.find(&second.peer).?).?.dial.selected);
    d.configureSelection(&c, &.{ .syncnets = 2 }, false, &.{}, 0);
    var out: [1]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), d.poll(&c, 0, &out));
    try std.testing.expect(out[0].peer.eql(&second.peer));
}

test "peer fold attempt generation advances independently of a retained peer reference" {
    var c = try Catalog.initWithIntents(a, opts, 1, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 1 });
    const first = try candidate(1, 1);
    try d.enqueue(&c, &first.peer, &.{address}, true, 0);
    const peer = c.find(&first.peer).?;
    var out: [1]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), d.poll(&c, 0, &out));
    const stale = out[0].token;
    try expire(&d, &c, 10_000);
    const next = dialing_test_support.refreshAndWakeup(&d, &c, 10_000, 1).?;
    try std.testing.expectEqual(@as(usize, 1), d.poll(&c, next, &out));
    try std.testing.expectEqual(peer, c.find(&first.peer).?);
    try std.testing.expectEqual(stale.generation + 1, out[0].token.generation);
    try std.testing.expect(!d.dialFailed(&c, stale, next));
    try std.testing.expect(!d.dialStarted(stale, .{ .index = 0, .generation = 1 }));
    try std.testing.expectEqual(@as(u16, 1), d.attempts().total);
}

test "peer fold connected custody makes progress independently of candidate work" {
    var c = try Catalog.initWithIntents(a, opts, 8, 16, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 8, .seed = 1 });
    const groups: u16 = @min(128, preset.NUMBER_OF_COLUMNS);
    const context: t.ForkContext = .{ .fork = .fulu, .custody_groups = groups, .minimum_sampling_groups = groups };
    for (0..8) |i| {
        var hint = try candidate(@intCast(i + 1), 1);
        hint.hints.custody_group_count = groups - 1;
        try d.enqueueDiscovered(&c, &hint, &context, &.{}, 0);
        if (i >= 2) continue;
        const peer = admit(&c, &hint.peer, @intCast(i), .outbound, 0).admitted.peer;
        const conn: t.Handle = .{ .index = @intCast(i), .generation = 1 };
        d.accepted(&c, peer, conn, 0);
        try std.testing.expect(c.updateStatus(peer, conn, &.{ .earliest_available_slot = 0 }, 0));
        try std.testing.expect(c.updateMetadata(peer, conn, &.{ .custody_group_count = groups - 1 }, 0));
        try std.testing.expect(c.get(peer).?.custody_groups == null);
    }
    for (0..64) |_| {
        var budget: u16 = custody.hashes_per_turn;
        const pending = c.advanceCustody(&context, 0, 60_000, &budget);
        try std.testing.expect(budget <= custody.hashes_per_turn);
        for (c.rows[0..2]) |row| {
            const work = row.custody_work.?;
            try std.testing.expect(work.totalHashes() > 0);
            try std.testing.expectEqual(groups, work.sampling_count);
        }
        if (!pending) break;
    }
    for (0..2) |i| {
        const snapshot = c.get(c.reference(i)).?;
        try std.testing.expectEqual(@as(usize, groups - 1), snapshot.custody_groups.?.count());
        try std.testing.expectEqual(@as(usize, groups), snapshot.sampling_groups.?.count());
    }
}

test "peer fold canonical disconnect backs off once even without a dial intent" {
    var c = try Catalog.initWithIntents(a, opts, 1, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 1 });
    const hint = try candidate(1, 1);
    const peer = admit(&c, &hint.peer, 0, .inbound, 0).admitted.peer;
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    try std.testing.expect(c.disconnect(peer, conn, .health_timeout, .{}, at(1)));
    try std.testing.expect(!c.disconnect(peer, conn, .health_timeout, .{}, at(2)));
    const before = c.rowFor(peer).?.dial;
    try d.enqueueDiscovered(&c, &hint, &.{}, &.{}, 2);
    try std.testing.expectEqual(before.failures, c.rowFor(peer).?.dial.failures);
    try std.testing.expectEqual(before.eligible_at_ms, dialing_test_support.refreshAndWakeup(&d, &c, 2, 1).?);
}

test "peer fold inbound health close leaves the discovered endpoint history untouched" {
    var c = try Catalog.initWithIntents(a, opts, 1, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 1 });
    const hint = try candidate(1, 0);
    try d.enqueueDiscovered(&c, &hint, &.{}, &.{}, 0);
    const key = c.history.endpointKey(&hint.peer, address);
    c.history.recordEndpoint(key, .health, hint.hints.sequence, 0);
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    const peer = admit(&c, &hint.peer, 0, .inbound, 0).admitted.peer;
    c.clearHealthStrikes(peer, conn);
    try std.testing.expectEqual(@as(u8, 1), c.history.strikesFor(key, hint.hints.sequence, 1));
    try std.testing.expect(c.disconnect(peer, conn, .health_timeout, .{}, at(1)));
    try std.testing.expectEqual(@as(u8, 1), c.history.strikesFor(key, hint.hints.sequence, 1));
    try std.testing.expectEqual(@as(u8, 1), c.rowFor(peer).?.dial.failures);
}

test "peer fold long-lived health disconnect restarts redial backoff" {
    var c = try Catalog.initWithIntents(a, opts, 1, 8, 1);
    defer c.deinit(a);
    const hint = try candidate(1, 1);
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    const peer = admit(&c, &hint.peer, 0, .inbound, 0).admitted.peer;
    c.edit(peer).?.dial.failures = 4;
    try std.testing.expect(c.disconnect(peer, conn, .health_timeout, .{}, at(300_000)));
    try std.testing.expectEqual(@as(u8, 1), c.rowFor(peer).?.dial.failures);
}

/// A QUIC-admitted connection whose probes never answer: Control cools the peer down and closes it
/// for health after about 25 s.
fn zombieRound(c: *Catalog, d: *dialing.Dialing, identity: *const t.PeerId, conn: t.Handle, now: *u64) !t.PeerRef {
    now.* = dialing_test_support.refreshAndWakeup(d, c, now.*, 1).?;
    var out: [1]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), d.poll(c, now.*, &out));
    try std.testing.expect(out[0].peer.eql(identity));
    try std.testing.expect(d.dialStarted(out[0].token, conn));
    const peer = admit(c, identity, conn.index, .outbound, now.*).admitted.peer;
    d.accepted(c, peer, conn, now.*);
    now.* += 25_000;
    try std.testing.expect(c.cooldown(peer, conn, now.*, 60_000));
    now.* += 2_000;
    try std.testing.expect(c.disconnect(peer, conn, .health_timeout, .{}, at(now.*)));
    var events: [4]t.Event = undefined;
    _ = c.pollEvents(&events);
    return peer;
}

test "peer fold zombie endpoint is blocked after two health closes across rediscovery and row replacement" {
    var options = opts;
    options.capacity = 1;
    options.max_peers = 1;
    options.target_peers = 1;
    options.outbound_reserve = 0;
    var c = try Catalog.initWithIntents(a, options, 2, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 1 });
    var zombie = try candidate(1, 0);
    const key = c.history.endpointKey(&zombie.peer, address);
    try d.enqueueDiscovered(&c, &zombie, &.{}, &.{}, 0);
    var now: u64 = 0;
    _ = try zombieRound(&c, &d, &zombie.peer, .{ .index = 0, .generation = 1 }, &now);
    try std.testing.expectEqual(@as(u8, 1), c.history.strikesFor(key, zombie.hints.sequence, now));
    // Once the cooldown lapses, a fresh admission reclaims the row and its backoff with it.
    now += 60_000;
    const first: t.PeerId = .{ .bytes = @splat(9) };
    _ = admit(&c, &first, 4, .inbound, now).admitted;
    try std.testing.expect(c.find(&zombie.peer) == null);
    try std.testing.expect(c.disconnect(c.find(&first).?, .{ .index = 4, .generation = 1 }, .host, .{}, at(now)));
    var events: [1]t.Event = undefined;
    _ = c.pollEvents(&events);
    zombie.hints.sequence = 2;
    try d.enqueueDiscovered(&c, &zombie, &.{}, &.{}, now);
    try std.testing.expectEqual(@as(u8, 1), c.rowFor(c.find(&zombie.peer).?).?.dial.failures);
    const peer = try zombieRound(&c, &d, &zombie.peer, .{ .index = 1, .generation = 1 }, &now);
    try std.testing.expectEqual(@as(u64, 1), d.retries[@intFromEnum(t.DialFailure.health)]);
    try std.testing.expect(c.history.blocked(key, zombie.hints.sequence, now));
    try std.testing.expect(!c.intents.isSet(peer.index));
    try std.testing.expectEqual(@as(?u64, null), dialing_test_support.refreshAndWakeup(&d, &c, now, 1));
    zombie.hints.sequence = 3;
    try std.testing.expectError(error.RecentlyFailed, d.enqueueDiscovered(&c, &zombie, &.{}, &.{}, now));
    now += 60_000;
    const second: t.PeerId = .{ .bytes = @splat(10) };
    _ = admit(&c, &second, 5, .inbound, now).admitted;
    try std.testing.expect(c.find(&zombie.peer) == null);
    zombie.hints.sequence = 4;
    try std.testing.expectError(error.RecentlyFailed, d.enqueueDiscovered(&c, &zombie, &.{}, &.{}, now));
    try d.enqueueDiscovered(&c, &zombie, &.{}, &.{}, now - 60_000 + history.endpoint_memory_ms);
}

/// Dials the discovered peer, lands the connection, and has the remote end it with `rejection`.
fn rejectedRound(c: *Catalog, d: *dialing.Dialing, identity: *const t.PeerId, index: u16, rejection: t.Rejection, now_ms: u64) !void {
    var out: [1]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), d.poll(c, now_ms, &out));
    try std.testing.expect(out[0].peer.eql(identity));
    const conn: t.Handle = .{ .index = index, .generation = 1 };
    try std.testing.expect(d.dialStarted(out[0].token, conn));
    const peer = admit(c, identity, conn.index, .outbound, now_ms).admitted.peer;
    d.accepted(c, peer, conn, now_ms);
    try std.testing.expect(c.disconnect(peer, conn, .remote_goodbye, .{ .rejection = rejection }, at(now_ms)));
    var events: [4]t.Event = undefined;
    _ = c.pollEvents(&events);
}

test "peer fold a full peer waits 5, 15 then 60 minutes across row reclamation and fresh records" {
    var c = try Catalog.initWithIntents(a, opts, 2, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 1 });
    var full = try candidate(1, 0);
    var now: u64 = 0;
    for ([_]u64{ 5, 15, 60, 5 }, 0..) |minutes, round| {
        // Once its memory lapses, the full peer's next rejection starts over.
        if (round == 3) now += history.rejection_memory_ms - 60 * 60_000;
        try d.enqueueDiscovered(&c, &full, &.{}, &.{}, now);
        try rejectedRound(&c, &d, &full.peer, @intCast(round), .too_many_peers, now);
        if (round == 0) {
            for (0..3) |i| {
                const other: t.PeerId = .{ .bytes = @splat(@intCast(20 + i)) };
                try std.testing.expect(admit(&c, &other, @intCast(4 + i), .inbound, now) == .admitted);
            }
            try std.testing.expect(c.find(&full.peer) == null);
        }
        full.hints.sequence += 1;
        const until = now + minutes * 60_000;
        try std.testing.expectError(error.RecentlyRejected, d.enqueueDiscovered(&c, &full, &.{}, &.{}, until - 1));
        now = until;
    }
    try std.testing.expectEqual(@as(u64, 4), d.refused.identity[@intFromEnum(t.Rejection.too_many_peers)]);
    try std.testing.expectEqual(@as(u64, 4), c.rejections[@intFromEnum(t.Rejection.too_many_peers)]);
}

test "peer fold early closes escalate while manual and inbound connections bypass them until a kept connection clears them" {
    var c = try Catalog.initWithIntents(a, opts, 2, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 1 });
    var gated = try candidate(1, 0);
    var now: u64 = 0;
    var block_end: u64 = 0;
    for ([_]u64{ 1, 15, 60 }, 0..) |minutes, round| {
        now = block_end;
        try d.enqueueDiscovered(&c, &gated, &.{}, &.{}, now);
        try rejectedRound(&c, &d, &gated.peer, @intCast(round), .early_close, now);
        gated.hints.sequence += 1;
        block_end = now + minutes * 60_000;
        try std.testing.expectError(error.RecentlyRejected, d.enqueueDiscovered(&c, &gated, &.{}, &.{}, block_end - 1));
    }
    try d.enqueue(&c, &gated.peer, &.{address}, false, now);
    const due = dialing_test_support.refreshAndWakeup(&d, &c, now, 1).?;
    try std.testing.expect(due < block_end);
    var out: [1]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), d.poll(&c, due, &out));
    try std.testing.expect(out[0].peer.eql(&gated.peer));
    try std.testing.expect(d.dialDeferred(&c, out[0].token, due));
    const conn: t.Handle = .{ .index = 7, .generation = 1 };
    const admission = admit(&c, &gated.peer, conn.index, .inbound, due);
    try std.testing.expect(admission == .admitted);
    d.accepted(&c, admission.admitted.peer, conn, due);
    const kept = due + history.kept_connection_ms;
    try std.testing.expect(c.disconnect(admission.admitted.peer, conn, .host, .{ .ready = true }, at(kept)));
    try d.enqueueDiscovered(&c, &gated, &.{}, &.{}, kept);
    try std.testing.expectEqual(@as(u64, 3), c.rejections[@intFromEnum(t.Rejection.early_close)]);
}

test "peer fold a full direct peer waits 5, 15 then 60 minutes while a manual connect dials through" {
    var c = try Catalog.initWithIntents(a, opts, 2, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 1 });
    const direct = try candidate(1, 0);
    try d.enqueue(&c, &direct.peer, &.{address}, true, 0);
    var now: u64 = 0;
    var until: u64 = 0;
    for ([_]u64{ 5, 15, 60 }, 0..) |minutes, round| {
        now = dialing_test_support.refreshAndWakeup(&d, &c, until, 1).?;
        try std.testing.expectEqual(until, now);
        try rejectedRound(&c, &d, &direct.peer, @intCast(round), .too_many_peers, now);
        try std.testing.expect(c.rowFor(c.find(&direct.peer).?).?.direct);
        until = now + minutes * 60_000;
    }
    try std.testing.expectEqual(until, dialing_test_support.refreshAndWakeup(&d, &c, now, 1).?);
    try d.enqueue(&c, &direct.peer, &.{address}, false, now);
    const due = dialing_test_support.refreshAndWakeup(&d, &c, now, 1).?;
    try std.testing.expect(due < now + dialing.Dialing.connect_timeout_ms);
    var out: [1]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), d.poll(&c, due, &out));
    try std.testing.expect(out[0].peer.eql(&direct.peer));
}

test "peer fold a direct peer whose rejection the history evicts mid-block waits out the old block" {
    var c = try Catalog.initWithIntents(a, opts, 2, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 1 });
    const direct = try candidate(1, 0);
    try d.enqueue(&c, &direct.peer, &.{address}, true, 0);
    try rejectedRound(&c, &d, &direct.peer, 0, .too_many_peers, 0);
    const block_end = 5 * 60_000;
    try std.testing.expectEqual(@as(u64, block_end), dialing_test_support.refreshAndWakeup(&d, &c, 0, 1).?);
    // Longer-lived entries fill the rest of the identity's probe window, so the next claim homed
    // on its slot evicts it.
    const key = c.history.identityKey(&direct.peer);
    for (1..history.probe_max) |offset| c.history.recordEndpoint(key +% offset, .peer_id_mismatch, 0, 1);
    _ = c.history.reject(key +% c.history.entries.len, .fault, 1);
    try std.testing.expectEqual(@as(u64, 0), c.history.rejectedUntil(key, 1));
    try std.testing.expectEqual(@as(u64, block_end), dialing_test_support.refreshAndWakeup(&d, &c, 1, 1).?);
    var out: [1]dialing.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 0), d.poll(&c, block_end - 1, &out));
    try std.testing.expectEqual(@as(u64, block_end), dialing_test_support.refreshAndWakeup(&d, &c, block_end - 1, 1).?);
    try std.testing.expectEqual(@as(usize, 1), d.poll(&c, block_end, &out));
    try std.testing.expect(out[0].peer.eql(&direct.peer));
}

test "peer discovery known and new identities share candidate replacement and refusal" {
    for ([_]bool{ false, true }) |known| {
        for ([_]bool{ false, true }) |matches| {
            var c = try Catalog.initWithIntents(a, opts, 1, 8, 1);
            defer c.deinit(a);
            var d = try dialing.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 1 });
            const incoming = try candidate(71, if (matches) 1 else 0);
            var previous: ?t.PeerRef = null;
            if (known) {
                const peer = admit(&c, &incoming.peer, 0, .outbound, 0).admitted.peer;
                _ = c.report(peer, .high_tolerance, 0);
                try std.testing.expect(c.disconnect(peer, .{ .index = 0, .generation = 1 }, .host, .{}, at(1)));
                var events: [1]t.Event = undefined;
                _ = c.pollEvents(&events);
                previous = peer;
            }
            const retained = try candidate(72, 0);
            try d.enqueueDiscovered(&c, &retained, &.{}, &.{ .syncnets = 1 }, 2);
            const victim = c.find(&retained.peer).?;
            const old = if (previous) |peer| c.rowFor(peer).?.* else null;
            if (matches) {
                try d.enqueueDiscovered(&c, &incoming, &.{}, &.{ .syncnets = 1 }, 3);
                const accepted = c.find(&incoming.peer).?;
                try std.testing.expect(c.intents.isSet(accepted.index));
                try std.testing.expect(c.rowFor(accepted).?.dial.automatic);
                try std.testing.expectEqual(@as(?u8, 1), c.rowFor(accepted).?.dial.hints.?.syncnets);
                try std.testing.expect(c.rowFor(accepted).?.dial.addresses[0].eql(incoming.addresses[0]));
                try std.testing.expect(c.find(&retained.peer) == null);
                if (previous) |peer| try std.testing.expectEqual(peer, accepted);
            } else {
                try std.testing.expectError(error.Capacity, d.enqueueDiscovered(&c, &incoming, &.{}, &.{ .syncnets = 1 }, 3));
                try std.testing.expectEqual(victim, c.find(&retained.peer).?);
                try std.testing.expect(c.intents.isSet(victim.index));
                if (previous) |peer| {
                    try std.testing.expect(!c.intents.isSet(peer.index));
                    try std.testing.expect(c.rowFor(peer).?.dial.hints == null);
                    try std.testing.expectEqualDeep(old.?.node_id, c.rowFor(peer).?.node_id);
                } else try std.testing.expect(c.find(&incoming.peer) == null);
            }
            try std.testing.expectEqual(@as(u16, 1), c.intent_count);
            if (previous) |peer| {
                const after = c.rowFor(peer).?;
                try std.testing.expectEqualDeep(old.?.reputation, after.reputation);
                try std.testing.expectEqual(old.?.dial.failures, after.dial.failures);
                try std.testing.expectEqual(old.?.dial.eligible_at_ms, after.dial.eligible_at_ms);
                try std.testing.expectEqual(old.?.dial.replacement_after_ms, after.dial.replacement_after_ms);
            }
        }
    }
}

test "peer dial selection counts host demand across connection membership and expiry" {
    var c = try Catalog.initWithIntents(a, opts, 2, 8, 1);
    defer c.deinit(a);
    var d = try dialing.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 1 });
    const record = try candidate(1, 0);
    try d.enqueue(&c, &record.peer, &.{address}, true, 0);
    d.configureSelection(&c, &.{}, false, &.{}, 0);
    try std.testing.expectEqual(@as(u16, 1), d.host_demand);
    try std.testing.expect(!c.intents_dirty);

    const peer = admit(&c, &record.peer, 0, .outbound, 0).admitted.peer;
    try std.testing.expect(c.intents_dirty);
    d.accepted(&c, peer, .{ .index = 0, .generation = 1 }, 0);
    d.configureSelection(&c, &.{}, false, &.{}, 0);
    try std.testing.expectEqual(@as(u16, 0), d.host_demand);
    try std.testing.expect(c.disconnect(peer, .{ .index = 0, .generation = 1 }, .host, .{}, at(1)));
    try std.testing.expect(c.intents_dirty);
    d.configureSelection(&c, &.{}, false, &.{}, 1);
    try std.testing.expectEqual(@as(u16, 1), d.host_demand);
    try std.testing.expect(c.setDirect(peer, false));
    try std.testing.expect(c.intents_dirty);
    d.configureSelection(&c, &.{}, false, &.{}, 1);
    try std.testing.expectEqual(@as(u16, 0), d.host_demand);

    try d.enqueueUntil(&c, &record.peer, &.{address}, false, 2, 100);
    d.configureSelection(&c, &.{}, false, &.{}, 2);
    try std.testing.expectEqual(@as(u16, 1), d.host_demand);
    try expire(&d, &c, 100);
    try std.testing.expect(c.intents_dirty);
    d.configureSelection(&c, &.{}, false, &.{}, 100);
    try std.testing.expectEqual(@as(u16, 0), d.host_demand);
    try std.testing.expect(!c.intents_dirty);
}
