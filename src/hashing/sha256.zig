const std = @import("std");
const hashtree = @import("hashtree");

fn hashComptime(out: [][32]u8, in: []const [32]u8) !void {
    if (in.len != 2 * out.len) {
        return error.InvalidInput;
    }
    for (0..in.len / 2) |i| {
        @setEvalBranchQuota(1_000_000);
        std.crypto.hash.sha2.Sha256.hash(
            @ptrCast(in[i * 2 .. i * 2 + 2]),
            &out[i],
            .{},
        );
    }
}

/// Hash a slice of 32-byte arrays into a slice of 32-byte outputs.
///
/// This function will error if `in.len != 2 * out.len`.
pub inline fn hash(out: [][32]u8, in: []const [32]u8) !void {
    if (@inComptime()) {
        try hashComptime(out, in);
    } else {
        try hashtree.hash(out, in);
    }
}

/// Hash a single pair of 32-byte arrays into a 32-byte output.
pub fn hashOne(out: *[32]u8, left: *const [32]u8, right: *const [32]u8) void {
    var in = [_][32]u8{ left.*, right.* };
    hash(@ptrCast(out), &in) catch unreachable;
}

test {
    _ = @import("sha256_test.zig");
}
