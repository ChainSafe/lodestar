//! Derived votes and their support subset for Goldilocks fork choice (Figure 9).
//! Each support flag identifies membership in the logical support_votes set.
const std = @import("std");
const assert = std.debug.assert;
const BoundedArray = @import("bounded_array").BoundedArray;
const limits = @import("../limits.zig");
const types = @import("../types.zig");

const VoteSet = @This();
const GoldfishVote = types.GoldfishVote;

votes: BoundedArray(GoldfishVote, limits.max_vote_set) = .{},
support: [limits.max_vote_set]bool = @splat(false),

pub fn indexOf(self: *const VoteSet, vote: *const GoldfishVote) ?u32 {
    for (self.votes.constSlice(), 0..) |*held, i| {
        if (held.eql(vote)) return @intCast(i);
    }
    return null;
}

/// Add a distinct tuple; a duplicate can add support but cannot remove it.
pub fn add(self: *VoteSet, vote: *const GoldfishVote, supported: bool) void {
    assert(self.votes.count <= limits.max_vote_set);
    if (self.indexOf(vote)) |index| {
        if (supported) self.support[index] = true;
        return;
    }
    assert(!self.votes.full());
    self.support[self.votes.count] = supported;
    self.votes.push(vote.*);
}

pub fn countByValidator(self: *const VoteSet, validator: types.ValidatorIndex) u32 {
    var count: u32 = 0;
    for (self.votes.constSlice()) |*vote| {
        if (vote.val_index == validator) count += 1;
    }
    return count;
}

test {
    _ = @import("vote_set_test.zig");
}
