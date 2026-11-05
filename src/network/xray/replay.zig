const std = @import("std");

pub const Replay = struct {
    const Entry = struct { offset: usize, length: usize };
    pub const bytes_max = 64 * 1024 * 1024;
    pub const entries_max = 256 * 1024;
    pub const allocated_bytes = bytes_max + entries_max * @sizeOf(Entry);

    entries: []Entry,
    bytes: []u8,
    head: usize = 0,
    len: usize = 0,
    byte_head: usize = 0,
    byte_len: usize = 0,
    last_sequence: u64 = 0,

    pub fn init(a: std.mem.Allocator) std.mem.Allocator.Error!Replay {
        const entries = try a.alloc(Entry, entries_max);
        errdefer a.free(entries);
        const bytes = try a.alloc(u8, bytes_max);
        return .{ .entries = entries, .bytes = bytes };
    }

    pub fn deinit(self: *Replay, a: std.mem.Allocator) void {
        a.free(self.bytes);
        a.free(self.entries);
    }

    pub fn clear(self: *Replay) void {
        self.head = 0;
        self.len = 0;
        self.byte_head = 0;
        self.byte_len = 0;
    }

    pub fn covers(self: *const Replay, sequence: u64) bool {
        return sequence > self.last_sequence - self.len and sequence <= self.last_sequence + 1;
    }

    pub fn append(self: *Replay, frame: []const u8) void {
        std.debug.assert(frame.len > 0 and frame.len <= self.bytes.len);
        while (self.len == self.entries.len or frame.len > self.bytes.len - self.byte_len) {
            const old = self.entries[self.head];
            self.byte_head = (self.byte_head + old.length) % self.bytes.len;
            self.byte_len -= old.length;
            self.head = (self.head + 1) % self.entries.len;
            self.len -= 1;
        }
        const offset = (self.byte_head + self.byte_len) % self.bytes.len;
        const first = @min(frame.len, self.bytes.len - offset);
        @memcpy(self.bytes[offset..][0..first], frame[0..first]);
        @memcpy(self.bytes[0 .. frame.len - first], frame[first..]);
        self.entries[(self.head + self.len) % self.entries.len] = .{ .offset = offset, .length = frame.len };
        self.len += 1;
        self.byte_len += frame.len;
        self.last_sequence += 1;
    }

    pub fn copy(self: *const Replay, sequence: u64, into: []u8) ?usize {
        if (!self.covers(sequence) or sequence == self.last_sequence + 1) return null;
        const index: usize = @intCast(sequence - (self.last_sequence - self.len + 1));
        const entry = self.entries[(self.head + index) % self.entries.len];
        if (entry.length > into.len) return null;
        const first = @min(entry.length, self.bytes.len - entry.offset);
        @memcpy(into[0..first], self.bytes[entry.offset..][0..first]);
        @memcpy(into[first..][0 .. entry.length - first], self.bytes[0 .. entry.length - first]);
        return entry.length;
    }
};

test {
    _ = @import("replay_test.zig");
}
