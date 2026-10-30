const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const ct = @import("consensus_types");
const preset = @import("preset").preset;
const c = @import("constants");
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const WithdrawalsResult = @import("process_withdrawals.zig").WithdrawalsResult;
const gloas = @import("../utils/gloas.zig");
const decreaseBalance = @import("../utils/balance.zig").decreaseBalance;
const hasExecutionWithdrawalCredential = @import("../utils/electra.zig").hasExecutionWithdrawalCredential;
const getMaxEffectiveBalance = @import("../utils/validator.zig").getMaxEffectiveBalance;

/// At most MAX_WITHDRAWALS_PER_PAYLOAD balances change during a sweep.
const WithdrawnBalances = struct {
    indices: [preset.MAX_WITHDRAWALS_PER_PAYLOAD]u64 = undefined,
    amounts: [preset.MAX_WITHDRAWALS_PER_PAYLOAD]u64 = undefined,
    len: usize = 0,

    fn get(self: *const WithdrawnBalances, index: u64) u64 {
        for (self.indices[0..self.len], self.amounts[0..self.len]) |i, amount| {
            if (i == index) return amount;
        }
        return 0;
    }

    fn add(self: *WithdrawnBalances, index: u64, amount: u64) !void {
        for (self.indices[0..self.len], self.amounts[0..self.len]) |i, *total| {
            if (i == index) {
                total.* = try std.math.add(u64, total.*, amount);
                return;
            }
        }
        std.debug.assert(self.len < self.indices.len);
        self.indices[self.len] = index;
        self.amounts[self.len] = amount;
        self.len += 1;
    }
};

pub fn getExpectedWithdrawals(comptime fork: ForkSeq, epoch_cache: *const EpochCache, state: *BeaconState(fork), out: *WithdrawalsResult) !void {
    std.debug.assert(out.withdrawals.capacity == preset.MAX_WITHDRAWALS_PER_PAYLOAD);
    std.debug.assert(out.withdrawals.items.len == 0);
    const epoch = epoch_cache.epoch;
    var next_index = try state.nextWithdrawalIndex();
    var builders = try state.inner.getReadonly("builders");
    var builder_withdrawn: WithdrawnBalances = .{};
    var validator_withdrawn: WithdrawnBalances = .{};
    var pending_builders = try state.inner.getReadonly("builder_pending_withdrawals");
    try pending_builders.commit();
    const pending_builders_len = try pending_builders.length();
    var pending_builder_it = pending_builders.iteratorReadonly(0);
    for (0..@min(pending_builders_len, preset.MAX_WITHDRAWALS_PER_PAYLOAD - 1)) |_| {
        const withdrawal = try pending_builder_it.nextValue();
        out.withdrawals.appendAssumeCapacity(.{
            .index = next_index,
            .validator_index = gloas.convertBuilderIndexToValidatorIndex(withdrawal.builder_index),
            .address = withdrawal.fee_recipient,
            .amount = withdrawal.amount,
        });
        next_index += 1;
        try builder_withdrawn.add(withdrawal.builder_index, withdrawal.amount);
        out.processed_builder_withdrawals_count += 1;
    }

    var validators = try state.validators();
    var balances = try state.balances();
    var partials = try state.pendingPartialWithdrawals();
    try partials.commit();
    const partials_len = try partials.length();
    var partial_it = partials.iteratorReadonly(0);
    const partial_bound = @min(out.withdrawals.items.len + preset.MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP, preset.MAX_WITHDRAWALS_PER_PAYLOAD - 1);
    for (0..partials_len) |_| {
        if (out.withdrawals.items.len >= partial_bound) break;
        const partial = try partial_it.nextValue();
        if (partial.withdrawable_epoch > epoch) break;
        var validator: ct.phase0.Validator.Type = undefined;
        try validators.getValue(undefined, partial.validator_index, &validator);
        const balance = (try balances.get(partial.validator_index)) -| validator_withdrawn.get(partial.validator_index);
        if (validator.exit_epoch == c.FAR_FUTURE_EPOCH and validator.effective_balance >= preset.MIN_ACTIVATION_BALANCE and balance > preset.MIN_ACTIVATION_BALANCE) {
            const amount = @min(balance - preset.MIN_ACTIVATION_BALANCE, partial.amount);
            out.withdrawals.appendAssumeCapacity(.{
                .index = next_index,
                .validator_index = partial.validator_index,
                .address = validator.withdrawal_credentials[12..32].*,
                .amount = amount,
            });
            next_index += 1;
            try validator_withdrawn.add(partial.validator_index, amount);
        }
        out.processed_partial_withdrawals_count += 1;
    }

    const builder_count = try builders.length();
    const next_builder = try state.inner.get("next_withdrawal_builder_index");
    for (0..@min(builder_count, preset.MAX_BUILDERS_PER_WITHDRAWALS_SWEEP)) |n| {
        if (out.withdrawals.items.len >= preset.MAX_WITHDRAWALS_PER_PAYLOAD - 1) break;
        if (next_builder >= builder_count) return error.InvalidNextWithdrawalBuilderIndex;
        const index = (next_builder + n) % builder_count;
        var builder: ForkTypes(fork).Builder.Type = undefined;
        try builders.getValue(undefined, index, &builder);
        const balance = builder.balance -| builder_withdrawn.get(index);
        if (builder.withdrawable_epoch <= epoch and balance > 0) {
            out.withdrawals.appendAssumeCapacity(.{
                .index = next_index,
                .validator_index = gloas.convertBuilderIndexToValidatorIndex(index),
                .address = builder.execution_address,
                .amount = balance,
            });
            next_index += 1;
        }
        out.processed_builders_sweep_count += 1;
    }

    const validator_count = try validators.length();
    const next_validator = try state.nextWithdrawalValidatorIndex();
    if (next_validator >= validator_count) return error.InvalidNextWithdrawalValidatorIndex;
    for (0..@min(validator_count, preset.MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP)) |n| {
        if (out.withdrawals.items.len == preset.MAX_WITHDRAWALS_PER_PAYLOAD) break;
        const index = (next_validator + n) % validator_count;
        var validator: ct.phase0.Validator.Type = undefined;
        try validators.getValue(undefined, index, &validator);
        const balance = (try balances.get(index)) -| validator_withdrawn.get(index);
        out.sampled_validators += 1;
        if (balance == 0 or !hasExecutionWithdrawalCredential(&validator.withdrawal_credentials)) continue;
        const max_balance = getMaxEffectiveBalance(&validator.withdrawal_credentials);
        const amount = if (validator.withdrawable_epoch <= epoch)
            balance
        else if (validator.effective_balance == max_balance and balance > max_balance)
            balance - max_balance
        else
            continue;
        out.withdrawals.appendAssumeCapacity(.{
            .index = next_index,
            .validator_index = index,
            .address = validator.withdrawal_credentials[12..32].*,
            .amount = amount,
        });
        next_index += 1;
    }
}

