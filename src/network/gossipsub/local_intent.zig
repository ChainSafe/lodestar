const std = @import("std");
const topic = @import("topic.zig");
const policy = @import("topic_policy.zig");

const mask_offsets = blk: {
    var offsets: [policy.kind_count + 1]usize = @splat(0);
    for (0..policy.kind_count) |i| {
        const kind: topic.Kind = @enumFromInt(i);
        offsets[i + 1] = offsets[i] + (kind.countMax() + 7) / 8;
    }
    break :blk offsets;
};

pub const Boundary = struct {
    digest: [4]u8,
    masks: [mask_offsets[policy.kind_count]]u8 = @splat(0),
    lengths: [policy.kind_count]u8 = @splat(0),

    pub fn mask(self: *Boundary, kind: topic.Kind) []u8 {
        const k = @intFromEnum(kind);
        return self.masks[mask_offsets[k]..mask_offsets[k + 1]];
    }

    pub fn maskConst(self: *const Boundary, kind: topic.Kind) []const u8 {
        const k = @intFromEnum(kind);
        return self.masks[mask_offsets[k]..mask_offsets[k + 1]];
    }
};
/// Private scratch between preparation and commit in one serialized owner call.
pub const Workspace = struct {
    desired: std.StaticBitSet(policy.topic_max) = .empty,
    now_ms: u64 = 0,
    slot: u64 = 0,
    prepared: bool = false,
};

pub const Error = error{ TopicCapacity, DuplicateBoundary, InvalidTopic };

test {
    _ = @import("local_intent_test.zig");
}
