const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const preset = @import("preset").preset;
const EPOCHS_PER_ETH1_VOTING_PERIOD = preset.EPOCHS_PER_ETH1_VOTING_PERIOD;

/// Reset eth1DataVotes tree every `EPOCHS_PER_ETH1_VOTING_PERIOD`.
pub fn processEth1DataReset(
    comptime fork: ForkSeq,
    state: *BeaconState(fork),
    cache: *const EpochTransitionCache,
) !void {
    const next_epoch = cache.current_epoch + 1;

    // reset eth1 data votes
    if (next_epoch % EPOCHS_PER_ETH1_VOTING_PERIOD == 0) {
        try state.resetEth1DataVotes();
    }
}
