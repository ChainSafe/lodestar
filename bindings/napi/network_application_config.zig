const std = @import("std");
const n = @import("network");
const cfg = @import("network_config.zig");
const Value = @import("zapi:zapi").napi.Value;
const decode = @import("network_js_input.zig");
const BeaconConfig = @import("config").BeaconConfig;
const network_logs = @import("network_logs.zig");

pub const Config = struct {
    resources: Resources,
    trace_gossip: bool = false,
    xray: ?struct { endpoint: n.xray.Endpoint, wait_for_attach: bool } = null,
    transport: Transport = .{},
    agent: [256]u8,
    agent_len: u16,
    version: [64]u8,
    version_len: u8,
    genesis_root: [32]u8,
    peer_store_dir: [1024]u8 = undefined,
    peer_store_dir_len: u16 = 0,
    /// The threshold native records are kept at, or null for none, until the host selects another.
    log_level: ?std.log.Level,

    pub fn buildOptions(self: *const Config, common: *const cfg.Config, seed: u64) !n.configuration.Options {
        const r = &self.resources;
        const capture_bytes = if (self.xray != null) n.xray.Probe.allocatedBytesFor(r.connectionCapacity) else 0;
        if (r.nativeBudgetBytes <= @sizeOf(n.NetworkCore) + capture_bytes) return error.NetworkNativeBudgetExceeded;
        var gossip_options = common.gossip;
        gossip_options.topic_policy = common.chain.topics[0..common.chain.boundary_count];
        return .{
            .seed = seed,
            .forks = common.chain.forks[0..common.chain.boundary_count],
            .limits = .{ .connections_max = r.connectionCapacity, .handshaking_max = r.handshakingCapacity, .dialing_max = r.dialingCapacity, .receive_budget_bytes = r.receiveBudgetBytes, .initial_congestion_window_packets = self.transport.initialCongestionWindowPackets },
            .work_limits = .{ .receive_per_turn_max = self.transport.receiveDatagramsPerTurn },
            .peers = .{ .capacity = r.peerCapacity, .target_peers = r.targetPeers, .max_peers = r.maxPeers, .min_outbound = r.minOutbound, .outbound_reserve = r.outboundReserve, .inbound_per_source_max = r.inboundPeersPerSourceMax },
            .application_requests_max = 32,
            .admission_policy = common.chain.requestPolicy(),
            .gossip = gossip_options,
            .identify = .{ .agent = self.agent[0..self.agent_len], .protocol_version = self.version[0..self.version_len] },
            .byte_limit = r.nativeBudgetBytes - @sizeOf(n.NetworkCore) - capture_bytes,
        };
    }
};
const Transport = struct {
    initialCongestionWindowPackets: u16 = 10,
    receiveDatagramsPerTurn: u16 = 32,
};

pub const Resources = struct {
    peerCapacity: u16,
    targetPeers: u16,
    maxPeers: u16,
    inboundPeersPerSourceMax: u16 = (n.peers.Catalog.Options{}).inbound_per_source_max,
    minOutbound: u16,
    outboundReserve: u16,
    connectionCapacity: u16,
    handshakingCapacity: u16,
    dialingCapacity: u16,
    receiveBudgetBytes: u64,
    nativeBudgetBytes: usize,
    bridgeBudgetBytes: usize,
};

const resource_maxima = .{
    .receiveBudgetBytes = 9007199254740991,
    .nativeBudgetBytes = 2 * 1024 * 1024 * 1024,
    .bridgeBudgetBytes = 1024 * 1024 * 1024,
};

const required = .{ "beaconConfig", "activeValidatorCount", "identitySecretKey", "bind", "local", "discovery", "genesisTime", "resources", "identify", "serveLightClients", "logLevel" };

