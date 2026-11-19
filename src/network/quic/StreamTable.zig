const std = @import("std");
const limits = @import("limits.zig");
const types = @import("../types.zig");

const assert = std.debug.assert;

const half: usize = @divExact(limits.streams_per_connection, 2);

/// One bit per table entry.
pub const Mask = std.meta.Int(.unsigned, limits.streams_per_connection);

comptime {
    assert(limits.streams_per_connection <= std.math.maxInt(u8) + 1);
}

pub const Entry = struct {
    id: u64 = 0,
    reset_code: u64 = 0,
    /// Send capacity at which a writable event is reported; 0 means no write interest.
    write_lowat: u32 = 0,
    /// The owner that consumes readiness and terminal I/O results.
    route: types.Route = .{},
    claimed: bool = false,
    reset: bool = false,
    opened_pending: bool = false,
    closed_pending: bool = false,
    fin_sent: bool = false,
    fin_received: bool = false,
    /// The peer stopped the stream; `reset_code` holds its code until a write reports it.
    stopped: bool = false,
    /// Readiness not yet delivered.
    ready: types.Readiness = .{},
};

comptime {
    assert(@sizeOf(Entry) <= 32);
}

const StreamTable = @This();

entries: [limits.streams_per_connection]Entry = [_]Entry{.{}} ** limits.streams_per_connection,
/// Entries with an undelivered opened, ready or closed event.
pending: Mask = 0,
/// Entries with write interest.
armed: Mask = 0,
/// Entries whose delivered readable edge has not yet been read to Done.
reading: Mask = 0,
next_local_id: u64 = 0,
/// Delivery resumes here so a busy low entry cannot starve a higher one.
event_cursor: u8 = 0,

pub fn init(direction: types.Direction) StreamTable {
    const first: u64 = if (direction == .outbound) 0 else 1;
    assert(first < 4);
    assert(!isPeerInitiated(direction, first));
    return .{ .next_local_id = first };
}

pub fn isPeerInitiated(direction: types.Direction, id: u64) bool {
    const peer_bit: u64 = if (direction == .outbound) 1 else 0;
    return (id & 0x3) == peer_bit;
}

pub fn find(self: *const StreamTable, id: u64) ?u8 {
    for (&self.entries, 0..) |*entry, index| {
        if (!entry.claimed) continue;
        if (entry.id == id) return @intCast(index);
    }
    return null;
}

pub fn matches(self: *const StreamTable, index: u8, id: u64) bool {
    if (index >= limits.streams_per_connection) return false;
    const entry = &self.entries[index];
    if (!entry.claimed) return false;
    if (entry.closed_pending) return false;
    return entry.id == id;
}

pub fn freeLocal(self: *const StreamTable) ?u8 {
    return self.freeIn(0);
}

pub fn claimLocal(self: *StreamTable, index: u8, id: u64) void {
    assert(id == self.next_local_id);
    assert(self.find(id) == null);
    assert(index < half);
    assert(!self.entries[index].claimed);
    assert(self.pending & bit(index) == 0 and self.armed & bit(index) == 0 and self.reading & bit(index) == 0);
    self.entries[index] = .{ .id = id, .claimed = true };
    self.next_local_id = id + 4;
}

pub fn claimPeer(self: *StreamTable, id: u64) ?u8 {
    assert(self.find(id) == null);
    const index = self.freeIn(half) orelse return null;
    assert(index >= half);
    assert(self.pending & bit(index) == 0 and self.armed & bit(index) == 0);
    self.entries[index] = .{ .id = id, .claimed = true, .opened_pending = true };
    self.pending |= bit(index);
    return index;
}

pub fn bind(self: *StreamTable, index: u8, route: types.Route) void {
    assert(self.entries[index].claimed and !self.entries[index].closed_pending);
    if (route.owner != .none) assert(!self.entries[index].opened_pending);
    self.entries[index].route = route;
}

pub fn stop(self: *StreamTable, index: u8, code: u64) void {
    assert(self.entries[index].claimed and !self.entries[index].closed_pending);
    self.entries[index].stopped = true;
    self.entries[index].reset_code = code;
    self.markReady(index, .{ .writable = true });
}

pub fn shutdownRead(self: *StreamTable, index: u8) void {
    self.markFinReceived(index);
    self.entries[index].ready.readable = false;
    self.readDone(index);
    self.settle(index);
}

pub fn shutdownWrite(self: *StreamTable, index: u8) void {
    self.markFinSent(index);
    self.entries[index].ready.writable = false;
    self.disarm(index);
    self.settle(index);
}

pub fn markFinSent(self: *StreamTable, index: u8) void {
    assert(index < limits.streams_per_connection);
    assert(self.entries[index].claimed);
    assert(!self.entries[index].closed_pending);
    self.entries[index].fin_sent = true;
}

pub fn markFinReceived(self: *StreamTable, index: u8) void {
    assert(index < limits.streams_per_connection);
    assert(self.entries[index].claimed);
    assert(!self.entries[index].closed_pending);
    self.entries[index].fin_received = true;
}

