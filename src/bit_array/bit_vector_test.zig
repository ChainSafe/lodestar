const std = @import("std");
const BitVector = @import("bit_vector.zig").BitVector;

test "BitVector owns exactly its packed bytes and enforces its fixed length" {
    inline for (.{ 0, 1, 7, 8, 9, 255, 256, 257 }) |length| {
        const Bits = BitVector(length);
        try std.testing.expectEqual((length + 7) / 8, @sizeOf(Bits));
        var bits = Bits.empty;
        try std.testing.expectEqual(null, bits.getSingleTrueBit());
        try std.testing.expectError(error.OutOfRange, bits.get(length));
        try std.testing.expectError(error.OutOfRange, bits.set(length, true));
        var indexes: [length]usize = undefined;
        try std.testing.expectEqual(0, try bits.getTrueBitIndexes(&indexes));

        if (length > 0) {
            try bits.set(length - 1, true);
            try std.testing.expectEqual(length - 1, bits.getSingleTrueBit());
            try std.testing.expectEqual(1, try bits.getTrueBitIndexes(&indexes));
            try std.testing.expectEqual(length - 1, indexes[0]);
            try std.testing.expectError(error.InvalidSize, bits.getTrueBitIndexes(indexes[0 .. length - 1]));

            var copy = bits;
            try std.testing.expect(bits.equals(&copy));
            try copy.set(length - 1, false);
            try std.testing.expect(!bits.equals(&copy));
            try std.testing.expect(try bits.get(length - 1));
        }
    }
}

test "BitVector - sanity with bools" {
    const Bits = BitVector(16);
    const expected_bools = [_]bool{ true, false, true, true, false, true, false, true, true, false, true, true, false, false, true, false };
    const expected_true_bit_indexes = [_]usize{ 0, 2, 3, 5, 7, 8, 10, 11, 14 };
    var b: Bits = try Bits.fromBoolArray(expected_bools);

    var actual_bools: [Bits.length]bool = undefined;
    b.toBoolArray(&actual_bools);

    try std.testing.expectEqualSlices(bool, &expected_bools, &actual_bools);

    var true_bit_indexes: [Bits.length]usize = undefined;
    const true_bit_count = try b.getTrueBitIndexes(true_bit_indexes[0..]);

    try std.testing.expectEqualSlices(usize, &expected_true_bit_indexes, true_bit_indexes[0..true_bit_count]);

    const expected_single_bool = [_]bool{ false, false, false, false, false, false, false, false, false, false, false, true, false, false, false, false };
    var b_single_bool: Bits = try Bits.fromBoolArray(expected_single_bool);

    try std.testing.expectEqual(b_single_bool.getSingleTrueBit(), 11);
}

test "BitVector - intersectValues" {
    const TestCase = struct { expected: []const u8, bit_len: usize };
    const test_cases = [_]TestCase{
        .{ .expected = &[_]u8{}, .bit_len = 16 },
        .{ .expected = &[_]u8{3}, .bit_len = 16 },
        .{ .expected = &[_]u8{ 0, 5, 6, 10, 14 }, .bit_len = 16 },
        .{ .expected = &[_]u8{ 0, 5, 6, 10, 14 }, .bit_len = 15 },
    };

    const allocator = std.testing.allocator;
    const Bits = BitVector(16);

    for (test_cases) |tc| {
        var b: Bits = Bits.empty;

        for (tc.expected) |i| try b.set(i, true);

        var values: [16]u8 = undefined;
        for (0..tc.bit_len) |i| values[i] = @intCast(i);

        var actual = try b.intersectValuesAlloc(u8, allocator, &values);
        defer actual.deinit(allocator);
        try std.testing.expectEqualSlices(u8, tc.expected, actual.items);

        var out: [16]u8 = undefined;
        const actual_no_alloc = b.intersectValues(u8, &values, &out);
        try std.testing.expectEqualSlices(u8, tc.expected, actual_no_alloc);
    }
}
