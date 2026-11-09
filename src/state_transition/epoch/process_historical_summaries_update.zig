const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const types = @import("consensus_types");
const preset = @import("preset").preset;

pub fn processHistoricalSummariesUpdate(
    comptime fork: ForkSeq,
    state: *BeaconState(fork),
    cache: *const EpochTransitionCache,
) !void {
    const next_epoch = cache.current_epoch + 1;

    // set historical root accumulator
    if (next_epoch % @divFloor(preset.SLOTS_PER_HISTORICAL_ROOT, preset.SLOTS_PER_EPOCH) == 0) {
        const block_summary_root = try state.blockRootsRoot();
        const state_summary_root = try state.stateRootsRoot();
        var historical_summaries = try state.historicalSummaries();
        const new_historical_summary: types.capella.HistoricalSummary.Type = .{
            .block_summary_root = block_summary_root.*,
            .state_summary_root = state_summary_root.*,
        };
        try historical_summaries.pushValue(&new_historical_summary);
    }
}
