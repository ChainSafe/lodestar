const std = @import("std");
const testing = std.testing;
const ClockConfig = @import("config.zig").ClockConfig;
const slot_math = @import("slot_math.zig");
const mainnet = @import("config").mainnet.chain_config;
const preset = @import("preset").preset;

test "fromChainConfig follows the Heze slot duration" {
    const unscheduled = ClockConfig.fromChainConfig(&mainnet.merge(.{ .SLOT_DURATION_MS_HEZE = 6000 }), 100);
    try testing.expectEqual(12000, unscheduled.slot_duration_ms);
    try testing.expectEqual(0, unscheduled.transitions().len);

    const unchanged = ClockConfig.fromChainConfig(&mainnet.merge(.{ .HEZE_FORK_EPOCH = 2 }), 100);
    try testing.expectEqual(0, unchanged.transitions().len);

    const at_genesis = ClockConfig.fromChainConfig(&mainnet.merge(.{ .HEZE_FORK_EPOCH = 0, .SLOT_DURATION_MS_HEZE = 6000 }), 100);
    try testing.expectEqual(6000, at_genesis.slot_duration_ms);
    try testing.expectEqual(0, at_genesis.transitions().len);
    try at_genesis.validate();

    const mid_chain = ClockConfig.fromChainConfig(&mainnet.merge(.{ .HEZE_FORK_EPOCH = 2, .SLOT_DURATION_MS_HEZE = 6000 }), 100);
    try mid_chain.validate();
    const heze_slot = 2 * preset.SLOTS_PER_EPOCH;
    try testing.expectEqual(100_000 + heze_slot * 12000, slot_math.slotStartMs(mid_chain, heze_slot));
    try testing.expectEqual(100_000 + heze_slot * 12000 + 6000, slot_math.slotStartMs(mid_chain, heze_slot + 1));
    try testing.expectEqual(heze_slot + 1, slot_math.slotAtMs(mid_chain, 100_000 + heze_slot * 12000 + 6000));
}
