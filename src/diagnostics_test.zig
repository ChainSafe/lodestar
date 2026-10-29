const std = @import("std");
const Diagnostics = @import("diagnostics.zig").Diagnostics;
const state_transition = @import("diagnostics.zig").state_transition;

test "diagnostics should preserve the error and own its details" {
    var expected = [_]u8{0xab} ** 32;
    var actual = [_]u8{0xcd} ** 32;
    var diagnostics: Diagnostics = .{};
    try std.testing.expectEqual(
        error.WithdrawalsRootMismatch,
        state_transition.withdrawalsRootMismatch(&diagnostics, &expected, &actual),
    );
    try std.testing.expectEqual(
        error.WithdrawalsRootMismatch,
        state_transition.withdrawalsRootMismatch(null, &expected, &actual),
    );
    @memset(&expected, 0);
    @memset(&actual, 0);

    var output: [192]u8 = undefined;
    try std.testing.expectEqualStrings(
        "WithdrawalsRootMismatch expected=0x" ++
            ("ab" ** 32) ++
            " actual=0x" ++
            ("cd" ** 32),
        try std.fmt.bufPrint(&output, "{f}", .{&diagnostics.detail.?}),
    );
}

test "diagnostics should record withdrawal length mismatch" {
    var diagnostics: Diagnostics = .{};
    try std.testing.expectEqual(
        error.WithdrawalsLengthMismatch,
        state_transition.withdrawalsLengthMismatch(&diagnostics, 2, 1),
    );

    const mismatch = &diagnostics.detail.?.state_transition.withdrawals_length_mismatch;
    try std.testing.expectEqual(@as(usize, 2), mismatch.expected);
    try std.testing.expectEqual(@as(usize, 1), mismatch.actual);

    var output: [64]u8 = undefined;
    try std.testing.expectEqualStrings(
        "WithdrawalsLengthMismatch expected=2 actual=1",
        try std.fmt.bufPrint(&output, "{f}", .{&diagnostics.detail.?}),
    );
    try std.testing.expectEqual(
        error.WithdrawalsLengthMismatch,
        state_transition.withdrawalsLengthMismatch(null, 2, 1),
    );
}
