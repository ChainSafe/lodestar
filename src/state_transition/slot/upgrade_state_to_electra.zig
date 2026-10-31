const std = @import("std");
const Allocator = std.mem.Allocator;
const BeaconConfig = @import("config").BeaconConfig;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const BeaconState = @import("fork_types").BeaconState;
const ct = @import("consensus_types");
const ValidatorIndex = ct.primitive.ValidatorIndex.Type;
const constants = @import("constants");
const computeActivationExitEpoch = @import("../utils/epoch.zig").computeActivationExitEpoch;
const getActivationExitChurnLimit = @import("../utils/validator.zig").getActivationExitChurnLimit;
const getConsolidationChurnLimit = @import("../utils/validator.zig").getConsolidationChurnLimit;
const hasCompoundingWithdrawalCredential = @import("../utils/electra.zig").hasCompoundingWithdrawalCredential;
const queueExcessActiveBalance = @import("../utils/electra.zig").queueExcessActiveBalance;

pub fn upgradeStateToElectra(
    allocator: Allocator,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    deneb_state: *BeaconState(.deneb),
) !BeaconState(.electra) {
    var state = try deneb_state.upgradeUnsafe();
    errdefer state.deinit();

    const new_fork: ct.phase0.Fork.Type = .{
        .previous_version = try deneb_state.forkCurrentVersion(),
        .current_version = config.chain.ELECTRA_FORK_VERSION,
        .epoch = epoch_cache.epoch,
    };
    try state.setFork(&new_fork);

    try state.setDepositRequestsStartIndex(constants.UNSET_DEPOSIT_REQUESTS_START_INDEX);
    // default values are already 0, don't need to be set explicitly
    // try state.setDepositBalanceToConsume(0);
    // try state.setExitBalanceToConsume(0);

    const current_epoch_pre = epoch_cache.epoch;
    var earliest_exit_epoch = computeActivationExitEpoch(current_epoch_pre);
    // [EIP-7251]: add validators that are not yet active to pending balance deposits
    var pre_activation: std.ArrayList(ct.primitive.ValidatorIndex.Type) = .empty;
    defer pre_activation.deinit(allocator);
    const validators_slice = try state.validatorsSlice(allocator);
    defer allocator.free(validators_slice);
    for (validators_slice, 0..) |validator, validator_index| {
        const activation_epoch = validator.activation_epoch;
        const exit_epoch = validator.exit_epoch;
        if (activation_epoch == constants.FAR_FUTURE_EPOCH) {
            try pre_activation.append(allocator, validator_index);
        }
        if (exit_epoch != constants.FAR_FUTURE_EPOCH and exit_epoch > earliest_exit_epoch) {
            earliest_exit_epoch = exit_epoch;
        }
    }

    try state.setEarliestExitEpoch(earliest_exit_epoch + 1);
    try state.setEarliestConsolidationEpoch(computeActivationExitEpoch(current_epoch_pre));
    try state.setExitBalanceToConsume(getActivationExitChurnLimit(epoch_cache));
    try state.setConsolidationBalanceToConsume(getConsolidationChurnLimit(epoch_cache));

    const sort_fn = struct {
        pub fn sort(validator_arr: []const ct.phase0.Validator.Type, a: ValidatorIndex, b: ValidatorIndex) bool {
            const activation_eligibility_epoch_a = validator_arr[a].activation_eligibility_epoch;
            const activation_eligibility_epoch_b = validator_arr[b].activation_eligibility_epoch;
            return if (activation_eligibility_epoch_a != activation_eligibility_epoch_b) activation_eligibility_epoch_a < activation_eligibility_epoch_b else a < b;
        }
    }.sort;
    std.mem.sort(ValidatorIndex, pre_activation.items, validators_slice, sort_fn);

    // const electra_state = state.electra;
    var balances = try state.balances();
    var validators = try state.validators();
    const effective_balance_increments = epoch_cache.getEffectiveBalanceIncrements();
    var pending_deposits = try state.pendingDeposits();
    for (pre_activation.items) |validator_index| {
        const balance = try balances.get(validator_index);
        try balances.set(validator_index, 0);

        var validator = try validators.get(validator_index);
        try validator.set("effective_balance", 0);
        effective_balance_increments.items[validator_index] = 0;
        try validator.set("activation_eligibility_epoch", constants.FAR_FUTURE_EPOCH);

        const pending_deposit: ct.electra.PendingDeposit.Type = .{
            .pubkey = validators_slice[validator_index].pubkey,
            .withdrawal_credentials = validators_slice[validator_index].withdrawal_credentials,
            .amount = balance,
            .signature = constants.G2_POINT_AT_INFINITY,
            .slot = constants.GENESIS_SLOT,
        };
        try pending_deposits.pushValue(&pending_deposit);
    }

    for (validators_slice, 0..) |validator, validator_index| {
        // [EIP-7251]: Ensure early adopters of compounding credentials go through the activation churn
        const withdrawal_credentials = validator.withdrawal_credentials;
        if (hasCompoundingWithdrawalCredential(&withdrawal_credentials)) {
            try queueExcessActiveBalance(.electra, &state, validator_index, &withdrawal_credentials, validator.pubkey);
        }
    }

    deneb_state.deinit();
    return state;
}
