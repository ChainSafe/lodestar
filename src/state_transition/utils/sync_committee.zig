const std = @import("std");
const Allocator = std.mem.Allocator;
const BeaconState = @import("fork_types").BeaconState;
const EffectiveBalanceIncrements = @import("../cache/effective_balance_increments.zig").EffectiveBalanceIncrements;
const PubkeyCache = @import("../cache/pubkey_cache.zig").PubkeyCache;
const types = @import("consensus_types");
const preset = @import("preset").preset;
const c = @import("constants");
const SyncCommittee = types.altair.SyncCommittee.Type;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const ForkSeq = @import("config").ForkSeq;

pub const getNextSyncCommitteeIndices = @import("./seed.zig").getNextSyncCommitteeIndices;

pub const SyncCommitteeInfo = struct {
    indices: [preset.SYNC_COMMITTEE_SIZE]ValidatorIndex,
    sync_committee: SyncCommittee,
};

/// `pubkey_cache` must hold every validator in `active_validator_indices`. A missing member
/// returns `error.PubkeyNotFound`.
pub fn getNextSyncCommittee(
    comptime fork: ForkSeq,
    allocator: Allocator,
    io: std.Io,
    pubkey_cache: *const PubkeyCache,
    state: *BeaconState(fork),
    active_validator_indices: []const u32,
    effective_balance_increments: EffectiveBalanceIncrements,
    out: *SyncCommitteeInfo,
) !void {
    const indices = &out.indices;
    try getNextSyncCommitteeIndices(fork, allocator, state, active_validator_indices, effective_balance_increments, indices);

    for (indices, &out.sync_committee.pubkeys) |index, *pubkey| {
        pubkey.* = pubkey_cache.getPubkeyBytes(io, index) orelse return error.PubkeyNotFound;
    }

    const aggregate_pubkey = pubkey_cache.aggregate(io, indices) catch |err| switch (err) {
        error.InvalidIndex => return error.PubkeyNotFound,
        else => return err,
    };
    out.sync_committee.aggregate_pubkey = aggregate_pubkey.compress();
}

pub fn computeSyncParticipantReward(total_active_balance_increments: u64) u64 {
    const total_active_balance = total_active_balance_increments * preset.EFFECTIVE_BALANCE_INCREMENT;
    const base_reward_per_increment = @divFloor((preset.EFFECTIVE_BALANCE_INCREMENT * preset.BASE_REWARD_FACTOR), @as(u64, std.math.sqrt(total_active_balance)));
    const total_base_rewards = base_reward_per_increment * total_active_balance_increments;
    const max_participant_rewards = @divFloor(@divFloor(total_base_rewards * c.SYNC_REWARD_WEIGHT, c.WEIGHT_DENOMINATOR), preset.SLOTS_PER_EPOCH);
    return @divFloor(max_participant_rewards, preset.SYNC_COMMITTEE_SIZE);
}

pub fn computeBaseRewardPerIncrement(total_active_stake_by_increment: u64) u64 {
    const total_active_stake_sqrt = @as(u64, std.math.sqrt(total_active_stake_by_increment * preset.EFFECTIVE_BALANCE_INCREMENT));
    return @divFloor((preset.EFFECTIVE_BALANCE_INCREMENT * preset.BASE_REWARD_FACTOR), total_active_stake_sqrt);
}

test {
    _ = @import("sync_committee_test.zig");
}
