const std = @import("std");
const diagnostics = @import("../diagnostics.zig");
const Allocator = std.mem.Allocator;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const BeaconState = @import("fork_types").BeaconState;
const types = @import("consensus_types");
const Root = types.primitive.Root.Type;
const preset = @import("preset").preset;
const c = @import("constants");
const ForkSeq = @import("config").ForkSeq;
const Withdrawals = types.capella.Withdrawals.Type;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;
const ExecutionAddress = types.primitive.ExecutionAddress.Type;
const hasExecutionWithdrawalCredential = @import("../utils/electra.zig").hasExecutionWithdrawalCredential;
const hasEth1WithdrawalCredential = @import("../utils/capella.zig").hasEth1WithdrawalCredential;
const getMaxEffectiveBalance = @import("../utils/validator.zig").getMaxEffectiveBalance;
const decreaseBalance = @import("../utils/balance.zig").decreaseBalance;
const Node = @import("persistent_merkle_tree").Node;
const gloas_withdrawals = @import("process_withdrawals_gloas.zig");

pub const WithdrawalsResult = struct {
    withdrawals: Withdrawals,
    sampled_validators: usize = 0,
    processed_partial_withdrawals_count: usize = 0,
    processed_builder_withdrawals_count: usize = 0,
    processed_builders_sweep_count: usize = 0,
};

/// right now for the implementation we pass in processBlock()
/// for the spec, we pass in params from operations.zig
/// TODO: spec and implementation should be the same
/// refer to https://github.com/ethereum/consensus-specs/blob/dev/specs/electra/beacon-chain.md#modified-process_withdrawals
pub fn processWithdrawals(
    comptime fork: ForkSeq,
    allocator: Allocator,
    state: *BeaconState(fork),
    expected_withdrawals_result: WithdrawalsResult,
    payload_withdrawals_root: Root,
    diag: ?*diagnostics.Diagnostics,
) !void {
    if (comptime fork.gte(.gloas)) return gloas_withdrawals.processWithdrawals(fork, state, &expected_withdrawals_result);

    // processedPartialWithdrawalsCount is withdrawals coming from EL since electra (EIP-7002)
    const processed_partial_withdrawals_count = expected_withdrawals_result.processed_partial_withdrawals_count;
    const expected_withdrawals = expected_withdrawals_result.withdrawals.items;
    const num_withdrawals = expected_withdrawals.len;

    var expected_withdrawals_root: [32]u8 = undefined;
    try types.capella.Withdrawals.hashTreeRoot(allocator, &expected_withdrawals_result.withdrawals, &expected_withdrawals_root);

    if (!std.mem.eql(u8, &expected_withdrawals_root, &payload_withdrawals_root)) {
        return diagnostics.withdrawalsRootMismatch(
            diag,
            &expected_withdrawals_root,
            &payload_withdrawals_root,
        );
    }

    for (0..num_withdrawals) |i| {
        const withdrawal = expected_withdrawals[i];
        try decreaseBalance(fork, state, withdrawal.validator_index, withdrawal.amount);
    }

    if (comptime fork.gte(.electra)) {
        if (processed_partial_withdrawals_count > 0) {
            var pending_partial_withdrawals = try state.pendingPartialWithdrawals();
            const truncated = try pending_partial_withdrawals.sliceFrom(processed_partial_withdrawals_count);

            try state.setPendingPartialWithdrawals(truncated);
        }
    }

    // Update the nextWithdrawalIndex
    if (expected_withdrawals.len > 0) {
        const latest_withdrawal = expected_withdrawals[expected_withdrawals.len - 1];
        try state.setNextWithdrawalIndex(latest_withdrawal.index + 1);
    }

    // Update the next_withdrawal_validator_index
    const validators_len: u64 = @intCast(try state.validatorsCount());
    const next_withdrawal_validator_index = try state.nextWithdrawalValidatorIndex();
    if (expected_withdrawals.len == preset.MAX_WITHDRAWALS_PER_PAYLOAD) {
        // All slots filled, next_withdrawal_validator_index should be validatorIndex having next turn
        try state.setNextWithdrawalValidatorIndex(
            (expected_withdrawals[expected_withdrawals.len - 1].validator_index + 1) % validators_len,
        );
    } else {
        // expected withdrawals came up short in the bound, so we move next_withdrawal_validator_index to
        // the next post the bound
        try state.setNextWithdrawalValidatorIndex(
            (next_withdrawal_validator_index + preset.MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP) % validators_len,
        );
    }
}

