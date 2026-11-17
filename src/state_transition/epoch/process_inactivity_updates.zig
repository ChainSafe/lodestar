const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const GENESIS_EPOCH = @import("preset").GENESIS_EPOCH;
const isInInactivityLeak = @import("inactivity_leak.zig").isInInactivityLeak;
const attester_status_utils = @import("../utils/attester_status.zig");
const hasMarkers = attester_status_utils.hasMarkers;

pub fn processInactivityUpdates(
    comptime fork: ForkSeq,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    cache: *const EpochTransitionCache,
) !void {
    if (epoch_cache.epoch == GENESIS_EPOCH) {
        return;
    }

    const INACTIVITY_SCORE_BIAS = config.chain.INACTIVITY_SCORE_BIAS;
    const INACTIVITY_SCORE_RECOVERY_RATE = config.chain.INACTIVITY_SCORE_RECOVERY_RATE;
    const flags = cache.flags;
    const is_in_activity_leak = isInInactivityLeak(epoch_cache.epoch, try state.finalizedEpoch());

    // this avoids importing FLAG_ELIGIBLE_ATTESTER inside the for loop, check the compiled code
    const FLAG_PREV_TARGET_ATTESTER_UNSLASHED = attester_status_utils.FLAG_PREV_TARGET_ATTESTER_UNSLASHED;
    const FLAG_ELIGIBLE_ATTESTER = attester_status_utils.FLAG_ELIGIBLE_ATTESTER;

    var inactivity_scores = try state.inactivityScores();
    try inactivity_scores.commit();
    const inactivity_scores_values = try inactivity_scores.getAllInto(cache.validator_scratch);

    std.debug.assert(flags.len <= inactivity_scores_values.len);
    for (flags, inactivity_scores_values[0..flags.len], 0..) |flag, prev_inactivity_score, i| {
        if (!hasMarkers(flag, FLAG_ELIGIBLE_ATTESTER)) continue;

        var inactivity_score = if (hasMarkers(flag, FLAG_PREV_TARGET_ATTESTER_UNSLASHED))
            prev_inactivity_score -| 1
        else
            prev_inactivity_score + INACTIVITY_SCORE_BIAS;
        if (!is_in_activity_leak) {
            inactivity_score -|= INACTIVITY_SCORE_RECOVERY_RATE;
        }
        if (inactivity_score != prev_inactivity_score) {
            try inactivity_scores.set(i, inactivity_score);
        }
    }
}
