const std = @import("std");
const leveldb = @import("root.zig");
const testing = std.testing;
const allocator = testing.allocator;
const helpers = @import("test_utils.zig");
const Fixture = helpers.Fixture;
const expectValue = helpers.expectValue;
const expectEntry = helpers.expectEntry;

fn expectKeys(db: *leveldb.Database, options: leveldb.RangeOptions, expected: []const []const u8) !void {
    var cursor = try db.cursor(options, null);
    defer cursor.close();
    var entries: [8]leveldb.Entry = undefined;
    const page = try cursor.readOwned(&entries, 16, 128, std.math.maxInt(u32), null);
    defer helpers.freeEntries(db.allocator, entries[0..page.count]);
    try testing.expectEqual(expected.len, page.count);
    try testing.expect(page.done);
    for (entries[0..page.count], expected) |entry, key| try testing.expectEqualStrings(key, entry.key);
}

test "cursor keeps its creation snapshot across updates deletes and inserts" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();

    try fixture.write(&.{
        .{ .key = "a", .value = "old a" },
        .{ .key = "c", .value = "old c" },
        .{ .key = "e", .value = "old e" },
    }, false);
    try fixture.db.compactRange(null, null);
    var cursor = try fixture.db.cursor(.{}, null);
    defer cursor.close();

    try fixture.put("a", "new a", false);
    try fixture.put("b", "new b", false);
    var entries: [1]leveldb.Entry = undefined;
    const first = try cursor.readOwned(&entries, 16, 32, 32, null);
    try testing.expectEqual(@as(usize, 1), first.count);
    try expectEntry(&entries[0], "a", "old a");
    helpers.freeEntries(allocator, entries[0..first.count]);

    try fixture.delete("c");
    try fixture.put("d", "new d", false);
    try fixture.put("e", "new e", false);
    try fixture.db.compactRange(null, null);
    for ([_][]const u8{ "c", "e" }, [_][]const u8{ "old c", "old e" }, 0..) |key, value, i| {
        const page = try cursor.readOwned(&entries, 16, 32, 32, null);
        defer helpers.freeEntries(allocator, entries[0..page.count]);
        try testing.expectEqual(@as(usize, 1), page.count);
        try expectEntry(&entries[0], key, value);
        try testing.expectEqual(i == 1, page.done);
    }
    try testing.expect((try cursor.readOwned(&entries, 16, 32, 32, null)).done);
    try cursor.seek("a", null);
    const again = try cursor.readOwned(&entries, 16, 32, 32, null);
    try expectEntry(&entries[0], "a", "old a");
    helpers.freeEntries(allocator, entries[0..again.count]);
    cursor.close();
    try testing.expectError(error.CursorClosed, cursor.readOwned(&entries, 16, 32, 32, null));
    try expectValue(&fixture.db, "a", "new a");
    try expectValue(&fixture.db, "c", null);
    try expectValue(&fixture.db, "e", "new e");
}

test "cursor owns range bounds and applies inclusive gte exclusive lt and total limit" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();

    for ([_][]const u8{ "a", "b", "c", "d", "e" }) |key| {
        try fixture.put(key, key, false);
    }
    var lower = [_]u8{'b'};
    var upper = [_]u8{'e'};
    var cursor = try fixture.db.cursor(.{ .gte = &lower, .lt = &upper, .limit = 2 }, null);
    defer cursor.close();
    lower[0] = 'z';
    upper[0] = 'a';

    var entries: [1]leveldb.Entry = undefined;
    for ([_][]const u8{ "b", "c" }, 0..) |key, i| {
        const page = try cursor.readOwned(&entries, 1, 16, 16, null);
        defer helpers.freeEntries(allocator, entries[0..page.count]);
        try testing.expectEqual(@as(usize, 1), page.count);
        try testing.expectEqual(i == 1, page.done);
        try expectEntry(&entries[0], key, key);
    }

    var range = try fixture.db.cursor(.{ .gte = "bb", .lt = "e" }, null);
    defer range.close();
    var range_entries: [4]leveldb.Entry = undefined;
    const page = try range.readOwned(&range_entries, 1, 16, 16, null);
    defer helpers.freeEntries(allocator, range_entries[0..page.count]);
    try testing.expectEqual(@as(usize, 2), page.count);
    try testing.expect(page.done);
    try expectEntry(&range_entries[0], "c", "c");
    try expectEntry(&range_entries[1], "d", "d");
}

