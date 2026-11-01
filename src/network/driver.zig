const std = @import("std");
const NetworkCore = @import("network_core.zig").NetworkCore;
const Now = @import("types.zig").Now;
const wait = @import("wait.zig");

/// Waits for socket/host readiness or scheduled work, then advances the core with a fresh clock.
/// The core and its borrowed descriptors must remain owned by this thread throughout the call.
pub fn step(core: *NetworkCore, io: std.Io, now: Now, outputs: NetworkCore.Outputs, host: NetworkCore.Host) NetworkCore.Result {
    const plan = core.waitPlan(now, outputs, host);
    const readiness = wait.poll(io, plan.sources, plan.timeout);
    var clock_failure: ?error{ClockOutOfRange} = null;
    const read = Now.read(io) catch |err| blk: {
        clock_failure = err;
        break :blk plan.now;
    };
    const tick = read.floor(plan.now);
    return core.advance(io, .{ .now = tick, .readiness = readiness, .clock_failure = clock_failure }, outputs, host);
}

test {
    _ = @import("driver_test.zig");
}