pub fn parse(value: Value, beacon: *const BeaconConfig, common: *cfg.Config, out: *Config) !void {
    try decode.object(value, &(required ++ .{ "gossipPolicy", "subscriptions", "peerStoreDir", "transport", "traceGossip", "xray" }));
    inline for (required) |name| _ = try decode.get(value, name);
    const trace_gossip = try decode.get(value, "traceGossip");
    out.trace_gossip = if (try trace_gossip.typeof() == .undefined) false else try decode.boolean(trace_gossip);
    out.xray = null;
    if (try value.hasNamedProperty("xray")) {
        const xray = try decode.get(value, "xray");
        try decode.completeObject(xray, &.{ "address", "waitForAttach" });
        var address: [256]u8 = undefined;
        const length = try decode.text(try decode.get(xray, "address"), &address);
        out.xray = .{
            .endpoint = n.xray.Endpoint.parse(address[0..length]) catch return error.InvalidXrayAddress,
            .wait_for_attach = try decode.boolean(try decode.get(xray, "waitForAttach")),
        };
    }
    out.transport = .{};
    const transport = try decode.get(value, "transport");
    if (try transport.typeof() != .undefined) {
        try decode.object(transport, &.{ "initialCongestionWindowPackets", "receiveDatagramsPerTurn" });
        inline for (.{ .{ "initialCongestionWindowPackets", 64 }, .{ "receiveDatagramsPerTurn", n.Transport.receive_per_turn_max } }) |field| {
            const override = try decode.get(transport, field[0]);
            if (try override.typeof() != .undefined) @field(out.transport, field[0]) = @intCast(try decode.integer(override, field[1]));
        }
    }
    try cfg.parse(value, beacon, common);
    errdefer common.wipe();
    const resources = try decode.get(value, "resources");
    try decode.object(resources, &.{ "targetPeers", "maxPeers", "inboundPeersPerSourceMax", "receiveBudgetBytes", "nativeBudgetBytes", "bridgeBudgetBytes" });
    const target: u16 = @intCast(try decode.integer(try decode.get(resources, "targetPeers"), 256));
    const max: u16 = @intCast(try decode.integer(try decode.get(resources, "maxPeers"), 256));
    out.resources = .{
        .targetPeers = target,
        .maxPeers = max,
        .peerCapacity = @max(64, 2 * max),
        .minOutbound = @max(1, target / 4),
        .outboundReserve = @min(32, target),
        .connectionCapacity = @min(256, max + 32),
        .handshakingCapacity = 32,
        .dialingCapacity = 32,
        .receiveBudgetBytes = 512 * 1024 * 1024,
        .nativeBudgetBytes = 2 * 1024 * 1024 * 1024,
        .bridgeBudgetBytes = 512 * 1024 * 1024,
    };
    const per_source = try decode.get(resources, "inboundPeersPerSourceMax");
    if (try per_source.typeof() != .undefined) out.resources.inboundPeersPerSourceMax = @intCast(try decode.integer(per_source, 256));
    inline for (.{ "receiveBudgetBytes", "nativeBudgetBytes", "bridgeBudgetBytes" }) |field| {
        const override = try decode.get(resources, field);
        if (try override.typeof() != .undefined) @field(out.resources, field) = @intCast(try decode.integer(override, @field(resource_maxima, field)));
    }
    if (out.resources.nativeBudgetBytes == 0 or out.resources.bridgeBudgetBytes == 0) return error.InvalidNetworkInteger;
    const identify = try decode.get(value, "identify");
    try decode.completeObject(identify, &.{ "agentVersion", "protocolVersion" });
    out.agent_len = @intCast(try decode.text(try decode.get(identify, "agentVersion"), &out.agent));
    out.version_len = @intCast(try decode.text(try decode.get(identify, "protocolVersion"), &out.version));
    out.genesis_root = beacon.genesis_validator_root;
    out.log_level = try network_logs.level(try decode.get(value, "logLevel"));
    out.peer_store_dir_len = 0;
    if (try value.hasNamedProperty("peerStoreDir")) {
        out.peer_store_dir_len = @intCast(try decode.text(try decode.get(value, "peerStoreDir"), &out.peer_store_dir));
        if (out.peer_store_dir_len == 0 or std.mem.findScalar(u8, out.peer_store_dir[0..out.peer_store_dir_len], 0) != null) return error.InvalidNetworkConfig;
    }
}

pub const Intent = n.application_state.Update;
pub fn parseIntent(value: Value, out: *Intent) !void {
    try decode.object(value, &.{ "status", "coreTopics", "custodyGroupCount", "attesters", "syncCommittees" });
    out.* = .{};
    if (try value.hasNamedProperty("status")) {
        var status: n.local_state.Status = undefined;
        try cfg.parseStatus(try decode.get(value, "status"), &status);
        out.status = status;
    }
    if (try value.hasNamedProperty("coreTopics")) out.core_topics = try decode.boolean(try decode.get(value, "coreTopics"));
    if (try value.hasNamedProperty("custodyGroupCount")) out.custody_group_count = try decode.bigint(try decode.get(value, "custodyGroupCount"));
    if (try value.hasNamedProperty("attesters")) {
        const rows = try decode.get(value, "attesters");
        out.attester_count = @intCast(try decode.array(rows, n.application_state.duty_batch_max));
        for (out.attesters[0..out.attester_count], 0..) |*row, i| {
            const entry = try rows.getElement(@intCast(i));
            try decode.completeObject(entry, &.{ "slot", "subnets", "aggregators" });
            row.* = .{
                .slot = try decode.integer(try decode.get(entry, "slot"), 9007199254740990),
                .subnets = try decode.bigint(try decode.get(entry, "subnets")),
                .aggregators = try decode.bigint(try decode.get(entry, "aggregators")),
            };
        }
    }
    if (try value.hasNamedProperty("syncCommittees")) {
        const rows = try decode.get(value, "syncCommittees");
        const count = try decode.array(rows, 4);
        for (0..count) |i| {
            const entry = try rows.getElement(@intCast(i));
            try decode.completeObject(entry, &.{ "subnet", "untilSlot" });
            const subnet = try decode.integer(try decode.get(entry, "subnet"), 3);
            const slot = try decode.integer(try decode.get(entry, "untilSlot"), 9007199254740990);
            out.sync_until[subnet] = @max(out.sync_until[subnet] orelse 0, slot);
        }
    }
}
