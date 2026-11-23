const std = @import("std");
const napi = @import("zapi:zapi").napi;
const leveldb = @import("leveldb");
const shared = @import("leveldb_shared.zig");
const values = @import("leveldb_values.zig");
const Job = @import("leveldb_job.zig").Job;
const allocator = std.heap.c_allocator;
const queue_capacity = values.pending_operations_max + leveldb.max_cursors;
const read_concurrency = 2;

pub const CursorSlot = struct { id: u32 = 0, cursor: ?leveldb.Cursor = null };
pub const KnownCursor = struct { id: u32 = 0, closing: bool = false };

/// The JS thread owns admission and lifetime fields. Reads overlap the serialized write/cursor queue.
pub const Runtime = struct {
    env: napi.Env,
    database: ?*shared.Database = null,
    cursors: [leveldb.max_cursors]CursorSlot = @splat(.{}),
    next_cursor_id: u32 = 0,
    known_cursors: [leveldb.max_cursors]KnownCursor = @splat(.{}),
    queue: [queue_capacity]*Job = undefined,
    queue_length: usize = 0,
    queue_head: usize = 0,
    pending_operations: usize = 0,
    pending_cursor_closes: usize = 0,
    pending_bytes: usize = 0,
    operation_limit: usize,
    byte_limit: usize,
    active: bool = false,
    active_reads: usize = 0,
    reads_head: ?*Job = null,
    reads_tail: ?*Job = null,
    closing: bool = false,
    cleanup_started: bool = false,
    cleanup_finished: bool = false,
    finishing_cleanup: bool = false,
    wrapper_alive: bool = true,
    env_alive: bool = true,
    cleanup_work: napi.AsyncWork(Runtime),
    cleanup_hook: ?napi.c.napi_async_cleanup_hook_handle = null,
    close_callbacks: [leveldb.max_cursors + 1]napi.Ref = undefined,
    close_callback_count: usize = 0,
    fallback_error: ?napi.Ref = null,

    pub fn create(env: napi.Env, operation_limit: usize, byte_limit: usize) !*Runtime {
        std.debug.assert(operation_limit > 0 and operation_limit <= values.pending_operations_max);
        std.debug.assert(byte_limit > 0 and byte_limit <= values.pending_bytes_max);
        const self = try allocator.create(Runtime);
        errdefer allocator.destroy(self);
        self.* = .{ .env = env, .operation_limit = operation_limit, .byte_limit = byte_limit, .cleanup_work = undefined };
        self.fallback_error = try env.createReference(try values.completionFailure(env), 1);
        errdefer self.fallback_error.?.delete() catch {};
        self.cleanup_work = try napi.AsyncWork(Runtime).create(env, null, try env.createStringUtf8("LevelDb.close"), cleanupExecute, cleanupComplete, self);
        errdefer self.cleanup_work.delete() catch {};
        self.cleanup_hook = try env.addAsyncCleanupHook(Runtime, self, environmentCleanup);
        return self;
    }

    pub fn destroyPrepared(self: *Runtime) void {
        std.debug.assert(self.queue_length == 0 and self.pending_operations == 0 and self.active_reads == 0);
        std.debug.assert(self.database == null);
        if (self.cleanup_hook) |hook| self.env.removeAsyncCleanupHook(hook) catch {};
        self.cleanup_work.delete() catch {};
        self.fallback_error.?.delete() catch {};
        allocator.destroy(self);
    }

    pub fn reserve(self: *Runtime, amount: usize, cursor_close: bool) !void {
        if (self.closing) return error.DatabaseClosed;
        if (cursor_close) {
            std.debug.assert(amount == 0);
            if (self.pending_cursor_closes == leveldb.max_cursors) return error.PendingOperationsExceeded;
            self.pending_cursor_closes += 1;
            return;
        }
        if (self.pending_operations == self.operation_limit) return error.PendingOperationsExceeded;
        if (amount > self.byte_limit - self.pending_bytes) return error.PendingBytesExceeded;
        self.pending_operations += 1;
        self.pending_bytes += amount;
    }

    pub fn release(self: *Runtime, amount: usize, cursor_close: bool) void {
        if (cursor_close) {
            std.debug.assert(self.pending_cursor_closes > 0 and amount == 0);
            self.pending_cursor_closes -= 1;
            return;
        }
        std.debug.assert(self.pending_operations > 0 and self.pending_bytes >= amount);
        self.pending_operations -= 1;
        self.pending_bytes -= amount;
    }

    pub fn enqueue(self: *Runtime, job: *Job) !void {
        if (job.operation == .get_many) {
            if (self.active_reads < read_concurrency and self.reads_head == null and
                !(self.active and self.queued(0).operation == .open))
            {
                try job.work.queue();
                self.active_reads += 1;
            } else {
                if (self.reads_tail) |tail| tail.next_read = job else self.reads_head = job;
                self.reads_tail = job;
            }
            return;
        }
        std.debug.assert(self.queue_length < self.queue.len);
        if (self.queue_length == 0) {
            try job.work.queue();
            self.active = true;
        }
        self.queue[(self.queue_head + self.queue_length) % self.queue.len] = job;
        self.queue_length += 1;
    }

    fn queued(self: *const Runtime, index: usize) *Job {
        std.debug.assert(index < self.queue_length);
        return self.queue[(self.queue_head + index) % self.queue.len];
    }

    pub fn finish(self: *Runtime, job: *Job) void {
        if (job.operation == .get_many) {
            std.debug.assert(self.active_reads > 0);
            self.active_reads -= 1;
            job.destroy();
            self.pumpReads();
            if (!self.active) self.pump();
            return;
        }
        std.debug.assert(self.active and self.queue_length > 0 and self.queued(0) == job);
        self.removeFirst();
        self.active = false;
        self.pumpReads();
        self.pump();
    }

    fn popRead(self: *Runtime) ?*Job {
        const job = self.reads_head orelse return null;
        self.reads_head = job.next_read;
        if (self.reads_head == null) self.reads_tail = null;
        job.next_read = null;
        return job;
    }

    fn pumpReads(self: *Runtime) void {
        for (0..queue_capacity) |_| {
            if (self.active_reads == read_concurrency) return;
            const job = self.popRead() orelse return;
            self.active_reads += 1;
            job.work.queue() catch |err| {
                job.failure = err;
                if (self.env_alive) {
                    _ = job.settle(self.env) catch |failure| blk: {
                        self.deliveryFailure(failure);
                        break :blk true;
                    };
                }
                self.active_reads -= 1;
                job.destroy();
            };
        }
        std.debug.assert(self.reads_head == null);
    }

    fn removeFirst(self: *Runtime) void {
        const job = self.queued(0);
        self.queue_length -= 1;
        self.queue_head = (self.queue_head + 1) % self.queue.len;
        job.destroy();
    }

    fn pump(self: *Runtime) void {
        std.debug.assert(!self.active);
        for (0..queue_capacity) |_| {
            if (self.queue_length == 0) break;
            const job = self.queued(0);
            job.work.queue() catch |err| {
                job.failure = err;
                self.active = true;
                self.syncCursor(job);
                if (self.env_alive) {
                    _ = job.settle(self.env) catch |failure| blk: {
                        self.deliveryFailure(failure);
                        break :blk true;
                    };
                }
                self.removeFirst();
                self.active = false;
                continue;
            };
            self.active = true;
            return;
        }
        std.debug.assert(self.queue_length == 0);
        if (self.closing and self.active_reads == 0 and !self.cleanup_started) self.startCleanup();
    }

    pub fn close(self: *Runtime, callback_value: napi.Value) !void {
        if (self.close_callback_count == self.close_callbacks.len) return error.PendingOperationsExceeded;
        const reference = try values.callback(callback_value);
        if (self.cleanup_finished) {
            defer reference.delete() catch {};
            try values.notify(self.env, reference, null, try self.env.getUndefined());
            return;
        }
        self.close_callbacks[self.close_callback_count] = reference;
        self.close_callback_count += 1;
        self.closing = true;
        if (!self.active) self.pump();
    }

    pub fn abandon(self: *Runtime) void {
        self.wrapper_alive = false;
        if (self.cleanup_finished) {
            if (!self.finishing_cleanup) self.destroy();
            return;
        }
        self.closing = true;
        if (!self.active) self.pump();
    }

    fn environmentCleanup(_: napi.c.napi_async_cleanup_hook_handle, self: *Runtime) void {
        self.env_alive = false;
        self.closing = true;
        const keep: usize = if (self.active) 1 else 0;
        for (keep..self.queue_length) |index| self.queued(index).destroy();
        self.queue_length = keep;
        for (0..queue_capacity) |_| {
            const job = self.popRead() orelse break;
            job.destroy();
        }
        std.debug.assert(self.reads_head == null);
        if (!self.active and self.active_reads == 0 and !self.cleanup_started) self.startCleanup();
    }

    fn startCleanup(self: *Runtime) void {
        std.debug.assert(self.closing and !self.active and self.active_reads == 0);
        std.debug.assert(self.queue_length == 0 and self.reads_head == null);
        self.cleanup_started = true;
        self.cleanup_work.queue() catch {
            cleanupExecute(self.env, self);
            cleanupComplete(self.env, .ok, self);
        };
    }

    fn cleanupExecute(_: napi.Env, self: *Runtime) void {
        for (&self.cursors) |*slot| {
            if (slot.cursor) |*cursor| cursor.close();
            slot.cursor = null;
        }
        if (self.database) |database| {
            database.release();
            self.database = null;
        }
    }

    fn cleanupComplete(_: napi.Env, status: napi.status.Status, self: *Runtime) void {
        if (status != .ok) {
            cleanupExecute(self.env, self);
        }
        self.cleanup_finished = true;
        // Settling callbacks can collect the wrapper; keep the runtime through reference and hook cleanup.
        self.finishing_cleanup = true;
        self.cleanup_work.delete() catch {};
        self.settleClose();
        if (self.fallback_error) |reference| reference.delete() catch {};
        self.fallback_error = null;
        if (self.cleanup_hook) |hook| self.env.removeAsyncCleanupHook(hook) catch {};
        self.cleanup_hook = null;
        self.finishing_cleanup = false;
        if (!self.wrapper_alive) self.destroy();
    }

    fn settleClose(self: *Runtime) void {
        for (self.close_callbacks[0..self.close_callback_count]) |reference| {
            defer reference.delete() catch {};
            if (self.env_alive) self.notifyClose(reference) catch |err| self.deliveryFailure(err);
        }
        self.close_callback_count = 0;
    }

    fn notifyClose(self: *Runtime, reference: napi.Ref) !void {
        try values.notify(self.env, reference, null, try self.env.getUndefined());
    }

    pub fn deliveryFailure(self: *Runtime, err: anyerror) void {
        self.closing = true;
        if (err == error.CannotRunJS or err == error.Closing) return;
        if (err == error.PendingException and !(self.env.isExceptionPending() catch true)) return;
        self.env.fatalError("LevelDb completion", "Cannot deliver a completion to a live JavaScript environment");
    }

    fn destroy(self: *Runtime) void {
        std.debug.assert(self.cleanup_finished and !self.wrapper_alive);
        std.debug.assert(self.queue_length == 0 and self.reads_head == null and self.active_reads == 0);
        std.debug.assert(self.pending_bytes == 0);
        std.debug.assert(self.close_callback_count == 0 and self.fallback_error == null);
        allocator.destroy(self);
    }

    pub fn knownCursor(self: *Runtime, id: u32) ?*KnownCursor {
        for (&self.known_cursors) |*cursor| {
            if (cursor.id == id) return cursor;
        }
        return null;
    }

    pub fn syncCursor(self: *Runtime, job: *const Job) void {
        if (job.operation == .close_cursor and job.failure != null and !job.cursor_retired) {
            if (self.knownCursor(job.cursorId())) |cursor| cursor.closing = false;
        }
        if (job.operation == .cursor and job.failure == null and !job.cursor_retired) {
            for (&self.known_cursors) |*cursor| {
                if (cursor.id != 0) continue;
                cursor.* = .{ .id = job.cursorId() };
                return;
            }
            unreachable;
        }
        if (!job.cursor_retired) return;
        if (self.knownCursor(job.cursorId())) |cursor| cursor.* = .{};
        self.settleRetiredCloses(job.cursorId());
    }

    fn settleRetiredCloses(self: *Runtime, id: u32) void {
        var index: usize = 1;
        for (0..queue_capacity) |_| {
            if (index >= self.queue_length) return;
            const job = self.queued(index);
            if (job.operation != .close_cursor or job.cursorId() != id) {
                index += 1;
                continue;
            }
            self.queue_length -= 1;
            for (index..self.queue_length) |position| {
                self.queue[(self.queue_head + position) % self.queue.len] =
                    self.queue[(self.queue_head + position + 1) % self.queue.len];
            }
            if (self.env_alive) {
                _ = job.settle(self.env) catch |err| blk: {
                    self.deliveryFailure(err);
                    break :blk true;
                };
            }
            job.destroy();
        }
        std.debug.assert(index >= self.queue_length);
    }

    pub fn findCursor(self: *Runtime, id: u32) ?*CursorSlot {
        for (&self.cursors) |*slot| {
            if (slot.id == id and slot.cursor != null) return slot;
        }
        return null;
    }
};
