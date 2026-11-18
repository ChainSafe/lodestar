const std = @import("std");
const testing = std.testing;
const Frame = @import("FinalityFrame.zig");
const types = @import("../types.zig");
const limits = @import("../limits.zig");

fn root(n: u8) types.Root {
    return @splat(n);
}

test "viability requires a witness inside the supplied domain" {
    const blocks = [_]Frame.Block{
        .{ .root = root(0), .parent = root(0), .slot = 0 },
        .{ .root = root(1), .parent = root(0), .slot = 1 },
        .{ .root = root(2), .parent = root(1), .slot = 2 },
        .{ .root = root(3), .parent = root(0), .slot = 2 },
    };
    var heads: Frame.Mask = @splat(false);
    heads[2] = true;
    heads[3] = true;
    const frame = try Frame.init(&blocks, &root(0), &heads);
    var domain = frame.all();
    domain[2] = false;
    const viable = frame.viableTree(&domain);
    try testing.expect(!viable[1]);
    try testing.expect(viable[0] and viable[3]);
    try testing.expect(frame.isAncestor(1, 2));
    try testing.expect(!frame.isAncestor(1, 3));
    try testing.expectEqual(@as(u32, 2), frame.depth(2));
}

test "frame rejects malformed ancestry, roots, and witnesses" {
    var blocks = [_]Frame.Block{
        .{ .root = root(0), .parent = root(0), .slot = 0 },
        .{ .root = root(1), .parent = root(0), .slot = 1 },
    };
    var heads: Frame.Mask = @splat(false);
    heads[1] = true;
    try testing.expectError(error.InvalidFrame, Frame.init(&.{}, &root(0), &heads));
    try testing.expectError(error.InvalidFrame, Frame.init(&blocks, &root(9), &heads));
    heads[2] = true;
    try testing.expectError(error.InvalidFrame, Frame.init(&blocks, &root(0), &heads));
    heads[2] = false;
    blocks[1].parent = root(1);
    try testing.expectError(error.InvalidFrame, Frame.init(&blocks, &root(0), &heads));
    blocks[1].parent = root(0);
    blocks[1].slot = 0;
    try testing.expectError(error.InvalidFrame, Frame.init(&blocks, &root(0), &heads));
    blocks[1].slot = 1;
    blocks[1].root = root(0);
    try testing.expectError(error.InvalidFrame, Frame.init(&blocks, &root(0), &heads));
    const oversized = try testing.allocator.alloc(Frame.Block, limits.max_blocks + 1);
    defer testing.allocator.free(oversized);
    try testing.expectError(error.FrameCapacity, Frame.init(oversized, &root(0), &heads));
}

test "the first projected block is F even after genesis leaves the frame" {
    const blocks = [_]Frame.Block{
        .{ .root = root(3), .parent = root(2), .slot = 3 },
        .{ .root = root(4), .parent = root(3), .slot = 4 },
    };
    var heads: Frame.Mask = @splat(false);
    heads[1] = true;
    const frame = try Frame.init(&blocks, &root(3), &heads);
    try testing.expectEqual(root(3), frame.tree[0].root);
    try testing.expectEqual(@as(?u32, null), frame.find(&root(2)));
    try testing.expect(frame.isAncestor(0, 1));
    try testing.expectEqual(@as(u32, 1), frame.depth(1));
    const viable = frame.viableTree(&frame.all());
    try testing.expect(viable[0] and viable[1]);
}
