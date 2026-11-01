const Pool = @import("delivery.zig").Pool;
const per_peer_limit = @import("delivery.zig").per_peer_limit;
const Queue = @import("delivery.zig").Queue;
const Receipt = @import("delivery.zig").Receipt;
const Limits = @import("delivery.zig").Limits;
const Origin = @import("delivery.zig").Origin;
const per_peer_reserve = @import("delivery.zig").per_peer_reserve;
const std = @import("std");
const storage = @import("message_store.zig");
const constants = @import("constants.zig");

test "gossip global descriptor pressure preserves every peer local reservation" {
    const a = std.testing.allocator;
    var pool = try Pool.init(a, 2, Pool.capacity(2, 1));
    defer pool.deinit(a);
    pool.local_descriptors = 8;
    var store = try storage.Store.init(a, 1, storage.page_bytes);
    defer store.deinit(a);
    const message = store.put(.beacon_block, @splat(1), "topic", "payload").?;
    store.retainHistory(message);
    store.seal(message);
    var queues: [2]Queue = @splat(.{ .pool = &pool });
    defer for (&queues) |*queue| queue.reset();
    const limits: Limits = .{ .bytes = 1 << 20 };
    for (0..per_peer_limit - 8) |_| try queues[0].append(&store, message, .forward, limits, 0);
    for (0..per_peer_reserve - 8) |_| try queues[1].append(&store, message, .iwant, limits, 0);
    try std.testing.expectEqual(@as(usize, 16), pool.available);
    try std.testing.expectEqual(pool.available, pool.protected);
    try std.testing.expectError(error.PoolFull, queues[1].append(&store, message, .forward, limits, 0));
    for (&queues) |*queue| for (0..8) |_| try queue.append(&store, message, .publication, limits, 1);
    try std.testing.expectEqual(@as(usize, 0), pool.available);
}

test "gossip default byte reserve admits a maximal local frame after ordinary saturation" {
    const a = std.testing.allocator;
    const maximum = constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE);
    const limits: Limits = .{ .bytes = constants.tx_peer_bytes, .local_bytes = constants.tx_local_bytes };
    var pool = try Pool.init(a, 1, Pool.capacity(1, 1));
    defer pool.deinit(a);
    var store = try storage.Store.init(a, 1, std.mem.alignForward(usize, maximum, storage.page_bytes));
    defer store.deinit(a);
    const payload = try a.alloc(u8, maximum);
    defer a.free(payload);
    @memset(payload, 1);
    const message = store.put(.beacon_block, @splat(1), "topic", payload).?;
    store.retainHistory(message);
    store.seal(message);
    var queue: Queue = .{ .pool = &pool };
    defer queue.reset();
    try queue.append(&store, message, .forward, limits, 0);
    try std.testing.expectError(error.Bytes, queue.append(&store, message, .iwant, limits, 0));
    try queue.append(&store, message, .publication, limits, 1);
    try std.testing.expectEqual(limits.bytes, queue.bytes);
    try std.testing.expectEqual(Origin.publication, (queue.next(&store, 10, 30_000)).?.origin);
}

test "gossip shared deliveries preserve every peer reserve under global pressure" {
    const a = std.testing.allocator;
    var pool = try Pool.init(a, 3, Pool.capacity(3, 1));
    defer pool.deinit(a);
    var store = try storage.Store.init(a, 1, storage.page_bytes);
    defer store.deinit(a);
    const message = store.put(.beacon_block, @splat(1), "topic", "payload").?;
    store.retainHistory(message);
    store.seal(message);
    var queues: [3]Queue = @splat(.{ .pool = &pool });
    const limits: Limits = .{ .bytes = 1 << 20 };
    for (0..per_peer_limit) |_| try queues[0].append(&store, message, .forward, limits, 1);
    try std.testing.expectError(error.Descriptors, queues[0].append(&store, message, .forward, limits, 2));
    for (queues[1..]) |*queue| {
        for (0..per_peer_reserve) |_| try queue.append(&store, message, .forward, limits, 3);
        try std.testing.expectError(error.PoolFull, queue.append(&store, message, .forward, limits, 4));
    }
    try std.testing.expectEqual(@as(usize, 0), pool.available);
    try std.testing.expectEqual(@as(usize, 0), pool.protected);
    queues[1].reset();
    try std.testing.expectError(error.PoolFull, queues[2].append(&store, message, .forward, limits, 5));
    for (0..per_peer_reserve) |_| try queues[1].append(&store, message, .forward, limits, 6);
    store.releaseHistory(message);
    for (&queues) |*queue| queue.reset();
    try std.testing.expectEqual(@as(usize, 3 * per_peer_reserve), pool.protected);
    try std.testing.expectEqual(pool.slots.len, pool.available);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
}

