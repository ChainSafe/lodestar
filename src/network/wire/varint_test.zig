const std = @import("std");
const varint = @import("varint.zig");

test "varint round trips boundary values" {
    const values = [_]u64{ 0, 1, 127, 128, 300, 16_383, 16_384, std.math.maxInt(u32), std.math.maxInt(u64) };
    for (values) |value| {
        var buffer: [varint.length_max]u8 = undefined;
        const encoded = try varint.encode(value, &buffer);
        try std.testing.expectEqual(varint.encodedLength(value), encoded.len);
        const decoded = try varint.decode(encoded);
        try std.testing.expectEqual(value, decoded.value);
        try std.testing.expectEqual(encoded.len, decoded.length);
    }
}

test "varint encodes known bytes" {
    var buffer: [varint.length_max]u8 = undefined;
    try std.testing.expectEqualSlices(u8, &.{ 0x91, 0x02 }, try varint.encode(273, &buffer));
    try std.testing.expectEqualSlices(u8, &.{ 0xcd, 0x03 }, try varint.encode(461, &buffer));
    try std.testing.expectEqualSlices(u8, &.{ 0xa5, 0x03 }, try varint.encode(421, &buffer));
}

test "varint rejects truncated and overflowing input" {
    try std.testing.expectError(error.Truncated, varint.decode(&.{}));
    try std.testing.expectError(error.Truncated, varint.decode(&.{0x80}));
    try std.testing.expectError(error.Overflow, varint.decode(&([_]u8{0xff} ** 11)));
    try std.testing.expectError(error.Overflow, varint.decode(&([_]u8{0xff} ** 9 ++ [_]u8{0x02})));
    var small: [1]u8 = undefined;
    try std.testing.expectError(error.Truncated, varint.encode(128, &small));
}

test "varint rejects non-minimal encodings" {
    try std.testing.expectError(error.Overflow, varint.decode(&.{ 0x84, 0x00 }));
    try std.testing.expectError(error.Overflow, varint.decode(&.{ 0x80, 0x00 }));
    try std.testing.expectError(error.Overflow, varint.decode(&([_]u8{0x80} ** 9 ++ [_]u8{0x00})));
    const decoded = try varint.decode(&.{0x04});
    try std.testing.expectEqual(@as(u64, 4), decoded.value);
    try std.testing.expectEqual(@as(usize, 1), decoded.length);
}
