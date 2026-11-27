const std = @import("std");
const mod = @import("dialing.zig");
const catalog_mod = @import("catalog.zig");
const t = @import("types.zig");
const a = std.testing.allocator;
const discovery = @import("discovery.zig");
const address: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 1234 } };

const support = @import("dialing_test_support.zig");
const discovered = support.discovered;
const initCatalog = support.initCatalog;

test "discovery candidate diversity bypasses grace without concentrating the next replacement" {
    for ([_]bool{ false, true }) |ipv6| {
        var q = try mod.Dialing.init(.{ .capacity = 4, .concurrent_max = 1, .seed = 4 });
        var catalog = try initCatalog(a, q.options);
        defer catalog.deinit(a);
        for (1..5) |tag| {
            var candidate = try discovered(@intCast(tag), 1);
            candidate.addresses[0] = candidateAddress(ipv6, 1, @intCast(tag));
            try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{ .syncnets = 1 }, 0);
        }
        var same_prefix = try discovered(5, 1);
        same_prefix.addresses[0] = candidateAddress(ipv6, 1, 5);
        try std.testing.expectError(error.Capacity, q.enqueueDiscovered(&catalog, &same_prefix, &.{}, &.{ .syncnets = 1 }, 1));
        var diverse = try discovered(6, 1);
        diverse.addresses[0] = candidateAddress(ipv6, 2, 1);
        try q.enqueueDiscovered(&catalog, &diverse, &.{}, &.{ .syncnets = 1 }, 1);
        const retained = catalog.find(&diverse.peer).?;
        try std.testing.expectEqual(@as(u16, 4), catalog.intent_count);
        try std.testing.expectError(error.Capacity, q.enqueueDiscovered(&catalog, &same_prefix, &.{}, &.{ .syncnets = 1 }, 2));
        try q.enqueueDiscovered(&catalog, &same_prefix, &.{}, &.{ .syncnets = 1 }, catalog_mod.Catalog.replacement_grace_ms);
        try std.testing.expect(catalog.rowFor(retained) != null);
    }
}

test "discovery diversity preserves active dials manual candidates and better coverage" {
    for ([_]enum { active, manual, useful }{ .active, .manual, .useful }) |protected| {
        var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 2, .seed = 4 });
        var catalog = try initCatalog(a, q.options);
        defer catalog.deinit(a);
        for (1..3) |tag| {
            const candidate = try discovered(@intCast(tag), 1);
            if (protected == .manual) {
                try q.enqueue(&catalog, &candidate.peer, &.{address}, false, 0);
            } else try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{ .syncnets = 1 }, 0);
        }
        if (protected == .active) {
            var selected: [2]mod.Dialing.SelectedDial = undefined;
            try std.testing.expectEqual(@as(usize, 2), q.poll(&catalog, 0, &selected));
        }
        var diverse = try discovered(3, if (protected == .useful) 0 else 1);
        diverse.addresses[0] = candidateAddress(false, 2, 1);
        try std.testing.expectError(error.Capacity, q.enqueueDiscovered(&catalog, &diverse, &.{}, &.{ .syncnets = 1 }, 1));
        try std.testing.expectEqual(@as(u16, 2), catalog.intent_count);
    }
}

fn candidateAddress(ipv6: bool, subnet: u8, host: u8) t.Address {
    if (!ipv6) return .{ .ip4 = .{ .octets = .{ 192, 0, subnet, host }, .port = 9000 + @as(u16, host) } };
    var octets: [16]u8 = @splat(0);
    octets[0] = 0x20;
    octets[1] = 0x01;
    octets[5] = subnet;
    octets[15] = host;
    return .{ .ip6 = .{ .octets = octets, .port = 9000 + @as(u16, host) } };
}

