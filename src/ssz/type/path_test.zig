//! Tests for `path.zig`.

const std = @import("std");
const Gindex = @import("persistent_merkle_tree").Gindex;
const types = @import("root.zig");
const PathType = @import("path.zig").PathType;
const getPathGindex = @import("path.zig").getPathGindex;

test "PathType" {
    const Root = types.ByteVectorType(32);
    const Checkpoint = types.FixedContainerType(struct {
        slot: types.UintType(64),
        root: Root,
    });

    _ = PathType(Checkpoint, "slot");
}

test "getPathGindex" {
    const Root = types.ByteVectorType(32);
    const Checkpoint = types.FixedContainerType(struct {
        epoch: types.UintType(64),
        root: Root,
    });

    try std.testing.expectEqual(@as(Gindex.Uint, 2), @intFromEnum(getPathGindex(Checkpoint, "epoch")));
    try std.testing.expectEqual(@as(Gindex.Uint, 3), @intFromEnum(getPathGindex(Checkpoint, "root")));

    const BeaconState = types.FixedContainerType(struct {
        slot: types.UintType(64),
        finalized_checkpoint: Checkpoint,
    });

    try std.testing.expectEqual(@as(Gindex.Uint, 7), @intFromEnum(getPathGindex(BeaconState, "finalized_checkpoint.root")));

    const Balances = types.FixedListType(types.UintType(64), 4, .{});
    const SimpleState = types.VariableContainerType(struct {
        slot: types.UintType(64),
        balances: Balances,
    });

    try std.testing.expectEqual(@as(Gindex.Uint, 6), @intFromEnum(getPathGindex(SimpleState, "balances.0")));
}

test "getPathGindex should address progressive containers, lists and bitlists" {
    const Checkpoint = types.FixedContainerType(struct {
        epoch: types.UintType(64),
        root: types.ByteVectorType(32),
    });
    const active_fields = comptime blk: {
        var bits: [21]u1 = @splat(0);
        bits[0] = 1;
        bits[20] = 1;
        break :blk bits;
    };
    const State = types.FixedProgressiveContainerType(struct {
        slot: types.UintType(64),
        finalized_checkpoint: Checkpoint,
    }, &active_fields);
    // Gloas `FINALIZED_ROOT_GINDEX` puts `finalized_checkpoint` at active position 20.
    try std.testing.expectEqual(@as(Gindex.Uint, 735), @intFromEnum(getPathGindex(State, "finalized_checkpoint.root")));

    const Numbers = types.FixedProgressiveListType(types.UintType(64), .{});
    const Bits = types.ProgressiveBitListType(.{});
    // Element 5 and bit 300 both sit in chunk 1, contents gindex 24, so 40 from the list root.
    try std.testing.expectEqual(@as(Gindex.Uint, 40), @intFromEnum(getPathGindex(Numbers, "5")));
    try std.testing.expectEqual(@as(Gindex.Uint, 40), @intFromEnum(getPathGindex(Bits, "300")));
    try std.testing.expectEqual(@as(Gindex.Uint, 3), @intFromEnum(getPathGindex(Numbers, "length")));

    // Composite element 2 is chunk 2: contents gindex 25, so 41 from the list root.
    const Checkpoints = types.FixedProgressiveListType(Checkpoint, .{});
    try std.testing.expectEqual(@as(Gindex.Uint, 41), @intFromEnum(getPathGindex(Checkpoints, "2")));
    try std.testing.expectEqual(@as(Gindex.Uint, 83), @intFromEnum(getPathGindex(Checkpoints, "2.root")));
}
