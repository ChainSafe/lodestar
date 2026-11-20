const std = @import("std");
const mod = @import("dialing.zig");
const t = @import("types.zig");
const a = std.testing.allocator;
const dial_history = @import("dial_history.zig");
const address: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 1234 } };

const support = @import("dialing_test_support.zig");
const discovered = support.discovered;
const initCatalog = support.initCatalog;
const accept = support.accept;
const disconnect = support.disconnect;

test "peer dial queue exponential retry remains bounded through repeated failure" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 10 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    try q.enqueue(&catalog, &peer, &.{address}, true, 0);
    var now: u64 = 0;
    var out: [1]mod.Dialing.SelectedDial = undefined;
    for (0..20) |_| {
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, now, &out));
        try std.testing.expect(q.dialFailed(&catalog, out[0].token, now));
        const due = support.refreshAndWakeup(&q, &catalog, now, 1).?;
        try std.testing.expect(due - now >= 1_000 and due - now <= 60_000);
        now = due;
    }
}

test "peer pruning requires rediscovery or explicit intent without recording failures" {
    for ([_]bool{ false, true }) |explicit| {
        var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
        var catalog = try initCatalog(a, q.options);
        defer catalog.deinit(a);
        const candidates = catalog.rows[0..q.options.capacity];
        const candidate = try discovered(1, 1);
        try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{ .syncnets = 1 }, 0);
        const conn: t.Handle = .{ .index = 0, .generation = 1 };
        accept(&q, &catalog, &candidate.peer, conn, 0);
        _ = catalog.deferRedial(catalog.find(&candidate.peer).?, conn, 0, 300_000);
        disconnect(&catalog, &candidate.peer, 0, .count_pruning, 2_000);
        try std.testing.expectEqual(@as(u8, 0), candidates[0].dial.failures);
        try std.testing.expectEqual(@as(u16, 0), catalog.intent_count);
        try std.testing.expect(support.refreshAndWakeup(&q, &catalog, 2_000, 1) == null);
        try std.testing.expectEqualDeep(candidate.hints, candidates[0].dial.hints.?);
        var out: [1]mod.Dialing.SelectedDial = undefined;
        try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 299_999, &out));
        if (explicit) {
            const manual: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 2222 } };
            try q.enqueue(&catalog, &candidate.peer, &.{ manual, address }, false, 299_999);
            try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 299_999, &out));
            try std.testing.expect(out[0].address.eql(manual));
        } else {
            try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 300_000, &out));
            try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{ .syncnets = 1 }, 300_000);
            try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 300_000, &out));
        }
    }
}

test "peer local closes end discovery retries while preserving direct intent" {
    for ([_]t.DisconnectReason{ .host, .health_timeout, .invalid_metadata, .count_pruning }) |reason| {
        for ([_]bool{ false, true }) |direct| {
            var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
            var catalog = try initCatalog(a, q.options);
            defer catalog.deinit(a);
            const candidate = try discovered(1, 1);
            try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{ .syncnets = 1 }, 0);
            if (direct) try q.enqueue(&catalog, &candidate.peer, &.{address}, true, 0);
            const conn: t.Handle = .{ .index = 0, .generation = 1 };
            accept(&q, &catalog, &candidate.peer, conn, 1);
            disconnect(&catalog, &candidate.peer, 1, reason, 2);
            try std.testing.expectEqual(@as(u16, @intFromBool(direct)), catalog.intent_count);
            const due = support.refreshAndWakeup(&q, &catalog, 2, 1);
            var out: [1]mod.Dialing.SelectedDial = undefined;
            if (direct) {
                try std.testing.expect(due.? > 2);
                try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, due.?, &out));
                try std.testing.expect(out[0].peer.eql(&candidate.peer));
            } else {
                try std.testing.expect(due == null);
                try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 300_000, &out));
            }
        }
    }
}

