//! Packed bit collections independent of serialization and Merkle trees.

pub const BitList = @import("bit_list.zig").BitList;
pub const BitListOptions = @import("bit_list.zig").BitListOptions;
pub const unlimited = @import("bit_list.zig").unlimited;
pub const BitVector = @import("bit_vector.zig").BitVector;

test {
    _ = @import("bit_list.zig");
    _ = @import("bit_vector.zig");
}
