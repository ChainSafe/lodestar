//! Tests for `effective_balance_increments.zig`.

const std = @import("std");
const effectiveBalanceIncrementsInit = @import("effective_balance_increments.zig").effectiveBalanceIncrementsInit;

test "effectiveBalanceIncrementsInit basic allocation" {
    const allocator = std.testing.allocator;
    var increments = try effectiveBalanceIncrementsInit(allocator, 100);
    defer increments.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 100), increments.items.len);
    // Capacity should be rounded up to next 1024 boundary
    try std.testing.expectEqual(@as(usize, 1024), increments.capacity);
    // All values should be zero
    for (increments.items) |val| {
        try std.testing.expectEqual(@as(u16, 0), val);
    }
}

test "effectiveBalanceIncrementsInit capacity rounding" {
    const allocator = std.testing.allocator;

    // Exactly 1024 validators
    {
        var increments = try effectiveBalanceIncrementsInit(allocator, 1024);
        defer increments.deinit(allocator);
        try std.testing.expectEqual(@as(usize, 1024), increments.items.len);
        try std.testing.expectEqual(@as(usize, 2048), increments.capacity);
    }

    // Just over 1024 boundary
    {
        var increments = try effectiveBalanceIncrementsInit(allocator, 1025);
        defer increments.deinit(allocator);
        try std.testing.expectEqual(@as(usize, 1025), increments.items.len);
        try std.testing.expectEqual(@as(usize, 2048), increments.capacity);
    }

    // Zero validators
    {
        var increments = try effectiveBalanceIncrementsInit(allocator, 0);
        defer increments.deinit(allocator);
        try std.testing.expectEqual(@as(usize, 0), increments.items.len);
    }
}
