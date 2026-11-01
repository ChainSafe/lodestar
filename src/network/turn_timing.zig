const std = @import("std");
const timing = @import("metrics/timing.zig");

pub const Phase = enum { receive, transport, host, protocols, maintenance, send };

pub const TurnTiming = struct {
    previous: u64 = 0,
    phases: [std.meta.fields(Phase).len]timing.Duration = @splat(.{}),

    pub fn begin(self: *TurnTiming, now_ns: u64) void {
        self.previous = now_ns;
    }

    pub fn mark(self: *TurnTiming, io: std.Io, phase: Phase) void {
        self.markAt(timing.now(io), phase);
    }

    fn markAt(self: *TurnTiming, now_ns: u64, phase: Phase) void {
        self.phases[@intFromEnum(phase)].observe(now_ns -| self.previous);
        self.previous = now_ns;
    }
};

test "turn phase durations exclude idle time" {
    var timer: TurnTiming = .{};
    timer.begin(0);
    timer.markAt(10, .receive);
    timer.markAt(30, .host);
    timer.begin(100);
    timer.markAt(115, .receive);
    timer.markAt(125, .protocols);
    try std.testing.expectEqual(@as(u128, 25), timer.phases[0].sum);
    try std.testing.expectEqual(@as(u64, 2), timer.phases[0].count);
    try std.testing.expectEqual(@as(u128, 20), timer.phases[2].sum);
    try std.testing.expectEqual(@as(u128, 10), timer.phases[3].sum);
    try std.testing.expectEqual(@as(u64, 0), timer.phases[5].count);
}
