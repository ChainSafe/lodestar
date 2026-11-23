//! Tests for `ValidatorMonitor.zig`.

const std = @import("std");
const testing = std.testing;
const types = @import("consensus_types");
const metrics = @import("metrics.zig");
const attester_status = @import("utils/attester_status.zig");
const ValidatorMonitor = @import("ValidatorMonitor.zig");

const Epoch = types.primitive.Epoch.Type;

test "registerValidatorStatuses records metrics" {
    const allocator = std.testing.allocator;
    try metrics.init(allocator, std.testing.io, .{});
    defer metrics.deinit();

    var monitor = ValidatorMonitor.init(allocator);
    defer monitor.deinit();
    try monitor.registerLocalValidator(0);
    try monitor.registerLocalValidator(1);

    const flags = [_]u8{
        attester_status.FLAG_PREV_SOURCE_ATTESTER |
            attester_status.FLAG_PREV_TARGET_ATTESTER |
            attester_status.FLAG_PREV_HEAD_ATTESTER,
        0,
    };
    const balances = [_]u64{ 32_000_000_000, 31_000_000_000 };
    monitor.registerValidatorStatuses(1, &flags, &balances);

    var aw: std.Io.Writer.Allocating = .init(allocator);
    var list = _: {
        errdefer aw.deinit();
        try metrics.write(&aw.writer);
        break :_ aw.toArrayList();
    };
    defer list.deinit(allocator);

    const expectations = [_][]const u8{
        "validator_monitor_prev_epoch_on_chain_source_attester_hit_total 1",
        "validator_monitor_prev_epoch_on_chain_source_attester_miss_total 1",
        "validator_monitor_prev_epoch_on_chain_target_attester_hit_total 1",
        "validator_monitor_prev_epoch_on_chain_target_attester_miss_total 1",
        "validator_monitor_prev_epoch_on_chain_head_attester_hit_total 1",
        "validator_monitor_prev_epoch_on_chain_head_attester_miss_total 1",
        "validator_monitor_prev_epoch_on_chain_balance 63000000000",
    };
    for (expectations) |expected| {
        std.testing.expect(std.mem.find(u8, list.items, expected) != null) catch |err| {
            std.debug.print("expected metric not found: {s}\n", .{expected});
            return err;
        };
    }
}

test "registerValidatorStatuses guards" {
    var monitor = ValidatorMonitor.init(std.testing.allocator);
    defer monitor.deinit();

    try monitor.registerLocalValidator(0);
    try monitor.registerLocalValidator(2);
    // registering twice is a no-op
    try monitor.registerLocalValidator(0);
    try std.testing.expectEqual(@as(usize, 2), monitor.validators.count());

    // unregistering removes; unknown index is a no-op
    monitor.unregisterLocalValidator(2);
    monitor.unregisterLocalValidator(99);
    try std.testing.expectEqual(@as(usize, 1), monitor.validators.count());
    try monitor.registerLocalValidator(2);
    try std.testing.expectEqual(@as(usize, 2), monitor.validators.count());

    const flags = [_]u8{
        attester_status.FLAG_PREV_SOURCE_ATTESTER | attester_status.FLAG_PREV_TARGET_ATTESTER,
        0,
        attester_status.FLAG_PREV_HEAD_ATTESTER,
    };
    const balances = [_]u64{ 32_000_000_000, 31_000_000_000, 33_000_000_000 };

    // epoch 0 is registered but has no previous epoch activity
    monitor.registerValidatorStatuses(0, &flags, &balances);
    try std.testing.expectEqual(@as(?Epoch, 0), monitor.last_registered_status_epoch);

    monitor.registerValidatorStatuses(1, &flags, &balances);
    try std.testing.expectEqual(@as(?Epoch, 1), monitor.last_registered_status_epoch);

    // same epoch twice is a no-op
    monitor.registerValidatorStatuses(1, &flags, &balances);
    try std.testing.expectEqual(@as(?Epoch, 1), monitor.last_registered_status_epoch);
}