test "cursor handles empty database zero limit and empty ranges" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();

    var entries: [1]leveldb.Entry = undefined;
    var empty = try fixture.db.cursor(.{}, null);
    defer empty.close();
    const empty_page = try empty.readOwned(&entries, 1, 8, 8, null);
    try testing.expectEqual(@as(usize, 0), empty_page.count);
    try testing.expectEqual(@as(usize, 0), empty_page.bytes);
    try testing.expect(empty_page.done);

    try fixture.put("b", "v", false);
    for ([_]leveldb.RangeOptions{
        .{ .limit = 0 },
        .{ .gte = "b", .lt = "b" },
        .{ .gte = "z", .lt = "a" },
        .{ .gte = "z" },
        .{ .lt = "b" },
    }) |options| {
        var cursor = try fixture.db.cursor(options, null);
        defer cursor.close();
        const page = try cursor.readOwned(&entries, 1, 8, 8, null);
        try testing.expectEqual(@as(usize, 0), page.count);
        try testing.expectEqual(@as(usize, 0), page.bytes);
        try testing.expect(page.done);
    }
}

test "cursor advances an empty key and value even when its byte count is zero" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();

    try fixture.put("", "", false);
    try fixture.put("a", "", false);
    var cursor = try fixture.db.cursor(.{}, null);
    defer cursor.close();

    var entries: [1]leveldb.Entry = undefined;
    const first = try cursor.readOwned(&entries, 1, 8, 8, null);
    try testing.expectEqual(@as(usize, 1), first.count);
    try testing.expectEqual(@as(usize, 0), first.bytes);
    try testing.expect(!first.done);
    try expectEntry(&entries[0], "", "");
    helpers.freeEntries(allocator, entries[0..first.count]);

    const second = try cursor.readOwned(&entries, 1, 8, 8, null);
    try testing.expectEqual(@as(usize, 1), second.count);
    try testing.expectEqual(@as(usize, 1), second.bytes);
    try testing.expect(second.done);
    try expectEntry(&entries[0], "a", "");
    helpers.freeEntries(allocator, entries[0..second.count]);
    cursor.close();
    try fixture.close();
}

test "close rejects live cursors and remains usable until all cursors close" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();

    try fixture.put("key", "value", false);
    var first = try fixture.db.cursor(.{}, null);
    defer first.close();
    var second = try fixture.db.cursor(.{}, null);
    defer second.close();

    try testing.expectError(error.CursorsOpen, fixture.db.close());
    try expectValue(&fixture.db, "key", "value");
    first.close();
    first.close();
    try testing.expectError(error.CursorsOpen, fixture.db.close());

    var entries: [1]leveldb.Entry = undefined;
    const page = try second.readOwned(&entries, 5, 16, 16, null);
    try testing.expect(page.done);
    try testing.expectEqual(@as(usize, 1), page.count);
    try expectEntry(&entries[0], "key", "value");
    helpers.freeEntries(allocator, entries[0..page.count]);
    try testing.expectError(error.CursorsOpen, fixture.db.close());
    second.close();
    try fixture.close();
    try fixture.db.close();
    try testing.expectError(error.CursorClosed, second.readOwned(&entries, 5, 16, 16, null));
    try testing.expectError(error.DatabaseClosed, expectValue(&fixture.db, "key", "value"));
    try testing.expectError(error.DatabaseClosed, fixture.put("key", "new", false));
    try testing.expectError(error.DatabaseClosed, fixture.delete("key"));
    try testing.expectError(error.DatabaseClosed, fixture.write(&.{}, false));
    try testing.expectError(error.DatabaseClosed, fixture.db.cursor(.{}, null));
}

