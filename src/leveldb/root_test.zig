const std = @import("std");
const leveldb = @import("root.zig");
const testing = std.testing;
const allocator = testing.allocator;
const helpers = @import("test_utils.zig");
const Fixture = helpers.Fixture;
const expectValue = helpers.expectValue;
const expectEntry = helpers.expectEntry;

test "owned reads distinguish exact binary keys, empty values, and missing keys" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();

    try fixture.put("", "empty key", false);
    try fixture.put("ab", "prefix", false);
    try fixture.put("ab\x00", "nul", false);
    try fixture.put("ab\xff", "binary", false);
    try fixture.put("empty", "", false);

    try expectValue(&fixture.db, "", "empty key");
    try expectValue(&fixture.db, "a", null);
    try expectValue(&fixture.db, "ab", "prefix");
    try expectValue(&fixture.db, "ab\x00", "nul");
    try expectValue(&fixture.db, "ab\x01", null);
    try expectValue(&fixture.db, "ab\xff", "binary");
    try expectValue(&fixture.db, "empty", "");
    try expectValue(&fixture.db, "z", null);

    try fixture.delete("empty");
    try fixture.delete("missing");
    try expectValue(&fixture.db, "empty", null);
}

test "owned reads preserve mixed missing empty duplicate and unsorted key order" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.write(&.{
        .{ .key = "", .value = "E" },
        .{ .key = "a", .value = "A" },
        .{ .key = "a\x00", .value = "N" },
        .{ .key = "b", .value = "BB" },
        .{ .key = "empty", .value = "" },
    }, false);
    const keys = [_][]const u8{ "zz", "b", "a", "ab", "b", "empty", "", "a\x00", "a" };
    const expected = [_]?[]const u8{ null, "BB", "A", null, "BB", "", "E", "N", "A" };
    var results: [keys.len]?[]const u8 = undefined;
    try fixture.db.getManyOwned(&keys, &results, 2, 8, true, null);
    defer helpers.freeValues(allocator, &results);
    for (expected, results) |value, result| {
        if (value) |bytes| {
            try testing.expect(result != null);
            try testing.expectEqualSlices(u8, bytes, result.?);
        } else try testing.expectEqual(null, result);
    }
    try fixture.put("b", "changed", false);
    try testing.expectEqualStrings("BB", results[1].?);
    try testing.expectEqualStrings("BB", results[4].?);
}

test "owned multi-get keeps its snapshot when a write lands between results" {
    const WriteOnAllocation = struct {
        db: *leveldb.Database,
        written: bool = false,
        failure: ?anyerror = null,

        fn alloc(context: *anyopaque, len: usize, alignment: std.mem.Alignment, return_address: usize) ?[*]u8 {
            const self: *@This() = @ptrCast(@alignCast(context));
            if (!self.written) {
                self.written = true;
                self.db.writeWithLimits(&.{
                    .{ .key = "a", .value = "new" },
                    .{ .key = "b", .value = "new" },
                }, false, .{
                    .max_value_bytes = 3,
                    .max_total_bytes = 8,
                    .max_entries = 2,
                }, null) catch |err| {
                    self.failure = err;
                    return null;
                };
            }
            return allocator.rawAlloc(len, alignment, return_address);
        }

        fn free(_: *anyopaque, memory: []u8, alignment: std.mem.Alignment, return_address: usize) void {
            allocator.rawFree(memory, alignment, return_address);
        }
    };

    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.write(&.{
        .{ .key = "a", .value = "old" },
        .{ .key = "b", .value = "old" },
    }, false);

    var writer = WriteOnAllocation{ .db = &fixture.db };
    fixture.db.allocator = .{ .ptr = &writer, .vtable = &.{
        .alloc = WriteOnAllocation.alloc,
        .resize = std.mem.Allocator.noResize,
        .remap = std.mem.Allocator.noRemap,
        .free = WriteOnAllocation.free,
    } };
    defer fixture.db.allocator = allocator;

    var results: [3]?[]const u8 = undefined;
    try fixture.db.getManyOwned(&.{ "a", "b", "a" }, &results, 3, 9, false, null);
    defer helpers.freeValues(fixture.db.allocator, &results);
    try testing.expect(writer.written);
    try testing.expectEqual(null, writer.failure);
    for (results) |value| try testing.expectEqualStrings("old", value.?);
    try expectValue(&fixture.db, "a", "new");
    try expectValue(&fixture.db, "b", "new");
}

