//! Tests for `merkleize.zig`.

const std = @import("std");
const rootToHex = @import("hex").rootToHex;
const maxChunksToDepth = @import("merkleize.zig").maxChunksToDepth;
const merkleize = @import("merkleize.zig").merkleize;

test "merkleize" {
    const TestCase = struct {
        chunk_count: usize,
        expected: []const u8,
    };

    const test_cases = comptime [_]TestCase{
        TestCase{ .chunk_count = 0, .expected = "0x0000000000000000000000000000000000000000000000000000000000000000" },
        TestCase{ .chunk_count = 1, .expected = "0x0000000000000000000000000000000000000000000000000000000000000000" },
        TestCase{ .chunk_count = 2, .expected = "0x5c85955f709283ecce2b74f1b1552918819f390911816e7bb466805a38ab87f3" },
        TestCase{ .chunk_count = 3, .expected = "0xee9bc4a60987257d8d2027f6352b676c86ed3c246622b135436eb69314974c7c" },
        TestCase{ .chunk_count = 4, .expected = "0xd35f51699389da7eec7ce5eb02640c6d318cf51ae39eca890bbc7b84ecb5da68" },
        TestCase{ .chunk_count = 5, .expected = "0x26b864a5fd6483296b66858580164a884e7ba8797ebf4c4a2500843b354f438d" },
        TestCase{ .chunk_count = 6, .expected = "0xcc5c078ca453a6a13bfa84c18f111ccb77477bd6284988fc9e414691cdba276d" },
        TestCase{ .chunk_count = 7, .expected = "0x51778544b05e4255d74b710bae7b966a5e5e7a00e3311bcb1a4059053bf9ce01" },
        TestCase{ .chunk_count = 8, .expected = "0x5837f89a763ab800bd3b8de6562aadb4e7ba54da125d1f41a7ebdcdebc977883" },
    };

    inline for (test_cases) |tc| {
        const chunk_count = if (tc.chunk_count % 2 == 1) tc.chunk_count + 1 else tc.chunk_count;
        const chunk_depth = maxChunksToDepth(tc.chunk_count);

        const expected = tc.expected;
        var chunks = [_][32]u8{[_]u8{0} ** 32} ** chunk_count;
        for (&chunks, 0..) |*chunk, i| {
            if (i >= tc.chunk_count) break;
            for (chunk) |*b| {
                b.* = @intCast(i);
            }
        }

        var output: [32]u8 = undefined;
        try merkleize(@ptrCast(&chunks), chunk_depth, &output);
        const hex = try rootToHex(&output);
        try std.testing.expectEqualSlices(u8, expected, &hex);
    }
}

test "maxChunksToDepth" {
    const results = [_]usize{ 0, 0, 1, 2, 2, 3, 3, 3, 3, 4 };
    for (0..results.len) |i| {
        const expected = results[i];
        const actual = maxChunksToDepth(i);
        try std.testing.expectEqual(expected, actual);
    }
}
