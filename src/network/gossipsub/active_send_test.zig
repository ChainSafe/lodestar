const std = @import("std");
const send = @import("active_send.zig");
const storage = @import("message_store.zig");

test "memory_safety: active gossip frames survive history expiry and store reuse" {
    for ([_]usize{ 100, 65_518, 65_519, 70_000 }) |len| {
        var store = try storage.Store.init(std.testing.allocator, 2, 40 * storage.page_bytes);
        defer store.deinit(std.testing.allocator);
        store.send_limits[0] = .{ .items = 1, .bytes = 20 * storage.page_bytes };
        const bytes = try std.testing.allocator.alloc(u8, len);
        defer std.testing.allocator.free(bytes);
        @memset(bytes, 17);
        const message = store.put(.beacon_block, @splat(1), "topic", bytes).?;
        store.retainHistory(message);
        store.seal(message);
        var buffer: [send.small_frame_bytes]u8 = undefined;
        var active = send.Frame.acquire(&store, message, &buffer, 10, 6000).?;
        const expected_len = store.get(message).?.frameLen();
        try std.testing.expectEqual(expected_len <= send.small_frame_bytes, active.frame == .small);
        if (len == 65_518) try std.testing.expectEqual(send.small_frame_bytes, expected_len);
        if (len == 65_519) try std.testing.expectEqual(send.small_frame_bytes + 1, expected_len);
        const expected = try std.testing.allocator.alloc(u8, expected_len);
        defer std.testing.allocator.free(expected);
        var cursor = store.frameCursor(message);
        for (0..40) |_| {
            const segment = store.frameSegment(message, cursor);
            @memcpy(expected[cursor.sent..][0..segment.len], segment);
            if (store.advanceFrame(message, &cursor, segment.len)) break;
        }
        try std.testing.expect(!active.frame.advance(1));
        store.releaseHistory(message);
        const replacement = store.put(.beacon_block, @splat(2), "topic", "replacement").?;
        store.retainHistory(replacement);
        store.seal(replacement);
        var sent: usize = 1;
        for (0..40) |_| {
            const segment = active.frame.segment(&buffer);
            try std.testing.expectEqualSlices(u8, expected[sent..][0..segment.len], segment);
            sent += segment.len;
            if (active.frame.advance(segment.len)) break;
        }
        try std.testing.expectEqual(expected_len, sent);
        active.frame.deinit();
        store.releaseHistory(replacement);
        try std.testing.expectEqual(@as(usize, 0), store.used_entries);
        try std.testing.expectEqual(store.next.len, store.free_pages);
    }
}

test "gossip shared sends charge once and cannot renew or start outside history" {
    var store = try storage.Store.init(std.testing.allocator, 4, 80 * storage.page_bytes);
    defer store.deinit(std.testing.allocator);
    store.send_limits[0] = .{ .items = 1, .bytes = 20 * storage.page_bytes };
    store.limits = @splat(.{ .items = 1, .bytes = 20 * storage.page_bytes });
    const data: [70_000]u8 = @splat(7);
    const first = store.put(.beacon_block, @splat(1), "topic", &data).?;
    store.retainHistory(first);
    store.seal(first);
    try std.testing.expectEqual(@as(?u64, 6010), store.retainSend(first, 10, 6000));
    try std.testing.expectEqual(@as(?u64, 6010), store.retainSend(first, 20, 6000));
    try std.testing.expectEqual(@as(usize, 1), store.sending_entries_by_kind[0]);
    store.releaseSend(first);
    store.releaseHistory(first);
    try std.testing.expect(store.retainSend(first, 30, 6000) == null);
    try std.testing.expect(store.pendingRoom(.beacon_block, data.len));
    store.releaseSend(first);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
    try std.testing.expectEqual(@as(usize, 0), store.sending_by_kind[0]);
    const third = store.put(.beacon_block, @splat(3), "topic", &data).?;
    store.retainHistory(third);
    store.seal(third);
    _ = store.retainSend(third, 40, 6000).?;
    store.releaseSend(third);
    try std.testing.expectEqual(@as(?u64, 6040), store.retainSend(third, 50, 6000));
    store.releaseSend(third);
    try std.testing.expect(store.retainSend(third, 6040, 6000) == null);
    store.releaseHistory(third);
}

test "gossip shared sends enforce per-kind bytes independently of items" {
    var store = try storage.Store.init(std.testing.allocator, 3, 60 * storage.page_bytes);
    defer store.deinit(std.testing.allocator);
    store.send_limits = @splat(.{ .items = 2, .bytes = 18 * storage.page_bytes });
    const bytes: [70_000]u8 = @splat(9);
    const first = store.put(.beacon_block, @splat(1), "/eth2/01020304/beacon_block/ssz_snappy", &bytes).?;
    const second = store.put(.beacon_block, @splat(2), "/eth2/01020304/beacon_block/ssz_snappy", &bytes).?;
    const column = store.put(.data_column_sidecar, @splat(3), "/eth2/01020304/data_column_sidecar_0/ssz_snappy", &bytes).?;
    for ([_]storage.Handle{ first, second, column }) |message| {
        store.retainHistory(message);
        store.seal(message);
    }
    _ = store.retainSend(first, 1, 6000).?;
    try std.testing.expect(store.retainSend(second, 2, 6000) == null);
    _ = store.retainSend(first, 2, 6000).?;
    _ = store.retainSend(column, 2, 6000).?;
    for ([_]storage.Handle{ first, second, column }) |message| store.releaseHistory(message);
    store.releaseSend(first);
    store.releaseSend(first);
    store.releaseSend(column);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
    try std.testing.expectEqual(store.next.len, store.free_pages);
}

test "gossip large sends bound distinct payloads separately from recipient count and pending storage" {
    var store = try storage.Store.init(std.testing.allocator, 17, 340 * storage.page_bytes);
    defer store.deinit(std.testing.allocator);
    store.send_limits[0] = .{ .items = 8, .bytes = 8 * 20 * storage.page_bytes };
    store.limits = @splat(.{ .items = 9, .bytes = 9 * 20 * storage.page_bytes });
    store.base_pages = 9 * 20;
    store.base_entries = 9;
    const bytes: [70_000]u8 = @splat(9);
    var messages: [9]storage.Handle = undefined;
    for (&messages, 0..) |*message, i| {
        message.* = store.put(.beacon_block, @splat(@intCast(i)), "topic", &bytes).?;
        store.retainHistory(message.*);
        store.seal(message.*);
    }
    try std.testing.expect(store.put(.beacon_block, @splat(10), "topic", &bytes) == null);
    for (messages[0..8]) |message| _ = store.retainSend(message, 1, 6000).?;
    try std.testing.expect(store.retainSend(messages[8], 2, 6000) == null);
    _ = store.retainSend(messages[0], 2, 6000).?;
    try std.testing.expectEqual(@as(usize, 8), store.sending_entries_by_kind[0]);
    store.releaseSend(messages[0]);
    for (messages) |message| store.releaseHistory(message);
    var pending: [9]storage.Handle = undefined;
    for (&pending, 0..) |*message, i| {
        message.* = store.put(.beacon_block, @splat(@intCast(i + 10)), "topic", &bytes).?;
        store.retainValidation(message.*);
        store.seal(message.*);
    }
    try std.testing.expectEqual(@as(usize, 9), store.pending_entries_by_kind[0]);
    for (pending) |message| store.releaseValidation(message);
    for (messages[0..8]) |message| store.releaseSend(message);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
    try std.testing.expectEqual(store.next.len, store.free_pages);
}
