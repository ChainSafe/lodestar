const std = @import("std");
const zapi = @import("zapi:zapi");
const js = zapi.js;
const napi = zapi.napi;
const leveldb = @import("leveldb");
const Runtime = @import("leveldb_runtime.zig").Runtime;
const Job = @import("leveldb_job.zig").Job;
const v = @import("leveldb_values.zig");

pub const js_meta = js.class(.{});

runtime: ?*Runtime = null,
entered: bool = false,

pub fn init() @This() {
    return .{};
}

pub fn deinit(self: *@This()) void {
    if (self.runtime) |runtime| runtime.abandon();
    self.runtime = null;
}

fn enter(self: *@This()) !void {
    if (self.entered) return error.LevelDbReentered;
    self.entered = true;
}

fn owner(self: *@This()) !*Runtime {
    const runtime = self.runtime orelse return error.DatabaseClosed;
    if (runtime.closing) return error.DatabaseClosed;
    return runtime;
}

pub fn open(self: *@This(), path_value: js.Value, options_value: js.Value, callback: js.Value) !void {
    try self.enter();
    defer self.entered = false;
    if (self.runtime != null) return error.DatabaseAlreadyOpen;
    const options = try v.parseOptions(options_value.val);
    const multithreading = try v.optionalBoolean(options_value.val, "multithreading", false);
    const operation_limit = try v.optionalInteger(options_value.val, "maxPendingOperations", 4096, v.pending_operations_max);
    const byte_limit = try v.optionalInteger(options_value.val, "maxPendingBytes", 8 * 1024 * 1024 * 1024, v.pending_bytes_max);
    var path_buffer: [v.path_bytes_max + 1]u8 = undefined;
    const path = try v.path(path_value.val, &path_buffer);

    const runtime = try Runtime.create(js.env(), operation_limit, byte_limit);
    errdefer runtime.destroyPrepared();
    const job = try Job.create(runtime, &.{ .open = .{ .options = options, .multithreading = multithreading } }, path.len + 1, 0, callback.val);
    errdefer job.destroy();
    @memcpy(job.input, path[0 .. path.len + 1]);
    try runtime.enqueue(job);
    self.runtime = runtime;
}

const Input = struct {
    key: napi.Value,
    value: ?napi.Value,
    key_length: usize = 0,
    value_length: usize = 0,
};

fn collect(runtime: *const Runtime, keys: napi.Value, values: ?napi.Value) ![]Input {
    const count = try v.array(keys);
    if (values) |array| if (try v.array(array) != count) return error.InvalidOptions;
    if (runtime.pending_operations == runtime.operation_limit) return error.PendingOperationsExceeded;
    if (count > (runtime.byte_limit - runtime.pending_bytes) / @sizeOf(Input)) return error.PendingBytesExceeded;
    const inputs = try std.heap.c_allocator.alloc(Input, count);
    errdefer std.heap.c_allocator.free(inputs);
    for (inputs, 0..) |*input, index| {
        const key = try keys.getElement(@intCast(index));
        const value = if (values) |array| try array.getElement(@intCast(index)) else null;
        input.* = .{
            .key = key,
            .value = if (value) |item| if (try item.typeof() == .null) null else item else null,
        };
    }
    return inputs;
}

fn measure(inputs: []Input) !usize {
    var total: usize = 0;
    for (inputs) |*input| {
        input.key_length = (try v.bytes(input.key, leveldb.max_key_bytes, error.KeyTooLarge)).len;
        input.value_length = if (input.value) |value| (try v.bytes(value, leveldb.max_owned_value_bytes, error.ValueTooLarge)).len else 0;
        const size = input.key_length + input.value_length;
        if (size > leveldb.max_owned_batch_bytes - total) return error.BatchTooLarge;
        total += size;
    }
    return total;
}

fn copyInputs(job: *Job, inputs: []const Input) !void {
    var offset: usize = 0;
    for (inputs, 0..) |input, index| {
        const key = try v.bytes(input.key, leveldb.max_key_bytes, error.KeyTooLarge);
        if (key.len != input.key_length) return error.InvalidBytes;
        const key_copy = job.input[offset..][0..key.len];
        @memcpy(key_copy, key);
        offset += key.len;
        var value_copy: ?[]const u8 = null;
        if (input.value) |value| {
            const data = try v.bytes(value, leveldb.max_owned_value_bytes, error.ValueTooLarge);
            if (data.len != input.value_length) return error.InvalidBytes;
            const copy = job.input[offset..][0..data.len];
            @memcpy(copy, data);
            offset += data.len;
            value_copy = copy;
        }
        switch (job.operation) {
            .get_many => |read| read.keys[index] = key_copy,
            .write => |batch| batch.operations[index] = .{ .key = key_copy, .value = value_copy },
            else => unreachable,
        }
    }
    std.debug.assert(offset == job.input.len);
}

