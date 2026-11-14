//! Packed bit collections independent of serialization and Merkle trees.

const std = @import("std");

pub const BitList = @import("bit_list.zig").BitList;
pub const BitListOptions = @import("bit_list.zig").BitListOptions;
pub const unlimited = @import("bit_list.zig").unlimited;
pub const BitVector = @import("bit_vector.zig").BitVector;

/// Read an LSB-first packed bit. The byte containing bit_index must exist.
pub fn getBit(bytes: []const u8, bit_index: usize) bool {
    std.debug.assert(bit_index / 8 < bytes.len);
    return (bytes[bit_index / 8] >> @intCast(bit_index % 8)) & 1 == 1;
}

test {
    _ = @import("bit_list.zig");
    _ = @import("bit_vector.zig");

    const bytes = [_]u8{ 0b10000101, 0b10000010 };
    const expected = [_]bool{ true, false, true, false, false, false, false, true, false, true, false, false, false, false, false, true };
    for (expected, 0..) |bit, i| {
        try std.testing.expectEqual(bit, getBit(&bytes, i));
    }
}
