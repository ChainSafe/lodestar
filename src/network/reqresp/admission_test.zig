const std = @import("std");
const a = @import("admission.zig");
const Source = a.Source;
const Options = @import("quotas.zig").Options;
const quotas = @import("admission_fixture.zig").quotas;
const Protocol = @import("protocol.zig").Protocol;
const first: Source = .{ .ip4 = .{ 192, 0, 2, 1 } };
const second: Source = .{ .ip4 = .{ 192, 0, 2, 2 } };
const method: Protocol = .blocks_by_root_v2;

fn options(tokens: u32, global: u32) Options {
    return .{ .source = quotas(tokens, 1000), .global = quotas(global, 1000), .starts = .{ .tokens = 2, .period_ms = 1000 }, .global_starts = .{ .tokens = 8, .period_ms = 1000 } };
}

fn started(owner: *a.Limiter, source: Source, now: u64) !u16 {
    const row = owner.retain(&.{ .address = source }, now);
    try std.testing.expectEqual(a.Decision.allowed, owner.start(row, now));
    return row;
}

test "reqresp sources keep usage through reconnects and overlapping connections" {
    var owner = try a.Limiter.init(std.testing.allocator, .all, options(2, 100), 2);
    defer owner.deinit(std.testing.allocator);
    const old = try started(&owner, first, 0);
    const replacement = owner.retain(&.{ .address = first }, 0);
    try std.testing.expectEqual(old, replacement);
    try std.testing.expectEqual(a.Decision.allowed, owner.take(old, method, 2, .fulu, 0));
    owner.release(old);
    try std.testing.expectEqual(@as(u16, 1), owner.rows[replacement].connections);
    owner.release(replacement);
    const reconnected = owner.retain(&.{ .address = first }, 1);
    try std.testing.expectEqual(old, reconnected);
    try std.testing.expectEqual(a.Decision.source_quota, owner.take(reconnected, method, 1, .fulu, 1));
    try std.testing.expectEqual(a.Decision.allowed, owner.take(reconnected, method, 1, .fulu, 500));
    owner.release(reconnected);
}

test "reqresp start hints and refusals preserve source and global allowances atomically" {
    var limits = options(10, 20);
    limits.global_starts.tokens = 2;
    var owner = try a.Limiter.init(std.testing.allocator, .all, limits, 2);
    defer owner.deinit(std.testing.allocator);
    const one = try started(&owner, first, 0);
    const two = try started(&owner, second, 0);
    const before = owner.rows[one];
    try std.testing.expectEqual(a.Decision.global_quota, owner.start(one, 0));
    try std.testing.expectEqualDeep(before, owner.rows[one]);
    for (0..3) |_| try std.testing.expectEqual(@as(u64, 500), owner.startAt(one, 0));
    try std.testing.expectEqual(a.Decision.global_quota, owner.start(two, 499));
    try std.testing.expectEqual(a.Decision.allowed, owner.start(one, 500));
    try std.testing.expectEqual(@as(u64, 1000), owner.startAt(two, 500));
    owner.release(one);
    owner.release(two);
}

test "reqresp starts isolate control and application while retaining their own debt" {
    var application = try a.Limiter.init(std.testing.allocator, .application, options(10, 20), 1);
    defer application.deinit(std.testing.allocator);
    var control = try a.Limiter.init(std.testing.allocator, .control, options(10, 20), 1);
    defer control.deinit(std.testing.allocator);
    const row = try started(&application, first, 0);
    try std.testing.expectEqual(a.Decision.allowed, application.start(row, 0));
    try std.testing.expectEqual(a.Decision.source_quota, application.start(row, 499));
    const independent = control.retain(&.{ .peer = .{ .bytes = @splat(1) } }, 499);
    try std.testing.expectEqual(a.Decision.allowed, control.start(independent, 499));
    control.release(independent);
    application.release(row);
    const reconnect = application.retain(&.{ .address = first }, 499);
    try std.testing.expectEqual(@as(u64, 500), application.startAt(reconnect, 499));
    try std.testing.expectEqual(a.Decision.allowed, application.start(reconnect, 500));
    application.release(reconnect);
}

test "reqresp source protocol eligibility and aggregate refusal never refund usage" {
    var owner = try a.Limiter.init(std.testing.allocator, .all, options(2, 2), 2);
    defer owner.deinit(std.testing.allocator);
    const one = try started(&owner, first, 0);
    const two = try started(&owner, second, 0);
    try std.testing.expectEqual(a.Decision.allowed, owner.take(one, method, 2, .fulu, 0));
    const before = owner.rows[two];
    try std.testing.expectEqual(a.Decision.global_quota, owner.take(two, method, 1, .fulu, 0));
    try std.testing.expectEqualDeep(before, owner.rows[two]);
    try std.testing.expectEqual(@as(?u64, 500), owner.eligibleAt(two, method, 1, .fulu, 0));
    try std.testing.expectEqual(a.Decision.allowed, owner.take(two, method, 1, .fulu, 500));
    try std.testing.expectEqual(@as(?u64, 1000), owner.eligibleAt(one, method, 1, .fulu, 500));
    try std.testing.expectEqual(@as(?u64, null), owner.eligibleAt(one, method, 3, .fulu, 500));
    try std.testing.expectEqual(@as(u128, 2), owner.requestCost(method, 3, .fulu));
    owner.release(one);
    owner.release(two);
}

