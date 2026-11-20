const std = @import("std");
const Now = @import("../types.zig").Now;
const t = @import("types.zig");
const Catalog = @import("catalog.zig").Catalog;
const Handle = t.Handle;
const identify = @import("../identify/root.zig");
const custody = @import("custody.zig");
const opts: Catalog.Options = .{
    .capacity = 2,
    .outbound_reserve = 0,
    .target_peers = 2,
    .max_peers = 2,
    .min_outbound = 0,
};
const local = identity(
    "0025080212210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
);
const remote = identity(
    "0025080212210379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
);
const third = identity(
    "00250802122102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
);
fn identity(comptime hex: []const u8) t.PeerId {
    var value: t.PeerId = undefined;
    _ = std.fmt.hexToBytes(&value.bytes, hex) catch unreachable;
    return value;
}
const first = Handle{ .index = 1, .generation = 1 };
const replacement = Handle{ .index = 1, .generation = 2 };

fn at(ms: u64) Now {
    return Now.fromMilliseconds(.{ .mono_ms = ms, .unix_s = 0 });
}

test "peer options reject incompatible bounds before allocation" {
    try (Catalog.Options{}).validate();
    inline for (.{
        Catalog.Options{ .capacity = 0 },
        Catalog.Options{ .capacity = 4097 },
        Catalog.Options{ .outbound_reserve = 512 },
        Catalog.Options{ .max_peers = 513 },
        Catalog.Options{ .max_peers = 257 },
        Catalog.Options{ .target_peers = 97 },
        Catalog.Options{ .min_outbound = 65 },
        Catalog.Options{ .inbound_per_source_max = 0 },
        Catalog.Options{ .inbound_per_source_max = 257 },
    }) |options| try std.testing.expectError(error.InvalidOptions, options.validate());
}

test "peer catalog caps inbound IPv4 hosts and IPv6 /64 sources independent of ports and identities" {
    const addresses = [_][3]t.Address{
        .{
            .{ .ip4 = .{ .octets = .{ 203, 0, 113, 1 }, .port = 9000 } },
            .{ .ip4 = .{ .octets = .{ 203, 0, 113, 1 }, .port = 9001 } },
            .{ .ip4 = .{ .octets = .{ 203, 0, 113, 2 }, .port = 9000 } },
        },
        .{
            .{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1 }, .port = 9000 } },
            .{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8, 0, 0, 0, 1, 9, 8, 7, 6, 5, 4, 3, 2 }, .port = 9001 } },
            .{ .ip6 = .{ .octets = .{ 0x20, 1, 0xd, 0xb8, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1 }, .port = 9000 } },
        },
    };
    for (addresses) |sources| {
        var options = opts;
        options.inbound_per_source_max = 1;
        var c = try Catalog.init(std.testing.allocator, options, 4, 0);
        defer c.deinit(std.testing.allocator);
        const ref = c.admit(&remote, &local, first, &.{ .direction = .inbound, .endpoint = sources[0], .now_ms = 0 }).admitted.peer;
        const next: Handle = .{ .index = 2, .generation = 1 };
        try std.testing.expectEqual(Catalog.Admission.capacity, c.admit(&third, &local, next, &.{ .direction = .inbound, .endpoint = sources[1], .now_ms = 0 }));
        try std.testing.expect(c.find(&third) == null);
        try std.testing.expectEqual(@as(u16, 1), c.connectedCount());
        try std.testing.expect(try c.updateEndpoint(ref, first, &sources[1]));
        try std.testing.expect(c.admit(&third, &local, next, &.{ .direction = .inbound, .endpoint = sources[2], .now_ms = 0 }) == .admitted);
        try std.testing.expectError(error.SourceCapacity, c.updateEndpoint(ref, first, &sources[2]));
        try std.testing.expectEqualDeep(sources[1], c.get(ref).?.endpoint);
        try std.testing.expectEqual(@as(f64, 0), c.get(ref).?.score);
    }
}

test "peer catalog inbound source occupancy ends at disconnect or outbound replacement" {
    var options = opts;
    options.inbound_per_source_max = 1;
    var c = try Catalog.init(std.testing.allocator, options, 4, 0);
    defer c.deinit(std.testing.allocator);
    const address: t.Address = .{ .ip4 = .{ .octets = .{ 203, 0, 113, 1 }, .port = 9000 } };
    const next: Handle = .{ .index = 2, .generation = 1 };
    const inbound: Catalog.AdmissionOptions = .{ .direction = .inbound, .endpoint = address, .now_ms = 0 };
    const ref = c.admit(&remote, &local, first, &inbound).admitted.peer;
    try std.testing.expect(c.markUnavailable(ref, first, .capacity));
    try std.testing.expectEqual(Catalog.Admission.capacity, c.admit(&third, &local, next, &inbound));
    try std.testing.expect(c.disconnect(ref, first, .capacity, .{}, at(0)));
    try std.testing.expectEqual(@as(f64, 0), c.get(ref).?.score);
    var events: [2]t.Event = undefined;
    _ = c.pollEvents(&events);
    const other = c.admit(&third, &local, next, &inbound).admitted.peer;
    const outbound_options: Catalog.AdmissionOptions = .{ .direction = .outbound, .endpoint = address, .now_ms = 0 };
    const replaced = c.admit(&third, &local, replacement, &outbound_options).admitted;
    try std.testing.expectEqualDeep(next, replaced.displaced.?);
    try std.testing.expectEqualDeep(other, replaced.peer);
    try std.testing.expect(!c.disconnect(other, next, .transport_closed, .{}, at(0)));
    const fresh: t.PeerId = .{ .bytes = @splat(40) };
    try std.testing.expect(c.admit(&fresh, &local, next, &inbound) == .admitted);
    try std.testing.expectEqual(@as(u16, 2), c.connectedCount());
}

