//! Tests for `sha256.zig`.

const std = @import("std");
const hashOne = @import("sha256.zig").hashOne;
const hash = @import("sha256.zig").hash;

test "hashOne works correctly" {
    const obj1: [32]u8 = [_]u8{1} ** 32;
    const obj2: [32]u8 = [_]u8{2} ** 32;
    var hash_result: [32]u8 = undefined;

    // Call the function and ensure it works without error
    hashOne(&hash_result, &obj1, &obj2);

    // Print the hash for manual inspection (optional)
    // std.debug.print("Hash value: {any}\n", .{hash_result});
    // std.debug.print("Hash hex: {s}\n", .{std.fmt.bytesToHex(hash_result, .lower)});
    // try std.testing.expect(mem.eql(u8, &hash_result, &expected_hash));
}

test hashOne {
    const in = [_][32]u8{[_]u8{1} ** 32} ** 4;
    var out: [2][32]u8 = undefined;
    try hash(&out, &in);
    // std.debug.print("@@@ out: {any}\n", .{out});
    var out2: [32]u8 = undefined;
    hashOne(&out2, &in[0], &in[2]);
    // std.debug.print("@@@ out2: {any}\n", .{out2});
    try std.testing.expectEqualSlices(u8, &out2, &out[0]);
    try std.testing.expectEqualSlices(u8, &out2, &out[1]);
}
