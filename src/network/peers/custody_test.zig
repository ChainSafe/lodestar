const std = @import("std");
const c = @import("custody.zig");
const expect = std.testing.expect;
const equal = std.testing.expectEqual;

// Literal outputs from consensus-specs v1.7.0-alpha.11, commit
// 7d5f3348d7b947851861745be9ce0ba30e526531, specs/fulu/das-core.md:get_custody_groups.
// Extracted Python source SHA256: 9aa7c369849da48f2810db79c05022d8e4f471ab7c20afab152938b38e5b476e.
test "custody pinned independent vectors and integer byte order" {
    const cases = [_]struct { id: [32]u8, expected: []const u8, hashes: u16 }{
        .{ .id = @splat(0), .expected = &.{ 1, 17, 19, 42, 75, 87, 102, 117 }, .hashes = 8 },
        .{ .id = @splat(255), .expected = &.{ 1, 17, 19, 42, 47, 75, 87, 102 }, .hashes = 8 },
        .{ .id = ordered_id, .expected = &.{ 40, 57, 61, 84, 102, 105, 113, 120 }, .hashes = 9 },
    };
    for (&cases) |*case| {
        var work = try c.Derivation.init(&case.id, .{ .groups = 128, .columns = 128 }, 8);
        const groups = (try work.step(64)).?;
        try equal(@as(usize, 8), groups.count());
        for (case.expected) |group| try expect(groups.isSet(group));
        try equal(case.hashes, work.hashes);
    }
}
const ordered_id: [32]u8 = .{ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31 };

test "custody resumable near-full duplicates and work exhaustion discard partial groups" {
    var work = try c.Derivation.init(&ordered_id, .{ .groups = 128, .columns = 128 }, 127);
    try expect(try work.step(64) == null);
    try equal(@as(u16, 64), work.hashes);
    var result: ?c.Groups = null;
    for (0..8) |_| result = try work.step(64);
    try equal(@as(u16, 545), work.hashes);
    try equal(@as(usize, 127), result.?.count());
    try expect(!result.?.isSet(89));
    work = try c.Derivation.init(&ordered_id, .{ .groups = 128, .columns = 128 }, 127);
    _ = try work.step(64);
    work.hashes = 4096;
    try std.testing.expectError(error.WorkLimit, work.step(64));
    try equal(@as(usize, 0), work.groups.count());
    try std.testing.expectError(error.WorkLimit, work.step(64));
}

test "custody group column mapping independent runtime and preset boundaries" {
    var work = try c.Derivation.init(&ordered_id, .{ .groups = 64, .columns = 128 }, 8);
    const groups = (try work.step(64)).?;
    for ([_]u8{ 20, 38, 40, 41, 49, 56, 57, 61 }) |group| try expect(groups.isSet(group));
    try equal(@as(u16, 9), work.hashes);
    var columns: [128]u16 = undefined;
    const config: c.Config = .{ .groups = 64, .columns = 128 };
    try equal(@as(usize, 2), try config.columnsForGroup(20, &columns));
    try std.testing.expectEqualSlices(u16, &.{ 20, 84 }, columns[0..2]);
    try std.testing.expectError(error.InvalidGroup, config.columnsForGroup(64, &columns));
    try std.testing.expectError(error.OutputTooSmall, config.columnsForGroup(20, columns[0..1]));
    const preset_columns = @import("preset").NUMBER_OF_COLUMNS;
    work = try c.Derivation.init(&ordered_id, .{ .groups = @min(128, preset_columns), .columns = preset_columns }, @min(128, preset_columns));
    try equal(@as(usize, @min(128, preset_columns)), (try work.step(0)).?.count());
    try equal(@as(u16, 0), work.hashes);
    work = try c.Derivation.init(&ordered_id, config, 0);
    try equal(@as(usize, 0), (try work.step(0)).?.count());
    try std.testing.expectError(error.InvalidCount, c.Derivation.init(&ordered_id, config, 65));
    for ([_]c.Config{ .{ .groups = 0, .columns = 128 }, .{ .groups = 129, .columns = 128 }, .{ .groups = 3, .columns = 128 }, .{ .groups = 64, .columns = 0 } }) |invalid| {
        try std.testing.expectError(error.InvalidConfig, c.Derivation.init(&ordered_id, invalid, 1));
    }
}

test "sampling paired literal custody and sampling checkpoint" {
    var work = try c.SamplingDerivation.init(&@as([32]u8, @splat(0)), .{ .groups = 128, .columns = 128 }, 4, 8);
    const result = (try work.step(64)).?;
    try equal(@as(usize, 4), result.custody.count());
    try equal(@as(usize, 8), result.sampling.count());
    for ([_]u8{ 1, 17, 87, 102 }) |group| try expect(result.custody.isSet(group));
    for ([_]u8{ 1, 17, 19, 42, 75, 87, 102, 117 }) |group| try expect(result.sampling.isSet(group));
    try equal(@as(u16, 8), work.totalHashes());
}

