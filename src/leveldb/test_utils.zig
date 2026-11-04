const std = @import("std");
const leveldb = @import("root.zig");
const testing = std.testing;
const allocator = testing.allocator;

pub const Fixture = struct {
    tmp: std.testing.TmpDir,
    path: [:0]u8,
    db: leveldb.Database,
    closed: bool = false,

    pub fn init(self: *Fixture, db_allocator: std.mem.Allocator) !void {
        self.tmp = std.testing.tmpDir(.{});
        errdefer self.tmp.cleanup();
        const directory = try self.tmp.dir.realPathFileAlloc(std.testing.io, ".", allocator);
        defer allocator.free(directory);
        self.path = try std.fmt.allocPrintSentinel(allocator, "{s}/database", .{directory}, 0);
        errdefer allocator.free(self.path);
        self.db = try leveldb.Database.open(db_allocator, self.path, .{}, null);
        self.closed = false;
    }

    pub fn put(self: *Fixture, key: []const u8, value: []const u8, sync: bool) !void {
        try self.write(&.{.{ .key = key, .value = value }}, sync);
    }

    pub fn delete(self: *Fixture, key: []const u8) !void {
        try self.write(&.{.{ .key = key, .value = null }}, false);
    }

    pub fn write(self: *Fixture, operations: []const leveldb.Operation, sync: bool) !void {
        try self.db.writeWithLimits(operations, sync, .{
            .max_value_bytes = leveldb.max_owned_value_bytes,
            .max_total_bytes = leveldb.max_owned_batch_bytes,
            .max_entries = leveldb.max_bulk_entries,
        }, null);
    }

    pub fn close(self: *Fixture) !void {
        try self.db.close();
        self.closed = true;
    }

    pub fn reopen(self: *Fixture) !void {
        try self.close();
        self.db = try leveldb.Database.open(self.db.allocator, self.path, .{ .create_if_missing = false }, null);
        self.closed = false;
    }

    pub fn deinit(self: *Fixture) void {
        if (!self.closed) self.db.close() catch unreachable;
        allocator.free(self.path);
        self.tmp.cleanup();
    }
};

pub fn freeEntries(db_allocator: std.mem.Allocator, entries: []const leveldb.Entry) void {
    for (entries) |entry| {
        db_allocator.free(entry.key);
        db_allocator.free(entry.value);
    }
}

pub fn freeValues(db_allocator: std.mem.Allocator, values: []const ?[]const u8) void {
    for (values) |value| if (value) |bytes| db_allocator.free(bytes);
}

pub fn expectValue(db: *leveldb.Database, key: []const u8, expected: ?[]const u8) !void {
    var results: [1]?[]const u8 = undefined;
    const limit = if (expected) |value| value.len else 0;
    try db.getManyOwned(&.{key}, &results, limit, limit, true, null);
    defer freeValues(db.allocator, &results);
    if (expected) |value| {
        try testing.expect(results[0] != null);
        try testing.expectEqualSlices(u8, value, results[0].?);
    } else try testing.expectEqual(null, results[0]);
}

pub fn expectEntry(entry: *const leveldb.Entry, key: []const u8, value: []const u8) !void {
    try testing.expectEqualSlices(u8, key, entry.key);
    try testing.expectEqualSlices(u8, value, entry.value);
}
