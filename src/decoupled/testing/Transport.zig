//! Simulation transport queues copies. It never invokes a receiver from a broadcast call.
const std = @import("std");
const FG = @import("../fg/FinalityGadget.zig");
const types = @import("../types.zig");
const Simulator = @import("Simulator.zig");
const Storage = @import("Storage.zig");
const Transport = @This();
pub const Error = error{BroadcastFailed};
/// A replica index.
pub const Peer = u32;

simulator: *Simulator,
index: u32,
storage: *const Storage,

pub fn broadcastVote(self: *Transport, vote: *const types.GoldfishVote) Error!void {
    self.simulator.checkDuty(self.index, &vote.head, false) catch |err| {
        self.simulator.failure = err;
        return error.BroadcastFailed;
    };
    self.simulator.sendVote(self.index, vote) catch |err| {
        self.simulator.failure = err;
        return error.BroadcastFailed;
    };
}

pub fn broadcastBlock(self: *Transport, B: *const FG.Block) Error!void {
    self.simulator.sendBlock(self.index, B) catch |err| {
        self.simulator.failure = err;
        return error.BroadcastFailed;
    };
}

pub fn broadcastAttestation(self: *Transport, a: *const FG.Attestation) Error!void {
    std.debug.assert(self.storage.record.sent.count > 0);
    const sent = self.storage.record.sent.constSlice();
    std.debug.assert(sent[sent.len - 1].eql(a));
    self.simulator.sendAttestation(self.index, a) catch |err| {
        self.simulator.failure = err;
        return error.BroadcastFailed;
    };
}

pub fn forwardBlock(self: *Transport, B: *const FG.Block) Error!void {
    self.simulator.forwardBlock(self.index, B) catch |err| {
        self.simulator.failure = err;
        return error.BroadcastFailed;
    };
}

pub fn requestBlock(self: *Transport, peer: Peer, root: *const types.Root) Error!void {
    self.simulator.requestBlock(self.index, peer, root) catch |err| {
        self.simulator.failure = err;
        return error.BroadcastFailed;
    };
}

pub fn sendBlock(self: *Transport, peer: Peer, B: *const FG.Block) Error!void {
    self.simulator.respondBlock(self.index, peer, B) catch |err| {
        self.simulator.failure = err;
        return error.BroadcastFailed;
    };
}