test "peer dial local admission deferral preserves retry history and endpoint" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const peer: t.PeerId = .{ .bytes = @splat(1) };
    const alternate: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 2222 } };
    try q.enqueue(&catalog, &peer, &.{ address, alternate }, false, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    _ = q.poll(&catalog, 0, &out);
    try std.testing.expect(q.dialDeferred(&catalog, out[0].token, 0));
    try std.testing.expectEqual(@as(u8, 0), candidates[0].dial.failures);
    try std.testing.expectEqual(@as(?u64, 1000), support.refreshAndWakeup(&q, &catalog, 0, 1));
    _ = q.poll(&catalog, 1000, &out);
    try std.testing.expect(out[0].address.eql(address));
    try std.testing.expect(q.dialStarted(out[0].token, .{ .index = 1, .generation = 2 }));
    try std.testing.expect(!q.dialDeferred(&catalog, out[0].token, 1000));
    try std.testing.expect(q.dialClosed(&catalog, .{ .index = 1, .generation = 2 }, .handshake_timeout, 1000));
}

test "peer dial dead discovery endpoints do not return as untried candidates" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidate = try discovered(1, 0);
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    var now: u64 = 0;
    for (0..2) |i| {
        const due = support.refreshAndWakeup(&q, &catalog, now, 1).?;
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, due, &out));
        const conn: t.Handle = .{ .index = 0, .generation = @intCast(i + 1) };
        try std.testing.expect(q.dialStarted(out[0].token, conn));
        now = due + 3_000;
        try std.testing.expect(q.dialClosed(&catalog, conn, .dial_unanswered, now));
    }
    try std.testing.expect(catalog.find(&candidate.peer) == null);
    try std.testing.expectEqual(@as(u64, 2), q.outcomes[@intFromEnum(t.DialOutcome.unanswered)]);
    try std.testing.expectEqual(@as(u64, 1), q.retries[@intFromEnum(t.DialFailure.unanswered)]);
    try std.testing.expectError(error.RecentlyFailed, q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, now));
    try std.testing.expectEqual(@as(u64, 1), q.refused.endpoint);
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, now + dial_history.endpoint_memory_ms);
    const row = catalog.rowFor(catalog.find(&candidate.peer).?).?;
    try std.testing.expectEqual(@as(u8, 0), row.dial.failures);
}

test "peer dial failure strikes survive intent replacement" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const first_candidate = try discovered(1, 0);
    const second_candidate = try discovered(2, 0);
    try q.enqueueDiscovered(&catalog, &first_candidate, &.{}, &.{}, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(q.dialFailed(&catalog, out[0].token, 0));
    try q.enqueueDiscovered(&catalog, &second_candidate, &.{}, &.{}, 1);
    try std.testing.expect(catalog.find(&first_candidate.peer) == null);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 1, &out));
    try std.testing.expect(q.dialFailed(&catalog, out[0].token, 1));
    const retry_at = support.refreshAndWakeup(&q, &catalog, 1, 1).?;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, retry_at, &out));
    try std.testing.expect(q.dialFailed(&catalog, out[0].token, retry_at));
    try std.testing.expect(catalog.find(&second_candidate.peer) == null);
    try q.enqueueDiscovered(&catalog, &first_candidate, &.{}, &.{}, retry_at);
    try std.testing.expectEqual(@as(u8, 1), catalog.rowFor(catalog.find(&first_candidate.peer).?).?.dial.failures);
}

