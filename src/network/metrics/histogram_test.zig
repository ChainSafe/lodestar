const Distribution = @import("histogram.zig").Distribution;
const Duration = @import("histogram.zig").Duration;
const Histogram = @import("histogram.zig").Histogram;
const std = @import("std");

test "histogram inclusive boundaries, exact duration sums and independent merges" {
    var histogram: Duration(&.{ 100, 200 }) = .{};
    for ([_]u64{ 0, 100, 101, 200, 201 }) |value| histogram.observe(value);
    try std.testing.expectEqualSlices(u64, &.{ 2, 2, 1 }, &histogram.buckets);
    try std.testing.expectEqual(@as(u128, 602), histogram.sum);
    var combined: @TypeOf(histogram) = .{};
    combined.merge(&histogram);
    combined.merge(&histogram);
    try std.testing.expectEqual(@as(u64, 10), combined.count);
    try std.testing.expectEqual(@as(u128, 1204), combined.sum);
    try std.testing.expectEqual(@as(u64, 5), histogram.count);
    try std.testing.expectEqual(@as(f64, 0.602), @TypeOf(histogram).output(histogram.sum));
    histogram.observe(std.math.maxInt(u64));
    try std.testing.expectEqual(@as(u128, std.math.maxInt(u64)) + 602, histogram.sum);
}

test "histogram population includes negative boundaries and resets independently" {
    var value: Distribution(&.{ -50, 0, 25 }) = .{};
    for ([_]f64{ -100, -50, -1, 0, 25, 26 }) |sample| value.observe(sample);
    try std.testing.expectEqualSlices(u64, &.{ 2, 2, 1, 1 }, &value.buckets);
    try std.testing.expectEqual(@as(f64, -100), value.sum);
    value = .{};
    try std.testing.expectEqual(@as(u64, 0), value.count);
}

test "histogram lifetime observations stop at count saturation" {
    var value: Histogram(f64, &.{ 10, 100, 1000 }, .{ .nonnegative = true }) = .{};
    value.count = std.math.maxInt(u64);
    value.buckets[0] = value.count;
    value.sum = 12;
    value.observe(1);
    try std.testing.expectEqual(std.math.maxInt(u64), value.count);
    try std.testing.expectEqual(std.math.maxInt(u64), value.buckets[0]);
    try std.testing.expectEqual(@as(f64, 12), value.sum);
}