test "connected discovery peers preserve records without occupying candidate capacity" {
    for ([_]bool{ false, true }) |discovered_first| {
        var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
        var catalog = try initCatalog(a, q.options);
        defer catalog.deinit(a);
        var connected = try discovered(1, 1);
        const conn: t.Handle = .{ .index = 0, .generation = 1 };
        var out: [1]mod.Dialing.SelectedDial = undefined;
        if (discovered_first) {
            try q.enqueueDiscovered(&catalog, &connected, &.{}, &.{ .syncnets = 1 }, 0);
            try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
            try std.testing.expect(q.dialStarted(out[0].token, conn));
        }
        support.accept(&q, &catalog, &connected.peer, conn, 1);
        try std.testing.expectEqual(@as(u16, 0), catalog.intent_count);
        const peer = catalog.find(&connected.peer).?;
        if (discovered_first) {
            try std.testing.expectEqualDeep(connected.hints, catalog.rowFor(peer).?.dial.hints.?);
            try q.enqueue(&catalog, &connected.peer, &.{address}, false, 1);
            try std.testing.expect(!catalog.rowFor(peer).?.dial.automatic);
            try q.enqueueDiscovered(&catalog, &connected, &.{}, &.{ .syncnets = 1 }, 1);
            try std.testing.expect(catalog.rowFor(peer).?.dial.automatic);
        }

        const waiting = try discovered(2, 1);
        try q.enqueueDiscovered(&catalog, &waiting, &.{}, &.{ .syncnets = 1 }, 2);
        connected.hints.sequence += 1;
        connected.addresses[0] = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 2222 } };
        try q.enqueueDiscovered(&catalog, &connected, &.{}, &.{ .syncnets = 1 }, 3);
        try q.enqueueDiscovered(&catalog, &connected, &.{}, &.{ .syncnets = 1 }, 4);
        try std.testing.expectEqual(@as(u16, 1), catalog.intent_count);
        try std.testing.expect(!catalog.intents.isSet(peer.index));
        try std.testing.expectEqualDeep(connected.hints, catalog.rowFor(peer).?.dial.hints.?);
        const dial = &catalog.rowFor(peer).?.dial;
        try std.testing.expectEqual(connected.address_count, dial.address_count);
        try std.testing.expectEqualDeep(connected.addresses[0..connected.address_count], dial.addresses[0..dial.address_count]);
        try std.testing.expectEqual(@as(u64, 4), catalog.rowFor(peer).?.dial.hints_at_ms);
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 4, &out));
        try std.testing.expect(out[0].peer.eql(&waiting.peer));
    }
}

test "automatic transport retry reacquires only available candidate capacity" {
    for ([_]bool{ false, true }) |full| {
        var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
        var catalog = try initCatalog(a, q.options);
        defer catalog.deinit(a);
        const candidate = try discovered(1, 1);
        const waiting = try discovered(2, 1);
        try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{ .syncnets = 1 }, 0);
        const conn: t.Handle = .{ .index = 0, .generation = 1 };
        var out: [1]mod.Dialing.SelectedDial = undefined;
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
        try std.testing.expect(q.dialStarted(out[0].token, conn));
        support.accept(&q, &catalog, &candidate.peer, conn, 1);
        if (full) try q.enqueueDiscovered(&catalog, &waiting, &.{}, &.{ .syncnets = 1 }, 2);
        support.disconnect(&catalog, &candidate.peer, 1, .transport_closed, 3);
        const row = catalog.rowFor(catalog.find(&candidate.peer).?).?;
        try std.testing.expectEqualDeep(candidate.hints, row.dial.hints.?);
        try std.testing.expectEqual(candidate.address_count, row.dial.address_count);
        try std.testing.expectEqualDeep(candidate.addresses[0..candidate.address_count], row.dial.addresses[0..row.dial.address_count]);
        try std.testing.expectEqual(@as(u16, 1), catalog.intent_count);
        if (full) {
            try std.testing.expect(!row.dial.automatic);
            try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 3, &out));
            try std.testing.expect(out[0].peer.eql(&waiting.peer));
        } else {
            const due = support.refreshAndWakeup(&q, &catalog, 3, 1).?;
            try std.testing.expect(due >= 5_003 and due <= 6_003);
            try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, due - 1, &out));
            try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, due, &out));
            try std.testing.expect(out[0].peer.eql(&candidate.peer));
        }
    }
}

