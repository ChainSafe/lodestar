//! Borrowed, read-only FG frame for the Goldilocks AC (fgsa-spec.pdf Sections 1.4–1.5).
//!
//! The caller owns blocks and payload slices and keeps them immutable during each call.
//! tree[0] is F. Supply its descendants in parent order. Rebuild when FG state changes.
//! Authentication results come from the caller's signature/slot-key checks, not from the AC.
const std = @import("std");
const assert = std.debug.assert;
const limits = @import("../limits.zig");
const types = @import("../types.zig");

const FinalityFrame = @This();
const Root = types.Root;

pub const Mask = [limits.max_blocks]bool;
pub const SignedVote = struct {
    vote: types.GoldfishVote,
    authenticated: bool,
};
pub const Payload = struct {
    votes: []const SignedVote = &.{},
    /// Proposer's view of the votes.
    support_votes: []const types.GoldfishVote = &.{},
};
pub const Block = struct {
    root: Root,
    slot: types.Slot,
    parent: Root,
    payload: Payload = .{},
};
pub const Error = error{ FrameCapacity, InvalidFrame };

tree: []const Block,
fc_root: Root,
viable_heads: Mask,

pub fn init(
    tree: []const Block,
    fc_root: *const Root,
    viable_heads: *const Mask,
) Error!FinalityFrame {
    if (tree.len > limits.max_blocks) return error.FrameCapacity;
    if (tree.len == 0) return error.InvalidFrame;
    const frame: FinalityFrame = .{
        .tree = tree,
        .fc_root = fc_root.*,
        .viable_heads = viable_heads.*,
    };
    const root_index = frame.find(fc_root) orelse return error.InvalidFrame;
    var heads: u32 = 0;
    for (tree, 0..) |*block, i| {
        if (i > 0) {
            const parent_index = frame.find(&block.parent) orelse return error.InvalidFrame;
            if (parent_index >= i) return error.InvalidFrame;
            if (tree[parent_index].slot >= block.slot) return error.InvalidFrame;
        }
        for (tree[0..i]) |*previous| {
            if (std.mem.eql(u8, &previous.root, &block.root)) return error.InvalidFrame;
        }
        if (viable_heads[i]) {
            if (!frame.isAncestor(root_index, @intCast(i))) return error.InvalidFrame;
            heads += 1;
        }
    }
    for (viable_heads[tree.len..]) |head| {
        if (head) return error.InvalidFrame;
    }
    if (heads == 0) return error.InvalidFrame;
    return frame;
}

pub fn find(self: *const FinalityFrame, root: *const Root) ?u32 {
    assert(self.tree.len > 0);
    assert(self.tree.len <= limits.max_blocks);
    for (self.tree, 0..) |*block, i| {
        if (std.mem.eql(u8, &block.root, root)) return @intCast(i);
    }
    return null;
}

pub fn parent(self: *const FinalityFrame, index: u32) u32 {
    assert(index > 0);
    assert(index < self.tree.len);
    const result = self.find(&self.tree[index].parent).?;
    assert(result < index);
    return result;
}

pub fn isAncestor(self: *const FinalityFrame, ancestor: u32, descendant: u32) bool {
    assert(ancestor < self.tree.len);
    assert(descendant < self.tree.len);
    var cursor = descendant;
    for (0..limits.max_blocks) |_| {
        if (cursor == ancestor) return true;
        if (cursor == 0) return false;
        cursor = self.parent(cursor);
    }
    unreachable;
}

pub fn depth(self: *const FinalityFrame, index: u32) u32 {
    assert(index < self.tree.len);
    var result: u32 = 0;
    var cursor = index;
    for (0..limits.max_blocks) |_| {
        if (cursor == 0) return result;
        cursor = self.parent(cursor);
        result += 1;
    }
    unreachable;
}

pub fn all(self: *const FinalityFrame) Mask {
    var domain: Mask = @splat(false);
    @memset(domain[0..self.tree.len], true);
    return domain;
}

/// Recompute witnesses inside domain, rather than intersecting the full viable tree.
pub fn viableTree(self: *const FinalityFrame, domain: *const Mask) Mask {
    var result: Mask = @splat(false);
    const root_index = self.find(&self.fc_root).?;
    for (self.tree, 0..) |_, i| {
        if (!domain[i] or !self.viable_heads[i]) continue;
        var cursor: u32 = @intCast(i);
        for (0..limits.max_blocks) |_| {
            if (domain[cursor]) result[cursor] = true;
            if (cursor == root_index) break;
            cursor = self.parent(cursor);
        } else unreachable;
    }
    return result;
}

test {
    _ = @import("finality_frame_test.zig");
}
