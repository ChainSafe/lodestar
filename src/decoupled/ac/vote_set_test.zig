const std = @import("std");
const testing = std.testing;
const VoteSet = @import("VoteSet.zig");
const types = @import("../types.zig");
const limits = @import("../limits.zig");

fn vote(validator: u32, head: u8) types.GoldfishVote {
    return .{ .val_index = validator, .slot = 1, .head = @splat(head) };
}

test "duplicate tuples widen support without changing order or count" {
    var set: VoteSet = .{};
    const first = vote(0, 1);
    const second = vote(1, 2);
    set.add(&first, false);
    set.add(&second, true);
    set.add(&first, true);
    set.add(&second, false);
    try testing.expectEqual(@as(u32, 2), set.votes.count);
    try testing.expectEqual(@as(?u32, 0), set.indexOf(&first));
    try testing.expectEqual(@as(?u32, 1), set.indexOf(&second));
    try testing.expect(set.support[0]);
    try testing.expect(set.support[1]);
}

test "distinct heads remain distinct votes from one validator" {
    var set: VoteSet = .{};
    const first = vote(0, 1);
    const second = vote(0, 2);
    const other = vote(1, 1);
    try testing.expectEqual(@as(?u32, null), set.indexOf(&first));
    set.add(&first, false);
    set.add(&second, true);
    set.add(&other, true);
    try testing.expectEqual(@as(u32, 2), set.countByValidator(0));
    try testing.expectEqual(@as(u32, 1), set.countByValidator(1));
    try testing.expectEqual(@as(u32, 0), set.countByValidator(2));
    var different_slot = first;
    different_slot.slot = 2;
    try testing.expectEqual(@as(?u32, null), set.indexOf(&different_slot));
}

test "a full derived set still accepts duplicate support updates" {
    var set: VoteSet = .{};
    for (0..limits.max_vote_set) |index| {
        const entry = vote(@intCast(index / 2), @intCast(index));
        set.add(&entry, false);
    }
    try testing.expect(set.votes.full());
    const last = vote(limits.max_validators - 1, @intCast(limits.max_vote_set - 1));
    set.add(&last, true);
    try testing.expectEqual(limits.max_vote_set, set.votes.count);
    try testing.expectEqual(@as(u32, 2), set.countByValidator(limits.max_validators - 1));
    try testing.expect(set.support[limits.max_vote_set - 1]);
    try testing.expectEqual(@as(?u32, limits.max_vote_set - 1), set.indexOf(&last));
}
