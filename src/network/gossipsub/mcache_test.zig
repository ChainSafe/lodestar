const std = @import("std");
const mcache = @import("mcache.zig");
const SeenCache = mcache.SeenCache;
const History = mcache.History;
const HistoryEntry = mcache.HistoryEntry;
const CountingAllocator = @import("../counting_allocator.zig").CountingAllocator;
const MessageId = @import("topic.zig").MessageId;
const Index = mcache.IdIndex(MessageId);
const PeerRef = @import("peer_book.zig").Ref;
const storage = @import("message_store.zig");
const constants = @import("constants.zig");
const topic = @import("topic.zig");
const topic_policy = @import("topic_policy.zig");
const gossip_limits = @import("../gossip_limits.zig");

test "gossip full pending kind refuses admission without evicting history" {
    const names = [_][]const u8{
        "/eth2/01020304/beacon_block/ssz_snappy",
        "/eth2/01020304/beacon_aggregate_and_proof/ssz_snappy",
        "/eth2/01020304/beacon_attestation_0/ssz_snappy",
        "/eth2/01020304/proposer_slashing/ssz_snappy",
        "/eth2/01020304/attester_slashing/ssz_snappy",
        "/eth2/01020304/voluntary_exit/ssz_snappy",
        "/eth2/01020304/sync_committee_contribution_and_proof/ssz_snappy",
        "/eth2/01020304/sync_committee_0/ssz_snappy",
        "/eth2/01020304/light_client_finality_update/ssz_snappy",
        "/eth2/01020304/light_client_optimistic_update/ssz_snappy",
        "/eth2/01020304/bls_to_execution_change/ssz_snappy",
        "/eth2/01020304/blob_sidecar_0/ssz_snappy",
        "/eth2/01020304/data_column_sidecar_0/ssz_snappy",
        "/eth2/01020304/execution_payload/ssz_snappy",
        "/eth2/01020304/payload_attestation_message/ssz_snappy",
        "/eth2/01020304/execution_payload_bid/ssz_snappy",
        "/eth2/01020304/proposer_preferences/ssz_snappy",
    };
    const limits: gossip_limits.Limits = @splat(.{ .items = 2, .bytes = 1024 * 1024 });
    var store = try storage.Store.init(std.testing.allocator, 2 * gossip_limits.items(&limits), 2 * gossip_limits.bytes(&limits));
    defer store.deinit(std.testing.allocator);
    store.limits = limits;
    var history = try History.init(std.testing.allocator, gossip_limits.items(&limits), 1, gossip_limits.kind_count);
    defer history.deinit(std.testing.allocator);
    const payload = [_]u8{9} ** (storage.inline_bytes + 1);
    var pending: [2 * gossip_limits.kind_count]storage.Handle = undefined;
    for (names, 0..) |name, i| {
        try std.testing.expectEqual(@as(topic.Kind, @enumFromInt(i)), topic.parseCanonical(name).?.name.kind);
        for (0..2) |j| {
            const cached = store.put(topic.parseCanonical(name).?.name.kind, @splat(@intCast(4 * i + 2 * j)), name, &payload).?;
            history.put(&store, cached, @intCast(i), 0);
            store.seal(cached);
            pending[2 * i + j] = store.put(topic.parseCanonical(name).?.name.kind, @splat(@intCast(4 * i + 2 * j + 1)), name, &payload).?;
            store.retainValidation(pending[2 * i + j]);
            store.seal(pending[2 * i + j]);
        }
    }
    try std.testing.expectEqual(store.entries.len, store.used_entries);
    const free_pages = store.free_pages;
    try std.testing.expectEqual(@as(usize, 2 * gossip_limits.kind_count), history.count);
    try std.testing.expect(history.admitPayload(&store, .beacon_block, @splat(255), names[0], &payload) == null);
    try std.testing.expectEqual(@as(usize, 2 * gossip_limits.kind_count), history.count);
    try std.testing.expectEqual(free_pages, store.free_pages);
    for (pending) |handle| store.releaseValidation(handle);
}

