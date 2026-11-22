const AnchorCheckpoint = @This();

const std = @import("std");
const Allocator = std.mem.Allocator;
const types = @import("consensus_types");
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const AnyBeaconBlock = @import("fork_types").AnyBeaconBlock;
const c = @import("constants");
const ZERO_HASH = c.ZERO_HASH;
const computeCheckpointEpochAtStateSlot = @import("utils/epoch.zig").computeCheckpointEpochAtStateSlot;

checkpoint: types.phase0.Checkpoint.Type,
block_header: types.phase0.BeaconBlockHeader.Type,

/// Compute the anchor checkpoint for a given state.
/// Returns both the checkpoint and block header.
pub fn fromState(state: *AnyBeaconState) !AnchorCheckpoint {
    const slot = try state.slot();
    var header: types.phase0.BeaconBlockHeader.Type = undefined;
    var root: [32]u8 = undefined;

    var latest_block_header = try state.latestBlockHeader();
    try latest_block_header.toValue(undefined, &header);

    if (std.mem.eql(u8, &header.state_root, &ZERO_HASH)) {
        header.state_root = (try state.hashTreeRoot()).*;
    }
    try types.phase0.BeaconBlockHeader.hashTreeRoot(&header, &root);

    const checkpoint_epoch = computeCheckpointEpochAtStateSlot(slot);

    return AnchorCheckpoint{
        .checkpoint = .{
            .epoch = checkpoint_epoch,
            .root = root,
        },
        .block_header = header,
    };
}

test "genesis anchor root matches the block root cached by processSlot" {
    const allocator = std.testing.allocator;
    const Node = @import("persistent_merkle_tree").Node;
    const processSlot = @import("slot/process_slot.zig").processSlot;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 350_000 });
    defer pool.deinit();
    var state = try AnyBeaconState.fromValue(allocator, &pool, .gloas, &types.gloas.BeaconState.default_value);
    defer state.deinit();

    // Gloas genesis blocks commit to the latest execution payload bid, so the body root is not the default one
    var genesis_header = types.phase0.BeaconBlockHeader.default_value;
    genesis_header.body_root = [_]u8{0xab} ** 32;
    try state.setLatestBlockHeader(&genesis_header);

    const anchor = try fromState(&state);

    try processSlot(std.testing.io, &state);
    var block_roots = try state.blockRoots();
    var genesis_block_root: [32]u8 = undefined;
    try block_roots.getValue(undefined, 0, &genesis_block_root);
    try std.testing.expectEqualSlices(u8, &genesis_block_root, &anchor.checkpoint.root);
}
