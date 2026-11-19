const std = @import("std");
pub const Kind = enum(u8) {
    beacon_block,
    beacon_aggregate_and_proof,
    beacon_attestation,
    proposer_slashing,
    attester_slashing,
    voluntary_exit,
    sync_committee_contribution_and_proof,
    sync_committee,
    light_client_finality_update,
    light_client_optimistic_update,
    bls_to_execution_change,
    data_column_sidecar,
    execution_payload,
    payload_attestation_message,
    execution_payload_bid,
    proposer_preferences,
    inclusion_list,
};
pub const kind_count = @typeInfo(Kind).@"enum".fields.len;
pub const capacity_max = 65535;
pub const context_max = 1024;
pub const single_attestation_bytes: u32 = @import("consensus_types").electra.SingleAttestation.fixed_size;
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

pub const priority = [_]Kind{ .beacon_block, .execution_payload, .data_column_sidecar, .beacon_aggregate_and_proof, .voluntary_exit, .bls_to_execution_change, .beacon_attestation, .proposer_slashing, .attester_slashing, .sync_committee_contribution_and_proof, .sync_committee, .light_client_finality_update, .light_client_optimistic_update, .payload_attestation_message, .execution_payload_bid, .proposer_preferences, .inclusion_list };

comptime {
    std.debug.assert(priority.len == kind_count);
    var seen = std.StaticBitSet(kind_count).empty;
    for (priority) |kind| {
        std.debug.assert(!seen.isSet(@intFromEnum(kind)));
        seen.set(@intFromEnum(kind));
    }
}

pub fn urgent(kind: Kind) bool {
    return kind == .beacon_block or kind == .execution_payload or kind == .data_column_sidecar;
}

pub fn newestFirst(kind: Kind) bool {
    return switch (kind) {
        .beacon_attestation, .beacon_aggregate_and_proof, .sync_committee, .sync_committee_contribution_and_proof => true,
        else => false,
    };
}

pub fn sourceItems(kind: Kind, limit: Limit) usize {
    return if (kind == .beacon_block or kind == .execution_payload) 2 else @max(1, limit.items / 2);
}

pub const dependency_search_slots = .{ .past = 2, .future = 1 };
const waiting_column_slots = dependency_search_slots.past + 1 + dependency_search_slots.future;

pub const Plan = struct { items: u32, mib: u32, execution_items: u32, execution_bytes: u32 };
pub const plan: [kind_count]Plan = blk: {
    var result: [kind_count]Plan = undefined;
    const entries = .{
        .{ Kind.beacon_block, 32, 24, 1, 32 },
        .{ Kind.beacon_aggregate_and_proof, 2048, 8, 8, 4 },
        .{ Kind.beacon_attestation, 128, 8, 32, 8 },
        .{ Kind.proposer_slashing, 32, 1, 1, 1 },
        .{ Kind.attester_slashing, 32, 4, 1, 4 },
        .{ Kind.voluntary_exit, 128, 1, 1, 1 },
        .{ Kind.sync_committee_contribution_and_proof, 128, 2, 2, 2 },
        .{ Kind.sync_committee, 1024, 2, 4, 2 },
        .{ Kind.light_client_finality_update, 8, 2, 1, 2 },
        .{ Kind.light_client_optimistic_update, 8, 2, 1, 2 },
        .{ Kind.bls_to_execution_change, 128, 1, 1, 1 },
        // Half the lane may wait. A supernode can receive a full column set for each searchable slot.
        .{ Kind.data_column_sidecar, 2 * waiting_column_slots * @import("preset").NUMBER_OF_COLUMNS, 48, 8, 24 },
        .{ Kind.execution_payload, 32, 24, 1, 32 },
        .{ Kind.payload_attestation_message, 1024, 2, 4, 1 },
        .{ Kind.execution_payload_bid, 128, 4, 2, 1 },
        .{ Kind.proposer_preferences, 128, 1, 1, 1 },
        .{ Kind.inclusion_list, 128, 2, 2, 1 },
    };
    for (entries) |entry| result[@intFromEnum(entry[0])] = .{ .items = entry[1], .mib = entry[2], .execution_items = entry[3], .execution_bytes = entry[4] };
    break :blk result;
};

pub fn queueLimits(validators: u32) Limits {
    var result: Limits = undefined;
    for (plan, &result) |entry, *limit| limit.* = .{ .items = entry.items, .bytes = entry.mib * 1024 * 1024 };
    const att = &result[@intFromEnum(Kind.beacon_attestation)];
    const remaining = capacity_max - (items(&result) - att.items);
    const slots = @import("preset").preset.SLOTS_PER_EPOCH;
    const expected = std.math.divCeil(u64, @as(u64, validators) * 11, slots * 10) catch unreachable;
    att.items = @intCast(@min(remaining, @max(att.items, expected)));
    // Both bytes and receipts count against admission. The byte limit must accommodate
    // one full slot of SingleAttestations even when every receipt is at its bound.
    att.bytes = @max(att.bytes, std.mem.alignForward(u32, att.items * (single_attestation_bytes + context_max), 4096));
    return result;
}
pub fn executionLimits(limits: *const Limits, concurrency: u32) Limits {
    var result: Limits = undefined;
    var total_items: u32 = 0;
    var total_bytes: u32 = 0;
    for (plan) |entry| {
        total_items += entry.execution_items;
        total_bytes += entry.execution_bytes;
    }
    for (plan, limits, &result) |entry, limit, *execution| execution.* = .{
        .items = @min(limit.items, concurrency, 4096 * entry.execution_items / total_items),
        .bytes = @intCast(@as(u64, 64 * 1024 * 1024) * entry.execution_bytes / total_bytes),
    };
    return result;
}

test {
    _ = @import("limits_test.zig");
}
