const Now = @import("../types.zig").Now;
const gossip_test = @import("test_support.zig");
const topic_mod = @import("topic.zig");
const protobuf = @import("protobuf.zig");
const Overlay = @import("overlay.zig").Overlay;
const std = @import("std");
const c = @import("constants.zig");
const Context = @import("overlay.zig").Context;
const assert = std.debug.assert;
const Gossipsub = @import("Gossipsub.zig");
const registry = @import("../metrics/registry.zig");
const test_support = @import("../quic/test_support.zig");
const topic_fixture = @import("topic_fixture.zig");
const score = @import("score.zig");
const Fixture = struct {
    g: Gossipsub,
    topic: u16,

    fn init(count: usize) !Fixture {
        var g = try gossip_test.init(std.testing.allocator, .{ .random_seed = 17 });
        errdefer g.deinit();
        const name = "/eth2/01020304/beacon_block/ssz_snappy";
        gossip_test.subscribe(&g, name) catch unreachable;
        const topic = g.overlay.findTopic(name).?;
        for (0..count) |index| {
            const peer = gossip_test.addPeer(&g, .{ .index = @intCast(index), .generation = 1 }, .v1_2).?;
            _ = g.overlay.peerSubscription(&g.overlayContext(g.last_now_ms), peer.index, g.overlay.topicString(topic), true);
        }
        return .{ .g = g, .topic = topic };
    }
    fn context(self: *Fixture, now: u64) Context {
        return .{ .sessions = self.g.sessions, .peers = &self.g.peers, .now = now, .options = &self.g.options, .snapshot = &self.g.cycle.scores };
    }
};

/// The exported mesh change count for one label set, read from the rendered family.
fn meshChanges(overlay: *const Overlay, comptime topic: []const u8, comptime event: []const u8, comptime reason: []const u8) !u64 {
    var buffer: [32 * 1024]u8 = undefined;
    var writer = std.Io.Writer.fixed(&buffer);
    var encoder: registry.Encoder = .{ .writer = &writer };
    try overlay.mesh_changes.write(&encoder);
    const prefix = "gossipsub_mesh_changes_total{topic=\"" ++ topic ++ "\",event=\"" ++ event ++ "\",reason=\"" ++ reason ++ "\"} ";
    const start = (std.mem.find(u8, writer.buffered(), prefix) orelse return error.MissingSeries) + prefix.len;
    const end = std.mem.findScalarPos(u8, writer.buffered(), start, '\n').?;
    return std.fmt.parseInt(u64, writer.buffered()[start..end], 10);
}

fn meshChangeTotal(overlay: *const Overlay) u64 {
    var total: u64 = 0;
    for (overlay.mesh_changes.counts) |reasons| for (reasons) |count| {
        total += count;
    };
    return total;
}

test "mesh removals take each member out once whatever removed it" {
    var f = try Fixture.init(7);
    defer f.g.deinit();
    const context = f.g.overlayContext(2);
    const name = f.g.overlay.topicString(f.topic);
    const mesh = f.g.overlay.mesh(f.topic);
    for (0..7) |peer| f.g.overlay.onGraft(&context, f.topic, @intCast(peer));
    try std.testing.expectEqual(@as(usize, 7), mesh.count());
    f.g.overlay.onGraft(&context, f.topic, 0);
    try std.testing.expectEqual(@as(usize, 7), mesh.count());
    f.g.overlay.onPrune(&context, f.topic, 0, c.prune_backoff_ms);
    f.g.overlay.onPrune(&context, f.topic, 0, c.prune_backoff_ms);
    f.g.overlay.onGraft(&context, f.topic, 0);
    try std.testing.expect(!mesh.isSet(0));
    _ = f.g.overlay.peerSubscription(&context, 1, name, false);
    _ = f.g.overlay.peerSubscription(&context, 1, name, false);
    try std.testing.expect(!mesh.isSet(1));
    f.g.markDirect(f.g.sessions.rows[2].conn);
    f.g.markDirect(f.g.sessions.rows[2].conn);
    try std.testing.expect(!mesh.isSet(2));
    const stream = f.g.sessions.rows[3].outStream().?;
    f.g.sessions.setOutbound(3, .{ .closing = stream });
    f.g.peers.scores.penalize(f.g.sessions.rows[4].logical.index, 50);
    f.g.overlay.maintain(&context, f.topic);
    try std.testing.expect(!mesh.isSet(3) and !mesh.isSet(4));
    try std.testing.expectEqual(@as(usize, 2), mesh.count());
    const disconnected = f.g.sessions.rows[6].conn;
    f.g.connectionClosed(disconnected);
    f.g.connectionClosed(disconnected);
    try std.testing.expectEqual(@as(usize, 1), mesh.count());
    f.g.overlay.setLocal(&context, f.topic, false);
    f.g.overlay.setLocal(&context, f.topic, false);
    try std.testing.expectEqual(@as(usize, 0), mesh.count());
}

