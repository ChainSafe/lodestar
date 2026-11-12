const std = @import("std");
const Now = @import("types.zig").Now;
const config = @import("config");
const preset = @import("preset");
const constants = @import("constants");
const chain = @import("chain.zig");
const topics = @import("gossipsub/topic_policy.zig");
const rr = @import("reqresp/ReqResp.zig");
const LocalState = @import("peers/types.zig").LocalState;
const consensus_types = @import("consensus_types");
const test_support = @import("gossipsub/test_support.zig");

fn fixture() config.ChainConfig {
    var result = if (preset.active_preset == .minimal) config.minimal.chain_config else config.mainnet.chain_config;
    result.ALTAIR_FORK_EPOCH = 0;
    result.BELLATRIX_FORK_EPOCH = 0;
    result.CAPELLA_FORK_EPOCH = 0;
    result.DENEB_FORK_EPOCH = 0;
    result.ELECTRA_FORK_EPOCH = 2;
    result.FULU_FORK_EPOCH = 3;
    result.GLOAS_FORK_EPOCH = constants.FAR_FUTURE_EPOCH;
    result.BLOB_SCHEDULE = &.{ .{ .EPOCH = 3, .MAX_BLOBS_PER_BLOCK = 33 }, .{ .EPOCH = 8, .MAX_BLOBS_PER_BLOCK = 40 } };
    return result;
}

test "network chain resolves same epoch forks BPO contexts and clock identity" {
    var cfg = config.BeaconConfig.init(fixture(), @splat(1));
    const chain_config = try chain.Config.init(&cfg, false);
    try std.testing.expectEqual(@as(u8, 4), chain_config.boundary_count);
    try std.testing.expectEqual(@as(?[4]u8, null), chain_config.phase0_digest);
    const local: LocalState = .{ .metadata = .{ .custody_group_count = 8 }, .status = .{ .head_slot = 1, .earliest_available_slot = 0 } };
    const genesis = try chain_config.update(local, null, 0);
    try std.testing.expectEqual(.deneb, genesis.local.fork.fork);
    try std.testing.expectEqual(@as(u64, 2), genesis.schedule.next_epoch);
    const fulu = try chain_config.update(local, null, 3 * preset.preset.SLOTS_PER_EPOCH);
    try std.testing.expectEqual(.fulu, fulu.local.fork.fork);
    try std.testing.expectEqual(cfg.chain.CUSTODY_REQUIREMENT, fulu.local.fork.custody_requirement);
    try std.testing.expectEqual(@as(u16, 0), genesis.local.fork.custody_requirement);
    try std.testing.expectEqual(@as(u64, 1), fulu.local.status.head_slot);
    try std.testing.expectEqual(config.fork_digest.computeForkDigest(&cfg, 3), fulu.local.status.fork_digest);
    try std.testing.expectEqual(cfg.chain.FULU_FORK_VERSION, fulu.schedule.next_version);
    try std.testing.expectEqual(@as(u64, 8), fulu.schedule.next_epoch);
    try std.testing.expectEqual(config.fork_digest.computeForkDigest(&cfg, 8), fulu.schedule.next_digest);
    try std.testing.expect(fulu.capabilities.request.contains(.{ .reqresp = .light_client_bootstrap_v1 }));
    try std.testing.expect(!fulu.capabilities.receive.contains(.{ .reqresp = .light_client_bootstrap_v1 }));
    const bpo = try chain_config.update(local, null, 8 * preset.preset.SLOTS_PER_EPOCH);
    try std.testing.expectEqual(.fulu, bpo.local.fork.fork);
    try std.testing.expect(!std.mem.eql(u8, &fulu.local.fork.digest, &bpo.local.fork.digest));
    try std.testing.expectEqual(fulu.local.fork.digest, chain_config.forks[2].digest);
    try std.testing.expectEqual(bpo.local.fork.digest, chain_config.forks[3].digest);
    try std.testing.expectEqual(.deneb, chain_config.topics[0].fork.?);
    try std.testing.expectEqual(@as(u64, 0), chain_config.topics[0].epoch);
    try std.testing.expectEqual(.fulu, chain_config.topics[2].fork.?);
    try std.testing.expectEqual(@as(u64, 3), chain_config.topics[2].epoch);
    try std.testing.expectEqual(.fulu, chain_config.topics[3].fork.?);
    try std.testing.expectEqual(@as(u64, 8), chain_config.topics[3].epoch);
    try std.testing.expectEqual(constants.FAR_FUTURE_EPOCH, bpo.schedule.next_epoch);
    try std.testing.expectEqualDeep(bpo, try chain_config.update(local, null, 11 * preset.preset.SLOTS_PER_EPOCH));
    cfg = config.BeaconConfig.init(fixture(), @splat(2));
    try std.testing.expectEqualDeep(fulu, try chain_config.update(local, null, 3 * preset.preset.SLOTS_PER_EPOCH));
}