test "gossip history visits only matching topics through eviction and replacement" {
    const a = std.testing.allocator;
    var store = try storage.Store.init(a, 65, storage.page_bytes);
    defer store.deinit(a);
    var history = try History.init(a, 64, 1, 35);
    defer history.deinit(a);
    var names: [32][32]u8 = undefined;
    var lengths: [32]usize = undefined;
    for (&names, &lengths, 0..) |*name, *len, i| len.* = (try std.fmt.bufPrint(name, "topic-{d}", .{i})).len;
    for (0..64) |i| {
        const h = store.put(.beacon_block, @splat(@intCast(i)), names[i % 32][0..lengths[i % 32]], "payload").?;
        history.put(&store, h, @intCast(i % 32), 0);
        store.seal(h);
    }
    var ids: [64]MessageId = undefined;
    for (0..32) |ordinal| try std.testing.expectEqual(@as(usize, 2), history.gossip(@intCast(ordinal), &ids, 1));
    try std.testing.expectEqual(@as(u64, 64), history.gossip_entries_visited);
    try std.testing.expectEqual(@as(usize, 0), history.gossip(34, &ids, 1));
    try std.testing.expectEqual(@as(u64, 64), history.gossip_entries_visited);
    const replacement = store.put(.beacon_block, @splat(0), "replacement", "new").?;
    history.put(&store, replacement, 32, 1);
    store.seal(replacement);
    try std.testing.expectEqual(@as(usize, 1), history.gossip(0, &ids, 2));
    try std.testing.expectEqualSlices(u8, &(@as(MessageId, @splat(32))), &ids[0]);
    try std.testing.expectEqual(@as(usize, 1), history.gossip(32, &ids, 2));
    history.age(&store, constants.mcache_len);
    try std.testing.expectEqual(@as(usize, 1), history.count);
    for (0..32) |ordinal| try std.testing.expectEqual(@as(usize, 0), history.gossip(@intCast(ordinal), &ids, constants.mcache_len));
    history.age(&store, constants.mcache_len + 1);
    try std.testing.expectEqual(@as(usize, 0), history.count);
    for (0..64) |i| {
        const h = store.put(.beacon_block, @splat(@intCast(i)), "reused", "payload").?;
        history.put(&store, h, 33, 10);
        store.seal(h);
    }
    try std.testing.expectEqual(@as(usize, 64), history.gossip(33, &ids, 11));
    try std.testing.expectEqual(@as(usize, 0), history.gossip(32, &ids, 11));
}

test "gossip history cleans up every partial index allocation" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, initHistory, .{});
}

fn initHistory(a: std.mem.Allocator) !void {
    var history = try History.init(a, 8, 2, 1);
    defer history.deinit(a);
}

test "gossip history covers the full namespace independently of message capacity" {
    const a = std.testing.allocator;
    try std.testing.expectError(error.InvalidLimits, History.init(a, 2, 1, 0));
    try std.testing.expectError(error.InvalidLimits, History.init(a, 2, 1, topic_policy.topic_max + 1));
    var store = try storage.Store.init(a, 3, storage.page_bytes);
    defer store.deinit(a);
    var history = try History.init(a, 2, 1, topic_policy.topic_max);
    defer history.deinit(a);
    const last = topic_policy.topic_max - 1;
    const high = store.put(.beacon_block, @splat(1), "high", "payload").?;
    history.put(&store, high, last, 0);
    store.seal(high);
    const low = store.put(.beacon_block, @splat(2), "low", "payload").?;
    history.put(&store, low, 0, 0);
    store.seal(low);
    var ids: [2]MessageId = undefined;
    try std.testing.expectEqual(@as(usize, 1), history.gossip(last, &ids, 1));
    try std.testing.expectEqual(@as(MessageId, @splat(1)), ids[0]);
    const replacement = store.put(.beacon_block, @splat(3), "low", "replacement").?;
    history.put(&store, replacement, 0, 1);
    store.seal(replacement);
    try std.testing.expect(store.get(high) == null);
    try std.testing.expectEqual(@as(usize, 0), history.gossip(last, &ids, 2));
    try std.testing.expectEqual(@as(usize, 2), history.gossip(0, &ids, 2));
    try std.testing.expectEqual(@as(MessageId, @splat(2)), ids[0]);
    try std.testing.expectEqual(@as(MessageId, @splat(3)), ids[1]);
    try std.testing.expectEqualStrings("low", store.get(low).?.topicString());
    history.age(&store, constants.mcache_len + 1);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
}

