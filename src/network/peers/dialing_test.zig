const std = @import("std");
const mod = @import("dialing.zig");
const t = @import("types.zig");
const a = std.testing.allocator;
const time = @import("../time.zig");
const address: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 1234 } };

const support = @import("dialing_test_support.zig");
const discovered = support.discovered;
const initCatalog = support.initCatalog;
const accept = support.accept;
const disconnect = support.disconnect;
const expire = support.expire;

test "peer dial expiry returns every started connection once at maximum concurrency" {
    const Dialing = mod.Dialing;
    var queue = try Dialing.init(.{ .capacity = Dialing.attempts_max, .concurrent_max = Dialing.attempts_max, .seed = 4 });
    var catalog = try initCatalog(a, queue.options);
    defer catalog.deinit(a);
    for (0..Dialing.attempts_max) |index| {
        const peer: t.PeerId = .{ .bytes = @splat(@intCast(index)) };
        try queue.enqueueUntil(&catalog, &peer, &.{address}, index % 2 == 0, 0, 10_000);
    }
    var selected: [Dialing.attempts_max]Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(selected.len, queue.poll(&catalog, 0, &selected));
    for (selected, 0..) |intent, index| {
        try std.testing.expect(queue.dialStarted(intent.token, .{ .index = @intCast(index), .generation = 1 }));
    }
    var expected: [Dialing.attempts_max]t.Handle = undefined;
    var count: usize = 0;
    for (catalog.rows) |*row| {
        if (row.attempt == null or row.direct) continue;
        expected[count] = queue.active[row.attempt.?].connection.?;
        count += 1;
    }
    for (queue.active) |attempt| {
        if (!catalog.rowFor(attempt.peer.?).?.direct) continue;
        expected[count] = attempt.connection.?;
        count += 1;
    }
    try std.testing.expectEqual(expected.len, count);
    var close: [Dialing.attempts_max]t.Handle = undefined;
    try std.testing.expectEqual(@as(usize, 0), queue.expire(&catalog, 9_999, &close));
    try std.testing.expectEqual(expected.len, queue.expire(&catalog, 10_000, &close));
    try std.testing.expectEqualSlices(t.Handle, &expected, &close);
    try std.testing.expectEqual(@as(usize, 0), queue.expire(&catalog, 10_000, &close));
    try std.testing.expectEqual(@as(u64, Dialing.attempts_max / 2), queue.outcomes[@intFromEnum(t.DialOutcome.cancelled)]);
    try std.testing.expectEqual(@as(u64, Dialing.attempts_max / 2), queue.outcomes[@intFromEnum(t.DialOutcome.expired)]);
    for (selected, 0..) |intent, index| {
        const conn: t.Handle = .{ .index = @intCast(index), .generation = 1 };
        try std.testing.expect(!queue.dialStarted(intent.token, conn));
        try std.testing.expect(!queue.dialClosed(&catalog, conn, .handshake_timeout, 10_000));
    }
}

test "peer dial cancellation returns its started connection once and preserves direct intent" {
    for ([_]bool{ false, true }) |direct| {
        var queue = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
        var catalog = try initCatalog(a, queue.options);
        defer catalog.deinit(a);
        const peer: t.PeerId = .{ .bytes = @splat(1) };
        try queue.enqueue(&catalog, &peer, &.{address}, direct, 0);
        var selected: [1]mod.Dialing.SelectedDial = undefined;
        try std.testing.expectEqual(@as(usize, 1), queue.poll(&catalog, 0, &selected));
        const conn: t.Handle = .{ .index = 0, .generation = 1 };
        try std.testing.expect(queue.dialStarted(selected[0].token, conn));
        try std.testing.expectEqual(conn, queue.cancelConnect(&catalog, &peer, 1).?);
        try std.testing.expect(queue.cancelConnect(&catalog, &peer, 1) == null);
        try std.testing.expectEqual(@as(usize, @intFromBool(direct)), catalog.intent_count);
        try std.testing.expectEqual(@as(u64, 1), queue.outcomes[@intFromEnum(t.DialOutcome.cancelled)]);
        try std.testing.expect(!queue.dialClosed(&catalog, conn, .handshake_timeout, 1));
        try std.testing.expect(!queue.dialFailed(&catalog, selected[0].token, 1));
    }
}

