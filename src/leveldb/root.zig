//! Bounded result materialization over LevelDB. Database operations may run concurrently; callers serialize each
//! cursor, keep Database addresses stable and close only after all users retire. Engine reads, decompression,
//! cache and compaction are outside these result bounds.
const std = @import("std");
const raw = @import("raw.zig");
const ranges = @import("range.zig");
const owned = @import("owned.zig");
const maintenance = @import("maintenance.zig");
const Allocator = std.mem.Allocator;

pub const Diagnostics = raw.Diagnostics;

pub const max_key_bytes = 4096;
pub const max_path_bytes = 4096;
pub const max_cursors = 64;
pub const max_bulk_entries = owned.max_entries;
pub const max_owned_value_bytes: usize = 1024 * 1024 * 1024;
pub const max_owned_batch_bytes: usize = 4 * 1024 * 1024 * 1024;

pub const Options = struct {
    create_if_missing: bool = true,
    error_if_exists: bool = false,
    cache_bytes: usize = 8 * 1024 * 1024,
    write_buffer_bytes: usize = 4 * 1024 * 1024,
    max_open_files: u32 = 1000,
    clear_max_entries: u64 = std.math.maxInt(u32),

    pub fn validate(options: *const Options) error{InvalidOptions}!void {
        if (options.cache_bytes > 1024 * 1024 * 1024 or
            options.write_buffer_bytes < 64 * 1024 or options.write_buffer_bytes > 1024 * 1024 * 1024 or
            options.max_open_files < 74 or options.max_open_files > 4096 or
            options.clear_max_entries > std.math.maxInt(u32)) return error.InvalidOptions;
    }
};
pub const Operation = struct { key: []const u8, value: ?[]const u8 };
pub const RangeOptions = ranges.Options;
/// Each key and value is allocated separately by readOwned.
pub const Entry = owned.Entry;
pub const WriteLimits = struct {
    max_value_bytes: usize,
    max_total_bytes: usize,
    max_entries: usize,
};
pub const Page = struct { count: usize, bytes: usize, done: bool };

