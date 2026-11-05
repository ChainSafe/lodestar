//! Host gossip processing metrics sampled under the runtime mutex.
const std = @import("std");
const prom = @import("registry.zig");
const processor = @import("../gossip_processor/root.zig");
const gossip_limits = @import("../gossip_limits.zig");
const Kind = gossip_limits.Kind;

pub const Snapshot = struct {
    items: [gossip_limits.kind_count][processor.GossipProcessor.occupancy_count]u64 = @splat(@splat(0)),
    refusals: [gossip_limits.kind_count][processor.GossipProcessor.refusal_count]u64 = @splat(@splat(0)),
    execution: gossip_limits.Limits = @splat(.{ .items = 0, .bytes = 0 }),

    /// The caller holds the runtime mutex that guards `table`.
    pub fn captureProcessor(self: *Snapshot, table: *const processor.GossipProcessor) void {
        for (&self.items, 0..) |*items, k| items.* = table.occupancy(@enumFromInt(k));
        self.refusals = table.refusals;
        self.execution = table.execution;
    }
};

pub const empty: Snapshot = .{};

pub fn write(snapshot: *const Snapshot, w: *prom.Encoder) prom.Error!void {
    inline for (.{
        .{ "lodestar_gossip_validation_queue_length", .queued, "Gossip messages queued for validation" },
        .{ "lodestar_gossip_validation_waiting_block_count", .waiting, "Gossip messages waiting for an unknown block" },
        .{ "lodestar_gossip_validation_dependency_checks_count", .checking, "Gossip messages awaiting a host dependency check" },
        .{ "lodestar_gossip_validation_queue_concurrency", .executing, "Gossip messages executing on the host" },
    }) |metric| {
        const items = try w.family(.{ .name = metric[0], .kind = .gauge, .help = metric[2], .labels = &.{"topic"} });
        for (snapshot.items, 0..) |states, k| {
            try items.sample(.{@tagName(@as(Kind, @enumFromInt(k)))}, states[@intFromEnum(@as(processor.GossipProcessor.Occupancy, metric[1]))]);
        }
    }
    var waiting: u64 = 0;
    for (snapshot.items) |states| waiting += states[@intFromEnum(processor.GossipProcessor.Occupancy.waiting)];
    try w.scalar(.{
        .name = "lodestar_awaiting_block_gossip_messages_per_slot_total",
        .kind = .gauge,
        .help = "Current gossip messages waiting for an unknown block",
    }, waiting);
    const refusals = try w.family(.{ .name = "lodestar_gossip_validation_refusals_total", .kind = .counter, .help = "Gossip messages refused by topic and admission reason", .labels = &.{ "topic", "reason" } });
    for (snapshot.refusals, 0..) |reasons, k| for (reasons, 0..) |count, reason| {
        try refusals.sample(.{ @tagName(@as(Kind, @enumFromInt(k))), @tagName(@as(processor.GossipProcessor.Refusal, @enumFromInt(reason))) }, count);
    };
    inline for (.{
        .{ "lodestar_gossip_validation_concurrency_limit", "items", "Maximum gossip messages executing per topic" },
        .{ "lodestar_gossip_validation_execution_limit_bytes", "bytes", "Maximum bytes of gossip messages executing per topic" },
    }) |metric| {
        const limit = try w.family(.{ .name = metric[0], .kind = .gauge, .help = metric[2], .labels = &.{"topic"} });
        for (snapshot.execution, 0..) |value, k| try limit.sample(.{@tagName(@as(Kind, @enumFromInt(k)))}, @field(value, metric[1]));
    }
}

test "processor snapshot renders occupancy, refusals and execution limits" {
    const limits: gossip_limits.Limits = @splat(.{ .items = 4, .bytes = 4096 });
    var table = try processor.GossipProcessor.init(std.testing.allocator, .{ .limits = limits });
    defer table.deinit();
    var snapshot: Snapshot = .{};
    snapshot.captureProcessor(&table);
    snapshot.items[@intFromEnum(Kind.beacon_attestation)][@intFromEnum(processor.GossipProcessor.Occupancy.queued)] = 3;
    snapshot.items[@intFromEnum(Kind.beacon_attestation)][@intFromEnum(processor.GossipProcessor.Occupancy.waiting)] = 5;
    snapshot.items[@intFromEnum(Kind.beacon_attestation)][@intFromEnum(processor.GossipProcessor.Occupancy.checking)] = 7;
    snapshot.items[@intFromEnum(Kind.beacon_attestation)][@intFromEnum(processor.GossipProcessor.Occupancy.executing)] = 2;
    snapshot.refusals[@intFromEnum(Kind.data_column_sidecar)][@intFromEnum(processor.GossipProcessor.Refusal.source_full)] = 2;
    var buffer: [256 * 1024]u8 = undefined;
    var writer = std.Io.Writer.fixed(&buffer);
    var encoder: prom.Encoder = .{ .writer = &writer };
    try write(&snapshot, &encoder);
    const output = writer.buffered();
    for ([_][]const u8{
        "lodestar_gossip_validation_queue_length{topic=\"beacon_attestation\"} 3\n",
        "lodestar_gossip_validation_waiting_block_count{topic=\"beacon_attestation\"} 5\n",
        "lodestar_awaiting_block_gossip_messages_per_slot_total 5\n",
        "lodestar_gossip_validation_dependency_checks_count{topic=\"beacon_attestation\"} 7\n",
        "lodestar_gossip_validation_queue_concurrency{topic=\"beacon_attestation\"} 2\n",
        "lodestar_gossip_validation_refusals_total{topic=\"data_column_sidecar\",reason=\"source_full\"} 2\n",
        "lodestar_gossip_validation_concurrency_limit{topic=\"data_column_sidecar\"} 2\n",
        "lodestar_gossip_validation_execution_limit_bytes{topic=\"data_column_sidecar\"} 4096\n",
    }) |expected| try std.testing.expect(std.mem.find(u8, output, expected) != null);
}
