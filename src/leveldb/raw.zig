//! Core ChainSafe LevelDB bindings. Handles have one owner and must be destroyed once.
//! Callers bound keys, values, batch sizes, and traversal work before entering this API.
//! Constructors report null C handles as OutOfMemory; C++ allocation failure can still abort.
const std = @import("std");
const leveldb = @cImport({
    @cInclude("leveldb/c.h");
});

pub const Error = error{
    Corruption,
    NotImplemented,
    InvalidArgument,
    IOError,
    Unknown,
    OutOfMemory,
};

/// Owns the most recently captured engine error. Keep one per operation and call deinit after consuming it.
pub const Diagnostics = struct {
    message: ?[:0]const u8 = null,

    pub fn deinit(self: *Diagnostics) void {
        if (self.message) |message| free(message.ptr);
        self.message = null;
    }

    pub fn format(self: *Diagnostics, comptime fmt: []const u8, args: anytype) void {
        self.deinit();
        self.message = std.fmt.allocPrintSentinel(std.heap.c_allocator, fmt, args, 0) catch null;
    }
};

fn handleError(errptr: ?[*:0]u8, diagnostics: ?*Diagnostics) Error!void {
    if (errptr) |state| {
        const msg = std.mem.span(state);
        if (diagnostics) |output| {
            output.deinit();
            output.message = msg;
        }
        defer if (diagnostics == null) leveldb.leveldb_free(state);
        if (std.mem.startsWith(u8, msg, "Corruption")) {
            return error.Corruption;
        } else if (std.mem.startsWith(u8, msg, "Not implemented")) {
            return error.NotImplemented;
        } else if (std.mem.startsWith(u8, msg, "Invalid argument")) {
            return error.InvalidArgument;
        } else if (std.mem.startsWith(u8, msg, "IO error")) {
            return error.IOError;
        } else {
            return error.Unknown;
        }
    }
}

pub const DB = struct {
    inner: *leveldb.leveldb_t,

    pub fn open(options: *Options, name: [:0]const u8, diagnostics: ?*Diagnostics) Error!DB {
        var errptr: ?[*:0]u8 = null;
        const db = leveldb.leveldb_open(
            options.inner,
            name.ptr,
            @ptrCast(&errptr),
        );
        try handleError(errptr, diagnostics);
        return DB{ .inner = db orelse return error.OutOfMemory };
    }

    /// Destroy all iterators and release all snapshots before closing.
    pub fn close(db: *DB) void {
        leveldb.leveldb_close(db.inner);
    }

    pub fn put(db: *DB, options: *WriteOptions, key: []const u8, val: []const u8, diagnostics: ?*Diagnostics) Error!void {
        var errptr: ?[*:0]u8 = null;
        leveldb.leveldb_put(
            db.inner,
            options.inner,
            key.ptr,
            key.len,
            val.ptr,
            val.len,
            @ptrCast(&errptr),
        );
        try handleError(errptr, diagnostics);
    }

    pub fn delete(db: *DB, options: *WriteOptions, key: []const u8, diagnostics: ?*Diagnostics) Error!void {
        var errptr: ?[*:0]u8 = null;
        leveldb.leveldb_delete(
            db.inner,
            options.inner,
            key.ptr,
            key.len,
            @ptrCast(&errptr),
        );
        try handleError(errptr, diagnostics);
    }

    pub fn write(db: *DB, options: *WriteOptions, batch: *WriteBatch, diagnostics: ?*Diagnostics) Error!void {
        var errptr: ?[*:0]u8 = null;
        leveldb.leveldb_write(
            db.inner,
            options.inner,
            batch.inner,
            @ptrCast(&errptr),
        );
        try handleError(errptr, diagnostics);
    }

    /// Returns C-owned bytes. Free them with `free(value.ptr)`, including empty values.
    /// The C API allocates the complete stored value before returning its length.
    pub fn get(db: *DB, options: *ReadOptions, key: []const u8, diagnostics: ?*Diagnostics) Error!?[]const u8 {
        var vallen: usize = undefined;
        var errptr: ?[*:0]u8 = null;
        const val = leveldb.leveldb_get(
            db.inner,
            options.inner,
            key.ptr,
            key.len,
            &vallen,
            @ptrCast(&errptr),
        );
        errdefer if (val != null) leveldb.leveldb_free(val);
        try handleError(errptr, diagnostics);
        if (val == null) return null;
        return val[0..vallen];
    }

    pub fn createIterator(db: *DB, options: *ReadOptions) Error!Iterator {
        return Iterator{
            .inner = leveldb.leveldb_create_iterator(
                db.inner,
                options.inner,
            ) orelse return error.OutOfMemory,
        };
    }

    pub fn createSnapshot(db: *DB) Error!Snapshot {
        return Snapshot{
            .inner = leveldb.leveldb_create_snapshot(db.inner) orelse return error.OutOfMemory,
        };
    }

    /// Release only after all reads and iterators using this snapshot have finished.
    pub fn releaseSnapshot(db: *DB, snapshot: *Snapshot) void {
        leveldb.leveldb_release_snapshot(db.inner, snapshot.inner);
    }

    /// Free a returned slice with `free(value.ptr)`.
    pub fn propertyValue(db: *DB, propname: [:0]const u8) Error!?[]u8 {
        const val = leveldb.leveldb_property_value(
            db.inner,
            propname.ptr,
        );
        if (val == null) return null;
        const len = std.mem.len(val);
        return val[0..len];
    }

    pub fn approximateSize(db: *DB, start: []const u8, limit: []const u8) u64 {
        const starts = [_][*c]const u8{start.ptr};
        const start_lengths = [_]usize{start.len};
        const limits = [_][*c]const u8{limit.ptr};
        const limit_lengths = [_]usize{limit.len};
        var size: u64 = 0;
        leveldb.leveldb_approximate_sizes(
            db.inner,
            1,
            &starts,
            &start_lengths,
            &limits,
            &limit_lengths,
            &size,
        );
        return size;
    }

    pub fn compactRange(db: *DB, start: ?[]const u8, limit: ?[]const u8) void {
        const start_ptr = if (start) |s| s.ptr else null;
        const start_len = if (start) |s| s.len else 0;
        const limit_ptr = if (limit) |l| l.ptr else null;
        const limit_len = if (limit) |l| l.len else 0;
        leveldb.leveldb_compact_range(
            db.inner,
            start_ptr,
            start_len,
            limit_ptr,
            limit_len,
        );
    }
};

