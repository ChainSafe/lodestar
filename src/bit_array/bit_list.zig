const std = @import("std");

pub const unlimited: ?usize = null;

pub const BitListOptions = struct {
    /// Maximum logical length in bits; unlimited imposes no limit beyond usize.
    limit: ?usize,
};

/// Owns packed bytes with least-significant-bit-first indexing.
/// Keep data.items.len equal to ceil(bit_len / 8) and unused trailing bits zero.
pub fn BitList(comptime options: BitListOptions) type {
    const limit = options.limit orelse std.math.maxInt(usize);
    return struct {
        data: std.ArrayList(u8),
        bit_len: usize,

        pub const empty: @This() = .{
            .data = std.ArrayList(u8).empty,
            .bit_len = 0,
        };

        pub fn equals(self: *const @This(), other: *const @This()) bool {
            return self.bit_len == other.bit_len and std.mem.eql(u8, self.data.items, other.data.items);
        }

        pub fn fromBitLen(allocator: std.mem.Allocator, bit_len: usize) !@This() {
            if (bit_len > limit) {
                return error.tooLarge;
            }

            const byte_len = std.math.divCeil(usize, bit_len, 8) catch unreachable;

            var data = try std.ArrayList(u8).initCapacity(allocator, byte_len);
            data.appendNTimesAssumeCapacity(0, byte_len);
            return @This(){
                .data = data,
                .bit_len = bit_len,
            };
        }

        pub fn fromBoolSlice(allocator: std.mem.Allocator, bools: []const bool) !@This() {
            var bl = try @This().fromBitLen(allocator, bools.len);
            errdefer bl.deinit(allocator);

            for (bools, 0..) |bit, i| {
                try bl.set(allocator, i, bit);
            }
            return bl;
        }

        pub fn toBoolSlice(self: *const @This(), out: *[]bool) !void {
            if (out.len != self.bit_len) {
                return error.InvalidSize;
            }
            for (0..self.bit_len) |i| {
                out.*[i] = self.get(i) catch unreachable;
            }
        }

        pub fn getTrueBitIndexes(self: *const @This(), out: []usize) !usize {
            if (out.len < self.bit_len) {
                return error.InvalidSize;
            }

            const full_byte_len = self.bit_len / 8;
            const remainder_bits = self.bit_len % 8;
            var true_bit_count: usize = 0;

            for (0..full_byte_len) |i_byte| {
                var b = self.data.items[i_byte];
                while (b != 0) {
                    const lsb: u8 = @ctz(b);
                    const bit_index = i_byte * 8 + lsb;
                    out[true_bit_count] = bit_index;
                    true_bit_count += 1;
                    b &= b - 1;
                }
            }
            if (remainder_bits <= 0) return true_bit_count;
            const tail_mask: u8 = (@as(u8, 1) << @intCast(remainder_bits)) - 1;
            var b = self.data.items[full_byte_len] & tail_mask;

            while (b != 0) {
                const lsb: u8 = @ctz(b);
                const bit_index = full_byte_len * 8 + lsb;
                out[true_bit_count] = bit_index;
                true_bit_count += 1;
                b &= b - 1;
            }

            return true_bit_count;
        }

        pub fn getSingleTrueBit(self: *const @This()) ?usize {
            var found_index: ?usize = null;

            for (self.data.items, 0..) |byte, i_byte| {
                var b = byte;
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

        pub fn deinit(self: *@This(), allocator: std.mem.Allocator) void {
            self.data.deinit(allocator);
        }

        pub fn get(self: *const @This(), bit_index: usize) !bool {
            if (bit_index >= self.bit_len) {
                return error.OutOfRange;
            }

            const byte_idx = bit_index / 8;
            const offset_in_byte: u3 = @intCast(bit_index % 8);
            const mask = @as(u8, 1) << offset_in_byte;
            return (self.data.items[byte_idx] & mask) == mask;
        }

        /// Grows through bit_index when needed, zeroing intervening bits.
        pub fn set(self: *@This(), allocator: std.mem.Allocator, bit_index: usize, bit: bool) !void {
            if (bit_index >= limit) {
                return error.tooLarge;
            }
            if (bit_index + 1 > self.bit_len) {
                try self.resize(allocator, bit_index + 1);
            }
            self.setAssumeCapacity(bit_index, bit);
        }

        pub fn resize(self: *@This(), allocator: std.mem.Allocator, bit_len: usize) !void {
            if (bit_len > limit) {
                return error.tooLarge;
            }

            const old_byte_len = std.math.divCeil(usize, self.bit_len, 8) catch unreachable;
            const byte_len = std.math.divCeil(usize, bit_len, 8) catch unreachable;
            try self.data.resize(allocator, byte_len);
            // zero out additionally allocated bytes
            if (old_byte_len < byte_len) {
                @memset(self.data.items[old_byte_len..], 0);
            } else {
                // In the case of old_byte_len >= byte_len, we need to manually zero out the
                // trailing bits after the last bit
                const remainder_bits = bit_len % 8;
                if (remainder_bits != 0) {
                    const mask: u8 = (@as(u8, 1) << @intCast(remainder_bits)) - 1;
                    self.data.items[byte_len - 1] &= mask;
                }
            }
            self.bit_len = bit_len;
        }

        /// Requires bit_index below bit_len; does not grow or allocate.
        pub fn setAssumeCapacity(self: *@This(), bit_index: usize, bit: bool) void {
            std.debug.assert(bit_index < self.bit_len);

            const byte_index = bit_index / 8;
            const offset_in_byte: u3 = @intCast(bit_index % 8);
            const mask = @as(u8, 1) << offset_in_byte;
            var byte = self.data.items[byte_index];
            if (bit) {
                // For bit in byte, 1,0 OR 1 = 1
                // byte 100110
                // mask 010000
                // res  110110
                byte |= mask;
                self.data.items[byte_index] = byte;
            } else {
                // For bit in byte, 1,0 OR 1 = 0
                if ((byte & mask) == mask) {
                    // byte 110110
                    // mask 010000
                    // res  100110
                    byte ^= mask;
                    self.data.items[byte_index] = byte;
                } else {
                    // Ok, bit is already 0
                }
            }
        }

        /// Returns values whose corresponding bit is set, coercing each element to T.
        /// Caller owns the returned list.
        pub fn intersectValues(
            self: *const @This(),
            comptime T: type,
            comptime Value: type,
            allocator: std.mem.Allocator,
            values: []const Value,
        ) !std.ArrayList(T) {
            if (values.len != self.bit_len) return error.InvalidSize;

            var indices = try std.ArrayList(T).initCapacity(allocator, self.bit_len);
            const full_byte_len = self.bit_len / 8;
            const remainder_bits = self.bit_len % 8;
            for (0..full_byte_len) |i_byte| {
                var b = self.data.items[i_byte];
                // Kernighan's algorithm to count the set bits instead of going through 0..8 for every byte
                while (b != 0) {
                    const lsb: u8 = @ctz(b); // Get the index of least significant bit
                    const bit_index = i_byte * 8 + lsb;
                    indices.appendAssumeCapacity(values[bit_index]);
                    // The `b - 1` flips the bits starting from `lsb` index
                    // And `&` will reset the last bit at `lsb` index
                    b &= b - 1;
                }
            }
            if (remainder_bits <= 0) return indices;
            const tail_mask: u8 = (@as(u8, 1) << @intCast(remainder_bits)) - 1;
            var b = self.data.items[full_byte_len] & tail_mask;
            // Kernighan's algorithm to count the set bits instead of going through 0..8 for every byte
            while (b != 0) {
                const lsb: u8 = @ctz(b); // Get the index of least significant bit
                const bit_index = full_byte_len * 8 + lsb;
                indices.appendAssumeCapacity(values[bit_index]);
                // The `b - 1` flips the bits starting from `lab` index
                // And `&` will reset the last bit at `lsb` index
                b &= b - 1;
            }

            return indices;
        }
    };
}

test {
    _ = @import("bit_list_test.zig");
}
