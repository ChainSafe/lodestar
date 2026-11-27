const std = @import("std");
const prom = @import("../metrics/registry.zig");
const peer_types = @import("types.zig");
const PeerManager = @import("../peer_manager.zig").PeerManager;
const Discovery = @import("discovery.zig").Discovery;
const Dialing = @import("dialing.zig").Dialing;
const Population = @import("population.zig").Population;
const Client = @import("client.zig").Client;
const control = @import("control.zig");
const discv5 = @import("discv5");

pub fn writePeers(manager: *const PeerManager, population: *const Population, w: *prom.Encoder) prom.Error!void {
    try w.scalar(.{
        .name = "libp2p_peers",
        .kind = .gauge,
        .help = "Authenticated connected peers",
    }, population.count);
    try w.scalar(.{
        .name = "lodestar_peers_relevant_count",
        .kind = .gauge,
        .help = "Peers with compatible Status",
    }, population.relevant);
    try w.scalar(.{
        .name = "lodestar_peers_below_target_bool",
        .kind = .gauge,
        .help = "Connected peers below target",
    }, @intFromBool(population.count < manager.catalog.options.target_peers));
    const directions = try w.family(.{
        .name = "lodestar_peers_by_direction_count",
        .kind = .gauge,
        .help = "Connected peers by direction",
        .labels = &.{"direction"},
    });
    for ([_][]const u8{ "inbound", "outbound" }, population.directionCounts()) |direction, count| try directions.sample(.{direction}, count);
    const clients = try w.family(.{
        .name = "lodestar_peers_by_client_count",
        .kind = .gauge,
        .help = "Connected peers by client",
        .labels = &.{"client"},
    });
    inline for (std.meta.fields(Client)) |field| try clients.sample(.{field.name}, population.clientCount(@enumFromInt(field.value)));
}

pub fn writePeerCloses(manager: *const PeerManager, w: *prom.Encoder) prom.Error!void {
    try w.enums(.{
        .name = "lodestar_peer_closes_total",
        .kind = .counter,
        .help = "Peer closes initiated by native peer control",
        .labels = &.{"reason"},
    }, peer_types.DisconnectReason, &manager.control.counters.closed);
    try w.enums(.{
        .name = "lodestar_peer_rejections_total",
        .kind = .counter,
        .help = "Remote rejections recorded against peer identities by kind: a received Goodbye, or a remote close of our dial or its refusal of our Status before the Status and Metadata exchange completed",
        .labels = &.{"kind"},
    }, peer_types.Rejection, &manager.catalog.rejections);
    try w.enums(.{
        .name = "lodestar_peer_health_failures_total",
        .kind = .counter,
        .help = "Failed Status, Metadata and Ping probes; a streak of failures disconnects at its limit and a refused probe at once",
        .labels = &.{"probe"},
    }, control.Control.HealthProbe, &manager.control.counters.health_failures);
}

pub fn writeRememberedPeers(manager: *const PeerManager, w: *prom.Encoder) prom.Error!void {
    const remembered = @import("remembered.zig");
    const memory = &manager.catalog.remembered;
    try w.scalar(.{
        .name = "lodestar_peer_remembered_count",
        .kind = .gauge,
        .help = "Remembered peers held for the host to persist",
    }, memory.count);
    try w.enums(.{
        .name = "lodestar_peer_remembered_seeds_total",
        .kind = .counter,
        .help = "Remembered peers passed at startup: loaded, or dropped as expired, duplicate or invalid",
        .labels = &.{"outcome"},
    }, remembered.Seed, &memory.counters.seeds);
    try w.enums(.{
        .name = "lodestar_peer_remembered_replays_total",
        .kind = .counter,
        .help = "Loaded remembered peers visited by replay: queued as a candidate, already connected or a candidate, refused by the identity's rejection memory or the endpoint's failure history, or without candidate room",
        .labels = &.{"outcome"},
    }, remembered.Replay, &memory.counters.replays);
    const funnel = try w.family(.{
        .name = "lodestar_peer_dial_funnel_total",
        .kind = .counter,
        .help = "Automatic dials by candidate origin, remembered or fresh from discovery, and stage: started, connected, and kept five minutes with a completed Status and Metadata exchange",
        .labels = &.{ "origin", "stage" },
    });
    inline for (std.meta.fields(remembered.Origin)) |origin| {
        inline for (std.meta.fields(remembered.Stage)) |stage| {
            try funnel.sample(.{ origin.name, stage.name }, memory.counters.funnel[origin.value][stage.value]);
        }
    }
}

