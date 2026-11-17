const std = @import("std");
const n = @import("network");
const t = n.peers.types;
const projection = @import("network_peer_projection.zig");
const Entry = projection.Entry;
const Lane = projection.Lane;

test "production peer lane preserves closed generations at capacity" {
    var lane: Lane = .{};
    var events: [64]t.Event = undefined;
    const peer: n.PeerId = .{ .bytes = @splat(0) };
    for (&events, 0..) |*event, i| event.* = .{ .closed = .{ .peer = .{ .index = @intCast(i), .generation = std.math.maxInt(u64) - i }, .connection = .{ .index = @intCast(i), .generation = std.math.maxInt(u32) }, .identity = peer, .reason = .host } };
    lane.publish(&events);
    try std.testing.expectEqual(@as(u8, 64), lane.len);
    var copied: [64]Entry = undefined;
    try std.testing.expectEqual(@as(usize, 64), lane.peek(&copied));
    for (copied, 0..) |entry, i| {
        try std.testing.expectEqual(std.math.maxInt(u64) - i, entry.closed.peer.generation);
        try std.testing.expectEqual(std.math.maxInt(u32), entry.closed.connection.generation);
    }
    lane.commit(32);
    lane.publish(events[0..32]);
    try std.testing.expectEqual(@as(usize, 64), lane.peek(&copied));
    try std.testing.expectEqual(@as(u16, 32), copied[0].closed.peer.index);
    try std.testing.expectEqual(@as(u16, 0), copied[32].closed.peer.index);
}

test "full production lane leaves catalog close pending until output resumes" {
    var catalog = try n.peers.Catalog.init(std.testing.allocator, .{ .capacity = 2, .outbound_reserve = 0, .target_peers = 1, .max_peers = 2, .min_outbound = 0 }, 1024, 0);
    defer catalog.deinit(std.testing.allocator);
    const local_key = try n.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{1}));
    const remote_key = try n.KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{2}));
    const local = n.PeerId.fromPublicKey(&local_key.publicKey());
    const remote = n.PeerId.fromPublicKey(&remote_key.publicKey());
    const handle: t.Handle = .{ .index = 0, .generation = 7 };
    const peer = catalog.admit(&remote, &local, handle, &.{ .direction = .outbound, .endpoint = .unspecified, .now_ms = 0 }).admitted.peer;
    var lane: Lane = .{};
    var output: [64]t.Event = undefined;
    for (0..64) |i| {
        try std.testing.expect(catalog.updateStatus(peer, handle, &.{ .head_slot = i }, i));
        const count = catalog.pollEvents(output[0 .. 64 - lane.len]);
        try std.testing.expectEqual(@as(usize, 1), count);
        lane.publish(output[0..count]);
    }
    try std.testing.expect(catalog.disconnect(peer, handle, .host, .{}, n.Now.fromMilliseconds(.{ .mono_ms = 100, .unix_s = 0 })));
    try std.testing.expectEqual(@as(usize, 0), catalog.pollEvents(output[0 .. 64 - lane.len]));
    try std.testing.expect(catalog.eventsPending());
    lane.commit(64);
    const count = catalog.pollEvents(&output);
    try std.testing.expectEqual(@as(usize, 1), count);
    lane.publish(output[0..count]);
    var copied: [1]Entry = undefined;
    _ = lane.peek(&copied);
    try std.testing.expectEqual(handle, copied[0].closed.connection);
    try std.testing.expectEqual(peer, copied[0].closed.peer);
}