test "cursor capacity is exact and closing one cursor permits replacement" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();

    var cursors: [leveldb.max_cursors]leveldb.Cursor = undefined;
    var initialized: usize = 0;
    defer for (cursors[0..initialized]) |*cursor| cursor.close();
    for (&cursors) |*cursor| {
        cursor.* = try fixture.db.cursor(.{}, null);
        initialized += 1;
    }
    try testing.expectError(error.CursorCapacity, fixture.db.cursor(.{}, null));
    cursors[0].close();
    cursors[0] = try fixture.db.cursor(.{}, null);
    try testing.expectError(error.CursorCapacity, fixture.db.cursor(.{}, null));
    for (&cursors) |*cursor| cursor.close();
    try fixture.close();
}

test "cursor allocation failure leaves database usable without retaining a live cursor" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.put("key", "value", false);
    try fixture.close();

    var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = 0 });
    fixture.db = try leveldb.Database.open(failing.allocator(), fixture.path, .{
        .create_if_missing = false,
    }, null);
    fixture.closed = false;
    try testing.expectError(error.OutOfMemory, fixture.db.cursor(.{ .lt = "z" }, null));
    try testing.expect(failing.has_induced_failure);
    failing.fail_index = std.math.maxInt(usize);
    try expectValue(&fixture.db, "key", "value");
    var cursor = try fixture.db.cursor(.{ .lt = "z" }, null);
    defer cursor.close();
    var entries: [1]leveldb.Entry = undefined;
    const page = try cursor.readOwned(&entries, 5, 8, 8, null);
    try testing.expectEqual(@as(usize, 1), page.count);
    try testing.expect(page.done);
    try expectEntry(&entries[0], "key", "value");
    helpers.freeEntries(failing.allocator(), entries[0..page.count]);
    try testing.expect(failing.allocated_bytes > 0);
    cursor.close();
    try testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
    try fixture.close();
}

test "four range bounds match inclusive precedence in both directions" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    for ([_][]const u8{ "", "a", "b", "c", "d" }) |key| try fixture.put(key, "v", false);
    const Case = struct { options: leveldb.RangeOptions, keys: []const []const u8 };
    const cases = [_]Case{
        .{ .options = .{}, .keys = &.{ "", "a", "b", "c", "d" } },
        .{ .options = .{ .gt = "a", .lt = "d" }, .keys = &.{ "b", "c" } },
        .{ .options = .{ .gte = "a", .lte = "c" }, .keys = &.{ "a", "b", "c" } },
        .{ .options = .{ .gt = "a", .lte = "c" }, .keys = &.{ "b", "c" } },
        .{ .options = .{ .gte = "a", .lt = "c" }, .keys = &.{ "a", "b" } },
        .{ .options = .{ .gt = "z", .gte = "b", .lt = "a", .lte = "c" }, .keys = &.{ "b", "c" } },
        .{ .options = .{ .gt = "ab", .lte = "cz" }, .keys = &.{ "b", "c" } },
        .{ .options = .{ .gte = "c", .lte = "c" }, .keys = &.{"c"} },
        .{ .options = .{ .gt = "c", .lte = "c" }, .keys = &.{} },
        .{ .options = .{ .gte = "c", .lt = "c" }, .keys = &.{} },
        .{ .options = .{ .gte = "d", .lte = "a" }, .keys = &.{} },
        .{ .options = .{ .lt = "" }, .keys = &.{} },
        .{ .options = .{ .lte = "" }, .keys = &.{""} },
        .{ .options = .{ .gte = "z" }, .keys = &.{} },
        .{ .options = .{ .gte = "a", .lte = "z" }, .keys = &.{ "a", "b", "c", "d" } },
    };
    for (cases) |case| {
        try expectKeys(&fixture.db, case.options, case.keys);
        var reverse = case.options;
        reverse.reverse = true;
        var keys: [8][]const u8 = undefined;
        for (case.keys, 0..) |key, index| keys[case.keys.len - index - 1] = key;
        try expectKeys(&fixture.db, reverse, keys[0..case.keys.len]);
    }
}

