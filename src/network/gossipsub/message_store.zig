const std = @import("std");
const topic = @import("topic.zig");
const protobuf = @import("protobuf.zig");
const constants = @import("constants.zig");
const assert = std.debug.assert;
const gossip_limits = @import("../gossip_limits.zig");

pub const page_bytes: usize = 4096;
/// Payloads up to this length live in their entry rather than in pages.
pub const inline_bytes: usize = 512;
/// The longest topic trailer: the field tag, a one-byte length and the topic.
const trailer_max = topic.topic_max_len + 2;
/// An entry's frame bytes. They hold the complete RPC frame of an inline payload with the longest
/// topic, so every inline frame is one contiguous write; a paged payload keeps only its prefix
/// and trailer here.
const frame_capacity = prefixLen(inline_bytes, trailer_max) + inline_bytes + trailer_max;
comptime {
    assert(topic.topic_max_len < 128);
    assert(prefixLen(constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE), trailer_max) + trailer_max <= frame_capacity);
}
pub const none: u32 = std.math.maxInt(u32);
pub const Handle = struct { index: u32, generation: u64 };
/// A position in an entry's payload.
pub const Cursor = struct { page: u32, offset: u32 = 0, remaining: u32 };
/// A position in an entry's RPC frame: `sent` frame bytes precede it, and `page` holds the next
/// payload byte of a paged payload.
pub const FrameCursor = struct { sent: u32 = 0, page: u32 };
pub const Entry = struct {
    kind: topic.Kind = .beacon_block,
    generation: u64 = 0,
    active: bool = false,
    free_next: u32 = none,
    provisional: bool = false,
    validation: bool = false,
    history: bool = false,
    senders: u16 = 0,
    send_deadline_ms: ?u64 = null,
    first: u32 = none,
    len: u32 = 0,
    id: topic.MessageId = undefined,
    /// The length prefix and RPC headers, the payload when it is inline, then the topic trailer.
    frame: [frame_capacity]u8 = undefined,
    prefix_len: u8 = 0,
    topic_len: u8 = 0,

    pub fn topicString(self: *const Entry) []const u8 {
        return self.frame[self.trailerStart() + 2 ..][0..self.topic_len];
    }

    pub fn frameLen(self: *const Entry) usize {
        return self.prefix_len + self.len + self.topic_len + 2;
    }

    fn trailerStart(self: *const Entry) usize {
        return self.prefix_len + if (self.len <= inline_bytes) self.len else 0;
    }
};

fn prefixLen(len: usize, trailer_len: usize) usize {
    const message_len = 1 + protobuf.varintLen(len) + len + trailer_len;
    const rpc_len = 1 + protobuf.varintLen(message_len) + message_len;
    return protobuf.varintLen(rpc_len) + 1 + protobuf.varintLen(message_len) + 1 + protobuf.varintLen(len);
}

pub fn encodePrefix(prefix: []u8, trailer: []u8, len: usize, name: []const u8) struct { prefix: usize, trailer: usize } {
    assert(len <= constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE));
    assert(name.len <= topic.topic_max_len);
    var tail = protobuf.Writer.init(trailer);
    tail.bytesField(4, name);
    const message_len = 1 + protobuf.varintLen(len) + len + tail.len;
    const rpc_len = 1 + protobuf.varintLen(message_len) + message_len;
    assert(rpc_len <= constants.GOSSIP_MAX_SIZE);
    var head = protobuf.Writer.init(prefix);
    head.varint(rpc_len);
    head.tag(2, protobuf.wire_len);
    head.varint(message_len);
    head.tag(2, protobuf.wire_len);
    head.varint(len);
    assert(head.len == prefixLen(len, tail.len));
    return .{ .prefix = head.len, .trailer = tail.len };
}

