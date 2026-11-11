const std = @import("std");

/// Stores a fixed number of bits inline, with least-significant-bit-first indexing.
/// Keep unused trailing bits zero when writing data directly.
pub fn BitVector(comptime _length: comptime_int) type {
    const byte_len = std.math.divCeil(usize, _length, 8) catch unreachable;
    return struct {
        data: [byte_len]u8,

        pub const length = _length;

        pub const empty: @This() = .{
            .data = [_]u8{0} ** byte_len,
        };

        pub fn equals(self: *const @This(), other: *const @This()) bool {
            return std.mem.eql(u8, &self.data, &other.data);
        }

        pub fn fromBoolArray(bools: [length]bool) !@This() {
            var bv = empty;
            for (bools, 0..) |bit, i| {
                try bv.set(i, bit);
            }
            return bv;
        }

        pub fn toBoolArray(self: *const @This(), out: *[length]bool) void {
            for (0..length) |i| {
                out[i] = self.get(i) catch unreachable;
            }
        }

        pub fn getTrueBitIndexes(self: *const @This(), out: []usize) !usize {
            if (out.len < length) {
                return error.InvalidSize;
            }
            var true_bit_count: usize = 0;

            for (0..byte_len) |i_byte| {
                var b = self.data[i_byte];

                while (b != 0) {
                    const lsb: usize = @as(u8, @ctz(b));
                    const bit_index = i_byte * 8 + lsb;
                    out[true_bit_count] = bit_index;
                    true_bit_count += 1;
                    b &= b - 1;
                }
            }

            return true_bit_count;
        }

        pub fn getSingleTrueBit(self: *const @This()) ?usize {
            var found_index: ?usize = null;

            for (0..byte_len) |i_byte| {
                var b = self.data[i_byte];

                while (b != 0) {
                    if (found_index != null) {
                        return null; // more than one true bit found
                    }
                    const lsb: usize = @as(u8, @ctz(b));
                    const bit_index = i_byte * 8 + lsb;
                    found_index = bit_index;

                    b &= b - 1;
                }
            }
            return found_index;
        }

        pub fn get(self: *const @This(), bit_index: usize) !bool {
            if (bit_index >= length) {
                return error.OutOfRange;
            }

            const byte_idx = bit_index / 8;
            const offset_in_byte: u3 = @intCast(bit_index % 8);
            const mask = @as(u8, 1) << offset_in_byte;
            return (self.data[byte_idx] & mask) == mask;
        }

        /// Set bit value at index `bit_index`
        pub fn set(self: *@This(), bit_index: usize, bit: bool) !void {
            if (bit_index >= length) {
                return error.OutOfRange;
            }

            const byte_index = bit_index / 8;
            const offset_in_byte: u3 = @intCast(bit_index % 8);
            const mask = @as(u8, 1) << offset_in_byte;
            var byte = self.data[byte_index];
            if (bit) {
                // For bit in byte, 1,0 OR 1 = 1
                // byte 100110
                // mask 010000
                // res  110110
                byte |= mask;
                self.data[byte_index] = byte;
            } else {
                // For bit in byte, 1,0 OR 1 = 0
                if ((byte & mask) == mask) {
                    // byte 110110
                    // mask 010000
                    // res  100110
                    byte ^= mask;
                    self.data[byte_index] = byte;
                } else {
                    // Ok, bit is already 0
                }
            }
        }

        /// Returns values whose corresponding bit is set. Caller owns the returned list.
        pub fn intersectValuesAlloc(
            self: *const @This(),
            comptime T: type,
            allocator: std.mem.Allocator,
            values: *const [length]T,
        ) !std.ArrayList(T) {
            var indices = try std.ArrayList(T).initCapacity(allocator, byte_len * 8);

            for (0..byte_len) |i_byte| {
                var b = self.data[i_byte];
                // Kernighan's algorithm to count the set bits instead of going through 0..8 for every byte
                while (b != 0) {
                    const lsb: usize = @as(u8, @ctz(b)); // Get the index of least significant bit
                    const bit_index = i_byte * 8 + lsb;
                    indices.appendAssumeCapacity(values[bit_index]);
                    // The `b - 1` flips the bits starting from `lsb` index
                    // And `&` will reset the last bit at `lsb` index
                    b &= b - 1;
                }
            }
            return indices;
        }

        /// Returns a slice into `out` of values whose corresponding bit is set.
        pub fn intersectValues(
            self: *const @This(),
            comptime T: type,
            values: *const [length]T,
            out: *[length]T,
        ) []T {
            var i: usize = 0;
            for (0..byte_len) |i_byte| {
                var b = self.data[i_byte];
                // Kernighan's algorithm to count the set bits instead of going through 0..8 for every byte
                while (b != 0) {
                    const lsb: usize = @as(u8, @ctz(b)); // Get the index of least significant bit
                    const bit_index = i_byte * 8 + lsb;
                    out[i] = values[bit_index];
                    i += 1;
                    // The `b - 1` flips the bits starting from `lsb` index
                    // And `&` will reset the last bit at `lsb` index
                    b &= b - 1;
                }
            }

            return out[0..i];
        }
    };
}

test {
    _ = @import("bit_vector_test.zig");
}