test "peer dial retries follow the endpoint history across row eviction" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const mismatched = try discovered(1, 0);
    const silent = try discovered(2, 0);
    const other = try discovered(3, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try q.enqueueDiscovered(&catalog, &mismatched, &.{}, &.{}, 0);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(q.dialStarted(out[0].token, .{ .index = 0, .generation = 1 }));
    try std.testing.expect(q.dialClosed(&catalog, .{ .index = 0, .generation = 1 }, .peer_id_mismatch, 100));
    try std.testing.expect(catalog.find(&mismatched.peer) == null);
    try std.testing.expectError(error.RecentlyFailed, q.enqueueDiscovered(&catalog, &mismatched, &.{}, &.{}, 200));
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 200, &out));
    try q.enqueueDiscovered(&catalog, &silent, &.{}, &.{}, 200);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 200, &out));
    try std.testing.expect(q.dialStarted(out[0].token, .{ .index = 0, .generation = 2 }));
    try std.testing.expect(q.dialClosed(&catalog, .{ .index = 0, .generation = 2 }, .dial_unanswered, 3_200));
    try q.enqueueDiscovered(&catalog, &other, &.{}, &.{}, 3_300);
    try std.testing.expect(catalog.find(&silent.peer) == null);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 3_300, &out));
    try std.testing.expect(out[0].peer.eql(&other.peer));
    try std.testing.expect(q.dialFailed(&catalog, out[0].token, 3_300));
    try q.enqueueDiscovered(&catalog, &silent, &.{}, &.{}, 3_400);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 3_400, &out));
    try std.testing.expect(out[0].peer.eql(&silent.peer));
    try std.testing.expectEqual(@as(u64, 1), q.retries[@intFromEnum(t.DialFailure.unanswered)]);
    try std.testing.expect(q.dialDeferred(&catalog, out[0].token, 3_400));
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 4_400, &out));
    try std.testing.expect(out[0].peer.eql(&silent.peer));
    var retried: u64 = 0;
    for (q.retries) |count| retried += count;
    try std.testing.expectEqual(@as(u64, 1), retried);
}

test "peer dial counts no retry for the other endpoint of a mismatched peer" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const alternate: t.Address = .{ .ip6 = .{ .octets = .{ 0x20, 0x01, 0x0d, 0xb8 } ++ .{0} ** 11 ++ .{1}, .port = 2222 } };
    var candidate = try discovered(1, 0);
    candidate.addresses[1] = alternate;
    candidate.address_count = 2;
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(out[0].address.eql(address));
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    try std.testing.expect(q.dialStarted(out[0].token, conn));
    try std.testing.expect(q.dialClosed(&catalog, conn, .peer_id_mismatch, 100));
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, support.refreshAndWakeup(&q, &catalog, 100, 1).?, &out));
    try std.testing.expect(out[0].address.eql(alternate));
    for (q.retries) |count| try std.testing.expectEqual(@as(u64, 0), count);
}

test "peer dial counts a redial of a failed endpoint once by that endpoint's failure" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const alternate: t.Address = .{ .ip6 = .{ .octets = .{ 0x20, 0x01, 0x0d, 0xb8 } ++ .{0} ** 11 ++ .{1}, .port = 2222 } };
    var candidate = try discovered(1, 0);
    candidate.addresses[1] = alternate;
    candidate.address_count = 2;
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    var now: u64 = 0;
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    for ([_]t.Address{ address, alternate, address, address, alternate }, 0..) |expected, step| {
        now = support.refreshAndWakeup(&q, &catalog, now, 1).?;
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, now, &out));
        try std.testing.expect(out[0].address.eql(expected));
        switch (step) {
            0, 3 => try std.testing.expect(q.dialFailed(&catalog, out[0].token, now)),
            1 => {
                try std.testing.expect(q.dialStarted(out[0].token, conn));
                try std.testing.expect(q.dialClosed(&catalog, conn, .dial_unanswered, now));
            },
            2 => try std.testing.expect(q.dialDeferred(&catalog, out[0].token, now)),
            else => {},
        }
        var retried: u64 = 0;
        for (q.retries) |count| retried += count;
        try std.testing.expectEqual(@as(u64, if (step < 2) 0 else if (step < 4) 1 else 2), retried);
        try std.testing.expectEqual(@as(u64, @intFromBool(step >= 2)), q.retries[@intFromEnum(t.DialFailure.destination_unreachable)]);
    }
    try std.testing.expectEqual(@as(u64, 1), q.retries[@intFromEnum(t.DialFailure.unanswered)]);
}

