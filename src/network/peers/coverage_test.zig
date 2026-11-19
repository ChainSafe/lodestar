const std = @import("std");
const preset = @import("preset");
const coverage = @import("coverage.zig");
const t = @import("types.zig");
const Subnets = @import("../gossipsub/topic_policy.zig").Subnets;

test "gossip coverage requires every column subnet in a group and never implies custody" {
    const context: t.ForkContext = .{ .fork = .fulu, .custody_groups = preset.NUMBER_OF_COLUMNS / 2 };
    try context.validate();
    var subscriptions: Subnets = .{ .attnets = 3, .syncnets = 2, .column_subnet_count = preset.NUMBER_OF_COLUMNS };
    subscriptions.columns.set(0);
    var actual = coverage.gossip(&subscriptions, &context);
    try std.testing.expectEqual(@as(u64, 3), actual.attnets);
    try std.testing.expectEqual(@as(u4, 2), actual.syncnets);
    try std.testing.expectEqual(@as(usize, 0), actual.groups.count());
    subscriptions.columns.set(context.custody_groups);
    actual = coverage.gossip(&subscriptions, &context);
    try std.testing.expectEqual(@as(usize, 1), actual.groups.count());
    try std.testing.expect(actual.groups.isSet(0));
    try std.testing.expectEqual(@as(usize, 0), actual.custody_groups.count());
    subscriptions.columns.unset(context.custody_groups);
    subscriptions.column_subnet_count = context.custody_groups;
    actual = coverage.gossip(&subscriptions, &context);
    try std.testing.expect(actual.groups.isSet(0));
    try std.testing.expectEqual(@as(usize, 0), coverage.gossip(&subscriptions, &.{}).groups.count());
}

test "stable preference intersects actual coverage without excluding temporary subscriptions" {
    var actual: t.Coverage = .{ .attnets = 3, .syncnets = 3 };
    actual.groups.set(0);
    var sampled = actual.groups;
    sampled.set(1);
    const preferred = coverage.stable(&actual, &.{ .attnets = .{ 5, 0, 0, 0, 0, 0, 0, 0 }, .syncnets = 5 }, sampled);
    try std.testing.expectEqual(@as(u64, 1), preferred.attnets);
    try std.testing.expectEqual(@as(u4, 1), preferred.syncnets);
    try std.testing.expectEqual(@as(usize, 1), preferred.groups.count());
    try std.testing.expect(preferred.groups.isSet(0));
    try std.testing.expectEqual(@as(u64, 3), actual.attnets);
}
