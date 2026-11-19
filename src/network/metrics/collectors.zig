const processor_metrics = @import("processor.zig");
const std = @import("std");
const types = @import("../types.zig");
const rr = @import("../reqresp/root.zig");
const prom = @import("registry.zig");
const peer_metrics = @import("../peers/metrics_export.zig");
const gossip_metrics = @import("../gossipsub/metrics_export.zig");
const turn_timing = @import("../turn_timing.zig");
const timing = @import("timing.zig");
const topic_metrics = @import("../gossipsub/topic_metrics.zig");
const gossip_turn = @import("../gossipsub/turn.zig");
const policy_metrics = @import("../peers/policy_metrics.zig");

const Context = @import("context.zig").Context;
pub const registry = prom.Registry(Context, .{
    writePeers,
    writeTopics,
    writeRequests,
    writeRequestStreams,
    writeRequestTimes,
    writeGossip,
    writeGossipScores,
    writeGossipExecution,
    writePopulation,
    writePeerEvents,
    writePeerPolicy,
    writeConnections,
    writeTransportConnections,
    writeRuntime,
    writeNativeCounters,
    writeSockets,
    writeQuic,
    writeGossipResources,
    writeRequestResources,
    writePeerCloses,
    writeRememberedPeers,
    writeDiscoveryProgress,
    writeGossipTopics,
    writeBridge,
});

fn writePeers(self: *const Context, w: *prom.Encoder) prom.Error!void {
    try peer_metrics.writePeers(&self.owner.peer_manager, &self.population, w);
}

fn writeRuntime(self: *const Context, w: *prom.Encoder) prom.Error!void {
    if (self.owner.discovery) |discovery| {
        try w.scalar(.{ .name = "lodestar_discv5_active_session_count", .kind = .gauge, .help = "Stored discovery sessions" }, discovery.transport.engine.channel.sessions.sessionCount());
        try w.scalar(.{ .name = "lodestar_discv5_kad_table_size", .kind = .gauge, .help = "Discovery routing table entries" }, discovery.transport.engine.peerCount());
    }
    try w.scalar(.{ .name = "lodestar_network_transport_failures_total", .kind = .counter, .help = "Failed owner clock reads and transport receive steps" }, self.owner.counters.transport_failures);
    try w.scalar(.{ .name = "lodestar_network_readiness_failures_total", .kind = .counter, .help = "Failed owner readiness polls" }, self.owner.counters.readiness_failures);
    const steps = try w.histograms(.{ .name = "lodestar_network_step_seconds", .kind = .histogram, .help = "Network step duration after native readiness polling, covering transport, protocols and discovery", .unit = .seconds }, timing.Duration);
    try steps.histogram(.{}, &self.owner.step_duration);
    const phases = try w.histograms(.{ .name = "lodestar_network_turn_phase_seconds", .kind = .histogram, .help = "Network turn duration by phase, excluding readiness polling", .labels = &.{"phase"}, .unit = .seconds }, timing.Duration);
    inline for (std.meta.fields(turn_timing.Phase)) |phase| {
        try phases.histogram(.{phase.name}, &self.owner.turn_timing.phases[phase.value]);
    }
}

fn writeNativeCounters(self: *const Context, w: *prom.Encoder) prom.Error!void {
    inline for (.{
        .{ "received_bytes", "Complete QUIC UDP payload bytes received, excluding truncated datagrams" },
        .{ "sent_bytes", "QUIC UDP payload bytes sent, including successful prefixes of failed batches" },
        .{ "received_datagrams", "QUIC UDP datagrams received, including truncated datagrams" },
        .{ "sent_datagrams", "QUIC UDP datagrams sent" },
    }) |metric| try w.scalar(.{
        .name = "lodestar_quic_udp_" ++ metric[0] ++ "_total",
        .kind = .counter,
        .help = metric[1],
    }, @field(self.owner.transport.counters, metric[0]));
    const udp = @import("udp");
    const discovery_drops = if (self.owner.discovery) |d| d.transport.send_drops else udp.Sockets.SendDrops{};
    inline for (.{ "datagrams", "bytes" }) |measure| {
        const dropped = try w.family(.{
            .name = "lodestar_udp_send_dropped_" ++ measure ++ "_total",
            .kind = .counter,
            .help = "UDP " ++ measure ++ " discarded before kernel acceptance due to local send pressure or unreachable destinations",
            .labels = &.{ "role", "reason" },
        });
        inline for (std.meta.fields(udp.Sockets.SendDrops.Reason)) |reason| {
            try dropped.sample(.{ "quic", reason.name }, @field(self.owner.transport.send_drops, measure)[reason.value]);
            try dropped.sample(.{ "discovery", reason.name }, @field(discovery_drops, measure)[reason.value]);
        }
    }
    try peer_metrics.writeDiscoveryCounters(&self.owner.peer_manager, self.owner.discovery, w);
    try gossip_metrics.writeQueueDrops(self.owner.protocols.gossipsub, w);
}