test "gossip delivery byte refusal acquires no descriptor" {
    const a = std.testing.allocator;
    var pool = try Pool.init(a, 1, Pool.capacity(1, 1));
    defer pool.deinit(a);
    var store = try storage.Store.init(a, 1, storage.page_bytes);
    defer store.deinit(a);
    const message = store.put(.beacon_block, @splat(1), "topic", "payload").?;
    store.retainHistory(message);
    store.seal(message);
    var queue: Queue = .{ .pool = &pool };
    try std.testing.expectError(error.Bytes, queue.append(&store, message, .forward, .{ .bytes = 6 }, 0));
    try std.testing.expectEqual(pool.slots.len, pool.available);
    store.releaseHistory(message);
}

test "gossip delivery keeps the local reserve from ordinary frames and pressures a full reserve" {
    const a = std.testing.allocator;
    var pool = try Pool.init(a, 1, Pool.capacity(1, 1));
    defer pool.deinit(a);
    var store = try storage.Store.init(a, 1, storage.page_bytes);
    defer store.deinit(a);
    const message = store.put(.beacon_block, @splat(1), "topic", "payload").?;
    store.retainHistory(message);
    store.seal(message);
    var queue: Queue = .{ .pool = &pool };
    pool.local_descriptors = 4;
    const descriptors: Limits = .{ .bytes = 1 << 20 };
    for (0..per_peer_limit - 5) |_| try queue.append(&store, message, .forward, descriptors, 1);
    try std.testing.expect(!queue.full());
    try queue.append(&store, message, .forward, descriptors, 1);
    try std.testing.expect(queue.full());
    try std.testing.expectError(error.Descriptors, queue.append(&store, message, .iwant, descriptors, 1));
    for (0..4) |_| try queue.append(&store, message, .publication, descriptors, 2);
    try std.testing.expectError(error.Descriptors, queue.append(&store, message, .publication, descriptors, 3));
    try std.testing.expectEqual(@as(usize, 4), queue.classCount(.local));
    // Sending a local frame frees no ordinary room; sending an ordinary one does.
    try std.testing.expectEqual(Receipt{ .origin = .publication, .kind = .beacon_block, .enqueued_ms = 2 }, complete(&queue, &store));
    try std.testing.expect(queue.full());
    queue.current = .ordinary;
    try std.testing.expectEqual(Origin.forward, complete(&queue, &store).origin);
    try std.testing.expect(!queue.full());
    queue.reset();
    pool.local_descriptors = 0;

    // Seven-byte frames: ordinary ones stop 14 bytes short of the limit, which two local ones fill.
    const bytes: Limits = .{ .bytes = 70, .local_bytes = 14 };
    for (0..8) |_| try queue.append(&store, message, .forward, bytes, 4);
    try std.testing.expectError(error.Bytes, queue.append(&store, message, .forward, bytes, 4));
    for (0..2) |_| try queue.append(&store, message, .publication, bytes, 5);
    try std.testing.expectError(error.Bytes, queue.append(&store, message, .publication, bytes, 5));
    queue.reset();
    // Without ordinary frames, local publications may use all the room.
    for (0..10) |_| try queue.append(&store, message, .publication, bytes, 6);
    try std.testing.expectError(error.Bytes, queue.append(&store, message, .publication, bytes, 6));
    queue.reset();
    try std.testing.expectEqual(pool.slots.len, pool.available);
    store.releaseHistory(message);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
}

test "gossip delivery bounds local preference by frames and bytes" {
    const a = std.testing.allocator;
    var pool = try Pool.init(a, 1, Pool.capacity(1, 1));
    defer pool.deinit(a);
    var store = try storage.Store.init(a, 3, 64 * storage.page_bytes);
    defer store.deinit(a);
    const small = store.put(.beacon_block, @splat(1), "topic", "local").?;
    const other = store.put(.beacon_block, @splat(2), "topic", "ordinary").?;
    // Larger than the 64 KiB byte run.
    const large = store.put(.beacon_block, @splat(3), "topic", &([_]u8{9} ** (70 * 1024))).?;
    for ([_]storage.Handle{ small, other, large }) |h| {
        store.retainHistory(h);
        store.seal(h);
    }
    var queue: Queue = .{ .pool = &pool };
    const limits: Limits = .{ .bytes = 1 << 20 };
    for (0..2) |_| try queue.append(&store, other, .forward, limits, 1);
    try queue.append(&store, other, .iwant, limits, 1);
    for (0..10) |_| try queue.append(&store, small, .publication, limits, 2);
    // Four local frames go ahead of each waiting ordinary frame; the run state lives in the
    // queue, so it spans any number of turns.
    const expected = [_]Origin{ .publication, .publication, .publication, .publication, .forward, .publication, .publication, .publication, .publication, .forward, .publication, .publication, .iwant };
    for (expected) |origin| try std.testing.expectEqual(origin, complete(&queue, &store).origin);
    try std.testing.expectEqual(@as(usize, 0), queue.count);

    // One local frame at or above the byte run hands the next turn to a waiting ordinary frame.
    try queue.append(&store, large, .publication, limits, 4);
    try queue.append(&store, small, .publication, limits, 4);
    try queue.append(&store, other, .forward, limits, 4);
    for ([_]Origin{ .publication, .forward, .publication }) |origin| {
        try std.testing.expectEqual(origin, complete(&queue, &store).origin);
    }
    try std.testing.expectEqual(@as(usize, 0), queue.count);
    for ([_]storage.Handle{ small, other, large }) |h| store.releaseHistory(h);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
}