test "write applies ordered puts and deletes and persists after reopening" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();

    try fixture.put("remove", "old", false);
    try fixture.write(&.{
        .{ .key = "same", .value = "first" },
        .{ .key = "remove", .value = null },
        .{ .key = "same", .value = null },
        .{ .key = "same", .value = "last" },
        .{ .key = "empty", .value = "" },
    }, true);
    try fixture.write(&.{}, false);
    try fixture.close();
    fixture.db = try leveldb.Database.open(allocator, fixture.path, .{
        .create_if_missing = false,
    }, null);
    fixture.closed = false;

    try expectValue(&fixture.db, "same", "last");
    try expectValue(&fixture.db, "remove", null);
    try expectValue(&fixture.db, "empty", "");
}

test "write validates every key before applying any operation" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();

    try fixture.put("keep", "original", false);
    const oversized_key: [leveldb.max_key_bytes + 1]u8 = @splat('k');
    try testing.expectError(error.KeyTooLarge, fixture.write(&.{
        .{ .key = "new", .value = "must not appear" },
        .{ .key = "keep", .value = null },
        .{ .key = &oversized_key, .value = "invalid" },
    }, false));
    try expectValue(&fixture.db, "new", null);
    try expectValue(&fixture.db, "keep", "original");

    try testing.expectError(error.KeyTooLarge, fixture.write(&.{
        .{ .key = "keep", .value = "changed" },
        .{ .key = &oversized_key, .value = null },
    }, false));
    try expectValue(&fixture.db, "keep", "original");
}

test "write validates entry and aggregate byte limits before any mutation" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.put("k", "original", false);
    const operations = [_]leveldb.Operation{
        .{ .key = "k", .value = null },
        .{ .key = "new", .value = "v" },
    };
    try testing.expectError(error.BatchTooLarge, fixture.db.writeWithLimits(&operations, false, .{
        .max_entries = 1,
        .max_total_bytes = 5,
        .max_value_bytes = 1,
    }, null));
    try expectValue(&fixture.db, "k", "original");
    try testing.expectError(error.BatchTooLarge, fixture.db.writeWithLimits(&operations, false, .{
        .max_entries = 2,
        .max_total_bytes = 4,
        .max_value_bytes = 1,
    }, null));
    try expectValue(&fixture.db, "k", "original");
    try expectValue(&fixture.db, "new", null);
    try fixture.db.writeWithLimits(&operations, false, .{
        .max_entries = 2,
        .max_total_bytes = 5,
        .max_value_bytes = 1,
    }, null);
    try expectValue(&fixture.db, "k", null);
    try expectValue(&fixture.db, "new", "v");
}

test "maximum length keys work and oversized keys fail at every public boundary" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();

    const key: [leveldb.max_key_bytes + 1]u8 = @splat('k');
    const maximum = key[0..leveldb.max_key_bytes];
    try fixture.put(maximum, "v", false);
    try expectValue(&fixture.db, maximum, "v");

    var result: [1]?[]const u8 = undefined;
    try testing.expectError(error.KeyTooLarge, fixture.db.getManyOwned(&.{&key}, &result, 1, 1, true, null));
    try testing.expectEqual(null, result[0]);
    try testing.expectError(error.KeyTooLarge, fixture.put(&key, "v", false));
    try testing.expectError(error.KeyTooLarge, fixture.delete(&key));
    try testing.expectError(error.KeyTooLarge, fixture.db.cursor(.{ .gte = &key }, null));
    try testing.expectError(error.KeyTooLarge, fixture.db.cursor(.{ .lt = &key }, null));
    try expectValue(&fixture.db, maximum, "v");
    try fixture.delete(maximum);
    try expectValue(&fixture.db, maximum, null);
    try fixture.close();
}