test "peer dial shutdown retires unstarted attempts and returns only started connections" {
    var queue = try mod.Dialing.init(.{ .capacity = 3, .concurrent_max = 3, .seed = 4 });
    var catalog = try initCatalog(a, queue.options);
    defer catalog.deinit(a);
    for (0..3) |index| {
        const peer: t.PeerId = .{ .bytes = @splat(@intCast(index)) };
        try queue.enqueue(&catalog, &peer, &.{address}, index != 0, 0);
    }
    var selected: [3]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(selected.len, queue.poll(&catalog, 0, &selected));
    const connections = [_]t.Handle{ .{ .index = 4, .generation = 1 }, .{ .index = 8, .generation = 2 } };
    for (selected[1..], connections) |intent, conn| try std.testing.expect(queue.dialStarted(intent.token, conn));
    var close: [mod.Dialing.attempts_max]t.Handle = undefined;
    try std.testing.expectEqual(connections.len, queue.shutdown(&catalog, 1, &close));
    try std.testing.expectEqualSlices(t.Handle, &connections, close[0..connections.len]);
    try std.testing.expectEqual(@as(usize, 0), catalog.intent_count);
    try std.testing.expectEqual(@as(u16, 0), catalog.direct_count);
    try std.testing.expectEqual(@as(usize, 0), queue.shutdown(&catalog, 1, &close));
    try std.testing.expectEqual(@as(u64, 3), queue.outcomes[@intFromEnum(t.DialOutcome.cancelled)]);
    for (selected) |intent| try std.testing.expect(!queue.dialFailed(&catalog, intent.token, 1));
}

test "peer dial preference gives automatic demand a turn with one or four attempts" {
    for ([_]u16{ 1, 4 }) |concurrency| {
        var q = try mod.Dialing.init(.{ .capacity = 8, .concurrent_max = concurrency, .seed = 4 });
        var catalog = try initCatalog(a, q.options);
        defer catalog.deinit(a);
        const automatic = try discovered(9, 1);
        try q.enqueueDiscovered(&catalog, &automatic, &.{}, &.{ .syncnets = 1 }, 0);
        q.configureSelection(&catalog, &.{ .syncnets = 1 }, true, &.{}, 0);
        for (0..7) |index| {
            const peer: t.PeerId = .{ .bytes = @splat(@as(u8, @intCast(index + 1))) };
            try q.enqueue(&catalog, &peer, &.{address}, index % 2 == 0, 0);
        }
        var out: [1]mod.Dialing.SelectedDial = undefined;
        for (0..concurrency) |_| {
            try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
            try std.testing.expect(!out[0].peer.eql(&automatic.peer));
            try std.testing.expect(q.dialDeferred(&catalog, out[0].token, 0));
        }
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
        try std.testing.expect(out[0].peer.eql(&automatic.peer));
    }
}

test "peer dial local admission refusal retires without failure or address rotation" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    try q.enqueue(&catalog, &peer, &.{ address, .{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 1234 } } }, true, 0);
    try std.testing.expect(!q.selectedPeer(&catalog, &peer, 0));
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(q.selectedPeer(&catalog, &peer, 0));
    try std.testing.expect(!q.selectedPeer(&catalog, &peer, 10_000));
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    try std.testing.expect(q.dialStarted(out[0].token, conn));
    try std.testing.expectEqual(@as(u16, 1), q.pendingPeers(&catalog, null));
    try std.testing.expectEqual(@as(u16, 0), q.pendingPeers(&catalog, &peer));
    try std.testing.expect(q.deferConnection(&catalog, conn, 100));
    try std.testing.expect(!q.selectedPeer(&catalog, &peer, 100));
    try std.testing.expect(!q.dialClosed(&catalog, conn, .handshake_timeout, 200));
    const row = catalog.rowFor(catalog.find(&peer).?).?;
    try std.testing.expectEqual(@as(u8, 0), row.dial.failures);
    try std.testing.expectEqual(@as(u8, 0), row.dial.address_index);
    try std.testing.expectEqual(@as(u64, 1_100), row.dial.eligible_at_ms);
}

