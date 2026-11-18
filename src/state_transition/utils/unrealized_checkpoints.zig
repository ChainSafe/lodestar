const std = @import("std");
const Checkpoint = @import("consensus_types").phase0.Checkpoint.Type;
const CachedBeaconState = @import("../cache/state_cache.zig").CachedBeaconState;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const processJustificationAndFinalization = @import("../epoch/process_justification_and_finalization.zig").processJustificationAndFinalization;
const weighJustificationAndFinalization = @import("../epoch/process_justification_and_finalization.zig").weighJustificationAndFinalization;
const GENESIS_EPOCH = @import("preset").GENESIS_EPOCH;

pub const UnrealizedCheckpoints = struct {
    justified_checkpoint: Checkpoint,
    finalized_checkpoint: Checkpoint,
};
const Node = @import("persistent_merkle_tree").Node;

/// Compute on-the-fly justified / finalized checkpoints.
///   - For phase0, we need to create the cache through beforeProcessEpoch
///   - For other forks, use the progressive balances inside EpochCache
pub fn computeUnrealizedCheckpoints(allocator: std.mem.Allocator, io: std.Io, cached_state: *CachedBeaconState) !UnrealizedCheckpoints {
    // For phase0, we need to create the cache through beforeProcessEpoch
    if (cached_state.state.forkSeq() == .phase0) {
        // Clone state to mutate below         true = do not transfer cache
        const cloned_state = try cached_state.clone(allocator, .{ .transfer_cache = false });
        defer allocator.destroy(cloned_state);
        defer cloned_state.deinit();

        var epoch_transition_cache = try EpochTransitionCache.init(
            allocator,
            io,
            cloned_state.config,
            cloned_state.epoch_cache,
            cloned_state.state,
        );
        defer epoch_transition_cache.deinit();

        switch (cloned_state.state.forkSeq()) {
            inline else => |fork| {
                try processJustificationAndFinalization(
                    fork,
                    cloned_state.state.castToFork(fork),
                    &epoch_transition_cache,
                );
            },
        }

        var justified: Checkpoint = undefined;
        try cloned_state.state.currentJustifiedCheckpoint(&justified);
        var finalized: Checkpoint = undefined;
        try cloned_state.state.finalizedCheckpoint(&finalized);

        return .{
            .justified_checkpoint = justified,
            .finalized_checkpoint = finalized,
        };
    }

    // For other forks, use the progressive balances inside EpochCache
    const epoch_cache = cached_state.epoch_cache;
    const current_epoch = epoch_cache.epoch;

    // same logic to processJustificationAndFinalization
    if (current_epoch <= GENESIS_EPOCH + 1) {
        var justified: Checkpoint = undefined;
        try cached_state.state.currentJustifiedCheckpoint(&justified);
        var finalized: Checkpoint = undefined;
        try cached_state.state.finalizedCheckpoint(&finalized);
        return .{
            .justified_checkpoint = justified,
            .finalized_checkpoint = finalized,
        };
    }

    // Clone state and use progressive balances
    // Clone state to mutate below         true = do not transfer cache
    const cloned_state = try cached_state.clone(allocator, .{ .transfer_cache = false });
    defer allocator.destroy(cloned_state);
    defer cloned_state.deinit();

    const total_active_balance = epoch_cache.total_active_balance_increments;
    // minimum of total progressive unslashed balance should be 1
    const previous_epoch_target_balance = @max(epoch_cache.previous_target_unslashed_balance_increments, 1);
    const current_epoch_target_balance = @max(epoch_cache.current_target_unslashed_balance_increments, 1);

    switch (cloned_state.state.forkSeq()) {
        inline else => |fork| {
            try weighJustificationAndFinalization(
                fork,
                cloned_state.state.castToFork(fork),
                total_active_balance,
                previous_epoch_target_balance,
                current_epoch_target_balance,
            );
        },
    }

    var justified: Checkpoint = undefined;
    try cloned_state.state.currentJustifiedCheckpoint(&justified);
    var finalized: Checkpoint = undefined;
    try cloned_state.state.finalizedCheckpoint(&finalized);

    return .{
        .justified_checkpoint = justified,
        .finalized_checkpoint = finalized,
    };
}
