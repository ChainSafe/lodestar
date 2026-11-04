const std = @import("std");
const assert = std.debug.assert;
const Allocator = std.mem.Allocator;

const consensus_types = @import("consensus_types");
const primitives = consensus_types.primitive;

const Slot = primitives.Slot.Type;

/// Sentinel for "validator has no valid vote" (e.g., vote target was pruned).
/// Uses u32 (not ?u32) for SoA cache efficiency: 4 bytes vs 8 bytes per slot.
/// Safe because 0xFFFFFFFF / slots-per-year > 1,634 years of non-finalized network.
pub const NULL_VOTE_INDEX: u32 = std.math.maxInt(u32);

/// Initial value for vote slots, indicating no vote has been cast yet.
pub const INIT_VOTE_SLOT: Slot = 0;

/// Tracks a single validator's fork choice vote.
///
/// Gloas spec: LatestMessage { slot, root }.
/// Payload status (EMPTY vs FULL) is encoded in the node index itself — different
/// variants have different ProtoArray indices, so no separate payload_present field is needed.
/// Fields are laid out for SoA storage via MultiArrayList:
/// - `current_index` and `next_index` are accessed together in computeDeltas (hot path).
/// - `next_slot` is only accessed in onAttestation (cold path).
pub const VoteTracker = struct {
    /// Index of the block this validator currently votes for (after last computeDeltas).
    current_index: u32 = NULL_VOTE_INDEX,
    /// Index of the block this validator will vote for (on next computeDeltas).
    next_index: u32 = NULL_VOTE_INDEX,
    /// Slot of the validator's latest vote. Used by onAttestation to reject stale votes.
    next_slot: Slot = INIT_VOTE_SLOT,
};

/// SoA storage for per-validator fork choice votes.
///
/// Wraps `MultiArrayList(VoteTracker)` to provide cache-efficient access:
/// - `computeDeltas` iterates only `current_index[]` and `next_index[]` arrays,
///   fitting 16 entries per cache line instead of 4 with AoS.
/// - `onAttestation` accesses all fields for a single validator (random access).
///
/// Memory is owned; caller provides allocator for init/deinit/resize.
pub const Votes = struct {
    /// SoA storage. Each field stored as a separate contiguous array.
    multi_list: std.MultiArrayList(VoteTracker) = .empty,

    /// Release all memory. Caller must pass the same allocator used for resize.
    pub fn deinit(self: *Votes, allocator: Allocator) void {
        self.multi_list.deinit(allocator);
        self.* = undefined;
    }

    /// Number of vote slots (one per validator index).
    pub fn len(self: *const Votes) u32 {
        const raw_len = self.multi_list.len;
        assert(raw_len < NULL_VOTE_INDEX);
        return @intCast(raw_len);
    }

    /// Ensure capacity for at least `validator_count` validators.
    /// New slots are initialized to VoteTracker defaults.
    pub fn ensureValidatorCount(self: *Votes, allocator: Allocator, validator_count: u32) Allocator.Error!void {
        const current_len = self.multi_list.len;
        if (validator_count <= current_len) {
            return;
        }

        // Initialize new slots to defaults.
        try self.multi_list.resize(allocator, validator_count);
        const current_indices = self.multi_list.items(.current_index);
        const next_indices = self.multi_list.items(.next_index);
        const next_slots = self.multi_list.items(.next_slot);
        @memset(current_indices[current_len..validator_count], NULL_VOTE_INDEX);
        @memset(next_indices[current_len..validator_count], NULL_VOTE_INDEX);
        @memset(next_slots[current_len..validator_count], INIT_VOTE_SLOT);
    }

    /// Get the raw SoA arrays for direct field access.
    /// Returns separate contiguous arrays for cache-efficient iteration.
    pub fn fields(self: *Votes) struct {
        current_indices: []u32,
        next_indices: []u32,
        next_slots: []Slot,
    } {
        assert(self.multi_list.len > 0 or self.multi_list.capacity == 0);
        return .{
            .current_indices = self.multi_list.items(.current_index),
            .next_indices = self.multi_list.items(.next_index),
            .next_slots = self.multi_list.items(.next_slot),
        };
    }
};

// ── Tests ──

test {
    _ = @import("vote_tracker_test.zig");
}
