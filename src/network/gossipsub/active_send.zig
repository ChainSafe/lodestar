const std = @import("std");
const storage = @import("message_store.zig");

pub const small_frame_bytes = 64 * 1024;

/// One frame's backing, acquired before offering any bytes to QUIC. The store must
/// remain at its address until all shared frames release it.
pub const Frame = union(enum) {
    small: struct { len: u32, sent: u32 = 0 },
    shared: struct { store: *storage.Store, message: storage.Handle, cursor: storage.FrameCursor },

    pub fn acquire(store: *storage.Store, message: storage.Handle, buffer: *[small_frame_bytes]u8, now_ms: u64, timeout_ms: u64) ?struct { frame: Frame, deadline_ms: u64 } {
        const entry = store.get(message).?;
        std.debug.assert(entry.history);
        if (entry.frameLen() <= buffer.len) {
            var cursor = store.frameCursor(message);
            for (0..small_frame_bytes / storage.page_bytes + 3) |_| {
                const bytes = store.frameSegment(message, cursor);
                @memcpy(buffer[cursor.sent..][0..bytes.len], bytes);
                if (store.advanceFrame(message, &cursor, bytes.len))
                    return .{ .frame = .{ .small = .{ .len = cursor.sent } }, .deadline_ms = now_ms +| timeout_ms };
            }
            unreachable;
        }
        const deadline = store.retainSend(message, now_ms, timeout_ms) orelse return null;
        return .{ .frame = .{ .shared = .{ .store = store, .message = message, .cursor = store.frameCursor(message) } }, .deadline_ms = deadline };
    }

    pub fn sent(self: *const Frame) u32 {
        return switch (self.*) {
            .small => |small| small.sent,
            .shared => |shared| shared.cursor.sent,
        };
    }

    pub fn segment(self: *const Frame, buffer: *const [small_frame_bytes]u8) []const u8 {
        return switch (self.*) {
            .small => |small| buffer[small.sent..small.len],
            .shared => |shared| shared.store.frameSegment(shared.message, shared.cursor),
        };
    }

    pub fn advance(self: *Frame, len: usize) bool {
        std.debug.assert(len > 0);
        switch (self.*) {
            .small => |*small| {
                std.debug.assert(len <= small.len - small.sent);
                small.sent += @intCast(len);
                return small.sent == small.len;
            },
            .shared => |*shared| return shared.store.advanceFrame(shared.message, &shared.cursor, len),
        }
    }

    pub fn deinit(self: *Frame) void {
        switch (self.*) {
            .small => {},
            .shared => |shared| shared.store.releaseSend(shared.message),
        }
        self.* = undefined;
    }
};

test {
    _ = @import("active_send_test.zig");
}
