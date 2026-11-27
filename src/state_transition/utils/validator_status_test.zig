//! Tests for `validator_status.zig`.

const std = @import("std");
const types = @import("consensus_types");
const constants = @import("constants");
const Validator = types.phase0.Validator;
const testing = std.testing;
const ValidatorStatus = @import("validator_status.zig").ValidatorStatus;
const getValidatorStatus = @import("validator_status.zig").getValidatorStatus;

fn makeValidator(
    activation_eligibility_epoch: u64,
    activation_epoch: u64,
    exit_epoch: u64,
    withdrawable_epoch: u64,
    slashed: bool,
    effective_balance: u64,
) Validator.Type {
    return .{
        .pubkey = [_]u8{0} ** 48,
        .withdrawal_credentials = [_]u8{0} ** 32,
        .effective_balance = effective_balance,
        .slashed = slashed,
        .activation_eligibility_epoch = activation_eligibility_epoch,
        .activation_epoch = activation_epoch,
        .exit_epoch = exit_epoch,
        .withdrawable_epoch = withdrawable_epoch,
    };
}

test "getValidatorStatus - pending_initialized" {
    // activation_epoch > current_epoch AND activation_eligibility_epoch == FAR_FUTURE
    const v = makeValidator(constants.FAR_FUTURE_EPOCH, constants.FAR_FUTURE_EPOCH, constants.FAR_FUTURE_EPOCH, constants.FAR_FUTURE_EPOCH, false, 32_000_000_000);
    try testing.expectEqual(ValidatorStatus.pending_initialized, getValidatorStatus(&v, 100));
}

test "getValidatorStatus - pending_queued" {
    // activation_epoch > current_epoch AND activation_eligibility_epoch < FAR_FUTURE
    const v = makeValidator(50, constants.FAR_FUTURE_EPOCH, constants.FAR_FUTURE_EPOCH, constants.FAR_FUTURE_EPOCH, false, 32_000_000_000);
    try testing.expectEqual(ValidatorStatus.pending_queued, getValidatorStatus(&v, 100));
}

test "getValidatorStatus - active_ongoing" {
    // activation_epoch <= current_epoch < exit_epoch AND exit_epoch == FAR_FUTURE
    const v = makeValidator(10, 20, constants.FAR_FUTURE_EPOCH, constants.FAR_FUTURE_EPOCH, false, 32_000_000_000);
    try testing.expectEqual(ValidatorStatus.active_ongoing, getValidatorStatus(&v, 100));
}

test "getValidatorStatus - active_exiting" {
    // activation_epoch <= current_epoch < exit_epoch AND exit_epoch < FAR_FUTURE AND NOT slashed
    const v = makeValidator(10, 20, 200, 300, false, 32_000_000_000);
    try testing.expectEqual(ValidatorStatus.active_exiting, getValidatorStatus(&v, 100));
}

test "getValidatorStatus - active_slashed" {
    // activation_epoch <= current_epoch < exit_epoch AND exit_epoch < FAR_FUTURE AND slashed
    const v = makeValidator(10, 20, 200, 300, true, 32_000_000_000);
    try testing.expectEqual(ValidatorStatus.active_slashed, getValidatorStatus(&v, 100));
}

test "getValidatorStatus - exited_unslashed" {
    // exit_epoch <= current_epoch < withdrawable_epoch AND NOT slashed
    const v = makeValidator(10, 20, 80, 200, false, 32_000_000_000);
    try testing.expectEqual(ValidatorStatus.exited_unslashed, getValidatorStatus(&v, 100));
}

test "getValidatorStatus - exited_slashed" {
    // exit_epoch <= current_epoch < withdrawable_epoch AND slashed
    const v = makeValidator(10, 20, 80, 200, true, 32_000_000_000);
    try testing.expectEqual(ValidatorStatus.exited_slashed, getValidatorStatus(&v, 100));
}

test "getValidatorStatus - withdrawal_possible" {
    // withdrawable_epoch <= current_epoch AND effective_balance != 0
    const v = makeValidator(10, 20, 80, 90, false, 32_000_000_000);
    try testing.expectEqual(ValidatorStatus.withdrawal_possible, getValidatorStatus(&v, 100));
}

test "getValidatorStatus - withdrawal_done" {
    // withdrawable_epoch <= current_epoch AND effective_balance == 0
    const v = makeValidator(10, 20, 80, 90, false, 0);
    try testing.expectEqual(ValidatorStatus.withdrawal_done, getValidatorStatus(&v, 100));
}

test "ValidatorStatus.toString" {
    try testing.expectEqualStrings("active_ongoing", ValidatorStatus.active_ongoing.toString());
    try testing.expectEqualStrings("pending_initialized", ValidatorStatus.pending_initialized.toString());
    try testing.expectEqualStrings("withdrawal_done", ValidatorStatus.withdrawal_done.toString());
}

test "ValidatorStatus.fromString" {
    try testing.expectEqual(ValidatorStatus.active_ongoing, ValidatorStatus.fromString("active_ongoing"));
    try testing.expectEqual(ValidatorStatus.exited_slashed, ValidatorStatus.fromString("exited_slashed"));
    try testing.expectEqual(@as(?ValidatorStatus, null), ValidatorStatus.fromString("invalid_status"));
}

test "ValidatorStatus.matchesCategory" {
    try testing.expect(ValidatorStatus.pending_initialized.matchesCategory("pending"));
    try testing.expect(ValidatorStatus.pending_queued.matchesCategory("pending"));
    try testing.expect(!ValidatorStatus.active_ongoing.matchesCategory("pending"));

    try testing.expect(ValidatorStatus.active_ongoing.matchesCategory("active"));
    try testing.expect(ValidatorStatus.active_exiting.matchesCategory("active"));
    try testing.expect(ValidatorStatus.active_slashed.matchesCategory("active"));
    try testing.expect(!ValidatorStatus.exited_unslashed.matchesCategory("active"));

    try testing.expect(ValidatorStatus.exited_unslashed.matchesCategory("exited"));
    try testing.expect(ValidatorStatus.exited_slashed.matchesCategory("exited"));
    try testing.expect(!ValidatorStatus.withdrawal_possible.matchesCategory("exited"));

    try testing.expect(ValidatorStatus.withdrawal_possible.matchesCategory("withdrawal"));
    try testing.expect(ValidatorStatus.withdrawal_done.matchesCategory("withdrawal"));
    try testing.expect(!ValidatorStatus.active_ongoing.matchesCategory("withdrawal"));

    try testing.expect(!ValidatorStatus.active_ongoing.matchesCategory("unknown_category"));
}
