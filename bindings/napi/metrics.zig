const std = @import("std");
const builtin = @import("builtin");
const js = @import("zapi:zapi").js;
const m = @import("metrics");
const state_transition = @import("state_transition");
const pool = @import("./pool.zig");
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
    if (initialized_historical) |historical| {
        if (historical) {
            try writePoolMetrics(&aw.writer, "lodestar_historical_state_pmt_");
        } else {
            try writePoolMetrics(&aw.writer, "lodestar_pmt_");
        }
    }
    return js.String.from(aw.written());
}

fn writePoolMetrics(writer: *std.Io.Writer, comptime prefix: []const u8) !void {
    const rc = pool.state.pool_rc orelse return;
    const stats = rc.instance.pool.memoryStats();
    try writeGauge(
        writer,
        prefix ++ "node_pool_capacity",
        "Usable slots in the fixed-capacity native PMT node pool",
        stats.capacity,
    );
    try writeGauge(
        writer,
        prefix ++ "node_pool_nodes_in_use",
        "Usable slots currently occupied in the native PMT node pool",
        stats.nodes_in_use,
    );
    try writeGauge(
        writer,
        prefix ++ "node_pool_reserved_bytes",
        "Bytes requested for the native PMT node columns and free-slot bitmap",
        stats.reserved_bytes,
    );
    try writeGauge(
        writer,
        prefix ++ "chunked_leaf_slab_in_use_bytes",
        "Bytes occupied by live native PMT chunked leaf blobs",
        stats.chunked_leaf_bytes_in_use,
    );
    try writeGauge(
        writer,
        prefix ++ "chunked_leaf_slab_reserved_bytes",
        "Bytes requested for native PMT chunked leaf slab segments and metadata",
        stats.chunked_leaf_reserved_bytes,
    );
    try writeGauge(
        writer,
        prefix ++ "container_struct_nodes_in_use",
        "Live native PMT slots holding decoded container structs",
        stats.container_structs.count,
    );
    try writeGauge(
        writer,
        prefix ++ "container_struct_in_use_bytes",
        "Bytes occupied by live native PMT container structs and their references",
        stats.container_structs.bytes,
    );
    try writeGauge(
        writer,
        prefix ++ "struct_container_tree_views_in_use",
        "Live native SSZ struct container tree views backed by this PMT pool",
        stats.struct_container_tree_views.count,
    );
    try writeGauge(
        writer,
        prefix ++ "struct_container_tree_view_in_use_bytes",
        "Bytes occupied by live native SSZ struct container tree views backed by this PMT pool",
        stats.struct_container_tree_views.bytes,
    );
    try writeGauge(
        writer,
        prefix ++ "pool_heap_bytes",
        "Live bytes requested through the shared native PMT and state heap allocator",
        rc.instance.memory.bytesInUse(),
    );
}

fn writeGauge(writer: *std.Io.Writer, comptime name: []const u8, comptime help: []const u8, value: usize) !void {
    var gauge = m.Gauge(u64).init(name, .{ .help = help }, .{});
    gauge.set(value);
    try gauge.write(writer);
}

pub fn deinit() void {
    validator_monitor.deinit();
    if (initialized_historical == null) return;
    state_transition.metrics.deinit();
    initialized_historical = null;
}
