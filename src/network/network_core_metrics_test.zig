const Gossipsub = @import("gossipsub/Gossipsub.zig");
const Now = @import("types.zig").Now;
const core_test = @import("network_core_test_support.zig");
const gossip_test = @import("gossipsub/test_support.zig");
const std = @import("std");
const NetworkCore = @import("network_core.zig").NetworkCore;
const metrics = @import("metrics/export.zig");
const policy = @import("gossipsub/topic_policy.zig");
const protocol = @import("reqresp/root.zig").Protocol;
const AdmissionRefusal = @import("reqresp/metrics.zig").AdmissionRefusal;
const ErrorReason = @import("reqresp/metrics.zig").ErrorReason;
const KeyPair = @import("wire/keys.zig").KeyPair;
const logging = @import("logging.zig");
const types = @import("peers/types.zig");
const topic_mod = @import("gossipsub/topic.zig");
const Sockets = @import("udp").Sockets;
const score = @import("gossipsub/score.zig");
const topic_fixture = @import("gossipsub/topic_fixture.zig");
const test_support = @import("quic/test_support.zig");
const time = @import("time.zig");
const Dialing = @import("peers/dialing.zig").Dialing;

const Fixture = struct {
    node: *NetworkCore,
    buffer: []u8,

    fn init(boundaries: []const policy.Boundary) !Fixture {
        return initWith(boundaries, null);
    }

    fn initWith(boundaries: []const policy.Boundary, discovery: ?NetworkCore.DiscoveryOptions) !Fixture {
        const node = try std.testing.allocator.create(NetworkCore);
        errdefer std.testing.allocator.destroy(node);
        const key = try KeyPair.fromSecretKey(&(.{0} ** 31 ++ .{93}));
        var options = core_test.networkOptions(&key);
        if (boundaries.len > 0) options.resolved.core.protocols.gossipsub.topic_policy = boundaries;
        options.startup.discovery = discovery;
        try node.init(std.testing.allocator, std.testing.io, &options.resolved, options.startup);
        errdefer node.deinit(std.testing.io);
        const buffer = try std.testing.allocator.alloc(u8, metrics.textCapacity(boundaries));
        return .{ .node = node, .buffer = buffer };
    }

    fn deinit(self: *Fixture) void {
        std.testing.allocator.free(self.buffer);
        self.node.deinit(std.testing.io);
        std.testing.allocator.destroy(self.node);
    }

    fn render(self: *Fixture) ![]const u8 {
        var context = metrics.Context.init(self.node, Now.fromMilliseconds(.{ .mono_ms = 2500, .unix_s = 123456 }));
        context.expired_executing = 3;
        var writer = std.Io.Writer.fixed(self.buffer);
        try metrics.write(&context, &writer);
        var encoder: metrics.registry.Encoder = .{ .writer = &writer };
        const logs: logging.Stats = .{};
        try logs.write(&encoder);
        return writer.buffered();
    }
};

fn contains(text: []const u8, expected: []const u8) !void {
    try std.testing.expect(std.mem.find(u8, text, expected) != null);
}

const Series = struct {
    name: []const u8,
    kind: []const u8,
    labels: []const []const u8 = &.{},
};

