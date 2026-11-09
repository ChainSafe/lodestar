const std = @import("std");
const m = @import("metrics");

/// Emitted as four parallel gauge series: `_sum`/`_avg`/`_min`/`_max`.
pub const AvgMinMax = struct {
    sum: f64 = 0,
    avg: f64 = 0,
    min: f64 = 0,
    max: f64 = 0,
};

/// No samples → all-zero (the gauge's empty-set value).
pub const AvgMinMaxAccumulator = struct {
    sum: f64 = 0,
    min: f64 = 0,
    max: f64 = 0,
    count: u64 = 0,

    pub fn add(self: *AvgMinMaxAccumulator, value: f64) void {
        if (self.count == 0) {
            self.min = value;
            self.max = value;
        } else {
            self.min = @min(self.min, value);
            self.max = @max(self.max, value);
        }
        self.sum += value;
        self.count += 1;
    }

    pub fn result(self: AvgMinMaxAccumulator) AvgMinMax {
        if (self.count == 0) return .{};
        return .{
            .sum = self.sum,
            .avg = self.sum / @as(f64, @floatFromInt(self.count)),
            .min = self.min,
            .max = self.max,
        };
    }
};

/// `size`/`reads`/`seconds_since_last_read` are PULL gauges: the metrics module serializes whatever the
/// gauge holds at scrape time, so the cache refreshes them before `write()` (no push collect-callback).
pub const BlockStateCacheMetrics = struct {
    lookups: Count,
    hits: Count,
    adds: Count,
    size: Gauge,
    reads_sum: F64Gauge,
    reads_avg: F64Gauge,
    reads_min: F64Gauge,
    reads_max: F64Gauge,
    seconds_since_last_read_sum: F64Gauge,
    seconds_since_last_read_avg: F64Gauge,
    seconds_since_last_read_min: F64Gauge,
    seconds_since_last_read_max: F64Gauge,
    state_cloned_count: ClonedHistogram,

    const Count = m.Counter(u64);
    const Gauge = m.Gauge(u64);
    const F64Gauge = m.Gauge(f64);
    const ClonedHistogram = m.Histogram(u64, &.{ 1, 2, 5, 10, 50, 250 });
};

/// `initializeNoop` default: metrics always emit (no `enabled()` gate), so the cache is safe to use
/// whether or not `init` is called.
pub var block_cache_metrics = m.initializeNoop(BlockStateCacheMetrics);

/// Call once on startup.
pub fn init(comptime opts: m.RegistryOpts) void {
    block_cache_metrics = .{
        .lookups = BlockStateCacheMetrics.Count.init(
            "lodestar_state_cache_lookups_total",
            .{ .help = "Block state cache lookups" },
            opts,
        ),
        .hits = BlockStateCacheMetrics.Count.init(
            "lodestar_state_cache_hits_total",
            .{ .help = "Block state cache hits" },
            opts,
        ),
        .adds = BlockStateCacheMetrics.Count.init(
            "lodestar_state_cache_adds_total",
            .{ .help = "Block state cache adds" },
            opts,
        ),
        .size = BlockStateCacheMetrics.Gauge.init(
            "lodestar_state_cache_size",
            .{ .help = "Block state cache size" },
            opts,
        ),
        .reads_sum = BlockStateCacheMetrics.F64Gauge.init(
            "lodestar_state_cache_reads_sum",
            .{ .help = "Sum of block state cache items total read count" },
            opts,
        ),
        .reads_avg = BlockStateCacheMetrics.F64Gauge.init(
            "lodestar_state_cache_reads_avg",
            .{ .help = "Avg of block state cache items total read count" },
            opts,
        ),
        .reads_min = BlockStateCacheMetrics.F64Gauge.init(
            "lodestar_state_cache_reads_min",
            .{ .help = "Min of block state cache items total read count" },
            opts,
        ),
        .reads_max = BlockStateCacheMetrics.F64Gauge.init(
            "lodestar_state_cache_reads_max",
            .{ .help = "Max of block state cache items total read count" },
            opts,
        ),
        .seconds_since_last_read_sum = BlockStateCacheMetrics.F64Gauge.init(
            "lodestar_state_cache_seconds_since_last_read_sum",
            .{ .help = "Sum of seconds since block state cache items were last read" },
            opts,
        ),
        .seconds_since_last_read_avg = BlockStateCacheMetrics.F64Gauge.init(
            "lodestar_state_cache_seconds_since_last_read_avg",
            .{ .help = "Avg of seconds since block state cache items were last read" },
            opts,
        ),
        .seconds_since_last_read_min = BlockStateCacheMetrics.F64Gauge.init(
            "lodestar_state_cache_seconds_since_last_read_min",
            .{ .help = "Min of seconds since block state cache items were last read" },
            opts,
        ),
        .seconds_since_last_read_max = BlockStateCacheMetrics.F64Gauge.init(
            "lodestar_state_cache_seconds_since_last_read_max",
            .{ .help = "Max of seconds since block state cache items were last read" },
            opts,
        ),
        .state_cloned_count = BlockStateCacheMetrics.ClonedHistogram.init(
            "lodestar_state_cache_state_cloned_count",
            .{ .help = "Clone count of a state served from the block cache" },
            opts,
        ),
    };
}

pub fn block() *BlockStateCacheMetrics {
    return &block_cache_metrics;
}

/// Caller must refresh the PULL gauges (see `BlockStateCacheMetrics`) before calling, so the scrape
/// reflects current state.
pub fn write(writer: anytype) !void {
    try m.write(&block_cache_metrics, writer);
}

pub fn setBlockSize(value: u64) void {
    block_cache_metrics.size.set(value);
}

pub fn setBlockReads(reads: AvgMinMax, secs: AvgMinMax) void {
    block_cache_metrics.reads_sum.set(reads.sum);
    block_cache_metrics.reads_avg.set(reads.avg);
    block_cache_metrics.reads_min.set(reads.min);
    block_cache_metrics.reads_max.set(reads.max);
    block_cache_metrics.seconds_since_last_read_sum.set(secs.sum);
    block_cache_metrics.seconds_since_last_read_avg.set(secs.avg);
    block_cache_metrics.seconds_since_last_read_min.set(secs.min);
    block_cache_metrics.seconds_since_last_read_max.set(secs.max);
}

test "init compiles end-to-end" {
    init(.{});
    defer block_cache_metrics = m.initializeNoop(BlockStateCacheMetrics);
    setBlockSize(5);
    setBlockReads(
        .{ .sum = 4, .avg = 2, .min = 1, .max = 3 },
        .{ .sum = 1.5, .avg = 0.75, .min = 0.25, .max = 1.25 },
    );
}
