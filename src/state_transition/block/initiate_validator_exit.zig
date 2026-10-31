const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const types = @import("consensus_types");
const c = @import("constants");
const FAR_FUTURE_EPOCH = c.FAR_FUTURE_EPOCH;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const computeExitEpochAndUpdateChurn = @import("../utils/epoch.zig").computeExitEpochAndUpdateChurn;

/// Initiate the exit of the validator with index ``index``
///
/// NOTE: This function takes a `validator` as argument instead of the validator index.
/// SSZ TreeViews have a dangerous edge case that may break the code here in a non-obvious way.
/// When running `state.validators[i]` you get a SubTree of that validator with a hook to the state.
/// Then, when a property of `validator` is set it propagates the changes upwards to the parent tree up to the state.
/// This means that `validator` will propagate its new state along with the current state of its parent tree up to
/// the state, potentially overwriting changes done in other SubTrees before.
/// ```ts
/// // default state.validators, all zeroes
/// const validatorsA = state.validators
/// const validatorsB = state.validators
/// validatorsA[0].exitEpoch = 9
/// validatorsB[0].exitEpoch = 9 // Setting a value in validatorsB will overwrite all changes from validatorsA
/// // validatorsA[0].exitEpoch is 0
/// // validatorsB[0].exitEpoch is 9
/// ```
/// Forcing consumers to pass the SubTree of `validator` directly mitigates this issue.
///
pub fn initiateValidatorExit(
    comptime fork: ForkSeq,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    validator: *types.phase0.Validator.TreeView,
) !void {
    // return if validator already initiated exit
    if ((try validator.get("exit_epoch")) != FAR_FUTURE_EPOCH) {
        return;
    }

    if (comptime fork.lt(.electra)) {
        // Limits the number of validators that can exit on each epoch.
        // Expects all state.validators to follow this rule, i.e. no validator.exitEpoch is greater than exitQueueEpoch.
        // If there the churnLimit is reached at this current exitQueueEpoch, advance epoch and reset churn.
        if (epoch_cache.exit_queue_churn >= epoch_cache.churn_limit) {
            epoch_cache.exit_queue_epoch += 1;
            // = 1 to account for this validator with exitQueueEpoch
            epoch_cache.exit_queue_churn = 1;
        } else {
            // Add this validator to the current exitQueueEpoch churn
            epoch_cache.exit_queue_churn += 1;
        }

        // set validator exit epoch
        try validator.set("exit_epoch", epoch_cache.exit_queue_epoch);
    } else {
        // set validator exit epoch
        // Note we don't use epochCtx.exitQueueChurn and exitQueueEpoch anymore
        try validator.set(
            "exit_epoch",
            try computeExitEpochAndUpdateChurn(fork, epoch_cache, state, try validator.get("effective_balance")),
        );
    }

    try validator.set(
        "withdrawable_epoch",
        try std.math.add(u64, try validator.get("exit_epoch"), config.chain.MIN_VALIDATOR_WITHDRAWABILITY_DELAY),
    );
}
