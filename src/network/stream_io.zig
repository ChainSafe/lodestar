const std = @import("std");
const Engine = @import("quic/Engine.zig");
const types = @import("types.zig");

const assert = std.debug.assert;
const StreamHandle = Engine.StreamHandle;
const StreamError = Engine.StreamError;

pub const pump_attempts_max: u32 = 8;

pub const Outbox = struct {
    bytes: []const u8 = &.{},
    offset: usize = 0,
    fin: bool = false,

    pub fn queue(self: *Outbox, bytes: []const u8, fin: bool) void {
        assert(self.idle());
        self.* = .{ .bytes = bytes, .offset = 0, .fin = fin };
    }

    pub fn idle(self: *const Outbox) bool {
        assert(self.offset <= self.bytes.len);
        return self.offset == self.bytes.len and !self.fin;
    }

    pub const Progress = enum { done, blocked, yielded };

    pub fn pump(self: *Outbox, engine: *Engine, stream: StreamHandle) StreamError!Progress {
        assert(self.offset <= self.bytes.len);
        var attempts: u32 = 0;
        while (attempts < pump_attempts_max) : (attempts += 1) {
            if (self.idle()) return .done;
            const remaining = self.bytes[self.offset..];
            const written = engine.write(stream, remaining, self.fin) catch |err| switch (err) {
                error.WouldBlock => return .blocked,
                else => return err,
            };
            assert(written <= remaining.len);
            if (written == 0 and remaining.len > 0) return .blocked;
            self.offset += written;
            if (self.offset == self.bytes.len) {
                self.fin = false;
                return .done;
            }
        }
        return .yielded;
    }
};

pub fn Inbox(comptime capacity: usize) type {
    return struct {
        const Self = @This();

        buffer: [capacity]u8 = undefined,
        len: usize = 0,

        pub fn slice(self: *const Self) []const u8 {
            assert(self.len <= capacity);
            return self.buffer[0..self.len];
        }

        pub fn free(self: *const Self) usize {
            assert(self.len <= capacity);
            return capacity - self.len;
        }

        pub fn fill(self: *Self, engine: *Engine, stream: StreamHandle) StreamError!types.Read {
            assert(self.len <= capacity);
            if (self.len == capacity) return .{ .len = 0, .fin = false };
            const read = try engine.read(stream, self.buffer[self.len..]);
            assert(read.len <= capacity - self.len);
            self.len += read.len;
            return read;
        }

        pub fn append(self: *Self, bytes: []const u8) error{Overflow}!void {
            assert(self.len <= capacity);
            if (bytes.len > capacity - self.len) return error.Overflow;
            @memcpy(self.buffer[self.len..][0..bytes.len], bytes);
            self.len += bytes.len;
        }

        pub fn drop(self: *Self, count: usize) void {
            assert(count <= self.len);
            const kept = self.len - count;
            std.mem.copyForwards(u8, self.buffer[0..kept], self.buffer[count..self.len]);
            self.len -= count;
            assert(self.len <= capacity);
        }
    };
}