test "peer discovery matches rotate without rewarding additional advertised coverage" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const narrow = try discovered(1, 1);
    var broad = try discovered(2, 15);
    broad.hints.attnets = @splat(255);
    broad.hints.custody_group_count = 128;
    const wanted: t.Coverage = .{ .syncnets = 15, .attnets = std.math.maxInt(u64) };
    try q.enqueueDiscovered(&catalog, &narrow, &.{}, &wanted, 0);
    try q.enqueueDiscovered(&catalog, &broad, &.{}, &wanted, 0);
    q.configureSelection(&catalog, &wanted, false, &.{}, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(out[0].peer.eql(&narrow.peer));
    try std.testing.expect(q.dialDeferred(&catalog, out[0].token, 0));
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(out[0].peer.eql(&broad.peer));
    try std.testing.expect(q.dialDeferred(&catalog, out[0].token, 0));
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 1_000, &out));
    try std.testing.expect(out[0].peer.eql(&narrow.peer));
}

test "peer discovery breadth cannot evict an untried candidate matching current demand" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const narrow = try discovered(1, 1);
    var broad = try discovered(2, 15);
    broad.hints.attnets = @splat(255);
    const wanted: t.Coverage = .{ .syncnets = 15, .attnets = std.math.maxInt(u64) };
    try q.enqueueDiscovered(&catalog, &narrow, &.{}, &wanted, 0);
    try std.testing.expectError(error.Capacity, q.enqueueDiscovered(&catalog, &broad, &.{}, &wanted, 1));
    try std.testing.expect(candidates[0].identity.eql(&narrow.peer));
    try q.enqueueDiscovered(&catalog, &broad, &.{}, &wanted, catalog_mod.Catalog.hint_freshness_ms);
    try std.testing.expect(candidates[0].identity.eql(&broad.peer));
}

test "peer dial discovered refresh replaces addresses preserves lease history and manual authority" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    var candidate = try discovered(1, 0);
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    const token = out[0].token;
    try std.testing.expect(q.dialFailed(&catalog, token, 1));
    const due = support.refreshAndWakeup(&q, &catalog, 1, 1).?;
    candidate.hints.sequence = 2;
    candidate.addresses[0] = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 2222 } };
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 2);
    try std.testing.expectEqual(due, support.refreshAndWakeup(&q, &catalog, 2, 1).?);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, due, &out));
    try std.testing.expectEqual(@as(u16, 2222), out[0].address.port());
    const live = out[0].token;
    candidate.hints.sequence = 3;
    candidate.addresses[0] = address;
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, due);
    try std.testing.expect(q.dialStarted(live, .{ .index = 1, .generation = 44 }));
    candidate.hints.sequence = 2;
    try std.testing.expectError(error.StaleRecord, q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, due));
    candidate.hints.sequence = 4;
    candidate.hints.syncnets = 16;
    try std.testing.expectError(error.InvalidCandidate, q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, due));
    try std.testing.expect(q.dialClosed(&catalog, .{ .index = 1, .generation = 44 }, .handshake_timeout, due));
    const peer = (try discovered(2, 0)).peer;
    try q.enqueue(&catalog, &peer, &.{address}, true, 0);
    candidate = try discovered(2, 1);
    candidate.addresses[0] = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 3 }, .port = 3333 } };
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expectEqual(@as(u16, 1234), out[0].address.port());
    const first = (try discovered(1, 0)).peer;
    const history = &catalog.history;
    try std.testing.expectEqual(@as(u8, 1), history.strikesFor(history.endpointKey(&first, .{ .ip4 = .{ .octets = .{ 127, 0, 0, 2 }, .port = 2222 } }), 3, due));
    try std.testing.expectEqual(@as(u8, 1), history.strikesFor(history.endpointKey(&first, address), 1, due));
    try std.testing.expect(!history.blocked(history.endpointKey(&first, address), 3, due));
    const row = catalog.rowFor(catalog.find(&first).?).?;
    try std.testing.expect(row.dial.automatic);
    try std.testing.expect(row.dial.addresses[row.dial.address_index].eql(address));
}

