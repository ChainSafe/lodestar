const std = @import("std");
const napi = @import("zapi:zapi").napi;
const n = @import("network");
const Value = napi.Value;
const t = n.peers.types;

pub fn object(value: Value, comptime names: []const []const u8) !void {
    if (try value.typeof() != .object or try value.isArray()) return error.InvalidNetworkConfig;
    const keys = try value.getAllPropertyNames(.own_only, .all_properties, .numbers_to_strings);
    const count = try keys.getArrayLength();
    if (count > names.len) return error.InvalidNetworkConfig;
    for (0..count) |i| {
        const key = try keys.getElement(@intCast(i));
        if (try key.typeof() != .string) return error.InvalidNetworkConfig;
        var buf: [80]u8 = undefined;
        const name = try key.getValueStringUtf8(&buf);
        var known = false;
        inline for (names) |allowed| {
            if (std.mem.eql(u8, name, allowed)) known = true;
        }
        if (!known) return error.InvalidNetworkConfig;
    }
}

pub fn get(value: Value, comptime name: [:0]const u8) !Value {
    return value.getNamedProperty(name);
}

pub fn integer(value: Value, max: u64) !u64 {
    if (try value.typeof() != .number) return error.InvalidNetworkInteger;
    const numeric = try value.getValueDouble();
    if (!std.math.isFinite(numeric) or numeric < 0 or numeric > 9007199254740991 or numeric != @trunc(numeric) or numeric > @as(f64, @floatFromInt(max))) return error.InvalidNetworkInteger;
    return @intFromFloat(numeric);
}

pub fn bigint(value: Value) !u64 {
    if (try value.typeof() != .bigint) return error.InvalidNetworkInteger;
    var lossless = false;
    const result = try value.getValueBigintUint64(&lossless);
    if (!lossless) return error.InvalidNetworkInteger;
    return result;
}

pub fn boolean(value: Value) !bool {
    if (try value.typeof() != .boolean) return error.InvalidNetworkConfig;
    return value.getValueBool();
}

pub fn number(value: Value) !f64 {
    if (try value.typeof() != .number) return error.InvalidNetworkConfig;
    const result = try value.getValueDouble();
    if (!std.math.isFinite(result)) return error.InvalidNetworkConfig;
    return result;
}

/// Borrows an attached Uint8Array. Do not retain it across calls that can run JavaScript.
pub fn byteView(value: Value) ![]const u8 {
    if (!try value.isTypedarray()) return error.InvalidNetworkBytes;
    const info = try value.getTypedarrayInfo();
    if (info.array_type != .uint8 or try info.arraybuffer.isDetachedArrayBuffer()) return error.InvalidNetworkBytes;
    return info.data;
}

pub fn bytes(value: Value, out: []u8) !void {
    const view = try byteView(value);
    if (view.len != out.len) return error.InvalidNetworkBytes;
    @memcpy(out, view);
}

pub fn fixed(comptime len: usize, value: Value) ![len]u8 {
    var out: [len]u8 = undefined;
    try bytes(value, &out);
    return out;
}

pub fn peerIdFrom(value: Value) !n.PeerId {
    if (try value.typeof() != .string) return error.InvalidNetworkPeerId;
    var len: usize = 0;
    try napi.status.check(napi.c.napi_get_value_string_utf16(value.env, value.value, null, 0, &len));
    if (len == 0 or len > n.wire.peer_id.text_length_max) return error.InvalidNetworkPeerId;
    var buffer: [n.wire.peer_id.text_length_max + 1]u16 = undefined;
    const decoded = try value.getValueStringUtf16(buffer[0 .. len + 1]);
    if (decoded.len != len) return error.InvalidNetworkPeerId;
    var encoded: [n.wire.peer_id.text_length_max]u8 = undefined;
    for (decoded, encoded[0..len]) |char, *byte| {
        if (char > 127) return error.InvalidNetworkPeerId;
        byte.* = @intCast(char);
    }
    return n.PeerId.fromText(encoded[0..len]) catch return error.InvalidNetworkPeerId;
}

pub fn array(value: Value, max: usize) !u32 {
    if (!try value.isArray()) return error.InvalidNetworkConfig;
    const count = try value.getArrayLength();
    if (count > max) return error.InvalidNetworkConfig;
    return count;
}

pub fn fork(value: Value) !t.ForkSeq {
    if (try value.typeof() != .string) return error.InvalidNetworkConfig;
    var buf: [32]u8 = undefined;
    const name = try value.getValueStringUtf8(&buf);
    return std.meta.stringToEnum(t.ForkSeq, name) orelse error.InvalidNetworkConfig;
}

pub fn endpoint(value: Value) !std.Io.net.IpAddress {
    try object(value, &.{ "family", "address", "port" });
    const family = try integer(try get(value, "family"), 6);
    const port: u16 = @intCast(try integer(try get(value, "port"), 65535));
    return switch (family) {
        4 => .{ .ip4 = .{ .bytes = try fixed(4, try get(value, "address")), .port = port } },
        6 => blk: {
            const octets = try fixed(16, try get(value, "address"));
            if (n.Address.isIp4Mapped(octets)) return error.InvalidNetworkConfig;
            break :blk .{ .ip6 = .{ .bytes = octets, .port = port } };
        },
        else => error.InvalidNetworkConfig,
    };
}

pub fn completeObject(value: Value, comptime names: []const []const u8) !void {
    try object(value, names);
    const keys = try value.getAllPropertyNames(.own_only, .all_properties, .numbers_to_strings);
    if (try keys.getArrayLength() != names.len) return error.InvalidNetworkConfig;
}

pub fn handle(comptime Token: type, value: Value, capacity: usize) !Token {
    std.debug.assert(capacity > 0);
    try completeObject(value, &.{ "index", "generation" });
    return .{
        .index = @intCast(try integer(try get(value, "index"), capacity - 1)),
        .generation = try bigint(try get(value, "generation")),
    };
}

pub fn text(value: Value, out: []u8) !usize {
    if (try value.typeof() != .string) return error.InvalidNetworkConfig;
    var len: usize = 0;
    try napi.status.check(napi.c.napi_get_value_string_utf8(value.env, value.value, null, 0, &len));
    if (len > out.len) return error.InvalidNetworkConfig;
    var buffer: [1025]u8 = undefined;
    if (len + 1 > buffer.len) return error.InvalidNetworkConfig;
    const copied = try value.getValueStringUtf8(buffer[0 .. len + 1]);
    if (copied.len != len or !std.unicode.utf8ValidateSlice(copied)) return error.InvalidNetworkConfig;
    @memcpy(out[0..len], copied);
    return len;
}