/// Called by the block proposer to find a list of withdrawals to include in the block.
///
/// This list is assumed to be bounded by `preset.MAX_WITHDRAWALS_PER_PAYLOAD`.
///
/// Caller should deinit `withdrawal_balances` with .deinit() after use.
pub fn getExpectedWithdrawals(
    comptime fork: ForkSeq,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    withdrawals_result: *WithdrawalsResult,
    withdrawal_balances: *std.AutoHashMap(ValidatorIndex, usize),
) !void {
    if (comptime fork.gte(.gloas)) return gloas_withdrawals.getExpectedWithdrawals(fork, epoch_cache, state, withdrawals_result);

    std.debug.assert(withdrawals_result.withdrawals.capacity == preset.MAX_WITHDRAWALS_PER_PAYLOAD);
    if (comptime fork.lt(.capella)) return error.InvalidForkSequence;

    const epoch = epoch_cache.epoch;
    var withdrawal_index = try state.nextWithdrawalIndex();
    var validators = try state.validators();
    var balances = try state.balances();
    const next_withdrawal_validator_index = try state.nextWithdrawalValidatorIndex();

    // partial_withdrawals_count is withdrawals coming from EL since electra (EIP-7002)
    var processed_partial_withdrawals_count: u64 = 0;

    if (comptime fork.gte(.electra)) {
        // MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP = 8, PENDING_PARTIAL_WITHDRAWALS_LIMIT: 134217728 so we should just lazily iterate thru state.pending_partial_withdrawals.
        // pending_partial_withdrawals comes from EIP-7002 smart contract where it takes fee so it's more likely than not validator is in correct condition to withdraw
        // also we may break early if withdrawableEpoch > epoch
        var pending_partial_withdrawals = try state.pendingPartialWithdrawals();
        var pending_partial_withdrawals_it = pending_partial_withdrawals.iteratorReadonly(0);
        const pending_partial_withdrawals_len = try pending_partial_withdrawals.length();

        for (0..pending_partial_withdrawals_len) |_| {
            const withdrawal = try pending_partial_withdrawals_it.nextValue();
            if (withdrawal.withdrawable_epoch > epoch or withdrawals_result.withdrawals.items.len == preset.MAX_PENDING_PARTIALS_PER_WITHDRAWALS_SWEEP) {
                break;
            }

            var validator: types.phase0.Validator.Type = undefined;
            try validators.getValue(undefined, withdrawal.validator_index, &validator);

            const total_withdrawn: u64 = @intCast(withdrawal_balances.get(withdrawal.validator_index) orelse 0);
            const balance = try balances.get(withdrawal.validator_index) - total_withdrawn;

            if (validator.exit_epoch == c.FAR_FUTURE_EPOCH and
                validator.effective_balance >= preset.MIN_ACTIVATION_BALANCE and
                balance > preset.MIN_ACTIVATION_BALANCE)
            {
                const balance_over_min_activation_balance = balance - preset.MIN_ACTIVATION_BALANCE;
                const withdrawable_balance = if (balance_over_min_activation_balance < withdrawal.amount) balance_over_min_activation_balance else withdrawal.amount;
                var execution_address: ExecutionAddress = undefined;
                @memcpy(&execution_address, validator.withdrawal_credentials[12..]);
                withdrawals_result.withdrawals.appendAssumeCapacity(.{
                    .index = withdrawal_index,
                    .validator_index = withdrawal.validator_index,
                    .address = execution_address,
                    .amount = withdrawable_balance,
                });
                withdrawal_index += 1;
                try withdrawal_balances.put(withdrawal.validator_index, total_withdrawn + withdrawable_balance);
            }
            processed_partial_withdrawals_count += 1;
        }
    }

    const validators_count = try validators.length();
    const bound = @min(validators_count, preset.MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP);
    // Just run a bounded loop max iterating over all withdrawals
    // however breaks out once we have MAX_WITHDRAWALS_PER_PAYLOAD
    var n: usize = 0;
    while (n < bound) {
        // Get next validator in turn
        const validator_index = (next_withdrawal_validator_index + n) % validators_count;
        n += 1;
        var validator = try validators.getReadonly(validator_index);
        const withdraw_balance: u64 = @intCast(withdrawal_balances.get(validator_index) orelse 0);
        const val_balance = try balances.get(validator_index);
        const balance = if (comptime fork.gte(.electra))
            // Deduct partially withdrawn balance already queued above
            if (val_balance > withdraw_balance) val_balance - withdraw_balance else 0
        else
            val_balance;

        const withdrawable_epoch = try validator.get("withdrawable_epoch");
        const withdrawal_credentials = try validator.getFieldRoot("withdrawal_credentials");
        const effective_balance = try validator.get("effective_balance");
        const has_withdrawable_credentials = if (comptime fork.gte(.electra)) hasExecutionWithdrawalCredential(withdrawal_credentials) else hasEth1WithdrawalCredential(withdrawal_credentials);
        // early skip for balance = 0 as its now more likely that validator has exited/slashed with
        // balance zero than not have withdrawal credentials set
        if (balance == 0 or !has_withdrawable_credentials) {
            continue;
        }

        // capella full withdrawal
        if (withdrawable_epoch <= epoch) {
            var execution_address: ExecutionAddress = undefined;
            @memcpy(&execution_address, withdrawal_credentials[12..]);
            withdrawals_result.withdrawals.appendAssumeCapacity(.{
                .index = withdrawal_index,
                .validator_index = validator_index,
                .address = execution_address,
                .amount = balance,
            });
            withdrawal_index += 1;
        } else if ((effective_balance == if (comptime fork.gte(.electra))
            getMaxEffectiveBalance(withdrawal_credentials)
        else
            preset.MAX_EFFECTIVE_BALANCE) and balance > effective_balance)
        {
            // capella partial withdrawal
            const partial_amount = balance - effective_balance;
            var execution_address: ExecutionAddress = undefined;
            @memcpy(&execution_address, withdrawal_credentials[12..]);
            withdrawals_result.withdrawals.appendAssumeCapacity(.{
                .index = withdrawal_index,
                .validator_index = validator_index,
                .address = execution_address,
                .amount = partial_amount,
            });
            withdrawal_index += 1;
            try withdrawal_balances.put(validator_index, withdraw_balance + partial_amount);
        }

        // Break if we have enough to pack the block
        if (withdrawals_result.withdrawals.items.len >= preset.MAX_WITHDRAWALS_PER_PAYLOAD) {
            break;
        }
    }

    withdrawals_result.sampled_validators = n;
    withdrawals_result.processed_partial_withdrawals_count = processed_partial_withdrawals_count;
}
const TestCachedBeaconState = @import("../test_utils/root.zig").TestCachedBeaconState;