pub fn processWithdrawals(comptime fork: ForkSeq, state: *BeaconState(fork), result: *const WithdrawalsResult) !void {
    if (!try gloas.isParentBlockFull(fork, state)) return;
    for (result.withdrawals.items) |withdrawal| {
        if (gloas.isBuilderIndex(withdrawal.validator_index)) {
            var builders = try state.inner.get("builders");
            const index = gloas.convertValidatorIndexToBuilderIndex(withdrawal.validator_index);
            var builder: ForkTypes(fork).Builder.Type = undefined;
            try builders.getValue(undefined, index, &builder);
            builder.balance -|= withdrawal.amount;
            try builders.setValue(index, &builder);
        } else try decreaseBalance(fork, state, withdrawal.validator_index, withdrawal.amount);
    }
    if (result.processed_partial_withdrawals_count > 0) {
        var partials = try state.pendingPartialWithdrawals();
        const remaining = try partials.sliceFrom(result.processed_partial_withdrawals_count);
        errdefer remaining.deinit();
        try state.setPendingPartialWithdrawals(remaining);
    }
    try state.inner.setValue("payload_expected_withdrawals", &result.withdrawals);
    if (result.processed_builder_withdrawals_count > 0) {
        var pending = try state.inner.get("builder_pending_withdrawals");
        const remaining = try pending.sliceFrom(result.processed_builder_withdrawals_count);
        errdefer remaining.deinit();
        try state.inner.set("builder_pending_withdrawals", remaining);
    }
    var builders = try state.inner.getReadonly("builders");
    const builder_count = try builders.length();
    if (builder_count > 0) {
        const next = try state.inner.get("next_withdrawal_builder_index");
        try state.inner.set("next_withdrawal_builder_index", (next + result.processed_builders_sweep_count) % builder_count);
    }
    const items = result.withdrawals.items;
    if (items.len > 0) try state.setNextWithdrawalIndex(items[items.len - 1].index + 1);
    const validator_count = try state.validatorsCount();
    if (validator_count == 0) return error.InvalidNextWithdrawalValidatorIndex;
    const next_validator = if (items.len == preset.MAX_WITHDRAWALS_PER_PAYLOAD)
        items[items.len - 1].validator_index + 1
    else
        (try state.nextWithdrawalValidatorIndex()) + preset.MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP;
    try state.setNextWithdrawalValidatorIndex(next_validator % validator_count);
}
