const std = @import("std");
const ChainConfig = @import("ChainConfig.zig");

test "merge" {
    const mainnet_config = @import("./networks/mainnet.zig").chain_config;
    const old_altair_epoch = mainnet_config.ALTAIR_FORK_EPOCH;
    const merged_config = mainnet_config.merge(.{
        .ALTAIR_FORK_EPOCH = old_altair_epoch + 1000,
    });
    try std.testing.expect(merged_config.ALTAIR_FORK_EPOCH == old_altair_epoch + 1000);
}

test "Heze timing defaults preserve current slot durations" {
    inline for (.{
        @import("networks/mainnet.zig"),
        @import("networks/minimal.zig"),
        @import("networks/gnosis.zig"),
        @import("networks/hoodi.zig"),
        @import("networks/sepolia.zig"),
        @import("networks/chiado.zig"),
    }) |network| {
        const chain = network.chain_config;
        try std.testing.expectEqual(std.math.maxInt(u64), chain.HEZE_FORK_EPOCH);
        try std.testing.expectEqual(chain.SLOT_DURATION_MS, chain.SLOT_DURATION_MS_HEZE);
    }
}

test "Heze fork versions are network specific" {
    const b = @import("hex").hexToBytesComptime;
    inline for (.{
        .{ @import("networks/mainnet.zig"), b(4, "0x08000000") },
        .{ @import("networks/minimal.zig"), b(4, "0x08000001") },
        .{ @import("networks/gnosis.zig"), b(4, "0x08000064") },
        .{ @import("networks/hoodi.zig"), b(4, "0x90000910") },
        .{ @import("networks/sepolia.zig"), b(4, "0x90000077") },
        .{ @import("networks/chiado.zig"), b(4, "0x0800006f") },
    }) |case| {
        try std.testing.expectEqualSlices(u8, &case[1], &case[0].chain_config.HEZE_FORK_VERSION);
    }
}

test "merge preserves or overrides Heze timing independently" {
    const chain = @import("networks/mainnet.zig").chain_config;
    const unchanged = chain.merge(.{});
    try std.testing.expectEqual(chain.HEZE_FORK_EPOCH, unchanged.HEZE_FORK_EPOCH);
    try std.testing.expectEqual(chain.SLOT_DURATION_MS_HEZE, unchanged.SLOT_DURATION_MS_HEZE);

    const overrides: ChainConfig.OptionalChainConfig = .{
        .HEZE_FORK_EPOCH = 3,
        .SLOT_DURATION_MS_HEZE = 4000,
    };
    const merged = chain.merge(overrides);
    try std.testing.expectEqual(3, merged.HEZE_FORK_EPOCH);
    try std.testing.expectEqual(4000, merged.SLOT_DURATION_MS_HEZE);
    try std.testing.expectEqual(chain.SLOT_DURATION_MS, merged.SLOT_DURATION_MS);
    try std.testing.expectEqual(chain.SECONDS_PER_SLOT, merged.SECONDS_PER_SLOT);
}

test "merge preserves or overrides Heze fork version independently" {
    const chain = @import("networks/mainnet.zig").chain_config;
    const unchanged = chain.merge(.{});
    try std.testing.expectEqualSlices(u8, &chain.HEZE_FORK_VERSION, &unchanged.HEZE_FORK_VERSION);

    const version = [_]u8{ 0xaa, 0xbb, 0xcc, 0xdd };
    const merged = chain.merge(.{ .HEZE_FORK_VERSION = version });
    try std.testing.expectEqualSlices(u8, &version, &merged.HEZE_FORK_VERSION);
    try std.testing.expectEqual(chain.HEZE_FORK_EPOCH, merged.HEZE_FORK_EPOCH);
    try std.testing.expectEqual(chain.SLOT_DURATION_MS_HEZE, merged.SLOT_DURATION_MS_HEZE);
    try std.testing.expectEqualSlices(u8, &chain.GLOAS_FORK_VERSION, &merged.GLOAS_FORK_VERSION);
}
