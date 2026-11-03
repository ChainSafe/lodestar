const schedule_test_support = @import("../schedule_test_support.zig");
const Now = @import("../types.zig").Now;
const Catalog = @import("catalog.zig").Catalog;
const std = @import("std");
const mod = @import("dialing.zig");
const t = @import("types.zig");
const enr = @import("enr.zig");
const KeyPair = @import("../wire/keys.zig").KeyPair;
const custody = @import("custody.zig");
const address: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 1234 } };

pub fn discovered(tag: u8, sync: u8) !enr.Candidate {
    var secret: [32]u8 = @splat(0);
    secret[31] = tag;
    const pair = try KeyPair.fromSecretKey(&secret);
    const key = pair.publicKey();
    const peer = t.PeerId.fromPublicKey(&key);
    return .{ .peer = peer, .node_id = try custody.nodeId(&peer), .addresses = .{ address, .unspecified }, .address_count = 1, .hints = .{ .sequence = 1, .record_hash = @splat(0), .fork = .{ .digest = @splat(0), .next_version = @splat(0), .next_epoch = 0 }, .next_fork_digest = null, .attnets = null, .syncnets = sync, .custody_group_count = null } };
}

pub fn initCatalog(allocator: std.mem.Allocator, options: mod.Dialing.Options) !Catalog {
    return Catalog.initWithIntents(allocator, .{ .capacity = 8, .max_peers = 8, .target_peers = 8, .min_outbound = 0, .outbound_reserve = 0 }, options.capacity, 1024, options.seed);
}
pub fn selectNext(q: *mod.Dialing, catalog: *Catalog, now: *u64) !mod.Dialing.Token {
    var out: [1]mod.Dialing.SelectedDial = undefined;
    now.* = refreshAndWakeup(q, catalog, now.*, 1).?;
    try std.testing.expectEqual(@as(usize, 1), q.poll(catalog, now.*, &out));
    return out[0].token;
}
pub fn accept(q: *mod.Dialing, catalog: *Catalog, peer: *const t.PeerId, conn: t.Handle, now_ms: u64) void {
    var events: [8]t.Event = undefined;
    _ = catalog.pollEvents(&events);
    const local: t.PeerId = .{ .bytes = @splat(0) };
    const decision = catalog.admit(peer, &local, conn, &.{ .direction = .outbound, .endpoint = address, .now_ms = now_ms });
    const ref = if (decision == .admitted) decision.admitted.peer else catalog.find(peer).?;
    std.debug.assert(std.meta.eql(catalog.rowFor(ref).?.connection, conn));
    q.accepted(catalog, ref, conn, now_ms);
}
pub fn disconnect(catalog: *Catalog, peer: *const t.PeerId, connected_at_ms: u64, reason: t.DisconnectReason, now_ms: u64) void {
    const ref = catalog.find(peer).?;
    const row = catalog.rowFor(ref).?;
    std.debug.assert(row.connected_at_ms == connected_at_ms);
    if (row.connection) |conn| std.debug.assert(catalog.disconnect(ref, conn, reason, .{}, Now.fromMilliseconds(.{ .mono_ms = now_ms, .unix_s = 0 })));
}

pub fn expire(queue: *mod.Dialing, catalog: *Catalog, now_ms: u64) !void {
    var close: [mod.Dialing.attempts_max]t.Handle = undefined;
    try std.testing.expectEqual(@as(usize, 0), queue.expire(catalog, now_ms, &close));
}

/// Refreshes pending mutations before observing the next timer in driver-style tests.
pub fn refreshAndWakeup(dialing: *mod.Dialing, catalog: *Catalog, now_ms: u64, capacity: usize) ?u64 {
    dialing.refresh(catalog, now_ms);
    return schedule_test_support.wakeupMilliseconds(dialing.schedule(catalog, capacity), now_ms);
}
