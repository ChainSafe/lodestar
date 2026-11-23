const std = @import("std");
const limits = @import("limits.zig");

test "gossip limits reject invalid shares and aggregate bounds" {
    for ([_]limits.Limit{
        .{ .items = 1, .bytes = 4096 },
        .{ .items = 8, .bytes = 4097 },
        .{ .items = 65535, .bytes = 4096 },
        .{ .items = 8, .bytes = 32 * 1024 * 1024 },
    }) |limit| {
        const invalid: limits.Limits = @splat(limit);
        try std.testing.expectError(error.InvalidGossipProcessorLimits, limits.validate(&invalid));
    }
    const valid: limits.Limits = @splat(.{ .items = 8, .bytes = 4096 });
    try limits.validate(&valid);
    try std.testing.expectEqual(@as(usize, 2), limits.sourceItems(.beacon_block, .{ .items = 32, .bytes = 4096 }));
    try std.testing.expectEqual(@as(usize, 2), limits.sourceItems(.execution_payload, .{ .items = 32, .bytes = 4096 }));
    try std.testing.expectEqual(@as(usize, 16), limits.sourceItems(.data_column_sidecar, .{ .items = 32, .bytes = 4096 }));
}

test "post-Electra attestation count and byte limits accommodate the same slot burst" {
    for ([_]u32{ 0, 1_000_000, std.math.maxInt(u32) }) |validators| {
        const budgets = limits.queueLimits(validators);
        try limits.validate(&budgets);
        const att = budgets[@intFromEnum(limits.Kind.beacon_attestation)];
        try std.testing.expect(att.bytes >= att.items * (limits.single_attestation_bytes + limits.context_max));
    }
}
