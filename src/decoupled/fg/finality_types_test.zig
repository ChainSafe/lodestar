const std = @import("std");
const testing = std.testing;
const fg = @import("finality_types.zig");
const limits = @import("../limits.zig");

fn root(n: u8) fg.Root {
    return @splat(n);
}

test "unit-weight quorum rounds up and K_W has only its specified lower bound" {
    var config: fg.Config = .{ .B_gen = root(0), .n = 1, .K_W = 2, .delta_t = 0 };
    const expected = [_]u32{ 1, 2, 2, 3, 4, 4, 5, 6 };
    for (expected, 1..) |q, n| {
        config.n = @intCast(n);
        try testing.expectEqual(q, config.quorum());
    }
    config.K_W = std.math.maxInt(u32);
    try testing.expect(config.valid());
    config.delta_t = std.math.maxInt(u32);
    try testing.expect(config.valid());
    config.K_W = 1;
    try testing.expect(!config.valid());
    config.K_W = 2;
    config.n = 0;
    try testing.expect(!config.valid());
    config.n = limits.max_validators + 1;
    try testing.expect(!config.valid());
}

test "attestation shape distinguishes bottom from zero roots and accepts old-height wire votes" {
    var a: fg.Attestation = .{ .val_index = 0, .h = 1, .T = root(0), .tau = false };
    try testing.expect(a.valid(4));
    a.h_f = 0;
    try testing.expect(!a.valid(4));
    a.T_f = root(0);
    try testing.expect(a.valid(4));
    a.h_f = 1;
    try testing.expect(!a.valid(4));
    a.h_f = null;
    try testing.expect(!a.valid(4));
    a.T_f = null;
    a.h = 0;
    try testing.expect(!a.valid(4));
    a.h = std.math.maxInt(u32);
    try testing.expect(a.valid(4));
    a.val_index = 4;
    try testing.expect(!a.valid(4));
}

test "pool identity includes the validator while signing-record identity uses contents" {
    const a: fg.Attestation = .{ .val_index = 0, .h = 1, .T = root(0), .tau = false };
    var b = a;
    try testing.expect(a.eql(&b));
    b.val_index = 1;
    try testing.expect(!a.eql(&b));
    try testing.expect(a.contentEql(&b));
    b = a;
    b.tau = true;
    try testing.expect(!a.contentEql(&b));
    b = a;
    b.h = 2;
    try testing.expect(!a.contentEql(&b));
    b = a;
    b.T = root(1);
    try testing.expect(!a.contentEql(&b));
    b = a;
    b.h_f = 0;
    b.T_f = root(0);
    try testing.expect(!a.contentEql(&b));
}
