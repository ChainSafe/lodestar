const std = @import("std");
const Allocator = std.mem.Allocator;
const ForkSeq = @import("config").ForkSeq;
const BeaconState = @import("fork_types").BeaconState;
const ForkTypes = @import("fork_types").ForkTypes;
const preset = @import("preset").preset;
const getBuilderPaymentQuorumThreshold = @import("../utils/gloas.zig").getBuilderPaymentQuorumThreshold;
const EpochCache = @import("../cache/epoch_cache.zig").EpochCache;

pub fn processBuilderPendingPayments(comptime fork: ForkSeq, allocator: Allocator, state: *BeaconState(fork), epoch_cache: *const EpochCache) !void {
    const quorum = getBuilderPaymentQuorumThreshold(epoch_cache);

    var pending_payments = try state.inner.get("builder_pending_payments");
    var pending_withdrawals = try state.inner.get("builder_pending_withdrawals");
    for (0..preset.SLOTS_PER_EPOCH) |index| {
        var previous: ForkTypes(fork).BuilderPendingPayment.Type = undefined;
        try pending_payments.getValue(allocator, index, &previous);
        if (previous.weight >= quorum) try pending_withdrawals.pushValue(&previous.withdrawal);
        var current: ForkTypes(fork).BuilderPendingPayment.Type = undefined;
        try pending_payments.getValue(allocator, index + preset.SLOTS_PER_EPOCH, &current);
        try pending_payments.setValue(index, &current);
        try pending_payments.setValue(index + preset.SLOTS_PER_EPOCH, &ForkTypes(fork).BuilderPendingPayment.default_value);
    }
}
