const std = @import("std");
const BitList = @import("bit_list.zig").BitList;
const unlimited = @import("bit_list.zig").unlimited;

test "BitList finite limits include zero and reject growth before allocating" {
    inline for (.{ 0, 17 }) |limit| {
        const Bits = BitList(.{ .limit = limit });
        var bits = try Bits.fromBitLen(std.testing.allocator, limit);
        defer bits.deinit(std.testing.allocator);

        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
        const allocator = failing.allocator();
        try std.testing.expectError(error.tooLarge, Bits.fromBitLen(allocator, limit + 1));
        try std.testing.expectError(error.tooLarge, bits.resize(allocator, limit + 1));
        try std.testing.expectError(error.tooLarge, bits.set(allocator, limit, true));
        try std.testing.expectEqual(limit, bits.bit_len);
        try std.testing.expect(!failing.has_induced_failure);
        try std.testing.expectError(error.OutOfRange, bits.get(limit));
    }
}

test "BitList shrink and regrow clears discarded bits across byte boundaries" {
    const allocator = std.testing.allocator;
    inline for (.{ BitList(.{ .limit = 258 }), BitList(.{ .limit = unlimited }) }) |Bits| {
        for ([_]usize{ 0, 1, 7, 8, 9, 255, 256, 257 }) |retained| {
            var bits = try Bits.fromBoolSlice(allocator, &([_]bool{true} ** 257));
            defer bits.deinit(allocator);

            try bits.resize(allocator, retained);
            try std.testing.expectEqual(retained, bits.bit_len);
            try std.testing.expectEqual((retained + 7) / 8, bits.data.items.len);
            try bits.resize(allocator, 257);
            for (0..257) |i| try std.testing.expectEqual(i < retained, try bits.get(i));

            try bits.resize(allocator, 0);
            try bits.set(allocator, retained, true);
            try std.testing.expectEqual(retained + 1, bits.bit_len);
            try std.testing.expectEqual(retained, bits.getSingleTrueBit());
        }
    }
}

test "memory_safety: BitList rejects an unrepresentable length before allocating" {
    inline for (.{ BitList(.{ .limit = std.math.maxInt(usize) }), BitList(.{ .limit = unlimited }) }) |Bits| {
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
        const allocator = failing.allocator();
        var bits = Bits.empty;
        defer bits.deinit(allocator);

        try std.testing.expectError(error.tooLarge, bits.set(allocator, std.math.maxInt(usize), true));
        try std.testing.expectEqual(0, bits.bit_len);
        try std.testing.expectEqual(0, bits.data.items.len);
        try std.testing.expect(!failing.has_induced_failure);
        try std.testing.expectError(error.OutOfMemory, Bits.fromBitLen(allocator, std.math.maxInt(usize)));
    }
}

test "memory_safety: BitList failed growth preserves its value" {
    inline for (.{ BitList(.{ .limit = 257 }), BitList(.{ .limit = unlimited }) }) |Bits| {
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
        const allocator = failing.allocator();
        var bits = try Bits.fromBoolSlice(allocator, &.{ true, false, true });
        defer bits.deinit(allocator);

        failing.fail_index = failing.alloc_index;
        failing.resize_fail_index = failing.resize_index;
        try std.testing.expectError(error.OutOfMemory, bits.resize(allocator, 257));
        try std.testing.expectError(error.OutOfMemory, bits.set(allocator, 256, true));
        try std.testing.expectEqual(3, bits.bit_len);
        try std.testing.expectEqualSlices(u8, &.{0b101}, bits.data.items);

        try bits.set(allocator, 1, true);
        bits.setAssumeCapacity(0, false);
        try std.testing.expectEqualSlices(u8, &.{0b110}, bits.data.items);
    }
}