pub const Database = struct {
    allocator: Allocator,
    inner: ?raw.DB,
    cache: raw.Cache,
    cursors: std.atomic.Value(u32) = .init(0),
    clear_max_entries: u64 = std.math.maxInt(u32),

    /// The host ensures one owner per physical directory, across path aliases, workers and other storage engines.
    /// POSIX process-scoped engine locks do not enforce this obligation between independent library copies.
    pub fn open(allocator: Allocator, path: [:0]const u8, options: Options, diagnostics: ?*Diagnostics) !Database {
        try checkPath(path);
        try options.validate();
        var raw_options = try raw.Options.create();
        defer raw_options.destroy();
        var cache = try raw.Cache.createLru(options.cache_bytes);
        errdefer cache.destroy();

        raw_options.setCache(&cache);
        raw_options.setCreateIfMissing(options.create_if_missing);
        raw_options.setErrorIfExists(options.error_if_exists);
        raw_options.setParanoidChecks(true);
        raw_options.setWriteBufferSize(options.write_buffer_bytes);
        raw_options.setMaxOpenFiles(@intCast(options.max_open_files));
        const db = try raw.DB.open(&raw_options, path, diagnostics);
        return .{
            .allocator = allocator,
            .inner = db,
            .cache = cache,
            .clear_max_entries = options.clear_max_entries,
        };
    }

    pub fn close(self: *Database) !void {
        if (self.inner == null) return;
        if (self.cursors.load(.monotonic) != 0) return error.CursorsOpen;
        self.inner.?.close();
        self.inner = null;
        self.cache.destroy();
    }

    /// Results must contain no live allocations. Caller frees non-null results with Database.allocator.
    /// On error, all initialized result slots are null and no result allocations remain.
    pub fn getManyOwned(
        self: *Database,
        keys: []const []const u8,
        results: []?[]const u8,
        value_limit: usize,
        total_limit: usize,
        fill_cache: bool,
        diagnostics: ?*Diagnostics,
    ) !void {
        if (results.len > max_bulk_entries) return error.BatchTooLarge;
        @memset(results, null);
        if (value_limit > max_owned_value_bytes or total_limit > max_owned_batch_bytes)
            return error.InvalidReadLimit;
        const db = try self.handle();
        try owned.getMany(db, self.allocator, keys, results, &.{
            .max_value_bytes = value_limit,
            .max_total_bytes = total_limit,
            .fill_cache = fill_cache,
        }, max_key_bytes, diagnostics);
    }

    /// The complete operation remains one atomic LevelDB batch, regardless of its configured limits.
    pub fn writeWithLimits(
        self: *Database,
        operations: []const Operation,
        sync: bool,
        limits: WriteLimits,
        diagnostics: ?*Diagnostics,
    ) !void {
        const db = try self.handle();
        if (limits.max_entries > max_bulk_entries or operations.len > limits.max_entries)
            return error.BatchTooLarge;
        if (limits.max_value_bytes > max_owned_value_bytes) return error.ValueTooLarge;
        if (limits.max_total_bytes > max_owned_batch_bytes) return error.BatchTooLarge;
        var total: usize = 0;
        for (operations) |operation| {
            try checkKey(operation.key);
            const value_len = if (operation.value) |value| value.len else 0;
            // LevelDB encodes each value length as a varint32.
            if (value_len > limits.max_value_bytes or value_len > std.math.maxInt(u32))
                return error.ValueTooLarge;
            const bytes = std.math.add(usize, operation.key.len, value_len) catch
                return error.BatchTooLarge;
            if (bytes > limits.max_total_bytes - total) return error.BatchTooLarge;
            total += bytes;
        }
        if (operations.len == 0) return;
        var batch = try raw.WriteBatch.create();
        defer batch.destroy();
        var options = try raw.WriteOptions.create();
        defer options.destroy();

        options.setSync(sync);
        for (operations) |operation| {
            if (operation.value) |value| batch.put(operation.key, value) else batch.delete(operation.key);
        }
        try db.write(&options, &batch, diagnostics);
    }

    /// Rejects the total entry bound before mutation. Engine errors may leave earlier chunks deleted.
    pub fn clear(self: *Database, diagnostics: ?*Diagnostics) !void {
        try maintenance.clear(try self.handle(), self.clear_max_entries, max_key_bytes, diagnostics);
    }

    /// Estimates persisted bytes in [start, end); recent writes may not be included.
    pub fn approximateSize(self: *Database, start: []const u8, end: []const u8) !u64 {
        try checkKey(start);
        try checkKey(end);
        return (try self.handle()).approximateSize(start, end);
    }

    /// The C API does not report compaction errors. Null endpoints request an unbounded endpoint.
    pub fn compactRange(self: *Database, start: ?[]const u8, end: ?[]const u8) !void {
        if (start) |key| try checkKey(key);
        if (end) |key| try checkKey(key);
        (try self.handle()).compactRange(start, end);
    }

    /// Caller frees a non-null result with Database.allocator.
    pub fn propertyValue(self: *Database, name: [:0]const u8) !?[]u8 {
        if (name.len > max_path_bytes or std.mem.findScalar(u8, name, 0) != null)
            return error.InvalidProperty;
        const value = (try (try self.handle()).propertyValue(name)) orelse return null;
        defer raw.free(value.ptr);
        return try maintenance.copyProperty(self.allocator, value);
    }

    /// Takes a snapshot now. The cursor must close before the database; its address need not be stable.
    pub fn cursor(self: *Database, range: RangeOptions, diagnostics: ?*Diagnostics) !Cursor {
        return Cursor.init(self, range, diagnostics);
    }

    fn handle(self: *Database) !*raw.DB {
        return if (self.inner) |*db| db else error.DatabaseClosed;
    }
};

pub const Cursor = @import("Cursor.zig");

/// All controllers for this physical directory must be closed, including other engine copies.
pub fn destroy(path: [:0]const u8, diagnostics: ?*Diagnostics) !void {
    try checkPath(path);
    var options = try raw.Options.create();
    defer options.destroy();
    try raw.destroyDB(&options, path, diagnostics);
}

fn checkPath(path: [:0]const u8) !void {
    if (path.len == 0 or path.len > max_path_bytes or std.mem.findScalar(u8, path, 0) != null)
        return error.InvalidPath;
}

fn checkKey(key: []const u8) !void {
    if (key.len > max_key_bytes) return error.KeyTooLarge;
}

test {
    _ = @import("root_test.zig");
}
