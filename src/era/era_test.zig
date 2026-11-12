//! Tests for `era.zig`.

const std = @import("std");
const preset = @import("preset").preset;
const era = @import("era.zig");
const EraFileName = era.EraFileName;
const computeEraNumberFromBlockSlot = era.computeEraNumberFromBlockSlot;
const computeStartBlockSlotFromEraNumber = era.computeStartBlockSlotFromEraNumber;
const isValidEraBlockSlot = era.isValidEraBlockSlot;
const isValidEraStateSlot = era.isValidEraStateSlot;

test "EraFileName.parse - valid filename" {
    const result = try EraFileName.parse("mainnet-00001-a1b2c3d4.era");
    try std.testing.expectEqualStrings("mainnet", result.config_name);
    try std.testing.expectEqual(@as(u64, 1), result.era_number);
    try std.testing.expectEqualStrings("a1b2c3d4", &result.short_era_root);
}

test "EraFileName.parse - large era number" {
    const result = try EraFileName.parse("mainnet-99999-deadbeef.era");
    try std.testing.expectEqual(@as(u64, 99999), result.era_number);
    try std.testing.expectEqualStrings("deadbeef", &result.short_era_root);
}

test "EraFileName.parse - different config names" {
    const result = try EraFileName.parse("goerli-00042-12345678.era");
    try std.testing.expectEqualStrings("goerli", result.config_name);
    try std.testing.expectEqual(@as(u64, 42), result.era_number);
}

test "EraFileName.parse - invalid: no .era extension" {
    try std.testing.expectError(error.InvalidEraFileName, EraFileName.parse("mainnet-00001-a1b2c3d4.bin"));
}

test "EraFileName.parse - invalid: wrong root length" {
    try std.testing.expectError(error.InvalidEraFileName, EraFileName.parse("mainnet-00001-abc.era"));
}

test "EraFileName.parse - with directory path" {
    const result = try EraFileName.parse("/data/era/mainnet-00100-aabbccdd.era");
    try std.testing.expectEqualStrings("mainnet", result.config_name);
    try std.testing.expectEqual(@as(u64, 100), result.era_number);
}

test "computeEraNumberFromBlockSlot" {
    // Slot 0 → era 1 (genesis blocks are in era 1)
    try std.testing.expectEqual(@as(u64, 1), computeEraNumberFromBlockSlot(0));
    // Slot 8191 → era 1 (last slot of first era, with SLOTS_PER_HISTORICAL_ROOT=8192)
    try std.testing.expectEqual(@as(u64, 1), computeEraNumberFromBlockSlot(preset.SLOTS_PER_HISTORICAL_ROOT - 1));
    // Slot 8192 → era 2
    try std.testing.expectEqual(@as(u64, 2), computeEraNumberFromBlockSlot(preset.SLOTS_PER_HISTORICAL_ROOT));
}

test "computeStartBlockSlotFromEraNumber" {
    // Era 1 starts at slot 0
    try std.testing.expectEqual(@as(u64, 0), try computeStartBlockSlotFromEraNumber(1));
    // Era 2 starts at SLOTS_PER_HISTORICAL_ROOT
    try std.testing.expectEqual(@as(u64, preset.SLOTS_PER_HISTORICAL_ROOT), try computeStartBlockSlotFromEraNumber(2));
}

test "computeStartBlockSlotFromEraNumber - era 0 underflows" {
    try std.testing.expectError(error.Overflow, computeStartBlockSlotFromEraNumber(0));
}

test "isValidEraBlockSlot" {
    // Slot 0 is valid for era 1
    try std.testing.expect(isValidEraBlockSlot(0, 1));
    // Slot 0 is NOT valid for era 2
    try std.testing.expect(!isValidEraBlockSlot(0, 2));
    // Slot SLOTS_PER_HISTORICAL_ROOT is valid for era 2
    try std.testing.expect(isValidEraBlockSlot(preset.SLOTS_PER_HISTORICAL_ROOT, 2));
}

test "isValidEraStateSlot" {
    // Slot 0 is valid state slot for era 0
    try std.testing.expect(isValidEraStateSlot(0, 0));
    // Slot SLOTS_PER_HISTORICAL_ROOT is valid state slot for era 1
    try std.testing.expect(isValidEraStateSlot(preset.SLOTS_PER_HISTORICAL_ROOT, 1));
    // Non-aligned slot is not valid
    try std.testing.expect(!isValidEraStateSlot(1, 0));
    try std.testing.expect(!isValidEraStateSlot(100, 0));
}

test "era number and block slot roundtrip" {
    // For any era number > 0, the start block slot should map back to that era
    for (1..10) |era_num| {
        const start_slot = try computeStartBlockSlotFromEraNumber(era_num);
        try std.testing.expectEqual(era_num, computeEraNumberFromBlockSlot(start_slot));
    }
}