test "peer dial queue copies candidates rotates addresses and ignores stale leased tokens" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    var peer: t.PeerId = .{ .bytes = @splat(1) };
    var addresses = [_]t.Address{
        address,
        .{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 4321 } },
    };
    try q.enqueue(&catalog, &peer, &addresses, false, 0);
    try q.enqueue(&catalog, &peer, &addresses, false, 0);
    peer.bytes[0] = 9;
    addresses[0] = .unspecified;
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    const first = out[0];
    try std.testing.expectEqual(@as(u8, 1), first.peer.bytes[0]);
    try std.testing.expectEqualDeep(address, first.address);
    try std.testing.expectEqual(@as(?u64, 10_000), support.refreshAndWakeup(&q, &catalog, 0, 1));
    try expire(&q, &catalog, 10_000);
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 10_000, &out));
    try std.testing.expect(!q.dialStarted(first.token, .{ .index = 0, .generation = 1 }));
    const due = support.refreshAndWakeup(&q, &catalog, 10_000, 1).?;
    try std.testing.expect(due >= 11_000 and due <= 12_000);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, due, &out));
    try std.testing.expectEqual(@as(u16, 4321), out[0].address.port());
    try std.testing.expect(!q.dialFailed(&catalog, first.token, due));
    try std.testing.expect(q.dialStarted(out[0].token, .{ .index = 2, .generation = 7 }));
    try std.testing.expect(!q.dialFailed(&catalog, out[0].token, due));
    try std.testing.expect(q.dialClosed(&catalog, .{ .index = 2, .generation = 7 }, .handshake_timeout, due));
}

test "peer dial queue bounded pressure generation exhaustion and zero output do not spin" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 9 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const first: t.PeerId = .{ .bytes = @splat(1) };
    const second: t.PeerId = .{ .bytes = @splat(2) };
    const third: t.PeerId = .{ .bytes = @splat(3) };
    try q.enqueue(&catalog, &first, &.{address}, true, 0);
    try q.enqueue(&catalog, &second, &.{address}, false, 0);
    try std.testing.expectError(error.Capacity, q.enqueue(&catalog, &third, &.{address}, false, 0));
    try std.testing.expectEqual(@as(?u64, mod.Dialing.connect_timeout_ms), support.refreshAndWakeup(&q, &catalog, 0, 0));
    var out: [2]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expectEqual(@as(?u64, 10_000), support.refreshAndWakeup(&q, &catalog, 0, 2));
    const token = out[0].token;
    try std.testing.expect(q.dialFailed(&catalog, token, 0));
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(out[0].peer.eql(&second));
    const first_peer = catalog.find(&first).?;
    try std.testing.expect(catalog.rowFor(first_peer).?.direct);
    _ = catalog.setDirect(first_peer, false);
    try std.testing.expect(!catalog.rowFor(first_peer).?.direct);
    accept(&q, &catalog, &first, .{ .index = 0, .generation = 1 }, 1);
    try std.testing.expect(!catalog.intents.isSet(catalog.find(&first).?.index));
    q.active[token.index].generation = std.math.maxInt(u64);
    try q.enqueue(&catalog, &third, &.{address}, false, 0);
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 1, &out));
}

