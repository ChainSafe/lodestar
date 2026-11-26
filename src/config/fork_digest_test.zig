const BeaconConfig = @import("BeaconConfig.zig");
const Epoch = ct.primitive.Epoch.Type;
const ForkDigest = ct.primitive.ForkDigest.Type;
const computeForkDigest = @import("fork_digest.zig").computeForkDigest;
const mainnet_genesis_validators_root = hex.hexToBytesComptime(
    32,
    "0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95",
);
const std = @import("std");
const ct = @import("consensus_types");
const hex = @import("hex");

test "computeForkDigest reproduces the mainnet digests before Fulu" {
    const mainnet = @import("./networks/mainnet.zig");
    const config = BeaconConfig.init(mainnet.chain_config, mainnet_genesis_validators_root);
    const chain = config.chain;
    try std.testing.expectEqual([4]u8{ 0xb5, 0x30, 0x3f, 0x2a }, computeForkDigest(&config, 0));
    try std.testing.expectEqual(
        [4]u8{ 0xaf, 0xca, 0xab, 0xa0 },
        computeForkDigest(&config, chain.ALTAIR_FORK_EPOCH),
    );
    try std.testing.expectEqual(
        [4]u8{ 0x4a, 0x26, 0xc5, 0x8b },
        computeForkDigest(&config, chain.BELLATRIX_FORK_EPOCH),
    );
    try std.testing.expectEqual(
        [4]u8{ 0xbb, 0xa4, 0xda, 0x96 },
        computeForkDigest(&config, chain.CAPELLA_FORK_EPOCH),
    );
    try std.testing.expectEqual(
        [4]u8{ 0x6a, 0x95, 0xa1, 0xa9 },
        computeForkDigest(&config, chain.DENEB_FORK_EPOCH),
    );
    try std.testing.expectEqual(
        computeForkDigest(&config, chain.DENEB_FORK_EPOCH),
        computeForkDigest(&config, chain.ELECTRA_FORK_EPOCH - 1),
    );
}

// Vectors: https://github.com/ChainSafe/lodestar/blob/feed9165804fbb476a79e5db1c4ddff096b1ce4e/packages/config/test/unit/forkDigest.test.ts
test "computeForkDigest matches Fulu and BPO consensus vectors" {
    var chain = @import("./networks/mainnet.zig").chain_config;
    chain.ALTAIR_FORK_EPOCH = 0;
    chain.BELLATRIX_FORK_EPOCH = 0;
    chain.CAPELLA_FORK_EPOCH = 0;
    chain.DENEB_FORK_EPOCH = 0;
    chain.ELECTRA_FORK_EPOCH = 9;
    chain.FULU_FORK_EPOCH = 100;
    chain.FULU_FORK_VERSION = .{ 6, 0, 0, 0 };
    chain.BLOB_SCHEDULE = &.{
        .{ .EPOCH = 9, .MAX_BLOBS_PER_BLOCK = 9 },
        .{ .EPOCH = 100, .MAX_BLOBS_PER_BLOCK = 100 },
        .{ .EPOCH = 150, .MAX_BLOBS_PER_BLOCK = 175 },
        .{ .EPOCH = 200, .MAX_BLOBS_PER_BLOCK = 200 },
        .{ .EPOCH = 250, .MAX_BLOBS_PER_BLOCK = 275 },
        .{ .EPOCH = 300, .MAX_BLOBS_PER_BLOCK = 300 },
    };
    const config = BeaconConfig.init(chain, @splat(0));
    const cases = [_]struct { epoch: Epoch, digest: ForkDigest }{
        .{ .epoch = 100, .digest = .{ 0xdf, 0x67, 0x55, 0x7b } },
        .{ .epoch = 101, .digest = .{ 0xdf, 0x67, 0x55, 0x7b } },
        .{ .epoch = 150, .digest = .{ 0x8a, 0xb3, 0x8b, 0x59 } },
        .{ .epoch = 199, .digest = .{ 0x8a, 0xb3, 0x8b, 0x59 } },
        .{ .epoch = 200, .digest = .{ 0xd9, 0xb8, 0x14, 0x38 } },
        .{ .epoch = 201, .digest = .{ 0xd9, 0xb8, 0x14, 0x38 } },
        .{ .epoch = 250, .digest = .{ 0x4e, 0xf3, 0x2a, 0x62 } },
        .{ .epoch = 299, .digest = .{ 0x4e, 0xf3, 0x2a, 0x62 } },
        .{ .epoch = 300, .digest = .{ 0xca, 0x10, 0x0d, 0x64 } },
        .{ .epoch = 301, .digest = .{ 0xca, 0x10, 0x0d, 0x64 } },
    };
    for (cases) |case| try std.testing.expectEqual(case.digest, computeForkDigest(&config, case.epoch));
}
