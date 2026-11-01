const Handle = @import("../quic/Engine.zig").Handle;
const MessageId = @import("topic.zig").MessageId;
const Peers = @import("peer_book.zig").PeerBook;
const Recovery = @import("recovery.zig").Recovery;
const constants = @import("constants.zig");
const std = @import("std");
const peer_book = @import("peer_book.zig");
const peer_id = @import("../wire/peer_id.zig");
const score = @import("score.zig");

test "recovery receipts bind connection generation and token and release only cancelled pins" {
    const allocator = std.testing.allocator;
    var peers = try Peers.init(allocator, &.{ .retained_score_ms = 10_000, .connected_capacity = 2, .retained_capacity = 5, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(allocator);
    var recovery = try Recovery.init(allocator);
    defer recovery.deinit(allocator, &peers);
    const connection: Handle = .{ .index = 0, .generation = 1 };
    const next_connection: Handle = .{ .index = 0, .generation = 2 };
    const metadata: peer_book.Metadata = .{
        .identity = .{ .bytes = [_]u8{1} ** peer_id.length },
        .address = .unspecified,
        .direction = .inbound,
    };
    const peer = peers.admit(connection, &metadata, 0).admitted.peer;
    try recovery.add(&peers, [_]u8{1} ** 20, peer, connection, 7, 30_000);
    try recovery.add(&peers, [_]u8{2} ** 20, peer, connection, 8, 30_000);
    recovery.controlSent(next_connection, 7, 3000, 10);
    recovery.controlSent(connection, 6, 3000, 10);
    try std.testing.expectEqual(@as(u64, 30_000), recovery.batches[0].expiry);
    recovery.controlSent(connection, 7, 3000, 20);
    try std.testing.expectEqual(@as(u64, 3020), recovery.batches[0].expiry);
    try std.testing.expectEqual(@as(u64, 0), recovery.cancel(&peers, next_connection, true).removed);
    try std.testing.expectEqual(@as(u64, 1), recovery.cancel(&peers, connection, false).removed);
    try std.testing.expectEqual(@as(u32, 1), peers.rows[peer.index].pins);
    recovery.controlSent(connection, 7, 3000, 200);
    recovery.controlSent(connection, 8, 3000, 200);
    try std.testing.expectEqual(@as(u64, 3020), recovery.batches[0].expiry);
    try std.testing.expectEqual(@as(u64, 1), recovery.cancel(&peers, connection, true).removed);
    try std.testing.expectEqual(@as(u32, 0), peers.rows[peer.index].pins);
    try std.testing.expectEqual(@as(usize, constants.promises_cap), recovery.available());
    recovery.controlSent(connection, 7, 3000, 300);
    try std.testing.expectEqual(@as(usize, 0), recovery.batch_len);
}

test "recovery capacity resolves every matching attribution and deinit releases remaining pins" {
    const allocator = std.testing.allocator;
    var peers = try Peers.init(allocator, &.{ .retained_score_ms = 10_000, .connected_capacity = 2, .retained_capacity = 5, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(allocator);
    const connection: Handle = .{ .index = 0, .generation = 1 };
    const metadata: peer_book.Metadata = .{
        .identity = .{ .bytes = [_]u8{1} ** peer_id.length },
        .address = .unspecified,
        .direction = .inbound,
    };
    const peer = peers.admit(connection, &metadata, 0).admitted.peer;
    {
        var recovery = try Recovery.init(allocator);
        defer recovery.deinit(allocator, &peers);
        for (0..constants.promises_cap) |_| try recovery.add(&peers, [_]u8{1} ** 20, peer, connection, 7, 30_000);
        try std.testing.expectEqual(@as(usize, 0), recovery.available());
        _ = recovery.resolve(&peers, [_]u8{1} ** 20);
        try std.testing.expectEqual(@as(u32, 0), peers.rows[peer.index].pins);
        try recovery.add(&peers, [_]u8{2} ** 20, peer, connection, 8, 30_000);
    }
    try std.testing.expectEqual(@as(u32, 0), peers.rows[peer.index].pins);
}

test "recovery batches pin identity once and score one randomly selected promise" {
    const a = std.testing.allocator;
    var peers = try Peers.init(a, &.{ .retained_score_ms = 10000, .connected_capacity = 2, .retained_capacity = 5, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(a);
    var recovery = try Recovery.init(a);
    defer recovery.deinit(a, &peers);
    const connection: Handle = .{ .index = 0, .generation = 1 };
    const metadata: peer_book.Metadata = .{ .identity = .{ .bytes = @splat(1) }, .address = .unspecified, .direction = .inbound };
    const peer = peers.admit(connection, &metadata, 0).admitted.peer;
    var ids: [constants.gossip_ids_max]MessageId = undefined;
    for (&ids, 0..) |*id, i| id.* = @splat(@intCast(i));
    try recovery.addBatch(&peers, &ids, peer, connection, 1, 64, 30_000);
    try std.testing.expectEqual(@as(u32, 1), peers.rows[peer.index].pins);
    try std.testing.expectEqual(@as(u64, 0), recovery.expire(&peers, 20000));
    recovery.controlSent(connection, 1, 3000, 20000);
    try std.testing.expectEqual(@as(u64, 1), recovery.expire(&peers, 23000));
    try std.testing.expectEqual(@as(f64, 1), peers.scores.rows[peer.index].behaviour);
    try std.testing.expectEqual(@as(u32, 0), peers.rows[peer.index].pins);
    try recovery.addBatch(&peers, &ids, peer, connection, 2, 64, 30_000);
    recovery.controlSent(connection, 2, 3000, 24000);
    _ = recovery.resolve(&peers, ids[64]);
    try std.testing.expectEqual(@as(usize, 127), recovery.len);
    try std.testing.expectEqual(@as(u32, 1), peers.rows[peer.index].pins);
    try std.testing.expectEqual(@as(u64, 0), recovery.expire(&peers, 27000));
    try std.testing.expectEqual(@as(f64, 1), peers.scores.rows[peer.index].behaviour);
    try std.testing.expectEqual(@as(usize, constants.promises_cap), recovery.available());
    try std.testing.expectEqual(@as(u32, 0), peers.rows[peer.index].pins);
}

const PeerRef = @import("peer_book.zig").Ref;
const none: u16 = std.math.maxInt(u16);

fn admit(peers: *Peers, index: u16) PeerRef {
    const metadata: peer_book.Metadata = .{ .identity = .{ .bytes = @splat(@intCast(index + 1)) }, .address = .unspecified, .direction = .inbound };
    return peers.admit(.{ .index = index, .generation = 1 }, &metadata, 0).admitted.peer;
}

fn bucketOf(recovery: *const Recovery, id: *const MessageId) usize {
    return @as(usize, @truncate(std.hash.Wyhash.hash(recovery.seed, id))) & (recovery.buckets.len - 1);
}

/// Fills `ids` with distinct ids that all hash to the last bucket.
fn collidingIds(recovery: *const Recovery, ids: []MessageId) void {
    var count: usize = 0;
    for (0..1 << 24) |candidate| {
        var id: MessageId = @splat(0);
        std.mem.writeInt(u64, id[0..8], candidate, .little);
        if (bucketOf(recovery, &id) != recovery.buckets.len - 1) continue;
        ids[count] = id;
        count += 1;
        if (count == ids.len) return;
    }
    unreachable;
}

/// The work of a resolve that compares `chained` requests and resolves none.
fn missWork(recovery: *const Recovery, chained: usize) usize {
    return @sizeOf(MessageId) + @sizeOf(u16) + chained * (@sizeOf(@TypeOf(recovery.requests[0])) + @sizeOf(MessageId));
}

/// Checks that the id chains hold exactly the requests of live batches, each in its id's bucket,
/// and that every request names the batch holding it.
fn expectIndexed(recovery: *const Recovery) !void {
    var batched = std.StaticBitSet(constants.promises_cap).empty;
    for (recovery.batches[0..recovery.batch_len], 0..) |batch, index| {
        var slot = batch.head;
        var sampled = batch.sample == none;
        for (0..batch.count) |_| {
            try std.testing.expectEqual(@as(u16, @intCast(index)), recovery.requests[slot].batch);
            sampled = sampled or slot == batch.sample;
            batched.set(slot);
            slot = recovery.requests[slot].next;
        }
        try std.testing.expectEqual(none, slot);
        try std.testing.expect(sampled);
    }
    var chained: usize = 0;
    for (recovery.buckets, 0..) |head, bucket| {
        var previous = none;
        var slot = head;
        for (0..recovery.requests.len) |_| {
            if (slot == none) break;
            const request = recovery.requests[slot];
            try std.testing.expect(batched.isSet(slot));
            try std.testing.expectEqual(bucket, bucketOf(recovery, &request.id));
            try std.testing.expectEqual(previous, request.bucket_prev);
            chained += 1;
            previous = slot;
            slot = request.bucket_next;
        }
        try std.testing.expectEqual(none, slot);
    }
    try std.testing.expectEqual(recovery.len, batched.count());
    try std.testing.expectEqual(recovery.len, chained);
}

test "recovery index separates colliding ids and resolves an id's duplicates across batches and peers" {
    const a = std.testing.allocator;
    var peers = try Peers.init(a, &.{ .retained_score_ms = 10_000, .connected_capacity = 4, .retained_capacity = 9, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(a);
    var recovery = try Recovery.init(a);
    defer recovery.deinit(a, &peers);
    const first = admit(&peers, 0);
    const second = admit(&peers, 1);
    const third = admit(&peers, 2);
    var ids: [6]MessageId = undefined;
    collidingIds(&recovery, &ids);
    try recovery.addBatch(&peers, ids[0..3], first, .{ .index = 0, .generation = 1 }, 1, 0, 30_000);
    try recovery.add(&peers, ids[1], first, .{ .index = 0, .generation = 1 }, 2, 30_000);
    try recovery.addBatch(&peers, &.{ ids[1], ids[3] }, second, .{ .index = 1, .generation = 1 }, 3, 1, 30_000);
    try recovery.add(&peers, ids[4], third, .{ .index = 2, .generation = 1 }, 4, 30_000);
    try expectIndexed(&recovery);
    try std.testing.expectEqual(recovery.buckets.len - 1, std.mem.count(u16, recovery.buckets, &.{none}));
    try std.testing.expectEqual(missWork(&recovery, 7), recovery.resolve(&peers, ids[5]));
    try std.testing.expectEqual(missWork(&recovery, 0), recovery.resolve(&peers, @splat(0xff)));
    try std.testing.expectEqual(@as(usize, 7), recovery.len);

    _ = recovery.resolve(&peers, ids[1]);
    try expectIndexed(&recovery);
    try std.testing.expectEqual(@as(usize, 4), recovery.len);
    try std.testing.expectEqual(@as(usize, 3), recovery.batch_len);
    try std.testing.expectEqual(@as(u32, 1), peers.rows[first.index].pins);
    try std.testing.expectEqual(@as(u32, 1), peers.rows[second.index].pins);
    for (recovery.batches[0..recovery.batch_len]) |batch| {
        if (batch.token == 3) try std.testing.expectEqualSlices(u8, &ids[3], &recovery.requests[batch.sample].id);
    }
    try std.testing.expectEqual(missWork(&recovery, 4), recovery.resolve(&peers, ids[1]));

    _ = recovery.resolve(&peers, ids[3]);
    try expectIndexed(&recovery);
    try std.testing.expectEqual(@as(u32, 0), peers.rows[second.index].pins);
    for ([_]usize{ 0, 2, 4 }) |i| _ = recovery.resolve(&peers, ids[i]);
    try expectIndexed(&recovery);
    try std.testing.expectEqual(@as(usize, 0), recovery.len);
    try std.testing.expectEqual(@as(usize, 0), recovery.batch_len);
    try std.testing.expect(std.mem.allEqual(u16, recovery.buckets, none));
    for ([_]PeerRef{ first, second, third }) |peer| try std.testing.expectEqual(@as(u32, 0), peers.rows[peer.index].pins);
}

test "recovery index fills to capacity and reuses released slots for new ids" {
    const a = std.testing.allocator;
    var peers = try Peers.init(a, &.{ .retained_score_ms = 10_000, .connected_capacity = 4, .retained_capacity = 9, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(a);
    var recovery = try Recovery.init(a);
    defer recovery.deinit(a, &peers);
    recovery.seed = 0x5eed;
    const owners = [_]PeerRef{ admit(&peers, 0), admit(&peers, 1) };
    const ids = try a.alloc(MessageId, constants.promises_cap + constants.gossip_ids_max);
    defer a.free(ids);
    var prng: std.Random.DefaultPrng = .init(1);
    prng.random().bytes(std.mem.sliceAsBytes(ids));
    const batches = constants.promises_cap / constants.gossip_ids_max;
    for (0..batches) |batch| {
        const owner = batch % owners.len;
        try recovery.addBatch(&peers, ids[batch * constants.gossip_ids_max ..][0..constants.gossip_ids_max], owners[owner], .{ .index = @intCast(owner), .generation = 1 }, batch, batch % constants.gossip_ids_max, 30_000);
    }
    try std.testing.expectEqual(@as(usize, 0), recovery.available());
    try expectIndexed(&recovery);

    const released = ids[0..constants.gossip_ids_max];
    for (released) |id| _ = recovery.resolve(&peers, id);
    try std.testing.expectEqual(@as(usize, constants.gossip_ids_max), recovery.available());
    try std.testing.expectEqual(@as(usize, batches - 1), recovery.batch_len);
    try expectIndexed(&recovery);
    const fresh = ids[constants.promises_cap..];
    try recovery.addBatch(&peers, fresh, owners[0], .{ .index = 0, .generation = 1 }, batches, 0, 30_000);
    try std.testing.expectEqual(@as(usize, 0), recovery.available());
    try expectIndexed(&recovery);
    for (released) |id| _ = recovery.resolve(&peers, id);
    try std.testing.expectEqual(@as(usize, 0), recovery.available());
    for (fresh) |id| _ = recovery.resolve(&peers, id);
    try std.testing.expectEqual(@as(usize, constants.gossip_ids_max), recovery.available());
    try expectIndexed(&recovery);

    for (ids[constants.gossip_ids_max..constants.promises_cap]) |id| _ = recovery.resolve(&peers, id);
    try std.testing.expectEqual(@as(usize, constants.promises_cap), recovery.available());
    try std.testing.expectEqual(@as(usize, 0), recovery.batch_len);
    try std.testing.expect(std.mem.allEqual(u16, recovery.buckets, none));
    for (owners) |owner| try std.testing.expectEqual(@as(u32, 0), peers.rows[owner.index].pins);
}

test "recovery breaks a sent promise only while its sampled request is unresolved" {
    const a = std.testing.allocator;
    var peers = try Peers.init(a, &.{ .retained_score_ms = 10_000, .connected_capacity = 4, .retained_capacity = 9, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(a);
    var recovery = try Recovery.init(a);
    defer recovery.deinit(a, &peers);
    const unsampled = admit(&peers, 0);
    const sampled = admit(&peers, 1);
    const unsent = admit(&peers, 2);
    const ids = [_]MessageId{ @splat(1), @splat(2), @splat(3) };
    try recovery.addBatch(&peers, &ids, unsampled, .{ .index = 0, .generation = 1 }, 1, 1, 30_000);
    try recovery.addBatch(&peers, &ids, sampled, .{ .index = 1, .generation = 1 }, 2, 2, 30_000);
    try recovery.addBatch(&peers, &ids, unsent, .{ .index = 2, .generation = 1 }, 3, 2, 3_010);
    recovery.controlSent(.{ .index = 0, .generation = 1 }, 1, 3_000, 10);
    recovery.controlSent(.{ .index = 1, .generation = 1 }, 2, 3_000, 10);
    _ = recovery.resolve(&peers, ids[2]);
    try expectIndexed(&recovery);
    try std.testing.expectEqual(@as(usize, 6), recovery.len);
    try std.testing.expectEqual(@as(u64, 1), recovery.expire(&peers, 3_010));
    try std.testing.expectEqual(@as(f64, 1), peers.scores.rows[unsampled.index].behaviour);
    try std.testing.expectEqual(@as(f64, 0), peers.scores.rows[sampled.index].behaviour);
    try std.testing.expectEqual(@as(f64, 0), peers.scores.rows[unsent.index].behaviour);
    try std.testing.expectEqual(@as(usize, 0), recovery.len);
    try std.testing.expect(std.mem.allEqual(u16, recovery.buckets, none));
    for ([_]PeerRef{ unsampled, sampled, unsent }) |peer| try std.testing.expectEqual(@as(u32, 0), peers.rows[peer.index].pins);
}

test "recovery cancellation removes a connection's requests from the index" {
    const a = std.testing.allocator;
    var peers = try Peers.init(a, &.{ .retained_score_ms = 10_000, .connected_capacity = 4, .retained_capacity = 9, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(a);
    var recovery = try Recovery.init(a);
    defer recovery.deinit(a, &peers);
    const cancelled = admit(&peers, 0);
    const other = admit(&peers, 1);
    const connection: Handle = .{ .index = 0, .generation = 1 };
    const ids = [_]MessageId{ @splat(1), @splat(2), @splat(3), @splat(4) };
    try recovery.addBatch(&peers, ids[0..2], cancelled, connection, 1, 0, 30_000);
    try recovery.addBatch(&peers, ids[1..3], cancelled, connection, 2, 0, 30_000);
    try recovery.addBatch(&peers, &.{ ids[1], ids[3] }, other, .{ .index = 1, .generation = 1 }, 3, 0, 30_000);
    recovery.controlSent(connection, 1, 3_000, 10);
    try std.testing.expectEqual(@as(u64, 2), recovery.cancel(&peers, connection, false).removed);
    try expectIndexed(&recovery);
    _ = recovery.resolve(&peers, ids[2]);
    try std.testing.expectEqual(@as(usize, 4), recovery.len);
    try std.testing.expectEqual(@as(u64, 2), recovery.cancel(&peers, connection, true).removed);
    try expectIndexed(&recovery);
    try std.testing.expectEqual(@as(u32, 0), peers.rows[cancelled.index].pins);
    _ = recovery.resolve(&peers, ids[1]);
    try expectIndexed(&recovery);
    try std.testing.expectEqual(@as(usize, 1), recovery.len);
    try std.testing.expectEqualSlices(u8, &ids[3], &recovery.requests[recovery.batches[0].head].id);
}

/// A batch as a scan sees it: its requests' ids in chain order and its sampled id.
const Seen = struct { token: u64, peer: PeerRef, connection: Handle, ids: [8]MessageId, count: usize, sample: ?MessageId, sent: bool, expiry: u64 };

fn scan(recovery: *const Recovery, out: []Seen) []Seen {
    for (recovery.batches[0..recovery.batch_len], out[0..recovery.batch_len]) |batch, *seen| {
        seen.* = .{ .token = batch.token, .peer = batch.peer, .connection = batch.connection, .ids = undefined, .count = batch.count, .sample = if (batch.sample == none) null else recovery.requests[batch.sample].id, .sent = batch.sent_at_ms != null, .expiry = batch.expiry };
        var slot = batch.head;
        for (seen.ids[0..batch.count]) |*id| {
            id.* = recovery.requests[slot].id;
            slot = recovery.requests[slot].next;
        }
    }
    return out[0..recovery.batch_len];
}

fn find(seen: []const Seen, token: u64) ?*const Seen {
    for (seen) |*batch| if (batch.token == token) return batch;
    return null;
}

test "recovery index resolves what a scan of every batch finds under random operations" {
    const a = std.testing.allocator;
    var peers = try Peers.init(a, &.{ .retained_score_ms = 10_000, .connected_capacity = 4, .retained_capacity = 9, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(a);
    var recovery = try Recovery.init(a);
    defer recovery.deinit(a, &peers);
    const owners = [_]PeerRef{ admit(&peers, 0), admit(&peers, 1), admit(&peers, 2) };
    var pool: [12]MessageId = undefined;
    collidingIds(&recovery, pool[0..6]);
    for (pool[6..], 6..) |*id, i| id.* = @splat(@intCast(i));
    var prng: std.Random.DefaultPrng = .init(7);
    const random = prng.random();
    var before_buffer: [64]Seen = undefined;
    var after_buffer: [64]Seen = undefined;
    var now: u64 = 0;
    for (0..2_000) |step| {
        const before = scan(&recovery, &before_buffer);
        const op = random.uintLessThan(u8, 20);
        if (op < 6 and before.len < before_buffer.len) {
            random.shuffle(MessageId, &pool);
            const count = random.intRangeAtMost(usize, 1, 8);
            const owner = random.uintLessThan(usize, owners.len);
            try recovery.addBatch(&peers, pool[0..count], owners[owner], .{ .index = @intCast(owner), .generation = 1 }, step, random.uintLessThan(usize, count), now + random.intRangeAtMost(u64, 1, 4_000));
        } else if (op < 14) {
            const id = pool[random.uintLessThan(usize, pool.len)];
            _ = recovery.resolve(&peers, id);
            const after = scan(&recovery, &after_buffer);
            var remaining: usize = 0;
            for (before) |batch| {
                var kept: usize = 0;
                for (batch.ids[0..batch.count]) |other| kept += @intFromBool(!std.mem.eql(u8, &other, &id));
                remaining += kept;
                const resolved = find(after, batch.token) orelse {
                    try std.testing.expectEqual(@as(usize, 0), kept);
                    continue;
                };
                try std.testing.expectEqual(kept, resolved.count);
                const cleared = batch.sample != null and std.mem.eql(u8, &batch.sample.?, &id);
                try std.testing.expectEqual(batch.sample == null or cleared, resolved.sample == null);
            }
            try std.testing.expectEqual(remaining, recovery.len);
        } else if (op < 16) {
            var broken: u64 = 0;
            for (before) |batch| broken += @intFromBool(now >= batch.expiry and batch.sent and batch.sample != null);
            try std.testing.expectEqual(broken, recovery.expire(&peers, now));
        } else if (op == 16) {
            const owner = random.uintLessThan(usize, owners.len);
            const local_pressure = random.boolean();
            var removed: u64 = 0;
            for (before) |batch| {
                if (batch.connection.index == owner and (local_pressure or !batch.sent)) removed += batch.count;
            }
            try std.testing.expectEqual(removed, recovery.cancel(&peers, .{ .index = @intCast(owner), .generation = 1 }, local_pressure).removed);
        } else if (before.len > 0) {
            const batch = before[random.uintLessThan(usize, before.len)];
            recovery.controlSent(batch.connection, batch.token, 3_000, now);
        }
        try expectIndexed(&recovery);
        for (owners) |owner| {
            var pins: u32 = 0;
            for (recovery.batches[0..recovery.batch_len]) |batch| pins += @intFromBool(batch.peer.index == owner.index);
            try std.testing.expectEqual(pins, peers.rows[owner.index].pins);
        }
        now += random.uintLessThan(u64, 100);
    }
}

test "recovery arms one sampled promise per sent batch whose sample is still outstanding" {
    const a = std.testing.allocator;
    var peers = try Peers.init(a, &.{ .retained_score_ms = 10_000, .connected_capacity = 2, .retained_capacity = 5, .retained_outbound_reserve = 1 }, 512);
    defer peers.deinit(a);
    var recovery = try Recovery.init(a);
    defer recovery.deinit(a, &peers);
    const peer = admit(&peers, 0);
    const connection: Handle = .{ .index = 0, .generation = 1 };
    const ids = [_]MessageId{ @splat(1), @splat(2), @splat(3), @splat(4), @splat(5), @splat(6), @splat(7) };
    // Resolved before the send: the sample of one batch, then all of another.
    try recovery.addBatch(&peers, ids[0..2], peer, connection, 1, 0, 30_000);
    try recovery.addBatch(&peers, ids[2..3], peer, connection, 2, 0, 30_000);
    _ = recovery.resolve(&peers, ids[0]);
    _ = recovery.resolve(&peers, ids[2]);
    recovery.controlSent(connection, 1, 3_000, 10);
    recovery.controlSent(connection, 2, 3_000, 10);
    try std.testing.expectEqual(@as(u64, 0), recovery.armed);
    // Armed once however often its send completes, then broken at expiry.
    try recovery.addBatch(&peers, ids[3..4], peer, connection, 3, 0, 30_000);
    for (0..2) |_| recovery.controlSent(connection, 3, 3_000, 10);
    try std.testing.expectEqual(@as(u64, 1), recovery.armed);
    try std.testing.expectEqual(@as(u64, 1), recovery.expire(&peers, 3_010));
    // Local pressure cancels an armed promise before it can break; a send after expiry arms none.
    try recovery.addBatch(&peers, ids[4..5], peer, connection, 4, 0, 30_000);
    try recovery.addBatch(&peers, ids[5..6], peer, connection, 5, 0, 3_020);
    recovery.controlSent(connection, 4, 3_000, 3_020);
    recovery.controlSent(connection, 5, 3_000, 3_020);
    try std.testing.expectEqual(@as(u64, 2), recovery.armed);
    try std.testing.expectEqual(@as(u64, 2), recovery.cancel(&peers, connection, true).removed);
    // A sample resolved after the send keeps its promise.
    try recovery.addBatch(&peers, ids[6..7], peer, connection, 6, 0, 30_000);
    recovery.controlSent(connection, 6, 3_000, 3_030);
    _ = recovery.resolve(&peers, ids[6]);
    try std.testing.expectEqual(@as(u64, 3), recovery.armed);
    try std.testing.expectEqual(@as(u64, 0), recovery.expire(&peers, 30_000));
    try std.testing.expectEqual(@as(usize, 0), recovery.len);
    try std.testing.expectEqual(@as(u64, 1), peers.scores.penalties[@intFromEnum(score.Penalty.broken_iwant)]);
    try std.testing.expectEqual(@as(f64, 1), peers.scores.rows[peer.index].behaviour);
}
