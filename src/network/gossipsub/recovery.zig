const std = @import("std");
const constants = @import("constants.zig");
const Peers = @import("peer_book.zig").PeerBook;
const PeerRef = @import("peer_book.zig").Ref;
const PeerScore = @import("score.zig").PeerScore;
const Handle = @import("../quic/Engine.zig").Handle;
const MessageId = @import("topic.zig").MessageId;
const assert = std.debug.assert;
const none = std.math.maxInt(u16);
const bucket_count = mcache.indexCapacity(constants.promises_cap);
const outbox_mod = @import("outbox.zig");
const mcache = @import("mcache.zig");

/// Every identity within the pin allowance keeps recovery room while others borrow the rest.
pub const promises_reserved_per_peer = 8;

pub const promises_per_peer = constants.max_ihave_per_heartbeat * constants.gossip_ids_max;

/// `next` links a batch's requests, or the free slots; `bucket_next` and `bucket_prev` link the
/// requests whose ids share a bucket; `batch` indexes the batch holding the request.
const Request = struct { id: MessageId = undefined, next: u16 = none, batch: u16 = none, bucket_next: u16 = none, bucket_prev: u16 = none };
pub const Batch = struct {
    peer: PeerRef,
    token: u64,
    connection: Handle,
    head: u16 = none,
    count: u16 = 0,
    sample: u16 = none,
    expiry: u64,
    sent_at_ms: ?u64 = null,
};

