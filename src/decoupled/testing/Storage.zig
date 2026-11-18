//! In-memory durable state for simulation. Sleep and crash both retain this object; a crash
//! retains nothing else.
const std = @import("std");
const BoundedArray = @import("bounded_array").BoundedArray;
const FG = @import("../fg/FinalityGadget.zig");
const AC = @import("../ac/available_chain.zig").AvailableChain;
const SigningRecord = @import("../fg/SigningRecord.zig");
const JournalEntry = @import("../Node.zig").JournalEntry;
const limits = @import("../limits.zig");
const Simulator = @import("Simulator.zig");
const Storage = @This();
pub const Error = error{ PersistenceFailed, Crashed };
/// The node dies at its write number `skip` from now, counting from zero. With `applied` the
/// write takes effect first; without it the write is lost.
pub const CrashPoint = struct { skip: u32, applied: bool };
pub const Write = enum { signing_record, block, attestation, ac_record };

/// A block is held as its index in the simulator's shared block store.
const Entry = union(enum) { block: u32, attestation: FG.Attestation };

simulator: *Simulator,
index: u32,
record: SigningRecord,
journal: BoundedArray(Entry, limits.max_journal) = .{},
ac: ?AC.Durable = null,
fail_writes: bool = false,
crash: ?CrashPoint = null,
/// The write the node last died in.
died_in: ?Write = null,

/// Whether this write is the armed crash point, and if so whether it takes effect first.
fn crashPoint(self: *Storage, write: Write) ?bool {
    if (self.crash) |*point| {
        if (point.skip > 0) {
            point.skip -= 1;
            return null;
        }
        const applied = point.applied;
        self.crash = null;
        self.died_in = write;
        return applied;
    }
    return null;
}

pub fn persist(self: *Storage, Lambda: *const SigningRecord) Error!void {
    if (self.fail_writes) return error.PersistenceFailed;
    const dying = self.crashPoint(.signing_record);
    if (dying == false) return error.Crashed;
    std.debug.assert(Lambda.sent.count >= self.record.sent.count);
    for (self.record.sent.constSlice(), 0..) |*old, i| {
        std.debug.assert(old.eql(&Lambda.sent.buffer[i]));
    }
    self.record = Lambda.*;
    self.simulator.recordPersistence(self.index, Lambda.sent.count) catch |err| {
        self.simulator.failure = err;
        return error.PersistenceFailed;
    };
    if (dying != null) return error.Crashed;
}

pub fn appendBlock(self: *Storage, B: *const FG.Block) Error!void {
    if (self.fail_writes) return error.PersistenceFailed;
    const dying = self.crashPoint(.block);
    if (dying == false) return error.Crashed;
    const block = self.simulator.findBlock(&B.root) orelse {
        self.simulator.failure = error.InvariantViolation;
        return error.PersistenceFailed;
    };
    self.journal.push(.{ .block = block });
    if (dying != null) return error.Crashed;
}

pub fn appendAttestation(self: *Storage, a: *const FG.Attestation) Error!void {
    if (self.fail_writes) return error.PersistenceFailed;
    const dying = self.crashPoint(.attestation);
    if (dying == false) return error.Crashed;
    self.journal.push(.{ .attestation = a.* });
    if (dying != null) return error.Crashed;
}

pub fn persistAC(self: *Storage, saved: *const AC.Durable) Error!void {
    if (self.fail_writes) return error.PersistenceFailed;
    const dying = self.crashPoint(.ac_record);
    if (dying == false) return error.Crashed;
    self.ac = saved.*;
    if (dying != null) return error.Crashed;
}

pub fn loadRecord(self: *const Storage, Lambda: *SigningRecord) Error!void {
    Lambda.* = self.record;
}

pub fn journalEntry(self: *const Storage, i: u32) ?JournalEntry {
    if (i >= self.journal.count) return null;
    return switch (self.journal.buffer[i]) {
        .block => |block| .{ .block = self.simulator.acceptedBlock(block) },
        .attestation => |a| .{ .attestation = a },
    };
}

pub fn loadAC(self: *const Storage) ?AC.Durable {
    return self.ac;
}
