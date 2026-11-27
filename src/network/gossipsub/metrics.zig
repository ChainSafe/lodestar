const prom = @import("../metrics/registry.zig");
const std = @import("std");
const policy = @import("topic_policy.zig");
const topic = @import("topic.zig");
const PeerBook = @import("peer_book.zig").PeerBook;
const Overlay = @import("overlay.zig").Overlay;
const Sessions = @import("sessions.zig").Sessions;
const PeerSet = @import("sessions.zig").PeerSet;
const histogram = @import("../metrics/histogram.zig");
const RpcCounts = @import("protobuf_schema.zig").RpcCounts;

pub const ValidationTime = histogram.Duration(&.{ 10, 30, 100, 300, 1000, 3000, 10000 });

/// Received schema-valid RPCs or RPCs admitted to outbound queues. Bytes exclude the length
/// prefix. A send admission is not a delivery acknowledgement and survives later cancellation.
pub const RpcCounters = struct {
    bytes: u64 = 0,
    count: u64 = 0,
    subscription: u64 = 0,
    message: u64 = 0,
    control: u64 = 0,
    ihave: u64 = 0,
    iwant: u64 = 0,
    graft: u64 = 0,
    prune: u64 = 0,
    idontwant: u64 = 0,

    pub fn record(self: *RpcCounters, bytes: usize, counts: *const RpcCounts) void {
        self.bytes +|= bytes;
        self.count +|= 1;
        inline for (std.meta.fields(RpcCounts)) |field| @field(self, field.name) +|= @field(counts, field.name);
    }

    pub fn add(self: *RpcCounters, other: *const RpcCounters) void {
        inline for (std.meta.fields(RpcCounters)) |field| @field(self, field.name) +|= @field(other, field.name);
    }

    pub fn write(self: *const RpcCounters, comptime direction: enum { recv, sent }, w: *prom.Encoder) prom.Error!void {
        inline for (.{
            .{ "bytes", "Protobuf body bytes excluding the stream length prefix" },
            .{ "count", "RPC frames" },
            .{ "subscription", "Subscription entries" },
            .{ "message", "Message copies, including duplicates" },
            .{ "control", "RPC frames containing control" },
            .{ "ihave", "IHAVE entries, not message IDs" },
            .{ "iwant", "IWANT entries, not message IDs" },
            .{ "graft", "GRAFT entries, independent of mesh admission" },
            .{ "prune", "PRUNE entries, independent of mesh membership" },
            .{ "idontwant", "IDONTWANT entries, not message IDs" },
        }) |field| try w.scalar(.{
            .name = "gossipsub_rpc_" ++ @tagName(direction) ++ "_" ++ field[0] ++ "_total",
            .kind = .counter,
            .help = field[1] ++ (if (direction == .recv) " received in schema-valid RPCs" else " admitted to outbound queues; not remote delivery"),
        }, @field(self, field[0]));
    }
};

/// Data frame recipients by delivery origin: selected, then queued, pressured or unavailable;
/// queued frames later complete when QUIC accepts their last byte, which is not delivery, or are
/// cancelled by cache eviction or a stream reset.
pub const Delivery = struct {
    const delivery = @import("delivery.zig");
    pub const Outcome = enum { selected, queued, pressured, unavailable, completed, cancelled };

    const Residence = histogram.Duration(&.{ 1, 10, 30, 100, 300, 1000, 3000, 6000, 30000 });
    residence: [policy.kind_count]Residence = @splat(.{}),
    recipients: [delivery.origin_count][@typeInfo(Outcome).@"enum".fields.len]u64 = @splat(@splat(0)),

    pub fn completed(self: *Delivery, receipt: delivery.Receipt, now_ms: u64) void {
        self.recipient(receipt.origin, .completed);
        self.residence[@intFromEnum(receipt.kind)].observe(now_ms -| receipt.enqueued_ms);
    }

    pub fn recipient(self: *Delivery, origin: delivery.Origin, outcome: Outcome) void {
        if (outcome != .completed and outcome != .cancelled) self.recipients[@intFromEnum(origin)][@intFromEnum(Outcome.selected)] +|= 1;
        self.recipients[@intFromEnum(origin)][@intFromEnum(outcome)] +|= 1;
    }

    pub fn cancelled(self: *Delivery, queued: *const [delivery.origin_count]usize) void {
        for (&self.recipients, queued) |*outcomes, count| outcomes[@intFromEnum(Outcome.cancelled)] +|= count;
    }

    pub fn write(self: *const Delivery, w: *prom.Encoder) prom.Error!void {
        const residence = try w.histograms(.{ .name = "gossipsub_send_queue_seconds", .kind = .histogram, .help = "Time from enqueue until QUIC accepts the last byte of a completed data frame; excludes cancelled frames and does not measure remote delivery", .unit = .seconds, .labels = &.{"kind"} }, Residence);
        inline for (std.meta.fields(policy.Kind)) |kind| try residence.histogram(.{kind.name}, &self.residence[kind.value]);
        const recipients = try w.family(.{ .name = "gossipsub_data_recipients_total", .kind = .counter, .help = "Data frame recipients by delivery origin: selected, then queued, pressured or unavailable; queued frames later complete when QUIC accepts their last byte, which is not delivery, or are cancelled by cache eviction or a stream reset", .labels = &.{ "origin", "outcome" } });
        inline for (@typeInfo(delivery.Origin).@"enum".fields) |origin| {
            inline for (@typeInfo(Outcome).@"enum".fields) |outcome| try recipients.sample(.{ origin.name, outcome.name }, self.recipients[origin.value][outcome.value]);
        }
    }
};

