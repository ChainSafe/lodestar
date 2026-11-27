const Population = @import("population.zig").Population;
const catalog = @import("catalog.zig");
const client = @import("client.zig");
const prom = @import("../metrics/registry.zig");
const std = @import("std");
const gossip_test = @import("../gossipsub/test_support.zig");
const PeerId = @import("../wire/peer_id.zig").PeerId;

test "peer population metrics count direction, client and connection age" {
    var snapshot: Population = .{};
    var row: catalog.Catalog.Row = .{ .connection = .{ .index = 0, .generation = 0 }, .connected_at_ms = 1000 };
    snapshot.observe(&row, .Unknown, 6000);
    row.direction = .outbound;
    row.metadata = .{ .attnets = .{0b10101} ++ .{0} ** 7, .custody_group_count = 8 };
    snapshot.observe(&row, .Unknown, 500);
    try std.testing.expectEqualSlices(u16, &.{ 1, 1 }, &snapshot.directions[@intFromEnum(client.Client.Unknown)]);
    try std.testing.expectEqual(@as(u16, 2), snapshot.clientCount(.Unknown));
    try std.testing.expectEqualSlices(u16, &.{ 1, 1 }, &snapshot.directionCounts());
    try std.testing.expectEqual(@as(u64, 2), snapshot.ages.buckets[0]);
    try std.testing.expectEqual(@as(f64, 5), snapshot.ages.sum);
    try std.testing.expectEqual(@as(u64, 2), snapshot.attnets.count);
    try std.testing.expectEqual(@as(f64, 3), snapshot.attnets.sum);
    try std.testing.expectEqual(@as(f64, 8), snapshot.custody.sum);
    try std.testing.expectEqual(@as(u64, 1), snapshot.attnets.buckets[0]);
    var buffer: [32 * 1024]u8 = undefined;
    var writer = std.Io.Writer.fixed(&buffer);
    var encoder: prom.Encoder = .{ .writer = &writer };
    try snapshot.write(&encoder);
    try std.testing.expect(std.mem.find(u8, writer.buffered(), "lodestar_peer_connection_seconds_count 2\n") != null);
    try std.testing.expect(std.mem.find(u8, writer.buffered(), "lodestar_peer_long_lived_attnets_count_sum 3\n") != null);
    try std.testing.expect(std.mem.find(u8, writer.buffered(), "lodestar_peer_column_group_count_sum 8\n") != null);
}

test "peer population scores match selection and preserve reputation and gossip state" {
    var g = try gossip_test.init(std.testing.allocator, .{
        .random_seed = 1,
        .score_params = .{ .behaviour_threshold = 0, .behaviour_weight = -1, .gossip_threshold = -4, .publish_threshold = -9, .graylist_threshold = -16 },
    });
    defer g.deinit();
    var peers = try catalog.Catalog.init(std.testing.allocator, .{ .capacity = 4, .outbound_reserve = 0, .max_peers = 2, .target_peers = 2, .min_outbound = 0 }, 4, 1);
    defer peers.deinit(std.testing.allocator);
    const session = gossip_test.addPeer(&g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const logical = g.sessions.rows[session.index].logical;
    const conn = g.sessions.rows[session.index].conn;
    const local: PeerId = .{ .bytes = @splat(0xff) };
    const admitted = peers.admit(&g.peers.rows[logical.index].identity, &local, conn, &.{ .direction = .inbound, .endpoint = .unspecified, .now_ms = 0 }).admitted;
    const row = peers.edit(admitted.peer).?;
    row.identify = .{ .agent = try .init("Lighthouse/v1") };
    row.reputation.score = -8;
    gossip_test.penalize(&g, conn, 2);
    _ = peers.admit(&.{ .bytes = @splat(0xee) }, &local, .{ .index = 1, .generation = 1 }, &.{ .direction = .outbound, .endpoint = .unspecified, .now_ms = 0 }).admitted;
    const reputation_before = row.reputation;
    const gossip_before = g.peers.scores.rows[logical.index];
    const calculations = g.peers.scores.calculations;
    const snapshot = Population.collect(&peers, &g, 600_000);
    const lighthouse = @intFromEnum(client.Client.Lighthouse);
    const unknown = @intFromEnum(client.Client.Unknown);
    try std.testing.expectEqual(@as(usize, 2), snapshot.count);
    try std.testing.expectEqual(@as(u64, 1), snapshot.scores[lighthouse].count);
    try std.testing.expectEqual(@as(f64, -8.75), snapshot.scores[lighthouse].sum);
    try std.testing.expectEqual(@as(f64, -4), snapshot.gossip_scores[lighthouse].sum);
    try std.testing.expectEqual(@as(u64, 1), snapshot.gossip_scores[unknown].count);
    try std.testing.expectEqual(@as(f64, 0), snapshot.gossip_scores[unknown].sum);
    try std.testing.expectEqualDeep(snapshot, Population.collect(&peers, &g, 600_000));
    try std.testing.expectEqualDeep(reputation_before, row.reputation);
    try std.testing.expectEqualDeep(gossip_before, g.peers.scores.rows[logical.index]);
    try std.testing.expectEqual(calculations, g.peers.scores.calculations);
}
