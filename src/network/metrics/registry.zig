const std = @import("std");
const Writer = std.Io.Writer;

pub const Kind = enum { counter, gauge, histogram };
pub const Unit = enum { scalar, seconds, bytes };
pub const Error = Writer.Error || error{ DuplicateMetric, MetricCapacity };
pub const family_capacity = 512;
const name_capacity = 160;
const label_capacity = 4;

pub const Descriptor = struct {
    name: []const u8,
    help: []const u8,
    kind: Kind,
    labels: []const []const u8 = &.{},
    unit: Unit = .scalar,
    bounds: []const f64 = &.{},
};

/// Collection runs on the state owner. Registration retains only static descriptors.
pub fn Registry(comptime Context: type, comptime collectors: anytype) type {
    std.debug.assert(collectors.len > 0 and collectors.len <= 32);
    return struct {
        pub fn write(context: *const Context, writer: *Writer) Error!void {
            var encoder: Encoder = .{ .writer = writer };
            try collect(context, &encoder);
        }

        pub fn collect(context: *const Context, encoder: *Encoder) Error!void {
            inline for (collectors) |collector| try collector(context, encoder);
        }
    };
}

pub const Encoder = struct {
    writer: *Writer,
    descriptors: [family_capacity]*const Descriptor = undefined,
    count: usize = 0,

    pub fn family(self: *Encoder, comptime descriptor: Descriptor) Error!Family(descriptor) {
        comptime validate(descriptor);
        if (self.count == self.descriptors.len) return error.MetricCapacity;
        for (self.descriptors[0..self.count]) |previous| {
            if (conflicts(previous, &descriptor)) return error.DuplicateMetric;
        }
        self.descriptors[self.count] = &descriptor;
        self.count += 1;
        try self.writer.writeAll("# HELP " ++ descriptor.name ++ " ");
        try escape(self.writer, descriptor.help, false);
        try self.writer.writeAll("\n# TYPE " ++ descriptor.name ++ " " ++
            @tagName(descriptor.kind) ++ "\n");
        return .{ .writer = self.writer };
    }

    pub fn scalar(self: *Encoder, comptime descriptor: Descriptor, value: anytype) Error!void {
        const metric = try self.family(descriptor);
        try metric.sample(.{}, value);
    }

    pub fn histograms(
        self: *Encoder,
        comptime descriptor: Descriptor,
        comptime Histogram: type,
    ) Error!Family(histogramDescriptor(descriptor, Histogram)) {
        return self.family(histogramDescriptor(descriptor, Histogram));
    }

    pub fn enums(
        self: *Encoder,
        comptime descriptor: Descriptor,
        comptime Enum: type,
        values: anytype,
    ) Error!void {
        comptime std.debug.assert(descriptor.labels.len == 1);
        const metric = try self.family(descriptor);
        inline for (std.meta.fields(Enum)) |field| {
            try metric.sample(.{field.name}, values[field.value]);
        }
    }

    pub fn counters(self: *Encoder, comptime prefix: []const u8, values: anytype) Error!void {
        inline for (std.meta.fields(@TypeOf(values.*))) |field| {
            if (comptime std.mem.endsWith(u8, field.name, "_ms_total")) {
                try self.scalar(.{
                    .name = prefix ++ field.name[0 .. field.name.len - "_ms_total".len] ++
                        "_seconds_total",
                    .kind = .counter,
                    .help = "Cumulative native " ++ field.name ++ " in seconds",
                    .unit = .seconds,
                }, @as(f64, @floatFromInt(@field(values, field.name))) / 1000);
            } else {
                const suffix = if (comptime std.mem.endsWith(u8, field.name, "_total"))
                    ""
                else
                    "_total";
                try self.scalar(.{
                    .name = prefix ++ field.name ++ suffix,
                    .kind = .counter,
                    .help = "Native " ++ field.name,
                }, @field(values, field.name));
            }
        }
    }
};