test "gossip heartbeat admits sessions newer than its score snapshot" {
    var f = try Fixture.init(0);
    defer f.g.deinit();
    const context = f.context(2);
    f.g.cycle.takeSnapshot(context.sessions, context.peers, context.now);
    const peer = gossip_test.addPeer(&f.g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    f.g.overlay.onGraft(&f.g.overlayContext(2), f.topic, peer.index);
    try std.testing.expect(f.g.overlay.inMesh(f.topic, peer.index));
    f.g.overlay.maintain(&context, f.topic);
    try std.testing.expect(f.g.overlay.inMesh(f.topic, peer.index));
    try std.testing.expect(!f.g.peers.backedOff(f.g.sessions.rows[peer.index].logical, f.topic, 2));
}

test "gossip opportunistic graft improves a mesh below its target degree" {
    var f = try Fixture.init(8);
    defer f.g.deinit();
    for (0..6) |peer| f.g.overlay.rows[f.topic].mesh.set(peer);
    for (6..8) |peer| f.g.peers.scores.deliverEligible(@intCast(peer), f.topic, false);
    const context = f.context(2);
    f.g.cycle.takeSnapshot(context.sessions, context.peers, context.now);
    f.g.overlay.opportunistic(&context, f.topic);
    try std.testing.expectEqual(@as(usize, 8), f.g.overlay.mesh(f.topic).count());
    try std.testing.expectEqual(@as(u64, 2), try meshChanges(f.g.overlay, "beacon_block", "join", "opportunistic"));
    try std.testing.expectEqual(@as(u64, 2), meshChangeTotal(f.g.overlay));
}

test "gossip short PRUNE backoff does not count a GRAFT flood" {
    var f = try Fixture.init(1);
    defer f.g.deinit();
    const context = f.context(2);
    f.g.overlay.onPrune(&context, f.topic, 0, c.graft_flood_threshold_ms);
    f.g.overlay.onGraft(&context, f.topic, 0);
    try std.testing.expectEqual(@as(f64, 1), f.g.peers.scores.rows[f.g.sessions.rows[0].logical.index].behaviour);
}

test "gossip policy mesh trimming preserves highest scores and outbound quota" {
    var f = try Fixture.init(16);
    defer f.g.deinit();
    for (0..16) |peer| {
        f.g.overlay.rows[f.topic].mesh.set(peer);
        f.g.peers.scores.graft(@intCast(peer), f.topic, 1);
        if (peer < 4) f.g.peers.scores.deliverEligible(@intCast(peer), f.topic, false);
    }
    f.g.peers.rows[f.g.sessions.rows[14].logical.index].direction = .outbound;
    f.g.peers.rows[f.g.sessions.rows[15].logical.index].direction = .outbound;
    const context = f.context(2);
    f.g.cycle.takeSnapshot(context.sessions, context.peers, context.now);
    f.g.overlay.maintain(&context, f.topic);
    try std.testing.expectEqual(@as(usize, c.mesh_d), f.g.overlay.mesh(f.topic).count());
    try std.testing.expectEqual(@as(u64, 16 - c.mesh_d), try meshChanges(f.g.overlay, "beacon_block", "leave", "excess"));
    try std.testing.expectEqual(@as(u64, 16 - c.mesh_d), meshChangeTotal(f.g.overlay));
    for (0..4) |peer| try std.testing.expect(f.g.overlay.mesh(f.topic).isSet(peer));
    try std.testing.expect(f.g.overlay.mesh(f.topic).isSet(14));
    try std.testing.expect(f.g.overlay.mesh(f.topic).isSet(15));
}

test "gossip policy outbound repair applies inside mesh degree limits" {
    var f = try Fixture.init(10);
    defer f.g.deinit();
    for (0..8) |peer| f.g.overlay.rows[f.topic].mesh.set(peer);
    f.g.peers.rows[f.g.sessions.rows[8].logical.index].direction = .outbound;
    f.g.peers.rows[f.g.sessions.rows[9].logical.index].direction = .outbound;
    const context = f.context(2);
    f.g.cycle.takeSnapshot(context.sessions, context.peers, context.now);
    f.g.overlay.maintain(&context, f.topic);
    try std.testing.expectEqual(@as(usize, 10), f.g.overlay.mesh(f.topic).count());
    try std.testing.expectEqual(@as(u64, 2), try meshChanges(f.g.overlay, "beacon_block", "join", "fill_outbound"));
    try std.testing.expectEqual(@as(u64, 2), meshChangeTotal(f.g.overlay));
    try std.testing.expect(f.g.overlay.mesh(f.topic).isSet(8));
    try std.testing.expect(f.g.overlay.mesh(f.topic).isSet(9));
}

test "gossip policy mesh queue pressure preserves required action ownership" {
    var f = try Fixture.init(1);
    defer f.g.deinit();
    const context = f.context(2);
    const bytes = try std.testing.allocator.alloc(u8, f.g.options.critical_bytes);
    defer std.testing.allocator.free(bytes);
    @memset(bytes, 0);
    try std.testing.expect(f.g.sessions.rows[0].io.tx.injectFrame(bytes, true, 1) != null);
    f.g.cycle.takeSnapshot(context.sessions, context.peers, context.now);
    f.g.overlay.maintain(&context, f.topic);
    try std.testing.expectEqual(@as(usize, 0), f.g.overlay.mesh(f.topic).count());
    f.g.sessions.rows[0].io.tx.cancelStream();
    f.g.overlay.maintain(&context, f.topic);
    try std.testing.expectEqual(@as(usize, 1), f.g.overlay.mesh(f.topic).count());
    f.g.sessions.rows[0].io.tx.cancelStream();
    try std.testing.expect(f.g.sessions.rows[0].io.tx.injectFrame(bytes, true, 2) != null);
    f.g.peers.scores.penalize(0, 7);
    f.g.cycle.takeSnapshot(context.sessions, context.peers, context.now);
    f.g.overlay.maintain(&context, f.topic);
    try std.testing.expectEqual(@as(usize, 0), f.g.overlay.mesh(f.topic).count());
    try std.testing.expect(f.g.sessions.rows[0].outbound == .closing);
    try std.testing.expect(!f.g.overlay.gossipRecipients(&context, f.topic, 1).isSet(0));
}

test "gossip partial peer turn queues subscription before outgoing GRAFT" {
    var f = try Fixture.init(2);
    defer f.g.deinit();
    var pair: test_support.Pair = .{};
    try pair.init(.{}, .{});
    defer pair.deinit();
    f.g.options.peers_per_pump = 1;
    f.g.sessions.rows[0].io.tx.ready = false;
    const target = &f.g.sessions.rows[1].io.tx;
    try std.testing.expect(target.subscription_dirty.isSet(f.topic));
    f.g.heartbeat_at = 1;
    _ = gossip_test.pump(&f.g, &pair.client, Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 }));
    // The turn took only the first ready session; the second stays ready for the next one.
    try std.testing.expect(!f.g.sessions.rows[0].ready_link.linked);
    try std.testing.expectEqual(@as(u32, 1), f.g.sessions.ready.head);
    try std.testing.expect(f.g.overlay.inMesh(f.topic, 1));
    try std.testing.expectEqual(@as(usize, 2), target.critical.count);
    for (0..2) |i| {
        const bytes = f.g.writeSegment(f.g.sessions.ref(1));
        var prefix = protobuf.Reader.init(bytes);
        const len = try prefix.varint();
        var rpc = protobuf.RpcReader.init(bytes[bytes.len - len ..]);
        const item = (try rpc.next()).?;
        if (i == 0) {
            try std.testing.expect(item == .subscription and item.subscription.subscribe);
            try std.testing.expectEqualStrings(f.g.overlay.topicString(f.topic), item.subscription.topic);
        } else {
            try std.testing.expectEqualStrings(f.g.overlay.topicString(f.topic), item.graft);
        }
        try std.testing.expect(try rpc.next() == null);
        f.g.advanceWrite(f.g.sessions.ref(1), bytes.len, 1);
    }
}

