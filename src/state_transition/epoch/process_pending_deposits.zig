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

    // Pre-fulu: do not process deposit requests if Eth1 bridge deposits are not yet applied.
    // Fulu removes this guard along with the former (Eth1 bridge) deposit mechanism.
    const eth1_bridge_pending = if (comptime fork.lt(.fulu))
        try state.eth1DepositIndex() < try state.depositRequestsStartIndex()
    else
        false;

    // The deposits this epoch can reach, in queue order. Only the churn check below can stop
    // earlier, and it does not depend on signatures, so their checks can run up front.
    var candidates: [preset.MAX_PENDING_DEPOSITS_PER_EPOCH]PendingDeposit = undefined;
    var candidate_count: usize = 0;
    while (candidate_count < @min(pending_deposits_len, preset.MAX_PENDING_DEPOSITS_PER_EPOCH)) {
        const deposit = try pending_deposits_it.nextValue();
        if (eth1_bridge_pending and deposit.slot > GENESIS_SLOT) break;
        // Check if deposit has been finalized, otherwise, stop processing.
        if (deposit.slot > finalized_slot) break;
        candidates[candidate_count] = deposit;
        candidate_count += 1;
    }
    var signature_valid: [preset.MAX_PENDING_DEPOSITS_PER_EPOCH]?bool = @splat(null);
    const reachable = candidates[0..candidate_count];
    const reachable_signature_valid = signature_valid[0..candidate_count];
    try checkNewValidatorSignatures(
        fork,
        io,
        config,
        epoch_cache,
        state,
        reachable,
        reachable_signature_valid,
    );

    for (reachable, reachable_signature_valid) |deposit, deposit_signature_valid| {
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
            try applyPendingDeposit(fork, io, epoch_cache, state, deposit, deposit_signature_valid, cache);
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
            try applyPendingDeposit(fork, io, epoch_cache, state, deposit, deposit_signature_valid, cache);
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
/// `signature_valid` is the deposit's signature check, made by `checkNewValidatorSignatures`
/// whenever its pubkey was unknown at the start of the epoch.
fn applyPendingDeposit(
    comptime fork: ForkSeq,
    io: std.Io,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    deposit: PendingDeposit,
    signature_valid: ?bool,
    cache: *EpochTransitionCache,
) !void {
    const validator_index = epoch_cache.pubkey_cache.get(io, deposit.pubkey);
    const pubkey = &deposit.pubkey;

    const withdrawal_credentials = &deposit.withdrawal_credentials;
    const amount = deposit.amount;
    const is_validator_known = try isValidatorKnown(fork, state, validator_index);

    if (!is_validator_known) {
        if (comptime fork.gte(.heze)) {
            if (withdrawal_credentials[0] == @import("constants").BLS_WITHDRAWAL_PREFIX) return;
        }
        // Validators are only ever added, so an unknown pubkey now was unknown at the start too.
        if (signature_valid orelse return error.MissingDepositSignatureCheck) {
            try addValidatorToRegistry(fork, io, epoch_cache, state, pubkey, withdrawal_credentials, amount);
            cache.appendCompoundingValidatorFlag(hasCompoundingWithdrawalCredential(withdrawal_credentials));
            // set balance, so that the next deposit of same pubkey will increase the balance correctly
            // this is to fix the double deposit issue found in mekong
            // see https://github.com/ChainSafe/lodestar/pull/7255
            if (cache.balances) |*balances| {
                balances.appendAssumeCapacity(amount);
            }
        } else {
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

const SignatureChecks = struct {
    config: *const BeaconConfig,
    deposits: []const PendingDeposit,
    valid: []?bool,

    // Runs on several threads at once and writes only `valid[index]`.
    fn check(checks: *const SignatureChecks, index: usize) void {
        const deposit = &checks.deposits[index];
        // Verify the deposit signature (proof of possession) which is not checked by the deposit contract
        checks.valid[index] = if (validateDepositSignature(
            checks.config,
            &deposit.pubkey,
            &deposit.withdrawal_credentials,
            deposit.amount,
            deposit.signature,
        )) true else |_| false;
    }
};

/// Checks, concurrently on `io`, the signature of every deposit whose pubkey is not yet a
/// validator, so the queue walk does not verify one BLS signature at a time. Each result goes
/// to the same index of `valid`; the others stay null.
fn checkNewValidatorSignatures(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    deposits: []const PendingDeposit,
    valid: []?bool,
) !void {
    std.debug.assert(deposits.len == valid.len);
    // Read before any task starts: an error between `async` and `await` would return while
    // tasks still use `checks` and the caller's arrays.
    const validators_count = try state.validatorsCount();
    const checks: SignatureChecks = .{ .config = config, .deposits = deposits, .valid = valid };
    var group: std.Io.Group = .init;
    for (deposits, 0..) |deposit, index| {
        const validator_index = epoch_cache.pubkey_cache.get(io, deposit.pubkey);
        if (validator_index != null and validator_index.? < validators_count) continue;
        // applyPendingDeposit drops these before looking at the signature.
        if (comptime fork.gte(.heze)) {
            if (deposit.withdrawal_credentials[0] == c.BLS_WITHDRAWAL_PREFIX) continue;
        }
        group.async(io, SignatureChecks.check, .{ &checks, index });
    }
    try group.await(io);
}

test {
    _ = @import("process_pending_deposits_test.zig");
}