test "open rejects invalid paths and options before creating database" {
    const long_path: [4097:0]u8 = @splat('p');
    for ([_][:0]const u8{ "", "embedded\x00nul", &long_path }) |path| {
        try testing.expectError(error.InvalidPath, leveldb.Database.open(allocator, path, .{}, null));
    }

    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.close();

    for ([_]leveldb.Options{
        .{ .cache_bytes = 1024 * 1024 * 1024 + 1 },
        .{ .write_buffer_bytes = 64 * 1024 - 1 },
        .{ .write_buffer_bytes = 1024 * 1024 * 1024 + 1 },
        .{ .max_open_files = 73 },
        .{ .max_open_files = 4097 },
    }) |options| {
        try testing.expectError(error.InvalidOptions, leveldb.Database.open(
            allocator,
            fixture.path,
            options,
            null,
        ));
    }
    fixture.db = try leveldb.Database.open(allocator, fixture.path, .{
        .create_if_missing = false,
        .cache_bytes = 0,
        .write_buffer_bytes = 64 * 1024,
        .max_open_files = 74,
    }, null);
    fixture.closed = false;
    try fixture.put("key", "value", false);
    try expectValue(&fixture.db, "key", "value");
}

test "memory_safety: cold compressed SSTable reads enforce value and page limits" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();

    const value = try allocator.alloc(u8, 32 * 1024);
    defer allocator.free(value);
    @memset(value, 's');
    try fixture.put("compressed", value, true);
    try fixture.close();

    // Reopening flushes the recovered log to an SSTable; reopen again to discard engine caches.
    fixture.db = try leveldb.Database.open(allocator, fixture.path, .{
        .create_if_missing = false,
    }, null);
    fixture.closed = false;
    try fixture.close();
    try expectCompressedTable(&fixture, value.len);

    fixture.db = try leveldb.Database.open(allocator, fixture.path, .{
        .create_if_missing = false,
    }, null);
    fixture.closed = false;
    var results: [1]?[]const u8 = undefined;
    try testing.expectError(error.ValueTooLarge, fixture.db.getManyOwned(&.{"compressed"}, &results, 16, 16, false, null));
    try testing.expectEqual(null, results[0]);

    try fixture.reopen();
    var cursor = try fixture.db.cursor(.{}, null);
    defer cursor.close();
    var entries: [1]leveldb.Entry = undefined;
    try testing.expectError(error.ValueTooLarge, cursor.readOwned(&entries, 16, 16, 16, null));
    try testing.expectError(error.CursorClosed, cursor.readOwned(&entries, value.len, value.len + 10, 65536, null));
    try expectValue(&fixture.db, "compressed", value);
    var full_cursor = try fixture.db.cursor(.{}, null);
    defer full_cursor.close();
    const page = try full_cursor.readOwned(&entries, value.len, value.len + 10, 65536, null);
    defer helpers.freeEntries(allocator, entries[0..page.count]);
    try testing.expectEqual(@as(usize, 1), page.count);
    try testing.expectEqual(value.len + 10, page.bytes);
    try testing.expect(page.done);
    try expectEntry(&entries[0], "compressed", value);
    full_cursor.close();
    try fixture.close();
}

test "SSTable corruption propagates through reads and failed cursor creation cleans up" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();

    try fixture.put("key", "value", true);
    try fixture.reopen();
    try fixture.close();
    try corruptFirstTableBlock(&fixture);
    try fixture.reopen();

    var diagnostics: leveldb.Diagnostics = .{};
    defer diagnostics.deinit();
    var results: [1]?[]const u8 = undefined;
    try testing.expectError(error.Corruption, fixture.db.getManyOwned(
        &.{"key"},
        &results,
        8,
        8,
        false,
        &diagnostics,
    ));
    try testing.expect(std.mem.startsWith(u8, diagnostics.message.?, "Corruption"));
    diagnostics.deinit();
    try testing.expectEqual(null, results[0]);
    try testing.expectError(error.Corruption, fixture.db.cursor(.{ .gte = "key", .lt = "z" }, &diagnostics));
    try fixture.close();
    try testing.expect(std.mem.startsWith(u8, diagnostics.message.?, "Corruption"));
}

