const std = @import("std");
const leveldb = @import("root.zig");
const raw = @import("raw.zig");
const ranges = @import("range.zig");
const owned = @import("owned.zig");
const Cursor = @This();
const Database = leveldb.Database;
const Diagnostics = leveldb.Diagnostics;
const Entry = leveldb.Entry;
const Page = leveldb.Page;

db: *Database,
iterator: raw.Iterator,
bounds: ranges.Range,
keys: bool,
values: bool,
remaining: u32,
closed: bool = false,
positioned: bool = true,

/// The iterator owns its consistent view, including across seeks. The database must outlive this cursor.
pub fn init(database: *Database, range: leveldb.RangeOptions, diagnostics: ?*Diagnostics) !Cursor {
    const db = if (database.inner) |*handle| handle else return error.DatabaseClosed;
    const previous = database.cursors.fetchAdd(1, .monotonic);
    if (previous >= leveldb.max_cursors) {
        _ = database.cursors.fetchSub(1, .monotonic);
        return error.CursorCapacity;
    }
    errdefer _ = database.cursors.fetchSub(1, .monotonic);
    var bounds = try ranges.Range.init(database.allocator, &range, leveldb.max_key_bytes);
    errdefer bounds.deinit(database.allocator);
    var options = try raw.ReadOptions.create();
    defer options.destroy();
    options.setFillCache(range.fill_cache);
    options.setVerifyChecksums(true);
    var iterator = try db.createIterator(&options);
    errdefer iterator.destroy();

    if (range.limit != 0) try bounds.seek(&iterator, diagnostics);
    return .{
        .db = database,
        .iterator = iterator,
        .bounds = bounds,
        .remaining = range.limit,
        .keys = range.keys,
        .values = range.values,
    };
}

pub fn close(self: *Cursor) void {
    if (self.closed) return;
    self.closed = true;
    self.iterator.destroy();
    self.bounds.deinit(self.db.allocator);
    const previous = self.db.cursors.fetchSub(1, .monotonic);
    std.debug.assert(previous > 0);
}

/// Repositions within the original snapshot and bounds without resetting the consumed row limit.
pub fn seek(self: *Cursor, target: []const u8, diagnostics: ?*Diagnostics) !void {
    if (self.closed) return error.CursorClosed;
    errdefer self.close();
    try checkKey(target);
    self.positioned = try self.bounds.seekTarget(&self.iterator, target, diagnostics);
}

/// Caller frees each selected slice in entries[0..page.count] with Database.allocator.
/// Entries must contain no live allocations. Errors free partial entries and close the cursor.
/// The soft watermark includes the crossing row. Exhaustion preserves the view for seek until explicit close.
pub fn readOwned(
    self: *Cursor,
    entries: []Entry,
    value_limit: usize,
    total_limit: usize,
    high_water_mark_bytes: u32,
    diagnostics: ?*Diagnostics,
) !Page {
    if (entries.len > leveldb.max_bulk_entries) {
        self.close();
        return error.InvalidReadLimit;
    }
    @memset(entries, .{ .key = "", .value = "" });
    if (self.closed) return error.CursorClosed;
    errdefer self.close();
    if (entries.len == 0 or value_limit > leveldb.max_owned_value_bytes or
        total_limit > leveldb.max_owned_batch_bytes) return error.InvalidReadLimit;
    var page: Page = .{ .count = 0, .bytes = 0, .done = false };
    errdefer {
        for (entries[0..page.count]) |*entry| owned.freeEntry(self.db.allocator, entry);
        @memset(entries[0..page.count], .{ .key = "", .value = "" });
    }
    for (entries) |*entry| {
        if (!try self.hasNext(diagnostics)) {
            page.done = true;
            break;
        }
        try checkKey(self.iterator.key());
        const key = if (self.keys) self.iterator.key() else "";
        const value = if (self.values) self.iterator.value() else "";
        if (value.len > value_limit) return error.ValueTooLarge;
        const bytes = std.math.add(usize, key.len, value.len) catch
            return error.BatchTooLarge;
        if (bytes > total_limit - page.bytes) {
            if (page.count == 0) return error.BatchTooLarge;
            break;
        }
        entry.* = try owned.copyEntry(self.db.allocator, key, value);
        page.count += 1;
        page.bytes += bytes;
        self.remaining -= 1;
        if (self.remaining > 0) try self.bounds.advance(&self.iterator, diagnostics);
        if (page.bytes > high_water_mark_bytes) break;
    }
    if (!page.done) page.done = !try self.hasNext(diagnostics);
    return page;
}

fn hasNext(self: *Cursor, diagnostics: ?*Diagnostics) !bool {
    try self.iterator.getError(diagnostics);
    if (!self.positioned or self.remaining == 0 or !self.iterator.valid()) return false;
    return self.bounds.contains(self.iterator.key());
}

fn checkKey(key: []const u8) !void {
    if (key.len > leveldb.max_key_bytes) return error.KeyTooLarge;
}

test {
    _ = @import("cursor_test.zig");
}