test "reverse range owns bounds and keeps its snapshot across pages" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    for ([_][]const u8{ "a\x00", "a\xff", "b" }) |key| try fixture.put(key, key, false);
    var lower = [_]u8{ 'a', 0 };
    var upper = [_]u8{'b'};
    var cursor = try fixture.db.cursor(.{ .gte = &lower, .lte = &upper, .reverse = true, .limit = 2 }, null);
    defer cursor.close();
    @memset(&lower, 'z');
    @memset(&upper, 0);
    try fixture.delete("b");
    try fixture.put("a\xff", "changed", false);
    var entries: [1]leveldb.Entry = undefined;
    const first = try cursor.readOwned(&entries, 16, 16, 16, null);
    try testing.expect(!first.done);
    try testing.expectEqualStrings("b", entries[0].key);
    helpers.freeEntries(allocator, entries[0..first.count]);
    const second = try cursor.readOwned(&entries, 16, 16, 16, null);
    defer helpers.freeEntries(allocator, entries[0..second.count]);
    try testing.expect(second.done);
    try testing.expectEqualStrings("a\xff", entries[0].key);
    try testing.expectEqualStrings("a\xff", entries[0].value);
}

test "projection charges only requested bytes and ignores omitted value limits" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.put("key", "1234567890", false);
    for ([_]bool{ false, true }) |reverse| {
        var keys = try fixture.db.cursor(.{ .values = false, .reverse = reverse, .fill_cache = true }, null);
        defer keys.close();
        var entries: [1]leveldb.Entry = undefined;
        const key_page = try keys.readOwned(&entries, 0, 3, std.math.maxInt(u32), null);
        defer helpers.freeEntries(allocator, entries[0..key_page.count]);
        try testing.expectEqual(@as(usize, 3), key_page.bytes);
        try testing.expectEqualStrings("key", entries[0].key);
        try testing.expectEqualStrings("", entries[0].value);
    }
    var values = try fixture.db.cursor(.{ .keys = false }, null);
    defer values.close();
    var value_entries: [1]leveldb.Entry = undefined;
    const value_page = try values.readOwned(&value_entries, 10, 10, std.math.maxInt(u32), null);
    defer helpers.freeEntries(allocator, value_entries[0..value_page.count]);
    try testing.expectEqual(@as(usize, 10), value_page.bytes);
    try testing.expectEqualStrings("", value_entries[0].key);
    try testing.expectEqualStrings("1234567890", value_entries[0].value);
    var neither = try fixture.db.cursor(.{ .keys = false, .values = false }, null);
    defer neither.close();
    var empty_entries: [1]leveldb.Entry = undefined;
    const empty_page = try neither.readOwned(&empty_entries, 0, 0, std.math.maxInt(u32), null);
    defer helpers.freeEntries(allocator, empty_entries[0..empty_page.count]);
    try testing.expectEqual(@as(usize, 1), empty_page.count);
    try testing.expectEqual(@as(usize, 0), empty_page.bytes);
    try testing.expect(empty_page.done);
}

test "range allocation failures release both copied bounds" {
    for (0..2) |fail_index| {
        var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = fail_index });
        var fixture: helpers.Fixture = undefined;
        try fixture.init(failing.allocator());
        defer fixture.deinit();
        try testing.expectError(error.OutOfMemory, fixture.db.cursor(.{ .gte = "a", .lte = "z" }, null));
        try testing.expectEqual(@as(u32, 0), fixture.db.cursors.load(.monotonic));
        try testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
    }
}