test "owned getMany returns independent exact allocations with caller byte limits" {
    var failing = testing.FailingAllocator.init(allocator, .{});
    var fixture: helpers.Fixture = undefined;
    try fixture.init(failing.allocator());
    defer fixture.deinit();
    try fixture.put("a", "one", false);
    try fixture.put("empty", "", false);
    const keys = [_][]const u8{ "a", "missing", "empty", "a" };
    var results: [keys.len]?[]const u8 = undefined;
    const before = failing.allocated_bytes;
    try fixture.db.getManyOwned(&keys, &results, 1024 * 1024 * 1024, 1024 * 1024 * 1024, false, null);
    defer helpers.freeValues(failing.allocator(), &results);
    try testing.expectEqualStrings("one", results[0].?);
    try testing.expectEqual(null, results[1]);
    try testing.expectEqualStrings("", results[2].?);
    try testing.expectEqualStrings("one", results[3].?);
    try testing.expect(results[0].?.ptr != results[3].?.ptr);
    try testing.expect(failing.allocated_bytes - before < 1024);
    try fixture.close();
    try testing.expectEqualStrings("one", results[0].?);
}

test "owned getMany enforces value and total limits and releases partial results" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.put("a", "12345", false);
    try fixture.put("empty", "", false);
    var results: [2]?[]const u8 = undefined;
    try testing.expectError(error.ValueTooLarge, fixture.db.getManyOwned(&.{ "a", "a" }, &results, 4, 1, true, null));
    for (results) |value| try testing.expectEqual(null, value);
    try testing.expectError(error.BatchTooLarge, fixture.db.getManyOwned(&.{ "a", "a" }, &results, 5, 9, false, null));
    for (results) |value| try testing.expectEqual(null, value);
    try fixture.db.getManyOwned(&.{ "missing", "empty" }, &results, 0, 0, true, null);
    defer helpers.freeValues(allocator, &results);
    try testing.expectEqual(null, results[0]);
    try testing.expectEqualStrings("", results[1].?);
}

test "memory_safety: owned getMany frees every partial allocation and nulls outputs" {
    for (0..3) |fail_index| {
        var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = fail_index });
        var fixture: helpers.Fixture = undefined;
        try fixture.init(failing.allocator());
        defer fixture.deinit();
        try fixture.put("a", "value", false);
        var results: [3]?[]const u8 = undefined;
        try testing.expectError(error.OutOfMemory, fixture.db.getManyOwned(
            &.{ "a", "a", "a" },
            &results,
            5,
            15,
            true,
            null,
        ));
        for (results) |value| try testing.expectEqual(null, value);
        try testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
    }
}

test "owned reads and atomic writes accept more than 1024 entries" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    const count = 1025;
    const operations = try allocator.alloc(leveldb.Operation, count);
    defer allocator.free(operations);
    @memset(operations, .{ .key = "a", .value = "v" });
    try fixture.db.writeWithLimits(operations, false, .{
        .max_entries = count,
        .max_total_bytes = count * 2,
        .max_value_bytes = 1,
    }, null);
    const keys = try allocator.alloc([]const u8, count);
    defer allocator.free(keys);
    @memset(keys, "a");
    const results = try allocator.alloc(?[]const u8, count);
    defer allocator.free(results);
    try fixture.db.getManyOwned(keys, results, 1, count, true, null);
    defer helpers.freeValues(allocator, results);
    for (results) |value| try testing.expectEqualStrings("v", value.?);
    operations[count - 1].value = "too large";
    operations[0] = .{ .key = "new", .value = "v" };
    try testing.expectError(error.ValueTooLarge, fixture.db.writeWithLimits(operations, false, .{
        .max_entries = count,
        .max_total_bytes = count * 4,
        .max_value_bytes = 1,
    }, null));
    try expectValue(&fixture.db, "new", null);
}

test "owned read limits reject oversized budgets and clear output metadata" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.put("a", "A", false);
    const budgets = [_][2]usize{
        .{ leveldb.max_owned_value_bytes + 1, leveldb.max_owned_batch_bytes },
        .{ leveldb.max_owned_value_bytes, leveldb.max_owned_batch_bytes + 1 },
    };
    for (budgets) |budget| {
        var results = [_]?[]const u8{"sentinel"};
        try testing.expectError(error.InvalidReadLimit, fixture.db.getManyOwned(
            &.{"a"},
            &results,
            budget[0],
            budget[1],
            false,
            null,
        ));
        try testing.expectEqual(null, results[0]);
    }
    var results: [1]?[]const u8 = undefined;
    try fixture.db.getManyOwned(&.{"a"}, &results, leveldb.max_owned_value_bytes, leveldb.max_owned_batch_bytes, true, null);
    helpers.freeValues(allocator, &results);
    try fixture.close();
    try testing.expectError(error.DatabaseClosed, fixture.db.getManyOwned(&.{"a"}, &results, 1, 1, true, null));
    try testing.expectEqual(null, results[0]);
}