fn writeQuic(self: *const Context, w: *prom.Encoder) prom.Error!void {
    const transport = &self.owner.transport;
    const snapshot = transport.engine.metricsSnapshot();
    try snapshot.write(w);
    try w.scalar(.{ .name = "lodestar_quic_receive_turns_total", .kind = .counter, .help = "QUIC socket receive turns" }, transport.counters.receive_turns);
    try w.scalar(.{ .name = "lodestar_quic_receive_budget_exhausted_total", .kind = .counter, .help = "QUIC receive turns that consumed the datagram budget; more data may remain in the socket" }, transport.counters.receive_budget_exhausted);
    try w.scalar(.{ .name = "lodestar_quic_receive_datagrams_per_turn", .kind = .gauge, .help = "Configured QUIC receive datagram budget per network turn" }, transport.work_limits.receive_per_turn_max);
    try w.scalar(.{ .name = "lodestar_quic_initial_congestion_window_packets", .kind = .gauge, .help = "Configured initial QUIC congestion window in packets" }, transport.engine.limits.initial_congestion_window_packets);
    const windows = try w.family(.{ .name = "lodestar_quic_receive_window_bytes", .kind = .gauge, .help = "Configured per-connection and per-stream QUIC receive flow control limits", .labels = &.{"scope"}, .unit = .bytes });
    try windows.sample(.{"connection"}, transport.engine.connection_window);
    try windows.sample(.{"stream"}, transport.engine.stream_window);
}

fn writeSockets(self: *const Context, w: *prom.Encoder) prom.Error!void {
    const Sockets = @import("udp").Sockets;
    const roles = [_]struct { []const u8, ?*const Sockets }{
        .{ "quic", &self.owner.transport.sockets },
        .{ "discovery", if (self.owner.discovery) |d| &d.transport.sockets else null },
    };
    const families = [_][]const u8{ "ip4", "ip6" };
    const buffers = try w.family(.{
        .name = "lodestar_udp_socket_buffer_bytes",
        .kind = .gauge,
        .help = "UDP socket buffer size as the kernel reports it; Linux reports double the size it grants",
        .labels = &.{ "role", "family", "direction" },
    });
    for (roles) |role| for ((role[1] orelse continue).buffers, families) |reported, family| {
        const sizes = reported orelse continue;
        if (sizes.receive) |bytes| try buffers.sample(.{ role[0], family, "receive" }, bytes);
        if (sizes.send) |bytes| try buffers.sample(.{ role[0], family, "send" }, bytes);
    };
    const drops = try w.family(.{
        .name = "lodestar_udp_socket_drops_total",
        .kind = .counter,
        .help = "Datagrams the kernel dropped at the socket, mostly on a full receive buffer; Linux only",
        .labels = &.{ "role", "family" },
    });
    for (roles, self.socket_drops) |role, counts| for (counts, families) |count, family| {
        try drops.sample(.{ role[0], family }, count orelse continue);
    };
}

fn writeGossipResources(self: *const Context, w: *prom.Encoder) prom.Error!void {
    const resources = self.owner.protocols.gossipsub.resourceSnapshot();

    inline for (.{
        .{ "receive_pages_count", "receive_pages", "Receive pages holding partial inbound frames" },
        .{ "receive_pages_capacity_count", "receive_page_capacity", "Receive pages the pool holds" },
        .{ "validation_capacity_count", "validation_capacity", "Messages the validation table holds" },
        .{ "mcache_not_validated_count", "pending_validations", "Admitted messages awaiting a verdict" },
        .{ "attribution_capacity_count", "attribution_capacity", "Attribution records shared by pending validation and recent verdicts" },
        .{ "attribution_resolved_count", "resolved_attributions", "Recent verdicts retained for duplicate scoring" },
        .{ "delivery_descriptors_capacity_count", "delivery_descriptors_capacity", "Outgoing data descriptors the shared pool holds" },
        .{ "delivery_descriptors_available_count", "delivery_descriptors_available", "Outgoing data descriptors free in the shared pool" },
        .{ "queued_bytes", "queued_bytes", "Compressed bytes queued to peers as data frames" },
        .{ "store_pages_count", "store_pages", "Message store pages in use" },
    }) |field| try w.scalar(.{
        .name = "gossipsub_" ++ field[0],
        .kind = .gauge,
        .help = field[2],
    }, @field(resources, field[1]));
}
fn writeRequestResources(self: *const Context, w: *prom.Encoder) prom.Error!void {
    const requests = self.owner.protocols.reqresp.resourceSnapshot();
    try w.scalar(.{ .name = "beacon_reqresp_serving_capacity_count", .kind = .gauge, .help = "Incoming requests the host may serve at once" }, requests.serving_capacity);
    try w.scalar(.{ .name = "beacon_reqresp_serving_count", .kind = .gauge, .help = "Incoming requests the host is serving" }, requests.serving_occupied);
    try w.scalar(.{ .name = "beacon_reqresp_retiring_count", .kind = .gauge, .help = "Serving resources awaiting host retirement" }, requests.retiring);
}