/// Records undelivered readiness. A closing entry reports only its close.
pub fn markReady(self: *StreamTable, index: u8, ready: types.Readiness) void {
    assert(index < limits.streams_per_connection);
    const entry = &self.entries[index];
    assert(entry.claimed);
    if (entry.closed_pending) return;
    entry.ready.readable = entry.ready.readable or ready.readable;
    entry.ready.writable = entry.ready.writable or ready.writable;
    if (ready.writable) self.disarm(index);
    self.pending |= bit(index);
}

pub fn arm(self: *StreamTable, index: u8, lowat: u32) void {
    assert(index < limits.streams_per_connection);
    assert(lowat > 0);
    assert(self.entries[index].claimed and !self.entries[index].closed_pending);
    // A replacement interest must earn its own edge at the new watermark.
    self.entries[index].ready.writable = false;
    self.settle(index);
    self.entries[index].write_lowat = lowat;
    self.armed |= bit(index);
}

pub fn disarm(self: *StreamTable, index: u8) void {
    assert(index < limits.streams_per_connection);
    self.entries[index].write_lowat = 0;
    self.armed &= ~bit(index);
}

pub fn clear(self: *StreamTable, index: u8, reset_code: ?u64) void {
    assert(index < limits.streams_per_connection);
    const entry = &self.entries[index];
    assert(entry.claimed);
    assert(entry.route.owner == .none);
    if (entry.closed_pending) return;
    entry.closed_pending = true;
    entry.ready = .{};
    self.reading &= ~bit(index);
    self.disarm(index);
    if (reset_code) |code| {
        entry.reset = true;
        entry.reset_code = code;
    }
    self.pending |= bit(index);
}

pub fn takeOpened(self: *StreamTable, index: u8) void {
    assert(index < limits.streams_per_connection);
    const entry = &self.entries[index];
    assert(entry.opened_pending);
    assert(self.pending & bit(index) != 0);
    entry.opened_pending = false;
    // Taking the stream makes the new owner ready for read and write.
    entry.ready = .{};
    if (!entry.closed_pending) self.reading |= bit(index);
    self.settle(index);
}

pub fn takeReady(self: *StreamTable, index: u8) types.Readiness {
    assert(index < limits.streams_per_connection);
    const entry = &self.entries[index];
    const ready = entry.ready;
    entry.ready = .{};
    if (ready.readable) self.reading |= bit(index);
    self.settle(index);
    return ready;
}

pub fn takeClosed(self: *StreamTable, index: u8) ?struct { id: u64, reset_code: ?u64 } {
    assert(index < limits.streams_per_connection);
    const entry = &self.entries[index];
    if (!entry.closed_pending) return null;
    assert(!entry.opened_pending);
    assert(self.pending & bit(index) != 0);
    assert(self.armed & bit(index) == 0);
    const id = entry.id;
    const reset_code: ?u64 = if (entry.reset) entry.reset_code else null;
    entry.* = .{};
    self.pending &= ~bit(index);
    assert(self.reading & bit(index) == 0);
    return .{ .id = id, .reset_code = reset_code };
}

pub fn discard(self: *StreamTable, index: u8) void {
    assert(index < limits.streams_per_connection);
    const entry = &self.entries[index];
    assert(entry.claimed);
    entry.* = .{};
    self.pending &= ~bit(index);
    self.armed &= ~bit(index);
    self.reading &= ~bit(index);
}

pub fn readOpen(self: *const StreamTable, index: u8) bool {
    return self.reading & bit(index) != 0;
}

/// A read reached Done, a FIN or a reset: the delivered readable edge is consumed.
pub fn readDone(self: *StreamTable, index: u8) void {
    self.reading &= ~bit(index);
}

pub fn hasPending(self: *const StreamTable) bool {
    return self.pending != 0;
}

/// The next entry with an undelivered event, starting at the delivery cursor.
pub fn nextPending(self: *const StreamTable) ?u8 {
    if (self.pending == 0) return null;
    const after = self.pending & (~@as(Mask, 0) << @intCast(self.event_cursor));
    return @intCast(@ctz(if (after != 0) after else self.pending));
}

/// Moves the delivery cursor past an entry whose events were delivered.
pub fn advanceCursor(self: *StreamTable, index: u8) void {
    assert(index < limits.streams_per_connection);
    self.event_cursor = @intCast((@as(u16, index) + 1) % limits.streams_per_connection);
}

fn settle(self: *StreamTable, index: u8) void {
    const entry = &self.entries[index];
    const ready: u2 = @bitCast(entry.ready);
    if (entry.opened_pending or entry.closed_pending or ready != 0) {
        self.pending |= bit(index);
    } else self.pending &= ~bit(index);
}

fn freeIn(self: *const StreamTable, start: usize) ?u8 {
    assert(start == 0 or start == half);
    for (self.entries[start .. start + half], start..) |*entry, index| {
        if (!entry.claimed) return @intCast(index);
    }
    return null;
}

pub fn bit(index: u8) Mask {
    assert(index < limits.streams_per_connection);
    return @as(Mask, 1) << @intCast(index);
}

test {
    _ = @import("stream_table_test.zig");
}
