const Handle = Engine.Handle;
const MessageId = [constants.message_id_length]u8;
const Sessions = @import("sessions.zig").Sessions;
const constants = @import("constants.zig");
const std = @import("std");
const Engine = @import("../quic/Engine.zig");
const test_support = @import("test_support.zig");
const receive_pool = @import("receive_pool.zig");

test "session slots track connection generations" {
    var sessions = try std.testing.allocator.create(Sessions);
    defer std.testing.allocator.destroy(sessions);
    sessions.* = try test_support.sessions(std.testing.allocator, constants.peers_cap);
    defer sessions.deinit(std.testing.allocator);
    const conn = Handle{ .index = 3, .generation = 1 };
    const peer = sessions.addPeer(conn).?;
    try std.testing.expectEqual(@as(?u16, peer.index), sessions.find(conn));

    sessions.removePeer(peer.index);
    try std.testing.expectEqual(@as(?u16, null), sessions.find(conn));
}

test "sessions suppresses ids per peer until monotonic expiry" {
    var sessions = try std.testing.allocator.create(Sessions);
    defer std.testing.allocator.destroy(sessions);
    sessions.* = try test_support.sessions(std.testing.allocator, constants.peers_cap);
    defer sessions.deinit(std.testing.allocator);
    const peer = sessions.addPeer(.{ .index = 1, .generation = 1 }).?;
    const id = [_]u8{7} ** 20;
    try std.testing.expect(!sessions.suppresses(peer.index, id, 0));
    sessions.suppress(peer.index, id, 0, 10);
    try std.testing.expect(!sessions.suppresses(peer.index, id, 10));
    try std.testing.expect(sessions.suppresses(peer.index, id, 0));
}

test "gossip stream cancellation discards unsent work and session reuse preserves receipt identity" {
    const a = std.testing.allocator;
    var sessions = try test_support.sessions(a, 1);
    defer sessions.deinit(a);
    const conn: Handle = .{ .index = 0, .generation = 1 };
    const first = sessions.addPeer(conn).?;
    const peer = &sessions.rows[first.index];
    const id: MessageId = @splat(1);
    peer.suppress(id, 1, 100);
    peer.io.ihave_recv = 10;
    peer.io.write_first = true;
    peer.io.tx.control_burst = 4;
    peer.io.tx.subscriptionChanged(0, 1);
    const token = peer.io.tx.injectFrame("frame", false, 1).?;
    peer.io.tx.drops[0] = 3;
    peer.io.tx.cancelStream();
    try std.testing.expectEqual(@as(usize, 0), peer.io.tx.subscription_dirty.count());
    try std.testing.expectEqual(@as(u8, 0), peer.io.tx.control_burst);
    try std.testing.expect(peer.suppresses(id, 2));
    sessions.removePeer(first.index);
    const next = sessions.addPeer(conn).?;
    try std.testing.expectEqual(first.index, next.index);
    try std.testing.expect(next.generation > first.generation);
    try std.testing.expect(!sessions.matches(first));
    try std.testing.expect(!peer.suppresses(id, 2));
    try std.testing.expectEqual(@as(u16, 0), peer.io.ihave_recv);
    try std.testing.expect(!peer.io.write_first);
    try std.testing.expectEqual(@as(u8, 0), peer.io.tx.control_burst);
    try std.testing.expectEqual(@as(usize, 0), peer.io.tx.subscription_dirty.count());
    try std.testing.expectEqual(@as(u64, 3), peer.io.tx.drops[0]);
    try std.testing.expect(peer.io.tx.injectFrame("next", false, 2).? > token);
    peer.io.tx.cancelStream();
}

