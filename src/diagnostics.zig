const std = @import("std");
pub const state_transition = @import("diagnostics/state_transition.zig");

/// Initialize to .{} before each operation. Details own their values and survive failure cleanup.
pub const Diagnostics = struct {
    detail: ?ErrorDetails = null,
};

pub const ErrorDetails = union(enum) {
    state_transition: state_transition.ErrorDetails,

    pub fn format(self: *const ErrorDetails, writer: *std.Io.Writer) std.Io.Writer.Error!void {
        switch (self.*) {
            inline else => |*detail| try detail.format(writer),
        }
    }
};

test {
    _ = @import("diagnostics_test.zig");
}
