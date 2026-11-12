const BeaconConfig = @import("BeaconConfig.zig");
const DOMAIN_VOLUNTARY_EXIT = c.DOMAIN_VOLUNTARY_EXIT;
const Epoch = ct.primitive.Epoch.Type;
const std = @import("std");
const c = @import("constants");
const ct = @import("consensus_types");

test "getDomain" {
    const root = [_]u8{0} ** 32;
    var beacon_config = BeaconConfig.init(@import("./networks/mainnet.zig").chain_config, root);

    const domain = try beacon_config.getDomain(100, DOMAIN_VOLUNTARY_EXIT, null);
    const domain2 = try beacon_config.getDomain(100, DOMAIN_VOLUNTARY_EXIT, null);
    try std.testing.expectEqualSlices(u8, domain, domain2);
}

test "blob parameters select latest active entry and share payload bounds" {
    var chain = @import("networks/mainnet.zig").chain_config;
    chain.FULU_FORK_EPOCH = 100;
    chain.ELECTRA_FORK_EPOCH = 9;
    chain.DENEB_FORK_EPOCH = 0;
    chain.CAPELLA_FORK_EPOCH = 0;
    chain.BELLATRIX_FORK_EPOCH = 0;
    chain.ALTAIR_FORK_EPOCH = 0;
    chain.BLOB_SCHEDULE = &.{
        .{ .EPOCH = 200, .MAX_BLOBS_PER_BLOCK = 21 },
        .{ .EPOCH = 150, .MAX_BLOBS_PER_BLOCK = 15 },
    };
    const config = BeaconConfig.init(chain, @splat(0));
    for ([_]struct { epoch: Epoch, from: Epoch, count: u64 }{
        .{ .epoch = 100, .from = 9, .count = 9 },
        .{ .epoch = 149, .from = 9, .count = 9 },
        .{ .epoch = 150, .from = 150, .count = 15 },
        .{ .epoch = 199, .from = 150, .count = 15 },
        .{ .epoch = 200, .from = 200, .count = 21 },
    }) |case| {
        const params = config.getBlobParameters(case.epoch);
        try std.testing.expectEqual(case.from, params.epoch);
        try std.testing.expectEqual(case.count, params.max_blobs_per_block);
        try std.testing.expectEqual(case.count, config.getMaxBlobsPerBlock(case.epoch));
    }
}

test "Heze fork activation and inclusion list domains" {
    const preset = @import("preset").preset;
    const domain_type = @import("constants").DOMAIN_INCLUSION_LIST_COMMITTEE;
    const chain = @import("networks/mainnet.zig").chain_config.merge(.{ .GLOAS_FORK_EPOCH = 1, .HEZE_FORK_EPOCH = 3 });
    const config = BeaconConfig.init(chain, @splat(7));
    try std.testing.expectEqual(.gloas, config.forkInfo(3 * preset.SLOTS_PER_EPOCH - 1).fork_seq);
    const info = config.forkInfo(3 * preset.SLOTS_PER_EPOCH);
    try std.testing.expectEqual(.heze, info.fork_seq);
    try std.testing.expectEqual(.gloas, info.prev_fork_seq);
    try std.testing.expectEqualSlices(u8, &chain.HEZE_FORK_VERSION, &info.version);
    try std.testing.expectEqualSlices(u8, &chain.GLOAS_FORK_VERSION, &info.prev_version);
    try std.testing.expectEqual(config.getMaxBlobsPerBlock(2), config.getMaxBlobsPerBlock(3));
    const domain = try config.getDomain(3, domain_type, 3 * preset.SLOTS_PER_EPOCH);
    try std.testing.expectEqualSlices(u8, &domain_type, domain[0..4]);
    try std.testing.expectEqualSlices(u8, try config.domain_cache.get(.heze, domain_type), domain);
    try std.testing.expectEqualSlices(u8, try config.domain_cache.get(.gloas, domain_type), try config.getDomain(3, domain_type, 2 * preset.SLOTS_PER_EPOCH));
    try std.testing.expect(!std.mem.eql(u8, domain, try config.domain_cache.get(.gloas, domain_type)));
}

test "Heze timing uses the fork-specific slot duration" {
    const chain = @import("networks/mainnet.zig").chain_config.merge(.{ .SLOT_DURATION_MS_HEZE = 6000 });
    const config = BeaconConfig.init(chain, @splat(0));
    try std.testing.expectEqual(12000, config.getSlotDurationMs(.gloas));
    try std.testing.expectEqual(6000, config.getSlotDurationMs(.heze));
    try std.testing.expectEqual(3000, config.getAttestationDueMs(.gloas));
    try std.testing.expectEqual(1500, config.getAttestationDueMs(.heze));
    try std.testing.expectEqual(4000, config.getInclusionListDueMs(.heze));
    try std.testing.expectEqual(1000, config.getProposerReorgCutoffMs(.heze));
}
