const std = @import("std");
const file = @import("remembered_file.zig");
const remembered = @import("remembered.zig");
const Checkpoint = @This();

pub const interval_ms = 5 * 60_000;
dir: std.Io.Dir,
root: [32]u8,
records: [remembered.capacity]remembered.Record = undefined,
count: u16 = 0,
future: ?std.Io.Future(file.WriteError!void) = null,
/// The task publishes completion only after closing files and removing any uncommitted temporary.
done: std.Io.Event = .unset,

pub fn init(io: std.Io, path: []const u8, root: *const [32]u8) std.Io.Dir.CreateDirPathOpenError!Checkpoint {
    return .{ .dir = try std.Io.Dir.cwd().createDirPathOpen(io, path, .{}), .root = root.* };
}

pub fn deinit(self: *Checkpoint, io: std.Io) void {
    std.debug.assert(self.future == null);
    self.dir.close(io);
    self.* = undefined;
}

pub fn start(self: *Checkpoint, io: std.Io, records: []const remembered.Record) std.Io.ConcurrentError!bool {
    if (self.future != null) return false;
    std.debug.assert(records.len <= remembered.capacity);
    @memcpy(self.records[0..records.len], records);
    self.count = @intCast(records.len);
    self.done.reset();
    // Never fall back to writing on the caller, including during shutdown.
    self.future = try io.concurrent(run, .{ self, io });
    return true;
}

fn run(self: *Checkpoint, io: std.Io) file.WriteError!void {
    defer self.done.set(io);
    return file.write(io, self.dir, &self.root, self.records[0..self.count]);
}

pub fn collect(self: *Checkpoint, io: std.Io) file.WriteError!bool {
    if (self.future == null or !self.done.isSet()) return false;
    var future = self.future.?;
    self.future = null;
    try future.await(io);
    return true;
}

/// The deadline bounds the flush attempt, not kernel cleanup. Cancellation joins the task;
/// a stalled filesystem can delay reclamation. Call without holding the network mutex.
pub fn finish(self: *Checkpoint, io: std.Io, deadline: ?std.Io.Clock.Timestamp) file.WriteError!void {
    var future = self.future orelse return;
    defer self.future = null;
    if (deadline) |until| {
        // Spurious event wakeups may return Timeout before the deadline.
        for (0..64) |_| {
            if (self.done.isSet() or std.Io.Clock.Timestamp.now(io, until.clock).compare(.gte, until)) break;
            self.done.waitTimeout(io, .{ .deadline = until }) catch |err| switch (err) {
                error.Timeout => continue,
                error.Canceled => break,
            };
        }
    }
    if (self.done.isSet()) return future.await(io);
    return future.cancel(io);
}

test {
    _ = @import("remembered_checkpoint_test.zig");
}
