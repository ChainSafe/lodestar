const std = @import("std");
const raw = @import("raw.zig");

const chunk_entries = 1024;
const chunk_bytes = 1024 * 1024;

pub fn copyProperty(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    if (value.len > 1024 * 1024) return error.ValueTooLarge;
    return allocator.dupe(u8, value);
}

/// One iterator pins the same view for preflight and deletion. This operation is not atomic across chunks.
pub fn clear(db: *raw.DB, max_entries: u64, key_limit: usize, diagnostics: ?*raw.Diagnostics) !void {
    if (max_entries > std.math.maxInt(u32)) return error.InvalidOptions;
    var read_options = try raw.ReadOptions.create();
    defer read_options.destroy();
    read_options.setVerifyChecksums(true);
    read_options.setFillCache(false);

    var iterator = try db.createIterator(&read_options);
    defer iterator.destroy();

    iterator.seekToFirst();
    try iterator.getError(diagnostics);
    var count: u64 = 0;
    for (0..max_entries) |_| {
        if (!iterator.valid()) break;
        const key = iterator.key();
        if (key.len > key_limit) return error.KeyTooLarge;
        if (key.len > chunk_bytes) return error.BatchTooLarge;
        count += 1;
        iterator.next();
        try iterator.getError(diagnostics);
    }
    if (iterator.valid()) return error.ClearLimitExceeded;
    if (count == 0) return;

    var batch = try raw.WriteBatch.create();
    defer batch.destroy();
    var write_options = try raw.WriteOptions.create();
    defer write_options.destroy();

    iterator.seekToFirst();
    try iterator.getError(diagnostics);
    var entries: usize = 0;
    var bytes: usize = 0;
    for (0..count) |_| {
        if (!iterator.valid()) return error.InconsistentRead;
        const key = iterator.key();
        if (key.len > key_limit or key.len > chunk_bytes) return error.InconsistentRead;
        if (entries == chunk_entries or key.len > chunk_bytes - bytes) {
            try db.write(&write_options, &batch, diagnostics);
            batch.clear();
            entries = 0;
            bytes = 0;
        }
        batch.delete(key);
        entries += 1;
        bytes += key.len;
        iterator.next();
        try iterator.getError(diagnostics);
    }
    if (iterator.valid()) return error.InconsistentRead;
    if (entries != 0) try db.write(&write_options, &batch, diagnostics);
}

test "property copy admits one MiB and rejects larger output before allocation" {
    const testing = std.testing;
    const value = try testing.allocator.alloc(u8, 1024 * 1024 + 1);
    defer testing.allocator.free(value);
    @memset(value, 'x');
    var failing = testing.FailingAllocator.init(testing.allocator, .{});
    const copy = try copyProperty(failing.allocator(), value[0 .. value.len - 1]);
    try testing.expectEqualSlices(u8, value[0 .. value.len - 1], copy);
    failing.allocator().free(copy);
    const allocated = failing.allocated_bytes;
    try testing.expectError(error.ValueTooLarge, copyProperty(failing.allocator(), value));
    try testing.expectEqual(allocated, failing.allocated_bytes);
    try testing.expectEqual(failing.allocated_bytes, failing.freed_bytes);
}
