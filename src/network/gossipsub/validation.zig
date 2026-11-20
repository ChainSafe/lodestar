const std = @import("std");
const histogram = @import("../metrics/histogram.zig");
const mcache = @import("mcache.zig");
const storage = @import("message_store.zig");
const topic_mod = @import("topic.zig");
const assert = std.debug.assert;
const lists = @import("../index_list.zig");
const none = lists.none;
const peer_book = @import("peer_book.zig");
const gossip_limits = @import("../gossip_limits.zig");
const constants = @import("constants.zig");
const topic_policy = @import("topic_policy.zig");

pub const Handle = struct { index: u32, generation: u64 };
const Peers = @import("peer_book.zig").PeerBook;
pub const PeerRef = @import("peer_book.zig").Ref;
pub const Verdict = enum { accept, reject, ignore };
pub const Outcome = union(enum) { applied: Verdict, already_resolved, expired, stale_handle };
pub const duplicates_max = 16;
pub const Duplicate = struct { peer: PeerRef, eligible: bool };
pub const DuplicateResult = enum { recorded, known, full, retention_full };
pub const Entry = struct {
    available_link: lists.Link = .{},
    deadline_link: lists.Link = .{},
    generation: u64 = 0,
    state: union(enum) {
        free,
        pending: struct { message: storage.Handle, delivery: u32, deadline: u64 },
        resolved: u64,
        expired: u64,
    } = .free,
};

pub const Attribution = struct {
    link: lists.Link = .{},
    handle: Handle = undefined,
    state: enum { free, pending, resolved } = .free,
    until: u64 = 0,
    verdict: Verdict = .ignore,
    id: topic_mod.MessageId = undefined,
    /// Pending validation owns these peers; resolved attribution only compares their generations.
    source: PeerRef = undefined,
    topic: u16 = undefined,
    admitted_ms: u64 = 0,
    source_eligible: bool = false,
    duplicates: [duplicates_max]Duplicate = undefined,
    duplicate_len: u8 = 0,
};

