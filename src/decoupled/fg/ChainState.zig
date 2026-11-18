//! Immutable per-block chain state sigma from fgsa-spec.pdf Section 2.1 and Figure 5.
//! stateTransition writes a separate candidate; the caller publishes it only after success.
//! Node validates block/attestation wire shapes, membership, and authentication before FG calls here.
const std = @import("std");
const assert = std.debug.assert;
const BoundedArray = @import("bounded_array").BoundedArray;
const limits = @import("../limits.zig");
const types = @import("../types.zig");
const fg = @import("finality_types.zig");

const ChainState = @This();
const Height = fg.Height;
const Participation = [limits.max_validators]bool;
pub const Pending = struct { j: Height, T: fg.BlockRef };
pub const Error = error{ SlotCapacity, HeightCapacity, AttestationCapacity };

/// sigma.L: latest block on this chain.
L: fg.BlockRef,
/// sigma.s: slot of L, not the local clock's current slot.
s: types.Slot,
/// sigma.h: current FG height, initially one (Section 2.1).
h: Height,
/// sigma.T_h: block that brought this chain into height h.
T_h: fg.BlockRef,
/// sigma.target_participation: distinct validators targeting (h, T_h).
target_participation: Participation,
/// sigma.progress: distinct validators targeting or timing out (h, T_h).
progress: Participation,
/// sigma.pending_finality: ordered pairs (j, T), retaining the newest K_W pairs.
pending_finality: BoundedArray(Pending, limits.max_heights),
/// sigma.finality_participation[j]: validators whose finality pair names pending entry j.
finality_participation: [limits.max_heights]Participation,
/// sigma.J and sigma.h_j: latest justified block and its height on this chain.
J: fg.BlockRef,
h_j: Height,
/// sigma.F and sigma.h_F: latest finalized block and its height on this chain.
F: fg.BlockRef,
h_F: Height,

/// Section 2.1 (p. 5): height one, genesis references, no participation or pending finality.
pub fn init(self: *ChainState, B_gen: *const fg.BlockRef) void {
    assert(B_gen.slot == 0);
    self.* = .{
        .L = B_gen.*,
        .s = 0,
        .h = 1,
        .T_h = B_gen.*,
        .target_participation = @splat(false),
        .progress = @splat(false),
        .pending_finality = .{},
        .finality_participation = @splat(@splat(false)),
        .J = B_gen.*,
        .h_j = 0,
        .F = B_gen.*,
        .h_F = 0,
    };
    assert(self.h_F <= self.h_j);
    assert(self.h_j < self.h);
}

/// Figure 5, lines 1-9. Check every row against the unchanged parent state before processing any.
/// On false, out is unchanged. On a capacity error, discard out; sigma remains unchanged.
pub fn stateTransition(
    out: *ChainState,
    sigma: *const ChainState,
    B: *const fg.Block,
    proposer: types.ValidatorIndex,
    config: *const fg.Config,
) Error!bool {
    assert(out != sigma);
    assert(config.valid());
    if (B.slot >= limits.max_slots) return error.SlotCapacity;
    if (B.attestations.len > limits.max_attestations_per_block) return error.AttestationCapacity;
    assert(B.proposer < config.n);
    assert(proposer < config.n);
    if (B.proposer != proposer) return false;
    if (sigma.L.slot >= B.slot or !rootsEqual(&sigma.L.root, &B.parent)) return false;
    for (B.attestations) |*a| {
        assert(a.valid(config.n));
        if (!sigma.validAttestation(a)) return false;
    }
    out.* = sigma.*;
    out.s = B.slot;
    for (B.attestations) |*a| out.processAttestation(a);
    out.L = B.ref();
    try out.processHeightEvents(config);
    assert(out.s == out.L.slot);
    assert(out.h_j < out.h);
    return true;
}

/// The fields the store keeps per block. Everything else stays with the state transition.
pub fn summary(self: *const ChainState) fg.BlockSummary {
    return .{ .h = self.h, .T_h = self.T_h, .h_j = self.h_j, .J = self.J, .h_F = self.h_F, .F = self.F };
}

