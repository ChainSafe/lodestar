const std = @import("std");
const preset = @import("preset").preset;
const CachedBeaconState = @import("../cache/state_cache.zig").CachedBeaconState;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const rewards_and_penalties = @import("../epoch/get_rewards_and_penalties.zig");
const status = @import("../utils/attester_status.zig");
const processJustificationAndFinalization = @import("../epoch/process_justification_and_finalization.zig").processJustificationAndFinalization;
const processInactivityUpdates = @import("../epoch/process_inactivity_updates.zig").processInactivityUpdates;
const isInInactivityLeak = @import("../epoch/inactivity_leak.zig").isInInactivityLeak;

pub const IdealAttestationsReward = struct {
    effective_balance: u64,
    head: u64 = 0,
    target: u64 = 0,
    source: u64 = 0,
};

pub const TotalAttestationsReward = struct {
    validator_index: u64,
    head: i64 = 0,
    target: i64 = 0,
    source: i64 = 0,
    inactivity: i64 = 0,
};

pub const AttestationsRewards = struct {
    ideal_rewards: []IdealAttestationsReward,
    total_rewards: []TotalAttestationsReward,

    pub fn deinit(self: AttestationsRewards, allocator: std.mem.Allocator) void {
        allocator.free(self.ideal_rewards);
        allocator.free(self.total_rewards);
    }
};

const AttestationsPenalty = struct {
    source: u64,
    target: u64,
};

/// Returns caller-owned rewards. Filters must be sorted ascending; null selects all,
/// while an empty slice selects none. Serialize with other EpochTransitionCache borrowers.
pub fn computeAttestationsRewards(
    allocator: std.mem.Allocator,
    pre_state: *CachedBeaconState,
    validator_indices: ?[]const u64,
) !AttestationsRewards {
    const fork = pre_state.state.forkSeq();
    if (fork == .phase0) return error.AttestationsRewardsUnsupportedFork;
    if (validator_indices) |indices| std.debug.assert(std.sort.isSorted(u64, indices, {}, std.sort.asc(u64)));

    try pre_state.state.commit();
    var state = try pre_state.clone(allocator, .{ .transfer_cache = false });
    defer {
        state.deinit();
        allocator.destroy(state);
    }

    var cache = try EpochTransitionCache.init(allocator, state.config, state.epoch_cache, state.state);
    defer cache.deinit();

    // Epoch rewards use the finality and inactivity scores after these updates.
    switch (state.state.*) {
        .phase0 => unreachable,
        inline else => |_, state_fork| {
            const fork_state = state.state.castToFork(state_fork);
            try processJustificationAndFinalization(state_fork, fork_state, &cache);
            try processInactivityUpdates(state_fork, allocator, state.config, state.epoch_cache, fork_state, &cache);
        },
    }

    const max_balance: u64 = if (fork.gte(.electra)) preset.MAX_EFFECTIVE_BALANCE_ELECTRA else preset.MAX_EFFECTIVE_BALANCE;
    const ideal_rewards = try allocator.alloc(IdealAttestationsReward, max_balance / preset.EFFECTIVE_BALANCE_INCREMENT + 1);
    errdefer allocator.free(ideal_rewards);
    var penalty_buffer: [preset.MAX_EFFECTIVE_BALANCE_ELECTRA / preset.EFFECTIVE_BALANCE_INCREMENT + 1]AttestationsPenalty = undefined;
    std.debug.assert(ideal_rewards.len <= penalty_buffer.len);
    const penalties = penalty_buffer[0..ideal_rewards.len];

    const leak = isInInactivityLeak(state.epoch_cache.epoch, try state.state.finalizedEpoch());
    for (ideal_rewards, 0..) |*reward, increment| {
        const item = rewards_and_penalties.computeRewardPenaltyItem(&cache, increment);
        reward.* = .{ .effective_balance = increment * preset.EFFECTIVE_BALANCE_INCREMENT };
        if (!leak) {
            reward.source = item.timely_source_reward;
            reward.target = item.timely_target_reward;
            reward.head = item.timely_head_reward;
        }
        penalties[increment] = .{ .source = item.timely_source_penalty, .target = item.timely_target_penalty };
    }

    var total_rewards = try std.ArrayList(TotalAttestationsReward).initCapacity(
        allocator,
        if (validator_indices) |indices| @min(indices.len, cache.flags.len) else cache.flags.len,
    );
    errdefer total_rewards.deinit(allocator);

    const inactivity_denominator = rewards_and_penalties.inactivityPenaltyDenominator(state.config, fork);
    const effective_increments = state.epoch_cache.getEffectiveBalanceIncrements().items;
    var inactivity_scores = try state.state.inactivityScores();
    var filter_index: usize = 0;
    for (cache.flags, 0..) |flag, i| {
        if (validator_indices) |indices| {
            while (filter_index < indices.len and indices[filter_index] < i) : (filter_index += 1) {}
            if (filter_index == indices.len) break;
            if (indices[filter_index] != i) continue;
        }
        if (!status.hasMarkers(flag, status.FLAG_ELIGIBLE_ATTESTER)) continue;

        const increment = effective_increments[i];
        var reward = TotalAttestationsReward{ .validator_index = i };
        const ideal = ideal_rewards[increment];
        reward.source = if (status.hasMarkers(flag, status.FLAG_PREV_SOURCE_ATTESTER_UNSLASHED))
            @intCast(ideal.source)
        else
            -@as(i64, @intCast(penalties[increment].source));
        if (status.hasMarkers(flag, status.FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
            reward.target = @intCast(ideal.target);
        } else {
            reward.target = -@as(i64, @intCast(penalties[increment].target));
            const inactivity = rewards_and_penalties.computeInactivityPenalty(increment, try inactivity_scores.get(i), inactivity_denominator);
            reward.inactivity = -@as(i64, @intCast(inactivity));
        }
        if (status.hasMarkers(flag, status.FLAG_PREV_HEAD_ATTESTER_UNSLASHED)) reward.head = @intCast(ideal.head);
        total_rewards.appendAssumeCapacity(reward);
    }

    return .{ .ideal_rewards = ideal_rewards, .total_rewards = try total_rewards.toOwnedSlice(allocator) };
}

test {
    _ = @import("attestations_rewards_test.zig");
}
