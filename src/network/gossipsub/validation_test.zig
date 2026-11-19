const Outcome = @import("validation.zig").Outcome;
const PeerRef = @import("validation.zig").PeerRef;
const Peers = @import("peer_book.zig").PeerBook;
const Validation = @import("validation.zig").Validation;
const Verdict = @import("validation.zig").Verdict;
const std = @import("std");
const storage = @import("message_store.zig");
const topic_mod = @import("topic.zig");
const validation = @import("validation.zig");

test "gossip validation topic pins follow attribution ownership through replacement expiry and clear" {
    const a = std.testing.allocator;
    var peers = try Peers.init(a, &.{ .connected_capacity = 2, .retained_capacity = 5, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(a);
    peers.rows[0] = .{ .occupied = true, .generation = 1, .admission_source = .{ .ip4 = @splat(0) } };
    const source: PeerRef = .{ .index = 0, .generation = 1 };
    var store = try storage.Store.init(a, 3, storage.page_bytes);
    defer store.deinit(a);
    var v = try Validation.init(a, 2, 10, 20);
    defer v.deinit(a, &store, &peers);
    var handles: [2]validation.Handle = undefined;
    for (&handles, 0..) |*handle, i| {
        const m = store.put(.beacon_block, @splat(@intCast(i)), "topic", "payload").?;
        handle.* = v.admit(&store, &peers, m, source, 0, 0);
        store.seal(m);
    }
    try std.testing.expectEqual(@as(u32, 2), v.topic_counts[0]);
    v.finish(&store, &peers, handles[0], .accept, 1);
    const replacement = store.put(.beacon_block, @splat(0), "other", "payload").?;
    const current = v.admit(&store, &peers, replacement, source, 1, 2);
    store.seal(replacement);
    try std.testing.expectEqual(@as(u32, 1), v.topic_counts[0]);
    try std.testing.expectEqual(@as(u32, 1), v.topic_counts[1]);
    v.expire(&store, &peers, 10);
    try std.testing.expect(!v.retainsTopic(0));
    try std.testing.expect(v.retainsTopic(1));
    v.finish(&store, &peers, current, .ignore, 11);
    v.expire(&store, &peers, 30);
    try std.testing.expect(v.retainsTopic(1));
    v.expire(&store, &peers, 31);
    try std.testing.expect(std.mem.allEqual(u32, v.topic_counts, 0));
    try std.testing.expectEqual(@as(u64, 0), v.attribution_eviction_age.count);
    for (0..10) |i| {
        const m = store.put(.beacon_block, @splat(@intCast(i + 10)), "topic", "payload").?;
        const handle = v.admit(&store, &peers, m, source, @intCast(i % 2), 32 + i);
        store.seal(m);
        v.finish(&store, &peers, handle, .accept, 32 + i);
    }
    try std.testing.expectEqual(@as(u32, 4), v.topic_counts[0]);
    try std.testing.expectEqual(@as(u32, 4), v.topic_counts[1]);
    try std.testing.expectEqual(@as(u64, 2), v.attribution_eviction_age.count);
    try std.testing.expectEqual(@as(u128, 16), v.attribution_eviction_age.sum);
    const after_expiry = store.put(.beacon_block, @splat(99), "topic", "payload").?;
    _ = v.admit(&store, &peers, after_expiry, source, 0, 61);
    store.seal(after_expiry);
    try std.testing.expectEqual(@as(u64, 2), v.attribution_eviction_age.count);
    v.clear(&store, &peers);
    try std.testing.expect(std.mem.allEqual(u32, v.topic_counts, 0));
    for (v.topic_counts) |count| try std.testing.expectEqual(@as(u32, 0), count);
    try std.testing.expectEqual(@as(u32, 0), peers.rows[0].pins);
}

test "gossip validation expires without pump and resolves exactly once" {
    var peers = try Peers.init(std.testing.allocator, &.{ .retained_score_ms = 100 }, 512);
    defer peers.deinit(std.testing.allocator);
    peers.rows[0] = .{ .occupied = true, .generation = 1, .admission_source = .{ .ip4 = @splat(0) } };
    var store = try storage.Store.init(std.testing.allocator, 2, 8192);
    defer store.deinit(std.testing.allocator);
    var v = try Validation.init(std.testing.allocator, 1, 10, 20);
    defer v.deinit(std.testing.allocator, &store, &peers);
    const m = store.put(.beacon_block, [_]u8{1} ** 20, "t", "body").?;
    const h = v.admit(&store, &peers, m, .{ .index = 0, .generation = 1 }, 0, 100);
    store.seal(m);
    try std.testing.expect(v.inspect(&store, &peers, h, 109) == null);
    try std.testing.expectEqual(Outcome.expired, v.inspect(&store, &peers, h, 110).?);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
    try std.testing.expectEqual(Outcome.stale_handle, v.inspect(&store, &peers, h, 130).?);
    const m2 = store.put(.beacon_block, [_]u8{2} ** 20, "t", "body").?;
    peers.rows[0].generation = 2;
    const h2 = v.admit(&store, &peers, m2, .{ .index = 0, .generation = 2 }, 0, 130);
    store.seal(m2);
    try std.testing.expectEqual(Outcome.stale_handle, v.inspect(&store, &peers, h, 130).?);
    v.finish(&store, &peers, h2, .ignore, 131);
    try std.testing.expectEqual(Outcome.already_resolved, v.inspect(&store, &peers, h2, 132).?);
}

test "gossip validation readmission skips exhausted generation without hiding pending ID" {
    var peers = try Peers.init(std.testing.allocator, &.{ .retained_score_ms = 100 }, 512);
    defer peers.deinit(std.testing.allocator);
    peers.rows[0] = .{ .occupied = true, .generation = 1, .admission_source = .{ .ip4 = @splat(0) } };
    var store = try storage.Store.init(std.testing.allocator, 2, 8192);
    defer store.deinit(std.testing.allocator);
    var v = try Validation.init(std.testing.allocator, 2, 10, 20);
    defer v.deinit(std.testing.allocator, &store, &peers);
    v.entries[0].generation = std.math.maxInt(u64) - 1;
    const id = [_]u8{1} ** 20;
    const source: PeerRef = .{ .index = 0, .generation = 1 };
    const first = store.put(.beacon_block, id, "t", "body").?;
    const old = v.admit(&store, &peers, first, source, 0, 100);
    store.seal(first);
    v.finish(&store, &peers, old, .ignore, 101);
    const second = store.put(.beacon_block, id, "t", "body").?;
    const current = v.admit(&store, &peers, second, source, 0, 102);
    store.seal(second);
    try std.testing.expectEqual(std.math.maxInt(u64), old.generation);
    try std.testing.expectEqual(@as(u64, 1), current.generation);
    try std.testing.expect(old.index != current.index);
    try std.testing.expectEqual(v.attribution(current), v.find(id, 103).?);
    try std.testing.expectEqual(Outcome.already_resolved, v.inspect(&store, &peers, old, 103).?);
    try std.testing.expectEqual(@as(usize, 1), store.used_entries);
    v.finish(&store, &peers, current, .reject, 104);
    try std.testing.expectEqual(Verdict.reject, v.find(id, 105).?.verdict);
    try std.testing.expectEqual(Outcome.already_resolved, v.inspect(&store, &peers, old, 105).?);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
    try std.testing.expectEqual(store.next.len, store.free_pages);
}

test "gossip validation destruction releases pending payloads and peer pins" {
    const a = std.testing.allocator;
    var peers = try Peers.init(a, &.{ .retained_score_ms = 100, .connected_capacity = 2, .retained_capacity = 5, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(a);
    const source = peers.admit(.{ .index = 0, .generation = 1 }, &.{ .identity = .{ .bytes = @splat(1) }, .address = .unspecified, .direction = .inbound }, 0).admitted.peer;
    var store = try storage.Store.init(a, 2, 8192);
    defer store.deinit(a);
    {
        var v = try Validation.init(a, 2, 10, 20);
        defer v.deinit(a, &store, &peers);
        for (0..2) |i| {
            const message = store.put(.beacon_block, @splat(@intCast(i)), "topic", "payload").?;
            const handle = v.admit(&store, &peers, message, source, 0, 0);
            store.seal(message);
            if (i == 0) v.finish(&store, &peers, handle, .accept, 1);
        }
        try std.testing.expectEqual(@as(u32, 1), peers.rows[source.index].pins);
        try std.testing.expectEqual(@as(usize, 1), store.used_entries);
    }
    try std.testing.expectEqual(@as(u32, 0), peers.rows[source.index].pins);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
    try std.testing.expectEqual(store.next.len, store.free_pages);
}

test "gossip validation index bounds sparse lookups and follows replacement expiry and clear" {
    const a = std.testing.allocator;
    var peers = try Peers.init(a, &.{ .retained_score_ms = 100, .connected_capacity = 2, .retained_capacity = 5, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(a);
    peers.rows[0] = .{ .occupied = true, .generation = 1, .admission_source = .{ .ip4 = @splat(0) } };
    const source: PeerRef = .{ .index = 0, .generation = 1 };
    var store = try storage.Store.init(a, 1, storage.page_bytes);
    defer store.deinit(a);
    var v = try Validation.init(a, 8192, 10, 20);
    defer v.deinit(a, &store, &peers);
    try std.testing.expectEqual(@as(usize, 32768), v.recent.len);
    try std.testing.expectEqual(@as(usize, 0), v.index.probe_limit);
    const first: topic_mod.MessageId = @splat(0);
    var second = first;
    second[19] = 1;
    for ([_]topic_mod.MessageId{ first, second }) |id| {
        const message = store.put(.beacon_block, id, "topic", "payload").?;
        try std.testing.expect(v.index.find(id) == null);
        const handle = v.admit(&store, &peers, message, source, 0, 0);
        store.seal(message);
        v.finish(&store, &peers, handle, .reject, 1);
        try std.testing.expectEqual(@as(usize, 1), v.index.probe_limit);
        try std.testing.expectEqual(Verdict.reject, v.find(id, 2).?.verdict);
    }
    try std.testing.expect(v.find(first, 2) != null);
    try std.testing.expect(v.find(second, 21) == null);
    try std.testing.expect(v.index.find(second) != null);
    v.expire(&store, &peers, 21);
    try std.testing.expect(v.index.find(second) == null);
    try std.testing.expectEqual(@as(u32, 0), peers.rows[0].pins);
    for (0..2) |i| {
        const message = store.put(.beacon_block, first, "topic", "payload").?;
        const handle = v.admit(&store, &peers, message, source, 0, 30);
        store.seal(message);
        try std.testing.expectEqual(handle, v.find(first, 30).?.handle);
        if (i == 0) {
            v.expire(&store, &peers, 40);
            try std.testing.expect(v.index.find(first) == null);
        } else v.clear(&store, &peers);
    }
    try std.testing.expectEqual(@as(usize, 0), v.index.probe_limit);
    try std.testing.expect(v.find(first, 40) == null);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
    try std.testing.expectEqual(@as(u32, 0), peers.rows[0].pins);
}
