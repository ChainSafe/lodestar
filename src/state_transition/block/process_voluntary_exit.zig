const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;
const BeaconState = @import("fork_types").BeaconState;
const types = @import("consensus_types");
const c = @import("constants");
const SignedVoluntaryExit = types.phase0.SignedVoluntaryExit.Type;
const getPendingBalanceToWithdraw = @import("../utils/validator.zig").getPendingBalanceToWithdraw;
const isActiveValidatorView = @import("../utils/validator.zig").isActiveValidatorView;
const verifyVoluntaryExitSignature = @import("../signature_sets/voluntary_exits.zig").verifyVoluntaryExitSignature;
const initiateValidatorExit = @import("./initiate_validator_exit.zig").initiateValidatorExit;

const FAR_FUTURE_EPOCH = c.FAR_FUTURE_EPOCH;

pub fn processVoluntaryExit(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *EpochCache,
    state: *BeaconState(fork),
    signed_voluntary_exit: *const SignedVoluntaryExit,
    verify_signature: bool,
) !void {
    if (!try isValidVoluntaryExit(fork, io, config, epoch_cache, state, signed_voluntary_exit, verify_signature)) {
        return error.InvalidVoluntaryExit;
    }

    var validators = try state.validators();
    const validator = try validators.get(@intCast(signed_voluntary_exit.message.validator_index));
    try initiateValidatorExit(fork, config, epoch_cache, state, validator);
}

pub fn isValidVoluntaryExit(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    signed_voluntary_exit: *const SignedVoluntaryExit,
    verify_signature: bool,
) !bool {
    return try getVoluntaryExitValidity(fork, io, config, epoch_cache, state, signed_voluntary_exit, verify_signature) == .valid;
}

pub const VoluntaryExitValidity = enum {
    valid,
    inactive,
    already_exited,
    early_epoch,
    short_time_active,
    pending_withdrawals,
    invalid_signature,
};

pub fn getVoluntaryExitValidity(
    comptime fork: ForkSeq,
    io: std.Io,
    config: *const BeaconConfig,
    epoch_cache: *const EpochCache,
    state: *BeaconState(fork),
    signed_voluntary_exit: *const SignedVoluntaryExit,
    verify_signature: bool,
) !VoluntaryExitValidity {
    const voluntary_exit = signed_voluntary_exit.message;

    var validators = try state.validators();
    const validators_len = try validators.length();
    if (voluntary_exit.validator_index >= validators_len) {
        return .inactive;
    }

    var validator = try validators.getReadonly(@intCast(voluntary_exit.validator_index));
    const current_epoch = epoch_cache.epoch;

    // verify the validator is active
    if (!try isActiveValidatorView(validator, current_epoch)) {
        return .inactive;
    }

    // verify exit has not been initiated
    const exit_epoch = try validator.get("exit_epoch");
    if (exit_epoch != FAR_FUTURE_EPOCH) {
        return .already_exited;
    }

    // exits must specify an epoch when they become valid; they are not valid before then
    if (current_epoch < voluntary_exit.epoch) {
        return .early_epoch;
    }

    // verify the validator had been active long enough
    const activation_epoch = try validator.get("activation_epoch");
    if (current_epoch < activation_epoch + config.chain.SHARD_COMMITTEE_PERIOD) {
        return .short_time_active;
    }

    // only exit validator if it has no pending withdrawals in the queue (Electra+)
    if (comptime fork.gte(.electra)) {
        if (try getPendingBalanceToWithdraw(fork, state, voluntary_exit.validator_index) != 0) {
            return .pending_withdrawals;
        }
    }

    // verify signature
    if (verify_signature) {
        if (!try verifyVoluntaryExitSignature(io, config, epoch_cache, signed_voluntary_exit)) {
            return .invalid_signature;
        }
    }

    return .valid;
}

const std = @import("std");
const preset = @import("preset").preset;

test {
    _ = @import("process_voluntary_exit_test.zig");
}
