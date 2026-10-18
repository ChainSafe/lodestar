const std = @import("std");
const napi = @import("zapi:zapi").napi;
const leveldb = @import("leveldb");
const shared = @import("leveldb_shared.zig");
const runtime = @import("leveldb_runtime.zig");
const values = @import("leveldb_values.zig");
const allocator = std.heap.c_allocator;
const read_total_bytes_max = leveldb.max_owned_value_bytes;
const cursor_watermark_bytes = 16 * 1024;

pub const Job = struct {
    owner: *runtime.Runtime,
    next_read: ?*Job = null,
    operation: Operation,
    work: napi.AsyncWork(Job),
    callback: napi.Ref,
    retire_work: ?napi.AsyncWork(Job) = null,
    publication_error: ?napi.Ref = null,
    cursor_retired: bool = false,
    input: []u8,
    reservation: usize,
    failure: ?anyerror = null,
    diagnostics: leveldb.Diagnostics = .{},

    pub const Bounds = struct { start: []const u8, end: []const u8 };
    pub const Operation = union(enum) {
        open: struct { options: leveldb.Options, multithreading: bool },
        destroy,
        get_many: ReadMany,
        write: struct { operations: []leveldb.Operation = &.{}, sync: bool },
        cursor: struct { range: leveldb.RangeOptions = .{}, id: u32 = 0 },
        read_cursor: ReadCursor,
        seek_cursor: u32,
        close_cursor: u32,
        clear,
        approximate_size: struct { bounds: Bounds, bytes: u64 = 0 },
        compact_range: Bounds,
        property: ?[]u8,
    };
    pub const Kind = std.meta.Tag(Operation);

    const ReadMany = struct {
        keys: [][]const u8 = &.{},
        results: []?[]const u8 = &.{},
        fill_cache: bool,
    };
    const ReadCursor = struct {
        id: u32,
        entries: []leveldb.Entry = &.{},
        page: leveldb.Page = .{ .count = 0, .bytes = 0, .done = false },
    };

    pub fn create(owner: *runtime.Runtime, operation: *const Operation, input_bytes: usize, count: usize, callback_value: napi.Value) !*Job {
        std.debug.assert(count <= leveldb.max_bulk_entries);
        const metadata_bytes = count * switch (operation.*) {
            .get_many => @as(usize, @sizeOf([]const u8) + @sizeOf(?[]const u8)),
            .write => @sizeOf(leveldb.Operation),
            .read_cursor => @sizeOf(leveldb.Entry),
            else => blk: {
                std.debug.assert(count == 0);
                break :blk 0;
            },
        };
        const reservation = input_bytes + metadata_bytes;
        try owner.reserve(reservation, operation.* == .close_cursor);
        errdefer owner.release(reservation, operation.* == .close_cursor);

        const self = try allocator.create(Job);
        errdefer allocator.destroy(self);
        self.* = .{
            .owner = owner,
            .operation = operation.*,
            .work = undefined,
            .callback = undefined,
            .input = try allocator.alloc(u8, input_bytes),
            .reservation = reservation,
        };
        errdefer allocator.free(self.input);
        errdefer self.deinitOperation();
        try self.allocateMetadata(count);

        self.callback = try values.callback(callback_value);
        errdefer self.callback.delete() catch {};
        const name = try owner.env.createStringUtf8("LevelDb");
        self.work = try napi.AsyncWork(Job).create(owner.env, null, name, execute, complete, self);
        errdefer self.work.delete() catch {};
        if (self.operation == .cursor or self.operation == .read_cursor or self.operation == .seek_cursor) {
            self.retire_work = try napi.AsyncWork(Job).create(owner.env, null, name, retireExecute, retireComplete, self);
        }
        return self;
    }

    fn allocateMetadata(self: *Job, count: usize) !void {
        switch (self.operation) {
            .get_many => |*read| {
                read.keys = try allocator.alloc([]const u8, count);
                read.results = try allocator.alloc(?[]const u8, count);
                @memset(read.results, null);
            },
            .write => |*write| write.operations = try allocator.alloc(leveldb.Operation, count),
            .read_cursor => |*read| read.entries = try allocator.alloc(leveldb.Entry, count),
            else => {},
        }
    }

    fn deinitOperation(self: *Job) void {
        switch (self.operation) {
            .get_many => |read| {
                for (read.results) |result| if (result) |bytes| allocator.free(bytes);
                allocator.free(read.results);
                allocator.free(read.keys);
            },
            .write => |write| allocator.free(write.operations),
            .read_cursor => |read| {
                for (read.entries[0..read.page.count]) |entry| {
                    allocator.free(entry.key);
                    allocator.free(entry.value);
                }
                allocator.free(read.entries);
            },
            .property => |result| if (result) |bytes| allocator.free(bytes),
            else => {},
        }
    }

    pub fn destroy(self: *Job) void {
        self.work.delete() catch {};
        self.callback.delete() catch {};
        if (self.retire_work) |work| work.delete() catch {};
        if (self.publication_error) |reference| reference.delete() catch {};
        self.owner.release(self.reservation, self.operation == .close_cursor);
        self.deinitOperation();
        self.diagnostics.deinit();
        allocator.free(self.input);
        allocator.destroy(self);
    }

    pub fn cursorId(self: *const Job) u32 {
        return switch (self.operation) {
            .cursor => |cursor| cursor.id,
            .read_cursor => |read| read.id,
            .seek_cursor, .close_cursor => |id| id,
            else => unreachable,
        };
    }

    fn execute(_: napi.Env, self: *Job) void {
        self.run() catch |err| {
            self.failure = err;
        };
    }

    fn run(self: *Job) !void {
        const owner = self.owner;
        switch (self.operation) {
            .open => |open| {
                std.debug.assert(owner.database == null);
                owner.database = try shared.Database.open(self.input[0 .. self.input.len - 1 :0], open.options, open.multithreading, &self.diagnostics);
                return;
            },
            .destroy => return shared.destroy(self.input[0 .. self.input.len - 1 :0], &self.diagnostics),
            else => {},
        }
        const database = if (owner.database) |db| &db.database else return error.DatabaseClosed;
        switch (self.operation) {
            .open, .destroy => unreachable,
            .clear => try database.clear(&self.diagnostics),
            .approximate_size => |*estimate| estimate.bytes = try database.approximateSize(estimate.bounds.start, estimate.bounds.end),
            .compact_range => |bounds| try database.compactRange(bounds.start, bounds.end),
            .property => |*result| result.* = try database.propertyValue(self.input[0 .. self.input.len - 1 :0]),
            .get_many => |read| try database.getManyOwned(read.keys, read.results, leveldb.max_owned_value_bytes, read_total_bytes_max, read.fill_cache, &self.diagnostics),
            .write => |write| try database.writeWithLimits(write.operations, write.sync, .{
                .max_value_bytes = leveldb.max_owned_value_bytes,
                .max_total_bytes = leveldb.max_owned_batch_bytes,
                .max_entries = leveldb.max_bulk_entries,
            }, &self.diagnostics),
            .cursor => |*cursor| try self.openCursor(database, &cursor.id, &cursor.range),
            .read_cursor => |*read| try self.readCursor(read),
            .seek_cursor => try self.seekCursor(),
            .close_cursor => self.retireCursor(),
        }
    }

    fn openCursor(self: *Job, database: *leveldb.Database, id: *u32, range: *const leveldb.RangeOptions) !void {
        if (self.owner.next_cursor_id == std.math.maxInt(u32)) return error.CursorCapacity;
        for (&self.owner.cursors) |*slot| {
            if (slot.cursor != null) continue;
            slot.cursor = try database.cursor(range.*, &self.diagnostics);
            self.owner.next_cursor_id += 1;
            slot.id = self.owner.next_cursor_id;
            id.* = slot.id;
            return;
        }
        return error.CursorCapacity;
    }

    fn seekCursor(self: *Job) !void {
        const slot = self.owner.findCursor(self.cursorId()) orelse {
            self.cursor_retired = true;
            return error.CursorClosed;
        };
        slot.cursor.?.seek(self.input, &self.diagnostics) catch |err| {
            self.retireCursor();
            return err;
        };
    }

    fn readCursor(self: *Job, read: *ReadCursor) !void {
        const slot = self.owner.findCursor(read.id) orelse {
            self.cursor_retired = true;
            return error.CursorClosed;
        };
        read.page = slot.cursor.?.readOwned(read.entries, leveldb.max_owned_value_bytes, read_total_bytes_max, cursor_watermark_bytes, &self.diagnostics) catch |err| {
            self.retireCursor();
            return err;
        };
    }

    fn retireCursor(self: *Job) void {
        if (self.owner.findCursor(self.cursorId())) |slot| {
            slot.cursor.?.close();
            slot.cursor = null;
        }
        self.cursor_retired = true;
    }

    fn complete(env: napi.Env, status: napi.status.Status, self: *Job) void {
        const owner = self.owner;
        if (status != .ok and self.failure == null) self.failure = error.Cancelled;
        owner.syncCursor(self);
        if (owner.env_alive) {
            const finished = self.settle(env) catch |err| blk: {
                owner.deliveryFailure(err);
                break :blk true;
            };
            if (!finished) return;
        }
        owner.finish(self);
    }

    pub fn settle(self: *Job, env: napi.Env) !bool {
        if (self.failure) |err| {
            try self.reject(env, err);
            return true;
        }
        const result = self.buildResult(env) catch |err| {
            if ((self.operation == .cursor or self.operation == .read_cursor or self.operation == .seek_cursor) and !self.cursor_retired) {
                return self.retireUnpublished(env, err);
            }
            try self.reject(env, err);
            return true;
        };
        try values.notify(env, self.callback, null, result);
        return true;
    }

    fn retireUnpublished(self: *Job, env: napi.Env, err: anyerror) !bool {
        const reason = try values.failureReason(env, self.owner.fallback_error.?, err, null);
        self.publication_error = env.createReference(reason, 1) catch blk: {
            if (try env.isExceptionPending()) _ = try env.getAndClearLastException();
            break :blk null;
        };
        self.retire_work.?.queue() catch {
            retireExecute(env, self);
            self.owner.syncCursor(self);
            try self.rejectPublication(env);
            return true;
        };
        return false;
    }

    fn retireExecute(_: napi.Env, self: *Job) void {
        self.retireCursor();
    }

    fn retireComplete(env: napi.Env, status: napi.status.Status, self: *Job) void {
        const owner = self.owner;
        if (status != .ok) {
            retireExecute(env, self);
        }
        owner.syncCursor(self);
        if (owner.env_alive) self.rejectPublication(env) catch |err| owner.deliveryFailure(err);
        owner.finish(self);
    }

    fn rejectPublication(self: *Job, env: napi.Env) !void {
        const reference = self.publication_error orelse self.owner.fallback_error.?;
        try values.notify(env, self.callback, try reference.getValue(), try env.getUndefined());
    }

    fn reject(self: *Job, env: napi.Env, err: anyerror) !void {
        const reason = try values.failureReason(env, self.owner.fallback_error.?, err, self.diagnostics.message);
        try values.notify(env, self.callback, reason, try env.getUndefined());
    }

    fn buildResult(self: *const Job, env: napi.Env) !napi.Value {
        return switch (self.operation) {
            .open, .destroy, .write, .seek_cursor, .close_cursor, .clear, .compact_range => env.getUndefined(),
            .approximate_size => |estimate| env.createDouble(@floatFromInt(estimate.bytes)),
            .property => |result| if (result) |text| env.createStringUtf8(text) else env.getNull(),
            .cursor => |cursor| env.createUint32(cursor.id),
            .get_many => |read| blk: {
                const result = try env.createArrayWithLength(read.results.len);
                for (read.results, 0..) |item, index| {
                    const value = if (item) |data| try copyBytes(env, data) else try env.getNull();
                    try result.setElement(@intCast(index), value);
                }
                break :blk result;
            },
            .read_cursor => |*read| pageResult(env, read),
        };
    }

    fn pageResult(env: napi.Env, read: *const ReadCursor) !napi.Value {
        const result = try env.createObject();
        const entries = try env.createArrayWithLength(read.page.count);
        for (read.entries[0..read.page.count], 0..) |entry, index| {
            const item = try env.createObject();
            try item.setNamedProperty("key", try copyBytes(env, entry.key));
            try item.setNamedProperty("value", try copyBytes(env, entry.value));
            try entries.setElement(@intCast(index), item);
        }
        try result.setNamedProperty("entries", entries);
        try result.setNamedProperty("done", try env.getBoolean(read.page.done));
        return result;
    }
};

fn copyBytes(env: napi.Env, bytes: []const u8) !napi.Value {
    const buffer = try env.createArrayBufferCopy(bytes, null);
    return env.createTypedarray(.uint8, bytes.len, buffer, 0);
}
