const std = @import("std");

pub const Unit = enum { scalar, seconds, milliseconds, nanoseconds };

pub const Options = struct {
    unit: Unit = .scalar,
    population_max: ?u16 = null,
    nonnegative: bool = false,
};

pub fn Duration(comptime bounds_ms: []const u64) type {
    return Histogram(u64, bounds_ms, .{ .unit = .milliseconds });
}

pub fn Distribution(comptime bounds: []const f64) type {
    return Histogram(f64, bounds, .{ .population_max = 65_535 });
}

pub fn Histogram(comptime Value: type, comptime bounds_: []const Value, comptime options: Options) type {
    comptime {
        std.debug.assert(Value == u64 or Value == f64);
        std.debug.assert(bounds_.len > 0 and bounds_.len <= 16);
        for (bounds_) |bound| {
            if (Value == f64) std.debug.assert(std.math.isFinite(bound));
        }
        for (bounds_[1..], bounds_[0 .. bounds_.len - 1]) |next, previous| {
            std.debug.assert(next > previous);
        }
    }
    return struct {
        pub const bounds = bounds_;
        pub const unit = options.unit;
        pub const output_bounds = blk: {
            var values: [bounds.len]f64 = undefined;
            for (bounds, &values) |bound, *value| value.* = output(bound);
            break :blk values;
        };
        const Sum = if (Value == u64) u128 else f64;

        buckets: [bounds.len + 1]u64 = @splat(0),
        count: u64 = 0,
        sum: Sum = 0,

        pub fn observe(self: *@This(), value: Value) void {
            if (Value == f64) std.debug.assert(std.math.isFinite(value));
            if (options.nonnegative) std.debug.assert(value >= 0);
            if (options.population_max) |limit| std.debug.assert(self.count < limit);
            if (self.count == std.math.maxInt(u64)) return;
            var index: usize = bounds.len;
            for (bounds, 0..) |bound, i| {
                if (value <= bound) {
                    index = i;
                    break;
                }
            }
            self.buckets[index] += 1;
            self.count += 1;
            self.sum += value;
            if (Value == f64) std.debug.assert(std.math.isFinite(self.sum));
        }

        pub fn merge(self: *@This(), other: *const @This()) void {
            for (&self.buckets, other.buckets) |*value, addition| value.* +|= addition;
            self.count +|= other.count;
            if (Value == u64) self.sum +|= other.sum else self.sum += other.sum;
            if (Value == f64) std.debug.assert(std.math.isFinite(self.sum));
            if (options.population_max) |limit| std.debug.assert(self.count <= limit);
        }

        pub fn output(value: anytype) f64 {
            const number: f64 = if (@typeInfo(@TypeOf(value)) == .int)
                @floatFromInt(value)
            else
                value;
            return switch (unit) {
                .milliseconds => number / 1000,
                .nanoseconds => number / 1_000_000_000,
                else => number,
            };
        }
    };
}

test {
    _ = @import("histogram_test.zig");
}
