const std = @import("std");
const napi = @import("zapi:zapi").napi;
const n = @import("network");
const r = @import("network_runtime.zig");

pub const Export = struct {
    buffer: []u8 = &.{},
    length: usize = 0,

    /// Requires the capacity computed by metrics.textCapacity for the configured topics.
    pub fn init(capacity: usize) !Export {
        return .{ .buffer = try r.allocator.alloc(u8, capacity) };
    }
    pub fn deinit(self: *Export) void {
        r.allocator.free(self.buffer);
        self.* = .{};
    }
    /// The owner renders on demand; rendering and readers hold the runtime mutex.
    pub fn render(self: *Export, context: *const n.metrics.Context) void {
        var writer = std.Io.Writer.fixed(self.buffer);
        n.metrics.write(context, &writer) catch unreachable;
        self.length = writer.buffered().len;
    }

    /// The caller holds the runtime mutex.
    pub fn text(self: *Export, logs: *const n.logging.Stats, reports_dropped: u64, xray: ?*n.xray.Probe) []const u8 {
        var writer = std.Io.Writer.fixed(self.buffer);
        writer.end = self.length;
        var encoder: n.metrics.registry.Encoder = .{ .writer = &writer };
        logs.write(&encoder) catch unreachable;
        const reports = encoder.family(.{
            .name = "lodestar_peers_report_peer_dropped_total",
            .kind = .counter,
            .help = "Peer reports dropped because the binding's pending report table was full",
        }) catch unreachable;
        reports.sample(.{}, reports_dropped) catch unreachable;
        if (xray) |probe| probe.writeMetrics(&encoder) catch unreachable;
        return writer.buffered();
    }
};

/// Copy under the mutex, then construct the JavaScript value after releasing it.
pub fn value(runtime: *r.Runtime) !napi.Value {
    const copy = blk: {
        runtime.lock();
        defer runtime.unlock();
        const logs = runtime.logs.snapshot();
        const borrowed = runtime.metrics.text(&logs, runtime.bridge.reports.dropped, runtime.xray);
        break :blk try r.allocator.dupe(u8, borrowed);
    };
    defer r.allocator.free(copy);
    return runtime.env.createStringUtf8(copy);
}
