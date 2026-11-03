const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const preset = @import("preset").preset;

pub fn processRandaoMixesReset(
    comptime fork: ForkSeq,
    state: *BeaconState(fork),
    cache: *const EpochTransitionCache,
) !void {
    const current_epoch = cache.current_epoch;
    const next_epoch = current_epoch + 1;

    var randao_mixes = try state.randaoMixes();
    var old = try randao_mixes.get(current_epoch % preset.EPOCHS_PER_HISTORICAL_VECTOR);
    try randao_mixes.set(
        next_epoch % preset.EPOCHS_PER_HISTORICAL_VECTOR,
        // Clone needed: set() at a different gindex may CoW-rebranch the
        // tree, invalidating the node reference returned by get().
        try old.clone(.{}),
    );
}
