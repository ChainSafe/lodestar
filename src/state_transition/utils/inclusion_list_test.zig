const std = @import("std");
const preset = @import("preset").preset;
const EpochShuffling = @import("epoch_shuffling.zig").EpochShuffling;
const getInclusionListCommittee = @import("inclusion_list.zig").getInclusionListCommittee;
const getIndicesInInclusionListCommittee = @import("inclusion_list.zig").getIndicesInInclusionListCommittee;

test "Heze inclusion list committee positions include repeated validators" {
    var committee: [preset.INCLUSION_LIST_COMMITTEE_SIZE]u64 = @splat(42);
    var positions: [preset.INCLUSION_LIST_COMMITTEE_SIZE]u8 = undefined;
    try std.testing.expectEqual(0, getIndicesInInclusionListCommittee(&committee, 7, &positions).len);
    const all = getIndicesInInclusionListCommittee(&committee, 42, &positions);
    try std.testing.expectEqual(committee.len, all.len);
    for (all, 0..) |position, index| try std.testing.expectEqual(index, position);
    committee[0] = 7;
    try std.testing.expectEqualSlices(u8, &.{0}, getIndicesInInclusionListCommittee(&committee, 7, &positions));
    committee[committee.len - 1] = 7;
    try std.testing.expectEqualSlices(u8, &.{ 0, preset.INCLUSION_LIST_COMMITTEE_SIZE - 1 }, getIndicesInInclusionListCommittee(&committee, 7, &positions));
}

test "Heze inclusion list committees cycle across slot committees" {
    const allocator = std.testing.allocator;
    const counts = [_]usize{ 0, 1, 3 * preset.SLOTS_PER_EPOCH, 2 * preset.TARGET_COMMITTEE_SIZE * preset.SLOTS_PER_EPOCH + 1 };
    for (counts) |count| {
        const shuffling = blk: {
            const indices = try allocator.alloc(u32, count);
            errdefer allocator.free(indices);
            for (indices, 0..) |*index, i| index.* = @intCast(i + 100);
            break :blk try EpochShuffling.init(allocator, @splat(7), 2, indices);
        };
        defer shuffling.deinit();

        for (0..preset.SLOTS_PER_EPOCH) |slot_index| {
            const actual = try getInclusionListCommittee(shuffling, 2 * preset.SLOTS_PER_EPOCH + slot_index);
            const start = count * slot_index / preset.SLOTS_PER_EPOCH;
            const end = count * (slot_index + 1) / preset.SLOTS_PER_EPOCH;
            for (actual, 0..) |validator_index, i| {
                const expected: u64 = if (end == start) 0 else shuffling.shuffling[start + i % (end - start)];
                try std.testing.expectEqual(expected, validator_index);
            }
        }
        try std.testing.expectError(error.ShufflingEpochMismatch, getInclusionListCommittee(shuffling, preset.SLOTS_PER_EPOCH));
        try std.testing.expectError(error.ShufflingEpochMismatch, getInclusionListCommittee(shuffling, 3 * preset.SLOTS_PER_EPOCH));
    }
}
