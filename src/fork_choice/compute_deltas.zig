const std = @import("std");
const Allocator = std.mem.Allocator;
const assert = std.debug.assert;

const vote_tracker = @import("vote_tracker.zig");
const NULL_VOTE_INDEX = vote_tracker.NULL_VOTE_INDEX;

const consensus_types = @import("consensus_types");
const ValidatorIndex = consensus_types.primitive.ValidatorIndex.Type;

pub const VoteIndex = u32;

/// Set of equivocating validator indices.
pub const EquivocatingIndices = std.array_hash_map.Auto(ValidatorIndex, void);

/// Diagnostic counters from a computeDeltas call.
/// Used for monitoring fork choice health (not for correctness).
pub const ComputeDeltasResult = struct {
    deltas: []i64,
    equivocating_validators: u32 = 0,
    old_inactive_validators: u32 = 0,
    new_inactive_validators: u32 = 0,
    unchanged_vote_validators: u32 = 0,
    new_vote_validators: u32 = 0,
};

/// Type alias for the per-node deltas buffer, instantiated by the caller (typically ForkChoice).
pub const DeltasCache = std.ArrayList(i64);

/// Computes per-node weight deltas from vote changes and balance updates.
///
/// For each validator, compares current_index (last applied vote) with
/// next_index (pending vote) and old/new balances. Subtracts old balance
/// from the departing node, adds new balance to the arriving node.
///
/// Equivocating validators have their weight removed and votes zeroed
/// so they are only penalized once across multiple calls.
///
/// Mutates:
///   - `deltas_cache`: resized and zeroed, weight changes per proto-array node
///   - `vote_current_indices`: current_index updated to next_index (commits pending votes)
pub fn computeDeltas(
    allocator: Allocator,
    deltas_cache: *DeltasCache,
    num_proto_nodes: u32,
    vote_current_indices: []VoteIndex,
    vote_next_indices: []const VoteIndex,
    old_balances: []const u16,
    new_balances: []const u16,
    equivocating_indices: *const EquivocatingIndices,
) !ComputeDeltasResult {
    assert(vote_current_indices.len == vote_next_indices.len);
    assert(num_proto_nodes < NULL_VOTE_INDEX);

    // deltas.length = numProtoNodes; deltas.fill(0)
    try deltas_cache.resize(allocator, @intCast(num_proto_nodes));
    const deltas = deltas_cache.items;
    @memset(deltas, 0);

    const num_validators = vote_next_indices.len;

    // Sort equivocating indices for pointer advancement in the loop.
    const sorted_eq = try sortEquivocatingKeys(allocator, equivocating_indices);
    defer allocator.free(sorted_eq);

    var result: ComputeDeltasResult = .{ .deltas = deltas, .equivocating_validators = @intCast(sorted_eq.len) };
    // Pre-fetch the first equivocating validator index for pointer advancement comparison.
    // Use maxInt as sentinel when empty so the equivocating check is always false.
    var equivocating_validator_index: ValidatorIndex = if (sorted_eq.len > 0) sorted_eq[0] else std.math.maxInt(ValidatorIndex);
    var equivocating_index: usize = 0;

    for (0..num_validators) |v_index| {
        const current_index = vote_current_indices[v_index];
        const next_index = vote_next_indices[v_index];

        // Validator has never voted and has no pending vote.
        if (current_index == NULL_VOTE_INDEX) {
            if (next_index == NULL_VOTE_INDEX) {
                result.old_inactive_validators += 1;
                continue;
            }
        }

        const bal = resolveBalances(v_index, old_balances, new_balances);

        // Check if this validator is equivocating (sorted pointer advancement).
        if (@as(ValidatorIndex, @intCast(v_index)) == equivocating_validator_index) {
            // Remove weight from current vote. Only process once: after zeroing
            // current_index, subsequent calls skip this validator.
            subtractOldBalance(deltas, current_index, bal.old);
            vote_current_indices[v_index] = NULL_VOTE_INDEX;
            equivocating_index += 1;
            // Advance to next equivocating validator, or set sentinel when exhausted.
            equivocating_validator_index = if (equivocating_index < sorted_eq.len)
                sorted_eq[equivocating_index]
            else
                std.math.maxInt(ValidatorIndex);
            continue;
        }

        if (bal.old == 0) {
            if (bal.new == 0) {
                result.new_inactive_validators += 1;
                continue;
            }
        }

        // Vote or balance changed: apply delta.
        if (current_index != next_index or bal.old != bal.new) {
            subtractOldBalance(deltas, current_index, bal.old);
            addNewBalance(deltas, next_index, bal.new);
            vote_current_indices[v_index] = next_index;
            result.new_vote_validators += 1;
        } else {
            result.unchanged_vote_validators += 1;
        }
    }

    return result;
}

/// Subtracts a validator's old balance from the node it is departing.
fn subtractOldBalance(deltas: []i64, node_index: VoteIndex, old_balance: i64) void {
    if (node_index != NULL_VOTE_INDEX) {
        assert(node_index < deltas.len);
        assert(deltas[node_index] >= std.math.minInt(i64) + old_balance);
        deltas[node_index] -|= old_balance;
    }
}

/// Adds a validator's new balance to the node it is arriving at.
fn addNewBalance(deltas: []i64, node_index: VoteIndex, new_balance: i64) void {
    if (node_index != NULL_VOTE_INDEX) {
        assert(node_index < deltas.len);
        assert(deltas[node_index] <= std.math.maxInt(i64) - new_balance);
        deltas[node_index] +|= new_balance;
    }
}

/// Resolves old and new effective balance for a validator, handling mismatched slice lengths
/// and the same-pointer optimisation (when old_balances == new_balances).
fn resolveBalances(
    v_index: usize,
    old_balances: []const u16,
    new_balances: []const u16,
) struct { old: i64, new: i64 } {
    const old_balance: i64 = if (v_index < old_balances.len) old_balances[v_index] else 0;
    const new_balance: i64 = if (old_balances.ptr == new_balances.ptr)
        old_balance
    else if (v_index < new_balances.len)
        new_balances[v_index]
    else
        0;
    return .{ .old = old_balance, .new = new_balance };
}

/// Copies equivocating keys into a heap buffer and sorts ascending for pointer advancement.
fn sortEquivocatingKeys(allocator: Allocator, indices: *const EquivocatingIndices) ![]const ValidatorIndex {
    const keys = indices.keys();
    const buf = try allocator.alloc(ValidatorIndex, keys.len);
    @memcpy(buf, keys);
    std.mem.sortUnstable(ValidatorIndex, buf, {}, std.sort.asc(ValidatorIndex));
    return buf;
}

// ── Tests ──

test {
    _ = @import("compute_deltas_test.zig");
}
