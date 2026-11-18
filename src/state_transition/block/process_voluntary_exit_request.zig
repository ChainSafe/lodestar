const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
const BeaconConfig = @import("config").BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const c = @import("constants");
const isActiveValidatorView = @import("../utils/validator.zig").isActiveValidatorView;
const getPendingBalanceToWithdraw = @import("../utils/validator.zig").getPendingBalanceToWithdraw;
const initiateValidatorExit = @import("./initiate_validator_exit.zig").initiateValidatorExit;

/// From PQ a voluntary exit is an execution layer request. The system contract
/// verifies the validator's signature before it emits the request.
pub fn processVoluntaryExitRequest(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    request: *const ForkTypes(.pq).VoluntaryExitRequest.Type,
) !void {
    comptime std.debug.assert(fork == .pq);
    const validator_index = epoch_cache.pubkey_cache.getXmss(io, &request.pubkey) orelse return;
    var validators = try state.validators();
    if (validator_index >= try validators.length()) return;
    const validator = try validators.get(@intCast(validator_index));

    const current_epoch = epoch_cache.epoch;
    if (!try isActiveValidatorView(validator, current_epoch)) return;
    if (try validator.get("exit_epoch") != c.FAR_FUTURE_EPOCH) return;
    if (current_epoch < try validator.get("activation_epoch") + config.chain.SHARD_COMMITTEE_PERIOD) return;
    if (try getPendingBalanceToWithdraw(fork, state, validator_index) != 0) return;

    try initiateValidatorExit(fork, config, epoch_cache, state, validator);
}