test "network chain activates Gloas and rejects the next unsupported fork" {
    var input = fixture();
    input.ELECTRA_FORK_EPOCH = 0;
    input.FULU_FORK_EPOCH = 0;
    input.GLOAS_FORK_EPOCH = 3;
    input.HEZE_FORK_EPOCH = 12;
    const cfg = config.BeaconConfig.init(input, @splat(0));
    const derived = try chain.Config.init(&cfg, true);
    const local: LocalState = .{ .metadata = .{ .custody_group_count = 8 }, .status = .{ .earliest_available_slot = 0 } };
    const before = try derived.update(local, null, 2 * preset.preset.SLOTS_PER_EPOCH);
    try std.testing.expectEqual(input.GLOAS_FORK_VERSION, before.schedule.next_version);
    try std.testing.expectEqual(@as(u64, 3), before.schedule.next_epoch);
    const active = try derived.update(local, null, 3 * preset.preset.SLOTS_PER_EPOCH);
    try std.testing.expectEqual(.gloas, active.local.fork.fork);
    try std.testing.expect(active.capabilities.receive.contains(.{ .reqresp = .execution_payload_envelopes_by_range_v1 }));
    try std.testing.expect(active.capabilities.request.contains(.{ .reqresp = .execution_payload_envelopes_by_root_v1 }));
    const bpo = try derived.update(local, null, 8 * preset.preset.SLOTS_PER_EPOCH);
    try std.testing.expectEqual(.gloas, bpo.local.fork.fork);
    try std.testing.expect(!std.mem.eql(u8, &active.local.fork.digest, &bpo.local.fork.digest));
    try std.testing.expectEqual(input.HEZE_FORK_VERSION, bpo.schedule.next_version);
    try std.testing.expectEqual(config.fork_digest.computeForkDigestForVersion(&cfg, 12, input.HEZE_FORK_VERSION), bpo.schedule.next_digest);
    try std.testing.expectError(error.UnsupportedNetworkFork, derived.update(local, null, 12 * preset.preset.SLOTS_PER_EPOCH));
    for (derived.topics[0..derived.boundary_count]) |boundary| {
        const gloas = boundary.fork.? == .gloas;
        inline for (.{ topics.Kind.execution_payload, topics.Kind.payload_attestation_message, topics.Kind.execution_payload_bid, topics.Kind.proposer_preferences }) |kind|
            try std.testing.expectEqual(@as(u16, @intFromBool(gloas)), boundary.rules[@intFromEnum(kind)].count);
        if (!gloas) continue;
        try std.testing.expectEqual(preset.preset.MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE, boundary.rules[@intFromEnum(topics.Kind.beacon_aggregate_and_proof)].ssz_max);
        try std.testing.expectEqual(preset.preset.MAX_ATTESTER_SLASHING_SIZE, boundary.rules[@intFromEnum(topics.Kind.attester_slashing)].ssz_max);
        try std.testing.expectEqual(preset.preset.MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE, boundary.rules[@intFromEnum(topics.Kind.execution_payload_bid)].ssz_max);
        try std.testing.expectEqual(@as(u32, 56 + 40 * 2096), boundary.rules[@intFromEnum(topics.Kind.data_column_sidecar)].ssz_max);
    }
    const request = derived.requestPolicy();
    var requests = try rr.init(std.testing.allocator, .{ .forks = derived.forks[0..derived.boundary_count], .admission = try rr.Options.Admission.defaults(&request, 1) });
    defer requests.deinit();
    try std.testing.expectEqual(@as(usize, 56 + 40 * 2096), (try requests.responseBounds(.data_column_sidecars_by_root_v1, .gloas)).max);
    try std.testing.expectError(error.InvalidResponseContext, requests.responseBounds(.execution_payload_envelopes_by_root_v1, .fulu));
    try std.testing.expectEqual(consensus_types.gloas.SignedExecutionPayloadEnvelope.min_size, (try requests.responseBounds(.execution_payload_envelopes_by_root_v1, .gloas)).min);
}

