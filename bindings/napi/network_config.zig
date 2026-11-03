const std = @import("std");
const p = @import("preset").preset;
const napi = @import("zapi:zapi").napi;
const n = @import("network");
const d = @import("discv5");
const Value = napi.Value;
const decode = @import("network_js_input.zig");
const t = n.peers.types;
const enr_max = d.wire.constants.enr_size_max;
const bootstrap_max = n.peers.Discovery.bootstrap_max;
const BeaconConfig = @import("config").BeaconConfig;

pub const Config = struct {
    secret: [32]u8,
    bind: n.udp.Sockets.Bindings,
    local: t.LocalState,
    clock: n.SlotClock,
    chain: n.chain.Config,
    state: n.application_state.Config,
    discovery_bind: ?n.udp.Sockets.Bindings,
    discovery_sequence: u64,
    advertisement: ?n.advertisement.Hints,
    fixed: n.advertisement.Endpoints,
    bootstrap: [bootstrap_max]struct { bytes: [enr_max]u8, len: u16 },
    bootstrap_count: u8,
    gossip: n.gossipsub.Gossipsub.Options,
    processor_limits: n.gossip_processor.limits.Limits = undefined,
    execution_limits: ?n.gossip_processor.limits.Limits = null,

    pub fn wipe(self: *Config) void {
        std.crypto.secureZero(u8, &self.secret);
    }
};

fn optionalBigint(value: Value) !?u64 {
    return if (try value.typeof() == .null) null else try decode.bigint(value);
}
pub fn bindings(value: Value) !n.udp.Sockets.Bindings {
    if (!try value.isArray()) return .single(try decode.endpoint(value));
    const count = try decode.array(value, 2);
    if (count == 0) return error.InvalidNetworkConfig;
    const first = try decode.endpoint(try value.getElement(0));
    if (count == 1) return .single(first);
    const second = try decode.endpoint(try value.getElement(1));
    if (std.meta.activeTag(first) == std.meta.activeTag(second)) return error.InvalidNetworkConfig;
    return .{ .dual = .{
        .ip4 = if (first == .ip4) first.ip4 else second.ip4,
        .ip6 = if (first == .ip6) first.ip6 else second.ip6,
    } };
}

pub fn parse(value: Value, beacon: *const BeaconConfig, out: *Config) !void {
    out.* = .{
        .secret = @splat(0),
        .bind = undefined,
        .local = .{},
        .clock = undefined,
        .chain = undefined,
        .state = undefined,
        .discovery_bind = null,
        .discovery_sequence = 0,
        .advertisement = null,
        .fixed = .{},
        .bootstrap = undefined,
        .bootstrap_count = 0,
        .gossip = undefined,
    };
    errdefer out.wipe();
    out.secret = try decode.fixed(32, try decode.get(value, "identitySecretKey"));
    out.bind = try bindings(try decode.get(value, "bind"));
    var subscription_options: n.application_state.Options = .{};
    const subscriptions = try decode.get(value, "subscriptions");
    if (try subscriptions.typeof() != .undefined) {
        try decode.completeObject(subscriptions, &.{ "subscribeAllSubnets", "slotsToSubscribeBeforeAggregatorDuty", "targetGroupPeers" });
        subscription_options = .{
            .subscribe_all_subnets = try decode.boolean(try decode.get(subscriptions, "subscribeAllSubnets")),
            .aggregator_lead_slots = try decode.integer(try decode.get(subscriptions, "slotsToSubscribeBeforeAggregatorDuty"), 2 * p.SLOTS_PER_EPOCH),
            .target_group_peers = @intCast(try decode.integer(try decode.get(subscriptions, "targetGroupPeers"), 256)),
        };
    }
    out.clock = try n.SlotClock.init(&beacon.chain, try decode.bigint(try decode.get(value, "genesisTime")));
    out.state = try n.application_state.Config.init(&beacon.chain, subscription_options);
    try parseLocal(try decode.get(value, "local"), &out.local);
    out.chain = try n.chain.Config.init(beacon, try decode.boolean(try decode.get(value, "serveLightClients")));
    if (out.chain.fulu_scheduled and out.local.status.earliest_available_slot == null) return error.MissingAvailability;
    const discovery = try decode.get(value, "discovery");
    if (try discovery.typeof() != .null) {
        try decode.object(discovery, &.{ "bind", "sequenceNumber", "bootstrapEnrs", "advertisement", "fixed" });
        out.discovery_bind = try bindings(try decode.get(discovery, "bind"));
        out.discovery_sequence = try decode.bigint(try decode.get(discovery, "sequenceNumber"));
        const bootstrap = try decode.get(discovery, "bootstrapEnrs");
        out.bootstrap_count = @intCast(try decode.array(bootstrap, bootstrap_max));
        for (0..out.bootstrap_count) |i| {
            const entry = try bootstrap.getElement(@intCast(i));
            const view = try decode.byteView(entry);
            if (view.len == 0 or view.len > enr_max) return error.InvalidNetworkBytes;
            @memcpy(out.bootstrap[i].bytes[0..view.len], view);
            out.bootstrap[i].len = @intCast(view.len);
        }
        const hints = try decode.get(discovery, "advertisement");
        if (try hints.typeof() != .null) {
            try decode.object(hints, &.{ "ip4", "ip6", "udp", "udp6" });
            const endpoints = (try parseEndpoints(hints)).?;
            out.advertisement = .{ .ip4 = endpoints.ip4, .ip6 = endpoints.ip6, .udp = endpoints.udp, .udp6 = endpoints.udp6 };
        }
        out.fixed = (try parseEndpoints(try decode.get(discovery, "fixed"))) orelse return error.InvalidNetworkConfig;
        if (out.fixed.ip6) |ip| if (n.Address.isIp4Mapped(ip)) return error.InvalidNetworkConfig;
        inline for (.{ out.fixed.udp, out.fixed.udp6, out.fixed.quic, out.fixed.quic6 }) |port| if (port == 0) return error.InvalidNetworkInteger;
    }
    try parseGossip(value, beacon, out);
}