test "peer catalog source refusal preserves an existing outbound connection and direct intent" {
    var options = opts;
    options.inbound_per_source_max = 1;
    var c = try Catalog.initWithIntents(std.testing.allocator, options, 1, 4, 0);
    defer c.deinit(std.testing.allocator);
    const high: t.PeerId = .{ .bytes = @splat(255) };
    const address: t.Address = .{ .ip4 = .{ .octets = .{ 203, 0, 113, 1 }, .port = 9000 } };
    const next: Handle = .{ .index = 2, .generation = 1 };
    const inbound: Catalog.AdmissionOptions = .{ .direction = .inbound, .endpoint = address, .now_ms = 0 };
    _ = c.admit(&remote, &high, first, &inbound).admitted;
    const ref = try c.retainIntent(&third);
    try std.testing.expect(c.setDirect(ref, true));
    try std.testing.expectEqual(Catalog.Admission.capacity, c.admit(&third, &high, next, &inbound));
    try std.testing.expect(c.rowFor(ref).?.connection == null);
    try std.testing.expect(c.admit(&third, &high, next, &.{ .direction = .outbound, .endpoint = address, .now_ms = 0 }) == .admitted);
    try std.testing.expectEqual(Catalog.Admission.capacity, c.admit(&third, &high, replacement, &inbound));
    try std.testing.expectEqualDeep(next, c.get(ref).?.connection.?);
    try std.testing.expectEqualDeep(ref, c.findConnection(next).?);
    try std.testing.expectEqual(@as(f64, 0), c.get(ref).?.score);
    try std.testing.expectEqual(@as(u16, 2), c.connectedCount());
}

test "peer admission preserves dial commitments through inbound churn and goodbye" {
    var catalog = try Catalog.initWithIntents(std.testing.allocator, .{ .capacity = 16, .max_peers = 6, .target_peers = 4, .min_outbound = 1, .outbound_reserve = 0 }, 1, 16, 1);
    defer catalog.deinit(std.testing.allocator);
    for (0..4) |index| {
        const peer: t.PeerId = .{ .bytes = @splat(@as(u8, @intCast(index + 1))) };
        const conn: t.Handle = .{ .index = @intCast(index), .generation = 1 };
        try std.testing.expect(catalog.admit(&peer, &local, conn, &.{ .direction = .inbound, .endpoint = .unspecified, .now_ms = 0, .outbound_reserved = 2 }) == .admitted);
    }
    for (0..12) |index| {
        const peer: t.PeerId = .{ .bytes = @splat(@as(u8, @intCast(index + 20))) };
        try std.testing.expectEqual(Catalog.Admission.capacity, catalog.admit(&peer, &local, .{ .index = 8, .generation = 1 }, &.{ .direction = .inbound, .endpoint = .unspecified, .now_ms = index, .outbound_reserved = 2 }));
    }
    const direct = try catalog.retainIntent(&third);
    try std.testing.expect(catalog.setDirect(direct, true));
    try std.testing.expectEqual(Catalog.Admission.capacity, catalog.admit(&third, &local, .{ .index = 9, .generation = 1 }, &.{ .direction = .inbound, .endpoint = .unspecified, .now_ms = 20, .outbound_reserved = 2, .pending_dials = 2 }));
    try std.testing.expect(catalog.admit(&third, &local, .{ .index = 9, .generation = 1 }, &.{ .direction = .inbound, .endpoint = .unspecified, .now_ms = 20, .outbound_reserved = 2, .pending_dials = 1 }) == .admitted);
    const selected = catalog.admit(&remote, &local, .{ .index = 10, .generation = 1 }, &.{ .direction = .outbound, .endpoint = .unspecified, .now_ms = 20, .outbound_reserved = 2 }).admitted;
    try std.testing.expectEqual(@as(u16, 6), catalog.connectedCount());
    try std.testing.expect(catalog.markUnavailable(selected.peer, .{ .index = 10, .generation = 1 }, .count_pruning));
    try std.testing.expectEqual(@as(u16, 6), catalog.connectedCount());
    const other: t.PeerId = .{ .bytes = @splat(99) };
    try std.testing.expectEqual(Catalog.Admission.capacity, catalog.admit(&other, &local, .{ .index = 11, .generation = 1 }, &.{ .direction = .outbound, .endpoint = .unspecified, .now_ms = 21 }));
    try std.testing.expect(catalog.deferRedial(selected.peer, .{ .index = 10, .generation = 1 }, 20, 300_000));
    try std.testing.expect(catalog.disconnect(selected.peer, .{ .index = 10, .generation = 1 }, .count_pruning, .{}, at(22)));
    try std.testing.expectEqual(Catalog.Admission.cooldown, catalog.admit(&remote, &local, .{ .index = 10, .generation = 2 }, &.{ .direction = .inbound, .endpoint = .unspecified, .now_ms = 23 }));
    try std.testing.expectEqual(@as(f64, 0), catalog.get(selected.peer).?.score);
}
fn admit(
    c: *Catalog,
    id: *const t.PeerId,
    conn: Handle,
    direction: t.Direction,
    now: u64,
) Catalog.Admission {
    return c.admit(id, &local, conn, &.{
        .direction = direction,
        .endpoint = .unspecified,
        .now_ms = now,
    });
}
test "peer catalog identity duplicates and obsolete close preserve replacement" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    try std.testing.expectEqual(
        Catalog.Admission.duplicate,
        admit(&c, &remote, replacement, .inbound, 0),
    );
    const result = admit(&c, &remote, replacement, .outbound, 0).admitted;
    try std.testing.expectEqual(first, result.displaced.?);
    try std.testing.expectEqual(ref, result.peer);
    try std.testing.expect(!c.disconnect(ref, first, .transport_closed, .{}, at(1)));
    try std.testing.expectEqual(replacement, c.get(ref).?.connection.?);
    const distinct = third;
    const other = admit(&c, &distinct, .{ .index = 0, .generation = 1 }, .inbound, 1).admitted.peer;
    try std.testing.expect(!std.meta.eql(ref, other));
}
test "peer catalog zero output closes native ownership and pins terminal until one output" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .outbound, 0).admitted.peer;
    try std.testing.expect(c.updateStatus(ref, first, &.{}, 0));
    var out: [1]t.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&out));
    try std.testing.expectEqual(.ready, std.meta.activeTag(out[0]));
    try std.testing.expect(c.disconnect(ref, first, .host, .{}, at(1)));
    try std.testing.expectEqual(@as(usize, 0), c.pollEvents(&.{}));
    try std.testing.expect(c.get(ref).?.connection == null);
    try std.testing.expectEqual(
        Catalog.Admission.pending,
        admit(&c, &remote, replacement, .outbound, 2),
    );
    try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&out));
    try std.testing.expectEqual(.closed, std.meta.activeTag(out[0]));
    try std.testing.expectEqual(ref, admit(&c, &remote, replacement, .outbound, 2).admitted.peer);
}

