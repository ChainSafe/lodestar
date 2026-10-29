//! A zero-allocation, one-pass iterator for serialized elements in SSZ lists, vectors, and
//! progressive lists with variable-size elements.
//!
//! SSZ encodes these collections as a table of 4-byte little-endian offsets followed by the
//! element data. For example:
//!
//! ```text
//!     [offset 1] [offset 2] [data 1 ..........] [data 2 ..]
//! 0x  08000000   0e000000   010002000300        01000200
//! ```
//!
//! The first offset is 8, so the element data starts at byte 8 and the offset table is 8 bytes
//! long. Each offset occupies 4 bytes, so the table contains `8 / 4 = 2` offsets. The second offset
//! is 14, so the first element occupies bytes 8 through 13 and the second element starts at byte 14.
//!
//! # Safety
//!
//! Initialization validates the first offset and collection bounds. Iteration validates each
//! subsequent offset before returning the preceding element:
//!
//! - Returns `error.offsetOutOfRange` if a vector input is empty, the input does not contain a
//!   complete first offset, or an offset points past the end of the input.
//! - Returns `error.zeroOffset` if the first offset is zero.
//! - Returns `error.offsetNotDivisibleBy4` if the first offset is not divisible by the 4-byte offset
//!   size.
//! - Returns `error.invalidOffsetCount` if the offset count does not equal the vector length or
//!   exceeds the list limit.
//! - Returns `error.offsetNotIncreasing` if an offset is less than the previous offset.
//!
//! Equal offsets encode empty elements. For example:
//!
//! ```text
//!     [offset 1] [offset 2] [data 2 ..]
//! 0x  08000000   08000000   01000200
//! ```
//!
//! Both elements start at byte 8, so the first element is the empty slice `data[8..8]`. The second
//! element contains the remaining bytes.
//!
//! The iterator reads each offset once and yields borrowed element slices without allocation.

const std = @import("std");
const isFixedType = @import("type_kind.zig").isFixedType;

/// Returns an iterator over serialized elements of a variable-element SSZ list, vector, or progressive list.
///
/// Pre-condition:
/// `ST` must describe an SSZ list, vector, or progressive list with a variable-size element type.
///
/// `init` validates the first offset and collection bounds. `next` validates each subsequent
/// offset before yielding an element.
///
/// Returned element slices reference the input data, so the caller must
/// keep the data alive and unchanged while the iterator is in use.
pub fn VariableElementIterator(comptime ST: type) type {
    comptime {
        if (ST.kind != .vector and
            ST.kind != .list and
            ST.kind != .progressive_list)
        {
            @compileError("ST must be a vector, list, or progressive list");
        }
        if (isFixedType(ST.Element)) {
            @compileError("ST.Element must not be a fixed type");
        }
    }

    return struct {
        data: []const u8,
        /// Total number of elements.
        len: usize,
        /// Number of elements already returned by `next()`.
        index: usize,
        start: usize,

        const Self = @This();

        /// Initializes an iterator and validates the first SSZ offset and collection bounds.
        ///
        /// Later offsets are validated by `next`.
        pub fn init(data: []const u8) !Self {
            if (data.len == 0) {
                if (comptime ST.kind == .vector) return error.offsetOutOfRange;
                return .{
                    .data = data,
                    .len = 0,
                    .index = 0,
                    .start = 0,
                };
            }
            if (data.len < 4) return error.offsetOutOfRange;

            const first_offset = readOffset(data, 0);
            if (first_offset == 0) return error.zeroOffset;
            if (first_offset % 4 != 0) return error.offsetNotDivisibleBy4;

            const len = first_offset / 4;
            if (comptime ST.kind == .vector) {
                if (len != ST.length) return error.invalidOffsetCount;
            }
            if (comptime ST.kind == .list or ST.kind == .progressive_list) {
                if (len > ST.limit) return error.invalidOffsetCount;
            }
            if (first_offset > data.len) return error.offsetOutOfRange;

            return .{
                .data = data,
                .len = len,
                .index = 0,
                .start = first_offset,
            };
        }

        /// Returns the next serialized element, or `null` after the last element.
        ///
        /// Returns an error if the next offset is out of range or less than the previous offset.
        pub fn next(self: *Self) !?[]const u8 {
            if (self.index == self.len) return null;

            const next_index = self.index + 1;
            const end = if (next_index == self.len)
                self.data.len
            else
                readOffset(self.data, next_index);

            if (end > self.data.len) return error.offsetOutOfRange;
            if (end < self.start) return error.offsetNotIncreasing;

            const element = self.data[self.start..end];
            self.start = end;
            self.index = next_index;
            return element;
        }

        fn readOffset(data: []const u8, index: usize) usize {
            return std.mem.readInt(u32, data[index * 4 ..][0..4], .little);
        }
    };
}

test {
    _ = @import("variable_element_iterator_test.zig");
}