pub const Validation = struct {
    entries: []Entry,
    recent: []Attribution,
    index: mcache.IdIndex(Attribution),
    available_entries: lists.List = .{},
    pending_entries: lists.List = .{},
    free_records: lists.List = .{},
    resolved_records: lists.List = .{},
    topic_counts: []u32,
    attribution_eviction_age: histogram.Duration(&.{ 100, 300, 1000, 3000, 10000, 30000, 60000 }) = .{},

    timeout_ms: u64,
    tombstone_ms: u64,
    pending_per_peer_kind: [peer_book.capacity][gossip_limits.kind_count]u16 = @splat(@splat(0)),
    pending_per_peer: [peer_book.capacity]u16 = @splat(0),
    bytes_per_peer_kind: [peer_book.capacity][gossip_limits.kind_count]usize = @splat(@splat(0)),

    pub fn init(a: std.mem.Allocator, capacity: usize, timeout_ms: u64, tombstone_ms: u64) !Validation {
        return initForTopics(a, capacity, timeout_ms, tombstone_ms, constants.topics_cap);
    }

    pub fn initForTopics(a: std.mem.Allocator, capacity: usize, timeout_ms: u64, tombstone_ms: u64, topics: usize) !Validation {
        if (capacity == 0 or capacity > 65535 or timeout_ms == 0 or tombstone_ms == 0 or topics == 0 or topics > topic_policy.topic_max) return error.InvalidLimits;
        assert(attributionCapacity(capacity) > capacity);
        const topic_counts = try a.alloc(u32, topics);
        errdefer a.free(topic_counts);
        @memset(topic_counts, 0);
        const entries = try a.alloc(Entry, capacity);
        errdefer a.free(entries);
        @memset(entries, .{});
        const recent = try a.alloc(Attribution, attributionCapacity(capacity));
        errdefer a.free(recent);
        @memset(recent, .{});
        const index = try mcache.IdIndex(Attribution).init(a, recent);
        var result: Validation = .{ .topic_counts = topic_counts, .entries = entries, .recent = recent, .index = index, .timeout_ms = timeout_ms, .tombstone_ms = tombstone_ms };
        for (0..entries.len) |i| result.available_entries.append(entries, "available_link", @intCast(i));
        for (0..recent.len) |i| result.free_records.append(recent, "link", @intCast(i));
        return result;
    }

    pub fn deinit(self: *Validation, a: std.mem.Allocator, store: *storage.Store, peers: *Peers) void {
        self.clear(store, peers);
        self.index.deinit(a);
        a.free(self.topic_counts);
        a.free(self.recent);
        a.free(self.entries);
        self.* = undefined;
    }

    pub fn clear(self: *Validation, store: *storage.Store, peers: *Peers) void {
        self.available_entries = .{};
        self.pending_entries = .{};
        self.free_records = .{};
        self.resolved_records = .{};
        @memset(&self.bytes_per_peer_kind, @splat(0));
        @memset(&self.pending_per_peer, 0);
        @memset(&self.pending_per_peer_kind, @splat(0));
        for (self.entries, 0..) |*entry, i| {
            if (entry.state == .pending) store.releaseValidation(entry.state.pending.message);
            entry.state = .free;
            entry.available_link = .{};
            entry.deadline_link = .{};
            if (entry.generation < std.math.maxInt(u64)) self.available_entries.append(self.entries, "available_link", @intCast(i));
        }
        for (self.recent, 0..) |*record, i| {
            self.releaseAttribution(record, peers);
            record.state = .free;
            record.link = .{};
            self.free_records.append(self.recent, "link", @intCast(i));
        }
        self.index.clear();
        assert(std.mem.allEqual(u32, self.topic_counts, 0));
    }

    pub fn backingBytes(capacity: usize) usize {
        return backingBytesForTopics(capacity, constants.topics_cap);
    }

    pub fn backingBytesForTopics(capacity: usize, topics: usize) usize {
        return topics * @sizeOf(u32) + capacity * @sizeOf(Entry) + attributionCapacity(capacity) * @sizeOf(Attribution) +
            mcache.indexCapacity(attributionCapacity(capacity)) * @sizeOf(u32);
    }

    pub fn attributionCapacity(capacity: usize) usize {
        return capacity * 4;
    }

    pub fn retainsTopic(self: *const Validation, topic: u16) bool {
        return self.topic_counts[topic] != 0;
    }

    pub fn available(self: *const Validation) bool {
        return self.available_entries.len > 0;
    }

    /// Requires an available entry, peer retention allowance, and no pending validation for this payload's ID.
    pub fn admit(self: *Validation, store: *storage.Store, peers: *Peers, message: storage.Handle, source: PeerRef, topic: u16, now: u64) Handle {
        const payload = store.get(message).?;
        const id = payload.id;
        const previous_record = self.index.find(id);
        var selected = self.available_entries.head;
        if (previous_record) |index| {
            const record = &self.recent[index];
            assert(record.state == .resolved);
            const previous = &self.entries[record.handle.index];
            if (previous.generation == record.handle.generation and previous.available_link.linked) selected = record.handle.index;
        }
        assert(selected != none);
        const record_index = previous_record orelse if (self.free_records.head != none) self.free_records.head else self.resolved_records.head;
        assert(record_index != none);
        const entry = &self.entries[selected];
        const record = &self.recent[record_index];
        self.available_entries.remove(self.entries, "available_link", selected);
        if (record.state == .free) self.free_records.remove(self.recent, "link", record_index) else {
            if (now < record.until and !std.mem.eql(u8, &record.id, &id))
                self.attribution_eviction_age.observe(now -| (record.until -| self.tombstone_ms));
            self.resolved_records.remove(self.recent, "link", record_index);
            self.index.remove(record.id);
            self.releaseAttribution(record, peers);
        }
        const handle: Handle = .{ .index = selected, .generation = entry.generation + 1 };
        const retained = peers.retain(source);
        assert(retained);
        self.pending_per_peer[source.index] += 1;
        self.pending_per_peer_kind[source.index][@intFromEnum(payload.kind)] += 1;
        self.bytes_per_peer_kind[source.index][@intFromEnum(payload.kind)] += chargedBytes(payload.len);
        record.* = .{ .handle = handle, .state = .pending, .id = id, .source = source, .topic = topic, .admitted_ms = now };
        assert(topic < self.topic_counts.len and self.topic_counts[topic] < self.recent.len);
        self.topic_counts[topic] += 1;
        self.index.insert(id, record_index);
        entry.* = .{ .generation = handle.generation, .state = .{ .pending = .{ .message = message, .delivery = record_index, .deadline = now +| self.timeout_ms } } };
        if (self.pending_entries.tail != none) assert(self.entries[self.pending_entries.tail].state.pending.deadline <= entry.state.pending.deadline);
        self.pending_entries.append(self.entries, "deadline_link", selected);
        store.retainValidation(message);
        return handle;
    }

    fn removeRecord(self: *Validation, index: u32, peers: *Peers) void {
        const record = &self.recent[index];
        if (record.state == .resolved) self.resolved_records.remove(self.recent, "link", index);
        self.index.remove(record.id);
        self.releaseAttribution(record, peers);
        record.state = .free;
        self.free_records.append(self.recent, "link", index);
    }

    pub fn chargedBytes(len: usize) usize {
        return @max(storage.inline_bytes, storage.Store.pagesFor(len) * storage.page_bytes);
    }

    fn releasePending(self: *Validation, store: *storage.Store, index: u32) void {
        const entry = &self.entries[index];
        const pending = entry.state.pending;
        const record = &self.recent[pending.delivery];
        const kind = @intFromEnum(store.get(pending.message).?.kind);
        assert(self.pending_per_peer[record.source.index] > 0);
        self.pending_per_peer[record.source.index] -= 1;
        self.pending_per_peer_kind[record.source.index][kind] -= 1;
        self.bytes_per_peer_kind[record.source.index][kind] -= chargedBytes(store.get(pending.message).?.len);
        self.pending_entries.remove(self.entries, "deadline_link", index);
        if (entry.generation < std.math.maxInt(u64)) self.available_entries.append(self.entries, "available_link", index);
        store.releaseValidation(pending.message);
    }

    pub fn attribution(self: *Validation, h: Handle) *Attribution {
        const e = &self.entries[h.index];
        assert(e.generation == h.generation and e.state == .pending);
        const record = &self.recent[e.state.pending.delivery];
        assert(record.state == .pending);
        return record;
    }

    pub fn find(self: *Validation, id: topic_mod.MessageId, now: u64) ?*Attribution {
        const slot = self.index.find(id) orelse return null;
        const record = &self.recent[slot];
        assert(record.state != .free);
        if (record.state == .resolved and now >= record.until) return null;
        return record;
    }

    pub fn duplicate(e: *Attribution, peers: *Peers, peer: PeerRef, eligible: bool) DuplicateResult {
        assert(e.state != .free);
        if (std.meta.eql(e.source, peer)) return .known;
        for (e.duplicates[0..e.duplicate_len]) |d| if (std.meta.eql(d.peer, peer)) return .known;
        if (e.duplicate_len == duplicates_max) return .full;
        if (e.state == .pending and !peers.retain(peer)) return .retention_full;
        e.duplicates[e.duplicate_len] = .{ .peer = peer, .eligible = eligible };
        e.duplicate_len += 1;
        return .recorded;
    }

    pub fn inspect(self: *Validation, store: *storage.Store, peers: *Peers, h: Handle, now: u64) ?Outcome {
        if (h.index >= self.entries.len) return .stale_handle;
        const e = &self.entries[h.index];
        if (e.generation != h.generation) return .stale_handle;
        self.expireEntry(store, peers, h.index, now);
        return switch (e.state) {
            .pending => null,
            .resolved => |until| if (now < until) .already_resolved else .stale_handle,
            .expired => |until| if (now < until) .expired else .stale_handle,
            .free => .stale_handle,
        };
    }

    pub fn finish(self: *Validation, store: *storage.Store, peers: *Peers, h: Handle, verdict: Verdict, now: u64) void {
        const e = &self.entries[h.index];
        assert(e.state == .pending and e.generation == h.generation and now < e.state.pending.deadline);
        const pending = e.state.pending;
        const record = &self.recent[pending.delivery];
        self.releasePending(store, h.index);
        releasePeers(record, peers);
        record.state = .resolved;
        record.verdict = verdict;
        record.until = now +| self.tombstone_ms;
        e.state = .{ .resolved = record.until };
        if (self.resolved_records.tail != none) assert(self.recent[self.resolved_records.tail].until <= record.until);
        self.resolved_records.append(self.recent, "link", pending.delivery);
    }

    pub fn cancel(self: *Validation, store: *storage.Store, peers: *Peers, h: Handle, now: u64) bool {
        if (self.inspect(store, peers, h, now) != null) return false;
        self.discardPending(store, peers, h.index);
        self.entries[h.index].state = .free;
        return true;
    }

    fn discardPending(self: *Validation, store: *storage.Store, peers: *Peers, index: u32) void {
        const pending = self.entries[index].state.pending;
        self.releasePending(store, index);
        self.removeRecord(pending.delivery, peers);
    }

    pub fn expire(self: *Validation, store: *storage.Store, peers: *Peers, now: u64) void {
        var bytes: usize = 0;
        for (0..64) |_| {
            const index = self.pending_entries.head;
            if (index == none or self.entries[index].state.pending.deadline > now) break;
            const size = store.get(self.entries[index].state.pending.message).?.len;
            if (bytes > 0 and size > 16 * 1024 * 1024 -| bytes) break;
            bytes += size;
            self.expireEntry(store, peers, index, now);
        }
        for (0..64) |_| {
            const index = self.resolved_records.head;
            if (index == none or self.recent[index].until > now) break;
            self.removeRecord(index, peers);
        }
    }

    fn expireEntry(self: *Validation, store: *storage.Store, peers: *Peers, index: u32, now: u64) void {
        const e = &self.entries[index];
        if (e.state != .pending or now < e.state.pending.deadline) return;
        const pending = e.state.pending;
        const record = &self.recent[pending.delivery];
        std.log.scoped(.network_gossip).debug("validation_expired message_id={x} topic_index={d} generation={d} elapsed_ms={d}", .{ record.id, record.topic, e.generation, now -| record.admitted_ms });
        self.discardPending(store, peers, index);
        e.state = .{ .expired = pending.deadline +| self.tombstone_ms };
    }

    pub fn nextDeadline(self: *const Validation) ?u64 {
        const pending = if (self.pending_entries.head == none) null else self.entries[self.pending_entries.head].state.pending.deadline;
        const resolved = if (self.resolved_records.head == none) null else self.recent[self.resolved_records.head].until;
        if (pending == null) return resolved;
        return if (resolved) |deadline| @min(pending.?, deadline) else pending;
    }
    fn releaseAttribution(self: *Validation, e: *Attribution, peers: *Peers) void {
        if (e.state == .free) return;
        assert(self.topic_counts[e.topic] > 0);
        self.topic_counts[e.topic] -= 1;
        if (e.state == .pending) releasePeers(e, peers);
    }

    fn releasePeers(e: *const Attribution, peers: *Peers) void {
        assert(e.state == .pending);
        peers.release(e.source);
        for (e.duplicates[0..e.duplicate_len]) |d| peers.release(d.peer);
    }
};

test {
    _ = @import("validation_test.zig");
}