pub fn getMany(self: *@This(), keys: js.Value, fill_cache: js.Value, callback: js.Value) !void {
    try self.enter();
    defer self.entered = false;
    const runtime = try self.owner();
    const cache = try v.boolean(fill_cache.val);
    const inputs = try collect(runtime, keys.val, null);
    defer std.heap.c_allocator.free(inputs);
    const input_size = try measure(inputs);
    const job = try Job.create(runtime, &.{ .get_many = .{ .fill_cache = cache } }, input_size, inputs.len, callback.val);
    errdefer job.destroy();
    try copyInputs(job, inputs);
    try runtime.enqueue(job);
}

pub fn write(self: *@This(), keys: js.Value, values: js.Value, sync: js.Value, callback: js.Value) !void {
    try self.enter();
    defer self.entered = false;
    const runtime = try self.owner();
    const sync_value = try v.boolean(sync.val);
    const inputs = try collect(runtime, keys.val, values.val);
    defer std.heap.c_allocator.free(inputs);
    const size = try measure(inputs);
    const job = try Job.create(runtime, &.{ .write = .{ .sync = sync_value } }, size, inputs.len, callback.val);
    errdefer job.destroy();
    try copyInputs(job, inputs);
    try runtime.enqueue(job);
}

pub fn cursor(self: *@This(), options: js.Value, callback: js.Value) !void {
    try self.enter();
    defer self.entered = false;
    const runtime = try self.owner();
    const object = options.val;
    const count = try v.integer(try object.getNamedProperty("limit"), std.math.maxInt(u32));
    const reverse = try v.boolean(try object.getNamedProperty("reverse"));
    const fill_cache = try v.boolean(try object.getNamedProperty("fillCache"));
    const keys = try v.boolean(try object.getNamedProperty("keys"));
    const values = try v.boolean(try object.getNamedProperty("values"));
    var bounds: [4]napi.Value = undefined;
    for (&bounds, [_][:0]const u8{ "gt", "gte", "lt", "lte" }) |*bound, name| bound.* = try object.getNamedProperty(name);
    var slices: [4]?[]const u8 = @splat(null);
    var total: usize = 0;
    for (bounds, &slices) |bound, *slice| {
        const kind = try bound.typeof();
        if (kind == .null or kind == .undefined) continue;
        slice.* = try v.bytes(bound, leveldb.max_key_bytes, error.KeyTooLarge);
        total += slice.*.?.len;
    }
    const job = try Job.create(runtime, &.{ .cursor = .{} }, total, 0, callback.val);
    errdefer job.destroy();
    var offset: usize = 0;
    for (&slices) |*slice| {
        if (slice.*) |key| {
            const copy = job.input[offset..][0..key.len];
            @memcpy(copy, key);
            slice.* = copy;
            offset += key.len;
        }
    }
    job.operation.cursor.range = .{
        .gt = slices[0],
        .gte = slices[1],
        .lt = slices[2],
        .lte = slices[3],
        .reverse = reverse,
        .fill_cache = fill_cache,
        .keys = keys,
        .values = values,
        .limit = @intCast(count),
    };
    try runtime.enqueue(job);
}

pub fn readCursor(self: *@This(), id: js.Value, max_entries: js.Value, callback: js.Value) !void {
    try self.enter();
    defer self.entered = false;
    const runtime = try self.owner();
    const cursor_id = try v.positive(id.val, std.math.maxInt(u32));
    const count = try v.positive(max_entries.val, leveldb.max_bulk_entries);
    const job = try Job.create(runtime, &.{ .read_cursor = .{ .id = @intCast(cursor_id) } }, 0, count, callback.val);
    errdefer job.destroy();
    try runtime.enqueue(job);
}

pub fn seekCursor(self: *@This(), id: js.Value, target: js.Value, callback: js.Value) !void {
    try self.enter();
    defer self.entered = false;
    const runtime = try self.owner();
    const cursor_id = try v.positive(id.val, std.math.maxInt(u32));
    const key = try v.bytes(target.val, leveldb.max_key_bytes, error.KeyTooLarge);
    const job = try Job.create(runtime, &.{ .seek_cursor = @intCast(cursor_id) }, key.len, 0, callback.val);
    errdefer job.destroy();
    @memcpy(job.input, key);
    try runtime.enqueue(job);
}

