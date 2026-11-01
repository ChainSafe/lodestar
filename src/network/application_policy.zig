//! Beacon-node gossip defaults and resource shares.
const std = @import("std");
const ChainConfig = @import("config").ChainConfig;
const preset = @import("preset");
const p = preset.preset;
const constants = @import("constants");
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

pub fn gossip(chain: *const ChainConfig, validators: u64) !gossip_options.Options {
    const slot_ms = chain.SLOT_DURATION_MS;
    if (validators == 0 or validators > 9007199254740991) return error.InvalidNetworkConfig;
    for ([_]u64{ slot_ms, chain.SLOT_DURATION_MS_HEZE }) |duration| {
        if (duration == 0 or duration > 86_400_000) return error.InvalidNetworkConfig;
    }
    var max_slot_ms = slot_ms;
    if (chain.HEZE_FORK_EPOCH != std.math.maxInt(u64)) {
        max_slot_ms = @max(max_slot_ms, chain.SLOT_DURATION_MS_HEZE);
    }
    const epoch_ms = slot_ms * p.SLOTS_PER_EPOCH;
    const behaviour_decay = decay(10 * p.SLOTS_PER_EPOCH);
    const target = (10.0 / @as(f64, p.SLOTS_PER_EPOCH)) / (1 - behaviour_decay) - 6;
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
        .seen_ttl_ms = max_slot_ms * p.SLOTS_PER_EPOCH * 2,
        .retained_score_ms = epoch_ms * 100,
        .opportunistic_graft_interval_ms = 42_000,
        .gossip_factor = 0.25,
        .score_params = .{
            .ip_colocation_weight = -max_positive_score * 0.5,
            .ip_colocation_threshold = 3,
            .behaviour_weight = -4000 / (target * target),
            .behaviour_threshold = 6,
            .behaviour_decay = behaviour_decay,
            .topic_cap = max_positive_score * 0.5,
            .decay_interval_ms = slot_ms,
            .decay_to_zero = 0.01,
            .topic = .{ .weight = 0 },
        },
        .topic_params = topicScores(slot_ms, validators),
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
    result[@intFromEnum(Kind.blob_sidecar)] = 32;
    result[@intFromEnum(Kind.data_column_sidecar)] = 256;
    return result;
}

const Plan = struct { items: u32, mib: u32, execution_items: u32, execution_bytes: u32 };
const plan: [topics.kind_count]Plan = blk: {
    var result: [topics.kind_count]Plan = undefined;
    const entries = .{
        .{ Kind.beacon_block, 8, 24, 1, 32 },
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
        .{ Kind.blob_sidecar, 256, 8, 4, 8 },
        .{ Kind.data_column_sidecar, 256, 16, 8, 24 },
        .{ Kind.execution_payload, 8, 24, 1, 32 },
        .{ Kind.payload_attestation_message, 1024, 2, 4, 1 },
        .{ Kind.execution_payload_bid, 128, 4, 2, 1 },
        .{ Kind.proposer_preferences, 128, 1, 1, 1 },
    };
    for (entries) |entry| result[@intFromEnum(entry[0])] = .{ .items = entry[1], .mib = entry[2], .execution_items = entry[3], .execution_bytes = entry[4] };
    break :blk result;
};

// Lodestar includes the Gloas topic weights in this cap even before that fork activates.
const max_positive_score = 50 * (0.5 + 0.5 + 1 + 0.05 + 0.05 + 0.05 + 0.05 + 0.5 + 0.05 + 0.05 + 0.05);