test "seen cache dedupes, evicts oldest when full, and expires by ttl" {
    var cache = try SeenCache.init(std.testing.allocator, 4, 1_000);
    defer cache.deinit(std.testing.allocator);
    const a = [_]u8{1} ** 20;
    const b = [_]u8{2} ** 20;
    try std.testing.expect(cache.add(a, 0));
    try std.testing.expect(!cache.add(a, 0));
    try std.testing.expect(cache.contains(a, 400));
    try std.testing.expect(cache.add(b, 100));
    // fill past capacity: a evicts
    try std.testing.expect(cache.add([_]u8{3} ** 20, 200));
    try std.testing.expect(cache.add([_]u8{4} ** 20, 300));
    try std.testing.expect(cache.add([_]u8{5} ** 20, 400));
    try std.testing.expect(!cache.contains(a, 400));
    try std.testing.expect(cache.contains(b, 400));
    // ttl expiry from the tail
    try std.testing.expect(cache.add([_]u8{6} ** 20, 1_500));
    try std.testing.expect(!cache.contains(b, 400));
}

test "gossip seen TTL applies to duplicate only traffic" {
    var cache = try SeenCache.init(std.testing.allocator, 4, 10);
    defer cache.deinit(std.testing.allocator);
    const id = [_]u8{1} ** 20;
    try std.testing.expect(cache.add(id, 1));
    try std.testing.expect(!cache.add(id, 10));
    try std.testing.expect(!cache.contains(id, 11));
    try std.testing.expect(cache.add(id, 11));
}

test "gossip history indexed replacement keeps FIFO age and invalidates old handles" {
    var store = try storage.Store.init(std.testing.allocator, 4, 16384);
    defer store.deinit(std.testing.allocator);
    var history = try History.init(std.testing.allocator, 2, constants.retained_peers_cap, 2);
    defer history.deinit(std.testing.allocator);
    const a = [_]u8{1} ** 20;
    const b = [_]u8{2} ** 20;
    const first = store.put(.beacon_block, a, "a", "old").?;
    history.put(&store, first, 0, 0);
    store.seal(first);
    const second = store.put(.beacon_block, b, "b", "other").?;
    history.put(&store, second, 1, 0);
    store.seal(second);
    history.age(&store, 1);
    const replacement = store.put(.beacon_block, a, "a", "new").?;
    history.put(&store, replacement, 0, 1);
    store.seal(replacement);
    try std.testing.expectEqual(@as(usize, 2), history.count);
    try std.testing.expectEqual(replacement, history.message(history.get(&store, a).?));
    try std.testing.expect(store.get(first) == null);
    history.age(&store, constants.mcache_len);
    try std.testing.expect(history.get(&store, b) == null);
    try std.testing.expect(history.get(&store, a) != null);
    history.age(&store, constants.mcache_len + 1);
    try std.testing.expectEqual(@as(usize, 0), history.count);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
}

