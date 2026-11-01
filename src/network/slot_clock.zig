const std = @import("std");
const clock = @import("clock");
const ChainConfig = @import("config").ChainConfig;
const p = @import("preset").preset;
const Now = @import("time.zig").Now;

pub const SlotClock = struct {
    config: clock.ClockConfig,
    observed_slot: i64 = std.math.minInt(i64),

    pub fn init(chain: *const ChainConfig, genesis_time: u64) !SlotClock {
        const maximum = std.math.maxInt(i64);
        if (genesis_time > maximum / 1000) return error.InvalidSlotClock;
        for ([_]u64{ chain.SLOT_DURATION_MS, chain.SLOT_DURATION_MS_HEZE }) |duration| {
            if (duration == 0 or duration > 86_400_000) return error.InvalidSlotClock;
        }
        var config: clock.ClockConfig = .{
            .genesis_time_sec = genesis_time,
            .slot_duration_ms = chain.SLOT_DURATION_MS,
            .slots_per_epoch = p.SLOTS_PER_EPOCH,
            .maximum_gossip_clock_disparity_ms = chain.MAXIMUM_GOSSIP_CLOCK_DISPARITY,
        };
        if (chain.HEZE_FORK_EPOCH == 0) {
            config.slot_duration_ms = chain.SLOT_DURATION_MS_HEZE;
        } else if (chain.HEZE_FORK_EPOCH != std.math.maxInt(u64)) {
            const slot = std.math.mul(u64, chain.HEZE_FORK_EPOCH, p.SLOTS_PER_EPOCH) catch return error.InvalidSlotClock;
            const offset = std.math.mul(u64, slot, chain.SLOT_DURATION_MS) catch return error.InvalidSlotClock;
            if (offset > maximum - genesis_time * 1000) return error.InvalidSlotClock;
            config.duration_transitions.push(.{ .from_slot = slot, .new_duration_ms = chain.SLOT_DURATION_MS_HEZE });
        }
        try config.validate();
        return .{ .config = config };
    }

    pub fn unixMilliseconds(now: Now) error{ClockOutOfRange}!u64 {
        const ms = now.wall.raw.toMilliseconds();
        if (ms < 0 or ms > std.math.maxInt(i64) - 86_400_000) return error.ClockOutOfRange;
        return @intCast(ms);
    }

    pub fn slotAt(self: *const SlotClock, unix_ms: u64) i64 {
        if (clock.slot_math.slotAtMs(self.config, unix_ms)) |slot| return @intCast(slot);
        return -@as(i64, @intCast(std.math.divCeil(u64, self.config.genesis_time_sec * 1000 - unix_ms, self.config.slot_duration_ms) catch unreachable));
    }

    /// Wall-clock corrections never reverse network slot progression.
    pub fn read(self: *SlotClock, now: Now) error{ClockOutOfRange}!i64 {
        self.observed_slot = @max(self.observed_slot, self.slotAt(try unixMilliseconds(now)));
        return self.observed_slot;
    }

    /// Recheck wall time at least once a second, including before genesis and after clock corrections.
    pub fn deadline(self: *const SlotClock, now: Now) !std.Io.Clock.Timestamp {
        const ms = try unixMilliseconds(now);
        const genesis_ms = self.config.genesis_time_sec * 1000;
        const delay = if (ms < genesis_ms)
            (genesis_ms - ms - 1) % self.config.slot_duration_ms + 1
        else
            clock.slot_math.msUntilNextSlot(self.config, ms);
        return now.monotonic.addDuration(.{ .clock = .awake, .raw = .fromMilliseconds(@min(delay, 1000)) });
    }

    pub fn futureSlot(self: *const SlotClock, now: Now) !u64 {
        const ms = try unixMilliseconds(now);
        const current = clock.slot_math.slotAtMs(self.config, ms) orelse 0;
        const tolerance = @min(self.config.maximum_gossip_clock_disparity_ms, clock.slot_math.slotDurationMsAt(self.config, current) / 2);
        return @intCast(@max(0, self.slotAt(ms + tolerance)));
    }
};

test {
    _ = @import("slot_clock_test.zig");
}