test "gossip GRAFT admission preserves subscription and mesh state at both queue boundaries" {
    var f = try Fixture.init(1);
    defer f.g.deinit();
    const context = f.context(2);
    f.g.cycle.takeSnapshot(context.sessions, context.peers, context.now);
    const tx = &f.g.sessions.rows[0].io.tx;
    const bytes = f.g.msg_scratch[0..tx.critical.bytes.len];
    @memset(bytes, 0);
    try std.testing.expect(tx.injectFrame(bytes, true, 1) != null);
    f.g.overlay.maintain(&context, f.topic);
    try std.testing.expect(tx.subscription_dirty.isSet(f.topic));
    try std.testing.expect(!f.g.overlay.inMesh(f.topic, 0));
    tx.critical.reset();
    const body = protobuf.subscriptionSize(f.g.overlay.topicString(f.topic));
    const subscription_size = protobuf.varintLen(body) + body;
    try std.testing.expect(tx.injectFrame(bytes[0 .. bytes.len - subscription_size], true, 1) != null);
    f.g.overlay.maintain(&context, f.topic);
    try std.testing.expect(!tx.subscription_dirty.isSet(f.topic));
    try std.testing.expect(!f.g.overlay.inMesh(f.topic, 0));
    try std.testing.expectEqual(@as(usize, 2), tx.critical.count);
    try std.testing.expectEqual(@as(u64, 0), meshChangeTotal(f.g.overlay));
    for (0..3) |_| {
        const segment = tx.segment(&f.g.messages.store, 0);
        if (segment.len == 0) break;
        f.g.advanceWrite(f.g.sessions.ref(0), segment.len, 2);
    }
    try std.testing.expect(!tx.pending());
    f.g.overlay.maintain(&context, f.topic);
    try std.testing.expect(f.g.overlay.inMesh(f.topic, 0));
    try std.testing.expectEqual(@as(usize, 1), tx.critical.count);
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(f.g.overlay, "beacon_block", "join", "fill_mesh"));
    try std.testing.expectEqual(@as(u64, 1), meshChangeTotal(f.g.overlay));
}

