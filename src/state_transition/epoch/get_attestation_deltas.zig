const std = @import("std");
const attester_status = @import("../utils/attester_status.zig");
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const preset = @import("preset").preset;
const c = @import("constants");
const BASE_REWARDS_PER_EPOCH_CONST = c.BASE_REWARDS_PER_EPOCH;
const PROPOSER_REWARD_QUOTIENT = preset.PROPOSER_REWARD_QUOTIENT;
const MIN_EPOCHS_TO_INACTIVITY_PENALTY = preset.MIN_EPOCHS_TO_INACTIVITY_PENALTY;
const BASE_REWARD_FACTOR = preset.BASE_REWARD_FACTOR;
const INACTIVITY_PENALTY_QUOTIENT = preset.INACTIVITY_PENALTY_QUOTIENT;

const FLAG_PREV_SOURCE_ATTESTER = attester_status.FLAG_PREV_SOURCE_ATTESTER;
const FLAG_PREV_TARGET_ATTESTER = attester_status.FLAG_PREV_TARGET_ATTESTER;
const FLAG_PREV_HEAD_ATTESTER = attester_status.FLAG_PREV_HEAD_ATTESTER;
const FLAG_UNSLASHED = attester_status.FLAG_UNSLASHED;
const FLAG_ELIGIBLE_ATTESTER = attester_status.FLAG_ELIGIBLE_ATTESTER;

const FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED = FLAG_PREV_SOURCE_ATTESTER | FLAG_UNSLASHED;
const FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED = FLAG_PREV_TARGET_ATTESTER | FLAG_UNSLASHED;
const FLAG_PREV_HEAD_ATTESTER_OR_UNSLASHED = FLAG_PREV_HEAD_ATTESTER | FLAG_UNSLASHED;

const hasMarkers = attester_status.hasMarkers;

const RewardPenaltyItem = struct {
    base_reward: u64,
    proposer_reward: u64,
    max_attester_reward: u64,
    source_checkpoint_reward: u64,
    target_checkpoint_reward: u64,
    head_reward: u64,
    base_penalty: u64,
    finality_delay_penalty: u64,
};

