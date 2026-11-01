const std = @import("std");
const prom = @import("../metrics/registry.zig");
const gossip = @import("root.zig");
const Gossipsub = @import("Gossipsub.zig");
const outbox = @import("outbox.zig");
const StorageRefusal = @import("messages.zig").StorageRefusal;
const IwantOutcome = @import("metrics.zig").IwantOutcome;

pub fn writeCounters(g: *const Gossipsub, w: *prom.Encoder) prom.Error!void {
    try w.enums(.{
        .name = "gossipsub_receive_discards_total",
        .kind = .counter,
        .help = "Gossip frames discarded for receive capacity, attributable timeout or unattributed expiry",
        .labels = &.{"reason"},
    }, Gossipsub.ReceiveDiscard, &g.counters.receive_discards);
    try g.rpc_received.write(.recv, w);
    var sent = g.retired_rpc_sent;
    for (g.sessions.rows) |*row| sent.add(&row.io.tx.rpc_sent);
    try sent.write(.sent, w);
    try w.scalar(.{
        .name = "gossipsub_ihave_budget_skipped_total",
        .kind = .counter,
        .help = "Topic advertisements skipped because they exceeded a peer's heartbeat byte or message-ID budget",
    }, g.counters.ihave_budget_skipped);
    try w.enums(.{
        .name = "gossipsub_storage_refusals_total",
        .kind = .counter,
        .help = "Gossip storage admission attempts refused by bounded resource reason",
        .labels = &.{"reason"},
    }, StorageRefusal, &g.messages.storage_refusals);
    try w.enums(.{
        .name = "gossipsub_retention_refusals_total",
        .kind = .counter,
        .help = "Accepted or published messages neither cached nor forwarded because their kind's retention allowance stayed full",
        .labels = &.{"topic"},
    }, gossip.topic.Kind, &g.messages.retention_refusals);
    try w.scalar(.{
        .name = "gossipsub_iwant_rcv_dont_have_msgids_total",
        .kind = .counter,
        .help = "Requested IWANT message IDs absent from history",
    }, g.iwant_outcomes[@intFromEnum(IwantOutcome.miss)]);
    const iwant = try w.family(.{
        .name = "gossipsub_iwant_known_msgids_total",
        .kind = .counter,
        .help = "Requested IWANT message IDs present in history by response outcome",
        .labels = &.{"outcome"},
    });
    inline for (std.meta.fields(IwantOutcome)) |outcome| {
        if (comptime outcome.value != @intFromEnum(IwantOutcome.miss))
            try iwant.sample(.{outcome.name}, g.iwant_outcomes[outcome.value]);
    }
    try w.scalar(.{
        .name = "gossipsub_iwant_promise_broken",
        .kind = .counter,
        .help = "Randomly sampled IWANT batch promises that expired without their sampled message",
    }, g.counters.broken_promises);
    try w.scalar(.{
        .name = "gossipsub_iwant_promise_sent_total",
        .kind = .counter,
        .help = "Randomly sampled IWANT batch promises armed when the request's send completed with its sample outstanding; local cancellation can remove one before it expires",
    }, g.recovery.armed);
    try w.enums(.{
        .name = "gossipsub_behaviour_penalties_total",
        .kind = .counter,
        .help = "Behaviour penalty units applied to peers by protocol violation",
        .labels = &.{"reason"},
    }, gossip.score.Penalty, &g.peers.scores.penalties);
    try g.overlay.mesh_changes.write(w);
    try g.delivery_metrics.write(w);
    const validation_time = try w.histograms(.{
        .name = "gossipsub_async_validation_delay_from_first_seen",
        .kind = .histogram,
        .help = "Seconds from native gossip admission until an applied validation verdict",
        .labels = &.{},
        .unit = .seconds,
    }, @TypeOf(g.validation_time));
    try validation_time.histogram(.{}, &g.validation_time);
    const eviction_age = try w.histograms(.{
        .name = "gossipsub_attribution_eviction_age_seconds",
        .kind = .histogram,
        .help = "Time since verdict for attribution records evicted for capacity before expiry",
        .unit = .seconds,
    }, @TypeOf(g.messages.validation.attribution_eviction_age));
    try eviction_age.histogram(.{}, &g.messages.validation.attribution_eviction_age);
}

pub fn writeScores(g: *const Gossipsub, now_ms: u64, w: *prom.Encoder) prom.Error!void {
    const ScorePopulations = @import("metrics.zig").ScorePopulations;
    const populations: ScorePopulations = .collect(&g.peers, g.overlay, g.sessions, now_ms);
    try populations.write(w);
}

pub fn writeMessages(g: *const Gossipsub, w: *prom.Encoder) prom.Error!void {
    inline for (.{
        .{ "gossipsub_msg_received_prevalidation_total", "received", "Decoded gossip messages consumed from peers by topic kind, including ignored, invalid, duplicate and storage-refused messages" },
        .{ "gossipsub_pre_validation_duplicate_total", "duplicate", "Received gossip messages already seen or awaiting validation by topic kind" },
        .{ "gossipsub_msg_publish_count_total", "published", "Local publications admitted to gossip history by topic kind, including those without recipients" },
        .{ "gossipsub_msg_publish_bytes_total", "published_bytes", "Compressed local publication payload bytes multiplied by successfully queued recipients, by topic kind" },
        .{ "gossipsub_accepted_messages_total", "accepted", "Applied accept verdicts by topic kind" },
        .{ "gossipsub_rejected_messages_total", "rejected", "Applied reject verdicts by topic kind" },
        .{ "gossipsub_ignored_messages_total", "ignored", "Applied ignore verdicts by topic kind" },
        .{ "gossipsub_msg_forward_count_total", "forwarded", "Accepted messages handed to forwarding by topic kind" },
    }) |metric| {
        const messages = try w.family(.{ .name = metric[0], .kind = .counter, .help = metric[2], .labels = &.{"topic"} });
        inline for (@typeInfo(gossip.topic_policy.Kind).@"enum".fields) |field| {
            try messages.sample(.{field.name}, @field(g.topic_metrics.counts[field.value], metric[1]));
        }
        try messages.sample(.{"unknown"}, @field(g.topic_metrics.counts[gossip.topic_policy.kind_count], metric[1]));
    }
}

pub fn writeQueueDrops(g: *const Gossipsub, w: *prom.Encoder) prom.Error!void {
    var drops = g.retired_queue_drops;
    for (g.sessions.rows) |*row| for (&drops, row.io.tx.drops) |*total, value| {
        total.* +|= value;
    };
    try w.enums(.{
        .name = "gossipsub_queue_drops_total",
        .kind = .counter,
        .help = "Gossip queue admissions refused by resource limit, including mesh control",
        .labels = &.{"reason"},
    }, outbox.DropReason, &drops);
}