test "gossip ID index bounds sparse misses and repairs wrapped collision clusters" {
    var ids: [64]MessageId = undefined;
    var index = try Index.init(std.testing.allocator, &ids);
    defer index.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 0), index.probe_limit);
    try std.testing.expect(index.find(@splat(0)) == null);
    var count: usize = 0;
    for (0..65_536) |candidate| {
        var id: MessageId = @splat(0);
        std.mem.writeInt(u64, id[0..8], candidate, .little);
        if (std.hash.Wyhash.hash(index.seed, &id) & index.mask != index.mask) continue;
        ids[count] = id;
        index.insert(id, @intCast(count));
        count += 1;
        try std.testing.expectEqual(count, index.probe_limit);
        if (count == ids.len) break;
    }
    try std.testing.expectEqual(ids.len, count);
    var present = std.StaticBitSet(64).full;
    for ([_]usize{ 0, 32, 63, 1, 31, 62 }) |removed| {
        index.remove(ids[removed]);
        present.unset(removed);
        try std.testing.expectEqual(ids.len, index.probe_limit);
        for (ids, 0..) |id, i| try std.testing.expectEqual(if (present.isSet(i)) @as(?u32, @intCast(i)) else null, index.find(id));
    }
    index.clear();
    try std.testing.expectEqual(@as(usize, 0), index.probe_limit);
    for (ids) |id| try std.testing.expect(index.find(id) == null);
    index.insert(ids[63], 63);
    try std.testing.expectEqual(@as(usize, 1), index.probe_limit);
    try std.testing.expect(index.find(ids[0]) == null);
    try std.testing.expectEqual(@as(?u32, 63), index.find(ids[63]));
}

test "gossip policy recovery permits more than sixteen distinct recipients" {
    var history = try History.init(std.testing.allocator, 2, constants.retained_peers_cap, 1);
    defer history.deinit(std.testing.allocator);
    const slot: u32 = 0;
    for (0..32) |i| {
        const peer: PeerRef = .{ .index = @intCast(i), .generation = 1 };
        history.bindPeer(peer);
        try std.testing.expect(history.iwantAllowed(slot, peer, 3));
        for (0..3) |_| history.sent(slot, peer);
        try std.testing.expect(!history.iwantAllowed(slot, peer, 3));
    }
    history.bindPeer(.{ .index = 0, .generation = 2 });
    try std.testing.expect(history.iwantAllowed(slot, .{ .index = 0, .generation = 2 }, 3));
}

test "gossip history entries keep peer generations outside message rows" {
    try std.testing.expect(@sizeOf(HistoryEntry) < 1024);
}

test "gossip history stale peer cannot restore retransmission allowance" {
    var history = try History.init(std.testing.allocator, 2, constants.retained_peers_cap, 1);
    defer history.deinit(std.testing.allocator);
    const slot: u32 = 0;
    const current: PeerRef = .{ .index = 0, .generation = (@as(u64, 1) << 40) + 2 };
    const stale: PeerRef = .{ .index = 0, .generation = current.generation - 1 };
    history.bindPeer(current);
    for (0..3) |_| history.sent(slot, current);
    try std.testing.expect(!history.iwantAllowed(slot, stale, 3));
    history.bindPeer(stale);
    history.sent(slot, stale);
    try std.testing.expect(!history.iwantAllowed(slot, current, 3));
}

test "gossip history replacement resets message retransmission counts" {
    var store = try storage.Store.init(std.testing.allocator, 4, 16384);
    defer store.deinit(std.testing.allocator);
    var history = try History.init(std.testing.allocator, 2, 5, 1);
    defer history.deinit(std.testing.allocator);
    const id: MessageId = @splat(1);
    const first = store.put(.beacon_block, id, "t", "first").?;
    history.put(&store, first, 0, 0);
    store.seal(first);
    const other_id: MessageId = @splat(2);
    const other = store.put(.beacon_block, other_id, "t", "other").?;
    history.put(&store, other, 0, 0);
    store.seal(other);
    const peer: PeerRef = .{ .index = 4, .generation = 1 };
    history.bindPeer(peer);
    for (0..3) |_| {
        history.sent(history.get(&store, id).?, peer);
        history.sent(history.get(&store, other_id).?, peer);
    }
    const replacement = store.put(.beacon_block, id, "t", "replacement").?;
    history.put(&store, replacement, 0, 0);
    store.seal(replacement);
    try std.testing.expect(history.iwantAllowed(history.get(&store, id).?, peer, 3));
    try std.testing.expect(history.iwantAllowed(history.get(&store, id).?, peer, 1));
    try std.testing.expect(!history.iwantAllowed(history.get(&store, other_id).?, peer, 3));
    try std.testing.expectEqual(@as(usize, 2), store.used_entries);
}

