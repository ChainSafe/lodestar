const std = @import("std");

/// Monotonic (`.awake`) timestamp for measuring elapsed durations. Distinct
/// from the wall-clock `nowMs`/`nowSec` readers below, which are absolute time.
pub fn start(io: std.Io) std.Io.Timestamp {
    return std.Io.Clock.awake.now(io);
}

/// Current wall-clock (Unix) time in milliseconds. Uses the `.real` clock —
/// for absolute time and slot math (anchored to genesis). Distinct from
/// `start`, which is monotonic (`.awake`) and for measuring durations.
pub fn nowMs(io: std.Io) u64 {
    return @intCast(std.Io.Clock.real.now(io).toMilliseconds());
}

/// Current wall-clock (Unix) time in seconds. See `nowMs`.
pub fn nowSec(io: std.Io) u64 {
    return @intCast(std.Io.Clock.real.now(io).toSeconds());
}

pub fn since(io: std.Io, from: std.Io.Timestamp) std.Io.Duration {
    return from.durationTo(start(io));
}

/// Convert a `Duration` to floating-point seconds. Useful for Prometheus-style
/// histogram observations that expect `f64` seconds.
pub fn durationSeconds(d: std.Io.Duration) f64 {
    return @as(f64, @floatFromInt(d.nanoseconds)) / std.time.ns_per_s;
}