/// Metric families and label names exposed by the network owner.
const contract = [_]Series{
    // Peers
    .{ .name = "libp2p_peers", .kind = "gauge" },
    .{ .name = "lodestar_peers_relevant_count", .kind = "gauge" },
    .{ .name = "lodestar_peers_below_target_bool", .kind = "gauge" },
    .{ .name = "lodestar_peers_by_direction_count", .kind = "gauge", .labels = &.{"direction"} },
    .{ .name = "lodestar_peers_by_client_count", .kind = "gauge", .labels = &.{"client"} },
    .{ .name = "lodestar_peer_connection_seconds", .kind = "histogram" },
    .{ .name = "lodestar_peer_long_lived_attnets_count", .kind = "histogram" },
    .{ .name = "lodestar_peer_column_group_count", .kind = "histogram" },
    .{ .name = "lodestar_app_peer_score", .kind = "histogram", .labels = &.{"client"} },
    .{ .name = "lodestar_gossip_score_by_client", .kind = "histogram", .labels = &.{"client"} },
    .{ .name = "lodestar_gossip_mesh_peers_by_client_count", .kind = "gauge", .labels = &.{"client"} },
    .{ .name = "lodestar_peer_connected_total", .kind = "counter", .labels = &.{ "direction", "status" } },
    .{ .name = "lodestar_peer_goodbye_received_total", .kind = "counter", .labels = &.{"reason"} },
    .{ .name = "lodestar_peer_closes_total", .kind = "counter", .labels = &.{"reason"} },
    .{ .name = "lodestar_peer_health_failures_total", .kind = "counter", .labels = &.{"probe"} },
    .{ .name = "lodestar_peer_rejections_total", .kind = "counter", .labels = &.{"kind"} },
    .{ .name = "lodestar_peer_dial_selections_total", .kind = "counter", .labels = &.{"source"} },
    .{ .name = "lodestar_peer_dial_outcomes_total", .kind = "counter", .labels = &.{"outcome"} },
    .{ .name = "lodestar_peer_dial_time_seconds", .kind = "histogram", .labels = &.{"outcome"} },
    .{ .name = "lodestar_peer_dial_retries_total", .kind = "counter", .labels = &.{"previous"} },
    .{ .name = "lodestar_peer_dial_recent_failures_refused_total", .kind = "counter", .labels = &.{"reason"} },
    .{ .name = "lodestar_peer_dial_funnel_total", .kind = "counter", .labels = &.{ "origin", "stage" } },
    .{ .name = "lodestar_peer_remembered_count", .kind = "gauge" },
    .{ .name = "lodestar_peer_remembered_seeds_total", .kind = "counter", .labels = &.{"outcome"} },
    .{ .name = "lodestar_peer_remembered_replays_total", .kind = "counter", .labels = &.{"outcome"} },
    .{ .name = "lodestar_peer_outbound_deficit_count", .kind = "gauge" },
    .{ .name = "lodestar_discovery_subnet_peers_to_connect", .kind = "gauge", .labels = &.{"type"} },
    .{ .name = "lodestar_discovery_custody_group_peers_to_connect", .kind = "gauge" },
    .{ .name = "lodestar_peer_count_per_sampling_group", .kind = "gauge", .labels = &.{"groupIndex"} },
    // Discovery
    .{ .name = "lodestar_discv5_kad_table_size", .kind = "gauge" },
    .{ .name = "lodestar_discv5_active_session_count", .kind = "gauge" },
    .{ .name = "lodestar_discovery_find_node_query_requests_total", .kind = "counter", .labels = &.{"action"} },
    .{ .name = "lodestar_discovery_find_node_query_time_seconds", .kind = "histogram" },
    .{ .name = "lodestar_discovery_lookup_finishes_total", .kind = "counter", .labels = &.{"reason"} },
    .{ .name = "lodestar_discovery_candidates_published_total", .kind = "counter" },
    .{ .name = "lodestar_discovery_candidate_rejections_total", .kind = "counter", .labels = &.{"reason"} },
    .{ .name = "lodestar_discovery_datagram_rejections_total", .kind = "counter", .labels = &.{ "stage", "reason" } },
    // Gossip
    .{ .name = "gossipsub_rpc_recv_bytes_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_recv_count_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_recv_subscription_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_recv_message_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_recv_control_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_recv_ihave_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_recv_iwant_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_recv_graft_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_recv_prune_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_recv_idontwant_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_sent_bytes_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_sent_count_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_sent_subscription_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_sent_message_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_sent_control_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_sent_ihave_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_sent_iwant_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_sent_graft_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_sent_prune_total", .kind = "counter" },
    .{ .name = "gossipsub_rpc_sent_idontwant_total", .kind = "counter" },
    .{ .name = "gossipsub_mesh_peer_count", .kind = "gauge", .labels = &.{"topicStr"} },
    .{ .name = "gossipsub_topic_peer_count", .kind = "gauge", .labels = &.{"topicStr"} },
    .{ .name = "lodestar_gossip_mesh_peers_by_type_count", .kind = "gauge", .labels = &.{ "type", "boundary" } },
    .{ .name = "lodestar_gossip_mesh_peers_by_beacon_attestation_subnet_count", .kind = "gauge", .labels = &.{ "subnet", "boundary" } },
    .{ .name = "lodestar_gossip_mesh_peers_by_sync_committee_subnet_count", .kind = "gauge", .labels = &.{ "subnet", "boundary" } },
    .{ .name = "lodestar_gossip_mesh_peers_by_data_column_subnet_count", .kind = "gauge", .labels = &.{ "subnet", "boundary" } },
    .{ .name = "lodestar_gossip_topic_peers_by_type_count", .kind = "gauge", .labels = &.{ "type", "boundary" } },
    .{ .name = "lodestar_gossip_topic_peers_by_beacon_attestation_subnet_count", .kind = "gauge", .labels = &.{ "subnet", "boundary" } },
    .{ .name = "lodestar_gossip_topic_peers_by_sync_committee_subnet_count", .kind = "gauge", .labels = &.{ "subnet", "boundary" } },
    .{ .name = "lodestar_gossip_topic_peers_by_data_column_subnet_count", .kind = "gauge", .labels = &.{ "subnet", "boundary" } },
    .{ .name = "gossipsub_topic_subscription_status", .kind = "gauge", .labels = &.{"topicStr"} },
    .{ .name = "gossipsub_accepted_messages_total", .kind = "counter", .labels = &.{"topic"} },
    .{ .name = "gossipsub_rejected_messages_total", .kind = "counter", .labels = &.{"topic"} },
    .{ .name = "gossipsub_ignored_messages_total", .kind = "counter", .labels = &.{"topic"} },
    .{ .name = "gossipsub_msg_forward_count_total", .kind = "counter", .labels = &.{"topic"} },
    .{ .name = "gossipsub_data_recipients_total", .kind = "counter", .labels = &.{ "origin", "outcome" } },
    .{ .name = "gossipsub_queue_drops_total", .kind = "counter", .labels = &.{"reason"} },
    .{ .name = "gossipsub_ihave_budget_skipped_total", .kind = "counter" },
    .{ .name = "gossipsub_retention_refusals_total", .kind = "counter", .labels = &.{"topic"} },
    .{ .name = "gossipsub_iwant_rcv_dont_have_msgids_total", .kind = "counter" },
    .{ .name = "gossipsub_iwant_known_msgids_total", .kind = "counter", .labels = &.{"outcome"} },
    .{ .name = "gossipsub_iwant_promise_broken", .kind = "counter" },
    .{ .name = "gossipsub_iwant_promise_sent_total", .kind = "counter" },
    .{ .name = "gossipsub_msg_received_prevalidation_total", .kind = "counter", .labels = &.{"topic"} },
    .{ .name = "gossipsub_pre_validation_duplicate_total", .kind = "counter", .labels = &.{"topic"} },
    .{ .name = "gossipsub_msg_publish_count_total", .kind = "counter", .labels = &.{"topic"} },
    .{ .name = "gossipsub_msg_publish_bytes_total", .kind = "counter", .labels = &.{"topic"} },
    .{ .name = "gossipsub_mesh_changes_total", .kind = "counter", .labels = &.{ "topic", "event", "reason" } },
    .{ .name = "gossipsub_receive_discards_total", .kind = "counter", .labels = &.{"reason"} },
    .{ .name = "gossipsub_behaviour_penalties_total", .kind = "counter", .labels = &.{"reason"} },
    .{ .name = "lodestar_gossip_peer_score_by_threshold_count", .kind = "gauge", .labels = &.{"threshold"} },
    .{ .name = "lodestar_gossip_score_avg_min_max_sum", .kind = "gauge" },
    .{ .name = "lodestar_gossip_score_avg_min_max_avg", .kind = "gauge" },
    .{ .name = "lodestar_gossip_score_avg_min_max_min", .kind = "gauge" },
    .{ .name = "lodestar_gossip_score_avg_min_max_max", .kind = "gauge" },
    .{ .name = "lodestar_gossip_mesh_peer_score_by_threshold_count", .kind = "gauge", .labels = &.{"threshold"} },
    .{ .name = "lodestar_gossip_mesh_score_avg_min_max_sum", .kind = "gauge" },
    .{ .name = "lodestar_gossip_mesh_score_avg_min_max_avg", .kind = "gauge" },
    .{ .name = "lodestar_gossip_mesh_score_avg_min_max_min", .kind = "gauge" },
    .{ .name = "lodestar_gossip_mesh_score_avg_min_max_max", .kind = "gauge" },
    // Gossip processor
    .{ .name = "lodestar_awaiting_block_gossip_messages_per_slot_total", .kind = "gauge" },
    .{ .name = "lodestar_gossip_validation_queue_length", .kind = "gauge", .labels = &.{"topic"} },
    .{ .name = "lodestar_gossip_validation_waiting_block_count", .kind = "gauge", .labels = &.{"topic"} },
    .{ .name = "lodestar_gossip_validation_dependency_checks_count", .kind = "gauge", .labels = &.{"topic"} },
    .{ .name = "lodestar_gossip_validation_queue_concurrency", .kind = "gauge", .labels = &.{"topic"} },
    .{ .name = "lodestar_gossip_validation_concurrency_limit", .kind = "gauge", .labels = &.{"topic"} },
    .{ .name = "lodestar_gossip_validation_execution_limit_bytes", .kind = "gauge", .labels = &.{"topic"} },
    .{ .name = "lodestar_gossip_validation_refusals_total", .kind = "counter", .labels = &.{ "topic", "reason" } },
    .{ .name = "lodestar_gossip_validation_expired_executing_count", .kind = "gauge" },
    .{ .name = "gossipsub_async_validation_delay_from_first_seen", .kind = "histogram" },
    // ReqResp
    .{ .name = "beacon_reqresp_incoming_requests_total", .kind = "counter", .labels = &.{"method"} },
    .{ .name = "beacon_reqresp_incoming_requests_error_total", .kind = "counter", .labels = &.{"method"} },
    .{ .name = "beacon_reqresp_incoming_request_handler_time_seconds", .kind = "histogram", .labels = &.{"method"} },
    .{ .name = "beacon_reqresp_outgoing_requests_total", .kind = "counter", .labels = &.{"method"} },
    .{ .name = "beacon_reqresp_outgoing_opened_streams_total", .kind = "counter", .labels = &.{"method"} },
    .{ .name = "beacon_reqresp_outgoing_closed_streams_total", .kind = "counter", .labels = &.{"method"} },
    .{ .name = "beacon_reqresp_incoming_opened_streams_total", .kind = "counter", .labels = &.{"method"} },
    .{ .name = "beacon_reqresp_incoming_closed_streams_total", .kind = "counter", .labels = &.{"method"} },
    .{ .name = "beacon_reqresp_dial_errors_total", .kind = "counter" },
    .{ .name = "beacon_reqresp_outgoing_requests_error_total", .kind = "counter", .labels = &.{"method"} },
    .{ .name = "beacon_reqresp_outgoing_requests_error_reason_total", .kind = "counter", .labels = &.{"reason"} },
    .{ .name = "beacon_reqresp_outgoing_request_roundtrip_time_seconds", .kind = "histogram", .labels = &.{"method"} },
    .{ .name = "beacon_reqresp_serving_count", .kind = "gauge" },
    .{ .name = "beacon_reqresp_serving_capacity_count", .kind = "gauge" },
    .{ .name = "beacon_reqresp_retiring_count", .kind = "gauge" },
    .{ .name = "beacon_reqresp_incoming_count", .kind = "gauge", .labels = &.{"phase"} },
    .{ .name = "beacon_reqresp_rate_limiter_errors_total", .kind = "counter", .labels = &.{"method"} },
    .{ .name = "beacon_reqresp_admission_refusals_total", .kind = "counter", .labels = &.{ "method", "reason" } },
    .{ .name = "gossipsub_send_queue_seconds", .kind = "histogram", .labels = &.{"kind"} },
    .{ .name = "gossipsub_pump_budget_exhausted_total", .kind = "counter", .labels = &.{"budget"} },
    .{ .name = "gossipsub_stream_write_total", .kind = "counter" },
    .{ .name = "gossipsub_stream_write_blocked_total", .kind = "counter" },
    .{ .name = "lodestar_quic_sent_packets_total", .kind = "counter" },
    .{ .name = "lodestar_quic_lost_packets_total", .kind = "counter" },
    .{ .name = "lodestar_quic_retransmitted_stream_bytes_total", .kind = "counter" },
    .{ .name = "lodestar_quic_flow_control_blocked_frames_total", .kind = "counter", .labels = &.{ "direction", "scope" } },
    .{ .name = "lodestar_quic_active_path_count", .kind = "gauge" },
    .{ .name = "lodestar_quic_unsampled_connection_count", .kind = "gauge" },
    .{ .name = "lodestar_quic_congestion_window_bytes", .kind = "gauge", .labels = &.{"stat"} },
    .{ .name = "lodestar_quic_rtt_seconds", .kind = "gauge", .labels = &.{"stat"} },
    .{ .name = "lodestar_quic_receive_turns_total", .kind = "counter" },
    .{ .name = "lodestar_quic_receive_budget_exhausted_total", .kind = "counter" },
    .{ .name = "lodestar_quic_receive_datagrams_per_turn", .kind = "gauge" },
    .{ .name = "lodestar_quic_initial_congestion_window_packets", .kind = "gauge" },
    .{ .name = "lodestar_quic_receive_window_bytes", .kind = "gauge", .labels = &.{"scope"} },
    // Transport and UDP
    .{ .name = "lodestar_quic_connections_established_total", .kind = "counter", .labels = &.{"direction"} },
    .{ .name = "lodestar_quic_connections_closed_total", .kind = "counter", .labels = &.{ "direction", "reason" } },
    .{ .name = "lodestar_quic_connection_slots_count", .kind = "gauge" },
    .{ .name = "lodestar_quic_connections_handshaking_count", .kind = "gauge" },
    .{ .name = "lodestar_quic_udp_received_bytes_total", .kind = "counter" },
    .{ .name = "lodestar_quic_udp_sent_bytes_total", .kind = "counter" },
    .{ .name = "lodestar_quic_udp_received_datagrams_total", .kind = "counter" },
    .{ .name = "lodestar_quic_udp_sent_datagrams_total", .kind = "counter" },
    .{ .name = "lodestar_udp_send_dropped_datagrams_total", .kind = "counter", .labels = &.{ "role", "reason" } },
    .{ .name = "lodestar_udp_send_dropped_bytes_total", .kind = "counter", .labels = &.{ "role", "reason" } },
    .{ .name = "lodestar_udp_socket_drops_total", .kind = "counter", .labels = &.{ "role", "family" } },
    .{ .name = "lodestar_udp_socket_buffer_bytes", .kind = "gauge", .labels = &.{ "role", "family", "direction" } },
    // Owner and resources
    .{ .name = "lodestar_network_step_seconds", .kind = "histogram" },
    .{ .name = "lodestar_network_turn_phase_seconds", .kind = "histogram", .labels = &.{"phase"} },
    .{ .name = "lodestar_network_transport_failures_total", .kind = "counter" },
    .{ .name = "lodestar_network_readiness_failures_total", .kind = "counter" },
    .{ .name = "lodestar_network_logs_dropped_total", .kind = "counter", .labels = &.{ "kind", "level", "scope" } },
    .{ .name = "gossipsub_storage_refusals_total", .kind = "counter", .labels = &.{"reason"} },
    .{ .name = "gossipsub_mcache_not_validated_count", .kind = "gauge" },
    .{ .name = "gossipsub_validation_capacity_count", .kind = "gauge" },
    .{ .name = "gossipsub_attribution_capacity_count", .kind = "gauge" },
    .{ .name = "gossipsub_attribution_resolved_count", .kind = "gauge" },
    .{ .name = "gossipsub_attribution_eviction_age_seconds", .kind = "histogram" },
    .{ .name = "gossipsub_queued_bytes", .kind = "gauge" },
    .{ .name = "gossipsub_delivery_descriptors_available_count", .kind = "gauge" },
    .{ .name = "gossipsub_delivery_descriptors_capacity_count", .kind = "gauge" },
    .{ .name = "gossipsub_receive_pages_count", .kind = "gauge" },
    .{ .name = "gossipsub_receive_pages_capacity_count", .kind = "gauge" },
    .{ .name = "gossipsub_store_pages_count", .kind = "gauge" },
};

