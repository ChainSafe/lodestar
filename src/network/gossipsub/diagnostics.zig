const std = @import("std");
const Now = @import("../types.zig").Now;
const score = @import("score.zig");
const topic = @import("topic.zig");
const PeerId = @import("../wire/peer_id.zig").PeerId;
const Gossipsub = @import("Gossipsub.zig");
const topic_policy = @import("topic_policy.zig");
pub const peers_per_page = 8;

pub const Topic = struct {
    index: u16,
    name: [topic.topic_max_len]u8,
    len: u8,
    subscribed: bool,
    weight: f64,
    mesh_activation_ms: u64,
};
pub const TopicScore = struct {
    index: u16,
    counters: score.TopicCounters,
    weights: score.TopicWeights,
    mesh_member: bool,
};
pub const Peer = struct {
    identity: PeerId,
    connected: bool,
    outbound_ready: bool,
    address: [16]u8,
    retain_until: u64,
    score: f64,
    behaviour: f64,
    weights: score.GlobalWeights,
    topics: []TopicScore,
    topic_count: u16 = 0,
};
pub const Page = struct {
    mono_ms: u64 = 0,
    unix_s: i64 = 0,
    next: ?u16 = null,
    peers: [peers_per_page]Peer = undefined,
    peer_count: u8 = 0,
    topics: []Topic,
    topic_count: u16 = 0,
    topic_scores: []TopicScore,
    weights: []score.TopicWeights,

    pub fn init(a: std.mem.Allocator, count: usize) !Page {
        std.debug.assert(count > 0 and count <= topic_policy.topic_max);
        const topics = try a.alloc(Topic, count);
        errdefer a.free(topics);
        const topic_scores = try a.alloc(TopicScore, count * peers_per_page);
        errdefer a.free(topic_scores);
        const weights = try a.alloc(score.TopicWeights, count);
        var result: Page = .{ .topics = topics, .topic_scores = topic_scores, .weights = weights };
        for (&result.peers, 0..) |*peer, i| peer.topics = topic_scores[i * count ..][0..count];
        return result;
    }

    pub fn deinit(self: *Page, a: std.mem.Allocator) void {
        a.free(self.weights);
        a.free(self.topic_scores);
        a.free(self.topics);
        self.* = undefined;
    }

    pub fn backingBytes(count: usize) usize {
        return count * (@sizeOf(Topic) + peers_per_page * @sizeOf(TopicScore) + @sizeOf(score.TopicWeights));
    }
};

pub fn capture(g: *const Gossipsub, cursor: u16, now: Now, out: *Page) error{InvalidDiagnosticsCursor}!void {
    std.debug.assert(out.topics.len == g.overlay.rows.len);
    if (cursor > g.peers.rows.len) return error.InvalidDiagnosticsCursor;
    out.mono_ms = now.millis();
    out.unix_s = now.unixSeconds();
    out.next = null;
    out.peer_count = 0;
    out.topic_count = 0;
    for (g.overlay.rows, 0..) |*row, i| {
        if (!row.active) continue;
        const params = &g.peers.scores.topic_params[i];
        const target = &out.topics[out.topic_count];
        target.* = .{ .index = @intCast(i), .name = undefined, .len = row.string_len, .subscribed = row.subscribed, .weight = params.weight, .mesh_activation_ms = params.mesh_delivery_activation_ms };
        @memcpy(target.name[0..target.len], row.string[0..row.string_len]);
        out.topic_count += 1;
    }
    var position: usize = cursor;
    for (0..g.peers.rows.len - cursor) |_| {
        if (out.peer_count == peers_per_page) break;
        const index = position;
        position += 1;
        const row = &g.peers.rows[index];
        if (!row.occupied) continue;
        const session = if (row.connection) |conn| g.sessions.find(conn) else null;
        var weights: score.Breakdown = .{ .topics = out.weights };
        const total = g.peers.snapshotWeights(.{ .index = @intCast(index), .generation = row.generation }, now.millis(), &weights);
        const peer = &out.peers[out.peer_count];
        peer.* = .{ .identity = row.identity, .connected = row.connection != null, .outbound_ready = if (session) |i| g.sessions.rows[i].outStream() != null else false, .address = row.address, .retain_until = row.retain_until, .score = total, .behaviour = g.peers.scores.rows[index].behaviour, .weights = weights.global, .topics = peer.topics };
        for (out.topics[0..out.topic_count]) |*known| {
            const counters = &g.peers.scores.topics[index * g.overlay.rows.len + known.index];
            const member = if (session) |i| g.overlay.rows[known.index].mesh.isSet(i) else false;
            if (!member and !counters.in_mesh and counters.first_deliveries == 0 and counters.mesh_deliveries == 0 and counters.mesh_failures == 0 and counters.invalid == 0) continue;
            peer.topics[peer.topic_count] = .{ .index = known.index, .counters = counters.*, .weights = weights.topics[known.index], .mesh_member = member };
            peer.topic_count += 1;
        }
        out.peer_count += 1;
    }
    if (position < g.peers.rows.len) out.next = @intCast(position);
}

test "gossip diagnostic pages bound peers preserve scores and include empty meshes" {
    const gossip_test = @import("test_support.zig");
    const a = std.testing.allocator;
    var g = try gossip_test.init(a, .{ .random_seed = 1, .connected_capacity = 10, .retained_capacity = 21, .retained_outbound_reserve = 1 });
    defer g.deinit();
    const name = "/eth2/01020304/beacon_block/ssz_snappy";
    try gossip_test.subscribe(&g, name);
    const t = g.overlay.findTopic(name).?;
    for (0..10) |i| {
        const peer = gossip_test.addPeer(&g, .{ .index = @intCast(i), .generation = 1 }, .v1_2).?;
        g.peers.scores.invalid(g.sessions.rows[peer.index].logical.index, t);
    }
    const page = try a.create(Page);
    defer a.destroy(page);
    page.* = try Page.init(a, g.overlay.rows.len);
    defer page.deinit(a);
    const calculations = g.peers.scores.calculations;
    const rows = try a.dupe(score.PeerScore.PeerState, g.peers.scores.rows);
    defer a.free(rows);
    try capture(&g, 0, Now.fromMilliseconds(.{ .mono_ms = 200, .unix_s = 1000 }), page);
    try std.testing.expectEqual(@as(u8, 8), page.peer_count);
    try std.testing.expectEqual(@as(?u16, 8), page.next);
    try std.testing.expectEqual(@as(u16, 1), page.topic_count);
    try std.testing.expect(page.topics[0].subscribed);
    try std.testing.expect(!page.peers[0].topics[0].mesh_member);
    try std.testing.expectEqual(@as(f64, 1), page.peers[0].topics[0].counters.invalid);
    try std.testing.expectEqual(g.peers.snapshot(g.sessions.rows[0].logical, 200), page.peers[0].score);
    try capture(&g, page.next.?, Now.fromMilliseconds(.{ .mono_ms = 200, .unix_s = 1000 }), page);
    try std.testing.expectEqual(@as(u8, 2), page.peer_count);
    try std.testing.expectEqual(@as(?u16, null), page.next);
    try std.testing.expectEqual(calculations, g.peers.scores.calculations);
    try std.testing.expectEqualDeep(rows, g.peers.scores.rows);
    try std.testing.expectError(error.InvalidDiagnosticsCursor, capture(&g, @intCast(g.peers.rows.len + 1), Now.fromMilliseconds(.{ .mono_ms = 200, .unix_s = 1000 }), page));
}