test "peer catalog endpoint observations preserve publication and connection generations" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    const initial: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4001 } };
    const rebound: t.Address = .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 4002 } };
    var out: [1]t.Event = undefined;
    try std.testing.expect(try c.updateEndpoint(ref, first, &initial));
    try std.testing.expectEqual(@as(usize, 0), c.pollEvents(&out));
    try std.testing.expect(c.updateStatus(ref, first, &.{}, 0));
    try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&out));
    try std.testing.expectEqual(initial, out[0].ready.endpoint);

    try std.testing.expect(try c.updateEndpoint(ref, first, &rebound));
    try std.testing.expectEqual(@as(usize, 0), c.pollEvents(&.{}));
    try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&out));
    try std.testing.expectEqual(rebound, out[0].updated.endpoint);
    try std.testing.expect(try c.updateEndpoint(ref, first, &rebound));
    try std.testing.expectEqual(@as(usize, 0), c.pollEvents(&out));

    const admitted = admit(&c, &remote, replacement, .outbound, 1).admitted;
    try std.testing.expectEqual(first, admitted.displaced.?);
    try std.testing.expect(try c.updateEndpoint(ref, replacement, &initial));
    try std.testing.expect(!try c.updateEndpoint(ref, first, &rebound));
    try std.testing.expect(!try c.updateEndpoint(.{ .index = ref.index, .generation = ref.generation + 1 }, replacement, &rebound));
    try std.testing.expectEqual(initial, c.get(ref).?.endpoint);
    try std.testing.expect(c.markUnavailable(ref, replacement, .host));
    try std.testing.expect(!try c.updateEndpoint(ref, replacement, &rebound));
    try std.testing.expect(c.disconnect(ref, replacement, .host, .{}, at(2)));
    try std.testing.expect(!try c.updateEndpoint(ref, replacement, &rebound));
}
test "peer catalog bounds banned retention while preserving the outbound reserve" {
    var options = opts;
    options.outbound_reserve = 1;
    var c = try Catalog.init(std.testing.allocator, options, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    try std.testing.expectEqual(t.ReputationDecision.ban, c.report(ref, .fatal, 0).?);
    try std.testing.expect(c.disconnect(ref, first, .banned, .{}, at(0)));
    var out: [1]t.Event = undefined;
    _ = c.pollEvents(&out);
    try std.testing.expectEqual(Catalog.Admission.banned, admit(&c, &remote, replacement, .inbound, 1));
    const distinct = third;
    const fresh = admit(&c, &distinct, replacement, .inbound, 1).admitted;
    try std.testing.expect(fresh.fresh);
    try std.testing.expectEqual(ref.index, fresh.peer.index);
    try std.testing.expect(c.get(ref) == null);
    const recovered = admit(&c, &remote, first, .outbound, 1).admitted;
    try std.testing.expect(recovered.peer.index != fresh.peer.index);
}
test "peer catalog cooldown churn cannot exclude a fresh inbound identity" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    for ([_]t.PeerId{ remote, third }, 0..) |identity_value, index| {
        const conn: Handle = .{ .index = @intCast(index), .generation = 1 };
        const peer = admit(&c, &identity_value, conn, .inbound, 0).admitted.peer;
        try std.testing.expect(c.cooldown(peer, conn, 0, 600_000));
        try std.testing.expect(c.disconnect(peer, conn, .remote_goodbye, .{}, at(0)));
    }
    var out: [2]t.Event = undefined;
    _ = c.pollEvents(&out);
    try std.testing.expectEqual(Catalog.Admission.cooldown, admit(&c, &remote, replacement, .inbound, 1));
    var fresh = third;
    fresh.bytes[0] ^= 1;
    try std.testing.expect(admit(&c, &fresh, replacement, .inbound, 1) == .admitted);
}

test "peer catalog local pruning enforces reconnection cooldown without a score penalty" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    try std.testing.expect(c.deferRedial(ref, first, 0, 300_000));
    try std.testing.expect(c.disconnect(ref, first, .count_pruning, .{}, at(0)));
    var out: [1]t.Event = undefined;
    _ = c.pollEvents(&out);
    try std.testing.expectEqual(@as(u64, 300_000), c.get(ref).?.redial_until_ms);
    try std.testing.expectEqual(Catalog.Admission.cooldown, admit(&c, &remote, replacement, .inbound, 1));
    try std.testing.expectEqual(@as(f64, 0), c.get(ref).?.score);
    try std.testing.expect(!c.deferRedial(ref, first, 1, 300_000));
    try std.testing.expect(admit(&c, &remote, replacement, .inbound, 300_000) == .admitted);
    try std.testing.expect(c.cooldown(ref, replacement, 300_000, 600_000));
    try std.testing.expect(c.disconnect(ref, replacement, .remote_goodbye, .{}, at(300_000)));
    _ = c.pollEvents(&out);
    try std.testing.expectEqual(Catalog.Admission.cooldown, admit(&c, &remote, first, .inbound, 300_001));
}

