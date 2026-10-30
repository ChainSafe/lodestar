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
    // The buffer is sized from the validator count at cache init, and a valid state keeps one
    // inactivity score per validator.
    const inactivity_scores_values = cache.inactivity_scores_buffer;
    std.debug.assert(inactivity_scores_values.len == try inactivity_scores.length());
    _ = try inactivity_scores.getAllInto(inactivity_scores_values);

    std.debug.assert(flags.len <= inactivity_scores_values.len);
    for (0..flags.len) |i| {
        const flag = flags[i];
        if (hasMarkers(flag, FLAG_ELIGIBLE_ATTESTER)) {
            var inactivity_score = inactivity_scores_values[i];

            const prev_inactivity_score = inactivity_score;
            if (hasMarkers(flag, FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
                inactivity_score -= @min(1, inactivity_score);
            } else {
                inactivity_score += INACTIVITY_SCORE_BIAS;
            }
            if (!is_in_activity_leak) {
                inactivity_score -= @min(INACTIVITY_SCORE_RECOVERY_RATE, inactivity_score);
            }
            if (inactivity_score != prev_inactivity_score) {
                try inactivity_scores.set(i, inactivity_score);
            }
        }
    }
}