test "gossip policy adaptive gossip randomizes recipients and fanout expires" {
    var f = try Fixture.init(64);
    defer f.g.deinit();
    f.g.markDirect(f.g.sessions.rows[0].conn);
    f.g.peers.scores.penalize(1, 50);
    var context = f.context(2);
    f.g.cycle.takeSnapshot(context.sessions, context.peers, context.now);
    const recipients = f.g.overlay.gossipRecipients(&context, f.topic, 0.5);
    try std.testing.expectEqual(@as(usize, 31), recipients.count());
    try std.testing.expect(!recipients.isSet(0) and !recipients.isSet(1));
    var high_selected = false;
    for (32..64) |peer| if (recipients.isSet(peer)) {
        high_selected = true;
    };
    try std.testing.expect(high_selected);
    f.g.overlay.setLocal(&context, f.topic, false);
    for (f.g.sessions.rows) |*row| if (row.active) {
        row.outbound = .{ .live = .{ .stream = .{ .conn = row.conn, .id = 2, .slot = 0 }, .version = .v1_2 } };
    };
    const fanout = f.g.overlay.maintainFanout(&context, f.topic, true);
    try std.testing.expectEqual(@as(usize, c.mesh_d), fanout.count());
    try std.testing.expect(!fanout.isSet(0) and !fanout.isSet(1));
    context.now += c.fanout_ttl_ms;
    _ = f.g.overlay.maintainFanout(&context, f.topic, false);
    try std.testing.expectEqual(@as(usize, 0), fanout.count());
}

