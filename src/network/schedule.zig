const std = @import("std");

/// Schedules immediate work and awake-clock deadlines.
/// Pending work blocked on I/O or output capacity is not runnable. An empty schedule says
/// nothing about whether the owner is closed or still holds borrowed storage.
pub const Schedule = struct {
    runnable: bool = false,
    deadline: ?std.Io.Clock.Timestamp = null,

    pub fn merge(self: Schedule, other: Schedule) Schedule {
        return .{
            .runnable = self.runnable or other.runnable,
            .deadline = if (self.deadline) |a|
                if (other.deadline) |b| if (a.compare(.lte, b)) a else b else a
            else
                other.deadline,
        };
    }

    pub fn due(self: Schedule, now: std.Io.Clock.Timestamp) bool {
        std.debug.assert(now.clock == .awake);
        return self.runnable or if (self.deadline) |deadline| deadline.compare(.lte, now) else false;
    }

    pub fn nextWakeup(self: Schedule, now: std.Io.Clock.Timestamp) ?std.Io.Clock.Timestamp {
        if (self.due(now)) return now;
        return self.deadline;
    }

    pub fn timeout(self: Schedule, now: std.Io.Clock.Timestamp, maximum: std.Io.Duration) std.Io.Timeout {
        std.debug.assert(now.clock == .awake and maximum.nanoseconds >= 0);
        const bound = now.addDuration(.{ .clock = .awake, .raw = maximum });
        const due_at = self.nextWakeup(now) orelse bound;
        return .{ .deadline = if (due_at.compare(.lt, bound)) due_at else bound };
    }
};

test {
    _ = @import("schedule_test.zig");
}