fn writePeerCloses(self: *const Context, w: *prom.Encoder) prom.Error!void {
    try peer_metrics.writePeerCloses(&self.owner.peer_manager, w);
}

fn writeRememberedPeers(self: *const Context, w: *prom.Encoder) prom.Error!void {
    try peer_metrics.writeRememberedPeers(&self.owner.peer_manager, w);
}

fn writeTransportConnections(self: *const Context, w: *prom.Encoder) prom.Error!void {
    const transport = self.owner.transport.engine.resourceSnapshot();
    try w.scalar(.{ .name = "lodestar_quic_connection_slots_count", .kind = .gauge, .help = "Occupied QUIC slots, including closed connections awaiting retirement" }, transport.active);
    try w.scalar(.{ .name = "lodestar_quic_connections_handshaking_count", .kind = .gauge, .help = "Inbound QUIC connections still handshaking" }, transport.handshaking);
}

fn writeDiscoveryProgress(self: *const Context, w: *prom.Encoder) prom.Error!void {
    try peer_metrics.writeDiscoveryProgress(&self.owner.peer_manager, self.owner.discovery, w);
}

fn writeTopics(self: *const Context, w: *prom.Encoder) prom.Error!void {
    try topic_metrics.write(self.owner.protocols.gossipsub, self.owner.peer_manager.local.fork.digest, w);
}

fn writeRequests(self: *const Context, w: *prom.Encoder) prom.Error!void {
    inline for (.{
        .{ "beacon_reqresp_outgoing_requests_total", "outgoing", "Started outgoing native requests, including control methods" },
        .{ "beacon_reqresp_incoming_requests_total", "incoming", "Accepted incoming native request streams, including control methods" },
        .{ "beacon_reqresp_outgoing_requests_error_total", "outgoing_errors", "Outgoing requests with a terminal native failure, excluding local cancellation" },
        .{ "beacon_reqresp_incoming_requests_error_total", "incoming_errors", "Incoming requests ending with an error response or native failure, excluding local cancellation" },
    }) |metric| {
        const requests = try w.family(.{
            .name = metric[0],
            .kind = .counter,
            .help = metric[2],
            .labels = &.{"method"},
        });
        for (rr.protocol.methods, 0..) |method, index| {
            if (!firstMethod(index)) continue;
            var count: u64 = 0;
            for ([_]*const rr.ReqResp{ &self.owner.protocols.reqresp, &self.owner.protocols.control_reqresp }) |instance| {
                for (rr.protocol.methods, &instance.protocol_counters) |candidate, *values| {
                    if (std.mem.eql(u8, candidate, method)) count +|= @field(values, metric[1]);
                }
            }
            try requests.sample(.{method}, count);
        }
    }
    const refusals = try w.family(.{
        .name = "beacon_reqresp_admission_refusals_total",
        .kind = .counter,
        .help = "Incoming request admission refusals counted once at the decision",
        .labels = &.{ "method", "reason" },
    });
    const rate_limits = try w.family(.{
        .name = "beacon_reqresp_rate_limiter_errors_total",
        .kind = .counter,
        .help = "Incoming requests refused by peer or global rate limits",
        .labels = &.{"method"},
    });
    for (rr.protocol.methods, 0..) |method, index| {
        if (!firstMethod(index)) continue;
        var rate_limited: u64 = 0;
        inline for (std.meta.fields(rr.ReqResp.metrics.AdmissionRefusal)) |reason| {
            var count: u64 = 0;
            for ([_]*const rr.ReqResp{ &self.owner.protocols.reqresp, &self.owner.protocols.control_reqresp }) |instance| {
                for (rr.protocol.methods, &instance.protocol_counters) |candidate, *values| {
                    if (std.mem.eql(u8, candidate, method)) count +|= values.admission_refusals[reason.value];
                }
            }
            try refusals.sample(.{ method, reason.name }, count);
            if (comptime reason.value == @intFromEnum(rr.ReqResp.metrics.AdmissionRefusal.peer_quota) or reason.value == @intFromEnum(rr.ReqResp.metrics.AdmissionRefusal.address_quota) or reason.value == @intFromEnum(rr.ReqResp.metrics.AdmissionRefusal.global_quota)) rate_limited +|= count;
        }
        try rate_limits.sample(.{method}, rate_limited);
    }
    var phases = self.owner.protocols.reqresp.resourceSnapshot().inbound_phases;
    for (&phases, self.owner.protocols.control_reqresp.resourceSnapshot().inbound_phases) |*count, control| count.* += control;
    try w.enums(.{
        .name = "beacon_reqresp_incoming_count",
        .kind = .gauge,
        .help = "Occupied incoming request slots by current phase, including terminal owners awaiting recycling",
        .labels = &.{"phase"},
    }, rr.ReqResp.metrics.InboundPhase, &phases);
}

