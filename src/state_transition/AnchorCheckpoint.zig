const AnchorCheckpoint = @This();

const std = @import("std");
const Allocator = std.mem.Allocator;
const types = @import("consensus_types");
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const AnyBeaconBlock = @import("fork_types").AnyBeaconBlock;
const ForkTypes = @import("fork_types").ForkTypes;
const c = @import("constants");
const ZERO_HASH = c.ZERO_HASH;
const computeCheckpointEpochAtStateSlot = @import("utils/epoch.zig").computeCheckpointEpochAtStateSlot;

checkpoint: types.phase0.Checkpoint.Type,
block_header: types.phase0.BeaconBlockHeader.Type,

/// Compute the anchor checkpoint for a given state.
/// Returns both the checkpoint and block header.
pub fn fromState(state: *AnyBeaconState) !AnchorCheckpoint {
    const slot = try state.slot();
    var header = types.phase0.BeaconBlockHeader.default_value;
    var root: [32]u8 = undefined;

    if (slot == c.GENESIS_SLOT) {
        // At genesis, create header from default block body root (no SignedBlock exists)
        header.body_root = switch (state.forkSeq()) {
            inline else => |f| ForkTypes(f).BeaconBlockBody.default_root,
        };
        header.state_root = (try state.hashTreeRoot()).*;
        try types.phase0.BeaconBlockHeader.hashTreeRoot(&header, &root);
    } else {
        // After genesis, clone latestBlockHeader
        var latest_block_header = try state.latestBlockHeader();
        try latest_block_header.toValue(undefined, &header);

        if (std.mem.eql(u8, &header.state_root, &ZERO_HASH)) {
            header.state_root = (try state.hashTreeRoot()).*;
        }
        try types.phase0.BeaconBlockHeader.hashTreeRoot(&header, &root);
    }

    const checkpoint_epoch = computeCheckpointEpochAtStateSlot(slot);

    return AnchorCheckpoint{
        .checkpoint = .{
            .epoch = checkpoint_epoch,
            .root = root,
        },
        .block_header = header,
    };
}
