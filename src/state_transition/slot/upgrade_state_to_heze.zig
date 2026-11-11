const std = @import("std");
const BeaconConfig = @import("config").BeaconConfig;
const BeaconState = @import("fork_types").BeaconState;
const ct = @import("consensus_types");
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;

/// Consumes gloas_state only on success. Compatible field roots remain shared.
pub fn upgradeStateToHeze(allocator: std.mem.Allocator, config: *const BeaconConfig, gloas_state: *BeaconState(.gloas)) !BeaconState(.heze) {
    if (try gloas_state.eth1DepositIndex() != try gloas_state.depositRequestsStartIndex()) {
        return error.LegacyDepositsNotDrained;
    }

    try gloas_state.commit();
    var state = try gloas_state.upgradeUnsafe();
    errdefer state.deinit();

    try state.setFork(&.{
        .previous_version = try gloas_state.forkCurrentVersion(),
        .current_version = config.chain.HEZE_FORK_VERSION,
        .epoch = computeEpochAtSlot(try state.slot()),
    });

    var old_bid = ct.gloas.ExecutionPayloadBid.default_value;
    defer ct.gloas.ExecutionPayloadBid.deinit(allocator, &old_bid);
    try gloas_state.inner.getValue(allocator, "latest_execution_payload_bid", &old_bid);
    var bid = ct.heze.ExecutionPayloadBid.default_value;
    inline for (ct.gloas.ExecutionPayloadBid.fields) |field| {
        @field(bid, field.name) = @field(old_bid, field.name);
    }
    try state.inner.setValue("latest_execution_payload_bid", &bid);
    try state.commit();

    gloas_state.deinit();
    return state;
}

test {
    _ = @import("upgrade_state_to_heze_test.zig");
}