pub fn Family(comptime descriptor: Descriptor) type {
    return struct {
        writer: *Writer,

        pub fn sample(self: @This(), labels: anytype, value: anytype) Writer.Error!void {
            comptime std.debug.assert(descriptor.kind != .histogram);
            try self.writer.writeAll(descriptor.name);
            try self.labelsWrite(labels, null);
            try self.writer.print(" {d}\n", .{value});
        }

        pub fn histogram(self: @This(), labels: anytype, value: anytype) Writer.Error!void {
            comptime std.debug.assert(descriptor.kind == .histogram);
            const H = @TypeOf(value.*);
            comptime if (H.unit == .milliseconds) std.debug.assert(descriptor.unit == .seconds);
            comptime std.debug.assert(std.mem.eql(f64, descriptor.bounds, &H.output_bounds));
            var cumulative: u64 = 0;
            inline for (descriptor.bounds, 0..) |bound, index| {
                cumulative +|= value.buckets[index];
                const boundary = comptime blk: {
                    @setEvalBranchQuota(10_000);
                    break :blk std.fmt.comptimePrint("{d}", .{bound});
                };
                try self.writer.writeAll(descriptor.name ++ "_bucket");
                try self.labelsWrite(labels, boundary);
                try self.writer.print(" {d}\n", .{cumulative});
            }
            try self.writer.writeAll(descriptor.name ++ "_bucket");
            try self.labelsWrite(labels, "+Inf");
            try self.writer.print(" {d}\n", .{value.count});
            try self.writer.writeAll(descriptor.name ++ "_sum");
            try self.labelsWrite(labels, null);
            try self.writer.print(" {d}\n", .{H.output(value.sum)});
            try self.writer.writeAll(descriptor.name ++ "_count");
            try self.labelsWrite(labels, null);
            try self.writer.print(" {d}\n", .{value.count});
        }

        fn labelsWrite(self: @This(), labels: anytype, boundary: ?[]const u8) Writer.Error!void {
            comptime std.debug.assert(labels.len == descriptor.labels.len);
            if (labels.len == 0 and boundary == null) return;
            try self.writer.writeByte('{');
            inline for (descriptor.labels, 0..) |name, index| {
                if (index > 0) try self.writer.writeByte(',');
                try self.writer.writeAll(name ++ "=\"");
                try escape(self.writer, labels[index], true);
                try self.writer.writeByte('"');
            }
            if (boundary) |value| {
                if (labels.len > 0) try self.writer.writeByte(',');
                try self.writer.print("le=\"{s}\"", .{value});
            }
            try self.writer.writeByte('}');
        }
    };
}

fn validate(comptime descriptor: Descriptor) void {
    std.debug.assert(validName(descriptor.name, true));
    std.debug.assert(descriptor.help.len > 0 and descriptor.help.len <= 1024);
    std.debug.assert(descriptor.labels.len <= label_capacity);
    if (descriptor.kind == .histogram) {
        std.debug.assert(descriptor.bounds.len > 0 and descriptor.bounds.len <= 16);
        for (descriptor.bounds, 0..) |bound, index| {
            std.debug.assert(std.math.isFinite(bound));
            if (index > 0) std.debug.assert(bound > descriptor.bounds[index - 1]);
        }
    } else std.debug.assert(descriptor.bounds.len == 0);
    for (descriptor.labels, 0..) |label, index| {
        std.debug.assert(validName(label, false));
        std.debug.assert(!std.mem.startsWith(u8, label, "__"));
        if (descriptor.kind == .histogram) std.debug.assert(!std.mem.eql(u8, label, "le"));
        for (descriptor.labels[0..index]) |previous| {
            std.debug.assert(!std.mem.eql(u8, label, previous));
        }
    }
}

fn histogramDescriptor(comptime descriptor: Descriptor, comptime Histogram: type) Descriptor {
    std.debug.assert(descriptor.kind == .histogram);
    var result = descriptor;
    result.bounds = &Histogram.output_bounds;
    return result;
}

fn validName(name: []const u8, metric: bool) bool {
    if (name.len == 0 or name.len > name_capacity) return false;
    for (name, 0..) |char, index| {
        if (std.ascii.isAlphabetic(char) or char == '_' or (metric and char == ':')) continue;
        if (index > 0 and std.ascii.isDigit(char)) continue;
        return false;
    }
    return true;
}

fn conflicts(left: *const Descriptor, right: *const Descriptor) bool {
    if (std.mem.eql(u8, left.name, right.name)) return true;
    const suffixes = [_][]const u8{ "_bucket", "_sum", "_count" };
    for (suffixes) |suffix| {
        if (left.kind == .histogram and suffixed(left.name, suffix, right.name)) return true;
        if (right.kind == .histogram and suffixed(right.name, suffix, left.name)) return true;
    }
    return false;
}

fn suffixed(base: []const u8, suffix: []const u8, name: []const u8) bool {
    return name.len == base.len + suffix.len and std.mem.startsWith(u8, name, base) and
        std.mem.endsWith(u8, name, suffix);
}

fn escape(writer: *Writer, value: []const u8, quotes: bool) Writer.Error!void {
    std.debug.assert(value.len <= 1024);
    for (value) |char| switch (char) {
        '\\' => try writer.writeAll("\\\\"),
        '\n' => try writer.writeAll("\\n"),
        '"' => if (quotes) try writer.writeAll("\\\"") else try writer.writeByte(char),
        else => try writer.writeByte(char),
    };
}

test {
    _ = @import("registry_test.zig");
}