fn hasSeries(output: []const u8, series: Series) bool {
    var buffer: [256]u8 = undefined;
    const type_line = std.fmt.bufPrint(&buffer, "# TYPE {s} {s}\n", .{ series.name, series.kind }) catch return false;
    if (std.mem.find(u8, output, type_line) == null) return false;
    const labels = sampleLabels(output, series.name, std.mem.eql(u8, series.kind, "histogram")) orelse return false;
    for (series.labels) |label| if (!hasLabel(labels, label)) return false;
    return true;
}

fn sampleLabels(output: []const u8, name: []const u8, histogram: bool) ?[]const u8 {
    const suffix = if (histogram) "_bucket" else "";
    var lines = std.mem.splitScalar(u8, output, '\n');
    while (lines.next()) |line| {
        if (!std.mem.startsWith(u8, line, name)) continue;
        const rest = line[name.len..];
        if (!std.mem.startsWith(u8, rest, suffix)) continue;
        const after = rest[suffix.len..];
        if (std.mem.startsWith(u8, after, " ")) return "";
        if (std.mem.startsWith(u8, after, "{")) return after[0 .. std.mem.findScalar(u8, after, '}') orelse after.len];
    }
    return null;
}

fn hasLabel(labels: []const u8, label: []const u8) bool {
    var start: usize = 0;
    while (std.mem.findPos(u8, labels, start, label)) |at| {
        const opens = at > 0 and (labels[at - 1] == '{' or labels[at - 1] == ',');
        if (opens and std.mem.startsWith(u8, labels[at + label.len ..], "=\"")) return true;
        start = at + 1;
    }
    return false;
}