pub const Recovery = struct {
    requests: []Request,
    batches: []Batch,
    /// Chain heads by id hash. A request joins its chain when added and leaves it when released,
    /// before its slot can be reused, so a chain holds exactly the live requests of its bucket.
    /// Gossipsub keys the hash with host entropy, so peers cannot choose ids that share a chain.
    buckets: []u16,
    seed: u64 = 0,
    free: u16 = 0,
    len: usize = 0,
    batch_len: usize = 0,
    /// Sampled promises armed: batches whose IWANT send completed while their sample was
    /// outstanding. Only these can later expire broken.
    armed: u64 = 0,

    pub fn init(allocator: std.mem.Allocator) !Recovery {
        comptime assert(promises_per_peer < constants.promises_cap and constants.promises_cap < none and
            promises_reserved_per_peer * @import("peer_book.zig").pinned_capacity <= constants.promises_cap / 2);
        const requests = try allocator.alloc(Request, constants.promises_cap);
        errdefer allocator.free(requests);
        const batches = try allocator.alloc(Batch, constants.promises_cap);
        errdefer allocator.free(batches);
        const buckets = try allocator.alloc(u16, bucket_count);
        var result: Recovery = .{ .requests = requests, .batches = batches, .buckets = buckets };
        result.resetRequests();
        return result;
    }

    pub fn deinit(self: *Recovery, allocator: std.mem.Allocator, peers: *Peers) void {
        self.clear(peers);
        allocator.free(self.requests);
        allocator.free(self.batches);
        allocator.free(self.buckets);
        self.* = undefined;
    }

    pub fn clear(self: *Recovery, peers: *Peers) void {
        for (self.batches[0..self.batch_len]) |batch| peers.release(batch.peer);
        self.len = 0;
        self.batch_len = 0;
        self.resetRequests();
    }

    fn resetRequests(self: *Recovery) void {
        for (self.requests, 0..) |*request, i| request.* = .{ .next = if (i + 1 < self.requests.len) @intCast(i + 1) else none };
        @memset(self.buckets, none);
        self.free = 0;
    }

    fn bucket(self: *Recovery, id: *const MessageId) *u16 {
        return &self.buckets[@as(usize, @truncate(std.hash.Wyhash.hash(self.seed, id))) & (self.buckets.len - 1)];
    }

    pub fn available(self: *const Recovery) usize {
        return self.requests.len - self.len;
    }

    pub const Selection = struct { count: usize, capacity: usize };

    pub fn filterPending(self: *const Recovery, peers: *const Peers, peer: PeerRef, ids: []MessageId) error{PeerCapacity}!Selection {
        if (!peers.canRetain(peer)) return error.PeerCapacity;
        assert(ids.len <= constants.max_ihave_ids_per_heartbeat);
        std.sort.heap(MessageId, ids, {}, lessThan);
        var unique: usize = 0;
        for (ids) |id| {
            if (unique > 0 and std.mem.eql(u8, &ids[unique - 1], &id)) continue;
            ids[unique] = id;
            unique += 1;
        }
        var requested = std.StaticBitSet(constants.max_ihave_ids_per_heartbeat).empty;
        assert(peers.matches(peer));
        var pending: [constants.retained_peers_cap]u16 = @splat(0);
        for (self.batches[0..self.batch_len]) |batch| {
            pending[batch.peer.index] += batch.count;
            if (!std.meta.eql(batch.peer, peer)) continue;
            var slot = batch.head;
            for (0..batch.count) |_| {
                const request = self.requests[slot];
                if (std.sort.binarySearch(MessageId, ids[0..unique], &request.id, compare)) |index| requested.set(index);
                slot = request.next;
            }
            assert(slot == none);
        }
        const newly_pinned: u16 = @intFromBool(peers.rows[peer.index].pins == 0);
        var protected: usize = @as(usize, peers.pin_limit - peers.pinned - newly_pinned) * promises_reserved_per_peer;
        for (pending[0..peers.rows.len], 0..) |used, index| {
            if (index != peer.index and peers.rows[index].pins > 0) protected += promises_reserved_per_peer -| used;
        }
        const capacity = @min(self.available() -| protected, promises_per_peer -| pending[peer.index]);
        if (capacity == 0) return error.PeerCapacity;
        var count: usize = 0;
        for (ids[0..unique], 0..) |id, index| {
            if (requested.isSet(index)) continue;
            ids[count] = id;
            count += 1;
        }
        return .{ .count = count, .capacity = capacity };
    }

    pub fn selectionWork(ids: usize, batches: usize, requests: usize) usize {
        assert(ids <= constants.max_ihave_ids_per_heartbeat and batches <= constants.promises_cap and requests <= constants.promises_cap);
        const levels = std.math.log2_int_ceil(usize, @max(ids, 2));
        // Heap construction and removal visit at most 3n/2 paths. Each level
        // compares two ID pairs and swaps three IDs. Include deduplication,
        // compaction, binary-search comparisons and the batch/bitset scans.
        return 2 * @sizeOf([constants.retained_peers_cap]u16) + 16 * ids * (levels + 1) * @sizeOf(MessageId) +
            requests * (levels + 1) * 2 * @sizeOf(MessageId) +
            batches * @sizeOf(Batch) + @sizeOf(std.StaticBitSet(constants.max_ihave_ids_per_heartbeat));
    }

    fn lessThan(_: void, left: MessageId, right: MessageId) bool {
        return std.mem.lessThan(u8, &left, &right);
    }

    fn compare(left: *const MessageId, right: MessageId) std.math.Order {
        return std.mem.order(u8, left, &right);
    }

    pub fn backingBytes() usize {
        return constants.promises_cap * (@sizeOf(Request) + @sizeOf(Batch)) + bucket_count * @sizeOf(u16);
    }

    /// Commit a nonempty subset admitted by filterPending, without intervening recovery mutation.
    pub fn requestBatch(self: *Recovery, peers: *Peers, outbox: *outbox_mod.Outbox, scratch: *outbox_mod.ControlScratch, ids: []const MessageId, peer: PeerRef, connection: Handle, random: std.Random, followup_ms: u64, now: u64) error{ OutboxFull, PeerCapacity }!void {
        assert(ids.len > 0 and ids.len <= constants.gossip_ids_max and ids.len <= self.available());
        const index = self.batch_len;
        try self.addBatch(peers, ids, peer, connection, 0, random.uintLessThan(usize, ids.len), now +| followup_ms);
        const token = outbox.submit(&.{ .iwant = ids }, scratch, now) orelse {
            self.remove(peers, index);
            return error.OutboxFull;
        };
        self.batches[index].token = token;
    }

    pub fn add(self: *Recovery, peers: *Peers, id: MessageId, peer: PeerRef, connection: Handle, token: u64, expiry: u64) error{PeerCapacity}!void {
        try self.addBatch(peers, &.{id}, peer, connection, token, 0, expiry);
    }

    pub fn addBatch(self: *Recovery, peers: *Peers, ids: []const MessageId, peer: PeerRef, connection: Handle, token: u64, sample: usize, expiry: u64) error{PeerCapacity}!void {
        assert(ids.len > 0 and ids.len <= constants.gossip_ids_max and ids.len <= self.available() and sample < ids.len);
        if (!peers.retain(peer)) return error.PeerCapacity;
        const index: u16 = @intCast(self.batch_len);
        const batch = &self.batches[index];
        batch.* = .{ .peer = peer, .connection = connection, .token = token, .expiry = expiry, .count = @intCast(ids.len) };
        for (ids, 0..) |id, i| {
            const slot = self.free;
            assert(slot != none);
            self.free = self.requests[slot].next;
            const head = self.bucket(&id);
            self.requests[slot] = .{ .id = id, .next = batch.head, .batch = index, .bucket_next = head.* };
            if (head.* != none) self.requests[head.*].bucket_prev = slot;
            head.* = slot;
            batch.head = slot;
            if (i == sample) batch.sample = slot;
        }
        self.len += ids.len;
        self.batch_len += 1;
    }

    /// Resolves every request for `id` and returns the bytes visited, for the caller's work budget.
    pub fn resolve(self: *Recovery, peers: *Peers, id: MessageId) usize {
        var chained: usize = 0;
        var walked: usize = 0;
        var resolved: usize = 0;
        var slot = self.bucket(&id).*;
        for (0..self.requests.len) |_| {
            if (slot == none) break;
            const request = self.requests[slot];
            chained += 1;
            if (std.mem.eql(u8, &request.id, &id)) {
                walked += self.detach(peers, slot);
                resolved += 1;
            }
            slot = request.bucket_next;
        }
        assert(slot == none);
        // Hashing the id and reading its bucket, comparing each chained request, and per resolved
        // request the requests walked in its batch and in the batch moved into its place.
        return @sizeOf(MessageId) + @sizeOf(u16) + chained * (@sizeOf(Request) + @sizeOf(MessageId)) +
            walked * @sizeOf(Request) + resolved * 2 * @sizeOf(Batch);
    }

    /// Unlinks a resolved request from its batch and removes the batch once empty. Returns the
    /// requests visited besides it: those ahead of it in its batch and those of a moved batch.
    fn detach(self: *Recovery, peers: *Peers, slot: u16) usize {
        const index = self.requests[slot].batch;
        const batch = &self.batches[index];
        var link = &batch.head;
        var visited: usize = 0;
        for (0..batch.count) |_| {
            if (link.* == slot) break;
            link = &self.requests[link.*].next;
            visited += 1;
        }
        assert(link.* == slot);
        link.* = self.requests[slot].next;
        if (batch.sample == slot) batch.sample = none;
        batch.count -= 1;
        self.releaseRequest(slot);
        if (batch.count > 0) return visited;
        const moved = self.batches[self.batch_len - 1].count;
        self.remove(peers, index);
        return visited + moved;
    }

    pub const Cancellation = struct { removed: u64 = 0, work: usize = 0 };

    /// Counts the batches and requests visited, including requests relinked by compaction.
    pub fn cancel(self: *Recovery, peers: *Peers, connection: Handle, local_pressure: bool) Cancellation {
        var result: Cancellation = .{};
        var index: usize = 0;
        const count = self.batch_len;
        for (0..count) |_| {
            if (index == self.batch_len) break;
            const batch = self.batches[index];
            result.work += @sizeOf(Batch);
            if (std.meta.eql(batch.connection, connection) and (local_pressure or batch.sent_at_ms == null)) {
                result.removed += batch.count;
                result.work += @as(usize, batch.count) * @sizeOf(Request);
                if (index + 1 < self.batch_len) result.work += @sizeOf(Batch) + @as(usize, self.batches[self.batch_len - 1].count) * @sizeOf(Request);
                self.remove(peers, index);
            } else index += 1;
        }
        return result;
    }

    pub fn controlSent(self: *Recovery, connection: Handle, token: u64, followup_ms: u64, now_ms: u64) void {
        assert(followup_ms > 0 and followup_ms <= 86_400_000);
        for (self.batches[0..self.batch_len]) |*batch| {
            if (batch.sent_at_ms == null and now_ms < batch.expiry and batch.token == token and std.meta.eql(batch.connection, connection)) {
                batch.expiry = now_ms +| followup_ms;
                batch.sent_at_ms = now_ms;
                self.armed +|= @intFromBool(batch.sample != none);
            }
        }
    }

    pub fn expire(self: *Recovery, peers: *Peers, now_ms: u64) u64 {
        var broken: u64 = 0;
        var index: usize = 0;
        const count = self.batch_len;
        for (0..count) |_| {
            if (index == self.batch_len) break;
            const batch = self.batches[index];
            assert(peers.matches(batch.peer));
            if (now_ms >= batch.expiry) {
                if (batch.sent_at_ms != null and batch.sample != none) {
                    broken += 1;
                    peers.penalize(batch.peer, .broken_iwant);
                }
                self.remove(peers, index);
            } else index += 1;
        }
        return broken;
    }

    fn releaseRequest(self: *Recovery, slot: u16) void {
        const request = &self.requests[slot];
        if (request.bucket_prev == none) {
            const head = self.bucket(&request.id);
            assert(head.* == slot);
            head.* = request.bucket_next;
        } else self.requests[request.bucket_prev].bucket_next = request.bucket_next;
        if (request.bucket_next != none) self.requests[request.bucket_next].bucket_prev = request.bucket_prev;
        request.next = self.free;
        self.free = slot;
        self.len -= 1;
    }

    fn remove(self: *Recovery, peers: *Peers, index: usize) void {
        assert(index < self.batch_len);
        const batch = self.batches[index];
        var slot = batch.head;
        for (0..batch.count) |_| {
            const next = self.requests[slot].next;
            self.releaseRequest(slot);
            slot = next;
        }
        assert(slot == none);
        peers.release(batch.peer);
        self.batch_len -= 1;
        if (index == self.batch_len) return;
        const moved = &self.batches[index];
        moved.* = self.batches[self.batch_len];
        slot = moved.head;
        for (0..moved.count) |_| {
            self.requests[slot].batch = @intCast(index);
            slot = self.requests[slot].next;
        }
        assert(slot == none);
    }
};

test {
    _ = @import("recovery_test.zig");
}