test "network chain derives fixed request storage and historical blob limits independently of BPO" {
    const cfg = config.BeaconConfig.init(fixture(), @splat(0));
    const chain_config = try chain.Config.init(&cfg, true);
    try std.testing.expectEqual(@as(usize, 768 * 40), chain_config.policy.requestBounds(.blob_sidecars_by_root_v1, .deneb).request_max);
    try std.testing.expectEqual(@as(usize, 1152 * 40), chain_config.policy.requestBounds(.blob_sidecars_by_root_v1, .fulu).request_max);
    const maximum = 128 * (40 + 8 * preset.NUMBER_OF_COLUMNS);
    try std.testing.expectEqual(@as(usize, maximum), chain_config.policy.requestMax());
    const policy = chain_config.requestPolicy();
    var requests = try rr.init(std.testing.allocator, .{ .forks = chain_config.forks[0..chain_config.boundary_count], .admission = try rr.Options.Admission.defaults(&policy, 1), .serving_max = 6, .inbound_per_connection_max = 8 });
    defer requests.deinit();
    const bytes = requests.memoryPlan().total_bytes;
    for ([_]config.ForkSeq{ .deneb, .electra, .fulu }) |fork| {
        requests.setRequestFork(fork);
        try std.testing.expectEqual(bytes, requests.memoryPlan().total_bytes);
    }
    var range = [_]u8{0} ** 16;
    std.mem.writeInt(u64, range[0..8], 3 * preset.preset.SLOTS_PER_EPOCH, .little);
    std.mem.writeInt(u64, range[8..16], 128, .little);
    try std.testing.expectEqual(@as(u32, 0), (try chain_config.policy.inspect(.blob_sidecars_by_range_v1, &range, .fulu)).chunks_max);
    const fulu_topics = chain_config.topics[2].rules;
    try std.testing.expectEqual(@as(u16, 0), fulu_topics[@intFromEnum(topics.Kind.blob_sidecar)].count);
    try std.testing.expectEqual(@as(u16, 128), fulu_topics[@intFromEnum(topics.Kind.data_column_sidecar)].count);
}

test "network chain validates schedule and chain namespace before owner allocation" {
    var input = fixture();
    input.ELECTRA_FORK_EPOCH = 4;
    var cfg = config.BeaconConfig.init(input, @splat(0));
    try std.testing.expectError(error.InvalidNetworkChain, chain.Config.init(&cfg, false));
    input = fixture();
    input.BLOB_SCHEDULE = &.{ .{ .EPOCH = 5, .MAX_BLOBS_PER_BLOCK = 40 }, .{ .EPOCH = 3, .MAX_BLOBS_PER_BLOCK = 33 } };
    cfg = config.BeaconConfig.init(input, @splat(0));
    try std.testing.expectError(error.InvalidNetworkChain, chain.Config.init(&cfg, false));
    input = fixture();
    input.DATA_COLUMN_SIDECAR_SUBNET_COUNT = 129;
    cfg = config.BeaconConfig.init(input, @splat(0));
    try std.testing.expectError(error.InvalidTopicPolicy, chain.Config.init(&cfg, false));
}