fn writeRequestStreams(self: *const Context, w: *prom.Encoder) prom.Error!void {
    inline for (.{ "outgoing", "incoming" }) |direction| {
        const opened = try w.family(.{
            .name = "beacon_reqresp_" ++ direction ++ "_opened_streams_total",
            .kind = .counter,
            .help = "Negotiated " ++ direction ++ " request streams admitted to reqresp by method",
            .labels = &.{"method"},
        });
        const closed = try w.family(.{
            .name = "beacon_reqresp_" ++ direction ++ "_closed_streams_total",
            .kind = .counter,
            .help = "Admitted " ++ direction ++ " request streams terminated by method, including cancellation",
            .labels = &.{"method"},
        });
        for (rr.protocol.methods, 0..) |method, index| {
            if (!firstMethod(index)) continue;
            var opened_count: u64 = 0;
            var closed_count: u64 = 0;
            for ([_]*const rr.ReqResp{ &self.owner.protocols.reqresp, &self.owner.protocols.control_reqresp }) |instance| {
                for (rr.protocol.methods, &instance.protocol_counters) |candidate, *values| {
                    if (!std.mem.eql(u8, candidate, method)) continue;
                    if (comptime std.mem.eql(u8, direction, "outgoing")) {
                        opened_count +|= values.outgoing_opened;
                        closed_count +|= values.outgoing_closed;
                    } else {
                        opened_count +|= values.incoming;
                        closed_count +|= values.incoming_time.count;
                    }
                }
            }
            try opened.sample(.{method}, opened_count);
            try closed.sample(.{method}, closed_count);
        }
    }
    const reasons = requestErrorReasons(self);
    try w.scalar(.{
        .name = "beacon_reqresp_dial_errors_total",
        .kind = .counter,
        .help = "Outgoing requests failing protocol negotiation, including negotiation timeouts",
    }, reasons[@intFromEnum(rr.ReqResp.metrics.ErrorReason.REQUEST_ERROR_DIAL_ERROR)] +|
        reasons[@intFromEnum(rr.ReqResp.metrics.ErrorReason.REQUEST_ERROR_DIAL_TIMEOUT)]);
}

fn requestErrorReasons(self: *const Context) [rr.ReqResp.metrics.error_reason_count]u64 {
    var result = self.owner.protocols.reqresp.outgoing_error_reasons;
    for (&result, self.owner.protocols.control_reqresp.outgoing_error_reasons) |*count, control| count.* +|= control;
    return result;
}