test "reqresp source admission accumulates expensive request credit alongside small requests" {
    var owner = try a.Limiter.init(std.testing.allocator, .all, options(4, 4), 2);
    defer owner.deinit(std.testing.allocator);
    const one = try started(&owner, first, 0);
    const two = try started(&owner, second, 0);
    try std.testing.expectEqual(a.Decision.allowed, owner.take(two, method, 4, .fulu, 0));
    var paid: u128 = 0;
    for (1..8) |tick| {
        const now: u64 = @intCast(tick * 250);
        if (tick % 2 == 1) {
            const credit = owner.grant(one, method, 4 - paid, .fulu, now);
            try std.testing.expectEqual(@as(u128, 1), credit);
            paid += credit;
        } else try std.testing.expectEqual(@as(u128, 1), owner.grant(two, method, 1, .fulu, now));
        try std.testing.expectEqual(@as(u128, 0), owner.grant(two, method, 1, .fulu, now));
        try std.testing.expectEqual(@as(?u64, now + 250), owner.eligibleAt(one, method, 1, .fulu, now));
    }
    try std.testing.expectEqual(@as(u128, 4), paid);
    owner.release(one);
    owner.release(two);
}

test "reqresp capacity admits idle peers and sources through sustained retained-usage churn" {
    try retainedChurn(false);
    try retainedChurn(true);
}

fn retainedChurn(peer_keys: bool) !void {
    var limits = options(2, 100);
    limits.global_starts.tokens = 4;
    var owner = try a.Limiter.init(std.testing.allocator, .all, limits, 2);
    defer owner.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 12), owner.rows.len);
    const idle_key: a.Key = if (peer_keys) .{ .peer = .{ .bytes = @splat(0) } } else .{ .address = first };
    const idle = owner.retain(&idle_key, 0);
    var sequence: u16 = 0;
    for (0..40) |tick| {
        const now: u64 = @intCast(tick * 250);
        for (0..5) |_| {
            sequence += 1;
            const source: Source = .{ .ip4 = .{ 198, 51, @truncate(sequence >> 8), @truncate(sequence) } };
            var key: a.Key = if (peer_keys) .{ .peer = .{ .bytes = @splat(0) } } else .{ .address = source };
            if (peer_keys) std.mem.writeInt(u16, key.peer.bytes[0..2], sequence, .little);
            const row = owner.retain(&key, now);
            const decision = owner.start(row, now);
            if (decision == .allowed) {
                try std.testing.expectEqual(a.Decision.allowed, owner.take(row, method, 2, .fulu, now));
            } else try std.testing.expectEqual(a.Decision.global_quota, decision);
            owner.release(row);
        }
        try std.testing.expect(owner.rows[idle].key.eql(&idle_key));
        try std.testing.expectEqual(@as(u16, 1), owner.rows[idle].connections);
    }
    owner.release(idle);
    try std.testing.expectEqual(@as(u16, 0), owner.connections);
}

test "reqresp capacity includes delayed protocol charges from connections predating the start window" {
    var limits = options(2, 100);
    limits.global_starts.tokens = 2;
    var owner = try a.Limiter.init(std.testing.allocator, .all, limits, 2);
    defer owner.deinit(std.testing.allocator);
    const delayed = try started(&owner, first, 0);
    for (0..2) |index| {
        const source: Source = .{ .ip4 = .{ 198, 51, 100, @intCast(index) } };
        const row = try started(&owner, source, 2000);
        try std.testing.expectEqual(a.Decision.allowed, owner.take(row, method, 2, .fulu, 2000));
        owner.release(row);
    }
    try std.testing.expectEqual(a.Decision.allowed, owner.take(delayed, method, 2, .fulu, 2000));
    owner.release(delayed);
    const fresh = owner.retain(&.{ .address = second }, 2000);
    try std.testing.expectEqual(a.Decision.global_quota, owner.start(fresh, 2000));
    owner.release(fresh);
    const reconnect = owner.retain(&.{ .address = first }, 2001);
    try std.testing.expectEqual(a.Decision.source_quota, owner.take(reconnect, method, 1, .fulu, 2001));
    owner.release(reconnect);
}

