const std = @import("std");
const catalog = @import("catalog.zig");
const client = @import("client.zig");
const prom = @import("../metrics/registry.zig");
const Histogram = @import("../metrics/histogram.zig").Distribution;
const Gossipsub = @import("../gossipsub/Gossipsub.zig");
const PeerSet = @import("../gossipsub/sessions.zig").PeerSet;
const reputation = @import("reputation.zig");
const client_count = @typeInfo(client.Client).@"enum".fields.len;

/// Current connected peer population. Scraping never advances reputation or gossip scoring state.
pub const Population = struct {
    count: usize = 0,
    relevant: usize = 0,
    directions: [client_count][2]u16 = @splat(@splat(0)),
    ages: Histogram(&.{ 5, 20, 60, 180, 600, 1200, 3600, 21600, 86400 }) = .{},
    attnets: Histogram(&.{ 0, 4, 16, 32, 64 }) = .{},
    custody: Histogram(&.{ 0, 4, 8, 16, 32, 64, 128 }) = .{},
    scores: [client_count]Histogram(&.{ -100, -50, -20, 0, 25 }) = @splat(.{}),
    gossip_scores: [client_count]Histogram(&.{ -16000, -8000, -4000, -1000, 0, 5, 100 }) = @splat(.{}),
    mesh_clients: [client_count]u16 = @splat(0),

    pub fn collect(peers: *const catalog.Catalog, gossip: *const Gossipsub, now_ms: u64) Population {
        var result: Population = .{};
        var mesh = PeerSet.empty;
        for (gossip.overlay.rows) |*topic| if (topic.active) mesh.setUnion(topic.mesh);
        for (peers.rows) |*row| {
            const connection = row.connection orelse continue;
            const kind = client.fromIdentify(&row.identify);
            result.observe(row, kind, now_ms);
            const session = gossip.sessions.find(connection);
            const gossip_score = if (session) |index| gossip.peers.snapshot(gossip.sessions.rows[index].logical, now_ms) else 0;
            var rpc = row.reputation;
            rpc.decay(now_ms);
            result.scores[@intFromEnum(kind)].observe(reputation.selectionScore(rpc.score, gossip_score, gossip.graylistThreshold()));
            result.gossip_scores[@intFromEnum(kind)].observe(gossip_score);
            if (session) |index| if (mesh.isSet(index)) {
                result.mesh_clients[@intFromEnum(kind)] += 1;
            };
        }
        return result;
    }

    pub fn observe(self: *Population, row: *const catalog.Catalog.Row, kind: client.Client, now_ms: u64) void {
        std.debug.assert(row.connection != null);
        self.count += 1;
        self.relevant += @intFromBool(row.status != null);
        self.directions[@intFromEnum(kind)][@intFromEnum(row.direction)] += 1;
        self.ages.observe(@as(f64, @floatFromInt(now_ms -| row.connected_at_ms)) / 1000);
        var attnets: u16 = 0;
        var custody: u64 = 0;
        if (row.metadata) |metadata| {
            for (metadata.attnets) |bits| attnets += @popCount(bits);
            custody = metadata.custody_group_count orelse 0;
        }
        self.attnets.observe(@floatFromInt(attnets));
        self.custody.observe(@floatFromInt(custody));
    }

    pub fn clientCount(self: *const Population, kind: client.Client) u16 {
        const counts = self.directions[@intFromEnum(kind)];
        return counts[0] + counts[1];
    }

    pub fn directionCounts(self: *const Population) [2]u16 {
        var counts: [2]u16 = @splat(0);
        for (self.directions) |row| for (&counts, row) |*total, count| {
            total.* += count;
        };
        return counts;
    }

    pub fn write(self: *const Population, w: *prom.Encoder) prom.Error!void {
        const ages = try w.histograms(.{
            .name = "lodestar_peer_connection_seconds",
            .kind = .histogram,
            .help = "Current connection ages in seconds; collected from the current population",
            .labels = &.{},
            .unit = .seconds,
        }, @TypeOf(self.ages));
        try ages.histogram(.{}, &self.ages);
        const attnets = try w.histograms(.{
            .name = "lodestar_peer_long_lived_attnets_count",
            .kind = .histogram,
            .help = "Current connected peers' advertised long lived attestation subnet counts; zero before Metadata",
        }, @TypeOf(self.attnets));
        try attnets.histogram(.{}, &self.attnets);
        const custody = try w.histograms(.{
            .name = "lodestar_peer_column_group_count",
            .kind = .histogram,
            .help = "Current connected peers' advertised custody group counts; zero when absent",
        }, @TypeOf(self.custody));
        try custody.histogram(.{}, &self.custody);
        const scores = try w.histograms(.{
            .name = "lodestar_app_peer_score",
            .kind = .histogram,
            .help = "Current connected peers' selection scores, combining decayed application reputation and weighted gossip scores",
            .labels = &.{"client"},
        }, @TypeOf(self.scores[0]));
        const gossip_scores = try w.histograms(.{
            .name = "lodestar_gossip_score_by_client",
            .kind = .histogram,
            .help = "Current connected peers' gossip scores by client; zero before gossip session admission",
            .labels = &.{"client"},
        }, @TypeOf(self.gossip_scores[0]));
        const mesh_clients = try w.family(.{
            .name = "lodestar_gossip_mesh_peers_by_client_count",
            .kind = .gauge,
            .help = "Distinct connected peers in any mesh by client",
            .labels = &.{"client"},
        });
        inline for (std.meta.fields(client.Client)) |kind| {
            try scores.histogram(.{kind.name}, &self.scores[kind.value]);
            try gossip_scores.histogram(.{kind.name}, &self.gossip_scores[kind.value]);
            try mesh_clients.sample(.{kind.name}, self.mesh_clients[kind.value]);
        }
    }
};

test {
    _ = @import("population_test.zig");
}