test "gossip receive contention reclaims a larger partial frame and preserves completed work" {
    var sessions = try test_support.sessions(std.testing.allocator, 4);
    defer sessions.deinit(std.testing.allocator);
    for (0..4) |i| _ = sessions.addPeer(.{ .index = @intCast(i), .generation = 1 }).?;
    defer {
        for (0..4) |i| _ = sessions.resetRx(@intCast(i));
    }
    const incoming = &sessions.rows[0].io;
    const stalled = &sessions.rows[1].io;
    const complete = &sessions.rows[2].io;
    const pages = sessions.receive_pool.next.len;
    const page_bytes = receive_pool.page_bytes;
    for (0..pages) |i| {
        const io = &sessions.rows[1 + i % 3].io;
        @memset(sessions.receive_pool.writable(&io.overflow).?, 7);
        io.overflow.len += page_bytes;
    }
    stalled.reader.declared = constants.GOSSIP_MAX_SIZE;
    stalled.reader.filled = stalled.body.len + stalled.overflow.len;
    sessions.rows[3].io.reader.declared = constants.GOSSIP_MAX_SIZE;
    sessions.rows[3].io.reader.filled = sessions.rows[3].io.body.len + sessions.rows[3].io.overflow.len;
    complete.startRpc("done");
    try std.testing.expect(sessions.receive_pool.writable(&incoming.overflow) == null);
    try std.testing.expectEqual(@as(?u16, 1), sessions.receiveVictim(0));
    sessions.discardFrame(stalled);
    try std.testing.expect(sessions.receive_pool.writable(&incoming.overflow) != null);
    incoming.overflow.len += page_bytes;
    try std.testing.expect(complete.rpc != null);
    try std.testing.expect(stalled.discarding);
    for (0..4) |i| _ = sessions.resetRx(@intCast(i));
    try std.testing.expectEqual(pages, sessions.receive_pool.free_pages);
}

test "gossip receive eviction prefers early frames without protecting nearly complete frames" {
    var sessions = try test_support.sessions(std.testing.allocator, 4);
    defer sessions.deinit(std.testing.allocator);
    const page_bytes = receive_pool.page_bytes;
    for (0..4) |i| {
        _ = sessions.addPeer(.{ .index = @intCast(i), .generation = 1 }).?;
        const io = &sessions.rows[i].io;
        for (0..i + 1) |_| {
            _ = sessions.receive_pool.writable(&io.overflow).?;
            io.overflow.len += page_bytes;
        }
        io.reader.filled = io.body.len + io.overflow.len;
        io.reader.declared = io.reader.filled + 1;
    }
    defer {
        for (0..4) |i| _ = sessions.resetRx(@intCast(i));
    }
    // All frames are nearly complete: the largest still loses.
    try std.testing.expectEqual(@as(?u16, 3), sessions.receiveVictim(0));
    try std.testing.expectEqual(@as(?u16, null), sessions.receiveVictim(3));
    const early = &sessions.rows[1].io;
    early.reader.declared = early.reader.filled * 4 + 1;
    try std.testing.expectEqual(@as(?u16, 1), sessions.receiveVictim(3));
    // At exactly 25%, page count decides again.
    early.reader.declared = early.reader.filled * 4;
    try std.testing.expectEqual(@as(?u16, null), sessions.receiveVictim(3));
    early.reader.declared = early.reader.filled * 4 + 1;
    sessions.rows[2].io.reader.declared = sessions.rows[2].io.reader.filled * 4 + 1;
    try std.testing.expectEqual(@as(?u16, 2), sessions.receiveVictim(3));
    sessions.rows[2].io.startRpc("done");
    try std.testing.expectEqual(@as(?u16, 1), sessions.receiveVictim(3));
    sessions.discardFrame(early);
    try std.testing.expectEqual(@as(?u16, null), sessions.receiveVictim(3));
}

test "IDONTWANT history reclaims expired entries across ring wrap" {
    var sessions = try test_support.sessions(std.testing.allocator, 1);
    defer sessions.deinit(std.testing.allocator);
    const ref = sessions.addPeer(.{ .index = 0, .generation = 1 }).?;
    const peer = &sessions.rows[ref.index];
    for (0..constants.dont_send_cap + 3) |i| {
        var id: MessageId = @splat(0);
        std.mem.writeInt(u64, id[0..8], i, .little);
        peer.suppress(id, i, 10);
    }
    const last = constants.dont_send_cap + 2;
    peer.expireSuppressions(last);
    try std.testing.expectEqual(@as(u16, 10), peer.dont_send_len);
    for (0..constants.dont_send_cap + 3) |i| {
        var id: MessageId = @splat(0);
        std.mem.writeInt(u64, id[0..8], i, .little);
        try std.testing.expectEqual(i + 10 > last, peer.suppresses(id, last));
    }
    peer.expireSuppressions(last + 10);
    try std.testing.expectEqual(@as(u16, 0), peer.dont_send_len);
    peer.suppress(@splat(7), last + 10, 20);
    peer.suppress(@splat(8), last + 11, 1);
    peer.expireSuppressions(last + 12);
    try std.testing.expect(peer.suppresses(@splat(7), last + 12));
    try std.testing.expect(!peer.suppresses(@splat(8), last + 12));
    peer.expireSuppressions(last + 30);
    try std.testing.expectEqual(@as(u16, 0), peer.dont_send_len);
}
