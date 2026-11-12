const Handle = @import("message_store.zig").Handle;
const Store = @import("message_store.zig").Store;
const topic = @import("topic.zig");
fn allocationProbe(a: std.mem.Allocator) !void {
    var store = try Store.init(a, 8, 8 * page_bytes);
    defer store.deinit(a);
}
const inline_bytes = @import("message_store.zig").inline_bytes;
const page_bytes = @import("message_store.zig").page_bytes;
const std = @import("std");

test "gossip store independent retains pages and stale handles" {
    var store = try Store.init(std.testing.allocator, 1, 3 * page_bytes);
    defer store.deinit(std.testing.allocator);
    const h = store.put(.beacon_block, [_]u8{1} ** 20, "topic", &([_]u8{9} ** (page_bytes + 1))).?;
    store.retainValidation(h);
    store.retainHistory(h);
    store.seal(h);
    store.releaseHistory(h);
    try std.testing.expectEqual(@as(usize, 1), store.free_pages);
    var c = store.cursor(h);
    try std.testing.expectEqual(page_bytes, store.segment(h, c).len);
    store.advance(&c, page_bytes);
    try std.testing.expectEqualSlices(u8, &.{9}, store.segment(h, c));
    store.releaseValidation(h);
    try std.testing.expectEqual(@as(usize, 3), store.free_pages);
    const replacement = store.put(.beacon_block, [_]u8{2} ** 20, "next", "x").?;
    try std.testing.expect(store.get(h) == null);
    try std.testing.expect(replacement.generation != h.generation);
    store.seal(replacement);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
}

test "gossip store small messages use startup inline storage and roll back allocation failures" {
    const a = std.testing.allocator;
    var store = try Store.init(a, 2048, page_bytes);
    defer store.deinit(a);
    for (0..2048) |i| {
        var id = [_]u8{0} ** 20;
        std.mem.writeInt(u64, id[0..8], i, .little);
        const h = store.put(.beacon_block, id, "t", &([_]u8{1} ** 200)).?;
        store.retainValidation(h);
        store.seal(h);
    }
    try std.testing.expectEqual(@as(usize, 1), store.free_pages);
    try std.testing.expectEqual(@as(usize, 2048), store.used_entries);
    try std.testing.checkAllAllocationFailures(a, allocationProbe, .{});
}

test "gossip retained pages and inline descriptors preserve fresh capacity by kind" {
    const limits_mod = @import("../gossip_limits.zig");
    const limits: limits_mod.Limits = @splat(.{ .items = 4, .bytes = page_bytes });
    var store = try Store.init(std.testing.allocator, 2 * limits_mod.items(&limits), 2 * limits_mod.bytes(&limits));
    defer store.deinit(std.testing.allocator);
    store.limits = limits;
    const name = "/eth2/01020304/beacon_attestation_0/ssz_snappy";
    var retained: [4]Handle = undefined;
    for (&retained) |*handle| {
        handle.* = store.put(topic.parseCanonical(name).?.name.kind, @splat(1), name, "small").?;
        store.retainHistory(handle.*);
        store.seal(handle.*);
    }
    var pending: [4]Handle = undefined;
    for (&pending) |*handle| {
        handle.* = store.put(topic.parseCanonical(name).?.name.kind, @splat(2), name, "fresh").?;
        store.retainValidation(handle.*);
        store.seal(handle.*);
        try std.testing.expect(!store.canRetain(handle.*));
    }
    try std.testing.expect(store.put(topic.parseCanonical(name).?.name.kind, @splat(3), name, "over") == null);
    const block = store.put(.beacon_block, @splat(4), "/eth2/01020304/beacon_block/ssz_snappy", "block").?;
    store.seal(block);
    for (retained) |handle| store.releaseHistory(handle);
    for (pending) |handle| store.releaseValidation(handle);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
    try std.testing.expectEqual(store.next.len, store.free_pages);
}

test "gossip retained page allowance cannot consume pending or other kind pages" {
    const limits_mod = @import("../gossip_limits.zig");
    const limits: limits_mod.Limits = @splat(.{ .items = 4, .bytes = page_bytes });
    var store = try Store.init(std.testing.allocator, 2 * limits_mod.items(&limits), 2 * limits_mod.bytes(&limits));
    defer store.deinit(std.testing.allocator);
    store.limits = limits;
    const name = "/eth2/01020304/beacon_attestation_0/ssz_snappy";
    const payload: [inline_bytes + 1]u8 = @splat(9);
    const retained = store.put(topic.parseCanonical(name).?.name.kind, @splat(1), name, &payload).?;
    store.retainHistory(retained);
    store.seal(retained);
    const pending = store.put(topic.parseCanonical(name).?.name.kind, @splat(2), name, &payload).?;
    store.retainValidation(pending);
    store.seal(pending);
    try std.testing.expect(!store.canRetain(pending));
    try std.testing.expect(store.put(topic.parseCanonical(name).?.name.kind, @splat(3), name, &payload) == null);
    const block = store.put(.beacon_block, @splat(4), "/eth2/01020304/beacon_block/ssz_snappy", &payload).?;
    store.seal(block);
    store.releaseHistory(retained);
    try std.testing.expect(store.canRetain(pending));
    store.releaseValidation(pending);
    try std.testing.expectEqual(store.next.len, store.free_pages);
}

