const std = @import("std");
const BeaconConfig = @import("BeaconConfig.zig");
const DOMAIN_VOLUNTARY_EXIT = @import("constants").DOMAIN_VOLUNTARY_EXIT;

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

test "Heze timing derives from the slot duration" {
    const config = BeaconConfig.init(@import("networks/mainnet.zig").chain_config, @splat(0));
    try std.testing.expectEqual(12000, config.getSlotDurationMs(.gloas));
    try std.testing.expectEqual(12000, config.getSlotDurationMs(.heze));
    try std.testing.expectEqual(3000, config.getAttestationDueMs(.gloas));
    try std.testing.expectEqual(3000, config.getAttestationDueMs(.heze));
    try std.testing.expectEqual(9000, config.getInclusionListDueMs(.heze));
    try std.testing.expectEqual(2000, config.getProposerReorgCutoffMs(.heze));
}

test "getDomain matches independently computed domain bytes" {
    const mainnet = @import("networks/mainnet.zig");
    const b = @import("hex").hexToBytesComptime;
    const config = BeaconConfig.init(mainnet.chain_config, mainnet.genesis_validators_root);

    // domain_type || SHA256(fork_version || zero_bytes(28) || genesis_validators_root)[:28].
    // These vectors use the mainnet Altair version (0x01000000) and genesis validators root.
    const exit_domain = b(32, "0x04000000afcaaba0efab1ca832a15152469bb09bb84641c405171dfa2d3fb45f");
    const attester_domain = b(32, "0x01000000afcaaba0efab1ca832a15152469bb09bb84641c405171dfa2d3fb45f");
    try std.testing.expectEqualSlices(u8, &exit_domain, try config.getDomain(mainnet.chain_config.ALTAIR_FORK_EPOCH, DOMAIN_VOLUNTARY_EXIT, null));
    try std.testing.expectEqualSlices(u8, &attester_domain, try config.getDomain(mainnet.chain_config.ALTAIR_FORK_EPOCH, @import("constants").DOMAIN_BEACON_ATTESTER, null));
}

test "blob parameters select latest active entry and share payload bounds" {
    const Epoch = @import("consensus_types").primitive.Epoch.Type;
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
