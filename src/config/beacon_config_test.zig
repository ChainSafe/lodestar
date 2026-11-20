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

test "getDomain selects the domain across a fork boundary" {
    const mainnet = @import("networks/mainnet.zig");
    const preset = @import("preset").preset;
    const b = @import("hex").hexToBytesComptime;
    const config = BeaconConfig.init(mainnet.chain_config, mainnet.genesis_validators_root);
    const fork_epoch = mainnet.chain_config.ALTAIR_FORK_EPOCH;
    const fork_slot = fork_epoch * preset.SLOTS_PER_EPOCH;

    // Same independent domain formula as above, for mainnet Phase0 and Altair.
    const phase0_domain = b(32, "0x04000000b5303f2ad2010d699a76c8e62350947421a3e4a979779642cfdb0f66");
    const altair_domain = b(32, "0x04000000afcaaba0efab1ca832a15152469bb09bb84641c405171dfa2d3fb45f");
    const cases = [_]struct { state_epoch: u64, message_slot: ?u64, expected: *const [32]u8 }{
        .{ .state_epoch = fork_epoch - 1, .message_slot = null, .expected = &phase0_domain },
        .{ .state_epoch = fork_epoch, .message_slot = null, .expected = &altair_domain },
        .{ .state_epoch = fork_epoch + 1, .message_slot = null, .expected = &altair_domain },
        .{ .state_epoch = fork_epoch + 1, .message_slot = fork_slot - 1, .expected = &phase0_domain },
        .{ .state_epoch = fork_epoch + 1, .message_slot = fork_slot, .expected = &altair_domain },
        .{ .state_epoch = fork_epoch + 1, .message_slot = fork_slot + 1, .expected = &altair_domain },
    };
    for (cases) |case| {
        try std.testing.expectEqualSlices(u8, case.expected, try config.getDomain(case.state_epoch, DOMAIN_VOLUNTARY_EXIT, case.message_slot));
    }
}
