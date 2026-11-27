const std = @import("std");
const n = @import("network");
const native = n.gossipsub;
const r = @import("network_runtime.zig");
const Runtime = r.Runtime;
const assert = std.debug.assert;
const processor = n.gossip_processor;
pub const batch_max = processor.GossipProcessor.batch_max;
pub const batch_bytes = processor.GossipProcessor.batch_bytes;
pub const payload_max = processor.GossipProcessor.payload_max;
pub const topic_max = processor.GossipProcessor.topic_max;
pub const Token = processor.GossipProcessor.Token;
pub const Cell = processor.GossipProcessor.Cell;
pub const Diagnostics = processor.GossipProcessor.Diagnostics;
pub const Batch = processor.GossipProcessor.Batch;
pub const Table = processor.GossipProcessor;
pub fn sample(io: std.Io) error{InvalidNetworkClock}!n.Now {
    const now = n.Now.read(io) catch return error.InvalidNetworkClock;
    if (now.wall.raw.nanoseconds > @as(i96, 9007199254740991) * std.time.ns_per_ms) return error.InvalidNetworkClock;
    return now;
}
pub fn monotonic() !u64 {
    const stamp = std.Io.Timestamp.now(std.Io.Threaded.global_single_threaded.io(), .awake);
    if (stamp.nanoseconds < 0) return error.InvalidNetworkClock;
    const value = stamp.toMilliseconds();
    if (value < 0 or value > std.math.maxInt(u64)) return error.InvalidNetworkClock;
    return @intCast(value);
}
pub fn projectWall(admitted: u64, clock: n.Now) !u64 {
    if (admitted > clock.millis()) return error.InvalidNetworkClock;
    const elapsed = clock.millis() - admitted;
    const wall_ms = clock.wall.raw.toMilliseconds();
    if (wall_ms < 0 or wall_ms > 9007199254740991 or elapsed > wall_ms) return error.InvalidNetworkClock;
    return @as(u64, @intCast(wall_ms)) - elapsed;
}
/// Runs processor maintenance and applies submitted verdicts. Returns whether bounded work remains for the next turn.
pub fn maintain(runtime: *Runtime, io: std.Io, tick: n.Now) !bool {
    runtime.lock();
    defer runtime.unlock();
    const table = if (runtime.bridge.gossip) |*table| table else return false;
    const core = &runtime.owner.?.core;
    const clock = try sample(io);
    table.maintain(clock.millis(), @intCast(@max(0, try core.clock.read(tick))));
    var retired_bytes: usize = 0;
    for (0..batch_max) |_| {
        const token = table.nextCompletion() orelse break;
        const cell = table.get(token).?;
        if (retired_bytes > 0 and cell.input.len > batch_bytes -| retired_bytes) break;
        retired_bytes += cell.input.len;
        switch (cell.completion) {
            .verdict => |verdict| table.outcome(core.reportValidation(cell.handle, verdict, tick)),
            .cancelled => _ = core.cancelValidation(cell.handle, tick),
        }
        table.retire(token);
    }
    runtime.notifyIfReadyLocked();
    return table.pending();
}
pub const Ingress = struct {
    runtime: *Runtime,
    io: std.Io,
    failure: ?anyerror = null,

    pub fn sink(self: *Ingress) native.Gossipsub.MessageSink {
        return .{ .context = self, .has_capacity = hasCapacity, .admit = admit };
    }

    fn hasCapacity(context: *anyopaque, kind: native.topic.Kind, len: usize) bool {
        const self: *Ingress = @ptrCast(@alignCast(context));
        if (self.failure != null) return false;
        const runtime = self.runtime;
        runtime.lock();
        defer runtime.unlock();
        if (runtime.bridge.stop) return false;
        const table = if (runtime.bridge.gossip) |*table| table else return false;
        return table.checkAdmissionCapacity(kind, len);
    }

    fn admit(context: *anyopaque, candidate: *native.Gossipsub.MessageAdmission) bool {
        const self: *Ingress = @ptrCast(@alignCast(context));
        return self.capture(candidate) catch |err| {
            self.failure = err;
            return false;
        };
    }

    fn capture(self: *Ingress, candidate: *native.Gossipsub.MessageAdmission) !bool {
        const runtime = self.runtime;
        const clock = try sample(self.io);
        const received_at = try projectWall(candidate.event.admitted_ms, clock);
        if (clock.millis() >= candidate.event.deadline) return false;
        runtime.lock();
        defer runtime.unlock();
        if (runtime.bridge.stop or self.failure != null) return false;
        const core = &runtime.owner.?.core;
        const accepted = runtime.bridge.gossip.?.admit(candidate, candidate.event.admitted_ms, received_at, @intCast(@max(0, try core.clock.read(core.last_now))));
        runtime.notifyIfReadyLocked();
        return accepted;
    }
};
pub fn closeLocked(runtime: *Runtime) void {
    if (runtime.bridge.gossip) |*table| table.close();
}
test {
    _ = @import("network_gossip_test.zig");
}