test "seek honors original exclusive bounds and byte order in both directions" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    for ([_][]const u8{ "a", "c", "e" }) |key| try fixture.put(key, key, false);
    for ([_]bool{ false, true }) |reverse| {
        var cursor = try fixture.db.cursor(.{ .gt = "a", .lte = "e", .reverse = reverse }, null);
        defer cursor.close();
        const Case = struct { target: []const u8, forward: ?[]const u8, backward: ?[]const u8 };
        const cases = [_]Case{
            .{ .target = "a", .forward = null, .backward = null },
            .{ .target = "b", .forward = "c", .backward = null },
            .{ .target = "c", .forward = "c", .backward = "c" },
            .{ .target = "d", .forward = "e", .backward = "c" },
            .{ .target = "e", .forward = "e", .backward = "e" },
            .{ .target = "f", .forward = null, .backward = null },
        };
        for (cases) |case| {
            try cursor.seek(case.target, null);
            var entries: [1]leveldb.Entry = undefined;
            const page = try cursor.readOwned(&entries, 1, 2, 0, null);
            defer helpers.freeEntries(allocator, entries[0..page.count]);
            if (if (reverse) case.backward else case.forward) |expected| {
                try testing.expectEqual(@as(usize, 1), page.count);
                try testing.expectEqualStrings(expected, entries[0].key);
            } else try testing.expectEqual(@as(usize, 0), page.count);
        }
    }
    var reverse = try fixture.db.cursor(.{ .reverse = true }, null);
    defer reverse.close();
    try reverse.seek("z", null);
    var entries: [1]leveldb.Entry = undefined;
    const page = try reverse.readOwned(&entries, 1, 2, 0, null);
    defer helpers.freeEntries(allocator, entries[0..page.count]);
    try testing.expectEqualStrings("e", entries[0].key);
}

test "seek retains snapshot and consumed limit across repositions and exhaustion" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.put("a", "A", false);
    try fixture.put("b", "B", false);
    var cursor = try fixture.db.cursor(.{ .limit = 2 }, null);
    defer cursor.close();
    try fixture.put("a", "new", false);
    var entries: [1]leveldb.Entry = undefined;
    for (0..2) |_| {
        try cursor.seek("a", null);
        const page = try cursor.readOwned(&entries, 1, 2, 0, null);
        defer helpers.freeEntries(allocator, entries[0..page.count]);
        try testing.expectEqual(@as(usize, 1), page.count);
        try testing.expectEqualStrings("A", entries[0].value);
    }
    try cursor.seek("b", null);
    try testing.expectEqual(@as(usize, 0), (try cursor.readOwned(&entries, 1, 2, 0, null)).count);
    cursor.close();
    try testing.expectError(error.CursorClosed, cursor.seek("a", null));
    var invalid = try fixture.db.cursor(.{}, null);
    defer invalid.close();
    const target = [_]u8{0} ** (leveldb.max_key_bytes + 1);
    try testing.expectError(error.KeyTooLarge, invalid.seek(&target, null));
    try testing.expect(invalid.closed);
}

test "owned pages allocate actual bytes and defer rows without losing iterator position" {
    var failing = testing.FailingAllocator.init(allocator, .{});
    var fixture: helpers.Fixture = undefined;
    try fixture.init(failing.allocator());
    defer fixture.deinit();
    try fixture.put("a", "AA", false);
    try fixture.put("b", "BB", false);
    var cursor = try fixture.db.cursor(.{}, null);
    defer cursor.close();
    var entries: [2]leveldb.Entry = undefined;
    const first = try cursor.readOwned(&entries, 1024 * 1024 * 1024, 3, std.math.maxInt(u32), null);
    try testing.expectEqual(@as(usize, 1), first.count);
    try testing.expect(!first.done);
    try testing.expectEqualStrings("a", entries[0].key);
    helpers.freeEntries(failing.allocator(), entries[0..first.count]);
    const second = try cursor.readOwned(&entries, 1024 * 1024 * 1024, 1024 * 1024 * 1024, std.math.maxInt(u32), null);
    defer helpers.freeEntries(failing.allocator(), entries[0..second.count]);
    try testing.expectEqual(@as(usize, 1), second.count);
    try testing.expect(second.done);
    try testing.expectEqualStrings("b", entries[0].key);
    try testing.expectEqualStrings("BB", entries[0].value);
    try testing.expectEqual(@as(usize, 6), failing.allocated_bytes);
    cursor.close();
    try fixture.close();
    try testing.expectEqualStrings("BB", entries[0].value);
}

