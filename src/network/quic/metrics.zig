const std = @import("std");
const c = @import("binding.zig").c;
const prom = @import("../metrics/registry.zig");

pub const Counters = struct {
    sent: u64 = 0,
    lost: u64 = 0,
    stream_retrans_bytes: u64 = 0,
    data_blocked_sent_count: u64 = 0,
    stream_data_blocked_sent_count: u64 = 0,
    data_blocked_recv_count: u64 = 0,
    stream_data_blocked_recv_count: u64 = 0,

    pub fn add(self: *Counters, stats: *const c.quiche_stats) void {
        inline for (std.meta.fields(Counters)) |field| @field(self, field.name) +|= @field(stats, field.name);
    }

    pub fn retire(self: *Counters, conn: *c.quiche_conn) void {
        var stats: c.quiche_stats = undefined;
        c.quiche_conn_stats(conn, &stats);
        self.add(&stats);
    }
};

const Range = struct {
    min: u64 = std.math.maxInt(u64),
    max: u64 = 0,
    sum: u64 = 0,

    fn observe(self: *Range, value: u64) void {
        self.min = @min(self.min, value);
        self.max = @max(self.max, value);
        self.sum +|= value;
    }
};

pub const Snapshot = struct {
    counters: Counters = .{},
    paths: u16 = 0,
    unsampled: u16 = 0,
    cwnd: Range = .{},
    rtt: Range = .{},

    pub fn observe(self: *Snapshot, conn: *c.quiche_conn) void {
        var stats: c.quiche_stats = undefined;
        c.quiche_conn_stats(conn, &stats);
        self.counters.add(&stats);
        // A migration can leave old paths behind. Bound scrape work and expose missed samples.
        for (0..@min(stats.paths_count, 8)) |index| {
            var path: c.quiche_path_stats = undefined;
            if (c.quiche_conn_path_stats(conn, index, &path) != 0 or !path.active) continue;
            self.paths += 1;
            self.cwnd.observe(path.cwnd);
            self.rtt.observe(path.rtt);
            return;
        }
        self.unsampled += 1;
    }

    pub fn write(self: *const Snapshot, w: *prom.Encoder) prom.Error!void {
        inline for (.{
            .{ "sent", "lodestar_quic_sent_packets_total", "QUIC packets sent, including retired connections" },
            .{ "lost", "lodestar_quic_lost_packets_total", "QUIC packets declared lost, including retired connections" },
            .{ "stream_retrans_bytes", "lodestar_quic_retransmitted_stream_bytes_total", "QUIC stream bytes retransmitted, including retired connections" },
        }) |field| try w.scalar(.{ .name = field[1], .kind = .counter, .help = field[2] }, @field(self.counters, field[0]));
        const blocked = try w.family(.{ .name = "lodestar_quic_flow_control_blocked_frames_total", .kind = .counter, .help = "DATA_BLOCKED and STREAM_DATA_BLOCKED frames, not blocked writes or blocked duration", .labels = &.{ "direction", "scope" } });
        try blocked.sample(.{ "sent", "connection" }, self.counters.data_blocked_sent_count);
        try blocked.sample(.{ "sent", "stream" }, self.counters.stream_data_blocked_sent_count);
        try blocked.sample(.{ "received", "connection" }, self.counters.data_blocked_recv_count);
        try blocked.sample(.{ "received", "stream" }, self.counters.stream_data_blocked_recv_count);
        try w.scalar(.{ .name = "lodestar_quic_active_path_count", .kind = .gauge, .help = "Active QUIC paths sampled for congestion window and RTT" }, self.paths);
        try w.scalar(.{ .name = "lodestar_quic_unsampled_connection_count", .kind = .gauge, .help = "QUIC connections without an active path in the bounded statistics scan" }, self.unsampled);
        const cwnd = try w.family(.{ .name = "lodestar_quic_congestion_window_bytes", .kind = .gauge, .help = "Current congestion windows of sampled active QUIC paths", .labels = &.{"stat"}, .unit = .bytes });
        const rtt = try w.family(.{ .name = "lodestar_quic_rtt_seconds", .kind = .gauge, .help = "Current RTT estimates of sampled active QUIC paths", .labels = &.{"stat"}, .unit = .seconds });
        inline for (.{ "min", "max", "sum" }) |stat| {
            try cwnd.sample(.{stat}, if (self.paths == 0) 0 else @field(self.cwnd, stat));
            try rtt.sample(.{stat}, if (self.paths == 0) 0 else @as(f64, @floatFromInt(@field(self.rtt, stat))) / 1e9);
        }
    }
};
