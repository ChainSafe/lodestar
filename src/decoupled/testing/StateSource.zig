//! Simulation state source: runs ChainState for every accepted block and keeps sigma[B] by root.
//! A client adapter answers the same questions from its beacon states; the store never sees sigma.
//! Node calls transition only for blocks the store admits, so every stored state has a parent.
const std = @import("std");
const assert = std.debug.assert;
const BoundedArray = @import("bounded_array").BoundedArray;
const limits = @import("../limits.zig");
const types = @import("../types.zig");
const fg = @import("../fg/finality_types.zig");
pub const ChainState = @import("../fg/ChainState.zig");

const StateSource = @This();
pub const Error = ChainState.Error || error{ InvalidConfig, StateCapacity };

/// Section 2.1 parameters of the chain-state transition.
config: fg.Config,
/// Roots with a stored chain state, in acceptance order; genesis first.
roots: BoundedArray(types.Root, limits.max_blocks),
/// sigma[B] at the matching index in roots.
states: [limits.max_blocks]ChainState,

pub fn init(self: *StateSource, config: *const fg.Config) Error!void {
    if (!config.valid()) return error.InvalidConfig;
    self.config = config.*;
    self.roots = .{};
    self.roots.push(config.B_gen);
    self.states[0].init(&.{ .root = config.B_gen, .slot = 0 });
}

/// Figure 5 for one block. A null result means the transition rejected B and nothing is stored.
/// A capacity error also stores nothing. B.root must not already have a state.
pub fn transition(
    self: *StateSource,
    B: *const fg.Block,
    proposer: types.ValidatorIndex,
) Error!?fg.BlockSummary {
    assert(self.find(&B.root) == null);
    const parent = self.find(&B.parent) orelse return null;
    if (self.roots.full()) return error.StateCapacity;
    const index = self.roots.count;
    const accepted = try ChainState.stateTransition(
        &self.states[index],
        &self.states[parent],
        B,
        proposer,
        &self.config,
    );
    if (!accepted) return null;
    self.roots.push(B.root);
    return self.states[index].summary();
}

/// Figure 5, lines 10-14 against sigma[H]. Unknown H admits nothing.
pub fn validAttestation(self: *const StateSource, H: *const types.Root, a: *const fg.Attestation) bool {
    const sigma = self.state(H) orelse return false;
    return sigma.validAttestation(a);
}

pub fn state(self: *const StateSource, root: *const types.Root) ?*const ChainState {
    const index = self.find(root) orelse return null;
    return &self.states[index];
}

pub fn find(self: *const StateSource, root: *const types.Root) ?u32 {
    for (self.roots.constSlice(), 0..) |*held, index| {
        if (std.mem.eql(u8, held, root)) return @intCast(index);
    }
    return null;
}

test {
    _ = @import("state_source_test.zig");
}