test "network chain honors configured wire limits and requires complete metadata before unscheduled Fulu" {
    var input = fixture();
    input.FULU_FORK_EPOCH = constants.FAR_FUTURE_EPOCH;
    input.GLOAS_FORK_EPOCH = constants.FAR_FUTURE_EPOCH;
    input.BLOB_SCHEDULE = &.{};
    input.MAX_REQUEST_BLOCKS = 16;
    input.MAX_REQUEST_BLOCKS_DENEB = 8;
    input.MAX_REQUEST_BLOB_SIDECARS = 2;
    input.MAX_REQUEST_BLOB_SIDECARS_ELECTRA = 3;
    input.MAX_PAYLOAD_SIZE = 1024 * 1024;
    const cfg = config.BeaconConfig.init(input, @splat(0));
    const chain_config = try chain.Config.init(&cfg, false);
    try std.testing.expectError(error.MissingCustodyAdvertisement, chain_config.update(.{}, null, 0));
    const update = try chain_config.update(.{ .metadata = .{ .custody_group_count = 1 } }, null, 0);
    try std.testing.expect(update.capabilities.receive.contains(.{ .reqresp = .metadata_v3 }));
    const wire = @import("control_wire.zig");
    var encoded: [25]u8 = undefined;
    try std.testing.expectEqual(encoded.len, try wire.encodeMetadata(.metadata_v3, &update.local.metadata, update.local.fork, &encoded));
    try std.testing.expectEqualDeep(update.local.metadata, try wire.decodeMetadata(.metadata_v3, &encoded, update.local.fork));
    const policy = chain_config.requestPolicy();
    var requests = try rr.init(std.testing.allocator, .{ .forks = chain_config.forks[0..chain_config.boundary_count], .admission = try rr.Options.Admission.defaults(&policy, 16) });
    defer requests.deinit();
    try std.testing.expectEqual(@as(usize, 1024 * 1024), (try requests.responseBounds(.blocks_by_root_v2, .deneb)).max);
    requests.setRequestFork(.deneb);
    try std.testing.expectEqual(@as(usize, 80), requests.requestBounds(.blob_sidecars_by_root_v1).request_max);
    requests.setRequestFork(.electra);
    try std.testing.expectEqual(@as(usize, 120), requests.requestBounds(.blob_sidecars_by_root_v1).request_max);
    input.MAX_REQUEST_BLOCKS_DENEB = 128;
    input.MAX_PAYLOAD_SIZE = consensus_types.deneb.BlobSidecar.fixed_size;
    const small_cfg = config.BeaconConfig.init(input, @splat(0));
    const small = try chain.Config.init(&small_cfg, false);
    try std.testing.expectEqual(@as(usize, input.MAX_PAYLOAD_SIZE), small.policy.requestMax());
    try std.testing.expectEqual(@as(usize, input.MAX_PAYLOAD_SIZE), small.policy.requestBounds(.data_column_sidecars_by_root_v1, .fulu).request_max);
}

fn fuluSchedule() config.ChainConfig {
    var input = fixture();
    input.ELECTRA_FORK_EPOCH = 0;
    input.FULU_FORK_EPOCH = 0;
    input.BLOB_SCHEDULE = &.{ .{ .EPOCH = 10, .MAX_BLOBS_PER_BLOCK = 33 }, .{ .EPOCH = 11, .MAX_BLOBS_PER_BLOCK = 40 } };
    return input;
}

test "network chain rejects dense supported BPO demand before the future overlap" {
    for ([_]bool{ false, true }) |light_clients| {
        const cfg = config.BeaconConfig.init(fuluSchedule(), @splat(0));
        try std.testing.expectError(error.UnsupportedTopicOverlap, chain.Config.init(&cfg, light_clients));
    }
    var input = fixture();
    input.BLOB_SCHEDULE = &.{ .{ .EPOCH = 3, .MAX_BLOBS_PER_BLOCK = 33 }, .{ .EPOCH = 5, .MAX_BLOBS_PER_BLOCK = 40 } };
    const cfg = config.BeaconConfig.init(input, @splat(0));
    try std.testing.expectError(error.UnsupportedTopicOverlap, chain.Config.init(&cfg, true));
}

test "network chain scheduled topic demand accepts exact capacity and rejects one extra" {
    for ([_]bool{ false, true }) |light_clients| {
        var input = fuluSchedule();
        input.ELECTRA_FORK_EPOCH = 10;
        input.FULU_FORK_EPOCH = 10;
        input.BLOB_SIDECAR_SUBNET_COUNT = if (light_clients) 25 else 31;
        var cfg = config.BeaconConfig.init(input, @splat(0));
        const chain_config = try chain.Config.init(&cfg, light_clients);
        try std.testing.expectEqual(@as(u8, 3), chain_config.boundary_count);
        var demand: usize = 0;
        for (chain_config.topics[0..chain_config.boundary_count]) |boundary| for (boundary.rules, 0..) |rule, k| {
            const kind: topics.Kind = @enumFromInt(k);
            if (!light_clients and (kind == .light_client_finality_update or kind == .light_client_optimistic_update)) continue;
            demand += rule.count;
        };
        try std.testing.expectEqual(@as(usize, 512), demand);
        input.BLOB_SIDECAR_SUBNET_COUNT += 1;
        cfg = config.BeaconConfig.init(input, @splat(0));
        try std.testing.expectError(error.UnsupportedTopicOverlap, chain.Config.init(&cfg, light_clients));
    }
}

