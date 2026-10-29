const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const attester_status = @import("../utils/attester_status.zig");
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const preset = @import("preset").preset;
const c = @import("constants");

const EFFECTIVE_BALANCE_INCREMENT = preset.EFFECTIVE_BALANCE_INCREMENT;
const INACTIVITY_PENALTY_QUOTIENT_ALTAIR = preset.INACTIVITY_PENALTY_QUOTIENT_ALTAIR;
const INACTIVITY_PENALTY_QUOTIENT_BELLATRIX = preset.INACTIVITY_PENALTY_QUOTIENT_BELLATRIX;
const PARTICIPATION_FLAG_WEIGHTS = c.PARTICIPATION_FLAG_WEIGHTS;
const TIMELY_HEAD_FLAG_INDEX = c.TIMELY_HEAD_FLAG_INDEX;
const TIMELY_SOURCE_FLAG_INDEX = c.TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET_FLAG_INDEX = c.TIMELY_TARGET_FLAG_INDEX;
const WEIGHT_DENOMINATOR = c.WEIGHT_DENOMINATOR;

const FLAG_ELIGIBLE_ATTESTER = attester_status.FLAG_ELIGIBLE_ATTESTER;
const FLAG_PREV_HEAD_ATTESTER_UNSLASHED = attester_status.FLAG_PREV_HEAD_ATTESTER_UNSLASHED;
const FLAG_PREV_SOURCE_ATTESTER_UNSLASHED = attester_status.FLAG_PREV_SOURCE_ATTESTER_UNSLASHED;
const FLAG_PREV_TARGET_ATTESTER_UNSLASHED = attester_status.FLAG_PREV_TARGET_ATTESTER_UNSLASHED;
const hasMarkers = attester_status.hasMarkers;

const isInInactivityLeak = @import("inactivity_leak.zig").isInInactivityLeak;

const RewardPenaltyItem = struct {
    base_reward: u64,
    timely_source_reward: u64,
    timely_source_penalty: u64,
    timely_target_reward: u64,
    timely_target_penalty: u64,
    timely_head_reward: u64,
};

pub fn computeRewardPenaltyItem(cache: *const EpochTransitionCache, effective_balance_increment: u64) RewardPenaltyItem {
    const base_reward = effective_balance_increment * cache.base_reward_per_increment;
    const ts_weigh = PARTICIPATION_FLAG_WEIGHTS[TIMELY_SOURCE_FLAG_INDEX];
    const tt_weigh = PARTICIPATION_FLAG_WEIGHTS[TIMELY_TARGET_FLAG_INDEX];
    const th_weigh = PARTICIPATION_FLAG_WEIGHTS[TIMELY_HEAD_FLAG_INDEX];
    const ts_reward_numerator = base_reward * ts_weigh * cache.prev_epoch_unslashed_stake_source_by_increment;
    const tt_reward_numerator = base_reward * tt_weigh * cache.prev_epoch_unslashed_stake_target_by_increment;
    const th_reward_numerator = base_reward * th_weigh * cache.prev_epoch_unslashed_stake_head_by_increment;
    const denominator = cache.total_active_stake_by_increment * WEIGHT_DENOMINATOR;
    return .{
        .base_reward = base_reward,
        .timely_source_reward = @divFloor(ts_reward_numerator, denominator),
        .timely_target_reward = @divFloor(tt_reward_numerator, denominator),
        .timely_head_reward = @divFloor(th_reward_numerator, denominator),
        .timely_source_penalty = @divFloor(base_reward * ts_weigh, WEIGHT_DENOMINATOR),
        .timely_target_penalty = @divFloor(base_reward * tt_weigh, WEIGHT_DENOMINATOR),
    };
}

pub fn inactivityPenaltyDenominator(config: *const BeaconConfig, fork: ForkSeq) u64 {
    const quotient: u64 = if (fork == .altair) INACTIVITY_PENALTY_QUOTIENT_ALTAIR else INACTIVITY_PENALTY_QUOTIENT_BELLATRIX;
    return config.chain.INACTIVITY_SCORE_BIAS * quotient;
}