test "gossip PRUNE exhaustion ends eligibility even after queue capacity returns" {
    var f = try Fixture.init(1);
    defer f.g.deinit();
    var context = f.context(1);
    f.g.overlay.onGraft(&context, f.topic, 0);
    const io = &f.g.sessions.rows[0].io;
    const full = try std.testing.allocator.alloc(u8, f.g.options.critical_bytes);
    defer std.testing.allocator.free(full);
    @memset(full, 0);
    try std.testing.expect(io.tx.injectFrame(full, true, 1) != null);
    try gossip_test.unsubscribe(&f.g, f.g.overlay.topicString(f.topic));
    try std.testing.expect(f.g.sessions.rows[0].outbound == .closing);
    try std.testing.expect(!f.g.overlay.mesh(f.topic).isSet(0));
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(f.g.overlay, "beacon_block", "leave", "local_unsubscribe"));
    io.tx.cancelStream();
    context.now = c.prune_backoff_ms * 2;
    try gossip_test.subscribe(&f.g, f.g.overlay.topicString(f.topic));
    f.g.overlay.onGraft(&context, f.topic, 0);
    try std.testing.expect(!f.g.overlay.mesh(f.topic).isSet(0));
    try std.testing.expect(!io.tx.pending());
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(f.g.overlay, "beacon_block", "join", "remote_graft"));
    try std.testing.expectEqual(@as(u64, 2), meshChangeTotal(f.g.overlay));
}

test "gossip policy review I3 bounded shuffle consumes one draw per swap" {
    var f = try Fixture.init(3);
    defer f.g.deinit();
    const context = f.context(1);
    f.g.cycle.takeSnapshot(context.sessions, context.peers, context.now);
    f.g.overlay.rng = .{ .s = .{ 0, 1, 0, 0 } };
    var expected = f.g.overlay.rng;
    for (0..2) |_| _ = expected.next();
    const recipients = f.g.overlay.gossipRecipients(&context, f.topic, 1);
    try std.testing.expectEqual(@as(usize, 3), recipients.count());
    try std.testing.expectEqualSlices(u64, &expected.s, &f.g.overlay.rng.s);
}

test "overlay unsubscribe and disconnect retire membership and score together" {
    var f = try Fixture.init(2);
    defer f.g.deinit();
    var context = f.context(1);
    for (0..2) |peer| f.g.overlay.onGraft(&context, f.topic, @intCast(peer));
    const first = f.g.sessions.rows[0].logical.index;
    const second = f.g.sessions.rows[1].logical.index;
    try std.testing.expect(f.g.peers.scores.topics[@as(usize, first) * f.g.overlay.rows.len + f.topic].in_mesh);
    try std.testing.expect(f.g.peers.scores.topics[@as(usize, second) * f.g.overlay.rows.len + f.topic].in_mesh);
    context.now = 60_001;
    _ = f.g.overlay.peerSubscription(&context, 0, f.g.overlay.topicString(f.topic), false);
    try std.testing.expect(!f.g.overlay.subscribers(f.topic).isSet(0));
    try std.testing.expect(!f.g.overlay.mesh(f.topic).isSet(0));
    try std.testing.expect(!f.g.peers.scores.topics[@as(usize, first) * f.g.overlay.rows.len + f.topic].in_mesh);
    const failures = f.g.peers.scores.topics[@as(usize, first) * f.g.overlay.rows.len + f.topic].mesh_failures;
    _ = f.g.overlay.peerSubscription(&context, 0, f.g.overlay.topicString(f.topic), false);
    try std.testing.expectEqual(failures, f.g.peers.scores.topics[@as(usize, first) * f.g.overlay.rows.len + f.topic].mesh_failures);
    f.g.overlay.peerDisconnected(&context, 1);
    try std.testing.expect(!f.g.overlay.subscribers(f.topic).isSet(1));
    try std.testing.expect(!f.g.overlay.mesh(f.topic).isSet(1));
    try std.testing.expect(!f.g.peers.scores.topics[@as(usize, second) * f.g.overlay.rows.len + f.topic].in_mesh);
}

