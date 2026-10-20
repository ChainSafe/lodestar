const std = @import("std");

const preset = @import("preset").preset;
const types = @import("consensus_types");

const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const EpochCache = @import("cache/epoch_cache.zig").EpochCache;

const validator = @import("./utils/validator.zig");

const Epoch = types.primitive.Epoch.Type;

/// 10% safety decay.
const SAFETY_DECAY: u64 = 10;

/// Gwei per ETH (10^9).
const ETH_TO_GWEI: u64 = 1_000_000_000;

/// Returns the epoch of the latest weak subjectivity checkpoint for the given state.
/// Default safety decay is 10% (0.1).
pub fn getLatestWeakSubjectivityCheckpointEpoch(epoch_cache: *const EpochCache) Epoch {
    return epoch_cache.epoch -| computeWeakSubjectivityPeriodCachedState(epoch_cache);
}

/// Returns the weak subjectivity period for the current state, using cached
/// values from `EpochCache` and the fork's churn limits.
pub fn computeWeakSubjectivityPeriodCachedState(epoch_cache: *const EpochCache) u64 {
    const config = epoch_cache.config;
    const fork = config.forkSeq(epoch_cache.epoch * preset.SLOTS_PER_EPOCH);

    if (fork.gte(.gloas)) {
        return computeWeakSubjectivityPeriodFromConstituentsGloas(
            epoch_cache.total_active_balance_increments,
            validator.getExitChurnLimit(epoch_cache),
            validator.getActivationBalanceChurnLimit(epoch_cache),
            validator.getConsolidationChurnLimitForFork(.gloas, epoch_cache),
            config.chain.MIN_VALIDATOR_WITHDRAWABILITY_DELAY,
        );
    }

    if (fork.gte(.electra)) {
        return computeWeakSubjectivityPeriodFromConstituentsElectra(
            epoch_cache.total_active_balance_increments,
            validator.getBalanceChurnLimitFromCache(epoch_cache),
            config.chain.MIN_VALIDATOR_WITHDRAWABILITY_DELAY,
        );
    }

    const active_validator_count = epoch_cache.current_shuffling.get().active_indices.len;
    return computeWeakSubjectivityPeriodFromConstituentsPhase0(
        active_validator_count,
        epoch_cache.total_active_balance_increments,
        validator.getChurnLimit(config, active_validator_count),
        config.chain.MIN_VALIDATOR_WITHDRAWABILITY_DELAY,
    );
}

/// Pre-Electra WS period.
///
/// Math operates on integers; intermediates fit in u128 for mainnet to avoid overflow on
/// `N * (t * (200 + 12 * D) - T * (200 + 3 * D))`.
pub fn computeWeakSubjectivityPeriodFromConstituentsPhase0(
    active_validator_count: usize,
    total_balance_by_increment: u64,
    churn_limit: usize,
    min_withdrawability_delay: u64,
) u64 {
    std.debug.assert(active_validator_count > 0);
    std.debug.assert(churn_limit > 0);

    const N: u128 = @intCast(active_validator_count);
    // NOTE: `total_balance_by_increment` is total balance measured in `EFFECTIVE_BALANCE_INCREMENT` units.
    // The formula needs t = (avg effective balance per validator) in ETH.
    // That equals total_balance_by_increment / N only because
    // EFFECTIVE_BALANCE_INCREMENT == ETH_TO_GWEI (both 1e9 Gwei) in the spec.
    // If they ever diverge, this needs scaling.
    comptime std.debug.assert(preset.EFFECTIVE_BALANCE_INCREMENT == ETH_TO_GWEI);
    const t: u128 = @divFloor(@as(u128, total_balance_by_increment), N);
    const T: u128 = preset.MAX_EFFECTIVE_BALANCE / ETH_TO_GWEI;
    const delta: u128 = @intCast(churn_limit);
    const Delta: u128 = @as(u128, preset.MAX_DEPOSITS) * preset.SLOTS_PER_EPOCH;
    const D: u128 = SAFETY_DECAY;

    var ws_period: u64 = min_withdrawability_delay;

    const lhs = T * (200 + 3 * D);
    const rhs = t * (200 + 12 * D);
    if (lhs < rhs) {
        const epochs_for_validator_set_churn: u64 = @intCast(@divFloor(
            N * (rhs - lhs),
            600 * delta * (2 * t + T),
        ));
        const epochs_for_balance_top_ups: u64 = @intCast(@divFloor(
            N * (200 + 3 * D),
            600 * Delta,
        ));
        ws_period += @max(epochs_for_validator_set_churn, epochs_for_balance_top_ups);
    } else {
        // Realistically, division by zero due to t < T will almost never happen.
        //
        // Napkin math:
        // if (big if) T = 32, t ∈ [0, 32]
        // if T - t = 0, then lhs = 32 * 230 = 7360 < rhs = 32 * 320 = 10240,
        // so we will never enter this branch.
        //
        // Still, let's assert t < T as a sanity check.
        std.debug.assert(t < T);
        ws_period += @intCast(@divFloor(
            3 * N * D * t,
            200 * Delta * (T - t),
        ));
    }

    return ws_period;
}

/// Electra and Fulu WS period.
pub fn computeWeakSubjectivityPeriodFromConstituentsElectra(
    total_balance_by_increment: u64,
    /// Not the same as `churn_limit` above — measured in Gwei, computed via `getBalanceChurnLimitFromCache`.
    balance_churn_limit: u64,
    min_withdrawability_delay: u64,
) u64 {
    std.debug.assert(balance_churn_limit > 0);

    const t: u128 = total_balance_by_increment;
    const delta: u128 = balance_churn_limit;
    const epochs_for_validator_set_churn: u64 = @intCast(@divFloor(
        SAFETY_DECAY * t * preset.EFFECTIVE_BALANCE_INCREMENT,
        2 * delta * 100,
    ));

    return min_withdrawability_delay + epochs_for_validator_set_churn;
}

fn computeWeakSubjectivityPeriodFromConstituentsGloas(
    total_balance_by_increment: u64,
    exit_churn_limit: u64,
    activation_churn_limit: u64,
    consolidation_churn_limit: u64,
    min_withdrawability_delay: u64,
) u64 {
    const t: u128 = total_balance_by_increment;
    const delta = @divFloor(2 * @as(u128, exit_churn_limit), 3) +
        @divFloor(@as(u128, activation_churn_limit), 3) +
        consolidation_churn_limit;
    std.debug.assert(delta > 0);

    const epochs_for_validator_set_churn: u64 = @intCast(@divFloor(
        SAFETY_DECAY * t * preset.EFFECTIVE_BALANCE_INCREMENT,
        2 * delta * 100,
    ));

    return min_withdrawability_delay + epochs_for_validator_set_churn;
}

test {
    _ = @import("weak_subjectivity_test.zig");
}
