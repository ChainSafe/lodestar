const std = @import("std");
const Diagnostics = @import("diagnostics.zig").Diagnostics;
const withdrawalsRootMismatch = @import("diagnostics.zig").withdrawalsRootMismatch;
const withdrawalsLengthMismatch = @import("diagnostics.zig").withdrawalsLengthMismatch;

test "diagnostics should preserve the error and own its details" {
    var expected = @as([32]u8, @splat(0xab));
    var actual = @as([32]u8, @splat(0xcd));
    var diagnostics: Diagnostics = .{};
    try std.testing.expectEqual(
        error.WithdrawalsRootMismatch,
        withdrawalsRootMismatch(&diagnostics, &expected, &actual),
    );
    try std.testing.expectEqual(
        error.WithdrawalsRootMismatch,
        withdrawalsRootMismatch(null, &expected, &actual),
    );
    @memset(&expected, 0);
    @memset(&actual, 0);

    var output: [192]u8 = undefined;
    try std.testing.expectEqualStrings(
        "WithdrawalsRootMismatch expected=0x" ++
            ("abababababababababababababababababababababababababababababababab") ++
            " actual=0x" ++
            ("cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd"),
        try std.fmt.bufPrint(&output, "{f}", .{&diagnostics.detail.?}),
    );
}

test "diagnostics should record withdrawal length mismatch" {
    var diagnostics: Diagnostics = .{};
    try std.testing.expectEqual(
        error.WithdrawalsLengthMismatch,
        withdrawalsLengthMismatch(&diagnostics, 2, 1),
    );

    const mismatch = &diagnostics.detail.?.withdrawals_length_mismatch;
    try std.testing.expectEqual(@as(usize, 2), mismatch.expected);
    try std.testing.expectEqual(@as(usize, 1), mismatch.actual);

    var output: [64]u8 = undefined;
    try std.testing.expectEqualStrings(
        "WithdrawalsLengthMismatch expected=2 actual=1",
        try std.fmt.bufPrint(&output, "{f}", .{&diagnostics.detail.?}),
    );
    try std.testing.expectEqual(
        error.WithdrawalsLengthMismatch,
        withdrawalsLengthMismatch(null, 2, 1),
    );
}