test "peer catalog exhausted generations never wrap and allocator cleanup" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    c.rows[0].generation = std.math.maxInt(u64);
    const ref = admit(&c, &remote, first, .outbound, 0).admitted.peer;
    try std.testing.expectEqual(@as(u16, 1), ref.index);
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocationCheck, .{});
}
fn allocationCheck(a: std.mem.Allocator) !void {
    var c = try Catalog.init(a, opts, 1024, 0);
    defer c.deinit(a);
}
test "peer catalog published replacement updates availability and rejects stale completions" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    try std.testing.expect(c.updateStatus(ref, first, &.{}, 0));
    var out: [1]t.Event = undefined;
    _ = c.pollEvents(&out);
    _ = admit(&c, &remote, replacement, .outbound, 1).admitted;
    try std.testing.expect(!c.updateStatus(ref, first, &.{}, 2));
    try std.testing.expect(!c.updateMetadata(ref, first, &.{}, 2));
    try std.testing.expect(!c.cooldown(ref, first, 2, 100));
    try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&out));
    try std.testing.expect(!out[0].updated.relevant);
    try std.testing.expectEqual(replacement, out[0].updated.connection.?);
    try std.testing.expect(c.updateStatus(ref, replacement, &.{}, 3));
    try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&out));
    try std.testing.expect(out[0].updated.relevant);
    try std.testing.expectEqual(@as(usize, 0), c.pollEvents(&out));
}
test "peer catalog larger local identity prefers inbound and unchanged direction keeps owner" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = c.admit(&local, &remote, first, &.{
        .direction = .outbound,
        .endpoint = .unspecified,
        .now_ms = 0,
    }).admitted.peer;
    try std.testing.expectEqual(first, c.admit(&local, &remote, replacement, &.{
        .direction = .inbound,
        .endpoint = .unspecified,
        .now_ms = 0,
    }).admitted.displaced.?);
    try std.testing.expectEqual(Catalog.Admission.duplicate, c.admit(&local, &remote, first, &.{
        .direction = .outbound,
        .endpoint = .unspecified,
        .now_ms = 0,
    }));
    try std.testing.expectEqual(replacement, c.get(ref).?.connection.?);
}
test "peer catalog unpublished closure coalesces updates without artificial ready" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .outbound, 0).admitted.peer;
    try std.testing.expect(c.updateStatus(ref, first, &.{}, 1));
    try std.testing.expect(c.updateStatus(ref, first, &.{ .head_slot = 2 }, 2));
    try std.testing.expect(c.updateMetadata(ref, first, &.{ .seq_number = 2 }, 2));
    try std.testing.expect(!c.updateMetadata(ref, first, &.{ .seq_number = 1 }, 3));
    try std.testing.expect(c.disconnect(ref, first, .host, .{}, at(3)));
    var out: [1]t.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&out));
    try std.testing.expectEqual(.closed, std.meta.activeTag(out[0]));
    try std.testing.expectEqual(@as(usize, 0), c.pollEvents(&out));
}
test "peer catalog negative reconnect survives while direct and pending slots resist reuse" {
    var options = opts;
    options.capacity = 1;
    options.max_peers = 1;
    options.target_peers = 1;
    var c = try Catalog.init(std.testing.allocator, options, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .outbound, 0).admitted.peer;
    _ = c.report(ref, .mid_tolerance, 0);
    try std.testing.expect(c.disconnect(ref, first, .host, .{}, at(0)));
    const other = third;
    try std.testing.expectEqual(Catalog.Admission.capacity, admit(&c, &other, replacement, .outbound, 0));
    var out: [1]t.Event = undefined;
    _ = c.pollEvents(&out);
    try std.testing.expectEqual(ref, admit(&c, &remote, replacement, .outbound, 0).admitted.peer);
    try std.testing.expectEqual(@as(f64, -5), c.get(ref).?.score);
    try std.testing.expect(c.setDirect(ref, true));
    try std.testing.expect(c.disconnect(ref, replacement, .host, .{}, at(0)));
    _ = c.pollEvents(&out);
    try std.testing.expectEqual(
        Catalog.Admission.capacity,
        admit(&c, &other, replacement, .outbound, 40_000_000),
    );
    try std.testing.expect(c.setDirect(ref, false));
    const next = admit(&c, &other, replacement, .outbound, 40_000_000).admitted.peer;
    try std.testing.expectEqual(ref.generation + 1, next.generation);
    try std.testing.expect(c.get(ref) == null);
    var snapshots: [1]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 1), c.snapshots(&snapshots));
    try std.testing.expectEqual(next, snapshots[0].peer);
}
test "peer catalog rejected banned reconnect does not mutate retained reputation" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .outbound, 0).admitted.peer;
    _ = c.report(ref, .fatal, 0);
    try std.testing.expect(c.disconnect(ref, first, .banned, .{}, at(0)));
    var out: [1]t.Event = undefined;
    _ = c.pollEvents(&out);
    const before = c.rows[ref.index].reputation;
    try std.testing.expectEqual(
        Catalog.Admission.banned,
        admit(&c, &remote, replacement, .outbound, 1_800_000),
    );
    try std.testing.expectEqual(
        Catalog.Admission.banned,
        admit(&c, &remote, replacement, .outbound, 2_400_000),
    );
    try std.testing.expectEqual(before, c.rows[ref.index].reputation);
    c.advanceClock(2_400_001);
    try std.testing.expectEqual(
        ref,
        admit(&c, &remote, replacement, .outbound, 2_400_001).admitted.peer,
    );
    try std.testing.expect(c.get(ref).?.score > -50);
}
test "peer catalog accepts native generation zero and still rejects another full handle" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const zero: Handle = .{ .index = 0, .generation = 0 };
    const ref = admit(&c, &remote, zero, .outbound, 0).admitted.peer;
    try std.testing.expect(ref.generation != 0);
    try std.testing.expect(c.updateStatus(ref, zero, &.{}, 0));
    try std.testing.expect(!c.disconnect(ref, .{ .index = 0, .generation = 1 }, .host, .{}, at(0)));
    try std.testing.expect(c.disconnect(ref, zero, .host, .{}, at(0)));
}

