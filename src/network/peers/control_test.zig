const std = @import("std");
const t = @import("types.zig");
const w = @import("../control_wire.zig");
const Catalog = @import("catalog.zig").Catalog;
const Control = @import("control.zig").Control;
const support = @import("control_test_support.zig");
const rr = @import("../reqresp/root.zig");
const Now = @import("../types.zig").Now;

test "control disconnect returns the original closing state and refuses stale connections" {
    const a = std.testing.allocator;
    var catalog = try Catalog.init(a, .{ .capacity = 1, .outbound_reserve = 0, .target_peers = 1, .max_peers = 1, .min_outbound = 0 }, 1, 0);
    defer catalog.deinit(a);
    var control = try Control.init(a, .{}, 1);
    defer control.deinit(a);
    const now = Now.fromMilliseconds(.{ .mono_ms = 10, .unix_s = 0 });
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    const peer = catalog.admit(&.{ .bytes = @splat(1) }, &.{ .bytes = @splat(0) }, conn, &.{ .direction = .inbound, .endpoint = .unspecified, .now_ms = now.millis() }).admitted.peer;
    control.connected(&catalog, peer, conn, .inbound, now);
    try std.testing.expect(control.disconnect(&catalog, peer, .{ .index = 0, .generation = 2 }, .host, now) == null);
    const closing = control.disconnect(&catalog, peer, conn, .host, now).?;
    try std.testing.expectEqual(t.DisconnectReason.host, closing.reason);
    try std.testing.expectEqual(@as(u64, 2010), closing.deadline_ms);
    closing.sent = true;
    const repeated = control.disconnect(&catalog, peer, conn, .remote_goodbye, Now.fromMilliseconds(.{ .mono_ms = 20, .unix_s = 0 })).?;
    try std.testing.expectEqual(Control.Closing{ .reason = .host, .deadline_ms = 2010, .sent = true }, repeated.*);
    var io: support.Io = .{};
    try io.init();
    defer io.deinit();
    io.release(&control, peer, conn, now);
    try std.testing.expect(control.disconnect(&catalog, peer, conn, .host, now) == null);
}

test "control repeated Status intent preserves the first due time" {
    var control = try Control.init(std.testing.allocator, .{}, 2);
    defer control.deinit(std.testing.allocator);
    var catalog = try Catalog.init(std.testing.allocator, .{ .capacity = 2, .outbound_reserve = 0, .target_peers = 2, .max_peers = 2, .min_outbound = 0 }, 2, 0);
    defer catalog.deinit(std.testing.allocator);
    const first: t.PeerRef = .{ .index = 0, .generation = 1 };
    const second: t.PeerRef = .{ .index = 1, .generation = 1 };
    const first_conn: t.Handle = .{ .index = 0, .generation = 1 };
    const second_conn: t.Handle = .{ .index = 1, .generation = 1 };
    control.connected(&catalog, first, first_conn, .outbound, Now.fromMilliseconds(.{ .mono_ms = 10, .unix_s = 0 }));
    control.connected(&catalog, second, second_conn, .inbound, Now.fromMilliseconds(.{ .mono_ms = 10, .unix_s = 0 }));
    for ([_]u64{ 20, 30, 40 }) |now| {
        control.reStatusPeers(&catalog, Now.fromMilliseconds(.{ .mono_ms = now, .unix_s = 0 }));
        try std.testing.expect(control.reStatusPeer(&catalog, second, second_conn, Now.fromMilliseconds(.{ .mono_ms = now, .unix_s = 0 })));
        try std.testing.expectEqual(@as(u64, 10), control.connections[0].status_due_ms);
        try std.testing.expectEqual(@as(u64, 20), control.connections[1].status_due_ms);
    }
}