fn writeRequestTimes(self: *const Context, w: *prom.Encoder) prom.Error!void {
    inline for (.{
        .{ "beacon_reqresp_outgoing_request_roundtrip_time_seconds", "outgoing_time", "Outgoing request duration from stream creation through native completion or failure" },
        .{ "beacon_reqresp_incoming_request_handler_time_seconds", "incoming_time", "Incoming request duration from accepted stream through native completion or failure" },
    }) |metric| {
        const durations = try w.histograms(.{
            .name = metric[0],
            .kind = .histogram,
            .help = metric[2],
            .labels = &.{"method"},
            .unit = .seconds,
        }, @TypeOf(@field(self.owner.protocols.reqresp.protocol_counters[0], metric[1])));
        for (rr.protocol.methods, 0..) |method, index| {
            if (!firstMethod(index)) continue;
            var aggregate: @TypeOf(@field(self.owner.protocols.reqresp.protocol_counters[0], metric[1])) = .{};
            for ([_]*const rr.ReqResp{ &self.owner.protocols.reqresp, &self.owner.protocols.control_reqresp }) |instance| {
                for (rr.protocol.methods, &instance.protocol_counters) |candidate, *values| {
                    if (std.mem.eql(u8, candidate, method)) aggregate.merge(&@field(values, metric[1]));
                }
            }
            try durations.histogram(.{method}, &aggregate);
        }
    }
    try w.enums(.{
        .name = "beacon_reqresp_outgoing_requests_error_reason_total",
        .kind = .counter,
        .help = "Terminal outgoing native failures using host request error labels",
        .labels = &.{"reason"},
    }, rr.ReqResp.metrics.ErrorReason, &requestErrorReasons(self));
}

fn writeBridge(self: *const Context, w: *prom.Encoder) prom.Error!void {
    try processor_metrics.write(self.processor orelse &processor_metrics.empty, w);
}

fn writeGossipExecution(self: *const Context, w: *prom.Encoder) prom.Error!void {
    const gossip = self.owner.protocols.gossipsub;
    try w.enums(.{ .name = "gossipsub_pump_budget_exhausted_total", .kind = .counter, .help = "Gossip pumps that exhausted a work budget", .labels = &.{"budget"} }, gossip_turn.Budget, &gossip.counters.pump_budget_exhausted);
    try w.scalar(.{ .name = "gossipsub_stream_write_total", .kind = .counter, .help = "Gossip QUIC stream write calls" }, gossip.sessions.writes);
    try w.scalar(.{ .name = "gossipsub_stream_write_blocked_total", .kind = .counter, .help = "Gossip QUIC stream writes blocked or partially accepted by QUIC" }, gossip.sessions.blocked_writes);
    try w.scalar(.{
        .name = "lodestar_gossip_validation_expired_executing_count",
        .kind = .gauge,
        .help = "Delivered gossip validations still awaiting host completion after their verdict deadlines",
    }, self.expired_executing);
}

fn writeGossip(self: *const Context, w: *prom.Encoder) prom.Error!void {
    try gossip_metrics.writeCounters(self.owner.protocols.gossipsub, w);
}

fn writeGossipScores(self: *const Context, w: *prom.Encoder) prom.Error!void {
    try gossip_metrics.writeScores(self.owner.protocols.gossipsub, self.now.millis(), w);
}

fn writeGossipTopics(self: *const Context, w: *prom.Encoder) prom.Error!void {
    try gossip_metrics.writeMessages(self.owner.protocols.gossipsub, w);
}
fn writeConnections(self: *const Context, w: *prom.Encoder) prom.Error!void {
    const counters = &self.owner.transport.engine.connection_metrics;
    try w.enums(.{
        .name = "lodestar_quic_connections_established_total",
        .kind = .counter,
        .help = "QUIC connections with authenticated expected identities by direction",
        .labels = &.{"direction"},
    }, types.Direction, &counters.established);
    const closed = try w.family(.{
        .name = "lodestar_quic_connections_closed_total",
        .kind = .counter,
        .help = "QUIC closes including pre-admission failures; wire error codes share bounded reason labels",
        .labels = &.{ "direction", "reason" },
    });
    inline for (@typeInfo(types.Direction).@"enum".fields) |direction| {
        inline for (@typeInfo(types.CloseReason).@"union".fields, 0..) |reason, index| {
            try closed.sample(.{ direction.name, reason.name }, counters.closed[direction.value][index]);
        }
    }
}

fn firstMethod(index: usize) bool {
    std.debug.assert(index < rr.Protocol.count);
    for (rr.protocol.methods[0..index]) |previous| if (std.mem.eql(u8, rr.protocol.methods[index], previous)) return false;
    return true;
}

fn writePopulation(self: *const Context, w: *prom.Encoder) prom.Error!void {
    try self.population.write(w);
}
fn writePeerEvents(self: *const Context, w: *prom.Encoder) prom.Error!void {
    try peer_metrics.writePeerEvents(&self.owner.peer_manager, w);
}
fn writePeerPolicy(self: *const Context, w: *prom.Encoder) prom.Error!void {
    try policy_metrics.write(&self.owner.peer_manager, w);
}