fn boundary(digest: [4]u8, epoch: u64) policy.Boundary {
    var value = topic_fixture.full(digest);
    value.fork = .fulu;
    value.epoch = epoch;
    return value;
}

test "metrics read owner counters exactly without consuming them" {
    var f = try Fixture.init(&.{});
    defer f.deinit();
    const node = f.node;
    node.counters.transport_failures = std.math.maxInt(u64);
    node.peer_manager.control.counters.closed[0] = 17;
    node.protocols.control_reqresp.protocol_counters[@intFromEnum(protocol.status_v1)].outgoing = 4;
    node.protocols.control_reqresp.protocol_counters[@intFromEnum(protocol.status_v2)].outgoing = 5;
    node.protocols.control_reqresp.protocol_counters[@intFromEnum(protocol.status_v1)].outgoing_opened = 3;
    node.protocols.control_reqresp.protocol_counters[@intFromEnum(protocol.status_v2)].outgoing_opened = 4;
    node.protocols.control_reqresp.protocol_counters[@intFromEnum(protocol.status_v1)].outgoing_closed = 2;
    node.protocols.control_reqresp.protocol_counters[@intFromEnum(protocol.status_v2)].outgoing_closed = 1;
    node.protocols.reqresp.outgoing_error_reasons[@intFromEnum(ErrorReason.REQUEST_ERROR_DIAL_ERROR)] = 2;
    node.protocols.control_reqresp.outgoing_error_reasons[@intFromEnum(ErrorReason.REQUEST_ERROR_DIAL_TIMEOUT)] = 3;
    node.protocols.control_reqresp.protocol_counters[@intFromEnum(protocol.status_v1)].admission_refusals[@intFromEnum(AdmissionRefusal.peer_quota)] = 2;
    node.protocols.control_reqresp.protocol_counters[@intFromEnum(protocol.status_v2)].admission_refusals[@intFromEnum(AdmissionRefusal.global_quota)] = 3;
    node.protocols.control_reqresp.protocol_counters[@intFromEnum(protocol.status_v2)].admission_refusals[@intFromEnum(AdmissionRefusal.connection_capacity)] = 7;
    node.protocols.control_reqresp.protocol_counters[@intFromEnum(protocol.status_v1)].outgoing_time.observe(100);
    node.protocols.control_reqresp.protocol_counters[@intFromEnum(protocol.status_v2)].outgoing_time.observe(200);
    node.protocols.reqresp.protocol_counters[@intFromEnum(protocol.blocks_by_range_v2)].outgoing = 6;
    node.protocols.gossipsub.messages.storage_refusals[0] = 11;
    node.peer_manager.selection.deficits.outbound = 7;
    const original = node.peer_manager.counters;
    const output = try f.render();
    try contains(output, "lodestar_network_transport_failures_total 18446744073709551615\n");
    const closed = @tagName(@as(types.DisconnectReason, @enumFromInt(0)));
    var line: [128]u8 = undefined;
    const closes = try std.fmt.bufPrint(&line, "lodestar_peer_closes_total{{reason=\"{s}\"}} 17\n", .{closed});
    try contains(output, closes);
    try contains(output, "lodestar_peer_outbound_deficit_count 7\n");
    try contains(output, "beacon_reqresp_outgoing_requests_total{method=\"status\"} 9\n");
    try contains(output, "beacon_reqresp_outgoing_opened_streams_total{method=\"status\"} 7\n");
    try contains(output, "beacon_reqresp_outgoing_closed_streams_total{method=\"status\"} 3\n");
    try contains(output, "beacon_reqresp_dial_errors_total 5\n");
    try contains(output, "beacon_reqresp_outgoing_requests_total{method=\"beacon_blocks_by_range\"} 6\n");
    try contains(output, "beacon_reqresp_rate_limiter_errors_total{method=\"status\"} 5\n");
    try contains(output, "beacon_reqresp_admission_refusals_total{method=\"status\",reason=\"connection_capacity\"} 7\n");
    try contains(output, "beacon_reqresp_outgoing_request_roundtrip_time_seconds_count{method=\"status\"} 2\n");
    try contains(output, "lodestar_gossip_validation_expired_executing_count 3\n");
    try std.testing.expect(std.mem.find(u8, output, "lodestar_peer_manager_starved_bool") == null);
    try std.testing.expect(std.mem.find(u8, output, "lodestar_discovery_total_dial_attempts") == null);
    try std.testing.expect(std.mem.find(u8, output, "_total_total") == null);
    _ = try f.render();
    try std.testing.expectEqualDeep(original, node.peer_manager.counters);
}

