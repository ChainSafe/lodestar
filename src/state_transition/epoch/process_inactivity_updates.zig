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
const validator_chunks = @import("../utils/validator_chunks.zig");

const FLAG_PREV_TARGET_ATTESTER_UNSLASHED = attester_status_utils.FLAG_PREV_TARGET_ATTESTER_UNSLASHED;
const FLAG_ELIGIBLE_ATTESTER = attester_status_utils.FLAG_ELIGIBLE_ATTESTER;

const InactivityScan = struct {
    flags: []const u8,
    /// Read as the current scores and updated in place.
    scores: []u64,
    is_in_inactivity_leak: bool,
    score_bias: u64,
    score_recovery_rate: u64,
    /// A chunk writes the indices whose score changed from its own start onward.
    changed: []u32,
    changed_counts: []usize,
};

fn updateChunk(scan_ptr: *const InactivityScan, chunk: validator_chunks.Chunk) void {
    const scan = scan_ptr.*;
    var changed_count: usize = 0;
    for (
        scan.flags[chunk.start..chunk.end],
        scan.scores[chunk.start..chunk.end],
        chunk.start..,
    ) |flag, *score, i| {
        if (!hasMarkers(flag, FLAG_ELIGIBLE_ATTESTER)) continue;

        const prev_score = score.*;
        var new_score = if (hasMarkers(flag, FLAG_PREV_TARGET_ATTESTER_UNSLASHED))
            prev_score -| 1
        else
            prev_score + scan.score_bias;
        if (!scan.is_in_inactivity_leak) {
            new_score -|= scan.score_recovery_rate;
        }
        if (new_score != prev_score) {
            score.* = new_score;
            scan.changed[chunk.start + changed_count] = @intCast(i);
            changed_count += 1;
        }
    }
    scan.changed_counts[chunk.index] = changed_count;
}

pub fn processInactivityUpdates(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    cache: *const EpochTransitionCache,
) !void {
    if (epoch_cache.epoch == GENESIS_EPOCH) {
        return;
    }

    const flags = cache.flags;
    var inactivity_scores = try state.inactivityScores();
    try inactivity_scores.commit();
    const scores = try inactivity_scores.getAllInto(cache.validator_scratch);
    std.debug.assert(flags.len <= scores.len);

    const changed_counts = cache.chunk_counts[0..validator_chunks.count(flags.len)];
    const scan: InactivityScan = .{
        .flags = flags,
        .scores = scores,
        .is_in_inactivity_leak = isInInactivityLeak(epoch_cache.epoch, try state.finalizedEpoch()),
        .score_bias = config.chain.INACTIVITY_SCORE_BIAS,
        .score_recovery_rate = config.chain.INACTIVITY_SCORE_RECOVERY_RATE,
        .changed = cache.index_scratch[0..flags.len],
        .changed_counts = changed_counts,
    };
    try validator_chunks.run(io, flags.len, &scan, updateChunk);

    // Tree views are not thread-safe, so the changed scores are written back on this thread.
    for (changed_counts, 0..) |changed_count, chunk_index| {
        const chunk = validator_chunks.at(flags.len, chunk_index);
        for (scan.changed[chunk.start..][0..changed_count]) |i| {
            try inactivity_scores.set(i, scores[i]);
        }
    }
}
