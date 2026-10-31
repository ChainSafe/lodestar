//! Tests for `vote_tracker.zig`.

const std = @import("std");
const testing = std.testing;
const consensus_types = @import("consensus_types");
const primitives = consensus_types.primitive;
const Slot = primitives.Slot.Type;
const vote_tracker_mod = @import("vote_tracker.zig");
const INIT_VOTE_SLOT = vote_tracker_mod.INIT_VOTE_SLOT;
const NULL_VOTE_INDEX = vote_tracker_mod.NULL_VOTE_INDEX;
const VoteTracker = vote_tracker_mod.VoteTracker;
const Votes = vote_tracker_mod.Votes;

test "VoteTracker default is null votes" {
    const vote: VoteTracker = .{};
    try testing.expectEqual(NULL_VOTE_INDEX, vote.current_index);
    try testing.expectEqual(NULL_VOTE_INDEX, vote.next_index);
    try testing.expectEqual(INIT_VOTE_SLOT, vote.next_slot);
}

test "VoteTracker size" {
    // 4 (current_index) + 4 (next_index) + 8 (next_slot)
    try testing.expectEqual(16, @sizeOf(VoteTracker));
}

test "Votes ensureValidatorCount grow sequence" {
    var votes: Votes = .{};
    defer votes.deinit(testing.allocator);

    const Step = struct { grow_to: u32, expected_len: u32 };
    const steps = [_]Step{
        .{ .grow_to = 0, .expected_len = 0 }, // empty
        .{ .grow_to = 4, .expected_len = 4 }, // grow from 0
        .{ .grow_to = 2, .expected_len = 4 }, // no-op (already large enough)
        .{ .grow_to = 8, .expected_len = 8 }, // grow again
    };

    for (steps) |step| {
        try votes.ensureValidatorCount(testing.allocator, step.grow_to);
        try testing.expectEqual(step.expected_len, votes.len());
    }

    // Verify all slots are defaults after growing.
    const s = votes.fields();
    for (0..votes.len()) |i| {
        try testing.expectEqual(NULL_VOTE_INDEX, s.current_indices[i]);
        try testing.expectEqual(NULL_VOTE_INDEX, s.next_indices[i]);
        try testing.expectEqual(INIT_VOTE_SLOT, s.next_slots[i]);
    }
}

test "Votes ensureValidatorCount preserves existing data" {
    var votes: Votes = .{};
    defer votes.deinit(testing.allocator);

    try votes.ensureValidatorCount(testing.allocator, 2);

    // Modify validator 0.
    var s = votes.fields();
    s.next_indices[0] = 5;
    s.next_slots[0] = 10;

    // Grow — validator 0 must be preserved.
    try votes.ensureValidatorCount(testing.allocator, 4);
    const s2 = votes.fields();
    try testing.expectEqual(@as(u32, 5), s2.next_indices[0]);
    try testing.expectEqual(@as(Slot, 10), s2.next_slots[0]);

    // New slots are defaults.
    try testing.expectEqual(NULL_VOTE_INDEX, s2.next_indices[2]);
}