pub fn writeDiscoveryProgress(manager: *const PeerManager, discovery_owner: ?*const Discovery, w: *prom.Encoder) prom.Error!void {
    try w.enums(.{ .name = "lodestar_peer_dial_selections_total", .kind = .counter, .help = "Selected peer connection attempts by initiating demand, including immediate errors and local start deferrals", .labels = &.{"source"} }, Dialing.Source, &manager.dialing.selected_attempts);
    try w.enums(.{ .name = "lodestar_peer_dial_outcomes_total", .kind = .counter, .help = "Finished connection attempts by outcome; closes before admission map the transport close reason", .labels = &.{"outcome"} }, peer_types.DialOutcome, &manager.dialing.outcomes);
    const times = try w.histograms(.{
        .name = "lodestar_peer_dial_time_seconds",
        .kind = .histogram,
        .help = "Selected connection attempts from selection to outcome, including local start deferrals; a connected attempt ends at connection admission, before Status and Metadata",
        .labels = &.{"outcome"},
        .unit = .seconds,
    }, Dialing.DialTime);
    inline for (std.meta.fields(peer_types.DialOutcome)) |field| try times.histogram(.{field.name}, &manager.dialing.durations[field.value]);
    try w.enums(.{ .name = "lodestar_peer_dial_retries_total", .kind = .counter, .help = "Redials of an endpoint by its previous failure", .labels = &.{"previous"} }, peer_types.DialFailure, &manager.dialing.retries);
    const discovery = discovery_owner orelse return;
    const lookup_finishes = try w.family(.{
        .name = "lodestar_discovery_lookup_finishes_total",
        .kind = .counter,
        .help = "Completed foreground discovery walks by finish reason; cancellations excluded",
        .labels = &.{"reason"},
    });
    inline for (@typeInfo(discv5.Lookup.FinishReason).@"enum".fields) |field| {
        if (comptime !std.mem.eql(u8, field.name, "cancelled"))
            try lookup_finishes.sample(.{field.name}, discovery.lookup_finishes[field.value]);
    }
}

pub fn writePeerEvents(manager: *const PeerManager, w: *prom.Encoder) prom.Error!void {
    try manager.control.counters.events.write(w);
}

pub fn writeDiscoveryCounters(manager: *const PeerManager, discovery_owner: ?*const Discovery, w: *prom.Encoder) prom.Error!void {
    const refused = try w.family(.{
        .name = "lodestar_peer_dial_recent_failures_refused_total",
        .kind = .counter,
        .help = "Discovered candidates refused because every endpoint recently failed, or because the identity recently rejected us, by that rejection",
        .labels = &.{"reason"},
    });
    const refusals = &manager.dialing.refused;
    try refused.sample(.{"endpoint"}, refusals.endpoint);
    inline for (std.meta.fields(peer_types.Rejection)) |field| try refused.sample(.{field.name}, refusals.identity[field.value]);
    const discovery_counts = if (discovery_owner) |d| d.counters else Discovery.Counters{};
    const rejections = if (discovery_owner) |d| d.rejections else @as([Discovery.rejection_count]u64, @splat(0));
    const datagram_rejections = if (discovery_owner) |d| d.datagram_rejections else @as([Discovery.datagram_rejection_count]u64, @splat(0));
    const queries = try w.family(.{ .name = "lodestar_discovery_find_node_query_requests_total", .kind = .counter, .help = "Foreground discovery queries started", .labels = &.{"action"} });
    try queries.sample(.{"start"}, discovery_counts.lookups_started);
    const query_time = try w.histograms(.{
        .name = "lodestar_discovery_find_node_query_time_seconds",
        .kind = .histogram,
        .help = "Foreground discovery lookup duration in seconds, excluding cancelled walks",
        .unit = .seconds,
    }, @TypeOf(discovery_counts.lookup_time));
    try query_time.histogram(.{}, &discovery_counts.lookup_time);
    try w.scalar(.{ .name = "lodestar_discovery_candidates_published_total", .kind = .counter, .help = "Authenticated discovery candidates handed to peer selection" }, discovery_counts.candidates_published);
    try w.enums(.{
        .name = "lodestar_discovery_candidate_rejections_total",
        .kind = .counter,
        .help = "Authenticated discovery candidates rejected by reason",
        .labels = &.{"reason"},
    }, Discovery.Rejection, &rejections);
    const rejected = try w.family(.{
        .name = "lodestar_discovery_datagram_rejections_total",
        .kind = .counter,
        .help = "Received discovery datagrams rejected by processing stage and reason",
        .labels = &.{ "stage", "reason" },
    });
    inline for (std.meta.fields(discv5.types.RejectReason)) |field| {
        try rejected.sample(.{ comptime rejectStage(@enumFromInt(field.value)), field.name }, datagram_rejections[field.value]);
    }
}

fn rejectStage(reason: discv5.types.RejectReason) []const u8 {
    return switch (reason) {
        .oversized_datagram => "receive",
        .admission_limited => "admission",
        .malformed_packet => "packet",
        .unexpected_handshake, .invalid_handshake, .unexpected_challenge => "handshake",
        .invalid_record, .record_admission_limited => "record",
        .malformed_message, .request_too_large => "message",
        .unsolicited_response, .invalid_response, .duplicate_response => "response",
    };
}
