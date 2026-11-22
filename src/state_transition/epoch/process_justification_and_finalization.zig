const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const types = @import("consensus_types");
const Checkpoint = types.phase0.Checkpoint.Type;
const JustificationBits = types.phase0.JustificationBits.Type;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const GENESIS_EPOCH = @import("preset").GENESIS_EPOCH;
const SLOTS_PER_EPOCH = @import("preset").preset.SLOTS_PER_EPOCH;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;
const getBlockRoot = @import("../utils/block_root.zig").getBlockRoot;

/// Update justified and finalized checkpoints depending on network participation.
///
/// PERF: Very low (constant) cost. Persist small objects to the tree.
pub fn processJustificationAndFinalization(
    comptime fork: ForkSeq,
    state: *BeaconState(fork),
    cache: *const EpochTransitionCache,
) !void {
    // Initial FFG checkpoint values have a `0x00` stub for `root`.
    // Skip FFG updates in the first two epochs to avoid corner cases that might result in modifying this stub.
    if (cache.current_epoch <= GENESIS_EPOCH + 1) {
        return;
    }
    try weighJustificationAndFinalization(
        fork,
        state,
        cache.total_active_stake_by_increment,
        cache.prev_epoch_unslashed_stake_target_by_increment,
        cache.curr_epoch_unslashed_target_stake_by_increment,
    );
}

pub fn weighJustificationAndFinalization(
    comptime fork: ForkSeq,
    state: *BeaconState(fork),
    total_active_balance: u64,
    previous_epoch_target_balance: u64,
    current_epoch_target_balance: u64,
) !void {
    const current_epoch = computeEpochAtSlot(try state.slot());
    const previous_epoch = if (current_epoch == GENESIS_EPOCH) GENESIS_EPOCH else current_epoch - 1;

    var old_previous_justified_checkpoint: types.phase0.Checkpoint.Type = undefined;
    try state.previousJustifiedCheckpoint(&old_previous_justified_checkpoint);
    var old_current_justified_checkpoint: types.phase0.Checkpoint.Type = undefined;
    try state.currentJustifiedCheckpoint(&old_current_justified_checkpoint);

    const old_previous_justified_checkpoint_epoch = old_previous_justified_checkpoint.epoch;
    const old_current_justified_checkpoint_epoch = old_current_justified_checkpoint.epoch;

    // Process justifications
    try state.setPreviousJustifiedCheckpoint(&old_current_justified_checkpoint);
    var justification_bits = try state.justificationBits();
    var bits: [types.phase0.JustificationBits.length]bool = undefined;
    try justification_bits.toBoolArrayInto(&bits);

    // Rotate bits
    var idx: usize = bits.len - 1;
    while (idx > 0) : (idx -= 1) {
        bits[idx] = bits[idx - 1];
    }
    bits[0] = false;

    if (previous_epoch_target_balance * 3 >= total_active_balance * 2) {
        const new_current_justified_checkpoint = Checkpoint{
            .epoch = previous_epoch,
            .root = (try getBlockRoot(fork, state, previous_epoch)).*,
        };
        try state.setCurrentJustifiedCheckpoint(&new_current_justified_checkpoint);
        bits[1] = true;
    }

    if (current_epoch_target_balance * 3 >= total_active_balance * 2) {
        const new_current_justified_checkpoint = Checkpoint{
            .epoch = current_epoch,
            .root = (try getBlockRoot(fork, state, current_epoch)).*,
        };
        try state.setCurrentJustifiedCheckpoint(&new_current_justified_checkpoint);
        bits[0] = true;
    }

    const new_justification_bits = try JustificationBits.fromBoolArray(bits);
    try state.setJustificationBits(&new_justification_bits);

    // Process finalizations
    // The 2nd/3rd/4th most recent epochs are all justified, the 2nd using the 4th as source
    if (bits[1] and bits[2] and bits[3] and old_previous_justified_checkpoint_epoch + 3 == current_epoch) {
        try state.setFinalizedCheckpoint(&old_previous_justified_checkpoint);
    }
    // The 2nd/3rd most recent epochs are both justified, the 2nd using the 3rd as source
    if (bits[1] and bits[2] and old_previous_justified_checkpoint_epoch + 2 == current_epoch) {
        try state.setFinalizedCheckpoint(&old_previous_justified_checkpoint);
    }
    // The 1st/2nd/3rd most recent epochs are all justified, the 1st using the 3rd as source
    if (bits[0] and bits[1] and bits[2] and old_current_justified_checkpoint_epoch + 2 == current_epoch) {
        try state.setFinalizedCheckpoint(&old_current_justified_checkpoint);
    }
    // The 1st/2nd most recent epochs are both justified, the 1st using the 2nd as source
    if (bits[0] and bits[1] and old_current_justified_checkpoint_epoch + 1 == current_epoch) {
        try state.setFinalizedCheckpoint(&old_current_justified_checkpoint);
    }
}

const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;
const Node = @import("persistent_merkle_tree").Node;

test "weighJustificationAndFinalization justifies exact two-thirds participation" {
    const allocator = std.testing.allocator;
    const pool_size = 200_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    var test_state = try TestCachedBeaconState.init(allocator, &pool, 10_000);
    defer test_state.deinit();

    var state = test_state.cached_state.state.castToFork(.electra);
    try state.setSlot(3 * SLOTS_PER_EPOCH + 1);

    try weighJustificationAndFinalization(
        .electra,
        state,
        3,
        2,
        2,
    );

    var justification_bits = try state.justificationBits();
    var bits: [types.phase0.JustificationBits.length]bool = undefined;
    try justification_bits.toBoolArrayInto(&bits);
    try std.testing.expect(bits[0]);
    try std.testing.expect(bits[1]);
}
