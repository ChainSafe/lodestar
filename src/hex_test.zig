//! Tests for `hex.zig`.

const std = @import("std");
const hexToBytes = @import("hex.zig").hexToBytes;
const hexByteLen = @import("hex.zig").hexByteLen;
const hasOxPrefix = @import("hex.zig").hasOxPrefix;
const rootToHex = @import("hex.zig").rootToHex;

test "rootToHex" {
    const TestCase = struct {
        root: *const [32]u8,
        expected: []const u8,
    };

    const test_cases = [_]TestCase{
        TestCase{ .root = &[_]u8{0} ** 32, .expected = "0x0000000000000000000000000000000000000000000000000000000000000000" },
        TestCase{ .root = &[_]u8{10} ** 32, .expected = "0x0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a" },
        TestCase{ .root = &[_]u8{17} ** 32, .expected = "0x1111111111111111111111111111111111111111111111111111111111111111" },
        TestCase{ .root = &[_]u8{255} ** 32, .expected = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
    };

    for (test_cases) |tc| {
        const hex = try rootToHex(tc.root);
        try std.testing.expectEqualSlices(u8, tc.expected, &hex);
    }
}

test "hexToBytes" {
    const TestCase = struct {
        hex: []const u8,
        expected: []const u8,
    };

    const test_cases = [_]TestCase{
        TestCase{ .hex = "00000000", .expected = &[_]u8{ 0, 0, 0, 0 } },
        TestCase{ .hex = "c78009fd", .expected = &[_]u8{ 199, 128, 9, 253 } },
        TestCase{ .hex = "C78009FD", .expected = &[_]u8{ 199, 128, 9, 253 } },
        TestCase{ .hex = "0x00000000", .expected = &[_]u8{ 0, 0, 0, 0 } },
        TestCase{ .hex = "0xc78009fd", .expected = &[_]u8{ 199, 128, 9, 253 } },
        TestCase{ .hex = "0xC78009FD", .expected = &[_]u8{ 199, 128, 9, 253 } },
    };

    inline for (test_cases) |tc| {
        var out = [_]u8{0} ** tc.expected.len;
        _ = try hexToBytes(&out, tc.hex);
        try std.testing.expectEqualSlices(u8, tc.expected, &out);
    }
}

test "hasOxPrefix and hexByteLen should accept strings shorter than the prefix" {
    try std.testing.expect(!hasOxPrefix(""));
    try std.testing.expect(!hasOxPrefix("0"));
    try std.testing.expect(hasOxPrefix("0x"));
    try std.testing.expectEqual(@as(usize, 0), hexByteLen(""));
    try std.testing.expectEqual(@as(usize, 0), hexByteLen("0"));

    var out: [1]u8 = undefined;
    try std.testing.expectEqual(@as(usize, 0), (try hexToBytes(out[0..0], "")).len);
    try std.testing.expectError(error.InvalidLength, hexToBytes(out[0..0], "0"));
}
