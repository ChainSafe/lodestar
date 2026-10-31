const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const EpochTransitionCache = @import("../cache/epoch_transition_cache.zig").EpochTransitionCache;
const computeActivationExitEpoch = @import("../utils/epoch.zig").computeActivationExitEpoch;
const initiateValidatorExit = @import("../block/initiate_validator_exit.zig").initiateValidatorExit;

pub fn processRegistryUpdates(
    comptime fork: ForkSeq,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    cache: *const EpochTransitionCache,
) !void {
    // Get the validators sub tree once for all the loop
    var validators = try state.validators();

    // TODO: Batch set this properties in the tree at once with setMany() or setNodes()

    // process ejections
    for (cache.indices_to_eject.items) |i| {
        // set validator exit epoch and withdrawable epoch
        // TODO: Figure out a way to quickly set properties on the validators tree
        const validator = try validators.get(i);
        try initiateValidatorExit(fork, config, epoch_cache, state, validator);
    }

    // set new activation eligibilities
    for (cache.indices_eligible_for_activation_queue.items) |i| {
        var validator = try validators.get(i);
        try validator.set("activation_eligibility_epoch", epoch_cache.epoch + 1);
    }

    const finalized_epoch = try state.finalizedEpoch();
    const len = if (comptime fork.lt(.electra)) @min(cache.indices_eligible_for_activation.items.len, epoch_cache.activation_churn_limit) else cache.indices_eligible_for_activation.items.len;
    const activation_epoch = computeActivationExitEpoch(cache.current_epoch);

    // dequeue validators for activation up to churn limit
    for (0..len) |i| {
        const validator_index = cache.indices_eligible_for_activation.items[i];
        var validator = try validators.get(validator_index);
        // placement in queue is finalized
        if ((try validator.get("activation_eligibility_epoch")) > finalized_epoch) {
            // remaining validators all have an activationEligibilityEpoch that is higher anyway, break early
            // activationEligibilityEpoch has been sorted in epoch process in ascending order.
            // At that point the finalityEpoch was not known because processJustificationAndFinalization() wasn't called yet.
            // So we need to filter by finalityEpoch here to comply with the spec.
            break;
        }
        try validator.set("activation_epoch", activation_epoch);
    }
}