test "peer dial queue polling and failure without native owner preserve started handles" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    try q.enqueue(&catalog, &peer, &.{address}, false, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    _ = q.poll(&catalog, 0, &out);
    const token = out[0].token;
    const conn: t.Handle = .{ .index = 0, .generation = 0 };
    try std.testing.expect(q.dialStarted(token, conn));
    try std.testing.expect(!q.dialFailed(&catalog, token, 1));
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 10_000, &out));
    try std.testing.expectEqualDeep(conn, q.active[0].connection.?);
    try std.testing.expect(candidates[0].attempt != null);
    accept(&q, &catalog, &peer, .{ .index = 1, .generation = 0 }, 10_000);
    try std.testing.expectEqualDeep(conn, q.active[0].connection.?);
    try std.testing.expect(candidates[0].connection != null);
    try std.testing.expectEqual(@as(?u64, 10_000), support.refreshAndWakeup(&q, &catalog, 10_000, 0));
    try std.testing.expect(q.dialClosed(&catalog, conn, .handshake_timeout, 10_000));
    try std.testing.expect(candidates[0].connection != null);
    try std.testing.expectEqual(@as(u64, 0), candidates[0].dial.manual_until_ms);
    disconnect(&catalog, &peer, 10_000, .transport_closed, 10_001);
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 20_000, &out));
}

test "peer dial queue review cooldown cannot extend a lost acknowledgement lease" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 5 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    try q.enqueue(&catalog, &peer, &.{address}, true, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    _ = q.poll(&catalog, 0, &out);
    const expired = out[0].token;
    catalog.rows[catalog.find(&peer).?.index].reputation.goodbye_until_ms = 1_800_000;
    try std.testing.expectEqual(@as(?u64, 10_000), support.refreshAndWakeup(&q, &catalog, 0, 0));
    try expire(&q, &catalog, 10_000);
    try std.testing.expect(!q.dialFailed(&catalog, expired, 10_000));
    try std.testing.expect(!q.dialStarted(expired, .{ .index = 0, .generation = 0 }));
    try std.testing.expectEqual(@as(?u64, 1_800_000), support.refreshAndWakeup(&q, &catalog, 10_000, 1));
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 1_799_999, &out));
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 1_800_000, &out));
}

test "peer direct membership enumeration is complete atomic and read only" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const first: t.PeerId = .{ .bytes = @splat(1) };
    const second: t.PeerId = .{ .bytes = @splat(2) };
    const addresses = [_]t.Address{ address, .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 2345 } } };
    const sentinel: t.PeerId = .{ .bytes = @splat(9) };
    try std.testing.expectEqual(@as(usize, 0), try catalog.directPeers(&.{}));
    try std.testing.expect(catalog.find(&first) == null);
    try q.enqueue(&catalog, &first, &addresses, true, 0);
    try q.enqueue(&catalog, &first, &addresses, true, 0);
    try q.enqueue(&catalog, &second, &addresses, true, 0);
    q.configureSelection(&catalog, &.{}, true, &.{}, 0);
    const rows = [2]@TypeOf(candidates[0]){ candidates[0], candidates[1] };
    const before = q;
    var short = [_]t.PeerId{sentinel};
    try std.testing.expectError(error.OutputTooSmall, catalog.directPeers(&short));
    try std.testing.expectEqualDeep([_]t.PeerId{sentinel}, short);
    var out: [2]t.PeerId = undefined;
    try std.testing.expectEqual(@as(usize, 2), try catalog.directPeers(&out));
    try std.testing.expectEqualDeep([_]t.PeerId{ first, second }, out);
    try std.testing.expectEqualDeep(before, q);
    try std.testing.expectEqualDeep(rows, candidates[0..2].*);
    const first_peer = catalog.find(&first).?;
    try std.testing.expect(catalog.setDirect(first_peer, false));
    try std.testing.expect(!catalog.rowFor(first_peer).?.direct);
    try std.testing.expect(catalog.setDirect(first_peer, false));
    try std.testing.expectEqual(@as(usize, 1), try catalog.directPeers(&out));
    try std.testing.expect(out[0].eql(&second));
    try std.testing.expect(catalog.setDirect(catalog.find(&second).?, false));
    try std.testing.expectEqual(@as(usize, 0), try catalog.directPeers(&.{}));
}

