const topic_fixture = @import("topic_fixture.zig");
const Options = @import("options.zig").Options;
const constants = @import("constants.zig");
const preset = @import("preset");
const gossip_limits = @import("../gossip_limits.zig");
const mcache = @import("mcache.zig");
const options = @import("options.zig");
const std = @import("std");

test "gossip policy default epoch timers follow the selected preset and require entropy" {
    try std.testing.expectError(error.InvalidLimits, Options.validate(&.{ .topic_policy = &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })} }));
    const o: Options = .{ .topic_policy = &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })}, .random_seed = 1 };
    try o.validate();
    try std.testing.expectError(error.InvalidTopicPolicy, Options.validate(&.{ .random_seed = 1 }));
    const expected: u64 = switch (preset.active_preset) {
        .mainnet => 768_000,
        .minimal => 192_000,
        .gnosis => 384_000,
    };
    try std.testing.expectEqual(expected, o.seen_ttl_ms);
    try std.testing.expectEqual(expected * 50, o.retained_score_ms);
}

test "gossip policy wire limits validate inclusive boundaries" {
    var o: Options = .{ .topic_policy = &.{topic_fixture.bytes(.{ 1, 2, 3, 4 })}, .random_seed = 1, .iwant_followup_ms = 12_000, .idontwant_min_data_size = 0 };
    try o.validate();
    o.iwant_followup_ms = 86_400_000;
    o.idontwant_min_data_size = constants.GOSSIP_MAX_SIZE;
    try o.validate();
    o.iwant_followup_ms = 0;
    try std.testing.expectError(error.InvalidLimits, o.validate());
    o.iwant_followup_ms = 86_400_001;
    try std.testing.expectError(error.InvalidLimits, o.validate());
    o.iwant_followup_ms = 1;
    o.idontwant_min_data_size = constants.GOSSIP_MAX_SIZE + 1;
    try std.testing.expectError(error.InvalidLimits, o.validate());
}

test "gossip policy seen capacity covers history turnover within its ceiling" {
    const limits: gossip_limits.Limits = @splat(.{ .items = 8, .bytes = 4096 });
    const items = gossip_limits.items(&limits);
    var o: Options = .{ .seen_capacity = 1, .heartbeat_interval_ms = 700, .seen_ttl_ms = 4201 };
    try o.setPayloadLimits(&limits);
    try std.testing.expectEqual(items * 2, o.seen_capacity);
    o.seen_capacity = 1;
    o.seen_ttl_ms = 4200;
    try o.setPayloadLimits(&limits);
    try std.testing.expectEqual(items, o.seen_capacity);
    o.seen_capacity = 65_536;
    try o.setPayloadLimits(&limits);
    try std.testing.expectEqual(@as(usize, 65_536), o.seen_capacity);
    o.seen_ttl_ms = 86_400_000;
    o.heartbeat_interval_ms = 1;
    try o.setPayloadLimits(&limits);
    try std.testing.expectEqual(options.seen_capacity_max, o.seen_capacity);
    try std.testing.expectEqual(@as(usize, 36 * 1024 * 1024), mcache.SeenCache.backingBytes(o.seen_capacity));
    o.heartbeat_interval_ms = 0;
    try std.testing.expectError(error.InvalidLimits, o.setPayloadLimits(&limits));
    o.heartbeat_interval_ms = std.math.maxInt(u64);
    try std.testing.expectError(error.InvalidLimits, o.setPayloadLimits(&limits));
    o.heartbeat_interval_ms = 700;
    o.seen_ttl_ms = 0;
    try std.testing.expectError(error.InvalidLimits, o.setPayloadLimits(&limits));
    o.seen_ttl_ms = std.math.maxInt(u64);
    try std.testing.expectError(error.InvalidLimits, o.setPayloadLimits(&limits));
}
