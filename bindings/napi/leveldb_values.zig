const std = @import("std");
const napi = @import("zapi:zapi").napi;
const leveldb = @import("leveldb");
const Value = napi.Value;

pub const pending_operations_max = 65536;
pub const pending_bytes_max = 16 * 1024 * 1024 * 1024;
pub const path_bytes_max = leveldb.max_path_bytes;

pub fn integer(value: Value, maximum: usize) !usize {
    if (try value.typeof() != .number) return error.InvalidLimit;
    const number = try value.getValueDouble();
    if (!std.math.isFinite(number) or number < 0 or number > @as(f64, @floatFromInt(maximum)) or number != @trunc(number)) return error.InvalidLimit;
    return @intFromFloat(number);
}

pub fn positive(value: Value, maximum: usize) !usize {
    const result = try integer(value, maximum);
    if (result == 0) return error.InvalidLimit;
    return result;
}

pub fn boolean(value: Value) !bool {
    if (try value.typeof() != .boolean) return error.InvalidOptions;
    return value.getValueBool();
}

/// Only ordinary, attached Uint8Array storage is accepted. Shared storage can mutate during copy.
pub fn bytes(value: Value, maximum: usize, too_large: anyerror) ![]const u8 {
    if (!try value.isTypedarray()) return error.InvalidBytes;
    const info = try value.getTypedarrayInfo();
    if (info.array_type != .uint8 or !try info.arraybuffer.isArrayBuffer() or try info.arraybuffer.isDetachedArrayBuffer()) return error.InvalidBytes;
    if (info.length > maximum) return too_large;
    return info.data;
}

pub fn array(value: Value) !usize {
    if (!try value.isArray()) return error.InvalidOptions;
    const count = try value.getArrayLength();
    if (count > leveldb.max_bulk_entries) return error.BatchTooLarge;
    return count;
}

pub fn optionalInteger(options: Value, name: [:0]const u8, default: usize, maximum: usize) !usize {
    const value = try options.getNamedProperty(name);
    if (try value.typeof() == .undefined) return default;
    return positive(value, maximum);
}

pub fn optionalBoolean(options: Value, name: [:0]const u8, default: bool) !bool {
    const value = try options.getNamedProperty(name);
    if (try value.typeof() == .undefined) return default;
    return boolean(value);
}

pub fn parseOptions(value: Value) !leveldb.Options {
    if (try value.typeof() != .object or try value.isArray()) return error.InvalidOptions;
    const options: leveldb.Options = .{
        .create_if_missing = try optionalBoolean(value, "createIfMissing", true),
        .error_if_exists = try optionalBoolean(value, "errorIfExists", false),
        .cache_bytes = try optionalInteger(value, "cacheBytes", 8 * 1024 * 1024, 256 * 1024 * 1024),
        .write_buffer_bytes = try optionalInteger(value, "writeBufferBytes", 4 * 1024 * 1024, 64 * 1024 * 1024),
        .max_open_files = @intCast(try optionalInteger(value, "maxOpenFiles", 1000, 4096)),
    };
    try options.validate();
    return options;
}

pub fn path(value: Value, buffer: *[path_bytes_max + 1]u8) ![:0]const u8 {
    if (try value.typeof() != .string) return error.InvalidPath;
    var size: usize = 0;
    try napi.status.check(napi.c.napi_get_value_string_utf8(value.env, value.value, null, 0, &size));
    if (size == 0 or size > path_bytes_max) return error.InvalidPath;
    const result = try value.getValueStringUtf8(buffer);
    if (result.len != size or std.mem.findScalar(u8, result, 0) != null) return error.InvalidPath;
    return buffer[0..size :0];
}

pub fn errorValue(env: napi.Env, err: anyerror, detail: ?[]const u8) !Value {
    const name = try env.createStringUtf8(@errorName(err));
    const message = if (detail) |text| try env.createStringUtf8(text) else name;
    return env.createError(name, message);
}

pub fn completionFailure(env: napi.Env) !Value {
    // A retained Error created during open can root the native receiver through its captured stack.
    const result = try env.createObject();
    const message = try env.createStringUtf8("LevelDbCompletionFailed");
    try result.setNamedProperty("message", message);
    try result.setNamedProperty("code", message);
    return result;
}

pub fn callback(value: Value) !napi.Ref {
    if (try value.typeof() != .function) return error.InvalidCallback;
    return napi.Ref.create(value.env, value, 1);
}

pub fn notify(env: napi.Env, reference: napi.Ref, reason: ?Value, result: Value) !void {
    _ = try env.callFunction(try reference.getValue(), try env.getUndefined(), .{
        if (reason) |value| value else try env.getNull(), result,
    });
}

pub fn failureReason(env: napi.Env, fallback: napi.Ref, err: anyerror, detail: ?[]const u8) !Value {
    if (try env.isExceptionPending()) return env.getAndClearLastException();
    return errorValue(env, err, detail) catch {
        if (try env.isExceptionPending()) return env.getAndClearLastException();
        return fallback.getValue();
    };
}
