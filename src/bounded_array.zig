//! Stack-resident array with a compile-time hard capacity.  No allocator;
//! runtime ops are infallible — over-capacity is a programming error and
//! asserts rather than returning an error.

const std = @import("std");

pub fn BoundedArray(comptime T: type, comptime capacity_: u32) type {
    return struct {
        buffer: [capacity_]T = undefined,
        count: u32 = 0,

        const Self = @This();
        pub const capacity: u32 = capacity_;

        pub fn slice(self: *Self) []T {
            return self.buffer[0..self.count];
        }

        pub fn constSlice(self: *const Self) []const T {
            return self.buffer[0..self.count];
        }

        pub fn full(self: *const Self) bool {
            return self.count == capacity;
        }

        pub fn empty(self: *const Self) bool {
            return self.count == 0;
        }

        pub fn push(self: *Self, item: T) void {
            std.debug.assert(!self.full());
            self.buffer[self.count] = item;
            self.count += 1;
        }

        pub fn pop(self: *Self) ?T {
            if (self.empty()) return null;
            self.count -= 1;
            return self.buffer[self.count];
        }

        pub fn orderedRemove(self: *Self, i: u32) void {
            std.debug.assert(i < self.count);
            var j: u32 = i;
            while (j + 1 < self.count) : (j += 1) {
                self.buffer[j] = self.buffer[j + 1];
            }
            self.count -= 1;
        }

        pub fn clear(self: *Self) void {
            self.count = 0;
        }
    };
}

test {
    _ = @import("bounded_array_test.zig");
}