test "network chain live demand permits replacements at the same removal epoch" {
    var input = fuluSchedule();
    input.BLOB_SCHEDULE = &.{ .{ .EPOCH = 10, .MAX_BLOBS_PER_BLOCK = 33 }, .{ .EPOCH = 13, .MAX_BLOBS_PER_BLOCK = 40 } };
    var cfg = config.BeaconConfig.init(input, @splat(0));
    try std.testing.expectError(error.UnsupportedTopicOverlap, chain.Config.init(&cfg, true));
    input.BLOB_SCHEDULE = &.{ .{ .EPOCH = 10, .MAX_BLOBS_PER_BLOCK = 33 }, .{ .EPOCH = 14, .MAX_BLOBS_PER_BLOCK = 40 } };
    cfg = config.BeaconConfig.init(input, @splat(0));
    _ = try chain.Config.init(&cfg, true);
}

test "network chain uses configured topic demand and imposes no lifetime namespace cap" {
    var input = fuluSchedule();
    input.DATA_COLUMN_SIDECAR_SUBNET_COUNT = 93;
    var cfg = config.BeaconConfig.init(input, @splat(0));
    _ = try chain.Config.init(&cfg, true);
    input.DATA_COLUMN_SIDECAR_SUBNET_COUNT = 94;
    cfg = config.BeaconConfig.init(input, @splat(0));
    try std.testing.expectError(error.UnsupportedTopicOverlap, chain.Config.init(&cfg, true));
    _ = try chain.Config.init(&cfg, false);
    input = fuluSchedule();
    input.BLOB_SCHEDULE = &.{ .{ .EPOCH = 10, .MAX_BLOBS_PER_BLOCK = 33 }, .{ .EPOCH = 110, .MAX_BLOBS_PER_BLOCK = 40 }, .{ .EPOCH = 210, .MAX_BLOBS_PER_BLOCK = 48 } };
    cfg = config.BeaconConfig.init(input, @splat(0));
    const chain_config = try chain.Config.init(&cfg, true);
    try std.testing.expectEqual(@as(u16, 820), try topics.validate(chain_config.topics[0..chain_config.boundary_count]));
    input.BLOB_SCHEDULE = &.{.{ .EPOCH = 0, .MAX_BLOBS_PER_BLOCK = 33 }};
    cfg = config.BeaconConfig.init(input, @splat(0));
    try std.testing.expectEqual(@as(u8, 1), (try chain.Config.init(&cfg, true)).boundary_count);
}

const gossip = @import("gossipsub/root.zig");

fn initScheduledGossip(chain_config: *const chain.Config) !gossip.Gossipsub {
    return gossip.Gossipsub.init(std.testing.allocator, .{
        .random_seed = 1,
        .connected_capacity = 2,
        .retained_capacity = 5,
        .retained_outbound_reserve = 1,
        .seen_capacity = 16,
        .mcache_capacity = 16,
        .validation_capacity = 8,
        .topic_policy = chain_config.topics[0..chain_config.boundary_count],
    });
}

fn applyScheduled(g: *gossip.Gossipsub, chain_config: *const chain.Config, epoch: u64) !usize {
    var desired: [chain.boundary_max]gossip.local_intent.Boundary = undefined;
    var count: usize = 0;
    for (chain_config.topics[0..chain_config.boundary_count], 0..) |boundary, i| {
        if (epoch < boundary.epoch -| 2 or (i + 1 < chain_config.boundary_count and epoch >= chain_config.boundaries[i + 1].epoch +| 2)) continue;
        desired[count] = .{ .digest = boundary.digest };
        for (boundary.rules, 0..) |rule, k| {
            const kind: topics.Kind = @enumFromInt(k);
            if (!chain_config.serve_light_clients and (kind == .light_client_finality_update or kind == .light_client_optimistic_update)) continue;
            desired[count].lengths[k] = @intCast((rule.count + 7) / 8);
            for (0..rule.count) |subnet| desired[count].mask(kind)[subnet / 8] |= @as(u8, 1) << @intCast(subnet % 8);
        }
        count += 1;
    }
    var workspace: gossip.local_intent.Workspace = .{};
    const slot = epoch * preset.preset.SLOTS_PER_EPOCH;
    if (try g.prepareSubscriptions(desired[0..count], &workspace, Now.fromMilliseconds(.{ .mono_ms = slot * 12_000, .unix_s = 0 }), slot)) g.commitSubscriptions(&workspace);
    return workspace.desired.count();
}

