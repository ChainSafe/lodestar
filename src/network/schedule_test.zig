const std = @import("std");
const schedule_test_support = @import("schedule_test_support.zig");
const time = @import("time.zig");
const Schedule = @import("schedule.zig").Schedule;

test "schedule merge retains the earliest deadline independently of runnable work" {
    const early = time.milliseconds(25).addDuration(.{ .clock = .awake, .raw = .fromNanoseconds(1) });
    const late = time.milliseconds(25).addDuration(.{ .clock = .awake, .raw = .fromNanoseconds(2) });
    for ([_]bool{ false, true }) |a_runnable| {
        for ([_]bool{ false, true }) |b_runnable| {
            const a: Schedule = .{ .deadline = early, .runnable = a_runnable };
            const b: Schedule = .{ .deadline = late, .runnable = b_runnable };
            const expected: Schedule = .{ .deadline = early, .runnable = a_runnable or b_runnable };
            try std.testing.expectEqualDeep(expected, a.merge(b));
            try std.testing.expectEqualDeep(expected, b.merge(a));
        }
    }
    const due: Schedule = .{ .deadline = time.milliseconds(0) };
    const distant: Schedule = .{ .deadline = time.milliseconds(std.math.maxInt(u64)) };
    try std.testing.expectEqualDeep(due, due.merge(distant));
    try std.testing.expectEqualDeep(due, distant.merge(due));
}

test "schedule merge has an identity and is associative commutative and idempotent" {
    const schedules = [_]Schedule{
        .{},
        .{ .runnable = true },
        .{ .deadline = time.milliseconds(0) },
        .{ .deadline = time.milliseconds(25) },
        .{ .runnable = true, .deadline = time.milliseconds(50) },
        .{ .deadline = time.milliseconds(std.math.maxInt(u64)) },
    };
    for (schedules) |a| {
        try std.testing.expectEqualDeep(a, a.merge(.{}));
        try std.testing.expectEqualDeep(a, a.merge(a));
        for (schedules) |b| {
            try std.testing.expectEqualDeep(a.merge(b), b.merge(a));
            for (schedules) |c| {
                try std.testing.expectEqualDeep(a.merge(b).merge(c), a.merge(b.merge(c)));
            }
        }
    }
}

test "schedule waits distinguish runnable work expired deadlines and external pressure" {
    const blocked: Schedule = .{};
    try std.testing.expect(!blocked.due(time.milliseconds(100)));
    try std.testing.expectEqual(@as(?u64, null), schedule_test_support.wakeupMilliseconds(blocked, 100));
    try std.testing.expectEqual(@as(u32, 1000), schedule_test_support.waitMilliseconds(blocked, 100, 1000));
    const timed: Schedule = .{ .deadline = time.milliseconds(150) };
    try std.testing.expect(!timed.due(time.milliseconds(100)));
    try std.testing.expect(timed.due(time.milliseconds(150)));
    try std.testing.expect(timed.due(time.milliseconds(200)));
    try std.testing.expectEqual(@as(u32, 50), schedule_test_support.waitMilliseconds(timed, 100, 1000));
    try std.testing.expectEqual(@as(u32, 10), schedule_test_support.waitMilliseconds(timed, 100, 10));
    try std.testing.expectEqual(@as(u32, 0), schedule_test_support.waitMilliseconds(timed, 200, 1000));
    const ready = timed.merge(.{ .runnable = true });
    try std.testing.expectEqualDeep(time.milliseconds(150), ready.deadline.?);
    try std.testing.expectEqual(@as(u32, 0), schedule_test_support.waitMilliseconds(ready, 100, 1000));
    const distant: Schedule = .{ .deadline = time.milliseconds(std.math.maxInt(u64)) };
    try std.testing.expectEqual(@as(u32, 1000), schedule_test_support.waitMilliseconds(distant, 0, 1000));
}