test "peer explicit address updates reject overflow and invalid input without mutation" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    const second: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 2345 } };
    const third: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 3456 } };
    try q.enqueue(&catalog, &peer, &.{ address, second }, false, 0);
    q.configureSelection(&catalog, &.{}, true, &.{}, 0);
    const before = candidates[0];
    const selection = q;
    const intents_dirty = catalog.intents_dirty;
    const custody_cursor_before = catalog.candidate_custody_cursor;
    try std.testing.expectError(error.AddressCapacity, q.enqueue(&catalog, &peer, &.{third}, true, 10));
    try std.testing.expectEqualDeep(before, candidates[0]);
    try std.testing.expectEqualDeep(selection.random, q.random);
    try std.testing.expectEqual(intents_dirty, catalog.intents_dirty);
    try std.testing.expectEqual(selection.selection_deadline, q.selection_deadline);
    try std.testing.expectEqual(selection.cursor, q.cursor);
    try std.testing.expectEqual(custody_cursor_before, catalog.candidate_custody_cursor);
    try std.testing.expectError(error.InvalidAddress, q.enqueue(&catalog, &peer, &.{ third, .unspecified }, true, 10));
    try std.testing.expectEqualDeep(before, candidates[0]);
    try std.testing.expectEqualDeep(selection.random, q.random);
    try std.testing.expectEqual(intents_dirty, catalog.intents_dirty);
    try std.testing.expectEqual(selection.selection_deadline, q.selection_deadline);
    try std.testing.expectEqual(selection.cursor, q.cursor);
    try std.testing.expectEqual(custody_cursor_before, catalog.candidate_custody_cursor);
    for ([_]t.Address{ address, second }) |known| {
        try q.enqueue(&catalog, &peer, &.{known}, false, 10);
        var refreshed = before;
        refreshed.dial.manual_until_ms = 10 + mod.Dialing.connect_timeout_ms;
        try std.testing.expectEqualDeep(refreshed, candidates[0]);
    }
}

test "peer repeated initial address leaves room for a distinct explicit address" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    const second: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 2345 } };
    try q.enqueue(&catalog, &peer, &.{ address, address }, false, 0);
    try q.enqueue(&catalog, &peer, &.{second}, true, 1);
    try std.testing.expectEqual(@as(u8, 2), candidates[0].dial.address_count);
    try std.testing.expectEqualDeep([_]t.Address{ address, second }, candidates[0].dial.addresses);
}

test "peer retained attempt does not hide canonical connection closure" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 5 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    const second: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 2345 } };
    try q.enqueue(&catalog, &peer, &.{ address, second }, true, 0);
    var intents: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &intents));
    const token = intents[0].token;
    const attempt: t.Handle = .{ .index = 0, .generation = 4 };
    try std.testing.expect(q.dialStarted(token, attempt));
    accept(&q, &catalog, &peer, .{ .index = 1, .generation = 7 }, 10);
    try std.testing.expect(candidates[0].connection != null);
    const lease = q.active[candidates[0].attempt.?].lease_until_ms;
    disconnect(&catalog, &peer, 10, .transport_closed, 20);
    try std.testing.expect(candidates[0].connection == null);
    try std.testing.expect(candidates[0].attempt != null);
    try std.testing.expectEqual(attempt, q.active[0].connection.?);
    try std.testing.expectEqual(lease, q.active[candidates[0].attempt.?].lease_until_ms);
    try std.testing.expectEqual(@as(u8, 1), candidates[0].dial.failures);
    const disconnected = candidates[0];
    disconnect(&catalog, &peer, 10, .transport_closed, 20);
    try std.testing.expectEqualDeep(disconnected, candidates[0]);
    try std.testing.expect(!q.dialStarted(token, attempt));
    try std.testing.expect(!q.dialFailed(&catalog, token, 20));
    try std.testing.expect(q.dialClosed(&catalog, attempt, .handshake_timeout, 30));
    try std.testing.expect(candidates[0].connection == null);
    try std.testing.expect(candidates[0].attempt == null);
    try std.testing.expect(q.active[0].connection == null);
    try std.testing.expect(candidates[0].direct);
    const due = support.refreshAndWakeup(&q, &catalog, 30, 1).?;
    try std.testing.expect(due >= 5020 and due <= 6020);
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, due - 1, &intents));
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, due, &intents));
    try std.testing.expectEqual(token.index, intents[0].token.index);
    try std.testing.expectEqual(token.generation + 1, intents[0].token.generation);
    try std.testing.expectEqualDeep(peer, intents[0].peer);
    try std.testing.expectEqualDeep(second, intents[0].address);
}