fn topicScores(slot_ms: u64, validators: u64) [topics.kind_count]score.TopicPolicy {
    const slots: f64 = p.SLOTS_PER_EPOCH;
    const subnets: f64 = constants.ATTESTATION_SUBNET_COUNT;
    const committees: u64 = @max(1, @min(p.MAX_COMMITTEES_PER_SLOT, validators / p.SLOTS_PER_EPOCH / p.TARGET_COMMITTEE_SIZE));
    const multiple_bursts = committees * p.SLOTS_PER_EPOCH >= 2 * constants.ATTESTATION_SUBNET_COUNT;
    var result: [topics.kind_count]score.TopicPolicy = @splat(.{ .params = unscored });
    result[@intFromEnum(Kind.beacon_block)] = topicScore(slot_ms, &.{
        .weight = 0.5,
        .rate = 1,
        .first_epochs = 20,
        .mesh_slots = 5 * p.SLOTS_PER_EPOCH,
        .mesh_cap_factor = 3,
        .activation_ms = slot_ms * p.SLOTS_PER_EPOCH,
    });
    result[@intFromEnum(Kind.execution_payload)] = result[@intFromEnum(Kind.beacon_block)];
    result[@intFromEnum(Kind.payload_attestation_message)] = topicScore(slot_ms, &.{ .weight = 0.05, .rate = p.PTC_SIZE, .first_epochs = 100 });
    result[@intFromEnum(Kind.execution_payload_bid)] = topicScore(slot_ms, &.{ .weight = 0.05, .rate = 1024, .first_epochs = 100 });
    result[@intFromEnum(Kind.proposer_preferences)] = topicScore(slot_ms, &.{ .weight = 0.05, .rate = 64 / slots, .first_epochs = 100 });
    result[@intFromEnum(Kind.beacon_aggregate_and_proof)] = topicScore(slot_ms, &.{
        .weight = 0.5,
        .rate = aggregatorsPerSlot(validators, committees),
        .first_epochs = 1,
        .mesh_slots = 2 * p.SLOTS_PER_EPOCH,
        .mesh_cap_factor = 4,
        .activation_ms = slot_ms * p.SLOTS_PER_EPOCH,
    });
    const activation_slots: u64 = if (multiple_bursts) p.SLOTS_PER_EPOCH / 2 + 1 else p.SLOTS_PER_EPOCH;
    result[@intFromEnum(Kind.beacon_attestation)] = topicScore(slot_ms, &.{
        .weight = 1 / subnets,
        .rate = @as(f64, @floatFromInt(validators)) / subnets / slots,
        .first_epochs = if (multiple_bursts) 1 else 4,
        .mesh_slots = (if (multiple_bursts) @as(u64, 4) else 16) * p.SLOTS_PER_EPOCH,
        .mesh_cap_factor = 16,
        .activation_ms = slot_ms * activation_slots,
    });
    inline for (.{ Kind.voluntary_exit, Kind.bls_to_execution_change }) |kind| result[@intFromEnum(kind)] = topicScore(slot_ms, &.{ .weight = 0.05, .rate = 4 / slots, .first_epochs = 100 });
    inline for (.{ Kind.proposer_slashing, Kind.attester_slashing }) |kind| result[@intFromEnum(kind)] = topicScore(slot_ms, &.{ .weight = 0.05, .rate = 1.0 / 5.0 / slots, .first_epochs = 100 });
    return result;
}

fn aggregatorsPerSlot(validators: u64, committees: u64) f64 {
    const per_epoch = committees * p.SLOTS_PER_EPOCH;
    const smaller = validators / per_epoch;
    const larger_count = validators - smaller * per_epoch;
    const small_modulo = @max(1, smaller / constants.TARGET_AGGREGATORS_PER_COMMITTEE);
    const large_modulo = @max(1, (smaller + 1) / constants.TARGET_AGGREGATORS_PER_COMMITTEE);
    const small = @floor(@as(f64, @floatFromInt(smaller)) / @as(f64, @floatFromInt(small_modulo)) * @as(f64, @floatFromInt(per_epoch - larger_count)));
    const large = @floor(@as(f64, @floatFromInt(smaller + 1)) / @as(f64, @floatFromInt(large_modulo)) * @as(f64, @floatFromInt(larger_count)));
    return @max(1, @floor((small + large) / p.SLOTS_PER_EPOCH));
}

const TopicInput = struct {
    weight: f64,
    rate: f64,
    first_epochs: u64,
    mesh_slots: u64 = 0,
    mesh_cap_factor: f64 = 0,
    activation_ms: u64 = 0,
};

fn topicScore(slot_ms: u64, input: *const TopicInput) score.TopicPolicy {
    const time_cap = 3600 / (@as(f64, @floatFromInt(slot_ms)) / 1000);
    const first_decay = decay(input.first_epochs * p.SLOTS_PER_EPOCH);
    const first_cap = (2 * input.rate / 8) / (1 - first_decay);
    const mesh_decay = if (input.mesh_slots > 0) decay(input.mesh_slots) else 0;
    const threshold = if (input.mesh_slots > 0) (input.rate / 50) / (1 - mesh_decay) * mesh_decay else 0;
    const mesh_weight = if (input.mesh_slots > 0) -max_positive_score / (input.weight * threshold * threshold) else 0;
    return .{ .mesh_delivery_start_slot = if (input.mesh_slots > 0) input.mesh_slots + 1 else 0, .params = .{
        .weight = input.weight,
        .time_in_mesh_weight = 10 / time_cap,
        .time_in_mesh_cap = time_cap,
        .time_in_mesh_quantum_ms = slot_ms,
        .first_delivery_weight = 40 / first_cap,
        .first_delivery_cap = first_cap,
        .first_delivery_decay = first_decay,
        .mesh_delivery_weight = mesh_weight,
        .mesh_delivery_threshold = threshold,
        .mesh_delivery_cap = if (input.mesh_slots > 0) @max(input.mesh_cap_factor * threshold, 2) else 0,
        .mesh_delivery_decay = mesh_decay,
        .mesh_delivery_activation_ms = input.activation_ms,
        .mesh_delivery_window_ms = if (input.mesh_slots > 0) 12_000 else 0,
        .mesh_failure_weight = mesh_weight,
        .mesh_failure_decay = mesh_decay,
        .invalid_weight = -max_positive_score / input.weight,
        .invalid_decay = decay(50 * p.SLOTS_PER_EPOCH),
    } };
}

fn decay(slots: u64) f64 {
    return std.math.pow(f64, 0.01, 1 / @as(f64, @floatFromInt(slots)));
}

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
