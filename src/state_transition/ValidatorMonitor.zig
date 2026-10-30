//! Consumes the per-validator status data produced by the epoch transition
//! and records validator metrics for the validators registered with `registerLocalValidator`.

const std = @import("std");

const types = @import("consensus_types");
const metrics = @import("metrics.zig");
const attester_status = @import("utils/attester_status.zig");
const hasMarkers = attester_status.hasMarkers;

const Allocator = std.mem.Allocator;
const Epoch = types.primitive.Epoch.Type;
const ValidatorIndex = types.primitive.ValidatorIndex.Type;

const ValidatorMonitor = @This();

allocator: Allocator,
/// Unordered list of validators that require additional monitoring.
validators: std.array_hash_map.Auto(ValidatorIndex, void),
/// Prevents registering statuses for the same epoch twice.
/// processEpoch() may be run more than once for the same epoch.
last_registered_status_epoch: ?Epoch,

pub fn init(allocator: Allocator) ValidatorMonitor {
    return .{
        .allocator = allocator,
        .validators = .empty,
        .last_registered_status_epoch = null,
    };
}

pub fn deinit(self: *ValidatorMonitor) void {
    self.validators.deinit(self.allocator);
    self.* = undefined;
}

/// Adds a validator to the list of monitored validators.
///
/// Registering an already-monitored validator is a no-op.
pub fn registerLocalValidator(self: *ValidatorMonitor, index: ValidatorIndex) !void {
    try self.validators.put(self.allocator, index, {});
}

/// Prunes a validator from the list of monitored validators.
///
/// Unregistering an unknown validator is a no-op.
pub fn unregisterLocalValidator(self: *ValidatorMonitor, index: ValidatorIndex) void {
    _ = self.validators.swapRemove(index);
}

/// Registers the per-validator statuses produced by one epoch transition and
/// records metrics for all monitored validators.
///
/// `flags` are the packed attester flags of `EpochTransitionCache` (see `utils/attester_status.zig`).
/// `balances` is optional; when present the total balance of all monitored
/// validators is reported.
///
/// NOTE: Gossip-derived metrics (inclusion distance, attester hit/miss, correct head)
/// are recorded by the lodestar-ts validator monitor, which observes attestations
/// on the network; the state transition cannot see them post-altair.
/// TODO(bing): port the rest of validator monitor, this is just a minimal
/// impl for stf integration
pub fn registerValidatorStatuses(
    self: *ValidatorMonitor,
    current_epoch: Epoch,
    flags: []const u8,
    balances: ?[]const u64,
) void {

    // Prevent registering statuses for the same epoch twice.
    if (self.last_registered_status_epoch) |last_registered_status_epoch|
        if (current_epoch <= last_registered_status_epoch) return;

    self.last_registered_status_epoch = current_epoch;

    // There won't be any validator activity in epoch -1.
    if (current_epoch == 0) return;

    const vm = &metrics.validator_monitor;

    // Track total balance instead of per-validator balance to reduce metric cardinality.
    var total_balance: u64 = 0;

    for (self.validators.keys()) |index| {
        // The monitored validator may not be in the state yet.
        if (index >= flags.len) continue;

        const flag = flags[index];

        if (hasMarkers(flag, attester_status.FLAG_PREV_SOURCE_ATTESTER)) {
            vm.prev_epoch_on_chain_source_attester_hit.incr();
        } else {
            vm.prev_epoch_on_chain_source_attester_miss.incr();
        }
        if (hasMarkers(flag, attester_status.FLAG_PREV_HEAD_ATTESTER)) {
            vm.prev_epoch_on_chain_head_attester_hit.incr();
        } else {
            vm.prev_epoch_on_chain_head_attester_miss.incr();
        }
        if (hasMarkers(flag, attester_status.FLAG_PREV_TARGET_ATTESTER)) {
            vm.prev_epoch_on_chain_target_attester_hit.incr();
        } else {
            vm.prev_epoch_on_chain_target_attester_miss.incr();
        }

        if (balances) |b| {
            if (index < b.len) total_balance += b[index];
        }
    }

    if (balances != null) {
        vm.prev_epoch_on_chain_balance.set(total_balance);
    }
}

test {
    _ = @import("validator_monitor_test.zig");
}
