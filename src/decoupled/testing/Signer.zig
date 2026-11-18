//! Signature witnesses model identities, not BLS. An invalid packet stays invalid even when
//! another packet carries a valid signature for the same tuple. Block-carried tuples require
//! registered signature witnesses. Hash defines a simulation-only content encoding.
const std = @import("std");
const FG = @import("../fg/FinalityGadget.zig");
const Frame = @import("../fg/FinalityFrame.zig");
const types = @import("../types.zig");
const Simulator = @import("Simulator.zig");
const Hash = @import("Hash.zig");
const Signer = @This();
pub const Error = error{BlockPreparationFailed};

simulator: *Simulator,
index: u32,

pub fn proposer(self: *const Signer, slot: u32) u32 {
    return self.simulator.config.proposer orelse slot % self.simulator.config.protocol.n;
}

pub fn prepareBlock(self: *Signer, B: *FG.Block) Error!void {
    self.simulator.checkDuty(self.index, &B.parent, true) catch |err| {
        self.simulator.failure = err;
        return error.BlockPreparationFailed;
    };
    B.root = Hash.blockRoot(B);
}

pub fn verifyVote(self: *const Signer, signed: *const Frame.SignedVote) bool {
    if (!signed.authenticated) return false;
    const sim = self.simulator;
    if (sim.delivery_packet) |i| {
        const p = &sim.packets.buffer[i];
        if (p.body == .vote) {
            return p.authenticated and p.validator == signed.vote.val_index and
                p.body.vote.eql(&signed.vote);
        }
    }
    return self.hasVoteWitness(&signed.vote);
}

pub fn hasVoteWitness(self: *const Signer, vote: *const types.GoldfishVote) bool {
    const sim = self.simulator;
    for (sim.packets.constSlice()) |*p| {
        if (p.created > sim.now or !p.authenticated or p.validator != vote.val_index) continue;
        if (p.body == .vote and p.body.vote.eql(vote)) return true;
    }
    return false;
}

pub fn verifyAttestation(self: *const Signer, a: *const FG.Attestation) bool {
    const sim = self.simulator;
    if (sim.delivery_packet) |i| {
        const p = &sim.packets.buffer[i];
        if (p.body == .attestation) {
            return p.authenticated and p.validator == a.val_index and p.body.attestation.eql(a);
        }
    }
    for (sim.packets.constSlice()) |*p| {
        if (p.created > sim.now or !p.authenticated or p.validator != a.val_index) continue;
        if (p.body == .attestation and p.body.attestation.eql(a)) return true;
    }
    return false;
}

pub fn verifyBlock(self: *const Signer, B: *const FG.Block) bool {
    const sim = self.simulator;
    if (!std.mem.eql(u8, &B.root, &Hash.blockRoot(B))) return false;
    // The delivered packet decides its own block. A block Node kept was checked at its own
    // delivery and is checked again by witness when a later delivery releases it.
    if (sim.delivery_packet) |i| {
        const p = &sim.packets.buffer[i];
        if (p.body != .block) return false;
        if (std.mem.eql(u8, &B.root, &sim.blocks.buffer[p.body.block].root)) {
            return p.authenticated and p.validator == B.proposer;
        }
    }
    for (sim.packets.constSlice()) |*p| {
        if (p.created > sim.now or !p.authenticated or p.validator != B.proposer) continue;
        if (p.body == .block and
            std.mem.eql(u8, &B.root, &sim.blocks.buffer[p.body.block].root)) return true;
    }
    return false;
}
