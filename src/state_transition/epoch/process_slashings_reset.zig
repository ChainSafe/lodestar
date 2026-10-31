const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const preset = @import("preset").preset;

/// Resets slashings for the next epoch.
/// PERF: Almost no (constant) cost
pub fn processSlashingsReset(
    comptime fork: ForkSeq,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    cache: *const EpochTransitionCache,
) !void {
    const next_epoch = cache.current_epoch + 1;

    // reset slashings
    const slash_index = next_epoch % preset.EPOCHS_PER_SLASHINGS_VECTOR;
    var slashings = try state.slashings();
    const slashing = try slashings.get(slash_index);
    const old_slashing_value_by_increment = slashing / preset.EFFECTIVE_BALANCE_INCREMENT;
    try slashings.set(slash_index, 0);
    epoch_cache.total_slashings_by_increment = @max(0, epoch_cache.total_slashings_by_increment - old_slashing_value_by_increment);
}
