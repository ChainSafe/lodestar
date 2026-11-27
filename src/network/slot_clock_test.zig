const std = @import("std");
const config = @import("config");
const SlotClock = @import("slot_clock.zig").SlotClock;
const Now = @import("time.zig").Now;

test "slot clock handles pregenesis" {
    const clock = try SlotClock.init(&config.mainnet.chain_config, 1000);
    try std.testing.expectEqual(-2, clock.slotAt(987_999));
    try std.testing.expectEqual(-1, clock.slotAt(988_000));
    try std.testing.expectEqual(0, clock.slotAt(1_000_000));
}

test "slot clock bounds public configuration and maps wall boundaries to awake deadlines" {
    const base = &config.mainnet.chain_config;
    try std.testing.expectError(error.InvalidSlotClock, SlotClock.init(base, std.math.maxInt(u64)));
    try std.testing.expectError(error.InvalidSlotClock, SlotClock.init(&base.merge(.{ .SLOT_DURATION_MS = 0 }), 0));
    const clock = try SlotClock.init(base, 1000);
    var now = Now.fromMilliseconds(.{ .mono_ms = 10, .unix_s = 999 });
    now.wall.raw = .fromNanoseconds(999_900 * std.time.ns_per_ms);
    try std.testing.expectEqual(110, (try clock.deadline(now)).raw.toMilliseconds());
    try std.testing.expectEqual(0, try clock.futureSlot(now));
    now.wall.raw = .fromNanoseconds(1_011_500 * std.time.ns_per_ms);
    try std.testing.expectEqual(1, try clock.futureSlot(now));
    now.wall.raw = .fromNanoseconds(100 * std.time.ns_per_ms);
    try std.testing.expectEqual(1010, (try clock.deadline(now)).raw.toMilliseconds());
}

test "slot clock preserves observed progress across clock regression and rejected samples" {
    var clock = try SlotClock.init(&config.mainnet.chain_config, 1000);
    const before = Now.fromMilliseconds(.{ .mono_ms = 0, .unix_s = 988 });
    try std.testing.expectEqual(-1, try clock.read(before));
    const after = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 1120 });
    try std.testing.expectEqual(10, try clock.read(after));
    try std.testing.expectEqual(10, try clock.read(before));
    try std.testing.expectError(error.ClockOutOfRange, clock.read(Now.fromMilliseconds(.{ .mono_ms = 2, .unix_s = -1 })));
    try std.testing.expectEqual(10, try clock.read(before));
}