test "peer catalog custody binds authenticated generations and preserves unchanged freshness work" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    const fork: t.ForkContext = .{ .fork = .fulu, .custody_groups = 128 };
    try std.testing.expect(c.updateStatus(ref, first, &.{ .earliest_available_slot = 0 }, 0));
    const metadata: t.Metadata = .{ .custody_group_count = 127 };
    try std.testing.expect(c.updateMetadata(ref, first, &metadata, 0));
    var budget: u16 = 64;
    try std.testing.expect(c.advanceCustody(&fork, 0, 60_000, &budget));
    try std.testing.expectEqual(@as(u16, 0), budget);
    try std.testing.expect(c.get(ref).?.custody_groups == null);
    for (0..63) |i| {
        try std.testing.expect(c.updateMetadata(ref, first, &metadata, i + 1));
        budget = 64;
        _ = c.advanceCustody(&fork, i + 1, 60_000, &budget);
    }
    try std.testing.expectEqual(@as(usize, 127), c.get(ref).?.custody_groups.?.count());
    budget = 64;
    _ = c.advanceCustody(&fork, 64, 60_000, &budget);
    try std.testing.expectEqual(@as(u16, 64), budget);
    const changed: t.ForkContext = .{ .fork = .fulu, .custody_groups = 64 };
    _ = c.advanceCustody(&changed, 64, 60_000, &budget);
    try std.testing.expect(c.get(ref).?.custody_groups == null);
    const result = admit(&c, &remote, replacement, .outbound, 64).admitted;
    try std.testing.expectEqual(ref, result.peer);
    try std.testing.expect(c.get(ref).?.custody_groups == null);
    try std.testing.expect(!c.updateMetadata(ref, first, &metadata, 65));
}

test "peer catalog custody completion emits one update with and without hashing" {
    for ([_]u16{ 127, 128 }) |count| {
        var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
        defer c.deinit(std.testing.allocator);
        const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
        try std.testing.expect(c.updateStatus(ref, first, &.{ .earliest_available_slot = 0 }, 0));
        try std.testing.expect(c.updateMetadata(ref, first, &.{ .custody_group_count = count }, 0));
        var events: [1]t.Event = undefined;
        try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&events));
        try std.testing.expect(events[0].ready.custody_groups == null);
        var updates: usize = 0;
        for (0..64) |turn| {
            var budget: u16 = if (count == 128) 0 else 64;
            _ = c.advanceCustody(&.{ .fork = .fulu }, turn, 60_000, &budget);
            if (c.pollEvents(&events) != 0) {
                updates += 1;
                try std.testing.expectEqual(@as(usize, count), events[0].updated.custody_groups.?.count());
            }
        }
        try std.testing.expectEqual(@as(usize, 1), updates);
    }
}

test "peer catalog changed custody metadata immediately invalidates copied groups" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    try std.testing.expect(c.updateStatus(ref, first, &.{}, 0));
    try std.testing.expect(c.updateMetadata(ref, first, &.{ .custody_group_count = 128 }, 0));
    var budget: u16 = 0;
    _ = c.advanceCustody(&.{}, 0, 60_000, &budget);
    try std.testing.expectEqual(@as(usize, 128), c.get(ref).?.custody_groups.?.count());
    try std.testing.expect(c.updateMetadata(ref, first, &.{ .seq_number = 1, .custody_group_count = 1 }, 1));
    try std.testing.expect(c.get(ref).?.custody_groups == null);
}

test "peer catalog replacement and reuse reject stale mutations" {
    var options = opts;
    options.capacity = 1;
    options.max_peers = 1;
    options.target_peers = 1;
    var c = try Catalog.init(std.testing.allocator, options, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    _ = admit(&c, &remote, replacement, .outbound, 1).admitted;
    const replaced = c.get(ref).?;
    try std.testing.expectEqual(replacement, replaced.connection.?);
    try std.testing.expect(!c.updateMetadata(ref, first, &.{}, 1));
    try std.testing.expect(!c.disconnect(ref, first, .host, .{}, at(1)));
    try std.testing.expectEqualDeep(replaced, c.get(ref).?);
    try std.testing.expect(c.disconnect(ref, replacement, .host, .{}, at(2)));
    var events: [1]t.Event = undefined;
    _ = c.pollEvents(&events);
    const reused = admit(&c, &third, first, .outbound, 3).admitted.peer;
    try std.testing.expectEqual(ref.index, reused.index);
    try std.testing.expect(reused.generation > ref.generation);
    try std.testing.expect(c.get(ref) == null);
    const current = c.get(reused).?;
    try std.testing.expect(!c.setDirect(ref, true));
    try std.testing.expectEqualDeep(current, c.get(reused).?);
    try std.testing.expect(c.setDirect(reused, true));
    try std.testing.expect(c.get(reused).?.direct);
}

test "peer catalog zero hash custody completion invalidates prior policy observation" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .outbound, 0).admitted.peer;
    try std.testing.expect(c.updateStatus(ref, first, &.{ .earliest_available_slot = 0 }, 0));
    try std.testing.expect(c.updateMetadata(ref, first, &.{ .custody_group_count = 128 }, 0));
    c.selection_dirty = false;
    try std.testing.expect(c.get(ref).?.custody_groups == null);
    var budget: u16 = 0;
    try std.testing.expect(!c.advanceCustody(&.{ .fork = .fulu }, 0, 60_000, &budget));
    try std.testing.expectEqual(@as(usize, 128), c.get(ref).?.custody_groups.?.count());
    try std.testing.expect(c.selection_dirty);
}

