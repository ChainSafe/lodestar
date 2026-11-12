const std = @import("std");
const builtin = @import("builtin");
const js = @import("zapi:zapi").js;
const state_transition = @import("state_transition");
const validator_monitor = @import("./validator_monitor.zig");

var gpa: std.heap.DebugAllocator(.{}) = .init;
const allocator = if (builtin.mode == .Debug)
    gpa.allocator()
else
    std.heap.c_allocator;

threadlocal var initialized_historical: ?bool = null;

/// JS: metrics.init({historical?: boolean}) → void
pub fn init(options: ?js.Value) !void {
    var historical = false;
    if (options) |value| {
        const raw = value.toValue();
        if (try raw.hasNamedProperty("historical")) {
            historical = try (try raw.getNamedProperty("historical")).getValueBool();
        }
    }
    if (initialized_historical) |previous| {
        if (previous != historical) return error.MetricsAlreadyInitialized;
        return;
    }
    if (historical) {
        try state_transition.metrics.init(allocator, js.io(), .{ .prefix = "lodestar_historical_state_" });
    } else {
        try state_transition.metrics.init(allocator, js.io(), .{});
    }
    initialized_historical = historical;
}

/// JS: metrics.registerLocalValidator(index) → void
///
/// Adds a validator index to the environment's validator monitor so that
/// metrics are recorded for it on every epoch transition.
pub fn registerLocalValidator(index: js.Number) !void {
    const value = try index.toI64();
    if (value < 0) return error.InvalidValidatorIndex;
    try validator_monitor.get().registerLocalValidator(@intCast(value));
}

/// JS: metrics.unregisterLocalValidator(index) → void
///
/// Prunes a validator index from the environment's validator monitor.
pub fn unregisterLocalValidator(index: js.Number) !void {
    const value = try index.toI64();
    if (value < 0) return error.InvalidValidatorIndex;
    validator_monitor.get().unregisterLocalValidator(@intCast(value));
}

/// JS: metrics.scrapeMetrics() → string
pub fn scrapeMetrics() !js.String {
    var aw: std.Io.Writer.Allocating = .init(allocator);
    defer aw.deinit();

    try state_transition.metrics.write(&aw.writer);
    return js.String.from(aw.written());
}

pub fn deinit() void {
    validator_monitor.deinit();
    if (initialized_historical == null) return;
    state_transition.metrics.deinit();
    initialized_historical = null;
}