test "BitList - sanity with bools" {
    inline for (.{ BitList(.{ .limit = 16 }), BitList(.{ .limit = unlimited }) }) |Bits| {
        const allocator = std.testing.allocator;
        const expected_bools = [_]bool{ true, false, true, true, false, true, false, true, true, false, true, true };
        const expected_true_bit_indexes = [_]usize{ 0, 2, 3, 5, 7, 8, 10, 11 };
        var b: Bits = try Bits.fromBoolSlice(allocator, &expected_bools);
        defer b.deinit(allocator);

        var actual_bools = try allocator.alloc(bool, expected_bools.len);
        defer allocator.free(actual_bools);
        try b.toBoolSlice(&actual_bools);

        try std.testing.expectEqualSlices(bool, &expected_bools, actual_bools);
        try std.testing.expect(try b.get(0) == true);

        var true_bit_indexes: [expected_bools.len]usize = undefined;
        const true_bit_count = try b.getTrueBitIndexes(true_bit_indexes[0..]);

        try std.testing.expectEqualSlices(usize, &expected_true_bit_indexes, true_bit_indexes[0..true_bit_count]);

        const expected_single_bool = [_]bool{ false, false, false, false, false, true, false, false, false, false, false, false };
        var b_single_bool: Bits = try Bits.fromBoolSlice(allocator, &expected_single_bool);
        defer b_single_bool.deinit(allocator);

        try std.testing.expectEqual(b_single_bool.getSingleTrueBit(), 5);
    }
}

test "BitList - intersectValues" {
    inline for (.{ BitList(.{ .limit = 16 }), BitList(.{ .limit = unlimited }) }) |Bits| {
        const TestCase = struct { expected: []const u8, bit_len: usize };
        const test_cases = [_]TestCase{
            .{ .expected = &[_]u8{}, .bit_len = 16 },
            .{ .expected = &[_]u8{3}, .bit_len = 16 },
            .{ .expected = &[_]u8{ 0, 5, 6, 10, 14 }, .bit_len = 16 },
            .{ .expected = &[_]u8{ 0, 5, 6, 10, 14 }, .bit_len = 15 },
        };

        const allocator = std.testing.allocator;

        for (test_cases) |tc| {
            var b: Bits = try Bits.fromBitLen(allocator, tc.bit_len);
            defer b.deinit(allocator);

            for (tc.expected) |i| b.setAssumeCapacity(i, true);

            var values = try std.ArrayList(u8).initCapacity(allocator, tc.bit_len);
            defer values.deinit(allocator);
            for (0..tc.bit_len) |i| values.appendAssumeCapacity(@intCast(i));

            var actual = try b.intersectValues(u8, u8, allocator, values.items);
            defer actual.deinit(allocator);
            try std.testing.expectEqualSlices(u8, tc.expected, actual.items);
        }
    }
}

test "BitList resize and set should enforce length bounds" {
    const allocator = std.testing.allocator;

    const Bits = BitList(.{ .limit = 16 });
    // First byte: 1, 0, 1, 1, 0, 1, 0, 1 = 173
    // Second byte: 1, 0, 1, 1, 1, 0, 1, 1 = 221
    const bools = [_]bool{ true, false, true, true, false, true, false, true, true, false, true, true, true, false, true, true };
    var b: Bits = try Bits.fromBoolSlice(allocator, &bools);
    defer b.deinit(allocator);

    try std.testing.expect(b.data.items.len == 2);
    try std.testing.expect(b.data.items[0] == 173);
    try std.testing.expect(b.data.items[1] == 221);

    // Resize to 5 bits. Now it should only have one byte,
    // with the last 3 bits in the byte being wiped out.
    // First byte: 1, 0, 1, 1, 0, 0, 0, 0 = 13
    try b.resize(allocator, 5);

    try std.testing.expect(b.data.items.len == 1);
    try std.testing.expect(b.data.items[0] == 13);

    try std.testing.expectError(
        error.tooLarge,
        b.set(allocator, std.math.maxInt(usize), true),
    );
}

test "BitList intersectValues widens selected indices across byte boundaries" {
    const allocator = std.testing.allocator;
    var bits = try BitList(.{ .limit = 16 }).fromBitLen(allocator, 10);
    defer bits.deinit(allocator);
    try bits.set(allocator, 0, true);
    try bits.set(allocator, 7, true);
    try bits.set(allocator, 9, true);
    const indices = [_]u32{ 0, 1, 2, 3, 4, 5, 6, std.math.maxInt(u32) - 1, 8, std.math.maxInt(u32) };
    var selected = try bits.intersectValues(u64, u32, allocator, indices[0..]);
    defer selected.deinit(allocator);
    try std.testing.expectEqualSlices(u64, &.{ 0, std.math.maxInt(u32) - 1, std.math.maxInt(u32) }, selected.items);
}