fn expectedFrame(out: []u8, payload: []const u8, name: []const u8) []const u8 {
    const protobuf = @import("protobuf.zig");
    var writer = protobuf.Writer.init(out);
    writer.varint(protobuf.messageSize(payload, name));
    protobuf.writeMessage(&writer, payload, name);
    return writer.written();
}

/// Sends the entry's frame in writes of at most `write` bytes and returns the bytes sent and
/// the writes used.
fn sendFrame(store: *const Store, h: Handle, write: usize, out: []u8) struct { bytes: []const u8, writes: usize } {
    var at = store.frameCursor(h);
    var sent: usize = 0;
    for (0..out.len) |writes| {
        const segment = store.frameSegment(h, at);
        const take = @min(segment.len, write);
        @memcpy(out[sent..][0..take], segment[0..take]);
        sent += take;
        if (store.advanceFrame(h, &at, take)) return .{ .bytes = out[0..sent], .writes = writes + 1 };
    }
    unreachable;
}

test "gossip store keeps a whole inline frame contiguous and resumes it after a short write" {
    var store = try Store.init(std.testing.allocator, 1, page_bytes);
    defer store.deinit(std.testing.allocator);
    const name = "/eth2/01020304/sync_committee_contribution_and_proof/ssz_snappy";
    try std.testing.expectEqual(topic.topic_max_len, name.len);
    const payload: [inline_bytes]u8 = @splat(7);
    const h = store.put(topic.parseCanonical(name).?.name.kind, @splat(1), name, &payload).?;
    store.retainHistory(h);
    store.seal(h);
    var buffer: [1024]u8 = undefined;
    const expected = expectedFrame(&buffer, &payload, name);
    try std.testing.expectEqual(expected.len, store.get(h).?.frameLen());
    var at = store.frameCursor(h);
    try std.testing.expectEqualSlices(u8, expected, store.frameSegment(h, at));
    try std.testing.expect(!store.advanceFrame(h, &at, 100));
    try std.testing.expectEqualSlices(u8, expected[100..], store.frameSegment(h, at));
    try std.testing.expect(store.advanceFrame(h, &at, expected.len - 100));
    try std.testing.expectEqual(@as(usize, 0), store.frameSegment(h, at).len);
    try std.testing.expectEqualSlices(u8, &payload, store.segment(h, store.cursor(h)));
    try std.testing.expectEqualStrings(name, store.get(h).?.topicString());
    store.releaseHistory(h);
    try std.testing.expectEqual(@as(usize, 0), store.used_entries);
}

test "gossip store sends a paged payload as prefix pages and trailer across short writes" {
    var store = try Store.init(std.testing.allocator, 2, 4 * page_bytes);
    defer store.deinit(std.testing.allocator);
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    var payload: [2 * page_bytes + 100]u8 = undefined;
    for (&payload, 0..) |*byte, i| byte.* = @truncate(i *% 31);
    var expected_buffer: [3 * page_bytes]u8 = undefined;
    var sent_buffer: [3 * page_bytes]u8 = undefined;
    for ([_]usize{ inline_bytes + 1, payload.len }, [_]usize{ 3, 5 }) |len, segments| {
        const h = store.put(topic.parseCanonical(name).?.name.kind, @splat(@truncate(len)), name, payload[0..len]).?;
        store.retainHistory(h);
        store.seal(h);
        try std.testing.expectEqual(Store.pagesFor(len), store.next.len - store.free_pages);
        const expected = expectedFrame(&expected_buffer, payload[0..len], name);
        const whole = sendFrame(&store, h, expected.len, &sent_buffer);
        try std.testing.expectEqualSlices(u8, expected, whole.bytes);
        try std.testing.expectEqual(segments, whole.writes);
        // Writes of 1000 bytes end inside the prefix-page, page-page and page-trailer boundaries.
        try std.testing.expectEqualSlices(u8, expected, sendFrame(&store, h, 1000, &sent_buffer).bytes);
        try std.testing.expectEqualSlices(u8, expected, sendFrame(&store, h, 1, &sent_buffer).bytes);
        try std.testing.expectEqualSlices(u8, payload[0..@min(len, page_bytes)], store.segment(h, store.cursor(h)));
        store.releaseHistory(h);
        try std.testing.expectEqual(store.next.len, store.free_pages);
    }
}
