//! Each N-API environment owns its validator monitor and metrics.
//!
//! This file is intentionally NOT exported as a JS module in `root.zig`:
//! it only holds native state. JS interacts with it through
//! `metrics.registerLocalValidator()` and the metrics scraped via
//! `metrics.scrapeMetrics()`.

const std = @import("std");
const builtin = @import("builtin");
const state_transition = @import("state_transition");

var gpa: std.heap.DebugAllocator(.{}) = .init;
const allocator = if (builtin.mode == .Debug)
    gpa.allocator()
else
    std.heap.c_allocator;

/// Fed by `BeaconStateView.processSlots`/`stateTransition` on every epoch
/// transition. Only records metrics for validators registered via
/// `metrics.registerLocalValidator()`.
threadlocal var monitor = state_transition.ValidatorMonitor.init(allocator);

/// Returns this environment's validator monitor.
pub fn get() *state_transition.ValidatorMonitor {
    return &monitor;
}

/// Frees this environment's monitor state.
pub fn deinit() void {
    monitor.deinit();
    monitor = state_transition.ValidatorMonitor.init(allocator);
}
