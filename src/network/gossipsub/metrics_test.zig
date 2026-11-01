const Topics = @import("metrics.zig").Topics;
const policy = @import("topic_policy.zig");
const std = @import("std");
const topic = @import("topic.zig");
const metrics = @import("metrics.zig");
const registry = @import("../metrics/registry.zig");

test "metric topic labels have a fixed vocabulary and canonical subnet bounds" {
    try std.testing.expectEqual(@as(u16, 63), topic.Name.parse("beacon_attestation_63").?.subnet);
    try std.testing.expectEqual(@as(u16, 127), topic.Name.parse("data_column_sidecar_127").?.subnet);
    for ([_][]const u8{ "beacon_attestation_64", "sync_committee_4", "data_column_sidecar_128", "blob_sidecar_000", "beacon_attestation_+1", "beacon_block\"\n" }) |invalid| {
        try std.testing.expectEqual(null, topic.Name.parse(invalid));
    }
    var counters: Topics = .{};
    counters.get("/eth2/00000000/unknown/ssz_snappy").accepted += 1;
    try std.testing.expectEqual(@as(u64, 1), counters.counts[policy.kind_count].accepted);
}

fn render(populations: *const metrics.ScorePopulations, buffer: []u8) ![]const u8 {
    var writer = std.Io.Writer.fixed(buffer);
    var encoder: registry.Encoder = .{ .writer = &writer };
    try populations.write(&encoder);
    return writer.buffered();
}

test "score populations count cumulative gates, distinct mesh peers and empty scopes without mutating scores" {
    const support = @import("test_support.zig");
    const ScorePopulations = @import("metrics.zig").ScorePopulations;
    const PeerState = @import("score.zig").PeerScore.PeerState;
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .score_params = .{ .behaviour_threshold = 0, .behaviour_weight = -1, .gossip_threshold = -4, .publish_threshold = -9, .graylist_threshold = -16 } });
    defer g.deinit();
    var buffer: [8192]u8 = undefined;
    const empty = try render(&ScorePopulations.collect(&g.peers, g.overlay, g.sessions, 1), &buffer);
    try std.testing.expect(std.mem.find(u8, empty, "lodestar_gossip_mesh_peer_score_by_threshold_count{threshold=\"all\"} 0\n") != null);
    try std.testing.expect(std.mem.find(u8, empty, "lodestar_gossip_score_avg_min_max_avg 0\n") != null);
    try std.testing.expect(std.mem.find(u8, empty, "lodestar_gossip_mesh_score_avg_min_max_avg 0\n") != null);
    const names = [_][]const u8{ "/eth2/01020304/beacon_block/ssz_snappy", "/eth2/01020304/voluntary_exit/ssz_snappy" };
    for (names) |name| try support.subscribe(&g, name);
    // Behaviour b scores -b^2: the peers sit on each gate, between gates and below the lowest.
    for ([_]f64{ 0, 0.5, 2, 3, 4, 5 }, 0..) |behaviour, index| {
        const peer = support.addPeer(&g, .{ .index = @intCast(index), .generation = 1 }, .v1_2).?;
        g.peers.scores.penalize(g.sessions.rows[peer.index].logical.index, behaviour);
    }
    for ([_][2]u16{ .{ 1, 2 }, .{ 2, 3 } }, names) |members, name| {
        for (members) |peer| g.overlay.rows[g.overlay.findTopic(name).?].mesh.set(peer);
    }
    for (0..3) |peer| _ = g.peers.score(g.sessions.rows[peer].logical, 1);
    const rows = try std.testing.allocator.dupe(PeerState, g.peers.scores.rows);
    defer std.testing.allocator.free(rows);
    const calculations = g.peers.scores.calculations;
    const populations = ScorePopulations.collect(&g.peers, g.overlay, g.sessions, 10 * g.peers.scores.params.decay_interval_ms);
    try std.testing.expectEqualSlices(u8, std.mem.sliceAsBytes(rows), std.mem.sliceAsBytes(g.peers.scores.rows));
    try std.testing.expectEqual(calculations, g.peers.scores.calculations);
    const output = try render(&populations, &buffer);
    for ([_][]const u8{
        "lodestar_gossip_peer_score_by_threshold_count{threshold=\"all\"} 6\n",
        "lodestar_gossip_peer_score_by_threshold_count{threshold=\"mesh\"} 1\n",
        "lodestar_gossip_peer_score_by_threshold_count{threshold=\"gossip\"} 3\n",
        "lodestar_gossip_peer_score_by_threshold_count{threshold=\"publish\"} 4\n",
        "lodestar_gossip_peer_score_by_threshold_count{threshold=\"graylist\"} 5\n",
        "lodestar_gossip_mesh_peer_score_by_threshold_count{threshold=\"all\"} 3\n",
        "lodestar_gossip_mesh_peer_score_by_threshold_count{threshold=\"mesh\"} 0\n",
        "lodestar_gossip_mesh_peer_score_by_threshold_count{threshold=\"gossip\"} 2\n",
        "lodestar_gossip_mesh_peer_score_by_threshold_count{threshold=\"publish\"} 3\n",
        "lodestar_gossip_mesh_peer_score_by_threshold_count{threshold=\"graylist\"} 3\n",
        "lodestar_gossip_score_avg_min_max_min -25\n",
        "lodestar_gossip_score_avg_min_max_max 0\n",
        "lodestar_gossip_mesh_score_avg_min_max_min -9\n",
        "lodestar_gossip_mesh_score_avg_min_max_avg -4.416666666666667\n",
        "lodestar_gossip_mesh_score_avg_min_max_max -0.25\n",
    }) |line| try std.testing.expect(std.mem.find(u8, output, line) != null);
    var mean: [96]u8 = undefined;
    const connected_mean = try std.fmt.bufPrint(&mean, "lodestar_gossip_score_avg_min_max_avg {d}\n", .{@as(f64, -54.25) / 6});
    try std.testing.expect(std.mem.find(u8, output, connected_mean) != null);
}

test "gossip queue residence measures completion and excludes cancellations" {
    var delivery: metrics.Delivery = .{};
    delivery.completed(.{ .origin = .forward, .kind = .beacon_block, .enqueued_ms = 100 }, 400);
    delivery.completed(.{ .origin = .iwant, .kind = .beacon_attestation, .enqueued_ms = 900 }, 1000);
    delivery.cancelled(&.{ 2, 0, 0 });
    const blocks = delivery.residence[@intFromEnum(policy.Kind.beacon_block)];
    try std.testing.expectEqual(@as(u64, 1), blocks.count);
    try std.testing.expectEqual(@as(u128, 300), blocks.sum);
    const attestations = delivery.residence[@intFromEnum(policy.Kind.beacon_attestation)];
    try std.testing.expectEqual(@as(u64, 1), attestations.count);
    try std.testing.expectEqual(@as(u128, 100), attestations.sum);
}