/// Figure 5, lines 10-14. Apply wire shape/membership checks before this chain-relative predicate.
/// Root equality defines both the current entry and a pending pair.
pub fn validAttestation(self: *const ChainState, a: *const fg.Attestation) bool {
    if (a.h == self.h and rootsEqual(&a.T, &self.T_h.root)) return true;
    const h_f = a.h_f orelse return false;
    const T_f = a.T_f orelse return false;
    return h_f < a.h and a.h < self.h and self.pendingPair(h_f, &T_f) != null;
}

fn pendingPair(self: *const ChainState, j: Height, T: *const fg.Root) ?u32 {
    for (self.pending_finality.constSlice(), 0..) |*pair, i| {
        if (pair.j == j and rootsEqual(&pair.T.root, T)) return @intCast(i);
    }
    return null;
}

/// Figure 5, lines 15-23: pending finality and current-entry participation update independently.
fn processAttestation(self: *ChainState, a: *const fg.Attestation) void {
    assert(a.val_index < limits.max_validators);
    if (a.h_f) |h_f| {
        if (a.T_f) |T_f| {
            if (self.pendingPair(h_f, &T_f) != null) {
                self.finality_participation[h_f][a.val_index] = true;
            }
        }
    }
    if (a.h == self.h and rootsEqual(&a.T, &self.T_h.root)) {
        self.progress[a.val_index] = true;
        if (!a.tau) self.target_participation[a.val_index] = true;
    }
}

/// Figure 5, lines 24-35: finalization first, then target quorum, then delayed timeout progress.
fn processHeightEvents(self: *ChainState, config: *const fg.Config) Error!void {
    const q = config.quorum();
    for (self.pending_finality.constSlice()) |*pair| {
        if (weight(&self.finality_participation[pair.j], config.n) >= q) {
            self.F = pair.T;
            self.h_F = pair.j;
        }
    }
    self.retainPending(self.h_F, config.K_W);
    if (weight(&self.target_participation, config.n) >= q) {
        assert(!self.pending_finality.full());
        self.J = self.T_h;
        self.h_j = self.h;
        self.pending_finality.push(.{ .j = self.h, .T = self.T_h });
        self.finality_participation[self.h] = @splat(false);
        self.retainPending(self.h_F, config.K_W);
        return self.advanceHeight();
    }
    if (weight(&self.progress, config.n) >= q and
        @as(u64, self.s) >= @as(u64, self.T_h.slot) + config.delta_t)
    {
        return self.advanceHeight();
    }
}

fn retainPending(self: *ChainState, h_F: Height, K_W: u32) void {
    var retained: u32 = 0;
    for (self.pending_finality.constSlice()) |pair| {
        if (pair.j <= h_F) continue;
        self.pending_finality.buffer[retained] = pair;
        retained += 1;
    }
    self.pending_finality.count = retained;
    if (retained <= K_W) return;
    const remove = retained - K_W;
    for (0..K_W) |i| self.pending_finality.buffer[i] = self.pending_finality.buffer[i + remove];
    self.pending_finality.count = K_W;
}

/// Figure 5, lines 36-39: enter the next height through L.
/// Reset only current-entry participation; pending finality survives.
fn advanceHeight(self: *ChainState) Error!void {
    if (self.h + 1 >= limits.max_heights) return error.HeightCapacity;
    self.h += 1;
    self.T_h = self.L;
    self.target_participation = @splat(false);
    self.progress = @splat(false);
    assert(self.h <= self.s + 1);
}

fn weight(participation: *const Participation, n: u32) u32 {
    assert(n > 0);
    assert(n <= limits.max_validators);
    var result: u32 = 0;
    for (participation[0..n]) |participates| {
        if (participates) result += 1;
    }
    return result;
}

fn rootsEqual(a: *const fg.Root, b: *const fg.Root) bool {
    return std.mem.eql(u8, a, b);
}

test {
    _ = @import("chain_state_test.zig");
}
