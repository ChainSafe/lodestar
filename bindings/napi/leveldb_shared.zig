const std = @import("std");
const leveldb = @import("leveldb");
const allocator = std.heap.c_allocator;

var mutex: std.Io.Mutex = .init;
var databases: std.StringHashMapUnmanaged(*Database) = .{};

pub const Database = struct {
    database: leveldb.Database,
    path: []const u8,
    references: usize = 1,
    multithreading: bool,

    pub fn open(path: [:0]const u8, options: leveldb.Options, multithreading: bool, diagnostics: *leveldb.Diagnostics) !*Database {
        std.Io.Threaded.mutexLock(&mutex);
        defer std.Io.Threaded.mutexUnlock(&mutex);
        var resolved = try canonicalPath(path, diagnostics);
        errdefer if (resolved) |key| allocator.free(key);
        if (resolved) |key| {
            if (databases.get(key)) |shared| {
                resolved = null;
                defer allocator.free(key);
                if (!multithreading or !shared.multithreading) {
                    diagnostics.format("Database already open without shared access: {s}", .{path});
                    return error.IOError;
                }
                shared.references = try std.math.add(usize, shared.references, 1);
                return shared;
            }
        }
        const shared = try allocator.create(Database);
        errdefer allocator.destroy(shared);
        shared.* = .{
            .database = try leveldb.Database.open(allocator, path, options, diagnostics),
            .path = undefined,
            .multithreading = multithreading,
        };
        errdefer shared.database.close() catch unreachable;
        if (resolved == null) resolved = (try canonicalPath(path, diagnostics)) orelse return error.IOError;
        shared.path = resolved.?;
        try databases.put(allocator, shared.path, shared);
        return shared;
    }

    /// Release this handle only after its work and cursors retire.
    pub fn release(self: *Database) void {
        std.Io.Threaded.mutexLock(&mutex);
        defer std.Io.Threaded.mutexUnlock(&mutex);
        std.debug.assert(self.references > 0);
        std.debug.assert(databases.get(self.path).? == self);
        if (self.references > 1) {
            self.references -= 1;
            return;
        }
        self.database.close() catch unreachable;
        const removed = databases.remove(self.path);
        std.debug.assert(removed);
        allocator.free(self.path);
        allocator.destroy(self);
        if (databases.count() == 0) {
            databases.deinit(allocator);
            databases = .{};
        }
    }
};

pub fn destroy(path: [:0]const u8, diagnostics: *leveldb.Diagnostics) !void {
    std.Io.Threaded.mutexLock(&mutex);
    defer std.Io.Threaded.mutexUnlock(&mutex);
    if (try canonicalPath(path, diagnostics)) |key| {
        defer allocator.free(key);
        if (databases.contains(key)) {
            diagnostics.format("Cannot destroy an open database: {s}", .{path});
            return error.IOError;
        }
    }
    try leveldb.destroy(path, diagnostics);
}

fn canonicalPath(path: [:0]const u8, diagnostics: *leveldb.Diagnostics) !?[]u8 {
    var buffer: [std.posix.PATH_MAX]u8 = undefined;
    const resolved = std.c.realpath(path.ptr, &buffer) orelse return switch (std.c.errno(@as(c_int, -1))) {
        .NOENT => null,
        .NOMEM => error.OutOfMemory,
        else => |err| blk: {
            diagnostics.format("Cannot resolve database path {s}: {t}", .{ path, err });
            break :blk error.IOError;
        },
    };
    return try allocator.dupe(u8, std.mem.span(resolved));
}
