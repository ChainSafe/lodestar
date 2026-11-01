const std = @import("std");
const assert = std.debug.assert;
pub const none = std.math.maxInt(u32);
pub const Link = struct { previous: u32 = none, next: u32 = none, linked: bool = false };

/// Links belong to stable, startup-allocated rows. Remove a row before reusing it.
pub const List = struct {
    head: u32 = none,
    tail: u32 = none,
    len: usize = 0,

    pub fn append(self: *List, rows: anytype, comptime field: []const u8, index: u32) void {
        const link = &@field(rows[index], field);
        assert(!link.linked);
        link.* = .{ .previous = self.tail, .linked = true };
        if (self.tail != none) @field(rows[self.tail], field).next = index else self.head = index;
        self.tail = index;
        self.len += 1;
    }

    pub fn prepend(self: *List, rows: anytype, comptime field: []const u8, index: u32) void {
        const link = &@field(rows[index], field);
        assert(!link.linked);
        link.* = .{ .next = self.head, .linked = true };
        if (self.head != none) @field(rows[self.head], field).previous = index else self.tail = index;
        self.head = index;
        self.len += 1;
    }

    pub fn remove(self: *List, rows: anytype, comptime field: []const u8, index: u32) void {
        const link = &@field(rows[index], field);
        assert(link.linked and self.len > 0);
        if (link.previous != none) @field(rows[link.previous], field).next = link.next else {
            assert(self.head == index);
            self.head = link.next;
        }
        if (link.next != none) @field(rows[link.next], field).previous = link.previous else {
            assert(self.tail == index);
            self.tail = link.previous;
        }
        self.len -= 1;
        link.* = .{};
    }

    /// Appends when the row is not linked. Returns whether it appended. Ready-list marks are idempotent.
    pub fn insert(self: *List, rows: anytype, comptime field: []const u8, index: u32) bool {
        if (@field(rows[index], field).linked) return false;
        self.append(rows, field, index);
        return true;
    }

    pub fn pop(self: *List, rows: anytype, comptime field: []const u8) ?u32 {
        if (self.head == none) return null;
        const index = self.head;
        self.remove(rows, field, index);
        return index;
    }
};

test {
    _ = @import("index_list_test.zig");
}
