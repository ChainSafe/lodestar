const std = @import("std");

pub const Error = error{ Truncated, Overflow };
pub const length_max = 10;

pub const Decoded = struct {
    value: u64,
    length: usize,
};

pub fn encodedLength(value: u64) usize {
    var length: usize = 1;
    var rest = value >> 7;
    while (rest != 0) : (rest >>= 7) length += 1;
    std.debug.assert(length >= 1);
    std.debug.assert(length <= length_max);
    return length;
}

pub fn encode(value: u64, out: []u8) Error![]u8 {
    const length = encodedLength(value);
    if (out.len < length) return error.Truncated;
    var rest = value;
    for (out[0..length], 0..) |*byte, index| {
        const low: u8 = @truncate(rest & 0x7f);
        rest >>= 7;
        byte.* = if (index + 1 < length) low | 0x80 else low;
    }
    std.debug.assert(rest == 0);
    std.debug.assert(out[length - 1] & 0x80 == 0);
    return out[0..length];
}

pub fn decode(bytes: []const u8) Error!Decoded {
    var value: u64 = 0;
    for (0..length_max) |index| {
        if (index >= bytes.len) return error.Truncated;
        const byte = bytes[index];
        const payload: u64 = byte & 0x7f;
        if (index == length_max - 1 and payload > 1) return error.Overflow;
        const shift: u6 = @intCast(index * 7);
        value |= payload << shift;
        if (byte & 0x80 == 0) {
            if (index + 1 > encodedLength(value)) return error.Overflow;
            std.debug.assert(index + 1 == encodedLength(value));
            std.debug.assert(index + 1 <= bytes.len);
            return .{ .value = value, .length = index + 1 };
        }
    }
    return error.Overflow;
}

test {
    _ = @import("varint_test.zig");
}