test "gossip policy topic capacity supports two full fork subnet sets" {
    var gossip = try gossip_test.init(std.testing.allocator, .{ .random_seed = 1, .topic_policy = &.{ topic_fixture.bytes(.{ 0, 0, 0, 0 }), topic_fixture.bytes(.{ 1, 0, 0, 0 }), topic_fixture.bytes(.{ 2, 0, 0, 0 }) } });
    defer gossip.deinit();
    const overlay = gossip.overlay;
    var name: [topic_mod.name_max_len]u8 = undefined;
    var buffer: [topic_mod.topic_max_len]u8 = undefined;
    for (0..3) |fork| {
        if (fork == 2) {
            for (overlay.rows, 0..) |*topic, index| {
                if (topic.active and std.mem.startsWith(u8, overlay.topicString(@intCast(index)), "/eth2/00000000/")) {
                    try gossip_test.unsubscribe(&gossip, overlay.topicString(@intCast(index)));
                }
            }
        }
        const digest: topic_mod.ForkDigest = .{ @intCast(fork), 0, 0, 0 };
        for ([_]topic_mod.Kind{ .beacon_attestation, .data_column_sidecar, .sync_committee }) |kind| {
            for (0..kind.countMax()) |subnet| {
                const formatted = try std.fmt.bufPrint(&name, "{s}_{d}", .{ @tagName(kind), subnet });
                try gossip_test.subscribe(&gossip, topic_mod.build(digest, formatted, &buffer));
            }
        }
        for (std.enums.values(topic_mod.Kind)) |kind| {
            if (kind.countMax() == 1) try gossip_test.subscribe(&gossip, topic_mod.build(digest, @tagName(kind), &buffer));
        }
    }
    if (overlay.findTopic("/eth2/00000000/beacon_block/ssz_snappy")) |old| try std.testing.expect(!overlay.subscribed(old));
    try std.testing.expect(overlay.findTopic("/eth2/01000000/beacon_block/ssz_snappy") != null);
    try std.testing.expect(overlay.findTopic("/eth2/02000000/beacon_block/ssz_snappy") != null);
}

