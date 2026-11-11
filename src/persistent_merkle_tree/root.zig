const std = @import("std");
const builtin = @import("builtin");
const build_options = @import("build_options");
const testing = std.testing;

// re-export depth for convenience
pub const Depth = @import("hashing").Depth;
pub const max_depth = @import("hashing").max_depth;

/// Gates the few safety checks, and allocation fills, whose cost has been measured to matter
/// in production.
///
/// Shipped binaries are built ReleaseSafe, so `std.debug.assert` and Zig's bounds and
/// overflow checks run in production and are our safety net there. Safe modes also make
/// `Allocator.create` fill new memory with 0xAA, so a read before write is deterministic.
/// Leave all of this in place; this flag covers only the exceptions below. Production
/// tolerates only a few percent of slowdown, while tests can afford a several-fold slowdown;
/// this flag separates the two.
///
/// Make work conditional on this flag only when all of these hold:
/// - The work exists only for safety: an extra hash-map lookup, a load from an otherwise
///   untouched cache line, a scan the surrounding code does not need, or a fill the caller
///   overwrites right away.
/// - It sits on a hot path that runs per chunk, per write, or per validator, not on control
///   flow that runs a handful of times per block.
/// - A profile of a real workload shows the cost, and a comment at the call site says what
///   work is skipped.
/// - The invariant holds by construction; for a skipped fill, every caller writes every
///   field before reading it. Validating external or untrusted input is never an assert;
///   return an error instead.
///
/// Never use this flag to turn off Zig's runtime safety (`@setRuntimeSafety`, bounds or
/// overflow checks). Prefer an unconditional O(1) assert before a loop over a gated assert
/// inside it. Never gate a check to silence a failure, and keep gated code free of effects a
/// correct caller can observe: for correct code, turning the flag on or off must not change
/// any result.
///
/// Gated checks still run in the Zig test builds: unit tests run in Debug, which defaults to
/// on; the fuzz harnesses set it to true; and CI sets it for the spec tests. There,
/// `Allocator.create` keeps its fill, so a read before write sees 0xAA rather than stale
/// data from a freed allocation.
pub const expensive_safety_checks = build_options.expensive_safety_checks orelse (builtin.mode == .Debug);

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