test "sampling paired one hash budgets ordered wrap and equal counts" {
    const cases = [_]struct { id: [32]u8, actual: []const u8, sample: []const u8, hashes: u16 }{
        .{ .id = @splat(255), .actual = &.{ 1, 47, 87, 102 }, .sample = &.{ 1, 17, 19, 42, 47, 75, 87, 102 }, .hashes = 8 },
        .{ .id = ordered_id, .actual = &.{ 57, 84, 105, 113 }, .sample = &.{ 40, 57, 61, 84, 102, 105, 113, 120 }, .hashes = 9 },
    };
    for (&cases) |*case| {
        var work = try c.SamplingDerivation.init(&case.id, .{ .groups = 128, .columns = 128 }, 4, 8);
        for (0..case.hashes - 1) |_| {
            try expect(try work.step(1) == null);
            try expect(work.complete() == null);
        }
        const result = (try work.step(1)).?;
        for (case.actual) |group| try expect(result.custody.isSet(group));
        for (case.sample) |group| try expect(result.sampling.isSet(group));
        try equal(@as(usize, 4), result.custody.count());
        try equal(@as(usize, 8), result.sampling.count());
        try equal(case.hashes, work.totalHashes());
        try equal(result, (try work.step(64)).?);
        try equal(case.hashes, work.totalHashes());
        work = try c.SamplingDerivation.init(&case.id, .{ .groups = 128, .columns = 128 }, 8, 0);
        const same = (try work.step(64)).?;
        try equal(same.custody, same.sampling);
        try equal(case.hashes, work.totalHashes());
    }
}

test "sampling paired near full shared attempts and full sampling shortcut" {
    for ([_]u16{ 127, 128 }) |minimum| {
        var work = try c.SamplingDerivation.init(&ordered_id, .{ .groups = 128, .columns = 128 }, 127, minimum);
        for (0..8) |_| try expect(try work.step(64) == null);
        const result = (try work.step(64)).?;
        try equal(@as(u16, 545), work.totalHashes());
        try equal(@as(usize, 127), result.custody.count());
        try expect(!result.custody.isSet(89));
        try equal(@as(usize, minimum), result.sampling.count());
    }
    var work = try c.SamplingDerivation.init(&ordered_id, .{ .groups = 128, .columns = 128 }, 4, 127);
    for (0..8) |_| try expect(try work.step(64) == null);
    try equal(@as(usize, 127), (try work.step(64)).?.sampling.count());
    try equal(@as(u16, 545), work.totalHashes());
    for ([_]u16{ 0, 128 }) |count| {
        work = try c.SamplingDerivation.init(&ordered_id, .{ .groups = 128, .columns = 128 }, count, 128);
        try equal(@as(usize, count), work.complete().?.custody.count());
        try equal(@as(usize, 128), work.complete().?.sampling.count());
        try equal(@as(u16, 0), work.totalHashes());
    }
    work = try c.SamplingDerivation.init(&ordered_id, .{ .groups = 128, .columns = 128 }, 0, 8);
    try equal(@as(usize, 0), (try work.step(64)).?.custody.count());
    try equal(@as(u16, 9), work.totalHashes());
}

test "sampling paired permanent work ceiling discards checkpoint and partial walk" {
    var work = try c.SamplingDerivation.init(&ordered_id, .{ .groups = 128, .columns = 128 }, 4, 127);
    try expect(try work.step(64) == null);
    try expect(work.checkpoint != null);
    work.walk.hashes = 4095;
    try std.testing.expectError(error.WorkLimit, work.step(1));
    try equal(@as(u16, 4096), work.totalHashes());
    try expect(work.exhausted());
    try expect(work.complete() == null);
    try expect(work.checkpoint == null);
    try equal(@as(usize, 0), work.walk.groups.count());
    try std.testing.expectError(error.WorkLimit, work.step(64));
    try equal(@as(u16, 4096), work.totalHashes());
    for ([_]c.Config{ .{ .groups = 0, .columns = 128 }, .{ .groups = 129, .columns = 128 }, .{ .groups = 3, .columns = 128 }, .{ .groups = 64, .columns = 0 } }) |invalid| {
        try std.testing.expectError(error.InvalidConfig, c.SamplingDerivation.init(&ordered_id, invalid, 1, 8));
    }
    try std.testing.expectError(error.InvalidCount, c.SamplingDerivation.init(&ordered_id, .{ .groups = 64, .columns = 128 }, 65, 8));
    try std.testing.expectError(error.InvalidCount, c.SamplingDerivation.init(&ordered_id, .{ .groups = 64, .columns = 128 }, 1, 65));
}

test "sampling paired zero helper and remaining checkpoint budget" {
    var work = try c.SamplingDerivation.init(&ordered_id, .{ .groups = 128, .columns = 128 }, 0, 0);
    try equal(@as(usize, 0), work.complete().?.custody.count());
    try equal(@as(usize, 0), work.complete().?.sampling.count());
    try equal(@as(u16, 0), work.totalHashes());
    work = try c.SamplingDerivation.init(&@as([32]u8, @splat(0)), .{ .groups = 128, .columns = 128 }, 4, 8);
    try expect(try work.step(5) == null);
    try equal(@as(u16, 5), work.totalHashes());
    try equal(@as(usize, 4), work.checkpoint.?.count());
    try expect(work.complete() == null);
    try equal(@as(usize, 8), (try work.step(3)).?.sampling.count());
    try equal(@as(u16, 8), work.totalHashes());
}
