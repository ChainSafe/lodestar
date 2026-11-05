const std = @import("std");
const lists = @import("../index_list.zig");
const keys = @import("key_index.zig");
const none = lists.none;
pub const Row = struct {
    key: [32]u8 = undefined,
    members: lists.List = .{},
    link: lists.Link = .{},
    promoting: bool = false,
};
pub const Dependencies = struct {
    rows: []Row,
    index: keys.Index([32]u8),
    free: lists.List = .{},
    promoting: lists.List = .{},
    notification: u64 = 0,
    pub fn init(allocator: std.mem.Allocator, capacity: usize) !Dependencies {
        const rows = try allocator.alloc(Row, capacity);
        errdefer allocator.free(rows);
        @memset(rows, .{});
        const index = try keys.Index([32]u8).init(allocator, capacity);
        var result: Dependencies = .{ .rows = rows, .index = index };
        for (0..capacity) |i| result.free.append(rows, "link", @intCast(i));
        return result;
    }
    pub fn deinit(self: *Dependencies, allocator: std.mem.Allocator) void {
        allocator.free(self.rows);
        self.index.deinit(allocator);
    }
    pub fn backingBytes(capacity: usize) usize {
        return capacity * @sizeOf(Row) + keys.capacity(capacity) * @sizeOf(u32);
    }
    pub fn join(self: *Dependencies, cells: anytype, cell_index: u32) void {
        const cell = &cells[cell_index];
        const root = &cell.metadata.root.?;
        const index = self.index.find(self.rows, root) orelse blk: {
            const index = self.free.pop(self.rows, "link").?;
            self.rows[index] = .{ .key = root.* };
            self.index.insert(self.rows, index);
            break :blk index;
        };
        cell.root_index = index;
        self.rows[index].members.append(cells, "root_link", cell_index);
    }
    pub fn leave(self: *Dependencies, cells: anytype, cell_index: u32) void {
        const cell = &cells[cell_index];
        const index = cell.root_index;
        if (index == none) return;
        const root = &self.rows[index];
        root.members.remove(cells, "root_link", cell_index);
        cell.root_index = none;
        if (root.members.len > 0) return;
        if (root.promoting) self.promoting.remove(self.rows, "link", index);
        self.index.remove(self.rows, &root.key);
        self.free.append(self.rows, "link", index);
    }
    pub fn notify(self: *Dependencies, root: *const [32]u8) void {
        // A concurrent negative check retries after any import. No chain-availability cache is kept.
        self.notification +|= 1;
        const index = self.index.find(self.rows, root) orelse return;
        if (self.rows[index].promoting) return;
        self.rows[index].promoting = true;
        self.promoting.append(self.rows, "link", index);
    }
    pub fn next(self: *const Dependencies) ?u32 {
        return if (self.promoting.head == none) null else self.rows[self.promoting.head].members.head;
    }
};