test "peer manual dial completes once and expires without retaining intent" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try q.enqueueUntil(&catalog, &peer, &.{address}, false, 0, 5_000);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    const token = out[0].token;
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    try std.testing.expect(q.dialStarted(token, conn));
    accept(&q, &catalog, &peer, conn, 1);
    disconnect(&catalog, &peer, 1, .transport_closed, 20);
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 20_000, &out));
    try std.testing.expectEqual(@as(usize, 0), catalog.intent_count);
    try q.enqueueUntil(&catalog, &peer, &.{address}, false, 20_000, 21_000);
    try expire(&q, &catalog, 21_000);
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 21_000, &out));
    try std.testing.expectEqual(@as(usize, 0), catalog.intent_count);
    try std.testing.expect(!q.dialFailed(&catalog, token, 21_000));
}

test "peer manual dial deadlines merge while direct reconnects back off" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    try q.enqueueUntil(&catalog, &peer, &.{address}, false, 0, 10_000);
    try q.enqueueUntil(&catalog, &peer, &.{address}, false, 1, 20_000);
    try q.enqueueUntil(&catalog, &peer, &.{address}, false, 2, 5_000);
    try std.testing.expectEqual(@as(u64, 20_000), candidates[0].dial.manual_until_ms);
    try q.enqueue(&catalog, &peer, &.{address}, true, 2);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    var now: u64 = 2;
    for (0..3) |i| {
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, now, &out));
        const conn: t.Handle = .{ .index = 0, .generation = @intCast(i) };
        try std.testing.expect(q.dialStarted(out[0].token, conn));
        accept(&q, &catalog, &peer, conn, now);
        disconnect(&catalog, &peer, now, .health_timeout, now + 100);
        const due = support.refreshAndWakeup(&q, &catalog, now + 100, 1).?;
        const minimum = @as(u64, 5_000) << @intCast(i);
        try std.testing.expect(due >= now + 100 + minimum and due <= now + 1_100 + minimum);
        try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, due - 1, &out));
        now = due;
    }
    try std.testing.expectEqual(@as(u8, 3), catalog.rowFor(catalog.find(&peer).?).?.dial.failures);
    try std.testing.expect(catalog.rowFor(catalog.find(&peer).?).?.direct);
}

test "peer dial simultaneous inbound success does not record the redundant outbound close as failure" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    try q.enqueue(&catalog, &peer, &.{address}, true, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    const outbound: t.Handle = .{ .index = 0, .generation = 1 };
    try std.testing.expect(q.dialStarted(out[0].token, outbound));
    accept(&q, &catalog, &peer, .{ .index = 1, .generation = 1 }, 100);
    try std.testing.expect(q.dialClosed(&catalog, outbound, .handshake_timeout, 200));
    try std.testing.expectEqual(@as(u8, 0), candidates[0].dial.failures);
}

