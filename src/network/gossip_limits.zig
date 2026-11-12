const std = @import("std");
pub const Kind = @import("gossipsub/topic.zig").Kind;
pub const kind_count = @typeInfo(Kind).@"enum".fields.len;
pub const capacity_max = 65535;
pub const Limit = struct { items: u32, bytes: u32 };
pub const Limits = [kind_count]Limit;

pub fn validate(limits: *const Limits) !void {
    var item_count: usize = 0;
    var byte_count: usize = 0;
    for (limits) |limit| {
        if (limit.items < 2 or limit.items > capacity_max or limit.bytes < 4096 or limit.bytes % 4096 != 0) return error.InvalidGossipProcessorLimits;
        item_count += limit.items;
        byte_count += limit.bytes;
    }
    if (item_count > capacity_max or byte_count > 256 * 1024 * 1024) return error.InvalidGossipProcessorLimits;
}

pub fn items(limits: *const Limits) usize {
    var total: usize = 0;
    for (limits) |limit| total += limit.items;
    return total;
}

pub fn bytes(limits: *const Limits) usize {
    var total: usize = 0;
    for (limits) |limit| total += limit.bytes;
    return total;
}

pub const priority = [_]Kind{ .beacon_block, .execution_payload, .blob_sidecar, .data_column_sidecar, .beacon_aggregate_and_proof, .voluntary_exit, .bls_to_execution_change, .beacon_attestation, .proposer_slashing, .attester_slashing, .sync_committee_contribution_and_proof, .sync_committee, .light_client_finality_update, .light_client_optimistic_update, .payload_attestation_message, .execution_payload_bid, .proposer_preferences };

comptime {
    std.debug.assert(priority.len == kind_count);
    var seen = std.StaticBitSet(kind_count).empty;
    for (priority) |kind| {
        std.debug.assert(!seen.isSet(@intFromEnum(kind)));
        seen.set(@intFromEnum(kind));
    }
}

pub fn urgent(kind: Kind) bool {
    return kind == .beacon_block or kind == .execution_payload or kind == .blob_sidecar or kind == .data_column_sidecar;
}

pub fn newestFirst(kind: Kind) bool {
    return switch (kind) {
        .beacon_attestation, .beacon_aggregate_and_proof, .sync_committee, .sync_committee_contribution_and_proof => true,
        else => false,
    };
}

pub fn sourceItems(limit: Limit) usize {
    return @max(1, limit.items / 2);
}

pub fn sourceBytes(limit: Limit, maximum_message: usize, inline_bytes: usize) usize {
    return @max((@as(usize, limit.bytes) + @as(usize, limit.items) * inline_bytes) / 2, maximum_message);
}

test "gossip limits reject invalid shares and aggregate bounds" {
    for ([_]Limit{
        .{ .items = 1, .bytes = 4096 },
        .{ .items = 8, .bytes = 4097 },
        .{ .items = 65535, .bytes = 4096 },
        .{ .items = 8, .bytes = 32 * 1024 * 1024 },
    }) |limit| {
        const invalid: Limits = @splat(limit);
        try std.testing.expectError(error.InvalidGossipProcessorLimits, validate(&invalid));
    }
    const valid: Limits = @splat(.{ .items = 8, .bytes = 4096 });
    try validate(&valid);
}
