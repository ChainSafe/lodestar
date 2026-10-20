const std = @import("std");
const Allocator = std.mem.Allocator;
const ForkTypes = @import("fork_types").ForkTypes;
const types = @import("consensus_types");
const BeaconConfig = @import("config").BeaconConfig;
const ForkSeq = @import("config").ForkSeq;
const c = @import("constants");
const computeSigningRoot = @import("../utils/signing_root.zig").computeSigningRoot;
const computeEpochAtSlot = @import("../utils/epoch.zig").computeEpochAtSlot;

pub fn getExecutionPayloadBidSigningRoot(
    comptime fork: ForkSeq,
    allocator: Allocator,
    config: *const BeaconConfig,
    bid: *const ForkTypes(fork).ExecutionPayloadBid.Type,
) ![32]u8 {
    const domain = try config.getDomain(computeEpochAtSlot(bid.slot), c.DOMAIN_BEACON_BUILDER, null);

    var out: [32]u8 = undefined;
    var object_root: [32]u8 = undefined;
    try ForkTypes(fork).ExecutionPayloadBid.hashTreeRoot(allocator, bid, &object_root);
    try computeSigningRoot(types.primitive.Root, &object_root, domain, &out);
    return out;
}

test "execution payload bid signing domain follows bid slot across the Gloas fork" {
    const preset = @import("preset").preset;
    const computeDomain = @import("../utils/domain.zig").computeDomain;
    const chain_config = @import("config").minimal.chain_config.merge(.{
        .ALTAIR_FORK_EPOCH = 0,
        .BELLATRIX_FORK_EPOCH = 0,
        .CAPELLA_FORK_EPOCH = 0,
        .DENEB_FORK_EPOCH = 0,
        .ELECTRA_FORK_EPOCH = 0,
        .FULU_FORK_EPOCH = 1,
        .GLOAS_FORK_EPOCH = 2,
    });
    const genesis_root = [_]u8{42} ** 32;
    const config = BeaconConfig.init(chain_config, genesis_root);
    const fork_slot = 2 * preset.SLOTS_PER_EPOCH;
    for ([_]u64{ fork_slot - 1, fork_slot, fork_slot + 1 }) |slot| {
        var bid = types.gloas.ExecutionPayloadBid.default_value;
        bid.slot = slot;
        var signing_data: types.phase0.SigningData.Type = undefined;
        try types.gloas.ExecutionPayloadBid.hashTreeRoot(std.testing.allocator, &bid, &signing_data.object_root);
        try computeDomain(
            c.DOMAIN_BEACON_BUILDER,
            if (slot < fork_slot) chain_config.FULU_FORK_VERSION else chain_config.GLOAS_FORK_VERSION,
            genesis_root,
            &signing_data.domain,
        );
        var expected: [32]u8 = undefined;
        try types.phase0.SigningData.hashTreeRoot(&signing_data, &expected);
        const actual = try getExecutionPayloadBidSigningRoot(.gloas, std.testing.allocator, &config, &bid);
        try std.testing.expectEqualSlices(u8, &expected, &actual);
    }
}