test "metrics include remote subscriptions on inactive topics and follow local fork boundary visibility" {
    var f = try Fixture.init(&.{ boundary(@splat(0), 100), boundary(@splat(1), 200) });
    defer f.deinit();
    const g = f.node.protocols.gossipsub;
    const peer = gossip_test.addPeer(g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const context = g.overlayContext(g.last_now_ms);
    const name = "/eth2/00000000/data_column_sidecar_9/ssz_snappy";
    _ = g.overlay.peerSubscription(&context, peer.index, name, true);
    _ = g.overlay.peerSubscription(&context, peer.index, name, true);
    try std.testing.expect(g.overlay.findTopic(name) == null);
    try std.testing.expectEqual(@as(usize, 1), g.resourceSnapshot().remote_subscriptions);
    var output = try f.render();
    try contains(output, "lodestar_gossip_topic_peers_by_data_column_subnet_count{subnet=\"9\",boundary=\"fulu_100\"} 1\n");
    try contains(output, "lodestar_gossip_mesh_peers_by_data_column_subnet_count{subnet=\"9\",boundary=\"fulu_100\"} 0\n");
    try contains(output, "gossipsub_topic_subscription_status{topicStr=\"/eth2/00000000/data_column_sidecar_9/ssz_snappy\"} 0\n");
    try contains(output, "lodestar_gossip_topic_peers_by_beacon_attestation_subnet_count{subnet=\"00\",boundary=\"fulu_100\"} 0\n");
    try std.testing.expect(std.mem.find(u8, output, "fulu_200") == null);
    const future = "/eth2/01010101/beacon_block/ssz_snappy";
    try gossip_test.subscribe(g, future);
    output = try f.render();
    try contains(output, "lodestar_gossip_mesh_peers_by_type_count{type=\"beacon_block\",boundary=\"fulu_200\"} 0\n");
    try contains(output, "gossipsub_topic_subscription_status{topicStr=\"/eth2/01010101/beacon_block/ssz_snappy\"} 1\n");
    try gossip_test.unsubscribe(g, future);
    output = try f.render();
    try std.testing.expect(std.mem.find(u8, output, "fulu_200") == null);
    const connection = g.sessions.rows[peer.index].conn;
    g.connectionClosed(connection);
    g.connectionClosed(connection);
    output = try f.render();
    try contains(output, "lodestar_gossip_topic_peers_by_data_column_subnet_count{subnet=\"9\",boundary=\"fulu_100\"} 0\n");
    try std.testing.expectEqual(@as(usize, 0), g.resourceSnapshot().remote_subscriptions);
}

test "metrics maximum configured topic domain fits its startup exposition reservation" {
    var boundaries: [policy.boundary_max]policy.Boundary = undefined;
    for (&boundaries, 0..) |*value, index| value.* = boundary(.{ @intCast(index), 0, 0, 0 }, std.math.maxInt(u64) - index);
    var f = try Fixture.init(&boundaries);
    defer f.deinit();
    const g = f.node.protocols.gossipsub;
    for (boundaries) |value| {
        var name: [topic_mod.topic_max_len]u8 = undefined;
        try gossip_test.subscribe(g, topic_mod.build(value.digest, "beacon_block", &name));
    }
    const output = try f.render();
    try std.testing.expect(output.len < f.buffer.len);
    try std.testing.expectEqual(@as(usize, 64 * 128), std.mem.count(u8, output, "lodestar_gossip_topic_peers_by_data_column_subnet_count{subnet="));
    try contains(output, "boundary=\"fulu_18446744073709551615\"");
}

test "metrics preserve outgoing queue refusals across session retirement and reuse" {
    var f = try Fixture.init(&.{});
    defer f.deinit();
    const g = f.node.protocols.gossipsub;
    const first = gossip_test.addPeer(g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    g.counters.ihave_budget_skipped = 7;
    g.sessions.rows[first.index].io.tx.drops[0] = 3;
    try contains(try f.render(), "gossipsub_queue_drops_total{reason=\"data_descriptors\"} 3\n");
    const conn = g.sessions.rows[first.index].conn;
    g.connectionClosed(conn);
    g.connectionClosed(conn);
    try contains(try f.render(), "gossipsub_queue_drops_total{reason=\"data_descriptors\"} 3\n");
    const next = gossip_test.addPeer(g, .{ .index = 0, .generation = 2 }, .v1_2).?;
    try std.testing.expectEqual(first.index, next.index);
    g.sessions.rows[next.index].io.tx.drops[0] = 2;
    try contains(try f.render(), "gossipsub_queue_drops_total{reason=\"data_descriptors\"} 5\n");
    g.connectionClosed(g.sessions.rows[next.index].conn);
    try contains(try f.render(), "gossipsub_queue_drops_total{reason=\"data_descriptors\"} 5\n");
    try contains(try f.render(), "gossipsub_ihave_budget_skipped_total 7\n");
}

test "metrics distinguish gossip kind allowances from recipient queue capacity" {
    var f = try Fixture.init(&.{});
    defer f.deinit();
    const g = f.node.protocols.gossipsub;
    const peer = gossip_test.addPeer(g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    _ = try g.publish("/eth2/00000000/beacon_block/ssz_snappy", "payload", now);
    const message = g.messages.history.message(g.messages.history.head);
    const tx = &g.sessions.rows[peer.index].io.tx;
    const limits = Gossipsub.delivery_limits;
    g.sessions.deliveries.kind_limits = @splat(.{ .items = 1, .bytes = 8192 });
    try std.testing.expectEqual(.queued, tx.queueData(&g.messages.store, message, .forward, limits, 1));
    try std.testing.expectEqual(.full, tx.queueData(&g.messages.store, message, .iwant, limits, 1));
    tx.data.reset();
    g.sessions.deliveries.kind_limits = @splat(.{ .items = 8, .bytes = 1 });
    try std.testing.expectEqual(.queued, tx.queueData(&g.messages.store, message, .forward, limits, 1));
    try std.testing.expectEqual(.full, tx.queueData(&g.messages.store, message, .iwant, limits, 1));
    try std.testing.expectEqual(.queued, tx.queueData(&g.messages.store, message, .publication, limits, 1));
    const before = try f.render();
    try contains(before, "gossipsub_queue_drops_total{reason=\"data_kind_descriptors\"} 1\n");
    try contains(before, "gossipsub_queue_drops_total{reason=\"data_kind_bytes\"} 1\n");
    try contains(before, "gossipsub_queue_drops_total{reason=\"data_descriptors\"} 0\n");
    try contains(before, "gossipsub_queue_drops_total{reason=\"data_bytes\"} 0\n");
    g.connectionClosed(g.sessions.rows[peer.index].conn);
    const after = try f.render();
    try contains(after, "gossipsub_queue_drops_total{reason=\"data_kind_descriptors\"} 1\n");
    try contains(after, "gossipsub_queue_drops_total{reason=\"data_kind_bytes\"} 1\n");
}

test "metrics preserve gossip RPC admissions through cancellation retirement and slot reuse" {
    var f = try Fixture.init(&.{});
    defer f.deinit();
    const g = f.node.protocols.gossipsub;
    g.rpc_received.record(123, &.{ .subscription = 2, .message = 3, .control = 1, .ihave = 4, .iwant = 5, .graft = 6, .prune = 7, .idontwant = 8 });
    const peer = gossip_test.addPeer(g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    try std.testing.expect(g.sessions.rows[peer.index].io.tx.submit(&.{ .graft = "t" }, &g.sessions.control_scratch, 1) != null);
    for (0..3) |stage| {
        const output = try f.render();
        try contains(output, "gossipsub_rpc_recv_bytes_total 123\n");
        try contains(output, "gossipsub_rpc_recv_count_total 1\n");
        inline for (.{ "subscription", "message", "ihave", "iwant", "graft", "prune", "idontwant" }, 2..) |field, count| {
            try contains(output, "gossipsub_rpc_recv_" ++ field ++ "_total " ++ std.fmt.comptimePrint("{d}\n", .{count}));
        }
        try contains(output, "gossipsub_rpc_recv_control_total 1\n");
        try contains(output, "gossipsub_rpc_sent_count_total 1\n");
        try contains(output, "gossipsub_rpc_sent_bytes_total 7\n");
        try contains(output, "gossipsub_rpc_sent_graft_total 1\n");
        try contains(output, "gossipsub_rpc_sent_control_total 1\n");
        if (stage == 0) g.cancelWrites(peer);
        if (stage == 1) g.connectionClosed(g.sessions.rows[peer.index].conn);
    }
    const reused = gossip_test.addPeer(g, .{ .index = 0, .generation = 2 }, .v1_2).?;
    try std.testing.expectEqual(peer.index, reused.index);
    try std.testing.expect(g.sessions.rows[reused.index].io.tx.submit(&.{ .graft = "t" }, &g.sessions.control_scratch, 2) != null);
    try contains(try f.render(), "gossipsub_rpc_sent_count_total 2\n");
    try contains(try f.render(), "gossipsub_rpc_sent_bytes_total 14\n");
    try contains(try f.render(), "gossipsub_rpc_sent_graft_total 2\n");
}

test "metrics render retained usable coverage" {
    var f = try Fixture.init(&.{});
    defer f.deinit();
    const manager = &f.node.peer_manager;
    manager.local.fork.custody_groups = 128;
    manager.demand = .{ .attnets = 3, .syncnets = 1, .attestation_target = 2, .sync_target = 1 };
    manager.demand.group_targets[0] = 2;
    const selection = @import("peers/policy.zig");
    var inputs = [_]selection.Input{ .{ .coverage = .{ .attnets = 1, .syncnets = 1 }, .outbound = true }, .{ .coverage = .{ .attnets = 3 }, .reject = .banned } };
    inputs[0].coverage.groups.set(0);
    manager.selection = selection.select(&inputs, &manager.demand, .{ .target_peers = 8, .max_peers = 12 }, 0);
    const output = try f.render();
    try contains(output, "lodestar_peer_count_per_sampling_group{groupIndex=\"0\"} 1\n");
    try contains(output, "lodestar_peer_count_per_sampling_group{groupIndex=\"127\"} 0\n");
    try contains(output, "lodestar_discovery_subnet_peers_to_connect{type=\"attnets\"} 3\n");
    try contains(try f.render(), "lodestar_discovery_subnet_peers_to_connect{type=\"attnets\"} 3\n");
}

test "metrics follow demand replacement" {
    var f = try Fixture.init(&.{});
    defer f.deinit();
    const demand: types.Demand = .{ .attnets = 3, .attestation_target = 2 };
    try core_test.updateDemand(f.node, &demand, f.node.last_now);
    var result = f.node.advance(std.testing.io, .{ .now = f.node.last_now, .readiness = .{} }, .{}, .{});
    try std.testing.expect(result.failure == null);
    try contains(try f.render(), "lodestar_discovery_subnet_peers_to_connect{type=\"attnets\"} 4\n");

    try core_test.updateDemand(f.node, &.{}, f.node.last_now);
    result = f.node.advance(std.testing.io, .{ .now = f.node.last_now, .readiness = .{} }, .{}, .{});
    try std.testing.expect(result.failure == null);
    try contains(try f.render(), "lodestar_discovery_subnet_peers_to_connect{type=\"attnets\"} 0\n");

    try core_test.updateDemand(f.node, &demand, f.node.last_now);
    result = f.node.advance(std.testing.io, .{ .now = f.node.last_now, .readiness = .{} }, .{}, .{});
    try std.testing.expect(result.failure == null);
    try contains(try f.render(), "lodestar_discovery_subnet_peers_to_connect{type=\"attnets\"} 4\n");
}

test "metrics render exactly the measurement contract families with their types and labels" {
    var f = try Fixture.initWith(&.{boundary(@splat(0), 100)}, .{ .bind = .{ .ip4 = .loopback(0) } });
    defer f.deinit();
    // A connected gossip peer gives the score statistics a population to sample.
    _ = gossip_test.addPeer(f.node.protocols.gossipsub, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const output = try f.render();
    var missing: usize = 0;
    for (contract) |series| {
        if (hasSeries(output, series)) continue;
        std.debug.print("measurement contract series missing or mistyped: {s} ({s})\n", .{ series.name, series.kind });
        missing += 1;
    }
    try std.testing.expectEqual(@as(usize, 0), missing);
    var extra: usize = 0;
    var lines = std.mem.splitScalar(u8, output, '\n');
    while (lines.next()) |line| {
        if (!std.mem.startsWith(u8, line, "# TYPE ")) continue;
        const name = line["# TYPE ".len..std.mem.findScalarLast(u8, line, ' ').?];
        for (contract) |series| {
            if (std.mem.eql(u8, series.name, name)) break;
        } else {
            std.debug.print("family outside the measurement contract: {s}\n", .{name});
            extra += 1;
        }
    }
    try std.testing.expectEqual(@as(usize, 0), extra);
}

test "metrics report the kernel's buffer sizes and drops for every UDP socket" {
    var f = try Fixture.initWith(&.{}, .{ .bind = .{ .ip4 = .loopback(0) } });
    defer f.deinit();
    const output = try f.render();
    const roles = [_]struct { []const u8, *Sockets }{
        .{ "quic", &f.node.transport.sockets },
        .{ "discovery", &f.node.discovery.?.transport.sockets },
    };
    var line: [160]u8 = undefined;
    for (roles) |role| {
        const reported = role[1].buffers[0].?;
        try std.testing.expect(reported.receive.? > 0 and reported.send.? > 0);
        try contains(output, try std.fmt.bufPrint(&line, "lodestar_udp_socket_buffer_bytes{{role=\"{s}\",family=\"ip4\",direction=\"receive\"}} {d}\n", .{ role[0], reported.receive.? }));
        try contains(output, try std.fmt.bufPrint(&line, "lodestar_udp_socket_buffer_bytes{{role=\"{s}\",family=\"ip4\",direction=\"send\"}} {d}\n", .{ role[0], reported.send.? }));
        // Linux kernels without SO_MEMINFO report no drop count.
        if (role[1].drops()[0] != null) try contains(output, try std.fmt.bufPrint(&line, "lodestar_udp_socket_drops_total{{role=\"{s}\",family=\"ip4\"}} 0\n", .{role[0]}));
    }
    try std.testing.expect(std.mem.find(u8, output, "family=\"ip6\"") == null);
    f.node.discovery.?.transport.sockets.buffers[0].?.receive = null;
    const unknown = try f.render();
    try std.testing.expect(std.mem.find(u8, unknown, "role=\"discovery\",family=\"ip4\",direction=\"receive\"") == null);
    try contains(unknown, "role=\"discovery\",family=\"ip4\",direction=\"send\"");
}

test "metrics label redials after a health close in the dial retries contract series" {
    var f = try Fixture.init(&.{});
    defer f.deinit();
    f.node.peer_manager.dialing.retries[@intFromEnum(types.DialFailure.health)] = 2;
    try contains(try f.render(), "lodestar_peer_dial_retries_total{previous=\"health\"} 2\n");
}

test "metrics export cumulative dial time by outcome in seconds" {
    var f = try Fixture.init(&.{});
    defer f.deinit();
    const dialing = &f.node.peer_manager.dialing;
    const connected = @intFromEnum(types.DialOutcome.connected);
    dialing.durations[connected].observe(180);
    dialing.outcomes[connected] = 1;
    for (0..2) |_| {
        const output = try f.render();
        try contains(output, "# TYPE lodestar_peer_dial_time_seconds histogram\n");
        try contains(output, "lodestar_peer_dial_time_seconds_bucket{outcome=\"connected\",le=\"0.1\"} 0\n");
        try contains(output, "lodestar_peer_dial_time_seconds_bucket{outcome=\"connected\",le=\"0.25\"} 1\n");
        try contains(output, "lodestar_peer_dial_time_seconds_bucket{outcome=\"connected\",le=\"+Inf\"} 1\n");
        try contains(output, "lodestar_peer_dial_time_seconds_sum{outcome=\"connected\"} 0.18\n");
        try contains(output, "lodestar_peer_dial_time_seconds_count{outcome=\"connected\"} 1\n");
        try contains(output, "lodestar_peer_dial_time_seconds_count{outcome=\"expired\"} 0\n");
    }
}

test "metrics export cumulative discovery lookups and datagram rejections" {
    var f = try Fixture.initWith(&.{}, .{ .bind = .{ .ip4 = .loopback(0) } });
    defer f.deinit();
    const coordinator = f.node.discovery.?;
    coordinator.counters.lookups_started = 5;
    coordinator.counters.lookup_time.observe(2_500);
    coordinator.counters.lookup_time.observe(7_500);
    const d = @import("discv5");
    coordinator.datagram_rejections[@intFromEnum(d.types.RejectReason.invalid_handshake)] = 3;
    _ = coordinator.consume(&.{ .datagram = .{ .rejected = .record_admission_limited } }, &.{}, &.{});
    _ = coordinator.consume(&.{ .datagram = .{ .rejected = .admission_limited } }, &.{}, &.{});
    const output = try f.render();
    try contains(output, "lodestar_discovery_find_node_query_requests_total{action=\"start\"} 5\n");
    try contains(output, "lodestar_discovery_find_node_query_time_seconds_count 2\n");
    try contains(output, "lodestar_discovery_find_node_query_time_seconds_sum 10\n");
    try contains(output, "lodestar_discovery_find_node_query_time_seconds_bucket{le=\"5\"} 1\n");
    try contains(output, "lodestar_discovery_datagram_rejections_total{stage=\"handshake\",reason=\"invalid_handshake\"} 3\n");
    try contains(output, "lodestar_discovery_datagram_rejections_total{stage=\"record\",reason=\"record_admission_limited\"} 1\n");
    try contains(output, "lodestar_discovery_datagram_rejections_total{stage=\"admission\",reason=\"admission_limited\"} 1\n");
    try contains(output, "lodestar_discovery_datagram_rejections_total{stage=\"record\",reason=\"invalid_record\"} 0\n");
    try contains(try f.render(), "lodestar_discovery_find_node_query_requests_total{action=\"start\"} 5\n");
    try contains(try f.render(), "lodestar_discovery_find_node_query_time_seconds_count 2\n");
}

test "metrics export stock per-topic gossipsub peer gauges under full topic strings" {
    var f = try Fixture.init(&.{ boundary(@splat(0), 100), boundary(@splat(1), 200) });
    defer f.deinit();
    const g = f.node.protocols.gossipsub;
    const peer = gossip_test.addPeer(g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const context = g.overlayContext(g.last_now_ms);
    const column = "/eth2/00000000/data_column_sidecar_9/ssz_snappy";
    _ = g.overlay.peerSubscription(&context, peer.index, column, true);
    var output = try f.render();
    try contains(output, "# TYPE gossipsub_topic_peer_count gauge\n");
    try contains(output, "gossipsub_topic_peer_count{topicStr=\"" ++ column ++ "\"} 1\n");
    try contains(output, "gossipsub_mesh_peer_count{topicStr=\"" ++ column ++ "\"} 0\n");
    try contains(output, "gossipsub_mesh_peer_count{topicStr=\"/eth2/00000000/beacon_attestation_63/ssz_snappy\"} 0\n");
    try std.testing.expectEqual(@as(usize, 337), std.mem.count(u8, output, "gossipsub_topic_peer_count{topicStr=\"/eth2/00000000/"));
    try std.testing.expect(std.mem.find(u8, output, "/eth2/01010101/") == null);
    const future = "/eth2/01010101/beacon_block/ssz_snappy";
    try gossip_test.subscribe(g, future);
    output = try f.render();
    try contains(output, "gossipsub_mesh_peer_count{topicStr=\"" ++ future ++ "\"} 0\n");
}

test "metrics export gossip score populations and zero empty statistics" {
    var f = try Fixture.init(&.{});
    defer f.deinit();
    const g = f.node.protocols.gossipsub;
    _ = gossip_test.addPeer(g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    gossip_test.penalize(g, g.sessions.rows[0].conn, 7);
    const running = try f.render();
    try contains(running, "lodestar_gossip_peer_score_by_threshold_count{threshold=\"all\"} 1\n");
    try contains(running, "lodestar_gossip_peer_score_by_threshold_count{threshold=\"mesh\"} 0\n");
    try contains(running, "lodestar_gossip_mesh_peer_score_by_threshold_count{threshold=\"all\"} 0\n");
    try contains(running, "lodestar_gossip_score_avg_min_max_max -10\n");
    try contains(running, "lodestar_gossip_mesh_score_avg_min_max_avg 0\n");
    g.connectionClosed(g.sessions.rows[0].conn);
    const retired = try f.render();
    try contains(retired, "lodestar_gossip_peer_score_by_threshold_count{threshold=\"all\"} 0\n");
    try contains(retired, "lodestar_gossip_score_avg_min_max_avg 0\n");
    try contains(retired, "lodestar_gossip_mesh_score_avg_min_max_avg 0\n");
}

test "metrics export gossip message, mesh change, penalty and promise counters through peer retirement" {
    var f = try Fixture.init(&.{boundary(@splat(0), 100)});
    defer f.deinit();
    const g = f.node.protocols.gossipsub;
    const name = "/eth2/00000000/beacon_block/ssz_snappy";
    try gossip_test.subscribe(g, name);
    const peer = gossip_test.addPeer(g, .{ .index = 0, .generation = 1 }, .v1_2).?;
    const topic = g.overlay.peerSubscription(&g.overlayContext(0), peer.index, name, true).?;
    g.overlay.onGraft(&g.overlayContext(0), topic, peer.index);
    const counts = &g.topic_metrics.counts[@intFromEnum(policy.Kind.beacon_block)];
    counts.received = 5;
    counts.duplicate = 2;
    g.topic_metrics.counts[policy.kind_count].published = std.math.maxInt(u64);
    g.peers.scores.penalties[@intFromEnum(score.Penalty.graft_flood)] = 6;
    g.recovery.armed = 9;
    const expected = [_][]const u8{
        "gossipsub_msg_received_prevalidation_total{topic=\"beacon_block\"} 5\n",
        "gossipsub_pre_validation_duplicate_total{topic=\"beacon_block\"} 2\n",
        "gossipsub_msg_publish_count_total{topic=\"unknown\"} 18446744073709551615\n",
        "gossipsub_msg_received_prevalidation_total{topic=\"data_column_sidecar\"} 0\n",
        "gossipsub_mesh_changes_total{topic=\"beacon_block\",event=\"join\",reason=\"remote_graft\"} 1\n",
        "gossipsub_mesh_changes_total{topic=\"unknown\",event=\"leave\",reason=\"refused_graft\"} 0\n",
        "gossipsub_behaviour_penalties_total{reason=\"graft_flood\"} 6\n",
        "gossipsub_receive_discards_total{reason=\"capacity\"} 0\n",
        "gossipsub_receive_discards_total{reason=\"timeout\"} 0\n",
        "gossipsub_receive_discards_total{reason=\"unattributed_timeout\"} 0\n",
        "gossipsub_iwant_promise_sent_total 9\n",
    };
    const running = try f.render();
    for (expected) |line| try contains(running, line);
    try std.testing.expectEqual(@as(usize, (policy.kind_count + 1) * 12), std.mem.count(u8, running, "gossipsub_mesh_changes_total{"));
    g.connectionClosed(g.sessions.rows[peer.index].conn);
    const retired = try f.render();
    for (expected) |line| try contains(retired, line);
    try contains(retired, "gossipsub_mesh_changes_total{topic=\"beacon_block\",event=\"leave\",reason=\"session_end\"} 1\n");
}

test "metrics report delivery capacity and available descriptors without changing the pool" {
    var f = try Fixture.init(&.{});
    defer f.deinit();
    const pool = f.node.protocols.gossipsub.sessions.deliveries;
    const capacity = pool.available;
    pool.available -= 1;
    defer pool.available = capacity;
    var line: [128]u8 = undefined;
    const running = try f.render();
    try contains(running, try std.fmt.bufPrint(&line, "gossipsub_delivery_descriptors_available_count {d}\n", .{capacity - 1}));
    try contains(running, try std.fmt.bufPrint(&line, "gossipsub_delivery_descriptors_capacity_count {d}\n", .{capacity}));
    try std.testing.expectEqual(capacity - 1, pool.available);
}

test "metrics expose local UDP send drops by role and pressure without clearing on read" {
    var f = try Fixture.initWith(&.{}, .{ .bind = .{ .ip4 = .loopback(0) } });
    defer f.deinit();
    f.node.transport.send_drops.add(.would_block, 17);
    f.node.transport.send_drops.add(.would_block, 19);
    f.node.discovery.?.transport.send_drops.add(.system_resources, 23);
    for (0..2) |_| {
        const output = try f.render();
        try contains(output, "lodestar_udp_send_dropped_datagrams_total{role=\"quic\",reason=\"would_block\"} 2\n");
        try contains(output, "lodestar_udp_send_dropped_bytes_total{role=\"quic\",reason=\"would_block\"} 36\n");
        try contains(output, "lodestar_udp_send_dropped_datagrams_total{role=\"discovery\",reason=\"system_resources\"} 1\n");
        try contains(output, "lodestar_udp_send_dropped_bytes_total{role=\"discovery\",reason=\"system_resources\"} 23\n");
        try contains(output, "lodestar_udp_send_dropped_datagrams_total{role=\"quic\",reason=\"system_resources\"} 0\n");
        try contains(output, "lodestar_udp_send_dropped_datagrams_total{role=\"discovery\",reason=\"would_block\"} 0\n");
    }
}

test "core metrics aggregate subnets and count distinct mesh peers" {
    const full = @import("gossipsub/topic_fixture.zig").full;
    const pair = try std.testing.allocator.create(core_test.Setup);
    defer std.testing.allocator.destroy(pair);
    pair.* = .{};
    var opts = core_test.resolvedOptions();
    opts.core.protocols.gossipsub.topic_policy = &.{full(@splat(0))};
    try pair.initOwnersWithOptions(&.{}, opts);
    defer pair.deinit();
    var a_intent = core_test.intent(&pair.client, &.{});
    a_intent.subscriptions = topic_fixture.subscriptions(&.{ "/eth2/00000000/beacon_block/ssz_snappy", "/eth2/00000000/blob_sidecar_0/ssz_snappy", "/eth2/00000000/blob_sidecar_1/ssz_snappy" });
    var b_intent = core_test.intent(&pair.server, &.{});
    b_intent.subscriptions = a_intent.subscriptions;
    try std.testing.expect(try pair.client.applyIntent(&a_intent, pair.client.last_now));
    try std.testing.expect(try pair.server.applyIntent(&b_intent, pair.server.last_now));
    try pair.client.connectUntil(&pair.server.peerId(), &.{test_support.server_address}, pair.client.last_now, time.milliseconds(pair.client.last_now.millis() +| Dialing.connect_timeout_ms));
    const start = pair.client.last_now.millis();
    var mesh_count: usize = 0;
    for (0..3000) |_| {
        try pair.step(1);
        pair.pair.advance(10);
        if (pair.client.last_now.millis() - start > 10_000) break;
        mesh_count = pair.client.protocols.gossipsub.resourceSnapshot().mesh_members;
        if (mesh_count == 3) break;
    }
    const context = metrics.Context.init(&pair.client, pair.client.last_now);
    try std.testing.expectEqual(@as(usize, 3), mesh_count);
    try std.testing.expectEqual(@as(usize, 1), context.population.count);
    var mesh_peers: usize = 0;
    var scored_peers: usize = 0;
    for (context.population.mesh_clients, context.population.gossip_scores) |meshed, gossip_score| {
        mesh_peers += meshed;
        scored_peers += gossip_score.count;
    }
    try std.testing.expectEqual(@as(usize, 1), mesh_peers);
    try std.testing.expectEqual(@as(usize, 1), scored_peers);
    const again = metrics.Context.init(&pair.client, pair.client.last_now);
    try std.testing.expectEqualDeep(context.population, again.population);
}