pub fn getAttestationDeltas(epoch_cache: *const EpochCache, cache: *const EpochTransitionCache, finalized_epoch: u64, rewards: []u64, penalties: []u64) !void {
    const flags = cache.flags;
    const proposer_indices = cache.proposer_indices;
    const inclusion_delays = cache.inclusion_delays;
    const validator_count = flags.len;
    if (rewards.len != validator_count) {
        return error.InvalidRewardsArrayLength;
    }
    if (penalties.len != validator_count) {
        return error.InvalidPenaltiesArrayLength;
    }
    @memset(rewards, 0);
    @memset(penalties, 0);

    const total_balance = cache.total_active_stake_by_increment;
    const total_balance_in_gwei = total_balance * preset.EFFECTIVE_BALANCE_INCREMENT;

    // increment is factored out from balance totals to avoid overflow
    const prev_epoch_source_stake_by_increment = cache.prev_epoch_unslashed_stake_source_by_increment;
    const prev_epoch_target_stake_by_increment = cache.prev_epoch_unslashed_stake_target_by_increment;
    const prev_epoch_head_stake_by_increment = cache.prev_epoch_unslashed_stake_head_by_increment;

    // sqrt first, before factoring out the increment for later usage
    const balance_sq_root: u64 = std.math.sqrt(total_balance_in_gwei);
    const finality_delay = cache.prev_epoch - finalized_epoch;

    const BASE_REWARDS_PER_EPOCH = BASE_REWARDS_PER_EPOCH_CONST;
    const proposer_reward_quotient = PROPOSER_REWARD_QUOTIENT;
    const is_in_inactivity_leak = finality_delay > MIN_EPOCHS_TO_INACTIVITY_PENALTY;

    // Phase0 only: effectiveBalance is a multiple of EFFECTIVE_BALANCE_INCREMENT and bounded by
    // MAX_EFFECTIVE_BALANCE (32 ETH), so effective_balance_increment is in range 0..32.
    // Use a fixed array for O(1) lookup instead of a HashMap.
    const max_increment = comptime preset.MAX_EFFECTIVE_BALANCE / preset.EFFECTIVE_BALANCE_INCREMENT + 1;
    var reward_penalty_item_cache: [max_increment]?RewardPenaltyItem = .{null} ** max_increment;

    const effective_balance_increments = epoch_cache.getEffectiveBalanceIncrements();
    std.debug.assert(flags.len <= effective_balance_increments.items.len);
    for (0..flags.len) |i| {
        const flag = flags[i];
        const effective_balance_increment = effective_balance_increments.items[i];
        const effective_balance: u64 = @as(u64, effective_balance_increment) * preset.EFFECTIVE_BALANCE_INCREMENT;

        const rewards_items = if (reward_penalty_item_cache[effective_balance_increment]) |ri| ri else blk: {
            const base_reward = @divFloor(@divFloor(effective_balance * BASE_REWARD_FACTOR, balance_sq_root), BASE_REWARDS_PER_EPOCH);
            const proposer_reward = @divFloor(base_reward, proposer_reward_quotient);
            const ri = RewardPenaltyItem{
                .base_reward = base_reward,
                .proposer_reward = proposer_reward,
                .max_attester_reward = base_reward - proposer_reward,
                .source_checkpoint_reward = if (is_in_inactivity_leak) base_reward else @divFloor(base_reward * prev_epoch_source_stake_by_increment, total_balance),
                .target_checkpoint_reward = if (is_in_inactivity_leak) base_reward else @divFloor(base_reward * prev_epoch_target_stake_by_increment, total_balance),
                .head_reward = if (is_in_inactivity_leak) base_reward else @divFloor(base_reward * prev_epoch_head_stake_by_increment, total_balance),
                .base_penalty = base_reward * BASE_REWARDS_PER_EPOCH_CONST - proposer_reward,
                .finality_delay_penalty = @divFloor((effective_balance * finality_delay), INACTIVITY_PENALTY_QUOTIENT),
            };
            reward_penalty_item_cache[effective_balance_increment] = ri;
            break :blk ri;
        };

        const base_reward = rewards_items.base_reward;
        const proposer_reward = rewards_items.proposer_reward;
        const max_attester_reward = rewards_items.max_attester_reward;
        const source_checkpoint_reward = rewards_items.source_checkpoint_reward;
        const target_checkpoint_reward = rewards_items.target_checkpoint_reward;
        const head_reward = rewards_items.head_reward;
        const base_penalty = rewards_items.base_penalty;
        const finality_delay_penalty = rewards_items.finality_delay_penalty;

        // inclusion speed bonus
        if (hasMarkers(flag, FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED)) {
            rewards[proposer_indices[i]] += proposer_reward;
            rewards[i] += @divFloor(max_attester_reward, inclusion_delays[i]);
        }

        if (hasMarkers(flag, FLAG_ELIGIBLE_ATTESTER)) {
            // expected FFG source
            if (hasMarkers(flag, FLAG_PREV_SOURCE_ATTESTER_OR_UNSLASHED)) {
                // justification-participation reward
                rewards[i] += source_checkpoint_reward;
            } else {
                // justification-non-participation R-penalty
                penalties[i] += base_reward;
            }

            // expected FFG target
            if (hasMarkers(flag, FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED)) {
                // boundary-attestation reward
                rewards[i] += target_checkpoint_reward;
            } else {
                // boundary-attestation-non-participation R-penalty
                penalties[i] += base_reward;
            }
            // expected head
            if (hasMarkers(flag, FLAG_PREV_HEAD_ATTESTER_OR_UNSLASHED)) {
                // canonical-participation reward
                rewards[i] += head_reward;
            } else {
                // canonical-participation R-penalty
                penalties[i] += base_reward;
            }

            // take away max rewards if we're not finalizing
            if (is_in_inactivity_leak) {
                penalties[i] += base_penalty;

                if (!hasMarkers(flag, FLAG_PREV_TARGET_ATTESTER_OR_UNSLASHED)) {
                    penalties[i] += finality_delay_penalty;
                }
            }
        }
    }
}
