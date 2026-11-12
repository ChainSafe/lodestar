const std = @import("std");
const js = @import("zapi:zapi").js;
const Value = @import("zapi:zapi").napi.Value;
const decode = @import("network_js_input.zig");
const logging = @import("network").logging;
const Runtime = @import("network_runtime.zig").Runtime;

pub fn drain(runtime: *Runtime, limit: Value) !js.Value {
    const max = decode.integer(limit, logging.drain_max) catch return error.InvalidDrainLimit;
    if (max == 0) return error.InvalidDrainLimit;
    var records: [logging.drain_max]logging.Record = undefined;
    const batch = runtime.logs.peek(records[0..@intCast(max)]);
    const env = js.env();
    const array = try env.createArrayWithLength(batch.count);
    for (records[0..batch.count], 0..) |*record, i| {
        const value = try env.createObject();
        try value.setNamedProperty("level", try env.createStringUtf8(logging.levelName(record.level)));
        try value.setNamedProperty("scope", try env.createStringUtf8(@tagName(record.scope)));
        try value.setNamedProperty("message", try env.createStringUtf8(record.message[0..record.len]));
        try value.setNamedProperty("timestampMs", try env.createDouble(@floatFromInt(record.timestamp_ms)));
        try array.setElement(@intCast(i), value);
    }
    const result = try env.createObject();
    try result.setNamedProperty("records", array);
    try result.setNamedProperty("more", try env.getBoolean(batch.more));
    runtime.logs.commit(batch.count);
    return .{ .val = result };
}

pub fn configure(runtime: *Runtime, value: Value) !void {
    runtime.logs.configure(try level(value));
}

/// A threshold by name: error, warn, info or debug, or null for off.
pub fn level(value: Value) !?std.log.Level {
    var buffer: [5]u8 = undefined;
    const len = decode.text(value, &buffer) catch return error.InvalidNetworkLogLevel;
    const text = buffer[0..len];
    inline for (.{ "error", "warn", "info", "debug", "off" }, 0..) |name, index| {
        if (std.mem.eql(u8, text, name)) return if (index == 4) null else @enumFromInt(index);
    }
    return error.InvalidNetworkLogLevel;
}