test "peer dial scarce candidate replaces failing automatic rows during their backoff" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 2, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const wanted: t.Coverage = .{ .syncnets = 1 };
    const first_candidate = try discovered(1, 0);
    const second_candidate = try discovered(2, 0);
    const scarce = try discovered(3, 1);
    try q.enqueueDiscovered(&catalog, &first_candidate, &.{}, &wanted, 0);
    try q.enqueueDiscovered(&catalog, &second_candidate, &.{}, &wanted, 0);
    var out: [2]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 2), q.poll(&catalog, 0, &out));
    for (out) |intent| try std.testing.expect(q.dialFailed(&catalog, intent.token, 0));
    try q.enqueueDiscovered(&catalog, &scarce, &.{}, &wanted, 1);
    q.configureSelection(&catalog, &wanted, false, &.{}, 1);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 1, &out));
    try std.testing.expect(out[0].peer.eql(&scarce.peer));
}

test "peer dial scarce untried candidate resists general flood and fork change" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const wanted: t.Coverage = .{ .syncnets = 1 };
    const first_candidate = try discovered(1, 0);
    const second_candidate = try discovered(2, 0);
    const scarce = try discovered(3, 1);
    try q.enqueueDiscovered(&catalog, &first_candidate, &.{}, &wanted, 0);
    try q.enqueueDiscovered(&catalog, &second_candidate, &.{}, &wanted, 0);
    try q.enqueueDiscovered(&catalog, &scarce, &.{}, &wanted, 0);
    for (4..16) |i| {
        const general = try discovered(@intCast(i), 0);
        q.enqueueDiscovered(&catalog, &general, &.{}, &wanted, 0) catch |err| try std.testing.expectEqual(error.Capacity, err);
    }
    q.configureSelection(&catalog, &wanted, false, &.{ .digest = @splat(1) }, 0);
    try std.testing.expectEqual(@as(?u64, null), support.refreshAndWakeup(&q, &catalog, 0, 1));
    q.configureSelection(&catalog, &wanted, false, &.{}, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(out[0].peer.eql(&scarce.peer));
}

test "peer dial confirmed equal ENR refresh renews provisional hint freshness without history" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const candidate = try discovered(1, 1);
    const wanted: t.Coverage = .{ .syncnets = 1 };
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &wanted, 0);
    q.configureSelection(&catalog, &wanted, false, &.{}, 300_000);
    try std.testing.expectEqual(@as(?u64, null), support.refreshAndWakeup(&q, &catalog, 300_000, 1));
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &wanted, 300_000);
    q.configureSelection(&catalog, &wanted, false, &.{}, 300_000);
    try std.testing.expectEqual(@as(?u64, 300_000), support.refreshAndWakeup(&q, &catalog, 300_000, 1));
    try std.testing.expectEqual(@as(u64, 600_000), candidates[0].dial.replacement_after_ms);
    var conflicting = candidate;
    conflicting.hints.syncnets = 2;
    try std.testing.expectError(error.StaleRecord, q.enqueueDiscovered(&catalog, &conflicting, &.{}, &wanted, 300_001));
}