test "gossip pool protects each peer's first descriptors by the combined count of both classes" {
    const a = std.testing.allocator;
    var pool = try Pool.init(a, 2, Pool.capacity(2, 1));
    defer pool.deinit(a);
    var store = try storage.Store.init(a, 1, storage.page_bytes);
    defer store.deinit(a);
    const message = store.put(.beacon_block, @splat(1), "topic", "payload").?;
    store.retainHistory(message);
    store.seal(message);
    var queues: [2]Queue = @splat(.{ .pool = &pool });
    pool.local_descriptors = 8;
    const limits: Limits = .{ .bytes = 1 << 20 };
    for (0..40) |_| try queues[0].append(&store, message, .publication, limits, 1);
    for (0..30) |_| try queues[0].append(&store, message, .forward, limits, 1);
    try std.testing.expectEqual(@as(usize, per_peer_reserve), pool.protected);
    try std.testing.expectEqual(pool.slots.len - 70, pool.available);
    // The first peer takes every unprotected descriptor; the second still gets its protected
    // share across both classes, and no more.
    for (70..per_peer_limit) |_| try queues[0].append(&store, message, .publication, limits, 2);
    for (0..per_peer_reserve / 2) |_| try queues[1].append(&store, message, .publication, limits, 3);
    for (0..per_peer_reserve / 2) |_| try queues[1].append(&store, message, .forward, limits, 3);
    try std.testing.expectEqual(@as(usize, 0), pool.available);
    try std.testing.expectError(error.PoolFull, queues[1].append(&store, message, .publication, limits, 4));
    try std.testing.expectError(error.PoolFull, queues[1].append(&store, message, .forward, limits, 4));
    // Draining in class order returns every descriptor and protected unit.
    for (&queues) |*queue| {
        for (0..per_peer_limit) |_| {
            _ = queue.next(&store, 10, 30_000) orelse break;
            _ = queue.complete();
        }
        try std.testing.expectEqual(@as(usize, 0), queue.count);
    }
    try std.testing.expectEqual(pool.slots.len, pool.available);
    try std.testing.expectEqual(@as(usize, 2 * per_peer_reserve), pool.protected);
    store.releaseHistory(message);
}

test "memory_safety: gossip queued handles survive payload and page reuse without retaining them" {
    const a = std.testing.allocator;
    var pool = try Pool.init(a, 1, Pool.capacity(1, 1));
    defer pool.deinit(a);
    var store = try storage.Store.init(a, 1, storage.page_bytes);
    defer store.deinit(a);
    var queue: Queue = .{ .pool = &pool };
    defer queue.reset();
    const old = store.put(.beacon_block, @splat(1), "topic", &([_]u8{7} ** 600)).?;
    store.retainHistory(old);
    store.seal(old);
    try queue.append(&store, old, .publication, .{ .bytes = 8192 }, 1);
    _ = queue.next(&store, 10, 30_000);
    store.releaseHistory(old);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
    try std.testing.expectEqual(store.next.len, store.free_pages);

    const fresh = store.put(.beacon_block, @splat(2), "topic", &([_]u8{9} ** 700)).?;
    store.retainHistory(fresh);
    store.seal(fresh);
    try std.testing.expectEqual(old.index, fresh.index);
    try std.testing.expect(old.generation != fresh.generation);
    try queue.append(&store, fresh, .forward, .{ .bytes = 8192 }, 2);
    try std.testing.expectEqual(fresh, (queue.next(&store, 10, 30_000)).?.message);
    try std.testing.expectEqual(@as(usize, 1), queue.count);
    try std.testing.expectEqual(@as(usize, 700), queue.bytes);
    try std.testing.expectEqual(@as(usize, 0), queue.local_bytes);
    try std.testing.expectEqual(@as(usize, 1), queue.ordinary_kind_entries[@intFromEnum(store.get(fresh).?.kind)]);
    try std.testing.expectEqual(@as(usize, 700), queue.ordinary_kind_bytes[@intFromEnum(store.get(fresh).?.kind)]);
    try std.testing.expectEqual(Origin.forward, complete(&queue, &store).origin);
    try std.testing.expectEqual(@as(usize, 0), queue.count);
    try std.testing.expectEqual(pool.slots.len, pool.available);
    store.releaseHistory(fresh);
}

fn complete(queue: *Queue, store: *const storage.Store) Receipt {
    _ = queue.next(store, 10, 30_000).?;
    return queue.complete();
}
