const preset = @import("preset").preset;
const GENESIS_EPOCH = @import("preset").GENESIS_EPOCH;
const types = @import("consensus_types");
const Slot = types.primitive.Slot.Type;
const Epoch = types.primitive.Epoch.Type;
const SyncPeriod = types.primitive.SyncPeriod.Type;
const Gwei = types.primitive.Gwei.Type;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const getActivationExitChurnLimit = @import("../utils/validator.zig").getActivationExitChurnLimit;
const getExitChurnLimit = @import("validator.zig").getExitChurnLimit;
const getConsolidationChurnLimitForFork = @import("validator.zig").getConsolidationChurnLimitForFork;

pub fn computeEpochAtSlot(slot: Slot) Epoch {
    return @divFloor(slot, preset.SLOTS_PER_EPOCH);
}

pub fn computeCheckpointEpochAtStateSlot(slot: Slot) Epoch {
    const epoch = computeEpochAtSlot(slot);
    return if (slot % preset.SLOTS_PER_EPOCH == 0)
        epoch
    else
        epoch + 1;
}

pub fn computeSlotsSinceEpochStart(slot: Slot) Slot {
    return slot - computeStartSlotAtEpoch(computeEpochAtSlot(slot));
}

pub fn computeStartSlotAtEpoch(epoch: Epoch) Slot {
    return epoch * preset.SLOTS_PER_EPOCH;
}

pub fn computeEndSlotAtEpoch(epoch: Epoch) Slot {
    return computeStartSlotAtEpoch(epoch + 1) - 1;
}

pub fn computeActivationExitEpoch(epoch: Epoch) Epoch {
    return epoch + 1 + preset.MAX_SEED_LOOKAHEAD;
}

pub fn computeExitEpochAndUpdateChurn(
    comptime fork: ForkSeq,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    exit_balance: Gwei,
) !u64 {
    const state_earliest_exit_epoch = try state.earliestExitEpoch();
    var earliest_exit_epoch = @max(state_earliest_exit_epoch, computeActivationExitEpoch(epoch_cache.epoch));
    const per_epoch_churn = if (comptime fork.gte(.gloas)) getExitChurnLimit(epoch_cache) else getActivationExitChurnLimit(epoch_cache);

    const state_exit_balance_to_consume = try state.exitBalanceToConsume();
    // New epoch for exits.
    var exit_balance_to_consume = if (state_earliest_exit_epoch < earliest_exit_epoch)
        per_epoch_churn
    else
        state_exit_balance_to_consume;

    // Exit doesn't fit in the current earliest epoch.
    if (exit_balance > exit_balance_to_consume) {
        const balance_to_process = exit_balance - exit_balance_to_consume;
        const additional_epochs = @divFloor(balance_to_process - 1, per_epoch_churn) + 1;
        earliest_exit_epoch += additional_epochs;
        exit_balance_to_consume += additional_epochs * per_epoch_churn;
    }

    // Consume the balance and update state variables.
    try state.setExitBalanceToConsume(exit_balance_to_consume - exit_balance);
    try state.setEarliestExitEpoch(earliest_exit_epoch);

    return earliest_exit_epoch;
}

pub fn computeConsolidationEpochAndUpdateChurn(
    comptime fork: ForkSeq,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    consolidation_balance: Gwei,
) !u64 {
    const state_earliest_consolidation_epoch = try state.earliestConsolidationEpoch();
    var earliest_consolidation_epoch = @max(state_earliest_consolidation_epoch, computeActivationExitEpoch(epoch_cache.epoch));
    const per_epoch_consolidation_churn = getConsolidationChurnLimitForFork(fork, epoch_cache);

    const state_consolidation_balance_to_consume = try state.consolidationBalanceToConsume();

    // New epoch for consolidations
    var consolidation_balance_to_consume = if (state_earliest_consolidation_epoch < earliest_consolidation_epoch)
        per_epoch_consolidation_churn
    else
        state_consolidation_balance_to_consume;

    // Consolidation doesn't fit in the current earliest epoch.
    if (consolidation_balance > consolidation_balance_to_consume) {
        const balance_to_process = consolidation_balance - consolidation_balance_to_consume;
        const additional_epochs = @divFloor(balance_to_process - 1, per_epoch_consolidation_churn) + 1;
        earliest_consolidation_epoch += additional_epochs;
        consolidation_balance_to_consume += additional_epochs * per_epoch_consolidation_churn;
    }

    // Consume the balance and update state variables.
    try state.setConsolidationBalanceToConsume(consolidation_balance_to_consume - consolidation_balance);
    try state.setEarliestConsolidationEpoch(earliest_consolidation_epoch);

    return earliest_consolidation_epoch;
}

pub fn computePreviousEpoch(epoch: Epoch) Epoch {
    return if (epoch == GENESIS_EPOCH) GENESIS_EPOCH else epoch - 1;
}

pub fn computeSyncPeriodAtSlot(slot: Slot) SyncPeriod {
    return computeSyncPeriodAtEpoch(computeEpochAtSlot(slot));
}

pub fn computeSyncPeriodAtEpoch(epoch: Epoch) SyncPeriod {
    return @divFloor(epoch, preset.EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
}

pub fn isStartSlotOfEpoch(slot: Slot) bool {
    return slot % preset.SLOTS_PER_EPOCH == 0;
}
