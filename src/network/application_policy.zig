//! Beacon-node gossip defaults and resource shares.
const std = @import("std");
const ChainConfig = @import("config").ChainConfig;
const preset = @import("preset");
const p = preset.preset;
const gossip_options = @import("gossipsub/options.zig");
const topics = @import("gossipsub/topic_policy.zig");
const score = @import("gossipsub/score.zig");
const limits = @import("gossip_limits.zig");
const Kind = topics.Kind;
const mib = 1024 * 1024;

pub const Execution = struct {
    items: u32 = 4096,
    bytes: u32 = 64 * mib,
    concurrency: u32 = 16384,
};

pub fn gossip(chain: *const ChainConfig) !gossip_options.Options {
    const slot_ms = chain.SLOT_DURATION_MS;
    if (slot_ms == 0 or slot_ms > 86_400_000) return error.InvalidNetworkConfig;
    const epoch_ms = slot_ms * p.SLOTS_PER_EPOCH;
    return .{
        .heartbeat_interval_ms = 700,
        .iwant_followup_ms = 12_000,
        .idontwant_min_data_size = p.MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE,
        .validation_timeout_ms = 30_000,
        .validation_tombstone_ms = 30_000,
        .pressure_timeout_ms = 30_000,
        .tx_timeout_ms = 30_000,
        .active_send_timeout_ms = 6000,
        .active_send_items = activeSendItems(),
        .large_frame_timeout_ms = 6000,
        .receive_arena_bytes = 128 * mib,
        .seen_ttl_ms = slot_ms * p.SLOTS_PER_EPOCH * 2,
        .retained_score_ms = epoch_ms * 100,
        .opportunistic_graft_interval_ms = 42_000,
        .gossip_factor = 0.25,
        .score_params = .{
            .ip_colocation_threshold = 3,
            .behaviour_threshold = 6,
            .decay_interval_ms = slot_ms,
            .decay_to_zero = 0.01,
            .topic = .{ .weight = 0 },
        },
        .topic_params = @splat(.{ .params = unscored }),
    };
}

pub fn processor(boundaries: []const topics.Boundary, validators: u64) !limits.Limits {
    if (validators == 0 or validators > 9007199254740991) return error.InvalidNetworkConfig;
    const maxima = maximumSizes(boundaries);
    var result: limits.Limits = undefined;
    for (plan, maxima, 0..) |entry, maximum, i| {
        const compressed_max = 32 + maximum + maximum / 6;
        result[i] = .{ .items = entry.items, .bytes = std.mem.alignForward(u32, @max(compressed_max, entry.mib * mib), 4096) };
    }
    const att = @intFromEnum(Kind.beacon_attestation);
    const other_items = limits.items(&result) - result[att].items;
    const attesters = @ceil(@as(f64, @floatFromInt(validators)) / p.SLOTS_PER_EPOCH * 1.1);
    result[att].items = @intFromFloat(@min(@as(f64, @floatFromInt(limits.capacity_max - other_items)), @max(@as(f64, @floatFromInt(result[att].items)), attesters)));
    try limits.validate(&result);
    return result;
}

pub fn execution(boundaries: []const topics.Boundary, processing: *const limits.Limits, budget: Execution) !limits.Limits {
    if (budget.items == 0 or budget.items > 16384 or budget.bytes == 0 or budget.bytes > 1024 * mib or budget.concurrency == 0 or budget.concurrency > 16384) return error.InvalidGossipExecutionLimits;
    var item_total: u32 = 0;
    var byte_total: u32 = 0;
    for (plan) |entry| {
        item_total += entry.execution_items;
        byte_total += entry.execution_bytes;
    }
    const maxima = maximumSizes(boundaries);
    var result: limits.Limits = undefined;
    for (plan, maxima, 0..) |entry, maximum, i| {
        result[i] = .{
            .items = @min(processing[i].items, budget.concurrency, budget.items * entry.execution_items / item_total),
            .bytes = @intCast(@as(u64, budget.bytes) * entry.execution_bytes / byte_total),
        };
        if (result[i].items == 0 or result[i].bytes < maximum) return error.InvalidGossipExecutionLimits;
    }
    return result;
}

fn maximumSizes(boundaries: []const topics.Boundary) [topics.kind_count]u32 {
    std.debug.assert(boundaries.len <= topics.boundary_max);
    var result: [topics.kind_count]u32 = @splat(0);
    for (boundaries) |*boundary| for (boundary.rules, 0..) |rule, i| {
        result[i] = @max(result[i], rule.ssz_max);
    };
    return result;
}

fn activeSendItems() [topics.kind_count]u16 {
    var result: [topics.kind_count]u16 = @splat(8);
    result[@intFromEnum(Kind.data_column_sidecar)] = 256;
    return result;
}

const Plan = struct { items: u32, mib: u32, execution_items: u32, execution_bytes: u32 };
const plan: [topics.kind_count]Plan = blk: {
    var result: [topics.kind_count]Plan = undefined;
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
        .{ Kind.data_column_sidecar, 256, 16, 8, 24 },
        .{ Kind.execution_payload, 32, 24, 1, 32 },
        .{ Kind.payload_attestation_message, 1024, 2, 4, 1 },
        .{ Kind.execution_payload_bid, 128, 4, 2, 1 },
        .{ Kind.proposer_preferences, 128, 1, 1, 1 },
        .{ Kind.inclusion_list, 128, 2, 2, 1 },
    };
    for (entries) |entry| result[@intFromEnum(entry[0])] = .{ .items = entry[1], .mib = entry[2], .execution_items = entry[3], .execution_bytes = entry[4] };
    break :blk result;
};

const unscored: score.TopicParams = .{
    .weight = 0,
    .time_in_mesh_weight = 1,
    .time_in_mesh_cap = 3600,
    .time_in_mesh_quantum_ms = 1,
    .first_delivery_weight = 1,
    .first_delivery_cap = 2000,
    .first_delivery_decay = 0.5,
    .mesh_delivery_weight = -1,
    .mesh_delivery_threshold = 20,
    .mesh_delivery_cap = 100,
    .mesh_delivery_decay = 0.5,
    .mesh_delivery_activation_ms = 5000,
    .mesh_delivery_window_ms = 10,
    .mesh_failure_weight = -1,
    .mesh_failure_decay = 0.5,
    .invalid_weight = -1,
    .invalid_decay = 0.3,
};

test {
    _ = @import("application_policy_test.zig");
}