test "memory_safety: owned pages clean up partial copies on allocation or row limit failure" {
    for (0..4) |fail_index| {
        var failing = testing.FailingAllocator.init(allocator, .{ .fail_index = fail_index });
        var fixture: helpers.Fixture = undefined;
        try fixture.init(failing.allocator());
        defer fixture.deinit();
        try fixture.put("a", "A", false);
        try fixture.put("b", "B", false);
        var cursor = try fixture.db.cursor(.{}, null);
        defer cursor.close();
        var entries: [2]leveldb.Entry = undefined;
        try testing.expectError(error.OutOfMemory, cursor.readOwned(&entries, 1, 4, std.math.maxInt(u32), null));
        try testing.expectEqual(@as(u32, 0), fixture.db.cursors.load(.monotonic));
        try testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
        for (entries) |entry| {
            try testing.expectEqual(@as(usize, 0), entry.key.len);
            try testing.expectEqual(@as(usize, 0), entry.value.len);
        }
    }
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.put("a", "A", false);
    try fixture.put("b", "BB", false);
    var cursor = try fixture.db.cursor(.{}, null);
    defer cursor.close();
    var entries: [2]leveldb.Entry = undefined;
    try testing.expectError(error.ValueTooLarge, cursor.readOwned(&entries, 1, 10, std.math.maxInt(u32), null));
    for (entries) |entry| try testing.expectEqual(@as(usize, 0), entry.value.len);
    try fixture.close();
}

test "owned pages reject first row aggregate overflow and invalid metadata counts" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.put("key", "value", false);
    var entries: [1]leveldb.Entry = undefined;
    var first = try fixture.db.cursor(.{}, null);
    defer first.close();
    try testing.expectError(error.BatchTooLarge, first.readOwned(entries[0..1], 5, 7, std.math.maxInt(u32), null));
    var invalid = try fixture.db.cursor(.{}, null);
    defer invalid.close();
    try testing.expectError(error.InvalidReadLimit, invalid.readOwned(entries[0..0], 5, 8, std.math.maxInt(u32), null));
    try testing.expectEqual(@as(u32, 0), fixture.db.cursors.load(.monotonic));
}

test "owned batch soft watermark includes the crossing row and keeps exhausted snapshots seekable" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    for ([_][]const u8{ "a", "b", "c" }) |key| try fixture.put(key, "123", false);
    var cursor = try fixture.db.cursor(.{}, null);
    defer cursor.close();
    var entries: [4]leveldb.Entry = undefined;
    const first = try cursor.readOwned(&entries, 3, 100, 4, null);
    try testing.expectEqual(@as(usize, 2), first.count);
    try testing.expectEqual(@as(usize, 8), first.bytes);
    try testing.expect(!first.done);
    helpers.freeEntries(allocator, entries[0..first.count]);
    const oversized = try cursor.readOwned(&entries, 3, 100, 0, null);
    try testing.expectEqual(@as(usize, 1), oversized.count);
    try testing.expectEqualStrings("c", entries[0].key);
    try testing.expect(oversized.done);
    helpers.freeEntries(allocator, entries[0..oversized.count]);
    try testing.expectEqual(@as(u32, 1), fixture.db.cursors.load(.monotonic));
    try testing.expectEqual(@as(usize, 0), (try cursor.readOwned(&entries, 3, 100, 4, null)).count);
    try cursor.seek("b", null);
    const again = try cursor.readOwned(entries[0..1], 3, 100, 4, null);
    defer helpers.freeEntries(allocator, entries[0..again.count]);
    try testing.expectEqualStrings("b", entries[0].key);
    cursor.close();
    try fixture.close();
}

