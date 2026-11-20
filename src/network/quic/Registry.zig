const std = @import("std");
const binding = @import("binding.zig");
const Connection = @import("Connection.zig");
const index_list = @import("../index_list.zig");
const RouteTable = @import("RouteTable.zig");
const DeadlineHeap = @import("../deadline_heap.zig").DeadlineHeap;
const assert = std.debug.assert;
const metrics = @import("metrics.zig");

const Registry = @This();

slots: []Connection,
routes: RouteTable,
active: []u16,
positions: []u16,
/// One key per live connection: its earliest QUIC timer, handshake limit, keep-alive or
/// deferred close, in monotonic nanoseconds.
timers: DeadlineHeap,
pending: index_list.List = .{},
dirty: index_list.List = .{},
events: index_list.List = .{},
released: index_list.List = .{},
active_len: u16 = 0,
handshaking: u16 = 0,
dialing: u16 = 0,
outbound: u16 = 0,
retired_metrics: metrics.Counters = .{},

pub fn init(allocator: std.mem.Allocator, slots_max: u16, seed: u64) !Registry {
    const slots = try allocator.alloc(Connection, slots_max);
    errdefer allocator.free(slots);
    @memset(slots, .{});

    var routes = try RouteTable.init(
        allocator,
        slots_max,
        seed,
    );
    errdefer routes.deinit(allocator);

    const active = try allocator.alloc(u16, slots_max);
    errdefer allocator.free(active);
    for (active, 0..) |*entry, index| entry.* = @intCast(index);

    var timers = try DeadlineHeap.init(allocator, slots_max);
    errdefer timers.deinit(allocator);

    const positions = try allocator.alloc(u16, slots_max);
    errdefer allocator.free(positions);
    for (positions, 0..) |*entry, index| entry.* = @intCast(index);
    return .{
        .slots = slots,
        .routes = routes,
        .active = active,
        .timers = timers,
        .positions = positions,
    };
}

pub fn deinit(self: *Registry, allocator: std.mem.Allocator) void {
    for (self.slots) |*slot| if (slot.state != .free) {
        slot.release();
    };
    self.timers.deinit(allocator);
    allocator.free(self.active);
    allocator.free(self.positions);
    self.routes.deinit(allocator);
    allocator.free(self.slots);
    self.* = undefined;
}

pub fn activeIndices(self: *const Registry) []const u16 {
    assert(self.active.len == self.slots.len);
    assert(self.active_len <= self.active.len);
    return self.active[0..self.active_len];
}

pub fn claim(self: *Registry) ?u16 {
    assert(self.active.len == self.slots.len);
    assert(self.active_len <= self.active.len);
    var available: ?usize = null;
    for (self.active[self.active_len..], self.active_len..) |candidate, position| {
        if (self.slots[candidate].generation != std.math.maxInt(u32)) {
            available = position;
            break;
        }
    }
    const position = available orelse return null;
    const index = self.active[position];
    const displaced = self.active[self.active_len];
    self.active[position] = displaced;
    self.positions[displaced] = @intCast(position);
    self.active[self.active_len] = index;
    self.positions[index] = self.active_len;
    assert(self.slots[index].state == .free);
    self.active_len += 1;
    assert(self.timers.get(index) == null);
    return index;
}

pub fn unclaim(self: *Registry, index: u16) void {
    assert(index < self.slots.len);
    assert(self.active_len > 0);
    const cursor = self.positions[index];
    assert(cursor < self.active_len);
    assert(self.active[cursor] == index);
    self.active_len -= 1;
    const moved = self.active[self.active_len];
    self.active[cursor] = moved;
    self.positions[moved] = cursor;
    self.active[self.active_len] = index;
    self.positions[index] = self.active_len;
}

pub fn retire(self: *Registry, index: u16) void {
    assert(index < self.slots.len);
    const slot = &self.slots[index];
    assert(slot.state != .free);
    self.removeRoute(index);
    self.unlink(index);
    if (slot.conn) |conn| self.retired_metrics.retire(conn);
    slot.release();
    self.unclaim(index);
    assert(slot.state == .free);
}

/// Removes the slot from every per-turn list and the timer heap.
fn unlink(self: *Registry, index: u16) void {
    assert(index < self.slots.len);
    const slot = &self.slots[index];
    if (slot.pending_link.linked) self.pending.remove(self.slots, "pending_link", index);
    if (slot.dirty_link.linked) self.dirty.remove(self.slots, "dirty_link", index);
    if (slot.event_link.linked) self.events.remove(self.slots, "event_link", index);
    if (slot.release_link.linked) self.released.remove(self.slots, "release_link", index);
    self.timers.clear(index);
}

pub fn findRoute(self: *const Registry, cid: *const binding.Cid) ?u16 {
    const index = self.routes.find(cid) orelse return null;
    assert(index < self.slots.len);
    assert(self.slots[index].state != .free);
    return index;
}

pub fn addRoute(self: *Registry, index: u16) RouteTable.Error!void {
    assert(index < self.slots.len);
    assert(self.slots[index].state != .free);
    try self.routes.insert(&self.slots[index].scid, index);
    assert(self.routes.count <= self.active_len);
}

pub fn removeRoute(self: *Registry, index: u16) void {
    assert(index < self.slots.len);
    assert(self.slots[index].state != .free);
    self.routes.remove(&self.slots[index].scid, index);
    assert(self.routes.count <= self.active_len);
}

test {
    _ = RouteTable;
    _ = @import("registry_test.zig");
}