/// A cache must outlive every database opened with it. Capacity is not a process memory cap.
pub const Cache = struct {
    inner: *leveldb.leveldb_cache_t,

    pub fn createLru(capacity: usize) Error!Cache {
        return Cache{
            .inner = leveldb.leveldb_cache_create_lru(capacity) orelse return error.OutOfMemory,
        };
    }

    pub fn destroy(cache: *Cache) void {
        leveldb.leveldb_cache_destroy(cache.inner);
    }
};

/// Keys and values are borrowed until the iterator moves or is destroyed.
/// Call `getError` after seeking or exhausting traversal; invalid does not imply end of data.
pub const Iterator = extern struct {
    inner: *leveldb.leveldb_iterator_t,

    pub fn destroy(iter: *Iterator) void {
        leveldb.leveldb_iter_destroy(iter.inner);
    }

    pub fn valid(iter: *const Iterator) bool {
        return leveldb.leveldb_iter_valid(iter.inner) != 0;
    }

    pub fn seekToFirst(iter: *Iterator) void {
        leveldb.leveldb_iter_seek_to_first(iter.inner);
    }

    pub fn seekToLast(iter: *Iterator) void {
        leveldb.leveldb_iter_seek_to_last(iter.inner);
    }

    pub fn seek(iter: *Iterator, k: []const u8) void {
        leveldb.leveldb_iter_seek(
            iter.inner,
            k.ptr,
            k.len,
        );
    }

    pub fn next(iter: *Iterator) void {
        std.debug.assert(iter.valid());
        leveldb.leveldb_iter_next(iter.inner);
    }

    pub fn prev(iter: *Iterator) void {
        std.debug.assert(iter.valid());
        leveldb.leveldb_iter_prev(iter.inner);
    }

    pub fn key(iter: *const Iterator) []const u8 {
        std.debug.assert(iter.valid());
        var klen: usize = undefined;
        const key_ptr = leveldb.leveldb_iter_key(iter.inner, &klen);
        return key_ptr[0..klen];
    }

    pub fn value(iter: *const Iterator) []const u8 {
        std.debug.assert(iter.valid());
        var vlen: usize = undefined;
        const val_ptr = leveldb.leveldb_iter_value(iter.inner, &vlen);
        return val_ptr[0..vlen];
    }

    pub fn getError(iter: *const Iterator, diagnostics: ?*Diagnostics) Error!void {
        var errptr: ?[*:0]u8 = null;
        leveldb.leveldb_iter_get_error(iter.inner, @ptrCast(&errptr));
        try handleError(errptr, diagnostics);
    }
};

