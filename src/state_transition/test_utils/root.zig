const std = @import("std");
const testing = std.testing;

/// Utils that could be used for different kinds of tests like int, perf
pub const TestCachedBeaconState = @import("./generate_state.zig").TestCachedBeaconState;
pub const generateElectraBlock = @import("./generate_block.zig").generateElectraBlock;
pub const interopSign = @import("./interop_pubkeys.zig").interopSign;

test {
    testing.refAllDecls(@This());
}
