const std = @import("std");
const testing = std.testing;

// re-export depth for convenience
pub const Depth = @import("hashing").Depth;
pub const max_depth = @import("hashing").max_depth;

pub const Gindex = @import("gindex.zig").Gindex;
pub const Node = @import("Node.zig");
pub const View = @import("View.zig");
pub const proof = @import("proof.zig");
pub const ChunkedLeaf = @import("ChunkedLeaf.zig");

test {
    testing.refAllDecls(@This());
    _ = @import("ChunkedLeaf.zig");
    _ = @import("gindex.zig");
    _ = @import("Node.zig");
    _ = @import("proof.zig");
    _ = @import("View.zig");
}
