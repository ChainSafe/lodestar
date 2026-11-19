const types = @import("consensus_types");
const preset = @import("preset").preset;
const Validator = types.phase0.Validator;

const Epoch = types.primitive.Epoch.Type;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const BeaconState = @import("fork_types").BeaconState;
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const WithdrawalCredentials = types.primitive.Root.Type;
const hasCompoundingWithdrawalCredential = @import("./electra.zig").hasCompoundingWithdrawalCredential;

pub fn isActiveValidator(validator: *const Validator.Type, epoch: Epoch) bool {
    return validator.activation_epoch <= epoch and epoch < validator.exit_epoch;
}

pub fn isActiveValidatorView(validator: *Validator.TreeView, epoch: Epoch) !bool {
    const activation_epoch: Epoch = @intCast(try validator.get("activation_epoch"));
    const exit_epoch: Epoch = @intCast(try validator.get("exit_epoch"));
    return activation_epoch <= epoch and epoch < exit_epoch;
}

pub fn isSlashableValidator(validator: *const Validator.Type, epoch: Epoch) bool {
    return !validator.slashed and validator.activation_epoch <= epoch and epoch < validator.withdrawable_epoch;
}

pub fn getActivationChurnLimit(config: *const BeaconConfig, fork: ForkSeq, active_validator_count: usize) usize {
    if (fork.gte(.deneb)) {
        return @min(config.chain.MAX_PER_EPOCH_ACTIVATION_CHURN_LIMIT, getChurnLimit(config, active_validator_count));
    }

    return getChurnLimit(config, active_validator_count);
}

pub fn getChurnLimit(config: *const BeaconConfig, active_validator_count: usize) usize {
    return @max(config.chain.MIN_PER_EPOCH_CHURN_LIMIT, @divFloor(active_validator_count, config.chain.CHURN_LIMIT_QUOTIENT));
}

pub fn getBalanceChurnLimit(total_active_balance_increments: u64, churn_limit_quotient: u64, min_per_epoch_churn_limit: u64) u64 {
    const churn_limit_by_total_active_balance = (total_active_balance_increments / churn_limit_quotient) * preset.EFFECTIVE_BALANCE_INCREMENT;

    const churn = @max(churn_limit_by_total_active_balance, min_per_epoch_churn_limit);

    return churn - (churn % preset.EFFECTIVE_BALANCE_INCREMENT);
}

pub fn getBalanceChurnLimitFromCache(epoch_cache: *const EpochCache) u64 {
    return getBalanceChurnLimit(epoch_cache.total_active_balance_increments, epoch_cache.config.chain.CHURN_LIMIT_QUOTIENT, epoch_cache.config.chain.MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA);
}

pub fn getActivationExitChurnLimit(epoch_cache: *const EpochCache) u64 {
    return @min(epoch_cache.config.chain.MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT, getBalanceChurnLimitFromCache(epoch_cache));
}

pub fn getActivationBalanceChurnLimit(epoch_cache: *const EpochCache) u64 {
    return @min(epoch_cache.config.chain.MAX_PER_EPOCH_ACTIVATION_CHURN_LIMIT_GLOAS, getExitChurnLimit(epoch_cache));
}

pub fn getExitChurnLimit(epoch_cache: *const EpochCache) u64 {
    return getBalanceChurnLimit(epoch_cache.total_active_balance_increments, epoch_cache.config.chain.CHURN_LIMIT_QUOTIENT_GLOAS, epoch_cache.config.chain.MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA);
}

pub fn getConsolidationChurnLimitForFork(comptime fork: ForkSeq, epoch_cache: *const EpochCache) u64 {
    if (fork.gte(.gloas)) return getBalanceChurnLimit(epoch_cache.total_active_balance_increments, epoch_cache.config.chain.CONSOLIDATION_CHURN_LIMIT_QUOTIENT, 0);
    return getConsolidationChurnLimit(epoch_cache);
}

pub fn getConsolidationChurnLimit(epoch_cache: *const EpochCache) u64 {
    return getBalanceChurnLimitFromCache(epoch_cache) - getActivationExitChurnLimit(epoch_cache);
}

pub fn getMaxEffectiveBalance(withdrawal_credentials: *const WithdrawalCredentials) u64 {
    // Compounding withdrawal credential only available since Electra
    if (hasCompoundingWithdrawalCredential(withdrawal_credentials)) {
        return preset.MAX_EFFECTIVE_BALANCE_ELECTRA;
    }
    return preset.MIN_ACTIVATION_BALANCE;
}

pub fn getPendingBalanceToWithdraw(comptime fork: ForkSeq, state: *BeaconState(fork), validator_index: ValidatorIndex) !u64 {
    var total: u64 = 0;

    var pending_partial_withdrawals = try state.pendingPartialWithdrawals();
    const len = try pending_partial_withdrawals.length();
    for (0..len) |i| {
        var pending_partial_withdrawal = try pending_partial_withdrawals.get(i);
        const idx = try pending_partial_withdrawal.get("validator_index");
        if (idx == validator_index) {
            total += try pending_partial_withdrawal.get("amount");
        }
    }
    return total;
}

test {
    _ = @import("validator_test.zig");
}