test "network chain exact capacity schedule advances into the supported three digest overlap" {
    for ([_]bool{ false, true }) |light_clients| {
        var input = fuluSchedule();
        input.ELECTRA_FORK_EPOCH = 10;
        input.FULU_FORK_EPOCH = 10;
        input.BLOB_SIDECAR_SUBNET_COUNT = if (light_clients) 25 else 31;
        const cfg = config.BeaconConfig.init(input, @splat(0));
        const chain_config = try chain.Config.init(&cfg, light_clients);
        var g = try initScheduledGossip(&chain_config);
        defer g.deinit();
        try std.testing.expectEqual(@as(usize, if (light_clients) 102 else 106), try applyScheduled(&g, &chain_config, 0));
        try std.testing.expectEqual(@as(usize, if (light_clients) 307 else 309), try applyScheduled(&g, &chain_config, 8));
        try std.testing.expectEqual(@as(usize, 512), try applyScheduled(&g, &chain_config, 9));
    }
}

test "network chain namespace capacity preserves retired scores and backoffs across transitions" {
    for ([_]u64{ 14, 16 }) |incoming_epoch| {
        for ([_]bool{ false, true }) |delayed| {
            var input = fuluSchedule();
            input.BLOB_SCHEDULE = &.{ .{ .EPOCH = 10, .MAX_BLOBS_PER_BLOCK = 33 }, .{ .EPOCH = incoming_epoch, .MAX_BLOBS_PER_BLOCK = 40 } };
            const cfg = config.BeaconConfig.init(input, @splat(0));
            const chain_config = try chain.Config.init(&cfg, true);
            var g = try initScheduledGossip(&chain_config);
            defer g.deinit();
            try std.testing.expectEqual(@as(usize, 615), g.overlay.rows.len);
            try std.testing.expectEqual(@as(usize, 410), try applyScheduled(&g, &chain_config, 8));
            const peer = test_support.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
            const logical = g.sessions.rows[peer.index].logical;
            for (0..205) |i| {
                g.peers.scores.invalid(logical.index, @intCast(i));
                g.peers.addBackoff(logical, @intCast(i), 1_000_000_000, 60_000);
            }
            if (!delayed) try std.testing.expectEqual(@as(usize, if (incoming_epoch == 14) 410 else 205), try applyScheduled(&g, &chain_config, 12));
            try std.testing.expectEqual(@as(usize, 410), try applyScheduled(&g, &chain_config, incoming_epoch - 2));
            for (g.overlay.rows[0..205], 0..) |row, i| {
                try std.testing.expect(row.active and !row.subscribed);
                try std.testing.expectEqual(@as(f64, 1), g.peers.scores.topics[@as(usize, logical.index) * g.overlay.rows.len + i].invalid);
                try std.testing.expect(g.peers.backedOff(logical, @intCast(i), 1_000_000_001));
            }
            var live: usize = 0;
            for (g.overlay.rows) |row| {
                try std.testing.expect(row.active);
                live += @intFromBool(row.subscribed);
            }
            try std.testing.expectEqual(@as(usize, 410), live);
        }
    }
}

test "network column size bounds follow each configured blob boundary" {
    const cfg = config.BeaconConfig.init(fixture(), @splat(0));
    const derived = try chain.Config.init(&cfg, true);
    const column = @intFromEnum(topics.Kind.data_column_sidecar);
    const per_blob = consensus_types.fulu.Cell.fixed_size + consensus_types.primitive.KZGCommitment.fixed_size + consensus_types.primitive.KZGProof.fixed_size;
    for ([_]struct { index: usize, blobs: usize }{ .{ .index = 2, .blobs = 33 }, .{ .index = 3, .blobs = 40 } }) |case| {
        try std.testing.expectEqual(consensus_types.fulu.DataColumnSidecar.min_size + case.blobs * per_blob, derived.topics[case.index].rules[column].ssz_max);
    }
    var large = fixture();
    large.BLOB_SCHEDULE = &.{};
    large.MAX_BLOBS_PER_BLOCK_ELECTRA = preset.preset.MAX_BLOB_COMMITMENTS_PER_BLOCK;
    const large_config = config.BeaconConfig.init(large, @splat(0));
    const capped = try chain.Config.init(&large_config, true);
    try std.testing.expectEqual(@min(consensus_types.fulu.DataColumnSidecar.max_size, large.MAX_PAYLOAD_SIZE), capped.topics[2].rules[column].ssz_max);
}
