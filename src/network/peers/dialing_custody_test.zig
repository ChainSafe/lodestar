const std = @import("std");
const mod = @import("dialing.zig");
const catalog_mod = @import("catalog.zig");
const t = @import("types.zig");
const a = std.testing.allocator;
const custody_mod = @import("custody.zig");
const CountingAllocator = @import("../counting_allocator.zig").CountingAllocator;
const policy = @import("policy.zig");

const support = @import("dialing_test_support.zig");
const discovered = support.discovered;
const initCatalog = support.initCatalog;

test "peer discovery uses the configured custody minimum only for an absent ENR count" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const context: t.ForkContext = .{ .fork = .fulu, .custody_requirement = 4, .minimum_sampling_groups = 8 };
    const wanted: t.Coverage = .{ .custody_groups = .full };
    var candidate = try discovered(1, 0);
    try q.enqueueDiscovered(&catalog, &candidate, &context, &wanted, 0);
    try std.testing.expectEqual(@as(u64, 4), candidates[0].custody_work.?.custody_count);
    var budget: u16 = custody_mod.hashes_per_turn;
    try std.testing.expect(!catalog.advanceCustody(&context, 0, 60_000, &budget));
    q.configureSelection(&catalog, &wanted, false, &context, 0);
    try std.testing.expectEqual(@as(usize, 4), candidates[0].custody_work.?.walk.groups.count());
    try std.testing.expectEqual(@as(u2, 2), candidates[0].dial.priority);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expectEqual(@as(u64, 1), q.selected_attempts[@intFromEnum(mod.Dialing.Source.discovery)]);
    candidate.hints.sequence += 1;
    candidate.hints.custody_group_count = 0;
    try q.enqueueDiscovered(&catalog, &candidate, &context, &wanted, 0);
    try std.testing.expectEqual(@as(?u64, 0), candidates[0].dial.hints.?.custody_group_count);
    try std.testing.expect(candidates[0].custody_work == null);
    candidate.hints.custody_group_count = context.custody_groups + 1;
    try std.testing.expectError(error.InvalidCandidate, q.enqueueDiscovered(&catalog, &candidate, &context, &wanted, 0));
    candidate.hints.sequence += 1;
    candidate.hints.custody_group_count = 1;
    try q.enqueueDiscovered(&catalog, &candidate, &context, &wanted, 0);
    try std.testing.expectEqual(@as(u64, 1), candidates[0].custody_work.?.custody_count);
}

test "peer dial custody diagnostics count unfinished derivations without mutating retained coverage" {
    const custody = @import("custody.zig");
    var backing = std.testing.FailingAllocator.init(a, .{});
    var ledger: CountingAllocator = .{ .backing = backing.allocator() };
    var q = try mod.Dialing.init(.{ .capacity = 4, .seed = 4 });
    var catalog = try initCatalog(ledger.allocator(), q.options);
    defer catalog.deinit(ledger.allocator());
    const candidates = catalog.rows[0..q.options.capacity];
    var wanted: t.Coverage = .{};
    wanted.groups.setRangeValue(.{ .start = 0, .end = 128 }, true);
    for ([_]u16{ 2, 1, 128, 2 }, 0..) |count, index| {
        var candidate = try discovered(@intCast(index + 1), 0);
        candidate.hints.custody_group_count = count;
        try q.enqueueDiscovered(&catalog, &candidate, &.{}, &wanted, 0);
    }
    try std.testing.expect((try candidates[1].custody_work.?.step(1)) != null);
    try std.testing.expectEqual(@as(u16, 0), candidates[2].custody_work.?.walk.hashes);
    try std.testing.expectEqual(@as(usize, 128), candidates[2].custody_work.?.walk.groups.count());
    candidates[3].custody_work.?.walk.hashes = custody.hashes_max;
    try std.testing.expectError(error.WorkLimit, candidates[3].custody_work.?.step(1));
    q.configureSelection(&catalog, &wanted, false, &.{}, 0);
    for ([_]u16{ 0, 1, 1, 0 }, candidates) |priority, row| {
        try std.testing.expectEqual(priority, row.dial.priority);
    }

    const works = [4]custody.SamplingDerivation{
        candidates[0].custody_work.?, candidates[1].custody_work.?,
        candidates[2].custody_work.?, candidates[3].custody_work.?,
    };
    const cursor = q.cursor;
    const custody_cursor = catalog.candidate_custody_cursor;
    const random = q.random;
    const calls = backing.allocations;
    const bytes = ledger.bytes;
    try std.testing.expectEqual(@as(usize, 1), custodyIncomplete(&catalog));
    for (0..4) |_| {
        try std.testing.expectEqual(@as(usize, 1), custodyIncomplete(&catalog));
        for (works, candidates, [_]u16{ 0, 1, 1, 0 }) |work, row, priority| {
            try std.testing.expectEqualDeep(work, row.custody_work.?);
            try std.testing.expectEqual(priority, row.dial.priority);
            try std.testing.expectEqual(priority > 0, row.dial.selected);
        }
        try std.testing.expectEqual(cursor, q.cursor);
        try std.testing.expectEqual(custody_cursor, catalog.candidate_custody_cursor);
        try std.testing.expectEqualDeep(random, q.random);
        try std.testing.expect(!catalog.intents_dirty);
        try std.testing.expectEqual(@as(?u64, catalog_mod.Catalog.hint_freshness_ms), q.selection_deadline);
        try std.testing.expectEqual(calls, backing.allocations);
        try std.testing.expectEqual(bytes, ledger.bytes);
    }
}