test "identify catalog metadata copies only to current full peer and transport generation" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    try std.testing.expect(c.updateStatus(ref, first, &.{}, 0));
    var events: [1]t.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&events));
    var metadata: identify.Metadata = .{ .agent = try .init("stock") };
    try std.testing.expect(c.updateIdentify(ref, first, &metadata));
    metadata.agent.?.bytes[0] = 'x';
    try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&events));
    try std.testing.expectEqual(.updated, std.meta.activeTag(events[0]));
    try std.testing.expectEqualStrings("stock", events[0].updated.identify.?.agent.?.slice());
    _ = admit(&c, &remote, replacement, .outbound, 1).admitted;
    try std.testing.expect(c.get(ref).?.identify == null);
    try std.testing.expect(!c.updateIdentify(ref, first, &metadata));
    var stale = ref;
    stale.generation += 1;
    try std.testing.expect(!c.updateIdentify(stale, replacement, &metadata));
    try std.testing.expect(c.updateIdentify(ref, replacement, &metadata));
}

test "peer catalog sampling publishes complete pair and invalidates closed generation" {
    var options = opts;
    options.capacity = 1;
    options.max_peers = 1;
    options.target_peers = 1;
    var c = try Catalog.init(std.testing.allocator, options, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    var fork: t.ForkContext = .{ .fork = .fulu, .custody_groups = 128, .minimum_sampling_groups = 127 };
    const metadata: t.Metadata = .{ .custody_group_count = 4 };
    try std.testing.expect(c.updateStatus(ref, first, &.{ .earliest_available_slot = 0 }, 0));
    try std.testing.expect(c.updateMetadata(ref, first, &metadata, 0));
    var budget: u16 = 64;
    try std.testing.expect(c.advanceCustody(&fork, 0, 60_000, &budget));
    try std.testing.expectEqual(@as(u16, 0), budget);
    try std.testing.expect(c.get(ref).?.custody_groups == null);
    try std.testing.expect(c.get(ref).?.sampling_groups == null);
    const before = c.rows[ref.index].custody_work.?.totalHashes();
    try std.testing.expect(c.updateMetadata(ref, first, &metadata, 1));
    try std.testing.expectEqual(before, c.rows[ref.index].custody_work.?.totalHashes());
    for (0..63) |_| {
        budget = 64;
        _ = c.advanceCustody(&fork, 1, 60_000, &budget);
    }
    try std.testing.expectEqual(@as(usize, 4), c.get(ref).?.custody_groups.?.count());
    try std.testing.expectEqual(@as(usize, 127), c.get(ref).?.sampling_groups.?.count());
    fork.minimum_sampling_groups = 128;
    budget = 64;
    _ = c.advanceCustody(&fork, 1, 60_000, &budget);
    try std.testing.expectEqual(@as(usize, 4), c.get(ref).?.custody_groups.?.count());
    try std.testing.expectEqual(@as(usize, 128), c.get(ref).?.sampling_groups.?.count());
    try std.testing.expect(c.disconnect(ref, first, .host, .{}, at(2)));
    try std.testing.expect(c.get(ref).?.custody_groups == null);
    try std.testing.expect(c.get(ref).?.sampling_groups == null);
    var events: [1]t.Event = undefined;
    _ = c.pollEvents(&events);
    const reused = admit(&c, &third, replacement, .outbound, 3).admitted.peer;
    try std.testing.expectEqual(ref.index, reused.index);
    try std.testing.expect(reused.generation > ref.generation);
    try std.testing.expect(!c.updateMetadata(ref, first, &metadata, 3));
    try std.testing.expect(c.get(reused).?.sampling_groups == null);
}

test "peer catalog sampling exhaustion never exposes custody checkpoint or retries" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    const fork: t.ForkContext = .{ .fork = .fulu, .minimum_sampling_groups = 127 };
    const metadata: t.Metadata = .{ .custody_group_count = 4 };
    try std.testing.expect(c.updateStatus(ref, first, &.{ .earliest_available_slot = 0 }, 0));
    try std.testing.expect(c.updateMetadata(ref, first, &metadata, 0));
    var budget: u16 = 64;
    try std.testing.expect(c.advanceCustody(&fork, 0, 60_000, &budget));
    const work = &c.rows[ref.index].custody_work.?;
    try std.testing.expect(work.checkpoint != null);
    work.walk.hashes = 4095;
    budget = 64;
    try std.testing.expect(!c.advanceCustody(&fork, 0, 60_000, &budget));
    try std.testing.expectEqual(@as(u16, 63), budget);
    try std.testing.expect(work.exhausted());
    try std.testing.expect(work.checkpoint == null);
    try std.testing.expect(c.get(ref).?.custody_groups == null);
    try std.testing.expect(c.get(ref).?.sampling_groups == null);
    const score = c.get(ref).?.score;
    for (0..4) |i| {
        try std.testing.expect(c.updateMetadata(ref, first, &metadata, i + 1));
        budget = 64;
        try std.testing.expect(!c.advanceCustody(&fork, i + 1, 60_000, &budget));
        try std.testing.expectEqual(@as(u16, 64), budget);
        try std.testing.expectEqual(score, c.get(ref).?.score);
    }
}

test "unchanged metadata confirms freshness without publishing" {
    var c = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    try std.testing.expect(c.updateStatus(ref, first, &.{}, 0));
    const metadata: t.Metadata = .{ .seq_number = 7 };
    try std.testing.expect(c.updateMetadata(ref, first, &metadata, 1));
    var events: [1]t.Event = undefined;
    try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&events));
    try std.testing.expect(c.updateMetadata(ref, first, &metadata, 20));
    try std.testing.expectEqual(@as(u64, 20), c.get(ref).?.metadata_at_ms);
    try std.testing.expectEqual(@as(usize, 0), c.pollEvents(&events));
    try std.testing.expect(!c.updateMetadata(ref, first, &.{ .seq_number = 6 }, 21));
    try std.testing.expect(c.updateMetadata(ref, first, &.{ .seq_number = 8 }, 22));
    try std.testing.expectEqual(@as(usize, 1), c.pollEvents(&events));
}