test "getExpectedWithdrawals counts swept validators without rebuilding validators tree" {
    const allocator = std.testing.allocator;
    const validator_count = 256;
    const pool_size = 180_000;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = pool_size });
    defer pool.deinit();

    for ([_]usize{ 0, preset.MAX_WITHDRAWALS_PER_PAYLOAD - 1, preset.MAX_WITHDRAWALS_PER_PAYLOAD }) |withdrawal_count| {
        var test_state = try TestCachedBeaconState.init(allocator, &pool, validator_count);
        defer test_state.deinit();
        const state = test_state.cached_state.state.castToFork(.electra);
        var validators = try state.validators();
        const withdrawal_credentials = [_]u8{1} ++ [_]u8{0} ** 31;
        for (1..withdrawal_count + 1) |i| {
            var validator = try validators.get(i);
            try validator.setValue("withdrawal_credentials", &withdrawal_credentials);
            try validator.set("withdrawable_epoch", 0);
        }

        try state.commit();
        const validators_root_before = validators.getRoot();

        var withdrawals_buf: [preset.MAX_WITHDRAWALS_PER_PAYLOAD]types.capella.Withdrawal.Type = undefined;
        var withdrawals_result = WithdrawalsResult{
            .withdrawals = Withdrawals.initBuffer(&withdrawals_buf),
        };
        var withdrawal_balances = std.AutoHashMap(ValidatorIndex, usize).init(allocator);
        defer withdrawal_balances.deinit();

        try getExpectedWithdrawals(
            .electra,
            test_state.cached_state.epoch_cache,
            state,
            &withdrawals_result,
            &withdrawal_balances,
        );
        try state.commit();
        try std.testing.expectEqual(validators_root_before, validators.getRoot());

        const expected_sampled = if (withdrawal_count == preset.MAX_WITHDRAWALS_PER_PAYLOAD)
            withdrawal_count + 1
        else
            @min(validator_count, preset.MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP);
        try std.testing.expectEqual(expected_sampled, withdrawals_result.sampled_validators);
        try std.testing.expectEqual(withdrawal_count, withdrawals_result.withdrawals.items.len);
        for (withdrawals_result.withdrawals.items, 1..) |withdrawal, validator_index| {
            try std.testing.expectEqual(validator_index, withdrawal.validator_index);
        }

        var root: Root = undefined;
        try types.capella.Withdrawals.hashTreeRoot(allocator, &withdrawals_result.withdrawals, &root);
        try processWithdrawals(.electra, allocator, state, withdrawals_result, root, null);
    }
}
