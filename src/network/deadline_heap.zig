const std = @import("std");
const assert = std.debug.assert;

/// Indexed binary min-heap over stable row indices. Capacity is fixed at init and nothing
/// allocates afterwards. The owner chooses the unit (ns in the engine, ms elsewhere).
pub const DeadlineHeap = struct {
    pub const none: u32 = std.math.maxInt(u32);
    pub const Entry = struct { deadline: u64, row: u32 };

    /// Heap order; the first `len` entries are used.
    entries: []Entry,
    /// Row to heap position, or none.
    positions: []u32,
    len: u32 = 0,

    pub fn init(allocator: std.mem.Allocator, rows: u32) std.mem.Allocator.Error!DeadlineHeap {
        assert(rows > 0 and rows < none);
        const entries = try allocator.alloc(Entry, rows);
        errdefer allocator.free(entries);
        const positions = try allocator.alloc(u32, rows);
        @memset(positions, none);
        return .{ .entries = entries, .positions = positions };
    }

    pub fn deinit(self: *DeadlineHeap, allocator: std.mem.Allocator) void {
        allocator.free(self.positions);
        allocator.free(self.entries);
        self.* = undefined;
    }

    /// Inserts the row or moves its key. O(log n).
    pub fn set(self: *DeadlineHeap, row: u32, deadline: u64) void {
        assert(row < self.positions.len);
        const position = self.positions[row];
        if (position == none) {
            assert(self.len < self.entries.len);
            const at = self.len;
            self.len += 1;
            self.place(at, .{ .deadline = deadline, .row = row });
            self.siftUp(at);
            return;
        }
        assert(position < self.len and self.entries[position].row == row);
        const previous = self.entries[position].deadline;
        self.entries[position].deadline = deadline;
        if (deadline < previous) self.siftUp(position) else self.siftDown(position);
    }

    /// Removes the row when present. O(log n).
    pub fn clear(self: *DeadlineHeap, row: u32) void {
        assert(row < self.positions.len);
        const position = self.positions[row];
        if (position == none) return;
        assert(position < self.len and self.entries[position].row == row);
        self.removeAt(position);
    }

    pub fn get(self: *const DeadlineHeap, row: u32) ?u64 {
        assert(row < self.positions.len);
        const position = self.positions[row];
        if (position == none) return null;
        return self.entries[position].deadline;
    }

    /// Earliest key. O(1).
    pub fn peek(self: *const DeadlineHeap) ?Entry {
        if (self.len == 0) return null;
        return self.entries[0];
    }

    /// Removes and returns the earliest row whose key is <= now.
    pub fn popDue(self: *DeadlineHeap, now: u64) ?u32 {
        if (self.len == 0 or self.entries[0].deadline > now) return null;
        const row = self.entries[0].row;
        self.removeAt(0);
        return row;
    }

    fn removeAt(self: *DeadlineHeap, position: u32) void {
        assert(position < self.len);
        const row = self.entries[position].row;
        self.positions[row] = none;
        self.len -= 1;
        if (position == self.len) return;
        const moved = self.entries[self.len];
        self.place(position, moved);
        if (position > 0 and moved.deadline < self.entries[(position - 1) / 2].deadline) {
            self.siftUp(position);
        } else self.siftDown(position);
    }

    fn place(self: *DeadlineHeap, position: u32, entry: Entry) void {
        self.entries[position] = entry;
        self.positions[entry.row] = position;
    }

    fn siftUp(self: *DeadlineHeap, start: u32) void {
        var position = start;
        const entry = self.entries[position];
        // Each iteration halves the position, so the loop runs at most log2(len) times.
        while (position > 0) {
            const parent = (position - 1) / 2;
            if (self.entries[parent].deadline <= entry.deadline) break;
            self.place(position, self.entries[parent]);
            position = parent;
        }
        self.place(position, entry);
    }

    fn siftDown(self: *DeadlineHeap, start: u32) void {
        var position = start;
        const entry = self.entries[position];
        // Each iteration doubles the position, so the loop runs at most log2(len) times.
        while (true) {
            const left = 2 * @as(u64, position) + 1;
            if (left >= self.len) break;
            var child: u32 = @intCast(left);
            if (child + 1 < self.len and self.entries[child + 1].deadline < self.entries[child].deadline) child += 1;
            if (entry.deadline <= self.entries[child].deadline) break;
            self.place(position, self.entries[child]);
            position = child;
        }
        self.place(position, entry);
    }
};

test {
    _ = @import("deadline_heap_test.zig");
}