test "catalog indexes retain disconnected identity and reject displaced and recycled connections" {
    var c = try Catalog.init(std.testing.allocator, opts, 4, 71);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .inbound, 0).admitted.peer;
    try std.testing.expectEqual(ref, c.find(&remote).?);
    try std.testing.expectEqual(ref, c.findConnection(first).?);
    const preferred: Handle = .{ .index = 2, .generation = 1 };
    const admitted = admit(&c, &remote, preferred, .outbound, 1).admitted;
    try std.testing.expectEqual(first, admitted.displaced.?);
    try std.testing.expect(c.findConnection(first) == null);
    try std.testing.expectEqual(ref, c.findConnection(preferred).?);
    try std.testing.expect(!c.disconnect(ref, first, .transport_closed, .{}, at(2)));
    try std.testing.expectEqual(ref, c.findConnection(preferred).?);
    try std.testing.expect(c.disconnect(ref, preferred, .host, .{}, at(3)));
    try std.testing.expect(c.findConnection(preferred) == null);
    try std.testing.expectEqual(ref, c.find(&remote).?);
    try std.testing.expectEqual(t.ReputationDecision.none, c.report(ref, .high_tolerance, 3).?);
    var events: [2]t.Event = undefined;
    _ = c.pollEvents(&events);
    const renewed: Handle = .{ .index = 2, .generation = 2 };
    try std.testing.expectEqual(ref, admit(&c, &remote, renewed, .outbound, 4).admitted.peer);
    try std.testing.expectEqual(ref, c.findConnection(renewed).?);
    try std.testing.expect(!c.disconnect(ref, preferred, .transport_closed, .{}, at(5)));
    try std.testing.expectEqual(ref, c.findConnection(renewed).?);
    const other = admit(&c, &third, replacement, .inbound, 6).admitted.peer;
    try std.testing.expectEqual(other, c.findConnection(replacement).?);
    try std.testing.expect(c.findConnection(first) == null);
    try std.testing.expect(c.findConnection(.{ .index = 4, .generation = 1 }) == null);
    for (c.rows, 0..) |row, i| {
        if (!row.occupied) continue;
        try std.testing.expectEqual(@as(u16, @intCast(i)), c.find(&row.identity).?.index);
        if (row.connection) |conn| try std.testing.expectEqual(@as(u16, @intCast(i)), c.findConnection(conn).?.index);
    }
}

test "catalog caches node ID across custody changes and reconnects and resets it on identity reuse" {
    var options = opts;
    options.capacity = 1;
    options.max_peers = 1;
    options.target_peers = 1;
    var c = try Catalog.init(std.testing.allocator, options, 4, 9);
    defer c.deinit(std.testing.allocator);
    const ref = admit(&c, &remote, first, .outbound, 0).admitted.peer;
    try std.testing.expect(c.rows[ref.index].node_id == null);
    try std.testing.expect(c.updateStatus(ref, first, &.{ .earliest_available_slot = 0 }, 0));
    try std.testing.expect(c.updateMetadata(ref, first, &.{ .custody_group_count = 4 }, 0));
    var budget: u16 = 0;
    _ = c.advanceCustody(&.{ .fork = .fulu }, 0, 60_000, &budget);
    const expected = try custody.nodeId(&remote);
    try std.testing.expectEqual(expected, c.rows[ref.index].node_id.?);
    try std.testing.expect(c.updateMetadata(ref, first, &.{ .seq_number = 1, .custody_group_count = 8 }, 1));
    _ = c.advanceCustody(&.{ .fork = .fulu, .minimum_sampling_groups = 16 }, 1, 60_000, &budget);
    try std.testing.expectEqual(expected, c.rows[ref.index].node_id.?);
    try std.testing.expect(c.disconnect(ref, first, .host, .{}, at(2)));
    var events: [2]t.Event = undefined;
    _ = c.pollEvents(&events);
    try std.testing.expectEqual(ref, admit(&c, &remote, replacement, .outbound, 3).admitted.peer);
    try std.testing.expectEqual(expected, c.rows[ref.index].node_id.?);
    try std.testing.expect(c.disconnect(ref, replacement, .host, .{}, at(4)));
    _ = c.pollEvents(&events);
    const third_id = try custody.nodeId(&third);
    const reused = c.admit(&third, &local, .{ .index = 1, .generation = 3 }, &.{ .direction = .outbound, .endpoint = .unspecified, .now_ms = 5, .node_id = third_id }).admitted.peer;
    try std.testing.expectEqual(ref.index, reused.index);
    try std.testing.expect(reused.generation > ref.generation);
    try std.testing.expect(c.find(&remote) == null);
    try std.testing.expectEqual(reused, c.find(&third).?);
    try std.testing.expectEqual(third_id, c.rows[reused.index].node_id.?);
}

test "peer reputation changes invalidate dial scheduling only for retained intents" {
    for ([_]bool{ false, true }) |retained| {
        var catalog = try Catalog.initWithIntents(std.testing.allocator, opts, 1, 2, 0);
        defer catalog.deinit(std.testing.allocator);
        const peer = admit(&catalog, &remote, first, .outbound, 0).admitted.peer;
        if (retained) _ = try catalog.retainIntent(&remote);
        for ([_]enum { report, non_completion, cooldown, defer_redial }{ .report, .non_completion, .cooldown, .defer_redial }) |operation| {
            catalog.dial_schedule_dirty = false;
            switch (operation) {
                .report => try std.testing.expectEqual(t.ReputationDecision.none, catalog.report(peer, .high_tolerance, 100).?),
                .non_completion => try std.testing.expect(catalog.nonCompletion(peer, 100)),
                .cooldown => try std.testing.expect(catalog.cooldown(peer, first, 100, 1000)),
                .defer_redial => try std.testing.expect(catalog.deferRedial(peer, first, 100, 1000)),
            }
            try std.testing.expectEqual(retained, catalog.dial_schedule_dirty);
        }
    }
}