test "mesh changes count each committed join and leave once by reason, not controls" {
    var f = try Fixture.init(8);
    defer f.g.deinit();
    const overlay = f.g.overlay;
    const context = f.g.overlayContext(2);
    const name = overlay.topicString(f.topic);
    for (0..7) |peer| overlay.onGraft(&context, f.topic, @intCast(peer));
    overlay.onGraft(&context, f.topic, 0);
    try std.testing.expectEqual(@as(u64, 7), try meshChanges(overlay, "beacon_block", "join", "remote_graft"));
    overlay.onPrune(&context, f.topic, 0, c.prune_backoff_ms);
    overlay.onPrune(&context, f.topic, 0, c.prune_backoff_ms);
    // A GRAFT refused during backoff from a peer outside the mesh changes no membership.
    overlay.onGraft(&context, f.topic, 0);
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(overlay, "beacon_block", "leave", "remote_prune"));
    try std.testing.expectEqual(@as(u64, 0), try meshChanges(overlay, "beacon_block", "leave", "refused_graft"));
    try std.testing.expectEqual(@as(u64, 1), f.g.peers.scores.penalties[@intFromEnum(score.Penalty.graft_backoff)]);
    try std.testing.expectEqual(@as(u64, 1), f.g.peers.scores.penalties[@intFromEnum(score.Penalty.graft_flood)]);
    for (0..2) |_| _ = overlay.peerSubscription(&context, 1, name, false);
    for (0..2) |_| f.g.markDirect(f.g.sessions.rows[2].conn);
    f.g.peers.scores.penalize(f.g.sessions.rows[3].logical.index, 50);
    overlay.onGraft(&context, f.topic, 3);
    const stream = f.g.sessions.rows[4].outStream().?;
    f.g.sessions.setOutbound(4, .{ .closing = stream });
    overlay.maintain(&context, f.topic);
    try std.testing.expect(overlay.mesh(f.topic).isSet(7));
    const disconnected = f.g.sessions.rows[6].conn;
    for (0..2) |_| f.g.connectionClosed(disconnected);
    for (0..2) |_| overlay.setLocal(&context, f.topic, false);
    try std.testing.expectEqual(@as(usize, 0), overlay.mesh(f.topic).count());
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(overlay, "beacon_block", "leave", "remote_unsubscribe"));
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(overlay, "beacon_block", "leave", "direct_peer"));
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(overlay, "beacon_block", "leave", "refused_graft"));
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(overlay, "beacon_block", "leave", "ineligible"));
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(overlay, "beacon_block", "join", "fill_mesh"));
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(overlay, "beacon_block", "leave", "session_end"));
    try std.testing.expectEqual(@as(u64, 2), try meshChanges(overlay, "beacon_block", "leave", "local_unsubscribe"));
    try std.testing.expectEqual(@as(u64, 16), meshChangeTotal(overlay));
}

test "mesh changes follow reused sessions across topic expiry" {
    var f = try Fixture.init(1);
    defer f.g.deinit();
    const overlay = f.g.overlay;
    var context = f.g.overlayContext(1);
    const name = overlay.topicString(f.topic);
    overlay.onGraft(&context, f.topic, 0);
    f.g.connectionClosed(f.g.sessions.rows[0].conn);
    const next = gossip_test.addPeer(&f.g, .{ .index = 0, .generation = 2 }, .v1_2).?;
    try std.testing.expectEqual(@as(u16, 0), next.index);
    _ = overlay.peerSubscription(&context, next.index, name, true);
    overlay.onGraft(&context, f.topic, next.index);
    overlay.setLocal(&context, f.topic, false);
    overlay.flushSubscriptions(&f.g.sessions.rows[next.index].io.tx, &f.g.sessions.control_scratch, context.now);
    context.now = std.math.maxInt(u64) / 2;
    overlay.expireTopic(&context, f.topic, f.g.messages.validation.retainsTopic(f.topic));
    try std.testing.expect(!overlay.rows[f.topic].active);
    const exit = "/eth2/01020304/voluntary_exit/ssz_snappy";
    try gossip_test.subscribe(&f.g, exit);
    const exit_topic = overlay.findTopic(exit).?;
    try std.testing.expect(exit_topic != f.topic);
    _ = overlay.peerSubscription(&context, next.index, exit, true);
    overlay.onGraft(&context, exit_topic, next.index);
    try std.testing.expectEqual(@as(u64, 2), try meshChanges(overlay, "beacon_block", "join", "remote_graft"));
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(overlay, "beacon_block", "leave", "session_end"));
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(overlay, "beacon_block", "leave", "local_unsubscribe"));
    try std.testing.expectEqual(@as(u64, 1), try meshChanges(overlay, "voluntary_exit", "join", "remote_graft"));
    try std.testing.expectEqual(@as(u64, 5), meshChangeTotal(overlay));
}