test "gossip history canonical identity replacement clears only its bounded peer column" {
    var history = try History.init(std.testing.allocator, 3, constants.retained_peers_cap, 1);
    defer history.deinit(std.testing.allocator);
    const peer: PeerRef = .{ .index = 0, .generation = (@as(u64, 1) << 40) + 1 };
    const other: PeerRef = .{ .index = 1, .generation = 1 };
    history.bindPeer(peer);
    history.bindPeer(other);
    for (0..history.entries.len) |i| {
        for (0..3) |_| history.sent(@intCast(i), peer);
        history.sent(@intCast(i), other);
    }
    history.bindPeer(peer);
    for (0..history.entries.len) |i| try std.testing.expect(!history.iwantAllowed(@intCast(i), peer, 3));
    const replacement: PeerRef = .{ .index = 0, .generation = std.math.maxInt(u64) };
    history.bindPeer(replacement);
    for (0..history.entries.len) |i| {
        try std.testing.expect(history.iwantAllowed(@intCast(i), replacement, 3));
        try std.testing.expect(!history.iwantAllowed(@intCast(i), peer, 3));
        try std.testing.expect(history.iwantAllowed(@intCast(i), replacement, 1));
        try std.testing.expect(!history.iwantAllowed(@intCast(i), other, 1));
        try std.testing.expect(history.iwantAllowed(@intCast(i), other, 2));
        for (0..3) |_| history.sent(@intCast(i), replacement);
    }
    history.bindPeer(peer);
    for (0..history.entries.len) |i| {
        history.sent(@intCast(i), peer);
        try std.testing.expect(!history.iwantAllowed(@intCast(i), replacement, 3));
    }
}

test "gossip history packed counters isolate peers and message rows at partial byte boundaries" {
    var ledger: CountingAllocator = .{ .backing = std.testing.allocator };
    var history = try History.init(ledger.allocator(), 2, 5, 1);
    defer history.deinit(ledger.allocator());
    try std.testing.expectEqual(ledger.bytes, History.backingBytes(2, 5, 1));
    try std.testing.expectEqual(@as(usize, 4), history.counts.len);
    for (0..5) |i| history.bindPeer(.{ .index = @intCast(i), .generation = 1 });
    for (0..5) |i| {
        const peer: PeerRef = .{ .index = @intCast(i), .generation = 1 };
        for (0..3) |sent| {
            try std.testing.expect(history.iwantAllowed(0, peer, @intCast(sent + 1)));
            history.sent(0, peer);
            try std.testing.expect(!history.iwantAllowed(0, peer, @intCast(sent + 1)));
        }
        for (0..5) |j| {
            const other: PeerRef = .{ .index = @intCast(j), .generation = 1 };
            try std.testing.expectEqual(j > i, history.iwantAllowed(0, other, 1));
            try std.testing.expect(history.iwantAllowed(1, other, 1));
        }
    }
    try std.testing.expect(!history.iwantAllowed(0, .{ .index = 5, .generation = 1 }, 3));
    history.sent(0, .{ .index = 5, .generation = 1 });
    for (0..5) |i| try std.testing.expect(!history.iwantAllowed(0, .{ .index = @intCast(i), .generation = 1 }, 3));
}

test "gossip failed admission preserves history borrowed by validation" {
    const a = std.testing.allocator;
    var store = try storage.Store.init(a, 3, storage.page_bytes * 2);
    defer store.deinit(a);
    var history = try History.init(a, 2, 2, 1);
    defer history.deinit(a);
    var handles: [2]storage.Handle = undefined;
    for (&handles, 0..) |*handle, i| {
        const id: MessageId = @splat(@intCast(i));
        handle.* = history.admitPayload(&store, .beacon_block, id, "topic", &([_]u8{1} ** (storage.inline_bytes + 1))).?;
        history.put(&store, handle.*, 0, 0);
        store.seal(handle.*);
        store.retainValidation(handle.*);
    }
    defer for (handles) |handle| store.releaseValidation(handle);
    try std.testing.expectEqual(@as(usize, 2), history.count);
    try std.testing.expect(history.admitPayload(&store, .beacon_block, @splat(9), "topic", &([_]u8{1} ** (storage.inline_bytes + 1))) == null);
    try std.testing.expectEqual(@as(usize, 2), history.count);
    try std.testing.expectEqual(@as(usize, 0), store.free_pages);
}

