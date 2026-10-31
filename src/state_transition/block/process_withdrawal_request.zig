const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const c = @import("constants");
const types = @import("consensus_types");
const preset = @import("preset").preset;
const WithdrawalRequest = types.electra.WithdrawalRequest.Type;
const PendingPartialWithdrawal = types.electra.PendingPartialWithdrawal.Type;
const hasCompoundingWithdrawalCredential = @import("../utils/electra.zig").hasCompoundingWithdrawalCredential;
const hasExecutionWithdrawalCredential = @import("../utils/electra.zig").hasExecutionWithdrawalCredential;
const isActiveValidatorView = @import("../utils/validator.zig").isActiveValidatorView;
const getPendingBalanceToWithdraw = @import("../utils/validator.zig").getPendingBalanceToWithdraw;
const initiateValidatorExit = @import("./initiate_validator_exit.zig").initiateValidatorExit;
const computeExitEpochAndUpdateChurn = @import("../utils/epoch.zig").computeExitEpochAndUpdateChurn;

pub fn processWithdrawalRequest(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    withdrawal_request: *const WithdrawalRequest,
) !void {
    const amount = withdrawal_request.amount;
    const is_full_exit_request = amount == c.FULL_EXIT_REQUEST_AMOUNT;

    var pending_partial_withdrawals = try state.pendingPartialWithdrawals();

    // If partial withdrawal queue is full, only full exits are processed
    if (try pending_partial_withdrawals.length() >= preset.PENDING_PARTIAL_WITHDRAWALS_LIMIT and
        !is_full_exit_request)
    {
        return;
    }

    // bail out if validator is not in beacon state
    // note that we don't need to check for 6110 unfinalized vals as they won't be eligible for withdraw/exit anyway
    const validator_index = epoch_cache.pubkey_cache.get(io, withdrawal_request.validator_pubkey) orelse return;

    var validators = try state.validators();
    if (validator_index >= try validators.length()) return;
    const validator = try validators.get(@intCast(validator_index));
    if (!(try isValidatorEligibleForWithdrawOrExit(
        config,
        epoch_cache.epoch,
        validator,
        &withdrawal_request.source_address,
    ))) {
        return;
    }

    // TODO Electra: Consider caching pendingPartialWithdrawals
    const pending_balance_to_withdraw = try getPendingBalanceToWithdraw(fork, state, validator_index);
    var balances = try state.balances();
    const validator_balance = try balances.get(@intCast(validator_index));

    if (is_full_exit_request) {
        // only exit validator if it has no pending withdrawals in the queue
        if (pending_balance_to_withdraw == 0) {
            try initiateValidatorExit(fork, config, epoch_cache, state, validator);
        }
        return;
    }

    // partial withdrawal request
    const effective_balance = try validator.get("effective_balance");
    const withdrawal_credentials = try validator.getFieldRoot("withdrawal_credentials");

    const has_sufficient_effective_balance = effective_balance >= preset.MIN_ACTIVATION_BALANCE;
    const has_excess_balance = validator_balance > preset.MIN_ACTIVATION_BALANCE + pending_balance_to_withdraw;

    // Only allow partial withdrawals with compounding withdrawal credentials
    if (hasCompoundingWithdrawalCredential(withdrawal_credentials) and
        has_sufficient_effective_balance and
        has_excess_balance)
    {
        const amount_to_withdraw = @min(validator_balance - preset.MIN_ACTIVATION_BALANCE - pending_balance_to_withdraw, amount);
        const exit_queue_epoch = try computeExitEpochAndUpdateChurn(fork, epoch_cache, state, amount_to_withdraw);
        const withdrawable_epoch = exit_queue_epoch + config.chain.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;

        const pending_partial_withdrawal = PendingPartialWithdrawal{
            .validator_index = validator_index,
            .amount = amount_to_withdraw,
            .withdrawable_epoch = withdrawable_epoch,
        };
        try pending_partial_withdrawals.pushValue(&pending_partial_withdrawal);
    }
}

fn isValidatorEligibleForWithdrawOrExit(
    config: *const BeaconConfig,
    current_epoch: u64,
    validator: *types.phase0.Validator.TreeView,
    source_address: []const u8,
) !bool {
    const withdrawal_credentials = try validator.getFieldRoot("withdrawal_credentials");
    const address = withdrawal_credentials[12..];

    const activation_epoch = try validator.get("activation_epoch");
    const exit_epoch = try validator.get("exit_epoch");

    return (hasExecutionWithdrawalCredential(withdrawal_credentials) and
        std.mem.eql(u8, address, source_address) and
        (try isActiveValidatorView(validator, current_epoch)) and
        exit_epoch == c.FAR_FUTURE_EPOCH and
        current_epoch >= activation_epoch + config.chain.SHARD_COMMITTEE_PERIOD);
}