test "peer dial ranks untried discovery candidates above retried ones" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const retried = try discovered(1, 0);
    const untried = try discovered(2, 0);
    try q.enqueueDiscovered(&catalog, &retried, &.{}, &.{}, 0);
    try q.enqueueDiscovered(&catalog, &untried, &.{}, &.{}, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(out[0].peer.eql(&retried.peer));
    try std.testing.expect(q.dialFailed(&catalog, out[0].token, 0));
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(out[0].peer.eql(&untried.peer));
    try std.testing.expect(q.dialDeferred(&catalog, out[0].token, 0));
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 5_000, &out));
    try std.testing.expect(out[0].peer.eql(&untried.peer));
}

test "peer dial peer id mismatch blocks the endpoint even for a newer record" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    var candidate = try discovered(1, 0);
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    try std.testing.expect(q.dialStarted(out[0].token, conn));
    try std.testing.expect(q.dialClosed(&catalog, conn, .peer_id_mismatch, 100));
    try std.testing.expect(catalog.find(&candidate.peer) == null);
    try std.testing.expectEqual(@as(u64, 1), q.outcomes[@intFromEnum(t.DialOutcome.peer_id_mismatch)]);
    candidate.hints.sequence = 2;
    try std.testing.expectError(error.RecentlyFailed, q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 100));
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 100 + dial_history.mismatch_memory_ms);
}

test "peer dial local transport closes leave no endpoint strike" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidate = try discovered(1, 0);
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    var now: u64 = 0;
    for (0..3) |i| {
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, now, &out));
        const conn: t.Handle = .{ .index = 0, .generation = @intCast(i + 1) };
        try std.testing.expect(q.dialStarted(out[0].token, conn));
        try std.testing.expect(q.dialClosed(&catalog, conn, .host, now));
        now = support.refreshAndWakeup(&q, &catalog, now, 1).?;
    }
    try std.testing.expect(catalog.find(&candidate.peer) != null);
    try std.testing.expectEqual(@as(u64, 3), q.outcomes[@intFromEnum(t.DialOutcome.refused)]);
    try std.testing.expectEqual(@as(u8, 0), catalog.history.strikesFor(catalog.history.endpointKey(&candidate.peer, candidate.addresses[0]), candidate.hints.sequence, now));
}

test "peer dial never returns to the mismatched endpoint of a two-address candidate" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const alternate: t.Address = .{ .ip6 = .{ .octets = .{ 0x20, 0x01, 0x0d, 0xb8 } ++ .{0} ** 11 ++ .{1}, .port = 2222 } };
    var candidate = try discovered(1, 0);
    candidate.addresses[1] = alternate;
    candidate.address_count = 2;
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    var now: u64 = 0;
    for ([_]t.CloseReason{ .peer_id_mismatch, .host, .dial_unanswered, .dial_unanswered }, 0..) |reason, i| {
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, now, &out));
        try std.testing.expect(out[0].address.eql(if (i == 0) address else alternate));
        const conn: t.Handle = .{ .index = 0, .generation = @intCast(i + 1) };
        try std.testing.expect(q.dialStarted(out[0].token, conn));
        try std.testing.expect(q.dialClosed(&catalog, conn, reason, now));
        if (i < 3) now = support.refreshAndWakeup(&q, &catalog, now, 1).?;
    }
    try std.testing.expect(catalog.find(&candidate.peer) == null);
}

test "peer dial mismatch after a mid-dial refresh blocks the dialed endpoint, not the new one" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const moved: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 2222 } };
    var candidate = try discovered(1, 0);
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(out[0].address.eql(address));
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    try std.testing.expect(q.dialStarted(out[0].token, conn));
    candidate.hints.sequence = 2;
    candidate.addresses[0] = moved;
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 50);
    try std.testing.expect(q.dialClosed(&catalog, conn, .peer_id_mismatch, 100));
    try std.testing.expect(catalog.history.blocked(catalog.history.endpointKey(&candidate.peer, address), 99, 100));
    candidate.hints.sequence = 3;
    candidate.addresses[0] = address;
    try std.testing.expectError(error.RecentlyFailed, q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 100));
    candidate.addresses[0] = moved;
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 100);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, support.refreshAndWakeup(&q, &catalog, 100, 1).?, &out));
    try std.testing.expect(out[0].address.eql(moved));
}