/// Messages received, received again and published, applied verdicts, and accepted messages
/// handed to forwarding, for one topic kind.
pub const Counters = struct {
    received: u64 = 0,
    duplicate: u64 = 0,
    published: u64 = 0,
    published_bytes: u64 = 0,
    accepted: u64 = 0,
    rejected: u64 = 0,
    ignored: u64 = 0,
    forwarded: u64 = 0,
};

pub const Topics = struct {
    counts: [policy.kind_count + 1]Counters = @splat(.{}),

    pub fn get(self: *Topics, wire: []const u8) *Counters {
        const parsed = topic.parse(wire) orelse return &self.counts[policy.kind_count];
        const known = topic.Name.parse(parsed.name) orelse return &self.counts[policy.kind_count];
        return &self.counts[@intFromEnum(known.kind)];
    }
};

/// Connected gossip peers, and the distinct peers in any mesh, by the score gates they clear, with
/// each population's score range. Gates are cumulative: a peer at or above one clears every lower
/// one.
pub const ScorePopulations = struct {
    const Scope = enum { connected, mesh };
    const Threshold = enum { all, nonnegative, gossip, publish, graylist };
    const Population = struct {
        peers: [std.meta.fields(Threshold).len]u32 = @splat(0),
        min: f64 = 0,
        max: f64 = 0,
        sum: f64 = 0,

        fn observe(self: *Population, value: f64, gates: *const [std.meta.fields(Threshold).len]f64) void {
            std.debug.assert(std.math.isFinite(value));
            const first = self.peers[@intFromEnum(Threshold.all)] == 0;
            for (&self.peers, gates) |*count, gate| count.* += @intFromBool(value >= gate);
            self.min = if (first) value else @min(self.min, value);
            self.max = if (first) value else @max(self.max, value);
            self.sum += value;
        }
    };

    populations: [std.meta.fields(Scope).len]Population = @splat(.{}),

    /// Evaluates each connected peer's score once, without changing decay, cache validity or
    /// policy metrics. Each active session holds a distinct logical peer.
    pub fn collect(peers: *const PeerBook, overlay: *const Overlay, sessions: *const Sessions, now_ms: u64) ScorePopulations {
        var meshed = PeerSet.empty;
        for (overlay.rows) |*row| if (row.active) meshed.setUnion(row.mesh);
        const params = &peers.scores.params;
        const gates = [_]f64{ -std.math.inf(f64), 0, params.gossip_threshold, params.publish_threshold, params.graylist_threshold };
        var result: ScorePopulations = .{};
        for (sessions.rows, 0..) |*session, index| {
            if (!session.active) continue;
            const value = peers.snapshot(session.logical, now_ms);
            result.populations[@intFromEnum(Scope.connected)].observe(value, &gates);
            if (meshed.isSet(index)) result.populations[@intFromEnum(Scope.mesh)].observe(value, &gates);
        }
        return result;
    }

    pub fn write(self: *const ScorePopulations, w: *prom.Encoder) prom.Error!void {
        inline for (std.meta.fields(Scope)) |scope| {
            const prefix = if (comptime std.mem.eql(u8, scope.name, "connected")) "lodestar_gossip" else "lodestar_gossip_mesh";
            const population = &self.populations[scope.value];
            const counts = try w.family(.{
                .name = prefix ++ "_peer_score_by_threshold_count",
                .kind = .gauge,
                .help = "Distinct gossip peers whose score meets each configured gate; thresholds are cumulative",
                .labels = &.{"threshold"},
            });
            inline for (std.meta.fields(Threshold)) |threshold| {
                const label = if (comptime std.mem.eql(u8, threshold.name, "nonnegative")) "mesh" else threshold.name;
                try counts.sample(.{label}, population.peers[threshold.value]);
            }
            const count = population.peers[@intFromEnum(Threshold.all)];
            inline for (.{ "sum", "avg", "min", "max" }) |stat| {
                const value = if (comptime std.mem.eql(u8, stat, "avg"))
                    if (count == 0) 0 else population.sum / @as(f64, @floatFromInt(count))
                else
                    @field(population, stat);
                try w.scalar(.{
                    .name = prefix ++ "_score_avg_min_max_" ++ stat,
                    .kind = .gauge,
                    .help = "Gossip peer score " ++ stat ++ "; zero for an empty population",
                }, value);
            }
        }
    }
};

/// An IWANT ID absent from history, or present and then over its retransmission limit,
/// queued or refused for queue pressure.
pub const IwantOutcome = enum { miss, limited, queued, refused };
pub const iwant_outcome_count = @typeInfo(IwantOutcome).@"enum".fields.len;

test {
    _ = @import("metrics_test.zig");
}