test "reqresp source fork quota changes and integer rounding retain nanosecond debt" {
    var limits = options(4, 100);
    limits.source.blocks_pre_deneb.tokens = 2;
    limits.starts.tokens = 3;
    var owner = try a.Limiter.init(std.testing.allocator, .all, limits, 1);
    defer owner.deinit(std.testing.allocator);
    const row = try started(&owner, first, 0);
    try std.testing.expectEqual(a.Decision.allowed, owner.start(row, 0));
    try std.testing.expectEqual(a.Decision.source_quota, owner.start(row, 0));
    try std.testing.expectEqual(@as(u64, 1), owner.startAt(row, 0));
    try std.testing.expectEqual(a.Decision.allowed, owner.take(row, method, 2, .capella, 0));
    try std.testing.expectEqual(a.Decision.source_quota, owner.take(row, method, 1, .fulu, 0));
    try std.testing.expectEqual(a.Decision.allowed, owner.take(row, method, 1, .fulu, 250));
    try std.testing.expectEqual(a.Decision.allowed, owner.take(row, method, 4, .fulu, std.math.maxInt(u64)));
    try std.testing.expectEqual(a.Decision.source_quota, owner.take(row, method, 1, .fulu, std.math.maxInt(u64)));
    owner.release(row);
}

test "reqresp light client credit refills at the configured slot rate through reconnects" {
    var policy = @import("policy_fixture.zig").config();
    policy.slot_duration_ms = 5000;
    policy.slot_duration_ms_heze = 24000;
    const limits = try Options.defaults(&policy, 8);
    var owner = try a.Limiter.init(std.testing.allocator, .application, limits, 1);
    defer owner.deinit(std.testing.allocator);
    const which: Protocol = .light_client_finality_update_v1;
    const row = try started(&owner, first, 0);
    try std.testing.expectEqual(a.Decision.allowed, owner.take(row, which, 2, .gloas, 0));
    try std.testing.expectEqual(@as(?u64, 2500), owner.eligibleAt(row, which, 1, .gloas, 0));
    owner.release(row);
    const reconnected = owner.retain(&.{ .address = first }, 2499);
    try std.testing.expectEqual(row, reconnected);
    try std.testing.expectEqual(a.Decision.source_quota, owner.take(reconnected, which, 1, .gloas, 2499));
    try std.testing.expectEqual(a.Decision.allowed, owner.take(reconnected, which, 1, .gloas, 2500));
    try std.testing.expectEqual(a.Decision.allowed, owner.take(reconnected, which, 2, .heze, 24000));
    try std.testing.expectEqual(@as(?u64, 36000), owner.eligibleAt(reconnected, which, 1, .heze, 24000));
    owner.release(reconnected);
}

test "reqresp retained source capacity covers the longest fork quota period" {
    var limits = options(2, 100);
    limits.global_starts.tokens = 2;
    limits.source.light_client_heze.period_ms = 24000;
    try std.testing.expectEqual(@as(u16, 52), try a.Limiter.capacity(&limits, .application, 1));
    for ([_]u64{ 0, 86_400_001, std.math.maxInt(u64) }) |period| {
        var invalid = limits;
        invalid.source.light_client_heze.period_ms = period;
        try std.testing.expectError(error.InvalidQuota, a.Limiter.validate(&invalid));
        invalid = limits;
        invalid.global.light_client_heze.period_ms = period;
        try std.testing.expectError(error.InvalidQuota, a.Limiter.validate(&invalid));
    }
}

fn allocation(allocator: std.mem.Allocator) !void {
    var owner = try a.Limiter.init(allocator, .all, options(2, 100), 2);
    defer owner.deinit(allocator);
    const row = try started(&owner, first, 0);
    try std.testing.expectEqual(a.Decision.allowed, owner.take(row, method, 1, .fulu, 0));
    owner.release(row);
}

test "reqresp source allocation prefixes and invalid numeric bounds" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocation, .{});
    try std.testing.expectError(error.InvalidOptions, a.Limiter.init(std.testing.allocator, .all, options(2, 100), 0));
    try std.testing.expectError(error.InvalidOptions, a.Limiter.init(std.testing.allocator, .{}, options(2, 100), 2));
    var limits = options(2, 100);
    limits.global_starts.tokens = std.math.maxInt(u32);
    try std.testing.expectError(error.InvalidOptions, a.Limiter.init(std.testing.allocator, .all, limits, 2));
    for ([_]u64{ 0, 86_400_001, std.math.maxInt(u64) }) |period| {
        limits = options(2, 100);
        limits.global_starts.period_ms = period;
        try std.testing.expectError(error.InvalidQuota, a.Limiter.init(std.testing.allocator, .all, limits, 2));
    }
    limits = options(0, 100);
    try std.testing.expectError(error.InvalidQuota, a.Limiter.init(std.testing.allocator, .all, limits, 2));
}