test "owned batch projection charges only copied components and hard limits remain independent" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    for ([_][]const u8{ "a", "b", "c" }) |key| try fixture.put(key, "12345", false);
    var entries: [3]leveldb.Entry = undefined;
    var keys = try fixture.db.cursor(.{ .values = false }, null);
    defer keys.close();
    const key_page = try keys.readOwned(&entries, 0, 100, 1, null);
    try testing.expectEqual(@as(usize, 2), key_page.count);
    try testing.expectEqual(@as(usize, 2), key_page.bytes);
    helpers.freeEntries(allocator, entries[0..key_page.count]);
    var values = try fixture.db.cursor(.{ .keys = false }, null);
    defer values.close();
    const value_page = try values.readOwned(&entries, 5, 100, 5, null);
    try testing.expectEqual(@as(usize, 2), value_page.count);
    try testing.expectEqual(@as(usize, 10), value_page.bytes);
    helpers.freeEntries(allocator, entries[0..value_page.count]);
    var neither = try fixture.db.cursor(.{ .keys = false, .values = false }, null);
    defer neither.close();
    const empty_page = try neither.readOwned(&entries, 0, 0, 0, null);
    try testing.expectEqual(@as(usize, 3), empty_page.count);
    try testing.expectEqual(@as(usize, 0), empty_page.bytes);
    helpers.freeEntries(allocator, entries[0..empty_page.count]);
    var hard = try fixture.db.cursor(.{}, null);
    defer hard.close();
    try testing.expectError(error.BatchTooLarge, hard.readOwned(&entries, 5, 5, 0, null));
    try testing.expect(hard.closed);
    for (entries) |entry| try testing.expectEqual(@as(usize, 0), entry.value.len);
    var deferred = try fixture.db.cursor(.{}, null);
    defer deferred.close();
    const page = try deferred.readOwned(&entries, 5, 7, 100, null);
    try testing.expectEqual(@as(usize, 1), page.count);
    helpers.freeEntries(allocator, entries[0..page.count]);
    const next = try deferred.readOwned(&entries, 5, 7, 100, null);
    defer helpers.freeEntries(allocator, entries[0..next.count]);
    try testing.expectEqualStrings("b", entries[0].key);
}

test "owned pages return a large batch in byte order" {
    var fixture: helpers.Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    const count = 1025;
    for (0..count) |i| {
        var key: [2]u8 = undefined;
        std.mem.writeInt(u16, &key, @intCast(i), .big);
        try fixture.put(&key, "", false);
    }
    var cursor = try fixture.db.cursor(.{}, null);
    defer cursor.close();
    const entries = try allocator.alloc(leveldb.Entry, count);
    defer allocator.free(entries);
    const page = try cursor.readOwned(entries, 0, count * 2, 16384, null);
    defer helpers.freeEntries(allocator, entries[0..page.count]);
    try testing.expectEqual(count, page.count);
    try testing.expect(page.done);
    try testing.expectEqual(@as(u16, count - 1), std.mem.readInt(u16, entries[count - 1].key[0..2], .big));
}

test "owned page limits reject oversized budgets and clear output metadata" {
    var fixture: Fixture = undefined;
    try fixture.init(allocator);
    defer fixture.deinit();
    try fixture.put("a", "A", false);
    const budgets = [_][2]usize{
        .{ leveldb.max_owned_value_bytes + 1, leveldb.max_owned_batch_bytes },
        .{ leveldb.max_owned_value_bytes, leveldb.max_owned_batch_bytes + 1 },
    };
    for (budgets) |budget| {
        var cursor = try fixture.db.cursor(.{}, null);
        defer cursor.close();
        var entries = [_]leveldb.Entry{.{ .key = "sentinel", .value = "sentinel" }};
        try testing.expectError(error.InvalidReadLimit, cursor.readOwned(&entries, budget[0], budget[1], std.math.maxInt(u32), null));
        try testing.expectEqual(@as(usize, 0), entries[0].key.len);
        try testing.expectEqual(@as(usize, 0), entries[0].value.len);
        try testing.expectEqual(@as(u32, 0), fixture.db.cursors.load(.monotonic));
    }
}