pub fn computeInactivityPenalty(effective_balance_increment: u64, inactivity_score: u64, denominator: u64) u64 {
    return @divFloor(effective_balance_increment * EFFECTIVE_BALANCE_INCREMENT * inactivity_score, denominator);
}

/// consumer should deinit `rewards` and `penalties` arrays
pub fn getRewardsAndPenaltiesAltair(
    comptime fork: ForkSeq,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    cache: *const EpochTransitionCache,
    rewards: []u64,
    penalties: []u64,
) !void {
    const validator_count = try state.validatorsCount();
    if (rewards.len != validator_count or penalties.len != validator_count) {
        return error.InvalidArrayLength;
    }
    @memset(rewards, 0);
    @memset(penalties, 0);

    const is_in_inactivity_leak = isInInactivityLeak(epoch_cache.epoch, try state.finalizedEpoch());
    // effectiveBalance is a multiple of EFFECTIVE_BALANCE_INCREMENT and bounded by max effective balance
    // (32 ETH pre-Electra, 2048 ETH post-Electra). Use a fixed array for O(1) lookup.
    const max_effective = comptime if (fork.gte(.electra)) preset.MAX_EFFECTIVE_BALANCE_ELECTRA else preset.MAX_EFFECTIVE_BALANCE;
    const max_increment = comptime max_effective / EFFECTIVE_BALANCE_INCREMENT + 1;
    var reward_penalty_item_cache: [max_increment]?RewardPenaltyItem = .{null} ** max_increment;

    const penalty_denominator = inactivityPenaltyDenominator(config, fork);

    const flags = cache.flags;
    const effective_balance_increments = epoch_cache.getEffectiveBalanceIncrements().items;
    var inactivity_scores = try state.inactivityScores();
    for (flags, 0..) |flag, i| {
        if (!hasMarkers(flag, FLAG_ELIGIBLE_ATTESTER)) {
            continue;
        }

        const effective_balance_increment = effective_balance_increments[i];

        const reward_penalty_item = if (reward_penalty_item_cache[effective_balance_increment]) |rpi| rpi else blk: {
            const rpi = computeRewardPenaltyItem(cache, effective_balance_increment);
            reward_penalty_item_cache[effective_balance_increment] = rpi;
            break :blk rpi;
        };

        const timely_source_reward = reward_penalty_item.timely_source_reward;
        const timely_source_penalty = reward_penalty_item.timely_source_penalty;
        const timely_target_reward = reward_penalty_item.timely_target_reward;
        const timely_target_penalty = reward_penalty_item.timely_target_penalty;
        const timely_head_reward = reward_penalty_item.timely_head_reward;

        // same logic to getFlagIndexDeltas
        if (hasMarkers(flag, FLAG_PREV_SOURCE_ATTESTER_UNSLASHED)) {
            if (is_in_inactivity_leak) {} else {
                rewards[i] += timely_source_reward;
            }
        } else {
            penalties[i] += timely_source_penalty;
        }

        if (hasMarkers(flag, FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
            if (is_in_inactivity_leak) {} else {
                rewards[i] += timely_target_reward;
            }
        } else {
            penalties[i] += timely_target_penalty;
        }

        if (hasMarkers(flag, FLAG_PREV_HEAD_ATTESTER_UNSLASHED) and !is_in_inactivity_leak) {
            rewards[i] += timely_head_reward;
        }

        // Same logic to getInactivityPenaltyDeltas
        // TODO: if we have limited value in inactivityScores we can provide a cache too
        if (!hasMarkers(flag, FLAG_PREV_TARGET_ATTESTER_UNSLASHED)) {
            penalties[i] += computeInactivityPenalty(effective_balance_increment, try inactivity_scores.get(i), penalty_denominator);
        }
    }
}
