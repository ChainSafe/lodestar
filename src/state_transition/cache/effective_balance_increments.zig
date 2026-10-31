const std = @import("std");
const Allocator = std.mem.Allocator;
const preset = @import("preset").preset;
const AnyBeaconState = @import("fork_types").AnyBeaconState;
const RefCount = @import("../utils/ref_count.zig").RefCount;

pub const EffectiveBalanceIncrements = std.ArrayList(u16);
pub const EffectiveBalanceIncrementsRc = RefCount(EffectiveBalanceIncrements);

/// Allocates `EffectiveBalanceIncrements` with capacity slightly larger than `validator_count`.
///
/// This allows some slack for later usage of `effective_balance_increments` to not have to reallocate
/// for a while.
pub fn effectiveBalanceIncrementsInit(allocator: Allocator, validator_count: usize) !EffectiveBalanceIncrements {
    const capacity = 1024 * @divFloor(validator_count + 1024, 1024);
    var increments = try EffectiveBalanceIncrements.initCapacity(allocator, capacity);
    try increments.resize(allocator, validator_count);
    @memset(increments.items[0..validator_count], 0);
    return increments;
}

test {
    _ = @import("effective_balance_increments_test.zig");
}