test "peer dial redundant mismatch blocks its endpoint without failing the intent" {
    const alternate: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 2222 } };
    for ([_]u8{ 1, 2 }) |count| {
        var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
        var catalog = try initCatalog(a, q.options);
        defer catalog.deinit(a);
        var candidate = try discovered(1, 0);
        candidate.addresses[1] = alternate;
        candidate.address_count = count;
        try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
        var out: [1]mod.Dialing.SelectedDial = undefined;
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
        try std.testing.expect(out[0].address.eql(address));
        const dial: t.Handle = .{ .index = 0, .generation = 1 };
        try std.testing.expect(q.dialStarted(out[0].token, dial));
        accept(&q, &catalog, &candidate.peer, .{ .index = 1, .generation = 1 }, 10);
        try std.testing.expect(q.dialClosed(&catalog, dial, .peer_id_mismatch, 20));
        try std.testing.expectEqual(@as(u64, 1), q.outcomes[@intFromEnum(t.DialOutcome.cancelled)]);
        try std.testing.expectEqual(@as(u64, 0), q.outcomes[@intFromEnum(t.DialOutcome.peer_id_mismatch)]);
        try std.testing.expect(catalog.history.blocked(catalog.history.endpointKey(&candidate.peer, address), 99, 20));
        const row = catalog.rowFor(catalog.find(&candidate.peer).?).?;
        try std.testing.expectEqual(@as(u8, 0), row.dial.failures);
        try std.testing.expectEqual(@as(u64, 0), row.dial.eligible_at_ms);
        disconnect(&catalog, &candidate.peer, 10, .transport_closed, 30);
        const due = support.refreshAndWakeup(&q, &catalog, 30, 1) orelse 30 + dial_history.endpoint_memory_ms;
        try std.testing.expectEqual(@as(usize, count - 1), q.poll(&catalog, due, &out));
        if (count == 2) try std.testing.expect(out[0].address.eql(alternate));
        for (q.retries) |retried| try std.testing.expectEqual(@as(u64, 0), retried);
    }
}

test "peer dial landed connections keep dial failures until the application exchange clears the dialed endpoint" {
    for ([_]bool{ false, true }) |deferred| {
        var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
        var catalog = try initCatalog(a, q.options);
        defer catalog.deinit(a);
        var candidate = try discovered(1, 0);
        try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
        var out: [1]mod.Dialing.SelectedDial = undefined;
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
        try std.testing.expect(q.dialFailed(&catalog, out[0].token, 0));
        const due = support.refreshAndWakeup(&q, &catalog, 0, 1).?;
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, due, &out));
        try std.testing.expect(out[0].address.eql(address));
        const conn: t.Handle = .{ .index = 0, .generation = 1 };
        try std.testing.expect(q.dialStarted(out[0].token, conn));
        candidate.hints.sequence = 2;
        candidate.addresses[0] = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 2222 } };
        try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, due);
        const dialed = catalog.history.endpointKey(&candidate.peer, address);
        try std.testing.expectEqual(@as(u8, 1), catalog.history.strikesFor(dialed, 1, due));
        if (deferred) {
            try std.testing.expect(q.deferConnection(&catalog, conn, due));
            try std.testing.expectEqual(@as(u8, 1), catalog.history.strikesFor(dialed, 1, due));
            continue;
        }
        accept(&q, &catalog, &candidate.peer, conn, due);
        try std.testing.expectEqual(@as(u8, 1), catalog.history.strikesFor(dialed, 1, due));
        const peer = catalog.find(&candidate.peer).?;
        try std.testing.expect(catalog.updateStatus(peer, conn, &.{}, due));
        try std.testing.expect(catalog.updateMetadata(peer, conn, &.{}, due));
        catalog.clearDialFailures(peer, conn);
        try std.testing.expectEqual(@as(u8, 0), catalog.history.strikesFor(dialed, 1, due));
    }
}
