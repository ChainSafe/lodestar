const std = @import("std");
pub const none = std.math.maxInt(u32);

pub fn capacity(rows: usize) usize {
    return std.math.ceilPowerOfTwo(usize, @max(2, rows * 2)) catch unreachable;
}

/// Keys live in stable rows. Remove membership before overwriting the key.
pub fn Index(comptime Key: type) type {
    return struct {
        slots: []u32,
        seed: u64 = 0,
        const Self = @This();

        pub fn init(allocator: std.mem.Allocator, rows: usize) !Self {
            const slots = try allocator.alloc(u32, capacity(rows));
            @memset(slots, none);
            return .{ .slots = slots };
        }

        pub fn deinit(self: *Self, allocator: std.mem.Allocator) void {
            allocator.free(self.slots);
        }

        fn position(self: *const Self, key: *const Key) usize {
            var hasher = std.hash.Wyhash.init(self.seed);
            std.hash.autoHash(&hasher, key.*);
            return @as(usize, @truncate(hasher.final())) & (self.slots.len - 1);
        }

        pub fn find(self: *const Self, rows: anytype, key: *const Key) ?u32 {
            var pos = self.position(key);
            for (0..self.slots.len) |_| {
                const index = self.slots[pos];
                if (index == none) return null;
                if (std.meta.eql(rows[index].key, key.*)) return index;
                pos = (pos + 1) & (self.slots.len - 1);
            }
            unreachable;
        }

        pub fn insert(self: *Self, rows: anytype, index: u32) void {
            std.debug.assert(self.find(rows, &rows[index].key) == null);
            var pos = self.position(&rows[index].key);
            for (0..self.slots.len) |_| {
                if (self.slots[pos] == none) {
                    self.slots[pos] = index;
                    return;
                }
                pos = (pos + 1) & (self.slots.len - 1);
            }
            unreachable;
        }

        pub fn remove(self: *Self, rows: anytype, key: *const Key) void {
            const mask = self.slots.len - 1;
            var pos = self.position(key);
            for (0..self.slots.len) |_| {
                const index = self.slots[pos];
                if (index == none) return;
                if (std.meta.eql(rows[index].key, key.*)) break;
                pos = (pos + 1) & mask;
            } else unreachable;
            var hole = pos;
            pos = (pos + 1) & mask;
            for (0..self.slots.len) |_| {
                const index = self.slots[pos];
                if (index == none) {
                    self.slots[hole] = none;
                    return;
                }
                const home = self.position(&rows[index].key);
                if ((pos -% home) & mask >= (pos -% hole) & mask) {
                    self.slots[hole] = index;
                    hole = pos;
                }
                pos = (pos + 1) & mask;
            }
            unreachable;
        }
    };
}

test {
    _ = @import("key_index_test.zig");
}
