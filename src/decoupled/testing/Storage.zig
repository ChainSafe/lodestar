//! In-memory durable state for simulation. Sleep/wake retains this object.
const std = @import("std");
const SigningRecord = @import("../fg/SigningRecord.zig");
const Simulator = @import("Simulator.zig");
const Storage = @This();
pub const Error = error{PersistenceFailed};

simulator: *Simulator,
index: u32,
record: SigningRecord,
fail_writes: bool = false,

pub fn persist(self: *Storage, Lambda: *const SigningRecord) Error!void {
    if (self.fail_writes) return error.PersistenceFailed;
    std.debug.assert(Lambda.sent.count >= self.record.sent.count);
    for (self.record.sent.constSlice(), 0..) |*old, i| {
        std.debug.assert(old.eql(&Lambda.sent.buffer[i]));
    }
    self.record = Lambda.*;
    self.simulator.recordPersistence(self.index, Lambda.sent.count) catch |err| {
        self.simulator.failure = err;
        return error.PersistenceFailed;
    };
}
