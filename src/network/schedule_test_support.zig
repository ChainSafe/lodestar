const std = @import("std");
const Schedule = @import("schedule.zig").Schedule;
const Protocols = @import("protocols.zig").Protocols;
const time = @import("time.zig");

pub fn wakeupMilliseconds(schedule: Schedule, now_ms: u64) ?u64 {
    const value = schedule.nextWakeup(time.milliseconds(now_ms)) orelse return null;
    const ns = value.raw.nanoseconds;
    return @intCast(@divTrunc(ns, 1_000_000) + @intFromBool(@mod(ns, 1_000_000) != 0));
}

pub fn waitMilliseconds(schedule: Schedule, now_ms: u64, maximum_ms: u32) u32 {
    const now = time.milliseconds(now_ms);
    const maximum = std.Io.Duration.fromMilliseconds(maximum_ms);
    return time.waitMilliseconds(schedule.timeout(now, maximum).deadline, now, maximum);
}

pub fn protocolsSchedule(protocols: *const Protocols, capacities: Protocols.Capacities) Schedule {
    return protocols.schedule(capacities);
}