test "peer dial custody work retains expired unfinished work without claiming eligibility" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    var candidate = try discovered(1, 0);
    candidate.hints.custody_group_count = 1;
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, 0);
    const work = candidates[0].custody_work.?;
    var budget: u16 = 64;
    try std.testing.expect(!catalog.advanceCustody(&.{}, catalog_mod.Catalog.hint_freshness_ms, 60_000, &budget));
    try std.testing.expectEqual(@as(u16, 64), budget);
    try std.testing.expectEqual(@as(usize, 1), custodyIncomplete(&catalog));
    try std.testing.expectEqualDeep(work, candidates[0].custody_work.?);

    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &.{}, catalog_mod.Catalog.hint_freshness_ms);
    try std.testing.expect(!catalog.advanceCustody(&.{}, catalog_mod.Catalog.hint_freshness_ms, 60_000, &budget));
    try std.testing.expectEqual(@as(u16, 63), budget);
    try std.testing.expectEqual(@as(usize, 0), custodyIncomplete(&catalog));
    try std.testing.expectEqual(@as(usize, 1), candidates[0].custody_work.?.walk.groups.count());
}

test "peer dial review group shrink invalidates all hints while preserving owners and authority" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    var candidate = try discovered(1, 1);
    candidate.hints.attnets = .{ 1, 0, 0, 0, 0, 0, 0, 0 };
    candidate.hints.custody_group_count = 128;
    var wanted: t.Coverage = .{ .attnets = 1, .syncnets = 1 };
    wanted.groups.set(0);
    try q.enqueueDiscovered(&catalog, &candidate, &.{}, &wanted, 0);
    q.configureSelection(&catalog, &wanted, false, &.{}, 0);
    try std.testing.expectEqual(@as(u16, 2), candidates[0].dial.priority);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 0, &out));
    try std.testing.expect(q.dialFailed(&catalog, out[0].token, 1));
    const eligible = candidates[0].dial.eligible_at_ms;
    const horizon = candidates[0].dial.replacement_after_ms;
    const failures = candidates[0].dial.failures;
    const context: t.ForkContext = .{ .custody_groups = 64 };
    var budget: u16 = 0;
    try std.testing.expect(!catalog.advanceCustody(&context, eligible, 60_000, &budget));
    q.configureSelection(&catalog, &wanted, false, &context, eligible);
    try std.testing.expectEqual(@as(u16, 0), candidates[0].dial.priority);
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, eligible, &out));
    q.configureSelection(&catalog, &wanted, true, &context, eligible);
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, eligible, &out));
    try std.testing.expectEqual(@as(?u64, null), support.refreshAndWakeup(&q, &catalog, eligible, 1));
    try std.testing.expectEqual(eligible, candidates[0].dial.eligible_at_ms);
    try std.testing.expectEqual(horizon, candidates[0].dial.replacement_after_ms);
    try std.testing.expectEqual(failures, candidates[0].dial.failures);
    try std.testing.expectError(error.InvalidCandidate, q.enqueueDiscovered(&catalog, &candidate, &context, &wanted, eligible));
    candidate.hints.sequence = 2;
    candidate.hints.custody_group_count = 64;
    try q.enqueueDiscovered(&catalog, &candidate, &context, &wanted, eligible);
    q.configureSelection(&catalog, &wanted, false, &context, eligible);
    try std.testing.expectEqual(@as(u16, 2), candidates[0].dial.priority);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, eligible, &out));
    const token = out[0].token;
    const conn: t.Handle = .{ .index = 2, .generation = 99 };
    try std.testing.expect(q.dialStarted(token, conn));
    const lease = q.active[candidates[0].attempt.?].lease_until_ms;
    const smaller: t.ForkContext = .{ .custody_groups = 32 };
    _ = catalog.advanceCustody(&smaller, eligible, 60_000, &budget);
    q.configureSelection(&catalog, &wanted, true, &smaller, eligible);
    try std.testing.expectEqual(conn, q.active[0].connection.?);
    try std.testing.expectEqual(lease, support.refreshAndWakeup(&q, &catalog, eligible, 1).?);
    try std.testing.expectEqual(failures, candidates[0].dial.failures);
    try std.testing.expectEqual(horizon, candidates[0].dial.replacement_after_ms);
    const manual: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 9 }, .port = 9999 } };
    try q.enqueue(&catalog, &candidate.peer, &.{manual}, true, eligible);
    q.configureSelection(&catalog, &wanted, true, &smaller, eligible);
    try std.testing.expectEqual(@as(u16, 0), candidates[0].dial.priority);
    try std.testing.expect(catalog.rowFor(catalog.find(&candidate.peer).?).?.direct);
    try std.testing.expectEqual(conn, q.active[0].connection.?);
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, eligible, &out));
    try std.testing.expect(q.dialClosed(&catalog, conn, .handshake_timeout, eligible));
    const next = support.refreshAndWakeup(&q, &catalog, eligible, 1).?;
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, next, &out));
    try std.testing.expect(out[0].address.eql(manual));
}

