const std = @import("std");
const types = @import("consensus_types");
const Validator = types.phase0.Validator.Type;
const Epoch = types.primitive.Epoch.Type;
const preset = @import("preset").preset;
const c = @import("constants");
const isActiveValidator = @import("./validator.zig").isActiveValidator;

const TIMELY_TARGET = 1 << c.TIMELY_TARGET_FLAG_INDEX;

pub fn sumTargetUnslashedBalanceIncrements(participations: []const u8, epoch: Epoch, validators: []const *const Validator) u64 {
    std.debug.assert(participations.len == validators.len);
    var total: u64 = 0;
    for (participations, 0..) |participation, i| {
        if ((participation & TIMELY_TARGET) == TIMELY_TARGET) {
            const validator = validators[i];
            if (isActiveValidator(validator, epoch) and !validator.slashed) {
                total += @divFloor(validator.effective_balance, preset.EFFECTIVE_BALANCE_INCREMENT);
            }
        }
    }

    return total;
}
