const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const types = @import("consensus_types");
const preset = @import("preset").preset;
const Root = types.primitive.Root.Type;

pub fn processHistoricalRootsUpdate(
    comptime fork: ForkSeq,
    state: *BeaconState(fork),
    cache: *const EpochTransitionCache,
) !void {
    const next_epoch = cache.current_epoch + 1;

    // set historical root accumulator
    if (next_epoch % @divFloor(preset.SLOTS_PER_HISTORICAL_ROOT, preset.SLOTS_PER_EPOCH) == 0) {
        const block_roots = try state.blockRootsRoot();
        const state_roots = try state.stateRootsRoot();
        var root: Root = undefined;
        // HistoricalBatchRoots = Non-spec'ed helper type to allow efficient hashing in epoch transition.
        // This type is like a 'Header' of HistoricalBatch where its fields are hashed.
        try types.phase0.HistoricalBatchRoots.hashTreeRoot(&.{
            .block_roots = block_roots.*,
            .state_roots = state_roots.*,
        }, &root);
        var historical_roots = try state.historicalRoots();
        try historical_roots.pushValue(&root);
    }
}