pub const Store = struct {
    bytes: []u8,
    next: []u32,
    entries: []Entry,
    free_page: u32,
    free_pages: usize,
    used_entries: usize = 0,
    retired_entries: usize = 0,
    free_entry: u32 = 0,
    limits: ?gossip_limits.Limits = null,
    retained_entries_by_kind: [gossip_limits.kind_count]usize = @splat(0),
    retained_by_kind: [gossip_limits.kind_count]usize = @splat(0),
    pending_entries_by_kind: [gossip_limits.kind_count]usize = @splat(0),
    pending_by_kind: [gossip_limits.kind_count]usize = @splat(0),
    send_limits: gossip_limits.Limits = @splat(.{ .items = 0, .bytes = 0 }),
    /// Validation and history cannot consume the extra backing reserved for active sends.
    base_pages: usize = std.math.maxInt(usize),
    base_entries: usize = std.math.maxInt(usize),
    sending_entries_by_kind: [gossip_limits.kind_count]usize = @splat(0),
    sending_by_kind: [gossip_limits.kind_count]usize = @splat(0),

    pub fn metadataBytes(capacity: usize, byte_capacity: usize) usize {
        return capacity * @sizeOf(Entry) + byte_capacity / page_bytes * @sizeOf(u32);
    }

    pub fn init(a: std.mem.Allocator, capacity: usize, byte_capacity: usize) !Store {
        if (capacity == 0 or capacity >= none or byte_capacity < page_bytes or byte_capacity / page_bytes >= none)
            return error.InvalidLimits;
        const pages = byte_capacity / page_bytes;
        const bytes = try a.alloc(u8, pages * page_bytes);
        errdefer a.free(bytes);
        const next = try a.alloc(u32, pages);
        errdefer a.free(next);
        const entries = try a.alloc(Entry, capacity);
        errdefer a.free(entries);
        @memset(entries, .{});
        for (entries, 0..) |*entry, i| entry.free_next = if (i + 1 == capacity) none else @intCast(i + 1);
        for (next, 0..) |*n, i| n.* = if (i + 1 == pages) none else @intCast(i + 1);
        return .{ .bytes = bytes, .next = next, .entries = entries, .free_page = 0, .free_pages = pages };
    }

    pub fn deinit(self: *Store, a: std.mem.Allocator) void {
        a.free(self.entries);
        a.free(self.next);
        a.free(self.bytes);
        self.* = undefined;
    }

    /// Borrows an entry until the next store mutation in this owner call.
    pub fn get(self: *const Store, handle: Handle) ?*const Entry {
        if (handle.index >= self.entries.len) return null;
        const entry = &self.entries[handle.index];
        if (!entry.active or entry.generation != handle.generation) return null;
        return entry;
    }

    pub const Room = struct {
        pages: usize,
        entries: usize,
        base_pages: usize,
        base_entries: usize,

        pub fn fits(self: *const Room, len: usize) bool {
            const pages = pagesFor(len);
            return self.entries > 0 and self.base_entries > 0 and pages <= self.pages and pages <= self.base_pages;
        }

        /// Preflights releasing the last validation/history owner, preserving active sends.
        pub fn releaseBase(self: *Room, entry: *const Entry) void {
            const pages = pagesFor(entry.len);
            self.base_pages +|= pages;
            self.base_entries +|= 1;
            if (entry.senders == 0) {
                self.pages += pages;
                self.entries += @intFromBool(entry.generation != std.math.maxInt(u64));
            }
        }
    };

    pub fn room(self: *const Store) Room {
        var pages: usize = 0;
        var entries: usize = 0;
        for (self.pending_by_kind, self.retained_by_kind, self.pending_entries_by_kind, self.retained_entries_by_kind) |pending, retained, pending_entries, retained_entries| {
            pages += pending + retained;
            entries += pending_entries + retained_entries;
        }
        return .{ .pages = self.free_pages, .entries = self.entries.len - self.used_entries - self.retired_entries, .base_pages = self.base_pages -| pages, .base_entries = self.base_entries -| entries };
    }

    pub fn canReserve(self: *const Store, len: usize) bool {
        return self.room().fits(len);
    }

    pub fn pagesFor(len: usize) usize {
        assert(len <= constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE));
        return if (len <= inline_bytes) 0 else (len + page_bytes - 1) / page_bytes;
    }

    pub fn pendingRoom(self: *const Store, kind: topic.Kind, len: usize) bool {
        const limits = self.limits orelse return true;
        const k = @intFromEnum(kind);
        const pages = pagesFor(len);
        const capacity = limits[k].bytes / page_bytes;
        const pending = self.pending_by_kind[k];
        return pending <= capacity and pages <= capacity - pending and self.pending_entries_by_kind[k] < limits[k].items;
    }
    pub fn canRetain(self: *const Store, handle: Handle) bool {
        const lacking = self.retentionShortfall(handle);
        return lacking.pages == 0 and lacking.entries == 0;
    }

    const Shortfall = struct { pages: usize, entries: usize };

    /// The pages and entries of its kind's retention allowance that retained messages must
    /// release before `handle` fits.
    pub fn retentionShortfall(self: *const Store, handle: Handle) Shortfall {
        const entry = self.get(handle).?;
        if (entry.history) return .{ .pages = 0, .entries = 0 };
        return self.retentionNeeded(entry.kind, entry.len);
    }

    pub fn retentionNeeded(self: *const Store, kind: topic.Kind, len: usize) Shortfall {
        const limits = self.limits orelse return .{ .pages = 0, .entries = 0 };
        const k = @intFromEnum(kind);
        return .{
            .pages = (self.retained_by_kind[k] + pagesFor(len)) -| limits[k].bytes / page_bytes,
            .entries = (self.retained_entries_by_kind[k] + 1) -| limits[k].items,
        };
    }
    pub fn put(self: *Store, kind: topic.Kind, id: topic.MessageId, name: []const u8, data: []const u8) ?Handle {
        if (!self.canReserve(data.len) or !self.pendingRoom(kind, data.len)) return null;
        return self.allocate(id, name, data, kind);
    }

    /// Insert into history in this owner call, before another admission observes the provisional entry.
    pub fn putPublication(self: *Store, kind: topic.Kind, id: topic.MessageId, name: []const u8, data: []const u8) Handle {
        const needed = self.retentionNeeded(kind, data.len);
        assert(needed.pages == 0 and needed.entries == 0 and self.canReserve(data.len));
        return self.allocate(id, name, data, kind);
    }

    fn allocate(self: *Store, id: topic.MessageId, name: []const u8, data: []const u8, kind: topic.Kind) Handle {
        assert(name.len <= topic.topic_max_len and self.canReserve(data.len));
        const index = self.free_entry;
        assert(index != none);
        const entry = &self.entries[index];
        assert(!entry.active and entry.generation < std.math.maxInt(u64));
        self.free_entry = entry.free_next;
        entry.* = .{
            .kind = kind,
            .generation = entry.generation + 1,
            .active = true,
            .provisional = true,
            .id = id,
            .len = @intCast(data.len),
            .topic_len = @intCast(name.len),
        };
        var prefix: [32]u8 = undefined;
        var trailer: [trailer_max]u8 = undefined;
        const lens = encodePrefix(&prefix, &trailer, data.len, name);
        entry.prefix_len = @intCast(lens.prefix);
        @memcpy(entry.frame[0..lens.prefix], prefix[0..lens.prefix]);
        if (data.len <= inline_bytes) @memcpy(entry.frame[lens.prefix..][0..data.len], data);
        @memcpy(entry.frame[entry.trailerStart()..][0..lens.trailer], trailer[0..lens.trailer]);
        var link = &entry.first;
        var offset: usize = 0;
        for (0..pagesFor(data.len)) |_| {
            const page = self.free_page;
            assert(page != none);
            self.free_page = self.next[page];
            self.free_pages -= 1;
            link.* = page;
            link = &self.next[page];
            const take = @min(page_bytes, data.len - offset);
            @memcpy(self.bytes[@as(usize, page) * page_bytes ..][0..take], data[offset..][0..take]);
            offset += take;
        }
        link.* = none;
        self.used_entries += 1;
        self.pending_by_kind[@intFromEnum(kind)] += pagesFor(data.len);
        self.pending_entries_by_kind[@intFromEnum(kind)] += 1;
        return .{ .index = @intCast(index), .generation = entry.generation };
    }

    pub fn cursor(self: *const Store, handle: Handle) Cursor {
        const entry = self.get(handle).?;
        return .{ .page = entry.first, .remaining = entry.len };
    }

    pub fn segment(self: *const Store, handle: Handle, at: Cursor) []const u8 {
        const entry = self.get(handle).?;
        assert(!entry.provisional and at.remaining <= entry.len);
        if (at.remaining == 0) return &.{};
        if (entry.len <= inline_bytes) {
            assert(at.page == none and at.offset <= entry.len and at.remaining <= entry.len - at.offset);
            return entry.frame[entry.prefix_len + at.offset ..][0..at.remaining];
        }
        assert(at.page < self.next.len and at.offset < page_bytes);
        const len = @min(at.remaining, page_bytes - at.offset);
        return self.bytes[@as(usize, at.page) * page_bytes + at.offset ..][0..len];
    }

    pub fn advance(self: *const Store, at: *Cursor, len: usize) void {
        assert(len <= @min(at.remaining, page_bytes - at.offset));
        at.remaining -= @intCast(len);
        at.offset += @intCast(len);
        if (at.offset == page_bytes) {
            at.page = self.next[at.page];
            at.offset = 0;
        }
    }

    pub fn frameCursor(self: *const Store, handle: Handle) FrameCursor {
        return .{ .page = self.get(handle).?.first };
    }

    /// The unsent frame bytes that are contiguous from `at`: the whole rest of an inline frame, or
    /// for a paged payload the rest of the prefix, of the current page, or of the trailer.
    /// The caller must keep the store unchanged until it consumes the borrowed segment.
    pub fn frameSegment(self: *const Store, handle: Handle, at: FrameCursor) []const u8 {
        const entry = self.get(handle).?;
        assert(!entry.provisional and at.sent <= entry.frameLen());
        if (entry.len <= inline_bytes) return entry.frame[at.sent..entry.frameLen()];
        const body_end = entry.prefix_len + entry.len;
        if (at.sent < entry.prefix_len) return entry.frame[at.sent..entry.prefix_len];
        if (at.sent < body_end) {
            assert(at.page < self.next.len);
            const offset = (at.sent - entry.prefix_len) % page_bytes;
            return self.bytes[@as(usize, at.page) * page_bytes + offset ..][0..@min(page_bytes - offset, body_end - at.sent)];
        }
        return entry.frame[at.sent - entry.len .. entry.prefix_len + entry.topic_len + 2];
    }

    /// Moves `at` past `len` bytes of its current segment. Returns true once the frame is sent.
    pub fn advanceFrame(self: *const Store, handle: Handle, at: *FrameCursor, len: usize) bool {
        const entry = self.get(handle).?;
        assert(len > 0 and len <= self.frameSegment(handle, at.*).len);
        const in_body = entry.len > inline_bytes and at.sent >= entry.prefix_len and at.sent < entry.prefix_len + entry.len;
        at.sent += @intCast(len);
        if (in_body and (at.sent - entry.prefix_len) % page_bytes == 0) at.page = self.next[at.page];
        return at.sent == entry.frameLen();
    }

    pub fn seal(self: *Store, h: Handle) void {
        const e = self.mutable(h);
        assert(e.provisional);
        const pending = isPending(e);
        e.provisional = false;
        self.updatePending(e, pending);
        self.collect(h);
    }
    pub fn retainValidation(self: *Store, h: Handle) void {
        const e = self.mutable(h);
        assert(!e.validation);
        const pending = isPending(e);
        e.validation = true;
        self.updatePending(e, pending);
    }
    pub fn releaseValidation(self: *Store, h: Handle) void {
        const e = self.mutable(h);
        assert(e.validation);
        const pending = isPending(e);
        e.validation = false;
        self.updatePending(e, pending);
        self.collect(h);
    }
    pub fn retainHistory(self: *Store, h: Handle) void {
        const e = self.mutable(h);
        assert(!e.history and self.canRetain(h));
        const pending = isPending(e);
        self.retained_by_kind[@intFromEnum(e.kind)] += pagesFor(e.len);
        self.retained_entries_by_kind[@intFromEnum(e.kind)] += 1;
        e.history = true;
        self.updatePending(e, pending);
    }
    pub fn releaseHistory(self: *Store, h: Handle) void {
        const e = self.mutable(h);
        assert(e.history);
        const pending = isPending(e);
        e.history = false;
        self.updatePending(e, pending);
        self.retained_by_kind[@intFromEnum(e.kind)] -= pagesFor(e.len);
        self.retained_entries_by_kind[@intFromEnum(e.kind)] -= 1;
        self.collect(h);
    }
    /// Charges the distinct payload even while history owns it. Its first deadline never renews.
    pub fn retainSend(self: *Store, h: Handle, now_ms: u64, timeout_ms: u64) ?u64 {
        const e = self.mutable(h);
        if (!e.history or now_ms >= (e.send_deadline_ms orelse std.math.maxInt(u64))) return null;
        const k = @intFromEnum(e.kind);
        if (e.senders == 0) {
            const limit = self.send_limits[k];
            const pages = pagesFor(e.len);
            if (self.sending_entries_by_kind[k] >= limit.items or pages > limit.bytes / page_bytes -| self.sending_by_kind[k]) return null;
            self.sending_entries_by_kind[k] += 1;
            self.sending_by_kind[k] += pages;
        }
        assert(e.senders < constants.peers_cap);
        e.senders += 1;
        e.send_deadline_ms = e.send_deadline_ms orelse now_ms +| timeout_ms;
        return e.send_deadline_ms;
    }

    pub fn releaseSend(self: *Store, h: Handle) void {
        const e = self.mutable(h);
        assert(e.senders > 0);
        e.senders -= 1;
        if (e.senders == 0) {
            const k = @intFromEnum(e.kind);
            self.sending_entries_by_kind[k] -= 1;
            self.sending_by_kind[k] -= pagesFor(e.len);
        }
        self.collect(h);
    }

    fn isPending(e: *const Entry) bool {
        return !e.history and (e.provisional or e.validation);
    }

    fn updatePending(self: *Store, e: *const Entry, before: bool) void {
        const after = isPending(e);
        if (before == after) return;
        const k = @intFromEnum(e.kind);
        if (after) {
            self.pending_entries_by_kind[k] += 1;
            self.pending_by_kind[k] += pagesFor(e.len);
        } else {
            self.pending_entries_by_kind[k] -= 1;
            self.pending_by_kind[k] -= pagesFor(e.len);
        }
    }
    fn mutable(self: *Store, h: Handle) *Entry {
        assert(self.get(h) != null);
        return &self.entries[h.index];
    }
    fn collect(self: *Store, h: Handle) void {
        const e = self.mutable(h);
        if (e.provisional or e.validation or e.history or e.senders > 0) return;
        var page = e.first;
        for (0..pagesFor(e.len)) |_| {
            assert(page != none);
            const next = self.next[page];
            self.next[page] = self.free_page;
            self.free_page = page;
            self.free_pages += 1;
            page = next;
        }
        assert(page == none);
        e.active = false;
        self.used_entries -= 1;
        if (e.generation == std.math.maxInt(u64)) self.retired_entries += 1 else {
            e.free_next = self.free_entry;
            self.free_entry = h.index;
        }
    }
};

test {
    _ = @import("message_store_test.zig");
}
