const std = @import("std");
const Budget = @import("response_budget.zig").Budget;
const Now = @import("../time.zig").Now;

fn at(ms: u64) Now {
    return Now.fromMilliseconds(.{ .mono_ms = ms, .unix_s = 0 });
}

test "response budget earns proportional chunk credit without a chunk-count bonus" {
    var whole = Budget.init(&at(100), .fromSeconds(60));
    var split = whole;
    whole.credit(1024 * 1024, &at(1_100));
    for (0..1024) |_| split.credit(1024, &at(1_100));
    try std.testing.expectEqual(@as(u64, 11_100), whole.deadline_ms);
    try std.testing.expectEqualDeep(whole, split);
    split.credit(0, &at(1_100));
    try std.testing.expectEqualDeep(whole, split);
}

test "response budget caps banked credit and discards excess fractions" {
    var budget = Budget.init(&at(100), .fromSeconds(60));
    budget.credit(1024 * 1024 + 1, &at(101));
    try std.testing.expectEqual(@as(u64, 10_101), budget.deadline_ms);
    try std.testing.expectEqual(@as(u32, 0), budget.remainder);
    budget.credit(1024, &at(102));
    try std.testing.expectEqual(@as(u64, 10_101), budget.deadline_ms);
}

test "response budget progress and host pauses cannot extend the absolute limit" {
    var budget = Budget.init(&at(100), .fromSeconds(60));
    for (1..7) |i| budget.credit(9 * 1024 * 1024, &at(100 + i * 9_000));
    try std.testing.expectEqual(@as(u64, 60_100), budget.deadline_ms);
    try std.testing.expectEqual(@as(u64, 60_100), budget.limit_ms);
    budget.excludeHostTime(std.math.maxInt(u64));
    try std.testing.expectEqual(budget.limit_ms, budget.deadline_ms);
    budget = Budget.init(&at(100), .fromSeconds(60));
    budget.excludeHostTime(15_000);
    try std.testing.expectEqual(@as(u64, 25_100), budget.deadline_ms);
    try std.testing.expectEqual(@as(u64, 60_100), budget.limit_ms);
}

test "response budget honors short absolute limits and fractional clock samples" {
    var now = at(100);
    now.monotonic.raw.nanoseconds += 500_000;
    var budget = Budget.init(&now, .fromNanoseconds(500_000));
    try std.testing.expectEqual(@as(u64, 101), budget.deadline_ms);
    budget.credit(1024 * 1024, &now);
    try std.testing.expectEqual(@as(u64, 101), budget.deadline_ms);
    budget.excludeHostTime(1);
    try std.testing.expectEqual(@as(u64, 101), budget.deadline_ms);
}
