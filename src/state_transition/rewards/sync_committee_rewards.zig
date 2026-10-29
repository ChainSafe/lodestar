const std = @import("std");
const types = @import("consensus_types");
const preset = @import("preset").preset;
const CachedBeaconState = @import("../cache/state_cache.zig").CachedBeaconState;

pub const SyncCommitteeReward = struct {
    validator_index: types.primitive.ValidatorIndex.Type,
    reward: i64,
};

/// Returns caller-owned participant rewards; proposer rewards are excluded.
pub fn computeSyncCommitteeRewards(
    allocator: std.mem.Allocator,
    pre_state: *const CachedBeaconState,
    sync_aggregate: *const types.altair.SyncAggregate.Type,
) ![]SyncCommitteeReward {
    if (pre_state.state.forkSeq() == .phase0) return error.SyncCommitteeRewardsUnsupportedFork;

    const committee = pre_state.epoch_cache.current_sync_committee_indexed.get();
    const indices = try committee.getValidatorIndices();
    std.debug.assert(indices.len == preset.SYNC_COMMITTEE_SIZE);
    const positions_by_validator = try committee.getValidatorIndexMap();
    const participant_reward: i64 = @intCast(pre_state.epoch_cache.sync_participant_reward);
    var rewards: [preset.SYNC_COMMITTEE_SIZE]SyncCommitteeReward = undefined;
    var rewards_len: usize = 0;

    for (indices, 0..) |validator_index, i| {
        const positions = positions_by_validator.get(validator_index).?.items;
        if (positions[0] != i) continue;

        // A validator may occupy multiple positions, each with its own participation bit.
        var reward: i64 = 0;
        for (positions) |position| {
            reward += if (try sync_aggregate.sync_committee_bits.get(position))
                participant_reward
            else
                -participant_reward;
        }
        rewards[rewards_len] = .{ .validator_index = validator_index, .reward = reward };
        rewards_len += 1;
    }

    return allocator.dupe(SyncCommitteeReward, rewards[0..rewards_len]);
}

test {
    _ = @import("sync_committee_rewards_test.zig");
}