pub fn closeCursor(self: *@This(), id: js.Value, callback: js.Value) !void {
    try self.enter();
    defer self.entered = false;
    const cursor_id = try v.positive(id.val, std.math.maxInt(u32));
    const runtime = self.runtime orelse return error.DatabaseClosed;
    if (runtime.closing) return runtime.close(callback.val);
    const known = runtime.knownCursor(@intCast(cursor_id)) orelse {
        const reference = try v.callback(callback.val);
        defer reference.delete() catch {};
        return v.notify(js.env(), reference, null, try js.env().getUndefined());
    };
    if (known.closing) return error.CursorClosing;
    const job = try Job.create(runtime, &.{ .close_cursor = @intCast(cursor_id) }, 0, 0, callback.val);
    errdefer job.destroy();
    try runtime.enqueue(job);
    known.closing = true;
}

pub fn close(self: *@This(), callback: js.Value) !void {
    try self.enter();
    defer self.entered = false;
    if (self.runtime) |runtime| return runtime.close(callback.val);
    const reference = try v.callback(callback.val);
    defer reference.delete() catch {};
    try v.notify(js.env(), reference, null, try js.env().getUndefined());
}

pub fn clear(self: *@This(), callback: js.Value) !void {
    try self.enter();
    defer self.entered = false;
    const runtime = try self.owner();
    const job = try Job.create(runtime, &.clear, 0, 0, callback.val);
    errdefer job.destroy();
    try runtime.enqueue(job);
}

pub fn approximateSize(self: *@This(), start: js.Value, end: js.Value, callback: js.Value) !void {
    try self.maintenance(.approximate_size, start.val, end.val, callback.val);
}

pub fn compactRange(self: *@This(), start: js.Value, end: js.Value, callback: js.Value) !void {
    try self.maintenance(.compact_range, start.val, end.val, callback.val);
}

fn maintenance(self: *@This(), kind: Job.Kind, start: napi.Value, end: napi.Value, callback: napi.Value) !void {
    try self.enter();
    defer self.entered = false;
    const runtime = try self.owner();
    const lower = try v.bytes(start, leveldb.max_key_bytes, error.KeyTooLarge);
    const upper = try v.bytes(end, leveldb.max_key_bytes, error.KeyTooLarge);
    const bounds: Job.Bounds = .{ .start = lower, .end = upper };
    const operation: Job.Operation = switch (kind) {
        .approximate_size => .{ .approximate_size = .{ .bounds = bounds } },
        .compact_range => .{ .compact_range = bounds },
        else => unreachable,
    };
    const job = try Job.create(runtime, &operation, lower.len + upper.len, 0, callback);
    errdefer job.destroy();
    @memcpy(job.input[0..lower.len], lower);
    @memcpy(job.input[lower.len..], upper);
    const copied: Job.Bounds = .{ .start = job.input[0..lower.len], .end = job.input[lower.len..] };
    switch (job.operation) {
        .approximate_size => |*estimate| estimate.bounds = copied,
        .compact_range => |*range| range.* = copied,
        else => unreachable,
    }
    try runtime.enqueue(job);
}

pub fn property(self: *@This(), name: js.Value, callback: js.Value) !void {
    try self.enter();
    defer self.entered = false;
    const runtime = try self.owner();
    var buffer: [v.path_bytes_max + 1]u8 = undefined;
    const text = try v.path(name.val, &buffer);
    const job = try Job.create(runtime, &.{ .property = null }, text.len + 1, 0, callback.val);
    errdefer job.destroy();
    @memcpy(job.input, text[0 .. text.len + 1]);
    try runtime.enqueue(job);
}

pub fn destroy(self: *@This(), path_value: js.Value, callback: js.Value) !void {
    try self.enter();
    defer self.entered = false;
    if (self.runtime != null) return error.DatabaseAlreadyOpen;
    var buffer: [v.path_bytes_max + 1]u8 = undefined;
    const path = try v.path(path_value.val, &buffer);
    const runtime = try Runtime.create(js.env(), 1, 2 * 1024 * 1024 * 1024);
    errdefer runtime.destroyPrepared();
    const job = try Job.create(runtime, &.destroy, path.len + 1, 0, callback.val);
    errdefer job.destroy();
    @memcpy(job.input, path[0 .. path.len + 1]);
    try runtime.enqueue(job);
    self.runtime = runtime;
}
