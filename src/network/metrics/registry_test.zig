const Encoder = @import("registry.zig").Encoder;
const Error = @import("registry.zig").Error;
const Registry = @import("registry.zig").Registry;
const Writer = std.Io.Writer;
const family_capacity = @import("registry.zig").family_capacity;
const std = @import("std");
const histogram = @import("histogram.zig");

test "metrics registry rejects duplicate families and histogram sample collisions" {
    var bytes: [4096]u8 = undefined;
    var writer: Writer = .fixed(&bytes);
    var encoder: Encoder = .{ .writer = &writer };
    _ = try encoder.family(.{ .name = "duration", .kind = .histogram, .help = "Duration", .bounds = &.{1} });
    try std.testing.expectError(error.DuplicateMetric, encoder.family(.{
        .name = "duration",
        .kind = .gauge,
        .help = "Conflicting type",
    }));
    try std.testing.expectError(error.DuplicateMetric, encoder.family(.{
        .name = "duration_count",
        .kind = .counter,
        .help = "Conflicting sample",
    }));
    encoder.count = 0;
    _ = try encoder.family(.{ .name = "duration_sum", .kind = .gauge, .help = "Sum" });
    try std.testing.expectError(error.DuplicateMetric, encoder.family(.{
        .name = "duration",
        .kind = .histogram,
        .help = "Conflicting histogram",
        .bounds = &.{1},
    }));
}

test "metrics registry escapes labels, bounds families and propagates writer exhaustion" {
    var bytes: [4096]u8 = undefined;
    var writer: Writer = .fixed(&bytes);
    var encoder: Encoder = .{ .writer = &writer };
    const metric = try encoder.family(.{
        .name = "value",
        .kind = .gauge,
        .help = "Line\npath\\",
        .labels = &.{"client"},
    });
    try metric.sample(.{"a\"\nb\\"}, 1);
    try std.testing.expectEqualStrings(
        "# HELP value Line\\npath\\\\\n# TYPE value gauge\nvalue{client=\"a\\\"\\nb\\\\\"} 1\n",
        writer.buffered(),
    );
    encoder.count = family_capacity;
    try std.testing.expectError(error.MetricCapacity, encoder.family(.{
        .name = "full",
        .kind = .gauge,
        .help = "Full",
    }));
    writer = .fixed(bytes[0..1]);
    encoder = .{ .writer = &writer };
    try std.testing.expectError(error.WriteFailed, encoder.scalar(.{
        .name = "short",
        .kind = .gauge,
        .help = "Short",
    }, 1));
}

test "metrics registry collectors share one snapshot and isolate repeated gathers" {
    const Context = struct {
        counter: u64,
        live: u16,

        fn totals(self: *const @This(), encoder: *Encoder) Error!void {
            try encoder.scalar(.{
                .name = "events_total",
                .kind = .counter,
                .help = "Events",
            }, self.counter);
        }

        fn current(self: *const @This(), encoder: *Encoder) Error!void {
            try encoder.scalar(.{
                .name = "active",
                .kind = .gauge,
                .help = "Active",
            }, self.live);
        }
    };
    const registry = Registry(Context, .{ Context.totals, Context.current });
    const first: Context = .{ .counter = 19, .live = 3 };
    const second: Context = .{ .counter = 7, .live = 0 };
    var bytes: [512]u8 = undefined;
    var writer: Writer = .fixed(&bytes);
    try registry.write(&first, &writer);
    try std.testing.expect(std.mem.endsWith(u8, writer.buffered(), "active 3\n"));
    const length = writer.end;
    var original: [512]u8 = undefined;
    @memcpy(original[0..length], writer.buffered());
    writer.end = 0;
    try registry.write(&second, &writer);
    try std.testing.expect(std.mem.find(u8, writer.buffered(), "events_total 7\n") != null);
    try std.testing.expect(std.mem.endsWith(u8, writer.buffered(), "active 0\n"));
    writer.end = 0;
    try registry.write(&first, &writer);
    try std.testing.expectEqualStrings(original[0..length], writer.buffered());
}

test "metrics registry formats finite histogram bounds without a decimal scratch limit" {
    const Histogram = histogram.Histogram(f64, &.{1e100}, .{});
    var value: Histogram = .{};
    value.observe(1);
    var bytes: [1024]u8 = undefined;
    var writer: Writer = .fixed(&bytes);
    var encoder: Encoder = .{ .writer = &writer };
    const metric = try encoder.histograms(.{
        .name = "values",
        .kind = .histogram,
        .help = "Values",
    }, Histogram);
    try metric.histogram(.{}, &value);
    try std.testing.expect(std.mem.find(u8, writer.buffered(), "values_bucket{le=\"+Inf\"} 1\n") != null);
    try std.testing.expect(std.mem.endsWith(u8, writer.buffered(), "values_count 1\n"));
}