test "control start quota and cursor preserve order across Identify and RPC starts" {
    const a = std.testing.allocator;
    var catalog = try Catalog.init(a, .{ .capacity = 4, .outbound_reserve = 0, .target_peers = 4, .max_peers = 4, .min_outbound = 0 }, 4, 0);
    defer catalog.deinit(a);
    var control = try Control.init(a, .{ .starts_per_turn_max = 3 }, 4);
    defer control.deinit(a);
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 10, .unix_s = 0 });
    const local: t.LocalState = .{};
    const local_identity: t.PeerId = .{ .bytes = @splat(0) };
    for (0..4) |index| {
        const identity: t.PeerId = .{ .bytes = @splat(@intCast(index + 1)) };
        const conn: t.Handle = .{ .index = @intCast(index), .generation = 1 };
        const peer = catalog.admit(&identity, &local_identity, conn, &.{ .direction = .outbound, .endpoint = .unspecified, .now_ms = now.millis() }).admitted.peer;
        try std.testing.expect(catalog.updateStatus(peer, conn, &local.status, now.millis()));
        control.connected(&catalog, peer, conn, .outbound, now);
    }
    var io: support.Io = .{};
    try io.init();
    defer io.deinit();
    // Failed starts spend the same quota. Closing the fixture transport makes all starts fail.
    _ = io.pair.shared.pair.client.close(io.pair.shared.handles.client, 0);
    try io.maintain(&control, &catalog, &local, now);
    try std.testing.expectEqual(@as(usize, 2), control.cursor);
    try std.testing.expectEqual(@as(u64, 1010), control.connections[0].identify_retry_ms);
    try std.testing.expectEqual(@as(u64, 1010), control.connections[0].retry_ms);
    try std.testing.expectEqual(@as(u64, 1010), control.connections[1].identify_retry_ms);
    try std.testing.expectEqual(@as(u64, 0), control.connections[1].retry_ms);
    try io.maintain(&control, &catalog, &local, now);
    try std.testing.expectEqual(@as(usize, 0), control.cursor);
    try std.testing.expectEqual(@as(u64, 1010), control.connections[2].identify_retry_ms);
    try std.testing.expectEqual(@as(u64, 1010), control.connections[2].retry_ms);
    try std.testing.expectEqual(@as(u64, 1010), control.connections[3].identify_retry_ms);
    try std.testing.expectEqual(@as(u64, 0), control.connections[3].retry_ms);
    try std.testing.expectEqual(@as(u64, 0), control.counters.started);
    try std.testing.expectEqual(@as(u64, 2), control.counters.deferred);
    try std.testing.expectEqual(@as(u64, 7), control.visits);
}

test "peer control relevance boundary roots forks and availability" {
    var io: support.Io = .{};
    try io.init();
    defer io.deinit();
    var local: t.LocalState = .{};
    local.status.finalized_epoch = 4;
    local.status.finalized_root = @splat(1);
    var remote = local.status;
    remote.head_slot = 11;
    try std.testing.expectEqual(@as(?t.DisconnectReason, null), try statusVerdict(&io, &local, &remote, 10));
    remote.head_slot = 12;
    try std.testing.expectEqual(t.DisconnectReason.future_head, (try statusVerdict(&io, &local, &remote, 10)).?);
    remote.head_slot = 10;
    remote.fork_digest[0] = 1;
    try std.testing.expectEqual(t.DisconnectReason.incompatible_fork, (try statusVerdict(&io, &local, &remote, 10)).?);
    remote.fork_digest[0] = 0;
    remote.finalized_root = @splat(2);
    try std.testing.expectEqual(t.DisconnectReason.finalized_mismatch, (try statusVerdict(&io, &local, &remote, 10)).?);
    remote.finalized_epoch = 3;
    try std.testing.expect(try statusVerdict(&io, &local, &remote, 10) == null);
    remote.finalized_epoch = 4;
    remote.finalized_root = @splat(0);
    try std.testing.expect(try statusVerdict(&io, &local, &remote, 10) == null);
    local.fork.fork = .fulu;
    try std.testing.expectEqual(t.DisconnectReason.missing_availability, (try statusVerdict(&io, &local, &remote, 10)).?);
    remote.earliest_available_slot = 0;
    try std.testing.expect(try statusVerdict(&io, &local, &remote, 10) == null);
}

/// Delivers the remote Status as an inbound request on a fresh connection and returns the close
/// reason peer control chose, or null after it accepted the Status.
fn statusVerdict(io: *support.Io, local: *const t.LocalState, remote: *const t.Status, slot: u64) !?t.DisconnectReason {
    const a = std.testing.allocator;
    var catalog = try Catalog.init(a, .{ .capacity = 1, .outbound_reserve = 0, .target_peers = 1, .max_peers = 1, .min_outbound = 0 }, 1, 0);
    defer catalog.deinit(a);
    var control = try Control.init(a, .{}, 1);
    defer control.deinit(a);
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 10, .unix_s = 0 });
    const conn: t.Handle = .{ .index = 0, .generation = 1 };
    const peer = catalog.admit(&.{ .bytes = @splat(1) }, &.{ .bytes = @splat(0) }, conn, &.{ .direction = .inbound, .endpoint = .unspecified, .now_ms = now.millis() }).admitted.peer;
    control.connected(&catalog, peer, conn, .inbound, now);
    // Status v1 carries no earliest available slot.
    const protocol: w.Protocol = if (remote.earliest_available_slot == null) .status_v1 else .status_v2;
    var bytes: [w.status_size_max]u8 = undefined;
    const len = try w.encodeStatus(protocol, remote, &bytes);
    const request: rr.ReqResp.RequestHandle = .{ .index = 0, .generation = 1, .direction = .inbound };
    io.receive(&control, &catalog, local, .{ .request = .{ .request = request, .conn = conn, .protocol = protocol, .bytes = bytes[0..len] } }, now, slot);
    const snapshot = catalog.get(peer).?;
    if (snapshot.disconnect_reason) |reason| {
        try std.testing.expect(snapshot.status == null);
        return reason;
    }
    try std.testing.expectEqualDeep(remote.*, snapshot.status.?);
    return null;
}
