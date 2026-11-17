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
pub const Error = error{PersistenceFailed};

/// A block is held as its index in the simulator's shared block store.
const Entry = union(enum) { block: u32, attestation: FG.Attestation };

simulator: *Simulator,
index: u32,
record: SigningRecord,
journal: BoundedArray(Entry, limits.max_journal) = .{},
ac: ?AC.Durable = null,
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

pub fn appendBlock(self: *Storage, B: *const FG.Block) Error!void {
    if (self.fail_writes) return error.PersistenceFailed;
    const block = self.simulator.findBlock(&B.root) orelse {
        self.simulator.failure = error.InvariantViolation;
        return error.PersistenceFailed;
    };
    self.journal.push(.{ .block = block });
}

pub fn appendAttestation(self: *Storage, a: *const FG.Attestation) Error!void {
    if (self.fail_writes) return error.PersistenceFailed;
    self.journal.push(.{ .attestation = a.* });
}

pub fn persistAC(self: *Storage, saved: *const AC.Durable) Error!void {
    if (self.fail_writes) return error.PersistenceFailed;
    self.ac = saved.*;
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
