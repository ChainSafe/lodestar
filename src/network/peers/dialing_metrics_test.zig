const std = @import("std");
const mod = @import("dialing.zig");
const t = @import("types.zig");
const a = std.testing.allocator;
const address: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 1234 } };

const support = @import("dialing_test_support.zig");
const initCatalog = support.initCatalog;
const selectNext = support.selectNext;
const accept = support.accept;
const disconnect = support.disconnect;
const expire = support.expire;

test "peer dial metrics count selections including local deferrals and ignore duplicate completions" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    try q.enqueue(&catalog, &peer, &.{address}, true, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(q.dialDeferred(&catalog, out[0].token, 100));
    try std.testing.expectEqual(@as(u64, 1), q.selected_attempts[@intFromEnum(mod.Dialing.Source.direct)]);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 1100, &out));
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    try std.testing.expect(q.dialStarted(out[0].token, conn));
    accept(&q, &catalog, &peer, conn, 1250);
    accept(&q, &catalog, &peer, conn, 1300);
    disconnect(&catalog, &peer, 1250, .transport_closed, 1500);
    const due = support.refreshAndWakeup(&q, &catalog, 1500, 1).?;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, due, &out));
    try std.testing.expect(q.dialStarted(out[0].token, conn));
    try std.testing.expect(q.dialClosed(&catalog, conn, .handshake_timeout, due + 250));
    try std.testing.expect(!q.dialClosed(&catalog, conn, .handshake_timeout, due + 300));
    try std.testing.expect(!q.dialFailed(&catalog, out[0].token, due + 300));
    try std.testing.expectEqual(@as(u64, 3), q.selected_attempts[@intFromEnum(mod.Dialing.Source.direct)]);
    try std.testing.expectEqual(@as(u64, 0), q.selected_attempts[@intFromEnum(mod.Dialing.Source.manual)]);
}

test "peer dial outcomes count every retired attempt once and retries count each failure once" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    try q.enqueueUntil(&catalog, &peer, &.{address}, true, 0, 3_600_000);
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    var now: u64 = 0;
    try std.testing.expect(q.dialStarted(try selectNext(&q, &catalog, &now), conn));
    try std.testing.expect(q.dialClosed(&catalog, conn, .peer_id_mismatch, now));
    // A retry that ends in a local start deferral or admission refusal leaves no failure to retry again.
    try std.testing.expect(q.dialDeferred(&catalog, try selectNext(&q, &catalog, &now), now));
    try std.testing.expect(q.dialStarted(try selectNext(&q, &catalog, &now), conn));
    try std.testing.expect(q.dialClosed(&catalog, conn, .{ .peer_closed = .{ .app = false, .code = 2 } }, now));
    try std.testing.expect(q.dialStarted(try selectNext(&q, &catalog, &now), conn));
    try std.testing.expect(q.deferConnection(&catalog, conn, now));
    try std.testing.expect(q.dialStarted(try selectNext(&q, &catalog, &now), conn));
    try std.testing.expect(q.dialClosed(&catalog, conn, .handshake_timeout, now));
    try std.testing.expect(q.dialStarted(try selectNext(&q, &catalog, &now), conn));
    try std.testing.expect(q.dialClosed(&catalog, conn, .dial_unanswered, now));
    _ = try selectNext(&q, &catalog, &now);
    now += 10_000;
    try expire(&q, &catalog, now);
    try std.testing.expect(q.dialFailed(&catalog, try selectNext(&q, &catalog, &now), now));
    // A health close of a dialed connection marks its endpoint, so the next dial is a redial after a health close.
    try std.testing.expect(q.dialStarted(try selectNext(&q, &catalog, &now), conn));
    accept(&q, &catalog, &peer, conn, now);
    disconnect(&catalog, &peer, now, .health_timeout, now + 100);
    now += 100;
    // An outbound attempt made redundant by an inbound connection is cancelled, not failed.
    try std.testing.expect(q.dialStarted(try selectNext(&q, &catalog, &now), conn));
    accept(&q, &catalog, &peer, .{ .index = 1, .generation = 1 }, now);
    try std.testing.expect(q.dialClosed(&catalog, conn, .handshake_timeout, now));
    for (q.outcomes, q.durations) |count, time| {
        try std.testing.expectEqual(@as(u64, 1), count);
        try std.testing.expectEqual(count, time.count);
    }
    var selected: u64 = 0;
    for (q.selected_attempts) |count| selected += count;
    try std.testing.expectEqual(@as(u64, q.outcomes.len), selected);
    for (q.retries) |count| try std.testing.expectEqual(@as(u64, 1), count);
}

test "peer dial time samples each retired attempt once from its own selection" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const first: t.PeerId = .{ .bytes = @splat(1) };
    const second: t.PeerId = .{ .bytes = @splat(2) };
    try q.enqueueUntil(&catalog, &first, &.{address}, false, 0, 5_000);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    const deferred = out[0].token;
    try std.testing.expect(q.dialDeferred(&catalog, deferred, 0));
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 1_000, &out));
    const connected = out[0].token;
    try std.testing.expectEqual(deferred.index, connected.index);
    try std.testing.expect(connected.generation != deferred.generation);
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    try std.testing.expect(!q.dialStarted(deferred, conn));
    try std.testing.expect(q.dialStarted(connected, conn));
    accept(&q, &catalog, &first, conn, 1_180);
    accept(&q, &catalog, &first, conn, 1_250);
    try std.testing.expect(!q.dialFailed(&catalog, connected, 1_250));
    disconnect(&catalog, &first, 1_180, .transport_closed, 1_300);
    // An unstarted manual attempt is cancelled when its intent lapses.
    try q.enqueueUntil(&catalog, &second, &.{address}, false, 1_300, 4_300);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 1_300, &out));
    try std.testing.expectEqual(connected.index, out[0].token.index);
    try expire(&q, &catalog, 4_300);
    _ = support.refreshAndWakeup(&q, &catalog, 4_300, 1);
    for ([_]t.DialOutcome{ .deferred, .connected, .cancelled }, [_]u64{ 0, 180, 3_000 }, [_]usize{ 0, 4, 8 }) |outcome, elapsed, bucket| {
        const time = &q.durations[@intFromEnum(outcome)];
        try std.testing.expectEqual(@as(u64, 1), time.count);
        try std.testing.expectEqual(@as(u128, elapsed), time.sum);
        try std.testing.expectEqual(@as(u64, 1), time.buckets[bucket]);
    }
    for (q.outcomes, q.durations) |count, time| try std.testing.expectEqual(count, time.count);
    try std.testing.expectEqual(@as(u64, 3), q.outcomes[@intFromEnum(t.DialOutcome.deferred)] + q.outcomes[@intFromEnum(t.DialOutcome.connected)] + q.outcomes[@intFromEnum(t.DialOutcome.cancelled)]);
}