test "weak non-completion persists across reconnect and connection slot reuse" {
    var catalog = try Catalog.init(std.testing.allocator, opts, 1024, 0);
    defer catalog.deinit(std.testing.allocator);
    const peer = admit(&catalog, &remote, first, .outbound, 0).admitted.peer;
    try std.testing.expect(catalog.nonCompletion(peer, 100));
    try std.testing.expect(catalog.disconnect(peer, first, .transport_closed, .{}, at(100)));
    const other = admit(&catalog, &third, replacement, .inbound, 100).admitted.peer;
    try std.testing.expect(catalog.nonCompletion(catalog.find(&remote).?, 100));
    try std.testing.expectEqual(@as(f64, -1), catalog.get(peer).?.score);
    try std.testing.expectEqual(@as(f64, 0), catalog.get(other).?.score);
    var events: [8]t.Event = undefined;
    _ = catalog.pollEvents(&events);
    const reconnected = admit(&catalog, &remote, .{ .index = 0, .generation = 2 }, .outbound, 100).admitted.peer;
    try std.testing.expectEqual(peer, reconnected);
    try std.testing.expect(catalog.nonCompletion(reconnected, 100));
    try std.testing.expectEqual(@as(f64, -1), catalog.get(peer).?.score);
    try std.testing.expect(catalog.nonCompletion(reconnected, 10_100));
    try std.testing.expect(catalog.get(peer).?.score < -1.9);
}

test "peer catalog uses empty established slots before reclaiming disconnected intent" {
    for ([_]t.Direction{ .inbound, .outbound }) |direction| {
        for ([_]bool{ false, true }) |promote| {
            const options: Catalog.Options = .{ .capacity = 3, .max_peers = 3, .target_peers = 3, .min_outbound = 0, .outbound_reserve = 1 };
            var c = try Catalog.initWithIntents(std.testing.allocator, options, 2, 4, 0);
            defer c.deinit(std.testing.allocator);
            const peer = try c.retainIntent(&remote);
            c.edit(peer).?.dial.automatic = true;
            c.edit(peer).?.dial.addresses = .{ .{ .ip4 = .{ .octets = .{ 127, 0, 0, 1 }, .port = 9001 } }, .unspecified };
            c.edit(peer).?.dial.address_count = 1;
            try std.testing.expectEqual(peer, admit(&c, &remote, first, direction, 0).admitted.peer);
            try std.testing.expect(c.disconnect(peer, first, .transport_closed, .{}, at(1)));
            var events: [3]t.Event = undefined;
            _ = c.pollEvents(&events);
            const before = c.rowFor(peer).?.dial;
            try std.testing.expect(before.eligible_at_ms > 2);
            const reputation = c.rowFor(peer).?.reputation;
            const candidate_ref = if (promote) try c.retainIntent(&third) else null;
            const next = admit(&c, &third, replacement, direction, 2).admitted.peer;
            if (candidate_ref) |ref| try std.testing.expectEqual(ref, next);
            try std.testing.expectEqual(@as(?u16, 1), c.rowFor(next).?.established_slot);
            try std.testing.expectEqual(peer, c.find(&remote).?);
            try std.testing.expectEqualDeep(before, c.rowFor(peer).?.dial);
            try std.testing.expectEqualDeep(reputation, c.rowFor(peer).?.reputation);
            try std.testing.expect(c.intents.isSet(peer.index));
            const extra: t.PeerId = .{ .bytes = @splat(99) };
            const last = admit(&c, &extra, .{ .index = 2, .generation = 1 }, direction, 3).admitted.peer;
            if (direction == .inbound) {
                try std.testing.expectEqual(@as(?u16, 0), c.rowFor(last).?.established_slot);
                try std.testing.expect(c.established[2] == null);
                try std.testing.expect(c.find(&remote) == null);
            } else {
                try std.testing.expectEqual(@as(?u16, 2), c.rowFor(last).?.established_slot);
                try std.testing.expectEqual(peer, c.find(&remote).?);
            }
        }
    }
}

test "peer retry transitions preserve dial and established connection delay policies" {
    var dial: Catalog.DialState = .{};
    var connection: Catalog.DialState = .{};
    const dial_delays = [_]u64{ 2_000, 3_000, 5_000, 9_000, 17_000, 33_000, 60_000, 60_000 };
    const connection_delays = [_]u64{ 6_000, 11_000, 21_000, 41_000, 81_000, 161_000, 301_000, 301_000 };
    for (dial_delays, connection_delays, 0..) |dial_delay, connection_delay, i| {
        const now_ms = i * 400_000;
        dial.dialFailed(now_ms, 1_000);
        connection.connectionClosed(now_ms, 1, 1_000);
        try std.testing.expectEqual(now_ms + dial_delay, dial.eligible_at_ms);
        try std.testing.expectEqual(now_ms + connection_delay, connection.eligible_at_ms);
        try std.testing.expectEqual(@as(u8, @intCast(@min(i + 1, 7))), dial.failures);
        try std.testing.expectEqual(dial.failures, connection.failures);
    }
    connection.connectionClosed(4_000_000, 300_000, 0);
    try std.testing.expectEqual(@as(u8, 1), connection.failures);
    try std.testing.expectEqual(@as(u64, 4_005_000), connection.eligible_at_ms);
}

test "peer retry transitions preserve later deferrals and saturate time" {
    var dial: Catalog.DialState = .{};
    dial.deferUntil(60_000);
    dial.deferUntil(1_000);
    dial.dialFailed(0, 0);
    try std.testing.expectEqual(@as(u64, 60_000), dial.eligible_at_ms);
    dial.connectionClosed(0, 300_000, 0);
    try std.testing.expectEqual(@as(u64, 60_000), dial.eligible_at_ms);
    dial.dialFailed(std.math.maxInt(u64) - 1, 1_000);
    try std.testing.expectEqual(std.math.maxInt(u64), dial.eligible_at_ms);
    dial.connectionClosed(std.math.maxInt(u64), 0, 1_000);
    try std.testing.expectEqual(std.math.maxInt(u64), dial.eligible_at_ms);
}