test "peer dial attempt table admits the configured concurrency up to its ceiling" {
    try std.testing.expectError(error.InvalidOptions, mod.Dialing.init(.{ .capacity = 128, .concurrent_max = mod.Dialing.attempts_max + 1, .seed = 1 }));
    try std.testing.expectError(error.InvalidOptions, mod.Dialing.init(.{ .capacity = 8, .concurrent_max = 2, .outbound_reserved = 3, .seed = 1 }));
    var q = try mod.Dialing.init(.{ .capacity = mod.Dialing.attempts_max, .concurrent_max = mod.Dialing.attempts_max, .seed = 1 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    for (0..mod.Dialing.attempts_max) |index| {
        var peer: t.PeerId = .{ .bytes = @splat(0) };
        std.mem.writeInt(u16, peer.bytes[0..2], @intCast(index + 1), .little);
        try q.enqueue(&catalog, &peer, &.{address}, false, 0);
    }
    var out: [mod.Dialing.attempts_max]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, mod.Dialing.attempts_max), q.poll(&catalog, 0, &out));
    try std.testing.expectEqual(@as(u16, mod.Dialing.attempts_max), q.attempts().total);
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 0, &out));
}

test "peer dial admission reserve counts only answered attempts" {
    var q = try mod.Dialing.init(.{ .capacity = 4, .concurrent_max = 4, .seed = 1 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    for (0..4) |index| {
        const peer: t.PeerId = .{ .bytes = @splat(@as(u8, @intCast(index + 1))) };
        try q.enqueue(&catalog, &peer, &.{address}, false, 0);
    }
    var out: [4]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 4), q.poll(&catalog, 0, &out));
    for (out, 0..) |intent, index| try std.testing.expect(q.dialStarted(intent.token, .{ .index = @intCast(index), .generation = 1 }));
    try std.testing.expectEqual(@as(u16, 4), q.pendingPeers(&catalog, null));
    try std.testing.expectEqual(@as(u16, 0), q.answeredPeers(&catalog, null));
    q.active[out[0].token.index].answered = true;
    try std.testing.expectEqual(@as(u16, 1), q.answeredPeers(&catalog, null));
    try std.testing.expectEqual(@as(u16, 0), q.answeredPeers(&catalog, &out[0].peer));
}

test "peer dial lease expiry and backoff preserve their deadlines" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    try q.enqueue(&catalog, &peer, &.{address}, false, 0);
    const row = catalog.rowFor(catalog.find(&peer).?).?;
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    // An unstarted attempt holds its lease; nothing else is due before it.
    try std.testing.expectEqual(@as(?u64, 10_000), support.refreshAndWakeup(&q, &catalog, 0, 1));
    for ([_]u64{ 1, 5_000, 9_999 }) |now| {
        try expire(&q, &catalog, now);
        try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, now, &out));
        try std.testing.expectEqual(@as(?u64, 10_000), support.refreshAndWakeup(&q, &catalog, now, 1));
    }
    try expire(&q, &catalog, 10_000);
    try std.testing.expectEqual(@as(u64, 1), q.outcomes[@intFromEnum(t.DialOutcome.expired)]);
    try std.testing.expectEqual(@as(?u8, null), row.attempt);
    // The expired lease backs the intent off; its eligibility is the next deadline.
    const eligible = row.dial.eligible_at_ms;
    try std.testing.expect(eligible > 10_000 and eligible < mod.Dialing.connect_timeout_ms);
    try std.testing.expectEqual(@as(?u64, eligible), support.refreshAndWakeup(&q, &catalog, 10_000, 1));
    // Without dial room only the manual expiry remains.
    try std.testing.expectEqual(@as(?u64, mod.Dialing.connect_timeout_ms), support.refreshAndWakeup(&q, &catalog, 10_000, 0));
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, eligible - 1, &out));
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, eligible, &out));
    try std.testing.expect(out[0].peer.eql(&peer));
    // The second lease ends at the manual deadline, which releases the intent.
    try std.testing.expectEqual(@as(?u64, eligible + 10_000), support.refreshAndWakeup(&q, &catalog, eligible, 1));
    try expire(&q, &catalog, eligible + 10_000);
    try std.testing.expectEqual(@as(u64, 2), q.outcomes[@intFromEnum(t.DialOutcome.expired)]);
    try std.testing.expectEqual(@as(?u64, mod.Dialing.connect_timeout_ms), support.refreshAndWakeup(&q, &catalog, eligible + 10_000, 0));
    try expire(&q, &catalog, mod.Dialing.connect_timeout_ms);
    try std.testing.expect(catalog.find(&peer) == null);
    try std.testing.expectEqual(@as(?u64, null), support.refreshAndWakeup(&q, &catalog, mod.Dialing.connect_timeout_ms, 1));
}

