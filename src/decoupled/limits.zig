//! Storage bounds for the Goldilocks reference implementation, not protocol constants.
//! Exceeding these bounds makes a simulation run incomplete.

const std = @import("std");

/// Maximum fixed validator-set size supported by this reference implementation.
pub const max_validators: u32 = 64;
/// Number of nonnegative slots supported by one run, including slot zero.
pub const max_slots: u32 = 64;
/// Maximum retained blocks across all branches, including genesis. No pruning is implied.
pub const max_blocks: u32 = 256;
/// Blocks a node keeps while it waits for their parent. Strict parent-slot ordering bounds one
/// chain to max_slots blocks, so a walk back along one chain keeps fewer than this.
pub const max_orphans: u32 = max_slots;
/// Two distinct votes per validator preserve equivocation in a derived AC scoring set.
pub const max_vote_set: u32 = 2 * max_validators;
/// Height-indexed storage, including index zero. Figure 5 advances at most once per block;
/// strict parent-slot ordering bounds a chain to max_slots blocks, starting at height one.
pub const max_heights: u32 = max_slots + 1;
/// Simulation input bound for one block's ordered FG attestation list, not a quorum rule.
pub const max_attestations_per_block: u32 = 256;
/// Retained FG pool entries. Section 1.3 forbids age/per-validator eviction; exhaustion ends a run.
pub const max_attestations: u32 = 2048;
/// Retained contents in one validator's signing record. Exhaustion must not discard old records.
pub const max_sent_attestations: u32 = 1024;

comptime {
    std.debug.assert(max_validators > 0);
    std.debug.assert(max_slots >= 2);
    std.debug.assert(max_blocks >= max_slots);
}