test "gossip history emits three windows and defers arrivals during a cycle" {
    const a = std.testing.allocator;
    var store = try storage.Store.init(a, 3, 3 * storage.page_bytes);
    defer store.deinit(a);
    var history = try History.init(a, 3, 2, 1);
    defer history.deinit(a);
    const first = store.put(.beacon_block, @splat(1), "topic", "first").?;
    history.put(&store, first, 0, 0);
    store.seal(first);
    var epoch: u64 = 1;
    const second = store.put(.beacon_block, @splat(2), "topic", "second").?;
    history.put(&store, second, 0, epoch);
    store.seal(second);
    var ids: [3]MessageId = undefined;
    try std.testing.expectEqual(@as(usize, 1), history.gossip(0, &ids, epoch));
    history.age(&store, epoch);
    for (0..2) |_| {
        epoch += 1;
        try std.testing.expectEqual(@as(usize, 2), history.gossip(0, &ids, epoch));
        history.age(&store, epoch);
    }
    epoch += 1;
    try std.testing.expectEqual(@as(usize, 1), history.gossip(0, &ids, epoch));
    try std.testing.expectEqual(@as(MessageId, @splat(2)), ids[0]);
    history.age(&store, epoch);
    epoch += 1;
    try std.testing.expectEqual(@as(usize, 0), history.gossip(0, &ids, epoch));
    history.age(&store, epoch);
}

fn retainNext(history: *History, store: *storage.Store, index: u32, ordinal: u16, name: []const u8) bool {
    var id: MessageId = @splat(0);
    std.mem.writeInt(u32, id[0..4], index, .little);
    const h = store.put(topic.parseCanonical(name).?.name.kind, id, name, "x").?;
    defer store.seal(h);
    if (!history.makeRoom(store, h)) return false;
    history.put(store, h, ordinal, 0);
    return true;
}

test "gossip retention reclaims its own kind's old copies however many other messages follow them" {
    const a = std.testing.allocator;
    const limits_mod = @import("../gossip_limits.zig");
    const attestation = "/eth2/01020304/beacon_attestation_1/ssz_snappy";
    const exit = "/eth2/01020304/voluntary_exit/ssz_snappy";
    var limits: limits_mod.Limits = @splat(.{ .items = 2, .bytes = storage.page_bytes });
    limits[@intFromEnum(topic.Kind.beacon_attestation)].items = 9000;
    limits[@intFromEnum(topic.Kind.voluntary_exit)].items = 8;
    // The old 8,192-entry history and one holding the whole retention window admit the same exits:
    // the smaller one ages the first exits out by capacity, the larger reclaims one by retention.
    for ([_]usize{ 8192, 8300 }, [_]usize{ 8192, 8264 }) |capacity, retained| {
        var store = try storage.Store.init(a, capacity + 2, storage.page_bytes);
        defer store.deinit(a);
        store.limits = limits;
        var history = try History.init(a, capacity, 1, 2);
        defer history.deinit(a);
        var index: u32 = 0;
        for ([_]struct { []const u8, usize, u16 }{ .{ attestation, 64, 0 }, .{ exit, 8, 1 }, .{ attestation, 8192, 0 }, .{ exit, 1, 1 } }) |run| {
            for (0..run[1]) |_| {
                try std.testing.expect(retainNext(&history, &store, index, run[2], run[0]));
                index += 1;
            }
        }
        try std.testing.expectEqual(retained, history.count);
        history.age(&store, constants.mcache_len);
        try std.testing.expectEqual(@as(usize, 0), store.used_entries);
    }
}
