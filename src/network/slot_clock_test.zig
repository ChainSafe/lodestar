const std = @import("std");
const config = @import("config");
const p = @import("preset").preset;
const SlotClock = @import("slot_clock.zig").SlotClock;
const Now = @import("time.zig").Now;

test "slot clock handles pregenesis and Heze duration changes without replay" {
    const chain = config.mainnet.chain_config.merge(.{ .HEZE_FORK_EPOCH = 2, .SLOT_DURATION_MS_HEZE = 6000 });
    const clock = try SlotClock.init(&chain, 1000);
    try std.testing.expectEqual(-2, clock.slotAt(987_999));
    try std.testing.expectEqual(-1, clock.slotAt(988_000));
    try std.testing.expectEqual(0, clock.slotAt(1_000_000));
    const transition = 1_000_000 + 2 * p.SLOTS_PER_EPOCH * 12000;
    try std.testing.expectEqual(2 * p.SLOTS_PER_EPOCH - 1, clock.slotAt(transition - 1));
    try std.testing.expectEqual(2 * p.SLOTS_PER_EPOCH, clock.slotAt(transition));
    try std.testing.expectEqual(2 * p.SLOTS_PER_EPOCH + 100, clock.slotAt(transition + 600_000));
    const at_genesis = try SlotClock.init(&chain.merge(.{ .HEZE_FORK_EPOCH = 0 }), 1000);
    try std.testing.expectEqual(1, at_genesis.slotAt(1_006_000));
    const unscheduled = try SlotClock.init(&chain.merge(.{ .HEZE_FORK_EPOCH = std.math.maxInt(u64) }), 1000);
    try std.testing.expectEqual(0, unscheduled.slotAt(1_006_000));
    const shorter = try SlotClock.init(&chain.merge(.{ .SLOT_DURATION_MS_HEZE = 1000, .MAXIMUM_GOSSIP_CLOCK_DISPARITY = 6000 }), 1000);
    var tick = Now.fromMilliseconds(.{ .mono_ms = 100, .unix_s = 1000 });
    tick.wall.raw.nanoseconds = (transition + 499) * std.time.ns_per_ms;
    try std.testing.expectEqual(2 * p.SLOTS_PER_EPOCH, try shorter.futureSlot(tick));
    tick.wall.raw.nanoseconds += std.time.ns_per_ms;
    try std.testing.expectEqual(2 * p.SLOTS_PER_EPOCH + 1, try shorter.futureSlot(tick));
    try std.testing.expectEqual(600, (try shorter.deadline(tick)).raw.toMilliseconds());
}

test "slot clock bounds public configuration and maps wall boundaries to awake deadlines" {
    const base = &config.mainnet.chain_config;
    try std.testing.expectError(error.InvalidSlotClock, SlotClock.init(base, std.math.maxInt(u64)));
    try std.testing.expectError(error.InvalidSlotClock, SlotClock.init(&base.merge(.{ .HEZE_FORK_EPOCH = std.math.maxInt(u64) - 1 }), 0));
    try std.testing.expectError(error.InvalidSlotClock, SlotClock.init(&base.merge(.{ .SLOT_DURATION_MS = 0 }), 0));
    for ([_]u64{ 0, 20, std.math.maxInt(u64) }) |epoch| {
        try std.testing.expectError(error.InvalidSlotClock, SlotClock.init(&base.merge(.{ .HEZE_FORK_EPOCH = epoch, .SLOT_DURATION_MS_HEZE = 0 }), 0));
    }
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
