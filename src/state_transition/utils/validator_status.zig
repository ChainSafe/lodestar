const std = @import("std");
const types = @import("consensus_types");
const constants = @import("constants");

const Validator = types.phase0.Validator;
const Epoch = types.primitive.Epoch.Type;

/// Validator status as defined by https://hackmd.io/ofFJ5gOmQpu1jjHilHbdQQ
pub const ValidatorStatus = enum {
    pending_initialized,
    pending_queued,
    active_ongoing,
    active_exiting,
    active_slashed,
    exited_unslashed,
    exited_slashed,
    withdrawal_possible,
    withdrawal_done,

    pub fn toString(self: ValidatorStatus) [:0]const u8 {
        return @tagName(self);
    }

    pub fn fromString(s: []const u8) ?ValidatorStatus {
        return std.meta.stringToEnum(ValidatorStatus, s);
    }

    /// Check if this status matches a general category.
    /// Categories: "pending", "active", "exited", "withdrawal"
    pub fn matchesCategory(self: ValidatorStatus, category: []const u8) bool {
        if (std.mem.eql(u8, category, "pending")) {
            return self == .pending_initialized or self == .pending_queued;
        }
        if (std.mem.eql(u8, category, "active")) {
            return self == .active_ongoing or self == .active_exiting or self == .active_slashed;
        }
        if (std.mem.eql(u8, category, "exited")) {
            return self == .exited_unslashed or self == .exited_slashed;
        }
        if (std.mem.eql(u8, category, "withdrawal")) {
            return self == .withdrawal_possible or self == .withdrawal_done;
        }
        return false;
    }
};

/// Get the status of a validator at a given epoch.
pub fn getValidatorStatus(validator: *const Validator.Type, current_epoch: Epoch) ValidatorStatus {
    const FAR_FUTURE_EPOCH = constants.FAR_FUTURE_EPOCH;

    // pending
    if (validator.activation_epoch > current_epoch) {
        if (validator.activation_eligibility_epoch == FAR_FUTURE_EPOCH) {
            return .pending_initialized;
        }
        if (validator.activation_eligibility_epoch < FAR_FUTURE_EPOCH) {
            return .pending_queued;
        }
    }

    // active
    if (validator.activation_epoch <= current_epoch and current_epoch < validator.exit_epoch) {
        if (validator.exit_epoch == FAR_FUTURE_EPOCH) {
            return .active_ongoing;
        }
        if (validator.exit_epoch < FAR_FUTURE_EPOCH) {
            return if (validator.slashed) .active_slashed else .active_exiting;
        }
    }

    // exited
    if (validator.exit_epoch <= current_epoch and current_epoch < validator.withdrawable_epoch) {
        return if (validator.slashed) .exited_slashed else .exited_unslashed;
    }

    // withdrawal
    if (validator.withdrawable_epoch <= current_epoch) {
        return if (validator.effective_balance != 0) .withdrawal_possible else .withdrawal_done;
    }

    // Should not reach here for valid validators
    return .pending_initialized;
}

// ──── Tests ────

test {
    _ = @import("validator_status_test.zig");
}