fn parseGossip(value: Value, beacon: *const BeaconConfig, out: *Config) !void {
    const validators = try decode.integer(try decode.get(value, "activeValidatorCount"), 9007199254740991);
    out.gossip = try n.application_policy.gossip(&beacon.chain, validators);
    out.gossip.message_id_policy = .{ .phase0_digest = out.chain.phase0_digest };
    const boundaries = out.chain.topics[0..out.chain.boundary_count];
    out.processor_limits = try n.application_policy.processor(boundaries, validators);
    try out.gossip.setPayloadLimits(&out.processor_limits);
    const policy = try decode.get(value, "gossipPolicy");
    if (try policy.typeof() == .undefined) {
        out.execution_limits = try n.application_policy.execution(boundaries, &out.processor_limits, .{});
        return;
    }
    try decode.object(policy, &.{ "activeSendTimeoutMs", "activeSendItems", "largeFrameTimeoutMs", "receiveBufferBytes", "hostItems", "hostBytes", "topicConcurrency" });
    var budget: n.application_policy.Execution = .{};
    inline for (.{
        .{ "hostItems", "items", 16384 },
        .{ "hostBytes", "bytes", 1024 * 1024 * 1024 },
        .{ "topicConcurrency", "concurrency", 16384 },
    }) |field| {
        const override = try decode.get(policy, field[0]);
        if (try override.typeof() != .undefined) @field(budget, field[1]) = @intCast(try decode.integer(override, field[2]));
    }
    out.execution_limits = try n.application_policy.execution(boundaries, &out.processor_limits, budget);
    inline for (.{
        .{ "activeSendTimeoutMs", "active_send_timeout_ms" },
        .{ "largeFrameTimeoutMs", "large_frame_timeout_ms" },
    }) |field| {
        const override = try decode.get(policy, field[0]);
        if (try override.typeof() != .undefined) @field(out.gossip, field[1]) = try decode.bigint(override);
    }
    const receive = try decode.get(policy, "receiveBufferBytes");
    if (try receive.typeof() != .undefined) out.gossip.receive_arena_bytes = @intCast(try decode.integer(receive, 1024 * 1024 * 1024));
    if (try (try decode.get(policy, "activeSendItems")).typeof() != .undefined) {
        const active_items = try decode.get(policy, "activeSendItems");
        try decode.object(active_items, &topic_kind_names);
        inline for (std.meta.fields(n.gossipsub.topic.Kind), 0..) |field, index| {
            if (try active_items.hasNamedProperty(field.name)) out.gossip.active_send_items[index] = @intCast(try decode.integer(try decode.get(active_items, field.name), n.gossipsub.constants.peers_cap));
        }
    }
}

pub const topic_kind_names = blk: {
    var names: [n.gossipsub.topic_policy.kind_count][]const u8 = undefined;
    for (std.meta.fieldNames(n.gossipsub.topic.Kind), 0..) |name, i| names[i] = name;
    break :blk names;
};

pub fn parseStatus(status: Value, out: *t.Status) !void {
    try decode.object(status, &.{ "finalizedRoot", "finalizedEpoch", "headRoot", "headSlot", "earliestAvailableSlot" });
    out.fork_digest = @splat(0);
    out.finalized_root = try decode.fixed(32, try decode.get(status, "finalizedRoot"));
    out.finalized_epoch = try decode.bigint(try decode.get(status, "finalizedEpoch"));
    out.head_root = try decode.fixed(32, try decode.get(status, "headRoot"));
    out.head_slot = try decode.bigint(try decode.get(status, "headSlot"));
    out.earliest_available_slot = try optionalBigint(try decode.get(status, "earliestAvailableSlot"));
}

pub fn parseLocal(local: Value, out: *t.LocalState) !void {
    try decode.object(local, &.{ "status", "metadata" });
    try parseStatus(try decode.get(local, "status"), &out.status);
    const metadata = try decode.get(local, "metadata");
    try decode.object(metadata, &.{ "sequenceNumber", "attnets", "syncnets", "custodyGroupCount" });
    out.*.metadata.seq_number = try decode.bigint(try decode.get(metadata, "sequenceNumber"));
    out.*.metadata.attnets = try decode.fixed(8, try decode.get(metadata, "attnets"));
    out.*.metadata.syncnets = @intCast(try decode.integer(try decode.get(metadata, "syncnets"), 15));
    out.*.metadata.custody_group_count = try optionalBigint(try decode.get(metadata, "custodyGroupCount"));
    out.fork = .{};
}

pub fn parseEndpoints(ad: Value) !?n.advertisement.Endpoints {
    if (try ad.typeof() != .null) {
        try decode.object(ad, &.{ "ip4", "ip6", "udp", "udp6", "quic", "quic6" });
        var result: n.advertisement.Endpoints = .{};
        inline for (.{ "ip4", "ip6" }) |key| {
            if (try ad.hasNamedProperty(key)) @field(result, key) = try decode.fixed(if (std.mem.eql(u8, key, "ip4")) 4 else 16, try decode.get(ad, key));
        }
        inline for (.{ "udp", "udp6", "quic", "quic6" }) |key| {
            if (try ad.hasNamedProperty(key)) {
                const port = try decode.integer(try decode.get(ad, key), 65535);
                @field(result, key) = @intCast(port);
            }
        }
        return result;
    }
    return null;
}