test "peer dial review pressure utility excludes every invalid cached hint" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    var old = try discovered(1, 1);
    old.hints.attnets = .{ 1, 0, 0, 0, 0, 0, 0, 0 };
    old.hints.custody_group_count = 128;
    const wanted: t.Coverage = .{ .attnets = 1, .syncnets = 1 };
    try q.enqueueDiscovered(&catalog, &old, &.{}, &wanted, 0);
    const replacement_candidate = try discovered(2, 1);
    try q.enqueueDiscovered(&catalog, &replacement_candidate, &.{ .custody_groups = 64 }, &wanted, 1);
    try std.testing.expect(candidates[0].identity.eql(&replacement_candidate.peer));
}

test "peer dial review custody-only full table recovers at fixed horizon with bounded work" {
    var q = try mod.Dialing.init(.{ .capacity = 2, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    const first_candidate = try discovered(1, 0);
    const second_candidate = try discovered(2, 0);
    var scarce = try discovered(3, 0);
    scarce.hints.custody_group_count = 127;
    var wanted: t.Coverage = .{};
    wanted.groups.setRangeValue(.{ .start = 0, .end = 128 }, true);
    try q.enqueueDiscovered(&catalog, &first_candidate, &.{}, &wanted, 0);
    try q.enqueueDiscovered(&catalog, &second_candidate, &.{}, &wanted, 0);
    for (0..10) |i| {
        const now = i * 60_000;
        try q.enqueueDiscovered(&catalog, &first_candidate, &.{}, &wanted, now);
        try q.enqueueDiscovered(&catalog, &second_candidate, &.{}, &wanted, now);
        try std.testing.expectError(error.Capacity, q.enqueueDiscovered(&catalog, &scarce, &.{}, &wanted, now));
        for (candidates) |row| try std.testing.expect(row.custody_work == null);
    }
    try std.testing.expectError(error.Capacity, q.enqueueDiscovered(&catalog, &scarce, &.{}, &wanted, 599_999));
    try q.enqueueDiscovered(&catalog, &scarce, &.{}, &wanted, 600_000);
    try std.testing.expect(candidates[0].identity.eql(&scarce.peer));
    try std.testing.expectEqual(@as(u16, 0), candidates[0].custody_work.?.walk.hashes);
    q.configureSelection(&catalog, &wanted, false, &.{}, 600_000);
    var out: [1]mod.Dialing.SelectedDial = undefined;
    try std.testing.expectEqual(@as(usize, 0), q.poll(&catalog, 600_000, &out));
    var pending = true;
    for (0..64) |_| {
        var budget: u16 = 128;
        const before = candidates[0].custody_work.?.walk.hashes;
        pending = catalog.advanceCustody(&.{}, 600_000, 60_000, &budget);
        const used = candidates[0].custody_work.?.walk.hashes - before;
        try std.testing.expect(used <= 64);
        try std.testing.expectEqual(@as(u16, 128) - used, budget);
        if (!pending) break;
    }
    try std.testing.expect(!pending);
    try std.testing.expect(candidates[0].custody_work.?.walk.hashes <= 4096);
    q.configureSelection(&catalog, &wanted, false, &.{}, 600_000);
    try std.testing.expectEqual(@as(u16, 1), candidates[0].dial.priority);
    try std.testing.expectEqual(@as(usize, 1), q.poll(&catalog, 600_000, &out));
    try std.testing.expect(out[0].peer.eql(&scarce.peer));
}

test "peer dial actual custody gives no utility for connected sampling only groups" {
    var q = try mod.Dialing.init(.{ .capacity = 1, .concurrent_max = 1, .seed = 4 });
    var catalog = try initCatalog(a, q.options);
    defer catalog.deinit(a);
    const candidates = catalog.rows[0..q.options.capacity];
    var candidate = try discovered(1, 0);
    candidate.hints.custody_group_count = 4;
    const context: t.ForkContext = .{ .fork = .fulu, .minimum_sampling_groups = 8 };
    var pair = try custody_mod.SamplingDerivation.init(&candidate.node_id, .{ .groups = 128, .columns = 128 }, 4, 8);
    const derived = (try pair.step(64)).?;
    var wanted: t.Coverage = .{ .groups = derived.sampling.differenceWith(derived.custody) };
    try std.testing.expectEqual(@as(usize, 4), wanted.groups.count());
    try q.enqueueDiscovered(&catalog, &candidate, &context, &wanted, 0);
    var budget: u16 = 64;
    try std.testing.expect(!catalog.advanceCustody(&context, 0, 60_000, &budget));
    q.configureSelection(&catalog, &wanted, false, &context, 0);
    try std.testing.expectEqual(@as(u16, 0), candidates[0].dial.priority);
    try std.testing.expect(!candidates[0].dial.selected);
    try std.testing.expectEqual(@as(u16, 4), policy.utility(&.{ .groups = derived.sampling }, &wanted));
    wanted.groups = derived.custody;
    q.configureSelection(&catalog, &wanted, false, &context, 0);
    try std.testing.expectEqual(@as(u16, 1), candidates[0].dial.priority);
    try std.testing.expect(candidates[0].dial.selected);
}

fn custodyIncomplete(catalog: *const catalog_mod.Catalog) usize {
    var count: usize = 0;
    var it = catalog.intents.iterator(.{});
    while (it.next()) |index| {
        const work = &(catalog.rows[index].custody_work orelse continue);
        count += @intFromBool(!work.exhausted() and work.complete() == null);
    }
    return count;
}
