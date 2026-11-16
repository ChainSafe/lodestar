//! TEMPORARY deployment diagnostics for the parallel epoch shuffle on feat4-sas. Not for merge.
//! Linux only; every function is a no-op elsewhere.

const std = @import("std");
const builtin = @import("builtin");
const linux = std.os.linux;

const enabled = builtin.os.tag == .linux;

pub const Usage = struct {
    cpu_ns: u64 = 0,
    nivcsw: u64 = 0,
    nvcsw: u64 = 0,
    minflt: u64 = 0,
    majflt: u64 = 0,

    pub fn sub(a: Usage, b: Usage) Usage {
        return .{
            .cpu_ns = a.cpu_ns -% b.cpu_ns,
            .nivcsw = a.nivcsw -% b.nivcsw,
            .nvcsw = a.nvcsw -% b.nvcsw,
            .minflt = a.minflt -% b.minflt,
            .majflt = a.majflt -% b.majflt,
        };
    }
};

pub fn monoNs() u64 {
    if (!enabled) return 0;
    return clockNs(.MONOTONIC);
}

fn clockNs(clock: linux.clockid_t) u64 {
    var ts: linux.timespec = undefined;
    _ = linux.clock_gettime(clock, &ts);
    return @as(u64, @intCast(ts.sec)) * std.time.ns_per_s + @as(u64, @intCast(ts.nsec));
}

/// `who` is `linux.rusage.THREAD` or `linux.rusage.SELF`.
pub fn usage(who: i32) Usage {
    if (!enabled) return .{};
    var ru: linux.rusage = undefined;
    _ = linux.getrusage(who, &ru);
    const cpu_us: u64 = @as(u64, @intCast(ru.utime.sec + ru.stime.sec)) * std.time.us_per_s +
        @as(u64, @intCast(ru.utime.usec + ru.stime.usec));
    return .{
        // Thread CPU from the clock is finer than rusage's microseconds.
        .cpu_ns = if (who == linux.rusage.THREAD) clockNs(.THREAD_CPUTIME_ID) else cpu_us * std.time.ns_per_us,
        .nivcsw = @intCast(ru.nivcsw),
        .nvcsw = @intCast(ru.nvcsw),
        .minflt = @intCast(ru.minflt),
        .majflt = @intCast(ru.majflt),
    };
}

pub const thread_usage: i32 = if (enabled) linux.rusage.THREAD else 0;
pub const self_usage: i32 = if (enabled) linux.rusage.SELF else 0;

const Counter = std.atomic.Value(u64);

/// Aggregates for the shuffle in flight; reset by `reset`. A second concurrent shuffle would mix
/// into the same numbers, which is acceptable for a temporary diagnostic.
pub const Stats = struct {
    round_thread: std.atomic.Value(std.Thread.Id) = .init(0),
    rounds: Counter = .init(0),
    rounds_over_2ms: Counter = .init(0),
    max_round_ns: Counter = .init(0),
    tasks: Counter = .init(0),
    tasks_inline: Counter = .init(0),
    task_wall_ns: Counter = .init(0),
    task_cpu_ns: Counter = .init(0),
    task_nivcsw: Counter = .init(0),
    task_minflt: Counter = .init(0),
    max_task_wall_ns: Counter = .init(0),
    max_start_delay_ns: Counter = .init(0),

    pub fn reset(self: *Stats) void {
        self.* = .{};
        self.round_thread.store(std.Thread.getCurrentId(), .release);
    }

    pub fn round(self: *Stats, ns: u64) void {
        if (!enabled) return;
        _ = self.rounds.fetchAdd(1, .monotonic);
        if (ns > 2 * std.time.ns_per_ms) _ = self.rounds_over_2ms.fetchAdd(1, .monotonic);
        _ = self.max_round_ns.fetchMax(ns, .monotonic);
    }

    pub fn task(self: *Stats, spawn_ns: u64, start_ns: u64, end_ns: u64, used: Usage) void {
        if (!enabled) return;
        _ = self.tasks.fetchAdd(1, .monotonic);
        if (std.Thread.getCurrentId() == self.round_thread.load(.acquire)) _ = self.tasks_inline.fetchAdd(1, .monotonic);
        _ = self.task_wall_ns.fetchAdd(end_ns - start_ns, .monotonic);
        _ = self.task_cpu_ns.fetchAdd(used.cpu_ns, .monotonic);
        _ = self.task_nivcsw.fetchAdd(used.nivcsw, .monotonic);
        _ = self.task_minflt.fetchAdd(used.minflt, .monotonic);
        _ = self.max_task_wall_ns.fetchMax(end_ns - start_ns, .monotonic);
        _ = self.max_start_delay_ns.fetchMax(start_ns -| spawn_ns, .monotonic);
    }
};

pub var stats: Stats = .{};

fn ms(ns: u64) f64 {
    return @as(f64, @floatFromInt(ns)) / std.time.ns_per_ms;
}

/// One line per shuffle job, so normal epochs give the baseline for the slow ones.
pub fn report(wall_ns: u64, worker: Usage, process: Usage) void {
    if (!enabled) return;
    const s = &stats;
    std.log.warn(
        "shuffle_diag wall={d:.1}ms rounds={d} max_round={d:.2}ms rounds_over_2ms={d} tasks={d} inline={d} " ++
            "task_wall={d:.1}ms task_cpu={d:.1}ms max_task={d:.2}ms max_start_delay={d:.2}ms task_nivcsw={d} task_minflt={d} " ++
            "worker_cpu={d:.1}ms worker_nivcsw={d} worker_nvcsw={d} worker_minflt={d} " ++
            "proc_cpu={d:.1}ms proc_nivcsw={d} proc_minflt={d} proc_majflt={d}",
        .{
            ms(wall_ns),                               s.rounds.load(.monotonic),          ms(s.max_round_ns.load(.monotonic)),
            s.rounds_over_2ms.load(.monotonic),        s.tasks.load(.monotonic),           s.tasks_inline.load(.monotonic),
            ms(s.task_wall_ns.load(.monotonic)),       ms(s.task_cpu_ns.load(.monotonic)), ms(s.max_task_wall_ns.load(.monotonic)),
            ms(s.max_start_delay_ns.load(.monotonic)), s.task_nivcsw.load(.monotonic),     s.task_minflt.load(.monotonic),
            ms(worker.cpu_ns),                         worker.nivcsw,                      worker.nvcsw,
            worker.minflt,                             ms(process.cpu_ns),                 process.nivcsw,
            process.minflt,                            process.majflt,
        },
    );
}
