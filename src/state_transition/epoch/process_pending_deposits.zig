const std = @import("std");
const types = @import("consensus_types");
const Allocator = std.mem.Allocator;
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const getActivationExitChurnLimit = @import("../utils/validator.zig").getActivationExitChurnLimit;
const preset = @import("preset").preset;
const isValidatorKnown = @import("../utils/electra.zig").isValidatorKnown;
const validateDepositSignature = @import("../block/process_deposit.zig").validateDepositSignature;
const addValidatorToRegistry = @import("../block/process_deposit.zig").addValidatorToRegistry;
const hasCompoundingWithdrawalCredential = @import("../utils/electra.zig").hasCompoundingWithdrawalCredential;
const increaseBalance = @import("../utils/balance.zig").increaseBalance;
const computeStartSlotAtEpoch = @import("../utils/epoch.zig").computeStartSlotAtEpoch;
const PendingDeposit = types.electra.PendingDeposit.Type;
const GENESIS_SLOT = @import("preset").GENESIS_SLOT;
const c = @import("constants");
const getActivationBalanceChurnLimit = @import("../utils/validator.zig").getActivationBalanceChurnLimit;

/// Records compounding flags for validators added during this flow.
pub fn processPendingDeposits(
    comptime fork: ForkSeq,
    allocator: Allocator,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    cache: *EpochTransitionCache,
) !void {
    const next_epoch = epoch_cache.epoch + 1;
    const deposit_balance_to_consume = try state.depositBalanceToConsume();
    const churn_limit = if (comptime fork.gte(.gloas)) getActivationBalanceChurnLimit(epoch_cache) else getActivationExitChurnLimit(epoch_cache);
    const available_for_processing = deposit_balance_to_consume + churn_limit;
    const finalized_slot = computeStartSlotAtEpoch(try state.finalizedEpoch());

    var processed_amount: u64 = 0;
    var next_deposit_index: u64 = 0;
    var deposits_to_postpone: std.ArrayList(PendingDeposit) = .empty;
    defer deposits_to_postpone.deinit(allocator);
    var is_churn_limit_reached = false;

    var pending_deposits = try state.pendingDeposits();
    var pending_deposits_it = pending_deposits.iteratorReadonly(0);
    const pending_deposits_len = try pending_deposits.length();

    for (0..pending_deposits_len) |_| {
        const deposit = try pending_deposits_it.nextValue();
        // Pre-fulu: do not process deposit requests if Eth1 bridge deposits are not yet applied.
        // Fulu removes this guard along with the former (Eth1 bridge) deposit mechanism.
        if (comptime fork.lt(.fulu)) {
            const eth1_deposit_index = try state.eth1DepositIndex();
            const deposit_requests_start_index = try state.depositRequestsStartIndex();
            if (
            // Is deposit request
            deposit.slot > GENESIS_SLOT and
                // There are pending Eth1 bridge deposits
                eth1_deposit_index < deposit_requests_start_index)
            {
                break;
            }
        }

        // Check if deposit has been finalized, otherwise, stop processing.
        if (deposit.slot > finalized_slot) {
            break;
        }

        // Check if number of processed deposits has not reached the limit, otherwise, stop processing.
        if (next_deposit_index >= preset.MAX_PENDING_DEPOSITS_PER_EPOCH) {
            break;
        }

        // Read validator state
        var is_validator_exited = false;
        var is_validator_withdrawn = false;
        const validator_index = epoch_cache.pubkey_cache.get(io, deposit.pubkey);

        if (try isValidatorKnown(fork, state, validator_index)) {
            var validators = try state.validators();
            var validator = try validators.getReadonly(validator_index.?);
            is_validator_exited = try validator.get("exit_epoch") < c.FAR_FUTURE_EPOCH;
            is_validator_withdrawn = try validator.get("withdrawable_epoch") < next_epoch;
        }

        if (is_validator_withdrawn) {
            // Deposited balance will never become active. Increase balance but do not consume churn
            try applyPendingDeposit(fork, io, config, epoch_cache, state, deposit, cache);
        } else if (is_validator_exited) {
            // Validator is exiting, postpone the deposit until after withdrawable epoch
            try deposits_to_postpone.append(allocator, deposit);
        } else {
            // Check if deposit fits in the churn, otherwise, do no more deposit processing in this epoch.
            is_churn_limit_reached = processed_amount + deposit.amount > available_for_processing;
            if (is_churn_limit_reached) {
                break;
            }
            // Consume churn and apply deposit.
            processed_amount += deposit.amount;
            try applyPendingDeposit(fork, io, config, epoch_cache, state, deposit, cache);
        }

        // Regardless of how the deposit was handled, we move on in the queue.
        next_deposit_index += 1;
    }

    if (next_deposit_index > 0) {
        const new_pending_deposits = try pending_deposits.sliceFrom(next_deposit_index);
        try state.setPendingDeposits(new_pending_deposits);
        pending_deposits = new_pending_deposits;
    }

    for (deposits_to_postpone.items) |deposit| {
        try pending_deposits.pushValue(&deposit);
    }

    // Accumulate churn only if the churn limit has been hit.
    try state.setDepositBalanceToConsume(if (is_churn_limit_reached)
        available_for_processing - processed_amount
    else
        0);
}

/// Records the compounding flag when this flow adds a validator.
fn applyPendingDeposit(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    deposit: PendingDeposit,
    cache: *EpochTransitionCache,
) !void {
    const validator_index = epoch_cache.pubkey_cache.get(io, deposit.pubkey);
    const pubkey = &deposit.pubkey;

    const withdrawal_credentials = &deposit.withdrawal_credentials;
    const amount = deposit.amount;
    const signature = deposit.signature;
    const is_validator_known = try isValidatorKnown(fork, state, validator_index);

    if (!is_validator_known) {
        if (comptime fork.gte(.heze)) {
            if (withdrawal_credentials[0] == @import("constants").BLS_WITHDRAWAL_PREFIX) return;
        }
        // Verify the deposit signature (proof of possession) which is not checked by the deposit contract
        if (validateDepositSignature(config, pubkey, withdrawal_credentials, amount, signature)) {
            try addValidatorToRegistry(fork, io, epoch_cache, state, pubkey, withdrawal_credentials, amount);
            cache.appendCompoundingValidatorFlag(hasCompoundingWithdrawalCredential(withdrawal_credentials));
            // set balance, so that the next deposit of same pubkey will increase the balance correctly
            // this is to fix the double deposit issue found in mekong
            // see https://github.com/ChainSafe/lodestar/pull/7255
            if (cache.balances) |*balances| {
                balances.appendAssumeCapacity(amount);
            }
        } else |_| {
            // invalid deposit signature, ignore the deposit
            // TODO may be a useful metric to track
        }
    } else {
        if (validator_index) |val_idx| {
            // Increase balance
            try increaseBalance(fork, state, val_idx, amount);
            if (cache.balances) |*balances| {
                balances.items[val_idx] += amount;
            }
        } else {
            // should not happen since we checked in isValidatorKnown() above
            return error.UnexpectedNullValidatorIndex;
        }
    }
}