test "owned getMany validation failures null all bounded result slots" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    var results = [_]?[]const u8{ "sentinel", "sentinel" };
    try testing.expectError(error.BatchTooLarge, fixture.db.getManyOwned(&.{"a"}, &results, 1, 1, true, null));
    for (results) |value| try testing.expectEqual(null, value);
    const oversized_key = [_]u8{'k'} ** (leveldb.max_key_bytes + 1);
    try testing.expectError(error.KeyTooLarge, fixture.db.getManyOwned(&.{ "a", &oversized_key }, &results, 1, 1, true, null));
    for (results) |value| try testing.expectEqual(null, value);
}

test "write limits enforce value bytes total bytes and entry counts" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try testing.expectError(error.ValueTooLarge, fixture.db.writeWithLimits(&.{}, false, .{
        .max_value_bytes = leveldb.max_owned_value_bytes + 1,
        .max_total_bytes = leveldb.max_owned_batch_bytes,
        .max_entries = leveldb.max_bulk_entries,
    }, null));
    try testing.expectError(error.BatchTooLarge, fixture.db.writeWithLimits(&.{}, false, .{
        .max_value_bytes = leveldb.max_owned_value_bytes,
        .max_total_bytes = leveldb.max_owned_batch_bytes + 1,
        .max_entries = leveldb.max_bulk_entries,
    }, null));
    try fixture.db.writeWithLimits(&.{}, false, .{
        .max_value_bytes = leveldb.max_owned_value_bytes,
        .max_total_bytes = leveldb.max_owned_batch_bytes,
        .max_entries = leveldb.max_bulk_entries,
    }, null);
    try testing.expectError(error.BatchTooLarge, fixture.db.writeWithLimits(&.{}, false, .{
        .max_value_bytes = 1,
        .max_total_bytes = 1,
        .max_entries = leveldb.max_bulk_entries + 1,
    }, null));
}

fn corruptFirstTableBlock(fixture: *const Fixture) !void {
    var directory = try fixture.tmp.dir.openDir(testing.io, "database", .{ .iterate = true });
    defer directory.close(testing.io);

    var iterator = directory.iterate();
    for (0..32) |_| {
        const entry = try iterator.next(testing.io) orelse return error.MissingTable;
        if (!std.mem.endsWith(u8, entry.name, ".ldb") and
            !std.mem.endsWith(u8, entry.name, ".sst")) continue;
        const file = try directory.openFile(testing.io, entry.name, .{ .mode = .read_write });
        defer file.close(testing.io);

        var byte: [1]u8 = undefined;
        try testing.expectEqual(@as(usize, 1), try file.readPositionalAll(testing.io, &byte, 0));
        byte[0] ^= 0xff;
        try file.writePositionalAll(testing.io, &byte, 0);
        return;
    }
    return error.TooManyDatabaseFiles;
}

fn expectCompressedTable(fixture: *const Fixture, uncompressed_bytes: usize) !void {
    var directory = try fixture.tmp.dir.openDir(testing.io, "database", .{ .iterate = true });
    defer directory.close(testing.io);

    var iterator = directory.iterate();
    var table_count: usize = 0;
    var table_bytes: u64 = 0;
    for (0..32) |_| {
        const entry = try iterator.next(testing.io) orelse break;
        if (!std.mem.endsWith(u8, entry.name, ".ldb") and
            !std.mem.endsWith(u8, entry.name, ".sst")) continue;
        const stat = try directory.statFile(testing.io, entry.name, .{});
        table_count += 1;
        table_bytes += stat.size;
    } else return error.TooManyDatabaseFiles;
    try testing.expectEqual(@as(usize, 1), table_count);
    try testing.expect(table_bytes > 0);
    try testing.expect(table_bytes < uncompressed_bytes);
}