test "peer dial scheduling observes dirty intents without applying them" {
    var queue = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, queue.options);
    defer catalog.deinit(a);
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    try queue.enqueue(&catalog, &peer, &.{address}, true, 100);
    const dirty = catalog.dial_schedule_dirty;
    try std.testing.expect(dirty);
    const first = queue.schedule(&catalog, 0);
    try std.testing.expect(first.runnable);
    for (0..3) |_| {
        try std.testing.expectEqualDeep(first, queue.schedule(&catalog, 0));
        try std.testing.expectEqual(dirty, catalog.dial_schedule_dirty);
    }
    queue.refresh(&catalog, 100);
    try std.testing.expect(!catalog.dial_schedule_dirty);
    try std.testing.expect(!queue.schedule(&catalog, 0).runnable);
    try std.testing.expect(queue.schedule(&catalog, 1).due(time.milliseconds(100)));
    const ref = catalog.find(&peer).?;
    try std.testing.expect(catalog.edit(.{ .index = ref.index, .generation = ref.generation + 1 }) == null);
    try std.testing.expect(catalog.rowFor(ref) != null);
    try std.testing.expect(!queue.schedule(&catalog, 0).runnable);
    catalog.edit(ref).?.dial.deferUntil(200);
    try std.testing.expect(!queue.schedule(&catalog, 0).runnable);
    queue.configureSelection(&catalog, &.{}, false, &.{}, 100);
    try std.testing.expectEqual(@as(?u64, 200), support.refreshAndWakeup(&queue, &catalog, 100, 1));
    var selected: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 0), queue.poll(&catalog, 199, &selected));
    try std.testing.expect(!queue.schedule(&catalog, 0).runnable);
    try std.testing.expectEqual(@as(usize, 1), queue.poll(&catalog, 200, &selected));
    try std.testing.expect(selected[0].peer.eql(&peer));
}

test "peer dial scans select and expire every candidate at maximum capacity" {
    var q = try mod.Dialing.init(.{ .capacity = 4096, .concurrent_max = mod.Dialing.attempts_max, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    for (0..q.options.capacity) |index| {
        var peer: t.PeerId = .{ .bytes = @splat(0) };
        std.mem.writeInt(u16, peer.bytes[0..2], @intCast(index), .little);
        try q.enqueueUntil(&catalog, &peer, &.{address}, false, 0, 5000);
    }
    var out: [mod.Dialing.attempts_max]mod.Dialing.SelectedDial = undefined;
    for (0..q.options.capacity / mod.Dialing.attempts_max) |batch| {
        try std.testing.expectEqual(out.len, q.poll(&catalog, 0, &out));
        for (out, 0..) |selected, offset| {
            try std.testing.expectEqual(@as(u16, @intCast(batch * out.len + offset)), std.mem.readInt(u16, selected.peer.bytes[0..2], .little));
            try std.testing.expect(q.dialDeferred(&catalog, selected.token, 0));
        }
    }
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 999, &out));
    try std.testing.expectEqual(@as(?u64, 1000), support.refreshAndWakeup(&q, &catalog, 999, 1));
    try std.testing.expectEqual(@as(?u64, 5000), support.refreshAndWakeup(&q, &catalog, 999, 0));
    try expire(&q, &catalog, 5000);
    try std.testing.expectEqual(@as(u16, 0), catalog.intent_count);
    try std.testing.expectEqual(@as(?u64, null), support.refreshAndWakeup(&q, &catalog, 5000, 1));
}