test "remote subscription coverage is fork exact and duplicate announcements preserve its revision" {
    var g = try subscriptionFixture();
    defer g.deinit();
    const peer = gossip_test.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const current = "/eth2/00000000/beacon_attestation_63/ssz_snappy";
    const future = "/eth2/01010101/sync_committee_3/ssz_snappy";
    const context = g.overlayContext(1);
    _ = g.overlay.peerSubscription(&context, peer.index, current, true);
    _ = g.overlay.peerSubscription(&context, peer.index, future, true);
    for (0..100) |_| _ = g.overlay.peerSubscription(&context, peer.index, current, true);
    _ = g.overlay.peerSubscription(&context, peer.index, "/eth2/02020202/beacon_attestation_63/ssz_snappy", true);
    const current_subnets = g.overlay.subnetSubscriptions(peer.index, @splat(0));
    const future_subnets = g.overlay.subnetSubscriptions(peer.index, @splat(1));
    try std.testing.expectEqual(@as(u64, 1) << 63, current_subnets.attnets);
    try std.testing.expectEqual(@as(u4, 0), current_subnets.syncnets);
    try std.testing.expectEqual(@as(u4, 8), future_subnets.syncnets);
    try std.testing.expectEqual(@as(u64, 0), g.localSubscriptions(@splat(0)).attnets);
    try std.testing.expect(g.overlay.findTopic(current) == null);
    g.connectionClosed(g.sessions.rows[peer.index].conn);
    try std.testing.expectEqual(@as(u64, 0), g.overlay.subnetSubscriptions(peer.index, @splat(0)).attnets);
    try std.testing.expectEqual(@as(u4, 0), g.overlay.subnetSubscriptions(peer.index, @splat(1)).syncnets);
    try std.testing.expectEqual(@as(usize, 0), g.resourceSnapshot().remote_subscriptions);
}

test "remote subscriptions survive local topic expiry and isolate reused sessions" {
    var g = try subscriptionFixture();
    defer g.deinit();
    const first = gossip_test.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const second = gossip_test.addPeer(&g, .{ .index = 1, .generation = 1 }, .v1_2).?;
    const name = "/eth2/01010101/data_column_sidecar_127/ssz_snappy";
    const index = g.overlay.namespace.lookup(name).?.ordinal;
    const context = g.overlayContext(1);
    _ = g.overlay.peerSubscription(&context, first.index, name, true);
    _ = g.overlay.peerSubscription(&context, second.index, name, true);
    try gossip_test.subscribe(&g, name);
    try gossip_test.unsubscribe(&g, name);
    g.cancelWrites(first);
    g.cancelWrites(second);
    g.overlay.expireTopic(&context, index, false);
    try std.testing.expect(!g.overlay.rows[index].active);
    try std.testing.expectEqual(@as(usize, 2), g.overlay.subscribers(index).count());
    try std.testing.expectEqual(@as(usize, 2), g.resourceSnapshot().remote_subscriptions);
    const subnets = g.overlay.subnetSubscriptions(first.index, @splat(1));
    try std.testing.expect(subnets.columns.isSet(127));
    try std.testing.expectEqual(@as(u16, 128), subnets.column_subnet_count);
    g.connectionClosed(g.sessions.rows[first.index].conn);
    const replacement = gossip_test.addPeer(&g, .{ .index = 0, .generation = 2 }, .v1_2).?;
    try std.testing.expectEqual(first.index, replacement.index);
    try std.testing.expect(!g.overlay.subscribers(index).isSet(replacement.index));
    try std.testing.expect(g.overlay.subscribers(index).isSet(second.index));
    try gossip_test.subscribe(&g, name);
    try std.testing.expectEqual(@as(usize, 1), g.overlay.subscribers(index).count());
    _ = g.overlay.peerSubscription(&context, second.index, name, false);
    _ = g.overlay.peerSubscription(&context, second.index, name, false);
    try std.testing.expectEqual(@as(usize, 0), g.resourceSnapshot().remote_subscriptions);
}

fn subscriptionFixture() !Gossipsub {
    return gossip_test.init(std.testing.allocator, .{
        .random_seed = 1,
        .connected_capacity = 2,
        .retained_capacity = 9,
        .retained_outbound_reserve = 1,
        .seen_capacity = 16,
        .mcache_capacity = 16,
        .validation_capacity = 8,
        .topic_policy = comptime &.{ topic_fixture.full(@splat(0)), topic_fixture.full(@splat(1)) },
    });
}
