const std = @import("std");
const lists = @import("../index_list.zig");
const topic = @import("../gossipsub/topic.zig");
const keys = @import("key_index.zig");
const none = lists.none;
const assert = std.debug.assert;
pub const minimum = 32;
pub const delay_ms = 50;
const Key = struct { attestation_data: [128]u8, fork_digest: topic.ForkDigest };
pub const Row = struct {
    key: Key = undefined,
    members: lists.List = .{},
    link: lists.Link = .{},
    due: u64 = 0,
    timer: u32 = none,
    ready: bool = false,
};
pub const Groups = struct {
    rows: []Row,
    index: keys.Index(Key),
    timers: []u32,
    timer_count: usize = 0,
    free: lists.List = .{},
    ready: lists.List = .{},

    pub fn init(allocator: std.mem.Allocator, capacity: usize) !Groups {
        const rows = try allocator.alloc(Row, capacity);
        errdefer allocator.free(rows);
        @memset(rows, .{});
        var index = try keys.Index(Key).init(allocator, capacity);
        errdefer index.deinit(allocator);
        const timers = try allocator.alloc(u32, capacity);
        var result: Groups = .{ .rows = rows, .index = index, .timers = timers };
        for (0..capacity) |i| result.free.append(rows, "link", @intCast(i));
        return result;
    }
    pub fn deinit(self: *Groups, allocator: std.mem.Allocator) void {
        allocator.free(self.rows);
        self.index.deinit(allocator);
        allocator.free(self.timers);
    }
    pub fn backingBytes(capacity: usize) usize {
        return capacity * (@sizeOf(Row) + @sizeOf(u32)) + keys.capacity(capacity) * @sizeOf(u32);
    }
    pub fn join(self: *Groups, cells: anytype, cell_index: u32, now: u64) void {
        const cell = &cells[cell_index];
        const key: Key = .{ .attestation_data = cell.metadata.group.?, .fork_digest = cell.fork_digest };
        const index = self.index.find(self.rows, &key) orelse blk: {
            const index = self.free.pop(self.rows, "link").?;
            self.rows[index] = .{ .key = key, .due = cell.admitted_ms +| delay_ms };
            self.index.insert(self.rows, index);
            break :blk index;
        };
        const group = &self.rows[index];
        cell.group_index = index;
        group.members.append(cells, "group_link", cell_index);
        group.due = @min(group.due, cell.admitted_ms +| delay_ms);
        self.refresh(index, now);
    }
    pub fn leave(self: *Groups, cells: anytype, cell_index: u32, now: u64) void {
        const cell = &cells[cell_index];
        const index = cell.group_index;
        if (index == none) return;
        const group = &self.rows[index];
        group.members.remove(cells, "group_link", cell_index);
        cell.group_index = none;
        if (group.members.len > 0) return self.refresh(index, now);
        self.unschedule(index);
        self.index.remove(self.rows, &group.key);
        self.free.append(self.rows, "link", index);
    }
    fn refresh(self: *Groups, index: u32, now: u64) void {
        const group = &self.rows[index];
        const ready = group.members.len >= minimum or now >= group.due;
        if (ready) {
            if (group.timer != none) self.removeTimer(index);
            if (!group.ready) self.ready.append(self.rows, "link", index);
            group.ready = true;
        } else {
            if (group.ready) self.ready.remove(self.rows, "link", index);
            group.ready = false;
            if (group.timer == none) {
                assert(self.timer_count < self.timers.len);
                group.timer = @intCast(self.timer_count);
                self.timers[self.timer_count] = index;
                self.timer_count += 1;
            }
            self.up(group.timer);
        }
    }
    fn unschedule(self: *Groups, index: u32) void {
        if (self.rows[index].ready) self.ready.remove(self.rows, "link", index);
        if (self.rows[index].timer != none) self.removeTimer(index);
        self.rows[index].ready = false;
    }
    pub fn advance(self: *Groups, now: u64, budget: usize) void {
        for (0..budget) |_| {
            const due = self.deadline() orelse break;
            if (due > now) break;
            self.refresh(self.timers[0], now);
        }
    }
    pub fn deadline(self: *const Groups) ?u64 {
        return if (self.timer_count == 0) null else self.rows[self.timers[0]].due;
    }
    fn removeTimer(self: *Groups, index: u32) void {
        const slot = self.rows[index].timer;
        self.rows[index].timer = none;
        self.timer_count -= 1;
        if (slot == self.timer_count) return;
        const replacement = self.timers[self.timer_count];
        self.timers[slot] = replacement;
        self.rows[replacement].timer = slot;
        self.up(slot);
        self.down(self.rows[replacement].timer);
    }
    fn swap(self: *Groups, a: usize, b: usize) void {
        std.mem.swap(u32, &self.timers[a], &self.timers[b]);
        self.rows[self.timers[a]].timer = @intCast(a);
        self.rows[self.timers[b]].timer = @intCast(b);
    }
    fn before(self: *const Groups, a: usize, b: usize) bool {
        return self.rows[self.timers[a]].due < self.rows[self.timers[b]].due;
    }
    fn up(self: *Groups, start: usize) void {
        var at = start;
        for (0..32) |_| {
            if (at == 0) return;
            const parent = (at - 1) / 2;
            if (!self.before(at, parent)) return;
            self.swap(at, parent);
            at = parent;
        }
        unreachable;
    }
    fn down(self: *Groups, start: usize) void {
        var at = start;
        for (0..32) |_| {
            const left = at * 2 + 1;
            if (left >= self.timer_count) return;
            const right = left + 1;
            const child = if (right < self.timer_count and self.before(right, left)) right else left;
            if (!self.before(child, at)) return;
            self.swap(at, child);
            at = child;
        }
        unreachable;
    }
};
