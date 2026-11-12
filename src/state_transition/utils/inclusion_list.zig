const std = @import("std");
const ct = @import("consensus_types");
const preset = @import("preset").preset;
const EpochShuffling = @import("epoch_shuffling.zig").EpochShuffling;
const computeEpochAtSlot = @import("epoch.zig").computeEpochAtSlot;

/// Cycle through the slot's concatenated beacon committees, as in Lodestar.
pub fn getInclusionListCommittee(shuffling: *const EpochShuffling, slot: ct.primitive.Slot.Type) !ct.heze.InclusionListCommittee.Type {
    if (computeEpochAtSlot(slot) != shuffling.epoch) return error.ShufflingEpochMismatch;
    const committees = shuffling.committees[slot % preset.SLOTS_PER_EPOCH];
    std.debug.assert(committees.len <= preset.MAX_COMMITTEES_PER_SLOT);

    var count: usize = 0;
    for (committees) |committee| count += committee.len;
    var result = ct.heze.InclusionListCommittee.default_value;
    if (count == 0) return result;

    for (&result, 0..) |*validator_index, index| {
        var offset = index % count;
        for (committees) |committee| {
            if (offset < committee.len) {
                validator_index.* = committee[offset];
                break;
            }
            offset -= committee.len;
        }
    }
    return result;
}

pub fn getIndicesInInclusionListCommittee(
    committee: *const ct.heze.InclusionListCommittee.Type,
    validator_index: u64,
    out: *[preset.INCLUSION_LIST_COMMITTEE_SIZE]u8,
) []u8 {
    var count: usize = 0;
    for (committee, 0..) |member, position| {
        if (member != validator_index) continue;
        out[count] = @intCast(position);
        count += 1;
    }
    return out[0..count];
}

test {
    _ = @import("inclusion_list_test.zig");
}
