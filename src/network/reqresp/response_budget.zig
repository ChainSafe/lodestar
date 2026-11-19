const std = @import("std");
const constants = @import("constants.zig");
const Now = @import("../time.zig").Now;

const allowance_ms: u64 = 10_000;
const bytes_per_second: u64 = 1024 * 1024;

/// Completed successful chunks earn time by decoded size, independent of wire encoding.
/// Credit cannot bank more than one allowance or extend the absolute response limit.
pub const Budget = struct {
    deadline_ms: u64,
    limit_ms: u64,
    remainder: u32 = 0,

    pub fn init(now: *const Now, maximum: std.Io.Duration) Budget {
        std.debug.assert(maximum.nanoseconds > 0);
        const limit = now.deadlineMilliseconds(maximum);
        return .{
            .deadline_ms = @min(limit, now.deadlineMilliseconds(.fromMilliseconds(allowance_ms))),
            .limit_ms = limit,
        };
    }

    pub fn credit(self: *Budget, bytes: usize, now: *const Now) void {
        std.debug.assert(now.millis() < self.deadline_ms);
        std.debug.assert(bytes <= constants.MAX_PAYLOAD_SIZE);
        std.debug.assert(self.remainder < bytes_per_second);
        const weighted = @as(u64, @intCast(bytes)) * std.time.ms_per_s + self.remainder;
        const credited = self.deadline_ms +| weighted / bytes_per_second;
        const ceiling = @min(self.limit_ms, now.deadlineMilliseconds(.fromMilliseconds(allowance_ms)));
        self.deadline_ms = @min(credited, ceiling);
        self.remainder = if (credited >= ceiling) 0 else @intCast(weighted % bytes_per_second);
    }

    pub fn excludeHostTime(self: *Budget, held_ms: u64) void {
        std.debug.assert(self.deadline_ms <= self.limit_ms);
        self.deadline_ms = @min(self.limit_ms, self.deadline_ms +| held_ms);
    }
};

test {
    _ = @import("response_budget_test.zig");
}
