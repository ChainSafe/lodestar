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

test "execution payload bid signing domain follows bid slot across Gloas and Heze" {
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
        .HEZE_FORK_EPOCH = 3,
    });
    const genesis_root = [_]u8{42} ** 32;
    const config = BeaconConfig.init(chain_config, genesis_root);
    inline for (.{ ForkSeq.gloas, ForkSeq.heze }) |fork| {
        const ST = ForkTypes(fork).ExecutionPayloadBid;
        const fork_slot = (if (fork == .gloas) @as(u64, 2) else 3) * preset.SLOTS_PER_EPOCH;
        const before_version = if (fork == .gloas) chain_config.FULU_FORK_VERSION else chain_config.GLOAS_FORK_VERSION;
        const after_version = if (fork == .gloas) chain_config.GLOAS_FORK_VERSION else chain_config.HEZE_FORK_VERSION;
        for ([_]u64{ fork_slot - 1, fork_slot, fork_slot + 1 }) |slot| {
            var bid = ST.default_value;
            bid.slot = slot;
            if (comptime fork == .heze) try bid.inclusion_list_bits.set(15, true);
            var signing_data: types.phase0.SigningData.Type = undefined;
            try ST.hashTreeRoot(std.testing.allocator, &bid, &signing_data.object_root);
            try computeDomain(
                c.DOMAIN_BEACON_BUILDER,
                if (slot < fork_slot) before_version else after_version,
                genesis_root,
                &signing_data.domain,
            );
            var expected: [32]u8 = undefined;
            try types.phase0.SigningData.hashTreeRoot(&signing_data, &expected);
            const actual = try getExecutionPayloadBidSigningRoot(fork, std.testing.allocator, &config, &bid);
            try std.testing.expectEqualSlices(u8, &expected, &actual);
        }
    }
}
