const std = @import("std");
const policy = @import("application_policy.zig");
const limits = @import("gossip_limits.zig");
const p = @import("preset").preset;

test "application IDONTWANT threshold follows the preset independently of chain timing" {
    const expected: usize = if (preset.active_preset == .minimal) 1462 else 16829;
    for ([_]*const config.BeaconConfig{ &config.mainnet.config, &config.minimal.config, &config.gnosis.config }) |beacon| {
        const gossip = try policy.gossip(&beacon.chain);
        try std.testing.expectEqual(expected, gossip.idontwant_min_data_size);
    }
}

test "application policy bounds validator-driven work and execution shares" {
    for ([_]u64{ 1, 16, 1_000_000, 3_000_000, 9007199254740991 }) |validators| {
        const processor = try policy.processor(&.{}, validators);
        try std.testing.expect(limits.items(&processor) <= limits.capacity_max);
        const execution = try policy.execution(&.{}, &processor, .{});
        for (processor, execution) |queued, running| {
            try std.testing.expect(running.items > 0 and running.items <= queued.items);
        }
        const gossip = try policy.gossip(&config.mainnet.config.chain);
        try std.testing.expectEqual(12_000 * p.SLOTS_PER_EPOCH * 2, gossip.seen_ttl_ms);
    }
    const processor = try policy.processor(&.{}, 16);
    try std.testing.expectError(error.InvalidGossipExecutionLimits, policy.execution(&.{}, &processor, .{ .items = 1 }));
    const invalid = config.mainnet.config.chain.merge(.{ .SLOT_DURATION_MS = 0 });
    try std.testing.expectError(error.InvalidNetworkConfig, policy.gossip(&invalid));
}

test "application seen retention follows the slot duration" {
    for ([_]u64{ 6000, 24000 }) |duration_ms| {
        const configured = config.mainnet.config.chain.merge(.{ .SLOT_DURATION_MS = duration_ms });
        const gossip = try policy.gossip(&configured);
        try std.testing.expectEqual(duration_ms * p.SLOTS_PER_EPOCH * 2, gossip.seen_ttl_ms);
    }
    for ([_]u64{ 0, 86_400_001, std.math.maxInt(u64) }) |duration_ms| {
        const invalid = config.mainnet.config.chain.merge(.{ .SLOT_DURATION_MS = duration_ms });
        try std.testing.expectError(error.InvalidNetworkConfig, policy.gossip(&invalid));
    }
}

const topics = @import("gossipsub/topic_policy.zig");
const preset = @import("preset");

const config = @import("config");
const chain = @import("chain.zig");

test "application Gloas shares admit every configured topic maximum within the total budget" {
    var input = if (preset.active_preset == .minimal) config.minimal.chain_config else config.mainnet.chain_config;
    input.ALTAIR_FORK_EPOCH = 0;
    input.BELLATRIX_FORK_EPOCH = 0;
    input.CAPELLA_FORK_EPOCH = 0;
    input.DENEB_FORK_EPOCH = 0;
    input.ELECTRA_FORK_EPOCH = 0;
    input.FULU_FORK_EPOCH = 0;
    input.GLOAS_FORK_EPOCH = 0;
    input.BLOB_SCHEDULE = &.{};
    input.MAX_PAYLOAD_SIZE = @import("gossipsub/constants.zig").MAX_PAYLOAD_SIZE;
    const beacon = config.BeaconConfig.init(input, @splat(0));
    const derived = try chain.Config.init(&beacon, true);
    const boundaries = derived.topics[0..derived.boundary_count];
    const processing = try policy.processor(boundaries, 1_000_000);
    const budget: policy.Execution = .{};
    const execution = try policy.execution(boundaries, &processing, budget);
    try std.testing.expect(limits.bytes(&execution) <= budget.bytes);
    try std.testing.expect(limits.items(&execution) <= budget.items);
    for (boundaries) |boundary| for (boundary.rules, execution) |rule, share| {
        try std.testing.expect(share.bytes >= rule.ssz_max);
    };
}
