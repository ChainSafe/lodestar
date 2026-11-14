const std = @import("std");
const builtin = @import("builtin");
const build_options = @import("build_options");
const testing = std.testing;

// re-export depth for convenience
pub const Depth = @import("hashing").Depth;
pub const max_depth = @import("hashing").max_depth;

/// Lodestar uses asserts in production for correctness and safety like in TigerStyle,
/// unless they severely degrade performance.
///
/// Use this flag to gate assertions if and only if the following rules are satisfied:
///
/// - The cost of the assertion is measured through benchmarks.
/// - It sits on a hot path that runs per chunk, per write, or per validator. In such cases,
///.   prefer an unconditional O(1) assert before the loop.
/// - The invariant holds by construction.
///
/// When using this gate, it must ALWAYS come with an accompanying comment on why
/// the assertion is gated.
///
/// This is turned on by default for `Debug` builds for testing, and set to true for fuzzing.
pub const expensive_safety_checks = build_options.expensive_safety_checks orelse (builtin.mode == .Debug);

pub const Gindex = @import("gindex.zig").Gindex;
pub const Node = @import("Node.zig");
pub const View = @import("View.zig");
pub const proof = @import("proof.zig");
pub const ChunkedLeaf = @import("ChunkedLeaf.zig");

test {
    testing.refAllDecls(@This());
    _ = @import("ChunkedLeaf.zig");
    _ = @import("ChunkedLeafSlab.zig");
    _ = @import("FreeSlotBitmap.zig");
    _ = @import("gindex.zig");
    _ = @import("Node.zig");
    _ = @import("proof.zig");
    _ = @import("View.zig");
}
