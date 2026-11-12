const std = @import("std");
const Allocator = std.mem.Allocator;
const types = @import("consensus_types");
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const BlockType = @import("fork_types").BlockType;
const BeaconBlock = @import("fork_types").BeaconBlock;
const BeaconBlockHeader = types.phase0.BeaconBlockHeader.Type;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const ZERO_HASH = @import("constants").ZERO_HASH;
const getBeaconProposer = @import("../cache/get_beacon_proposer.zig").getBeaconProposer;

/// `known_body_root`, when given, must be the root of `block`'s body. It is used instead of merkleizing the body.
pub fn processBlockHeader(
    comptime fork: ForkSeq,
    allocator: Allocator,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    comptime block_type: BlockType,
    block: *const BeaconBlock(block_type, fork),
    known_body_root: ?*const [32]u8,
) !void {
    const slot = try state.slot();

    // verify that the slots match
    if (block.slot() != slot) {
        return error.BlockSlotMismatch;
    }

    // Verify that the block is newer than latest block header
    var latest_header_view = try state.latestBlockHeader();
    const latest_header_slot = try latest_header_view.get("slot");
    if (!(block.slot() > latest_header_slot)) {
        return error.BlockNotNewerThanLatestHeader;
    }

    // verify that proposer index is the correct index
    const proposer_index = try getBeaconProposer(fork, epoch_cache, state, slot);
    if (block.proposerIndex() != proposer_index) {
        return error.BlockProposerIndexMismatch;
    }

    // verify that the parent matches
    const header_parent_root = try latest_header_view.hashTreeRoot();
    if (!std.mem.eql(u8, block.parentRoot(), header_parent_root)) {
        return error.BlockParentRootMismatch;
    }

    var body_root: [32]u8 = undefined;
    if (known_body_root) |known_root| {
        body_root = known_root.*;
    } else {
        try block.body().hashTreeRoot(allocator, &body_root);
    }
    // cache current block as the new latest block
    const latest_block_header: BeaconBlockHeader = .{
        .slot = slot,
        .proposer_index = proposer_index,
        .parent_root = block.parentRoot().*,
        .state_root = ZERO_HASH,
        .body_root = body_root,
    };
    try state.setLatestBlockHeader(&latest_block_header);

    // verify proposer is not slashed. Only once per block, may use the slower read from tree
    var validators_view = try state.validators();
    var proposer_validator_view = try validators_view.get(proposer_index);
    const proposer_slashed = try proposer_validator_view.get("slashed");
    if (proposer_slashed) {
        return error.BlockProposerSlashed;
    }
}