test "clear deletes multiple chunks and preserves existing cursor snapshot" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    for (0..1100) |index| {
        var key: [4]u8 = undefined;
        std.mem.writeInt(u32, &key, @intCast(index), .big);
        try fixture.put(&key, "value", false);
    }
    var snapshot = try fixture.db.cursor(.{ .limit = 1 }, null);
    defer snapshot.close();
    try fixture.db.clear(null);
    var entries: [1]leveldb.Entry = undefined;
    const old = try snapshot.readOwned(&entries, 5, 16, 16, null);
    try testing.expect(old.done);
    try testing.expectEqualStrings("value", entries[0].value);
    helpers.freeEntries(allocator, entries[0..old.count]);
    var empty = try fixture.db.cursor(.{}, null);
    defer empty.close();
    const page = try empty.readOwned(&entries, 5, 16, 16, null);
    try testing.expectEqual(@as(usize, 0), page.count);
    try fixture.put("new", "new", false);
    try expectValue(&fixture.db, "new", "new");
}

test "clear preflight bounds fail without partial deletion and empty clear permits zero budget" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    fixture.db.clear_max_entries = 0;
    try fixture.db.clear(null);
    try fixture.put("a", "A", false);
    try fixture.put("b", "B", false);
    fixture.db.clear_max_entries = 1;
    try testing.expectError(error.ClearLimitExceeded, fixture.db.clear(null));
    try expectValue(&fixture.db, "a", "A");
    try expectValue(&fixture.db, "b", "B");
    fixture.db.clear_max_entries = 2;
    try fixture.db.clear(null);
    try expectValue(&fixture.db, "a", null);
}

test "maintenance compact estimate property and destroy operate on real disk" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.put("key", &([_]u8{'x'} ** 8192), true);
    try fixture.db.compactRange(null, null);
    try testing.expect(try fixture.db.approximateSize("", "z") > 0);
    try testing.expectEqual(@as(u64, 0), try fixture.db.approximateSize("key", "key"));
    try testing.expectEqual(null, try fixture.db.propertyValue("unknown-property"));
    const property = (try fixture.db.propertyValue("leveldb.stats")).?;
    defer allocator.free(property);
    try testing.expect(property.len > 0);
    try testing.expectError(error.InvalidProperty, fixture.db.propertyValue("leveldb.stats\x00suffix"));
    try fixture.close();
    try testing.expect(property.len > 0);
    try leveldb.destroy(fixture.path, null);
    try testing.expectError(error.InvalidArgument, leveldb.Database.open(allocator, fixture.path, .{
        .create_if_missing = false,
    }, null));
    try testing.expectError(error.InvalidPath, leveldb.destroy("", null));
    try testing.expectError(error.InvalidPath, leveldb.destroy("not\x00a-path", null));
    try testing.expectError(error.DatabaseClosed, fixture.db.clear(null));
    try testing.expectError(error.DatabaseClosed, fixture.db.approximateSize("", "z"));
    try testing.expectError(error.DatabaseClosed, fixture.db.compactRange(null, null));
    try testing.expectError(error.DatabaseClosed, fixture.db.propertyValue("leveldb.stats"));
}

test "property copy allocation failure leaves database usable" {
    var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    var fixture: helpers.Fixture = undefined;
    try fixture.init(failing.allocator());
    defer fixture.deinit();
    try testing.expectError(error.OutOfMemory, fixture.db.propertyValue("leveldb.stats"));
    try testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
    failing.fail_index = std.math.maxInt(usize);
    try fixture.put("a", "A", false);
    try expectValue(&fixture.db, "a", "A");
}

test "clear rejects budgets above u32 before mutation" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.put("a", "A", false);
    fixture.db.clear_max_entries = @as(u64, std.math.maxInt(u32)) + 1;
    try testing.expectError(error.InvalidOptions, fixture.db.clear(null));
    try expectValue(&fixture.db, "a", "A");
    try testing.expectError(error.InvalidOptions, leveldb.Database.open(allocator, fixture.path, .{
        .clear_max_entries = fixture.db.clear_max_entries,
    }, null));
}
