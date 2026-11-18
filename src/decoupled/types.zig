//! Shared value types for Goldilocks (fgsa-spec.pdf Section 3.1).
//! FG supplies block roots. Time uses caller-selected integer units, not fixed-duration ticks.

const std = @import("std");

pub const Root = [32]u8;
pub const Time = u32;
pub const Slot = u32;
pub const ValidatorIndex = u32;

pub fn rootOrder(a: *const Root, b: *const Root) std.math.Order {
    return std.mem.order(u8, a, b);
}

/// A vote tuple (val_index, slot, head), with the head identified by root.
/// Authentication is external. A vote naming a later-slot head never resolves.
pub const GoldfishVote = extern struct {
    val_index: ValidatorIndex,
    slot: Slot,
    head: Root,

    pub fn eql(a: *const GoldfishVote, b: *const GoldfishVote) bool {
        if (a.val_index != b.val_index) return false;
        if (a.slot != b.slot) return false;
        return std.mem.eql(u8, &a.head, &b.head);
    }
};

test "vote identity includes validator, slot, and head with fixed root ordering" {
    const first: GoldfishVote = .{ .val_index = 0, .slot = 1, .head = @splat(1) };
    var other = first;
    try std.testing.expect(first.eql(&other));
    other.val_index = 1;
    try std.testing.expect(!first.eql(&other));
    other = first;
    other.slot = 2;
    try std.testing.expect(!first.eql(&other));
    other = first;
    other.head = @splat(2);
    try std.testing.expect(!first.eql(&other));
    try std.testing.expectEqual(std.math.Order.lt, rootOrder(&first.head, &other.head));
    try std.testing.expectEqual(std.math.Order.gt, rootOrder(&other.head, &first.head));
    try std.testing.expectEqual(std.math.Order.eq, rootOrder(&first.head, &first.head));
}
