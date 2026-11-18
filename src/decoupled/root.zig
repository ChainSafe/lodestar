//! Goldilocks reference implementation for fgsa-spec.pdf.
//! fg/ holds the finality gadget, ac/ the available chain, Node.zig the coordinator, and testing/
//! the deterministic simulator with seeded Byzantine faults. See NODE.md and ROADMAP.md.

const std = @import("std");

pub const limits = @import("limits.zig");
pub const types = @import("types.zig");
pub const fg = struct {
    pub const FinalityGadget = @import("fg/FinalityGadget.zig");
    pub const ChainState = @import("fg/ChainState.zig");
    pub const SigningRecord = @import("fg/SigningRecord.zig");
    pub const AttestationPool = @import("fg/AttestationPool.zig");
    pub const FinalityFrame = @import("fg/FinalityFrame.zig");
    pub const types = @import("fg/finality_types.zig");
};
pub const ac = struct {
    pub const available_chain = @import("ac/available_chain.zig");
    pub const VoteSet = @import("ac/VoteSet.zig");
};
pub const NodeType = @import("Node.zig").NodeType;
pub const NodeConfig = @import("Node.zig").Config;
pub const Simulator = @import("testing/Simulator.zig");
pub const StateSource = @import("testing/StateSource.zig");

test {
    std.testing.refAllDecls(@This());
    std.testing.refAllDecls(fg);
    std.testing.refAllDecls(ac);
    _ = @import("testing/determinism.zig");
}
