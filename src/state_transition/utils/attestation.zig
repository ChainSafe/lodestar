const std = @import("std");
const Allocator = std.mem.Allocator;
const types = @import("consensus_types");
const preset = @import("preset").preset;
const AttestationData = types.phase0.AttestationData.Type;
const AttesterSlashing = types.phase0.AttesterSlashing.Type;

const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const Slot = types.primitive.Slot.Type;

pub fn isSlashableAttestationData(data1: *const AttestationData, data2: *const AttestationData) bool {
    // Double vote
    if (!types.phase0.AttestationData.equals(data1, data2) and data1.target.epoch == data2.target.epoch) {
        return true;
    }
    // Surround vote
    if (data1.source.epoch < data2.source.epoch and data2.target.epoch < data1.target.epoch) {
        return true;
    }
    return false;
}

/// Two-pointer sorted merge membership check for attesting indices to slash without auxiliary allocations.
///
/// Pre-requisite: isValidIndexedAttestation already checks for attesting indices to be sorted and unique.
/// Without that check, this would be incorrect.
pub fn findAttesterSlashableIndices(allocator: Allocator, attester_slashing: *const AttesterSlashing, indices: *std.ArrayList(ValidatorIndex)) !void {
    return findAttesterSlashableIndicesFromSlices(allocator, attester_slashing.attestation_1.attesting_indices.items, attester_slashing.attestation_2.attesting_indices.items, indices);
}

pub fn findAttesterSlashableIndicesFromSlices(allocator: Allocator, a: []const ValidatorIndex, b: []const ValidatorIndex, indices: *std.ArrayList(ValidatorIndex)) !void {
    var i: usize = 0;
    var j: usize = 0;
    while (i < a.len and j < b.len) {
        if (a[i] == b[j]) {
            try indices.append(allocator, a[i]);
            i += 1;
            j += 1;
        } else if (a[i] < b[j]) {
            i += 1;
        } else {
            j += 1;
        }
    }
    // we must reach the end of one of the indices
    std.debug.assert(i == a.len or j == b.len);
}
