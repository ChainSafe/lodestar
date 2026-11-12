const std = @import("std");
const fmt = std.fmt;

pub fn hexToBytesComptime(comptime n: usize, comptime input: []const u8) [n]u8 {
    var out: [n]u8 = undefined;
    _ = hexToBytes(out[0..], input) catch unreachable;
    return out;
}

/// Convert hex to bytes with 0x-prefix support
pub fn hexToBytes(out: []u8, input: []const u8) ![]u8 {
    if (hasOxPrefix(input)) {
        return try fmt.hexToBytes(out, input[2..]);
    } else {
        return try fmt.hexToBytes(out, input);
    }
}

/// Convert bytes to hex with 0x-prefix
pub fn bytesToHex(out: []u8, input: []const u8) ![]u8 {
    return try fmt.bufPrint(out, "0x{x}", .{input});
}

pub fn hexToRoot(input: *const [66]u8) ![32]u8 {
    var out: [32]u8 = undefined;
    _ = try hexToBytes(&out, input);
    return out;
}

pub fn hexIntoRoot(out: *[32]u8, input: *const [66]u8) !void {
    _ = try hexToBytes(out, input);
}

pub fn rootToHex(input: *const [32]u8) ![66]u8 {
    var out: [66]u8 = undefined;
    _ = try bytesToHex(&out, input);
    return out;
}

pub fn rootIntoHex(out: *[66]u8, input: *const [32]u8) !void {
    _ = try bytesToHex(out, input);
}

pub fn hasOxPrefix(hex: []const u8) bool {
    return hex.len >= 2 and hex[0] == '0' and hex[1] == 'x';
}

pub fn hexByteLen(hex: []const u8) usize {
    return if (hasOxPrefix(hex)) (hex.len - 2) / 2 else hex.len / 2;
}

pub fn hexLenFromBytes(bytes: []const u8) usize {
    return 2 + bytes.len * 2;
}

test {
    _ = @import("hex_test.zig");
}
