const std = @import("std");
const constants = @import("constants.zig");
const topic_mod = @import("topic.zig");
const score_mod = @import("score.zig");
const storage = @import("message_store.zig");
const topic_policy_mod = @import("topic_policy.zig");
const quic_limits = @import("../quic/limits.zig");
const peer_book = @import("peer_book.zig");
const gossip_limits = @import("../gossip_limits.zig");
const outbox = @import("outbox.zig");
const preset = @import("preset");
const mcache = @import("mcache.zig");
const active_send = @import("active_send.zig");

pub const mcache_arena_bytes_min = constants.maxCompressedLen(constants.MAX_PAYLOAD_SIZE) + storage.page_bytes;
pub const seen_capacity_max = 1_048_576;

pub const Options = struct {
    /// Required startup namespace. The owner copies it during initialization.
    topic_policy: []const topic_policy_mod.Boundary = &.{},
    connected_capacity: u16 = constants.peers_cap,
    /// Engine connection slots; a session is found by its connection's index.
    connection_slots: u16 = quic_limits.connections_max_ceiling,
    /// At least twice connected_capacity plus retained_outbound_reserve, so pending
    /// identities cannot consume the rows reserved for live connections.
    retained_capacity: u16 = peer_book.capacity,
    retained_outbound_reserve: u16 = peer_book.outbound_reserve,
    message_id_policy: topic_mod.MessageIdPolicy = .{},
    iwant_followup_ms: u64 = constants.default_iwant_followup_ms,
    idontwant_min_data_size: usize = constants.default_idontwant_min_data_size,
    heartbeat_interval_ms: u64 = constants.heartbeat_interval_ms,
    seen_capacity: usize = 65_536,
    /// The smallest message history; processor limits can raise it (see `Layout.historyCapacity`).
    mcache_capacity: usize = 8_192,
    mcache_arena_bytes: usize = 64 * 1024 * 1024,
    /// Compressed pending and retained payload allowances; their lifetimes differ from decoded work.
    payload_limits: ?gossip_limits.Limits = null,
    validation_capacity: usize = 1024,
    validation_timeout_ms: u64 = 30_000,
    validation_tombstone_ms: u64 = 30_000,
    /// Absolute receive-frame residence and local-pressure wait limit.
    pressure_timeout_ms: u64 = 30_000,
    /// Pending data expiry and queued control residence.
    tx_timeout_ms: u64 = 30_000,
    /// Absolute active-frame lifetime; large payloads share the first recipient's deadline.
    active_send_timeout_ms: u64 = 6_000,
    /// Distinct large payloads per kind, shared across recipients.
    active_send_items: [gossip_limits.kind_count]u16 = @splat(8),
    control_bytes: usize = 28 * 1024,
    critical_bytes: usize = outbox.critical_bytes,
    peers_per_pump: usize = 32,
    topics_per_pump: usize = 4,
    items_per_peer: usize = 32,
    items_per_pump: usize = 128,
    input_per_peer: usize = 128 * 1024,
    input_per_pump: usize = 1024 * 1024,
    output_per_peer: usize = 128 * 1024,
    output_per_pump: usize = 1024 * 1024,
    work_per_pump: usize = 8 * 1024 * 1024,
    calls_per_peer: usize = 64,
    calls_per_pump: usize = 256,
    /// Ordinary per-peer compressed-copy/decode/hash byte credits; one legal oversized item may use the shared allowance.
    decompress_per_peer_bytes: usize = 4 * 1024 * 1024,
    /// Absolute large receive-frame lifetime and receive progress timeout.
    large_frame_timeout_ms: u64 = 6_000,
    body_buffer_bytes: usize = constants.body_buffer_len,
    receive_arena_bytes: usize = 128 * 1024 * 1024,
    seen_ttl_ms: u64 = constants.seenTtlMs(preset.preset.SLOTS_PER_EPOCH, 12),
    gossip_factor: f64 = 0.25,
    retained_score_ms: u64 = 100 * preset.preset.SLOTS_PER_EPOCH * 12_000,
    ip_allowlist: []const peer_book.Ip = &.{},
    score_params: score_mod.Params = .{},
    topic_params: ?[topic_policy_mod.kind_count]score_mod.TopicPolicy = null,
    initial_slot: u64 = 0,
    opportunistic_graft_interval_ms: u64 = constants.opportunistic_graft_ms,
    /// Required independent host entropy. Initialization rejects null; tests seed explicitly.
    random_seed: ?u64 = null,

    pub fn setPayloadLimits(o: *Options, limits: *const gossip_limits.Limits) error{InvalidLimits}!void {
        gossip_limits.validate(limits) catch return error.InvalidLimits;
        if (o.heartbeat_interval_ms == 0 or o.heartbeat_interval_ms > 86_400_000 or o.seen_ttl_ms == 0 or o.seen_ttl_ms > 86_400_000) return error.InvalidLimits;
        o.payload_limits = limits.*;
        o.validation_capacity = gossip_limits.items(limits);
        const history_ms = o.heartbeat_interval_ms * constants.mcache_len;
        const windows = std.math.divCeil(u64, o.seen_ttl_ms, history_ms) catch unreachable;
        o.seen_capacity = @intCast(@min(seen_capacity_max, @max(o.seen_capacity, o.validation_capacity * windows)));
        // Pending validation and retained history each receive the configured byte allowance.
        o.mcache_arena_bytes = @max(2 * gossip_limits.bytes(limits), mcache_arena_bytes_min);
    }

    pub fn activeSendLimits(o: *const Options) gossip_limits.Limits {
        var limits: gossip_limits.Limits = @splat(.{ .items = 0, .bytes = 0 });
        for (o.topic_policy) |*boundary| {
            for (boundary.rules, &limits, 0..) |rule, *limit, k| {
                if (rule.count == 0) continue;
                const compressed = constants.maxCompressedLen(rule.ssz_max);
                if (compressed + 32 + topic_mod.topic_max_len <= active_send.small_frame_bytes) continue;
                limit.items = o.active_send_items[k];
                limit.bytes = @max(limit.bytes, @as(u32, @intCast(storage.Store.pagesFor(compressed) * storage.page_bytes * o.active_send_items[k])));
            }
        }
        return limits;
    }

    pub fn deliveryKindLimits(o: *const Options) ?gossip_limits.Limits {
        var limits = o.payload_limits orelse return null;
        for (&limits) |*limit| {
            limit.items = @max(1, limit.items / 4);
            limit.bytes /= 4;
        }
        return limits;
    }

    pub fn validate(o: *const Options) (error{InvalidLimits} || topic_policy_mod.Error)!void {
        _ = try topic_policy_mod.validate(o.topic_policy);
        try score_mod.validateParams(o.score_params);
        if (o.topic_params) |*policies| for (policies) |*policy| {
            try score_mod.validateTopic(policy.params);
            try score_mod.validateTopic(policy.atSlot(0));
        };
        if (o.random_seed == null or o.ip_allowlist.len > 32 or o.retained_score_ms == 0 or o.retained_score_ms > 86_400_000) return error.InvalidLimits;
        if (!std.math.isFinite(o.gossip_factor) or o.gossip_factor < 0 or o.gossip_factor > 1) return error.InvalidLimits;
        try range(o.connected_capacity, 1, constants.peers_cap);
        try range(o.connection_slots, 1, quic_limits.connections_max_ceiling);
        try range(o.retained_capacity, o.connected_capacity, peer_book.capacity);
        try range(o.retained_outbound_reserve, 1, o.retained_capacity - 1);
        _ = try peer_book.PeerBook.pinLimit(o.retained_capacity, o.connected_capacity, o.retained_outbound_reserve);
        try range(o.validation_capacity, 1, 65535);
        if (o.payload_limits) |limits| {
            gossip_limits.validate(&limits) catch return error.InvalidLimits;
            for (o.topic_policy) |boundary| {
                for (boundary.rules, limits) |rule, limit| if (rule.count > 0 and constants.maxCompressedLen(rule.ssz_max) > limit.bytes) return error.InvalidLimits;
            }
            if (o.validation_capacity != gossip_limits.items(&limits) or o.mcache_arena_bytes < 2 * gossip_limits.bytes(&limits)) return error.InvalidLimits;
        }
        try range(o.seen_capacity, 1, seen_capacity_max);
        try range(o.mcache_capacity, 1, mcache.History.capacity_max);
        try range(o.mcache_arena_bytes, mcache_arena_bytes_min, 1024 * 1024 * 1024);
        const page = @import("receive_pool.zig").page_bytes;
        const receive_min = @max(page, std.mem.alignForward(usize, constants.GOSSIP_MAX_SIZE - @min(o.body_buffer_bytes, constants.GOSSIP_MAX_SIZE), page));
        try range(o.receive_arena_bytes, receive_min, 1024 * 1024 * 1024);
        if (o.receive_arena_bytes % page != 0) return error.InvalidLimits;
        try range(o.body_buffer_bytes, 1, constants.GOSSIP_MAX_SIZE);
        try range(o.control_bytes, 1, 65536);
        try range(o.critical_bytes, 32 + topic_mod.topic_max_len, outbox.critical_bytes);
        try range(o.topics_per_pump, 1, constants.topics_cap);
        try range(o.peers_per_pump, 1, constants.peers_cap);
        try range(o.items_per_peer, 1, 4096);
        try range(o.items_per_pump, 1, 16384);
        try range(o.calls_per_peer, 1, 4096);
        try range(o.calls_per_pump, 1, 65536);
        const byte_credits = [_]usize{ o.input_per_peer, o.input_per_pump, o.output_per_peer, o.output_per_pump, o.work_per_pump, o.decompress_per_peer_bytes };
        for (byte_credits) |bytes| try range(bytes, 1, 128 * 1024 * 1024);
        try range(o.idontwant_min_data_size, 0, constants.GOSSIP_MAX_SIZE);
        for (o.active_send_items) |items| try range(items, 1, constants.peers_cap);
        const timers = [_]u64{ o.active_send_timeout_ms, o.iwant_followup_ms, o.heartbeat_interval_ms, o.validation_timeout_ms, o.validation_tombstone_ms, o.pressure_timeout_ms, o.tx_timeout_ms, o.large_frame_timeout_ms, o.seen_ttl_ms, o.opportunistic_graft_interval_ms };
        for (timers) |timer| if (timer == 0 or timer > 86_400_000) return error.InvalidLimits;
    }
};

fn range(value: usize, min: usize, max: usize) error{InvalidLimits}!void {
    if (value < min or value > max) return error.InvalidLimits;
}

test {
    _ = @import("options_test.zig");
}