pub const Options = extern struct {
    inner: *leveldb.leveldb_options_t,

    pub fn create() Error!Options {
        return Options{
            .inner = leveldb.leveldb_options_create() orelse return error.OutOfMemory,
        };
    }

    pub fn destroy(options: *Options) void {
        leveldb.leveldb_options_destroy(options.inner);
    }

    pub fn setCreateIfMissing(options: *Options, value: bool) void {
        leveldb.leveldb_options_set_create_if_missing(options.inner, if (value) 1 else 0);
    }

    pub fn setErrorIfExists(options: *Options, value: bool) void {
        leveldb.leveldb_options_set_error_if_exists(options.inner, if (value) 1 else 0);
    }

    pub fn setParanoidChecks(options: *Options, value: bool) void {
        leveldb.leveldb_options_set_paranoid_checks(options.inner, if (value) 1 else 0);
    }

    pub fn setWriteBufferSize(options: *Options, size: usize) void {
        leveldb.leveldb_options_set_write_buffer_size(options.inner, size);
    }

    pub fn setMaxOpenFiles(options: *Options, count: c_int) void {
        leveldb.leveldb_options_set_max_open_files(options.inner, count);
    }

    pub fn setCache(options: *Options, cache: *Cache) void {
        leveldb.leveldb_options_set_cache(options.inner, cache.inner);
    }

    pub fn setBlockSize(options: *Options, size: usize) void {
        leveldb.leveldb_options_set_block_size(options.inner, size);
    }

    pub fn setBlockRestartInterval(options: *Options, interval: c_int) void {
        leveldb.leveldb_options_set_block_restart_interval(options.inner, interval);
    }

    pub fn setMaxFileSize(options: *Options, size: usize) void {
        leveldb.leveldb_options_set_max_file_size(options.inner, size);
    }

    pub fn setCompression(options: *Options, compression: c_int) void {
        leveldb.leveldb_options_set_compression(options.inner, compression);
    }
};

pub const ReadOptions = extern struct {
    inner: *leveldb.leveldb_readoptions_t,

    pub fn create() Error!ReadOptions {
        return ReadOptions{
            .inner = leveldb.leveldb_readoptions_create() orelse return error.OutOfMemory,
        };
    }

    pub fn destroy(options: *ReadOptions) void {
        leveldb.leveldb_readoptions_destroy(options.inner);
    }

    pub fn setVerifyChecksums(options: *ReadOptions, value: bool) void {
        leveldb.leveldb_readoptions_set_verify_checksums(options.inner, if (value) 1 else 0);
    }

    pub fn setFillCache(options: *ReadOptions, value: bool) void {
        leveldb.leveldb_readoptions_set_fill_cache(options.inner, if (value) 1 else 0);
    }

    /// The snapshot must belong to the database being read and remain live during reads.
    pub fn setSnapshot(options: *ReadOptions, snapshot: *const Snapshot) void {
        leveldb.leveldb_readoptions_set_snapshot(options.inner, snapshot.inner);
    }
};

pub const Snapshot = extern struct {
    inner: *const leveldb.leveldb_snapshot_t,
};

pub const WriteBatch = extern struct {
    inner: *leveldb.leveldb_writebatch_t,

    pub fn create() Error!WriteBatch {
        return WriteBatch{
            .inner = leveldb.leveldb_writebatch_create() orelse return error.OutOfMemory,
        };
    }

    pub fn destroy(batch: *WriteBatch) void {
        leveldb.leveldb_writebatch_destroy(batch.inner);
    }

    pub fn clear(batch: *WriteBatch) void {
        leveldb.leveldb_writebatch_clear(batch.inner);
    }

    pub fn put(batch: *WriteBatch, key: []const u8, val: []const u8) void {
        leveldb.leveldb_writebatch_put(
            batch.inner,
            key.ptr,
            key.len,
            @as([*c]const u8, @ptrCast(val.ptr)),
            val.len,
        );
    }

    pub fn delete(batch: *WriteBatch, key: []const u8) void {
        leveldb.leveldb_writebatch_delete(
            batch.inner,
            key.ptr,
            key.len,
        );
    }
};

pub const WriteOptions = extern struct {
    inner: *leveldb.leveldb_writeoptions_t,

    pub fn create() Error!WriteOptions {
        return WriteOptions{
            .inner = leveldb.leveldb_writeoptions_create() orelse return error.OutOfMemory,
        };
    }

    pub fn destroy(options: *WriteOptions) void {
        leveldb.leveldb_writeoptions_destroy(options.inner);
    }

    pub fn setSync(options: *WriteOptions, value: bool) void {
        leveldb.leveldb_writeoptions_set_sync(options.inner, if (value) 1 else 0);
    }
};

pub fn destroyDB(options: *Options, name: [:0]const u8, diagnostics: ?*Diagnostics) Error!void {
    var errptr: ?[*:0]u8 = null;
    leveldb.leveldb_destroy_db(options.inner, name.ptr, @ptrCast(&errptr));
    try handleError(errptr, diagnostics);
}

pub fn free(ptr: [*]const u8) void {
    leveldb.leveldb_free(@ptrCast(@constCast(ptr)));
}

pub fn majorVersion() c_int {
    return leveldb.leveldb_major_version();
}

pub fn minorVersion() c_int {
    return leveldb.leveldb_minor_version();
}

test {
    _ = @import("raw_test.zig");
}