test "peer dial equal ENR merges authorized endpoint observations without changing owners or backoff" {
    const d = @import("discv5");
    const adapter = @import("enr.zig");
    const key = try d.identity.crypto.keyPairFromSecret(&(.{0} ** 31 ++ .{1}));
    const record = try adapter.build(&key, 7, &.{
        .fork = .{ .digest = @splat(0), .next_version = @splat(0), .next_epoch = 0 },
        .ip4 = .{ 10, 1, 0, 1 },
        .quic = 9001,
        .ip6 = .{ 0x20, 0x01, 0x0d, 0xb8 } ++ .{0} ** 11 ++ .{1},
        .quic6 = 9002,
    }, &.{});
    const dual = try adapter.decode(&record, &.{});
    var public = dual;
    public.addresses = .{ dual.addresses[1], .unspecified };
    public.address_count = 1;
    const public_source: t.Address = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 9000 } };
    try std.testing.expect(!discovery.relayAllowed(public_source, dual.addresses[0]));
    try std.testing.expect(discovery.relayAllowed(public_source, public.addresses[0]));

    for (0..4) |mode| {
        var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
        var catalog = try initCatalog(a, q.options);
        defer catalog.deinit(a);
        const candidates = catalog.rows[0..q.options.capacity];
        try q.enqueueDiscovered(&catalog, if (mode == 0) &public else &dual, &.{}, &.{}, 0);
        if (mode >= 2) try q.enqueue(&catalog, &dual.peer, &.{address}, mode == 3, 0);
        candidates[0].dial.failures = 3;
        candidates[0].dial.eligible_at_ms = 5000;
        if (mode == 1) candidates[0].dial.address_index = 1;
        var intents: [1]mod.Dialing.SelectedDial = undefined;
        try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 5000, &intents));
        try std.testing.expect(q.dialStarted(intents[0].token, .{ .index = 1, .generation = 2 }));
        @memset(candidates[0].dial.addresses[candidates[0].dial.address_count..], .unspecified);
        var expected = candidates[0];
        try q.enqueueDiscovered(&catalog, if (mode == 0) &dual else &public, &.{}, &.{}, 6000);
        expected.dial.hints_at_ms = 6000;
        if (mode == 0) {
            expected.dial.addresses = .{ dual.addresses[1], dual.addresses[0] };
            expected.dial.address_count = 2;
        }
        try std.testing.expectEqualDeep(expected, candidates[0]);
        try q.enqueueDiscovered(&catalog, &public, &.{}, &.{}, 7000);
        expected.dial.hints_at_ms = 7000;
        try std.testing.expectEqualDeep(expected, candidates[0]);
    }
}

test "peer discovered conversion replaces addresses while retaining retry history" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const candidate = try discovered(1, 0);
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
    candidates[0].dial.failures = 3;
    candidates[0].dial.eligible_at_ms = 9000;
    const explicit: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 5432 } };
    try q.enqueue(&catalog, &candidate.peer, &.{ explicit, explicit }, true, 10);
    try std.testing.expect(!candidates[0].dial.automatic);
    try std.testing.expect(candidates[0].direct);
    try std.testing.expectEqual(@as(u8, 1), candidates[0].dial.address_count);
    try std.testing.expectEqualDeep(explicit, candidates[0].dial.addresses[0]);
    try std.testing.expectEqual(@as(u8, 3), candidates[0].dial.failures);
    try std.testing.expectEqual(@as(u64, 9000), candidates[0].dial.eligible_at_ms);
}

test "peer explicit dial ranks above discovery coverage" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidate = try discovered(1, 15);
    const manual = try discovered(2, 0);
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{ .syncnets = 15 }, 0);
    try q.enqueue(&catalog, &manual.peer, &.{address}, false, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expectEqualDeep(manual.peer, out[0].peer);
}

test "peer failed discovery candidate yields its slot after retry backoff" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const forged = try discovered(1, 15);
    const replacement = try discovered(2, 0);
    try q.enqueueDiscovered(&catalog, &forged, &.{}, &.{ .syncnets = 15 }, 0);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(q.dialFailed(&catalog, out[0].token, 1));
    const retry_at = support.refreshAndWakeup(&q, &catalog, 1, 1).?;
    try q.enqueueDiscovered(&catalog, &replacement, &.{}, &.{ .syncnets = 15 }, retry_at);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, retry_at, &out));
    try std.testing.expectEqualDeep(replacement.peer, out[0].peer);
}
