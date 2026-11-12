const std = @import("std");
const constants = @import("constants.zig");
const assert = std.debug.assert;

pub const page_bytes: usize = 4096;
pub const none: u32 = std.math.maxInt(u32);

pub const Chain = struct {
    first: u32 = none,
    last: u32 = none,
    pages: u32 = 0,
    len: usize = 0,
};

pub const ReceivePool = struct {
    bytes: []u8,
    next: []u32,
    free: u32 = 0,
    free_pages: usize,

    pub fn init(a: std.mem.Allocator, byte_capacity: usize) !ReceivePool {
        if (byte_capacity < page_bytes or byte_capacity > 1024 * 1024 * 1024 or byte_capacity % page_bytes != 0) return error.InvalidLimits;
        const count = byte_capacity / page_bytes;
        const bytes = try a.alloc(u8, byte_capacity);
        errdefer a.free(bytes);
        const next = try a.alloc(u32, count);
        errdefer a.free(next);
        for (next, 0..) |*n, i| n.* = if (i + 1 == count) none else @intCast(i + 1);
        return .{ .bytes = bytes, .next = next, .free_pages = count };
    }

    pub fn deinit(self: *ReceivePool, a: std.mem.Allocator) void {
        assert(self.free_pages == self.next.len);
        a.free(self.next);
        a.free(self.bytes);
        self.* = undefined;
    }

    pub fn writable(self: *ReceivePool, chain: *Chain) ?[]u8 {
        assert(chain.len <= constants.GOSSIP_MAX_SIZE);
        assert(chain.pages == (chain.len + page_bytes - 1) / page_bytes);
        const offset = chain.len % page_bytes;
        if (chain.last == none or offset == 0) {
            if (self.free == none) return null;
            const page = self.free;
            self.free = self.next[page];
            self.next[page] = none;
            if (chain.last == none) chain.first = page else self.next[chain.last] = page;
            chain.last = page;
            chain.pages += 1;
            self.free_pages -= 1;
        }
        return self.bytes[@as(usize, chain.last) * page_bytes + offset ..][0 .. page_bytes - offset];
    }

    pub fn release(self: *ReceivePool, chain: *Chain) void {
        var page = chain.first;
        for (0..chain.pages) |_| {
            assert(page != none and page < self.next.len);
            const next = self.next[page];
            self.next[page] = self.free;
            self.free = page;
            self.free_pages += 1;
            page = next;
        }
        assert(page == none and self.free_pages <= self.next.len);
        chain.* = .{};
    }
};

pub const Cursor = struct {
    pos: usize = 0,
    page: u32 = none,
    offset: usize = 0,
};
pub const Range = struct { start: Cursor, len: usize };

/// A frame borrows a private prefix and immutable overflow pages until its owner releases it.
pub const View = struct {
    prefix: []const u8,
    pool: ?*const ReceivePool = null,
    first: u32 = none,
    len: usize,

    pub fn contiguous(bytes: []const u8) View {
        return .{ .prefix = bytes, .len = bytes.len };
    }

    pub fn begin(self: *const View) Cursor {
        assert(self.prefix.len <= self.len and self.len <= constants.GOSSIP_MAX_SIZE);
        return .{ .page = self.first };
    }

    pub fn segment(self: *const View, cursor: Cursor) []const u8 {
        assert(cursor.pos <= self.len);
        if (cursor.pos < self.prefix.len) return self.prefix[cursor.pos..];
        if (cursor.pos == self.len) return &.{};
        const pool = self.pool.?;
        assert(cursor.page < pool.next.len and cursor.offset < page_bytes);
        return pool.bytes[@as(usize, cursor.page) * page_bytes + cursor.offset ..][0..@min(page_bytes - cursor.offset, self.len - cursor.pos)];
    }

    pub fn advance(self: *const View, cursor: *Cursor, count: usize) void {
        assert(count <= self.len - cursor.pos);
        var remaining = count;
        for (0..constants.GOSSIP_MAX_SIZE / page_bytes + 3) |_| {
            if (remaining == 0) return;
            const in_prefix = cursor.pos < self.prefix.len;
            const take = @min(remaining, self.segment(cursor.*).len);
            assert(take > 0);
            cursor.pos += take;
            remaining -= take;
            if (!in_prefix) {
                cursor.offset += take;
                if (cursor.offset == page_bytes) {
                    cursor.page = self.pool.?.next[cursor.page];
                    cursor.offset = 0;
                }
            }
        }
        unreachable;
    }

    pub fn copyBytes(self: *const View, range: Range) usize {
        return if (range.len <= self.segment(range.start).len) 0 else range.len;
    }

    pub fn materialize(self: *const View, range: Range, scratch: []u8) []const u8 {
        assert(range.len <= self.len - range.start.pos);
        const first = self.segment(range.start);
        if (range.len <= first.len) return first[0..range.len];
        assert(range.len <= scratch.len);
        var cursor = range.start;
        var copied: usize = 0;
        for (0..constants.GOSSIP_MAX_SIZE / page_bytes + 3) |_| {
            if (copied == range.len) return scratch[0..copied];
            const bytes = self.segment(cursor);
            const take = @min(bytes.len, range.len - copied);
            @memcpy(scratch[copied..][0..take], bytes[0..take]);
            self.advance(&cursor, take);
            copied += take;
        }
        unreachable;
    }
};

test "receive pages charge stored bytes and preserve other chains on exhaustion" {
    var pool = try ReceivePool.init(std.testing.allocator, 2 * page_bytes);
    defer pool.deinit(std.testing.allocator);
    var a: Chain = .{};
    defer pool.release(&a);
    var b: Chain = .{};
    defer pool.release(&b);
    @memset(pool.writable(&a).?, 17);
    a.len = page_bytes;
    @memset(pool.writable(&b).?, 23);
    b.len = 1;
    try std.testing.expect(pool.writable(&a) == null);
    try std.testing.expectEqual(@as(usize, page_bytes - 1), pool.writable(&b).?.len);
    pool.release(&a);
    var view: View = .{ .prefix = "abc", .pool = &pool, .first = b.first, .len = 4 };
    var out: [4]u8 = undefined;
    try std.testing.expectEqualSlices(u8, &.{ 'a', 'b', 'c', 23 }, view.materialize(.{ .start = view.begin(), .len = 4 }, &out));
}
