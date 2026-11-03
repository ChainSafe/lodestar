const std = @import("std");
const constants = @import("constants.zig");
const topic_policy = @import("topic_policy.zig");

const assert = std.debug.assert;
const Allocator = std.mem.Allocator;

pub const TopicParams = struct {
    weight: f64 = 1.0,
    time_in_mesh_weight: f64 = 0.03,
    time_in_mesh_cap: f64 = 300.0,
    time_in_mesh_quantum_ms: u64 = 1_000,
    first_delivery_weight: f64 = 1.0,
    first_delivery_cap: f64 = 100.0,
    first_delivery_decay: f64 = 0.9,
    mesh_delivery_weight: f64 = -1.0,
    mesh_delivery_threshold: f64 = 5.0,
    mesh_delivery_cap: f64 = 50.0,
    mesh_delivery_decay: f64 = 0.9,
    mesh_delivery_activation_ms: u64 = 30_000,
    mesh_delivery_window_ms: u64 = 10,
    mesh_failure_weight: f64 = -1.0,
    mesh_failure_decay: f64 = 0.9,
    invalid_weight: f64 = -100.0,
    invalid_decay: f64 = 0.9,
};

pub const TopicPolicy = struct {
    params: TopicParams = .{},
    mesh_delivery_start_slot: u64 = 0,

    pub fn atSlot(self: *const TopicPolicy, slot: u64) TopicParams {
        var params = self.params;
        if (slot < self.mesh_delivery_start_slot) {
            params.mesh_delivery_weight = 0;
            params.mesh_delivery_threshold = 0;
        }
        return params;
    }
};

/// Global weights, thresholds, and decay cadence.
pub const Params = struct {
    ip_colocation_weight: f64 = 0,
    ip_colocation_threshold: u16 = 3,
    behaviour_weight: f64 = -10.0,
    behaviour_threshold: f64 = 6.0,
    behaviour_decay: f64 = 0.9,
    topic_cap: f64 = 3200.0,
    decay_interval_ms: u64 = 12_000,
    decay_to_zero: f64 = 0.01,
    gossip_threshold: f64 = -4000.0,
    publish_threshold: f64 = -8000.0,
    graylist_threshold: f64 = -16000.0,
    opportunistic_graft_threshold: f64 = 5.0,
    topic: TopicParams = .{},
};

pub const TopicCounters = struct {
    in_mesh: bool = false,
    graft_ms: u64 = 0,
    delivery_restart_ms: u64 = 0,
    first_deliveries: f64 = 0,
    mesh_deliveries: f64 = 0,
    mesh_failures: f64 = 0,
    invalid: f64 = 0,
};

pub const TopicWeights = struct {
    p1: f64 = 0,
    p2: f64 = 0,
    p3: f64 = 0,
    p3b: f64 = 0,
    p4: f64 = 0,

    pub fn total(self: *const TopicWeights) f64 {
        return self.p1 + self.p2 + self.p3 + self.p3b + self.p4;
    }
};

pub const GlobalWeights = struct { p5: f64 = 0, p6: f64 = 0, p7: f64 = 0 };
/// Protocol violations that each add one P7 behaviour penalty unit.
pub const Penalty = enum { graft_backoff, graft_flood, broken_iwant, malformed_rpc, malformed_frame };
pub const Breakdown = struct {
    topics: []TopicWeights,
    global: GlobalWeights = .{},
};

pub const PeerScore = struct {
    /// Uncached score evaluations and the topic rows they visited, which the caching tests and
    /// the network bench read.
    calculations: u64 = 0,
    topic_visits: u64 = 0,
    /// Applied behaviour penalty units by violation. Decay lowers peer counters, never these.
    penalties: [std.meta.fields(Penalty).len]u64 = @splat(0),
    params: Params,
    topics: []TopicCounters,
    rows: []PeerState,
    topic_params: []TopicParams,

    pub const PeerState = struct {
        behaviour: f64 = 0,
        connected: bool = false,
        last_decay_ms: ?u64 = null,
        dirty: bool = true,
        cached_until: ?u64 = null,
        cached_at: ?u64 = null,
        cached: f64 = 0,
        cached_ip: u16 = 0,
    };

    pub fn backingBytes(count: usize) usize {
        return backingBytesForTopics(count, constants.topics_cap);
    }

    pub fn backingBytesForTopics(count: usize, topics: usize) usize {
        return count * (@sizeOf(PeerState) + topics * @sizeOf(TopicCounters)) + topics * @sizeOf(TopicParams);
    }

    pub fn init(allocator: Allocator, params: Params, count: u16) (Allocator.Error || error{InvalidLimits})!PeerScore {
        return initForTopics(allocator, params, count, constants.topics_cap);
    }

    pub fn initForTopics(allocator: Allocator, params: Params, count: u16, topic_count: usize) (Allocator.Error || error{InvalidLimits})!PeerScore {
        if (count == 0 or count > peer_capacity or topic_count == 0 or topic_count > topic_policy.topic_max) return error.InvalidLimits;
        try validateParams(params);
        const cells = @as(usize, count) * topic_count;
        const topics = try allocator.alloc(TopicCounters, cells);
        errdefer allocator.free(topics);
        @memset(topics, .{});
        const rows = try allocator.alloc(PeerState, count);
        errdefer allocator.free(rows);
        @memset(rows, .{});
        const topic_params = try allocator.alloc(TopicParams, topic_count);
        errdefer allocator.free(topic_params);
        @memset(topic_params, params.topic);
        return .{
            .params = params,
            .topic_params = topic_params,
            .topics = topics,
            .rows = rows,
        };
    }

    pub fn deinit(self: *PeerScore, allocator: Allocator) void {
        allocator.free(self.topic_params);
        allocator.free(self.rows);
        allocator.free(self.topics);
        self.* = undefined;
    }

    fn load(self: *const PeerScore, peer: u16, topic: u16) TopicCounters {
        const index = @as(usize, peer) * self.topic_params.len + topic;
        assert(index < self.topics.len);
        return self.topics[index];
    }

    fn store(self: *PeerScore, peer: u16, topic: u16, next: TopicCounters) void {
        const index = @as(usize, peer) * self.topic_params.len + topic;
        assert(index < self.topics.len);
        if (observable(&self.topic_params[topic], &self.topics[index], &next)) self.rows[peer].dirty = true;
        self.topics[index] = next;
    }

    /// Clears every counter for a peer whose slot is being reused.
    pub fn resetPeer(self: *PeerScore, peer: u16) void {
        self.rows[peer] = .{};
        const base = @as(usize, peer) * self.topic_params.len;
        @memset(self.topics[base..][0..self.topic_params.len], .{});
    }

    pub fn graft(self: *PeerScore, peer: u16, topic: u16, now_ms: u64) void {
        var next = self.load(peer, topic);
        if (!next.in_mesh) next.graft_ms = now_ms;
        next.in_mesh = true;
        self.store(peer, topic, next);
    }

    pub fn prune(self: *PeerScore, peer: u16, topic: u16, now_ms: u64) void {
        var next = self.load(peer, topic);
        const params = self.topic_params[topic];
        const elapsed = now_ms -| @max(next.graft_ms, next.delivery_restart_ms);
        if (next.in_mesh and elapsed > params.mesh_delivery_activation_ms and
            next.mesh_deliveries < params.mesh_delivery_threshold)
        {
            const deficit = params.mesh_delivery_threshold - next.mesh_deliveries;
            next.mesh_failures = @min(counter_max, next.mesh_failures + deficit * deficit);
        }
        next.in_mesh = false;
        self.store(peer, topic, next);
    }

    pub fn deliverEligible(self: *PeerScore, peer: u16, topic: u16, mesh_eligible: bool) void {
        var next = self.load(peer, topic);
        next.first_deliveries = @min(next.first_deliveries + 1, self.topic_params[topic].first_delivery_cap);
        self.store(peer, topic, next);
        if (mesh_eligible) self.creditMesh(peer, topic);
    }

    pub fn creditMesh(self: *PeerScore, peer: u16, topic: u16) void {
        var next = self.load(peer, topic);
        next.mesh_deliveries = @min(next.mesh_deliveries + 1, self.topic_params[topic].mesh_delivery_cap);
        self.store(peer, topic, next);
    }

    /// Locally refused attribution leaves an incomplete delivery sample. Resume deficit
    /// scoring after a full observation interval, without awarding delivery credit.
    pub fn localPressure(self: *PeerScore, peer: u16, topic: u16, now_ms: u64) void {
        var next = self.load(peer, topic);
        if (!next.in_mesh) return;
        next.delivery_restart_ms = @max(next.delivery_restart_ms, now_ms);
        self.store(peer, topic, next);
    }

    pub fn invalid(self: *PeerScore, peer: u16, topic: u16) void {
        var next = self.load(peer, topic);
        next.invalid = @min(counter_max, next.invalid + 1);
        self.store(peer, topic, next);
    }

    pub fn penalize(self: *PeerScore, peer: u16, amount: f64) void {
        assert(safeMagnitude(amount) and amount >= 0);
        self.rows[peer].dirty = true;
        self.rows[peer].behaviour = @min(counter_max, self.rows[peer].behaviour + amount);
    }

    pub fn penalizeFor(self: *PeerScore, peer: u16, violation: Penalty) void {
        self.penalize(peer, 1);
        self.penalties[@intFromEnum(violation)] +|= 1;
    }

    pub fn score(self: *PeerScore, peer: u16, now_ms: u64, ip_count: u16) f64 {
        assert(peer < self.rows.len);
        const row = &self.rows[peer];
        if (self.cached(peer, now_ms, ip_count)) |value| return value;
        self.calculations +|= 1;
        self.topic_visits +|= self.topic_params.len;
        const result = self.evaluate(peer, now_ms, ip_count, null);
        row.dirty = false;
        row.cached_at = now_ms;
        row.cached_until = result.next_change;
        row.cached_ip = ip_count;
        row.cached = result.total;
        return result.total;
    }

    /// Evaluates current counters without changing decay, cache validity or policy metrics. A valid
    /// cached score is that evaluation, so it answers without one.
    pub fn snapshot(self: *const PeerScore, peer: u16, now_ms: u64, ip_count: u16) f64 {
        assert(peer < self.rows.len);
        return self.cached(peer, now_ms, ip_count) orelse self.evaluate(peer, now_ms, ip_count, null).total;
    }

    /// The cached score while no counter value `evaluate` reads, parameter or IP population changed
    /// since it was computed and no time-driven term has moved.
    fn cached(self: *const PeerScore, peer: u16, now_ms: u64, ip_count: u16) ?f64 {
        const row = &self.rows[peer];
        const at = row.cached_at orelse return null;
        if (row.dirty or now_ms < at or row.cached_ip != ip_count) return null;
        if (row.cached_until) |until| if (now_ms >= until) return null;
        return row.cached;
    }

    pub fn snapshotWeights(self: *const PeerScore, peer: u16, now_ms: u64, ip_count: u16, out: *Breakdown) f64 {
        assert(out.topics.len == self.topic_params.len);
        @memset(out.topics, .{});
        out.global = .{};
        return self.evaluate(peer, now_ms, ip_count, out).total;
    }

    fn evaluate(self: *const PeerScore, peer: u16, now_ms: u64, ip_count: u16, out: ?*Breakdown) struct { total: f64, next_change: ?u64 } {
        assert(peer < self.rows.len);
        const row = &self.rows[peer];
        var next_change: ?u64 = null;
        var total: f64 = 0;
        var topic: usize = 0;
        while (topic < self.topic_params.len) : (topic += 1) {
            const params = &self.topic_params[topic];
            const counters = &self.topics[@as(usize, peer) * self.topic_params.len + topic];
            if (!counters.in_mesh and counters.first_deliveries == 0 and
                counters.mesh_failures == 0 and counters.invalid == 0) continue;
            var weights: TopicWeights = .{};
            const elapsed: u64 = if (counters.in_mesh) now_ms -| counters.graft_ms else 0;
            const delivery_start = @max(counters.graft_ms, counters.delivery_restart_ms);
            const delivery_elapsed = now_ms -| delivery_start;
            if (counters.in_mesh) {
                const p1 = @min(
                    @as(f64, @floatFromInt(elapsed / params.time_in_mesh_quantum_ms)),
                    params.time_in_mesh_cap,
                );
                weights.p1 = params.time_in_mesh_weight * p1;
                if (params.weight != 0 and params.time_in_mesh_weight != 0 and p1 < params.time_in_mesh_cap) {
                    const remaining = params.time_in_mesh_quantum_ms - elapsed % params.time_in_mesh_quantum_ms;
                    const start = @max(now_ms, counters.graft_ms);
                    if (remaining <= std.math.maxInt(u64) - start) {
                        const next = start + remaining;
                        next_change = @min(next_change orelse next, next);
                    }
                }
                if (params.weight != 0 and params.mesh_delivery_weight != 0 and
                    counters.mesh_deliveries < params.mesh_delivery_threshold and delivery_elapsed <= params.mesh_delivery_activation_ms and
                    params.mesh_delivery_activation_ms < std.math.maxInt(u64) - delivery_start)
                {
                    const next = delivery_start + params.mesh_delivery_activation_ms + 1;
                    next_change = @min(next_change orelse next, next);
                }
            }
            weights.p2 = params.first_delivery_weight *
                @min(counters.first_deliveries, params.first_delivery_cap);
            if (counters.in_mesh and delivery_elapsed > params.mesh_delivery_activation_ms and
                counters.mesh_deliveries < params.mesh_delivery_threshold)
            {
                const deficit = params.mesh_delivery_threshold - counters.mesh_deliveries;
                weights.p3 = params.mesh_delivery_weight * deficit * deficit;
            }
            weights.p3b = params.mesh_failure_weight * counters.mesh_failures;
            weights.p4 = params.invalid_weight * counters.invalid * counters.invalid;
            total += params.weight * weights.total();
            if (out) |details| details.topics[topic] = weights;
        }
        if (self.params.topic_cap > 0 and total > self.params.topic_cap) {
            total = self.params.topic_cap;
        }
        var global: GlobalWeights = .{};
        if (row.behaviour > self.params.behaviour_threshold) {
            const excess = row.behaviour - self.params.behaviour_threshold;
            global.p7 = self.params.behaviour_weight * excess * excess;
            total += global.p7;
        }
        const excess_ip: f64 = @floatFromInt(ip_count -| self.params.ip_colocation_threshold);
        global.p6 = self.params.ip_colocation_weight * excess_ip * excess_ip;
        total += global.p6;
        if (out) |details| details.global = global;
        assert(std.math.isFinite(total));
        return .{ .total = total, .next_change = next_change };
    }

    /// Whether `evaluate` reads a different value from `after` than from `before`. A zero-weight
    /// topic sets no deadline and adds its finite terms times zero, which leaves the total unchanged;
    /// the graft time is read only in the mesh, and mesh deliveries only in the mesh and below the
    /// threshold.
    fn observable(params: *const TopicParams, before: *const TopicCounters, after: *const TopicCounters) bool {
        if (params.weight == 0) return false;
        if (before.in_mesh != after.in_mesh or before.first_deliveries != after.first_deliveries or
            before.mesh_failures != after.mesh_failures or before.invalid != after.invalid) return true;
        if (!after.in_mesh) return false;
        const threshold = params.mesh_delivery_threshold;
        return before.graft_ms != after.graft_ms or before.delivery_restart_ms != after.delivery_restart_ms or (before.mesh_deliveries != after.mesh_deliveries and
            (before.mesh_deliveries < threshold or after.mesh_deliveries < threshold));
    }

    /// Valid after a cached score read. Background refresh invalidates on counter decay;
    /// reads never advance decay or change the heartbeat's fixed score snapshot.
    pub fn nextChange(self: *const PeerScore, peer: u16) ?u64 {
        assert(peer < self.rows.len and !self.rows[peer].dirty);
        return self.rows[peer].cached_until;
    }

    pub fn resetTopic(self: *PeerScore, topic: u16) void {
        for (0..self.rows.len) |peer| {
            assert(!self.load(@intCast(peer), topic).in_mesh);
            self.store(@intCast(peer), topic, .{});
        }
    }

    pub fn retainsTopic(self: *const PeerScore, topic: u16) bool {
        assert(topic < self.topic_params.len);
        for (0..self.rows.len) |peer| {
            const counters = &self.topics[peer * self.topic_params.len + topic];
            if (counters.in_mesh or counters.first_deliveries != 0 or counters.mesh_deliveries != 0 or
                counters.mesh_failures != 0 or counters.invalid != 0) return true;
        }
        return false;
    }

    pub fn configureTopic(self: *PeerScore, topic: u16, params: TopicParams) error{InvalidLimits}!void {
        assert(topic < self.topic_params.len);
        try validateTopic(params);
        self.applyValidatedTopic(topic, params);
    }

    /// Params must pass validateTopic before entering a prepared owner transaction.
    pub fn applyValidatedTopic(self: *PeerScore, topic: u16, params: TopicParams) void {
        assert(topic < self.topic_params.len);
        if (std.meta.eql(self.topic_params[topic], params)) return;
        self.topic_params[topic] = params;
        for (self.rows) |*row| row.dirty = true;
    }

    /// Classify before removing mesh time or IP weight. Positive peers lose all score counters;
    /// retained non-positive peers lose first-delivery credit and keep their mesh failure evidence.
    pub fn disconnect(self: *PeerScore, peer: u16, now_ms: u64, ip_count: u16) void {
        assert(peer < self.rows.len and self.rows[peer].connected);
        self.refreshPeer(peer, now_ms);
        if (self.score(peer, now_ms, ip_count) > 0) {
            self.resetPeer(peer);
        } else {
            for (0..self.topic_params.len) |topic| {
                const index: u16 = @intCast(topic);
                if (self.load(peer, index).in_mesh) self.prune(peer, index, now_ms);
                var next = self.load(peer, index);
                if (next.first_deliveries == 0) continue;
                next.first_deliveries = 0;
                self.store(peer, index, next);
            }
        }
        self.setConnected(peer, false, now_ms);
    }

    pub fn setConnected(self: *PeerScore, peer: u16, connected: bool, now_ms: u64) void {
        assert(peer < self.rows.len);
        const row = &self.rows[peer];
        // A validation completed offline must not carry first-delivery credit into a reconnect.
        if (connected and !row.connected) {
            for (0..self.topic_params.len) |topic| {
                var next = self.load(peer, @intCast(topic));
                if (next.first_deliveries == 0) continue;
                next.first_deliveries = 0;
                self.store(peer, @intCast(topic), next);
            }
        }
        self.refreshPeer(peer, now_ms);
        row.dirty = true;
        row.connected = connected;
        row.last_decay_ms = now_ms;
    }

    pub fn refresh(self: *PeerScore, now_ms: u64) void {
        for (0..self.rows.len) |peer| self.refreshPeer(@intCast(peer), now_ms);
    }

    fn refreshPeer(self: *PeerScore, peer: u16, now_ms: u64) void {
        const row = &self.rows[peer];
        if (!row.connected) return;
        const last = row.last_decay_ms orelse {
            row.last_decay_ms = now_ms;
            return;
        };
        const steps = (now_ms -| last) / self.params.decay_interval_ms;
        if (steps == 0) return;
        row.last_decay_ms = last + steps * self.params.decay_interval_ms;
        self.decayPeer(peer, steps);
    }

    fn decayPeer(self: *PeerScore, peer: u16, steps: u64) void {
        const zero = self.params.decay_to_zero;
        for (0..self.topic_params.len) |topic| {
            var c = self.load(peer, @intCast(topic));
            if (c.first_deliveries == 0 and c.mesh_deliveries == 0 and c.mesh_failures == 0 and c.invalid == 0) continue;
            const tp = self.topic_params[topic];
            c.first_deliveries = decayed(c.first_deliveries, tp.first_delivery_decay, steps, zero);
            c.mesh_deliveries = decayed(c.mesh_deliveries, tp.mesh_delivery_decay, steps, zero);
            c.mesh_failures = decayed(c.mesh_failures, tp.mesh_failure_decay, steps, zero);
            c.invalid = decayed(c.invalid, tp.invalid_decay, steps, zero);
            self.store(peer, @intCast(topic), c);
        }
        if (self.rows[peer].behaviour != 0) {
            self.rows[peer].dirty = true;
            self.rows[peer].behaviour = decayed(self.rows[peer].behaviour, self.params.behaviour_decay, steps, zero);
        }
    }
};

pub const peer_capacity = constants.retained_peers_cap;
pub const counter_max: f64 = 1_000_000;
// Two weights and a squared counter bound each topic term by 1e36.
// Summing the bounded namespace and global terms stays below 1e41.
pub const weight_max: f64 = 1_000_000_000_000;

fn safeMagnitude(value: f64) bool {
    return std.math.isFinite(value) and @abs(value) <= counter_max;
}

fn safeParameter(comptime name: []const u8, value: f64) bool {
    const weight = comptime std.mem.eql(u8, name, "weight") or std.mem.endsWith(u8, name, "_weight");
    return std.math.isFinite(value) and @abs(value) <= (if (weight) weight_max else counter_max);
}

pub fn validateTopic(p: TopicParams) error{InvalidLimits}!void {
    inline for (std.meta.fields(TopicParams)) |field| {
        const value = @field(p, field.name);
        if (field.type == f64 and !safeParameter(field.name, value)) return error.InvalidLimits;
    }
    if (p.weight < 0 or p.time_in_mesh_weight < 0 or p.time_in_mesh_cap < 0 or
        p.time_in_mesh_quantum_ms == 0 or p.first_delivery_weight < 0 or p.first_delivery_cap < 0 or
        p.mesh_delivery_weight > 0 or p.mesh_delivery_threshold < 0 or
        p.mesh_delivery_cap < p.mesh_delivery_threshold or p.mesh_failure_weight > 0 or p.invalid_weight > 0)
        return error.InvalidLimits;
    for ([_]f64{ p.first_delivery_decay, p.mesh_delivery_decay, p.mesh_failure_decay, p.invalid_decay }) |decay| {
        if (decay < 0 or decay >= 1) return error.InvalidLimits;
    }
}

pub fn validateParams(p: Params) error{InvalidLimits}!void {
    try validateTopic(p.topic);
    inline for (std.meta.fields(Params)) |field| {
        if (field.type == f64 and !safeParameter(field.name, @field(p, field.name))) return error.InvalidLimits;
    }
    if (p.decay_interval_ms == 0 or p.decay_to_zero <= 0 or p.behaviour_threshold < 0 or
        p.behaviour_weight > 0 or p.behaviour_decay < 0 or p.behaviour_decay >= 1 or
        p.ip_colocation_weight > 0 or p.topic_cap < 0 or p.gossip_threshold > 0 or
        p.publish_threshold > p.gossip_threshold or p.graylist_threshold > p.publish_threshold)
        return error.InvalidLimits;
}

fn decayed(value: f64, decay: f64, intervals: u64, zero: f64) f64 {
    var factor: f64 = 1;
    var base = decay;
    var exponent = intervals;
    for (0..64) |_| {
        if (exponent == 0) break;
        if (exponent & 1 != 0) factor *= base;
        base *= base;
        exponent >>= 1;
    }
    assert(exponent == 0);
    const next = value * factor;
    return if (next < zero) 0 else next;
}

fn testScores(a: Allocator, params: Params, count: u16) !PeerScore {
    const scores = try PeerScore.init(a, params, count);
    for (scores.rows) |*row| row.connected = true;
    return scores;
}

/// Checks a peer's policy score against a fresh evaluation, bit for bit.
fn expectExact(scores: *PeerScore, peer: u16, now_ms: u64, ip_count: u16) !void {
    const fresh: u64 = @bitCast(scores.evaluate(peer, now_ms, ip_count, null).total);
    try std.testing.expectEqual(fresh, @as(u64, @bitCast(scores.score(peer, now_ms, ip_count))));
}

/// Checks that a peer's cached score is still valid and still exact.
fn expectCached(scores: *PeerScore, peer: u16, now_ms: u64, ip_count: u16) !void {
    try std.testing.expect(!scores.rows[peer].dirty);
    const calculations = scores.calculations;
    try expectExact(scores, peer, now_ms, ip_count);
    try std.testing.expectEqual(calculations, scores.calculations);
}

test "score accepts small validator set weights with bounded counters" {
    var score = try testScores(std.testing.allocator, .{}, peer_capacity);
    defer score.deinit(std.testing.allocator);
    try score.configureTopic(0, .{ .mesh_failure_weight = -30_494_071.26802956 });
    score.graft(0, 0, 0);
    score.prune(0, 0, 30_001);
    try std.testing.expectApproxEqAbs(@as(f64, -762_351_781.700739), score.score(0, 30_001, 0), 0.001);
    try std.testing.expectError(error.InvalidLimits, score.configureTopic(0, .{ .first_delivery_cap = counter_max + 1 }));
}

test "score weight limit keeps worst case arithmetic finite" {
    var score = try testScores(std.testing.allocator, .{}, 1);
    defer score.deinit(std.testing.allocator);
    for (0..constants.topics_cap) |topic| {
        try score.configureTopic(@intCast(topic), .{ .weight = weight_max, .invalid_weight = -weight_max });
        score.store(0, @intCast(topic), .{ .invalid = counter_max });
    }
    const worst = score.score(0, 0, 0);
    try std.testing.expect(std.math.isFinite(worst) and worst < 0 and worst > -1e40);
    try std.testing.expectError(error.InvalidLimits, score.configureTopic(0, .{ .weight = weight_max + 1 }));
    try std.testing.expectError(error.InvalidLimits, validateParams(.{ .behaviour_weight = -weight_max - 1 }));
    try std.testing.expectError(error.InvalidLimits, validateParams(.{ .behaviour_threshold = counter_max + 1 }));
}

test "score rewards deliveries and punishes invalid messages" {
    var score = try testScores(std.testing.allocator, .{}, peer_capacity);
    defer score.deinit(std.testing.allocator);

    score.graft(1, 0, 0);
    score.deliverEligible(1, 0, true);
    score.deliverEligible(1, 0, true);
    try std.testing.expect(score.score(1, 1_000, 0) > 0);

    score.invalid(2, 0);
    try std.testing.expect(score.score(2, 1_000, 0) < 0);
}

test "score crosses the graylist threshold on repeated invalid messages" {
    var score = try testScores(std.testing.allocator, .{}, peer_capacity);
    defer score.deinit(std.testing.allocator);
    var n: usize = 0;
    while (n < 20) : (n += 1) score.invalid(1, 0);
    try std.testing.expect(score.score(1, 0, 0) < score.params.graylist_threshold);
}

test "score decays counters toward zero over intervals" {
    var score = try testScores(std.testing.allocator, .{}, peer_capacity);
    defer score.deinit(std.testing.allocator);
    score.deliverEligible(1, 0, false);
    const before = score.score(1, 0, 0);
    score.refresh(0); // primes last_decay
    var now: u64 = 0;
    var i: usize = 0;
    while (i < 200) : (i += 1) {
        now += score.params.decay_interval_ms;
        score.refresh(now);
    }
    const after = score.score(1, now, 0);
    try std.testing.expect(after < before);
    try std.testing.expect(@abs(after) < @abs(before));
}

test "score resets when a peer slot is reused" {
    var score = try testScores(std.testing.allocator, .{}, peer_capacity);
    defer score.deinit(std.testing.allocator);
    score.invalid(1, 0);
    try std.testing.expect(score.score(1, 0, 0) < 0);
    score.resetPeer(1);
    try std.testing.expectEqual(@as(f64, 0), score.score(1, 0, 0));
}

test "gossip policy duplicate graft preserves activation" {
    var score = try testScores(std.testing.allocator, .{}, peer_capacity);
    defer score.deinit(std.testing.allocator);
    score.graft(0, 0, 1);
    const activated = score.score(0, 30_001, 0);
    score.graft(0, 0, 30_001);
    try std.testing.expectEqual(activated, score.score(0, 30_001, 0));
}

test "gossip policy active decay accounts for the complete bounded time gap" {
    var score = try testScores(std.testing.allocator, .{ .topic = .{ .first_delivery_decay = 0.99 } }, peer_capacity);
    defer score.deinit(std.testing.allocator);
    score.deliverEligible(0, 0, false);
    score.refresh(1);
    score.refresh(1 + 100 * score.params.decay_interval_ms);
    try std.testing.expectApproxEqAbs(@as(f64, 0.3660323412732292), score.score(0, 1, 0), 0.0000000001);
}

test "gossip policy score rejects unsafe finite configuration" {
    try std.testing.expectError(error.InvalidLimits, testScores(std.testing.allocator, .{ .topic = .{ .invalid_weight = -std.math.floatMax(f64) } }, peer_capacity));
    try std.testing.expectError(error.InvalidLimits, testScores(std.testing.allocator, .{ .decay_interval_ms = 0 }, peer_capacity));
    try std.testing.expectError(error.InvalidLimits, testScores(std.testing.allocator, .{ .topic = .{ .weight = std.math.nan(f64) } }, peer_capacity));
}

test "gossip policy independent topic decay and frozen offline penalties" {
    var score = try testScores(std.testing.allocator, .{ .decay_interval_ms = 10 }, peer_capacity);
    defer score.deinit(std.testing.allocator);
    try score.configureTopic(0, .{ .first_delivery_weight = 2, .first_delivery_decay = 0.5 });
    try score.configureTopic(1, .{ .first_delivery_weight = 4, .first_delivery_decay = 0.25 });
    score.deliverEligible(0, 0, false);
    score.deliverEligible(0, 1, false);
    score.refresh(0);
    score.refresh(10);
    try std.testing.expectEqual(@as(f64, 2), score.score(0, 10, 0));
    score.invalid(0, 0);
    score.disconnect(0, 10, 0);
    score.refresh(1000);
    try std.testing.expectEqual(@as(f64, -100), score.score(0, 1000, 0));
    score.setConnected(0, true, 1000);
    score.refresh(1010);
    try std.testing.expectApproxEqAbs(@as(f64, -81), score.score(0, 1010, 0), 0.000000001);
}

test "gossip policy score matches independent libp2p 17.1.1 two topic oracle" {
    var ip_count: u16 = 0;
    var score = try testScores(std.testing.allocator, .{
        .topic_cap = 50,
        .ip_colocation_weight = -5,
        .ip_colocation_threshold = 3,
        .behaviour_weight = -3,
        .behaviour_threshold = 2,
        .behaviour_decay = 0.5,
    }, peer_capacity);
    defer score.deinit(std.testing.allocator);
    const first: TopicParams = .{ .weight = 2, .time_in_mesh_weight = 0.25, .time_in_mesh_cap = 30, .first_delivery_weight = 3, .first_delivery_cap = 10, .first_delivery_decay = 0.5, .mesh_delivery_weight = -2, .mesh_delivery_threshold = 5, .mesh_delivery_cap = 10, .mesh_delivery_decay = 0.5, .mesh_delivery_activation_ms = 1000, .mesh_failure_weight = -4, .mesh_failure_decay = 0.5, .invalid_weight = -10, .invalid_decay = 0.5 };
    var second = first;
    second.weight = 0.5;
    second.first_delivery_weight = 2;
    second.first_delivery_decay = 0.25;
    second.mesh_failure_weight = -1;
    second.invalid_weight = -8;
    try score.configureTopic(0, first);
    try score.configureTopic(1, second);
    score.store(0, 0, .{ .in_mesh = true, .graft_ms = 1, .first_deliveries = 4, .mesh_deliveries = 2, .mesh_failures = 1.5, .invalid = 2 });
    score.store(0, 1, .{ .first_deliveries = 3, .mesh_failures = 2, .invalid = 1 });
    score.penalize(0, 5);
    ip_count = 5;
    try std.testing.expectEqual(@as(f64, -138), score.score(0, 40_001, ip_count));
    ip_count = 0;
    try std.testing.expectEqual(@as(f64, -118), score.score(0, 40_001, ip_count));
    ip_count = 5;
    score.rows[0].behaviour = 2;
    try std.testing.expectEqual(@as(f64, -111), score.score(0, 40_002, ip_count));
    score.store(0, 0, .{ .first_deliveries = 20 });
    score.store(0, 1, .{ .first_deliveries = 3 });
    ip_count = 0;
    score.rows[0].behaviour = 0;
    try std.testing.expectEqual(@as(f64, 50), score.score(0, 40_001, ip_count));
}

test "gossip policy saturated penalties stay finite" {
    var score = try testScores(std.testing.allocator, .{}, peer_capacity);
    defer score.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(f64, 0), score.score(0, 1, 0));
    score.store(0, 0, .{ .invalid = counter_max });
    score.invalid(0, 0);
    try std.testing.expectEqual(counter_max, score.load(0, 0).invalid);
    score.penalize(0, counter_max);
    score.penalize(0, counter_max);
    try std.testing.expectEqual(counter_max, score.rows[0].behaviour);
    try std.testing.expect(std.math.isFinite(score.score(0, 1, 0)));
}

test "score cache preserves exact boundaries without repeated calculations" {
    var score = try testScores(std.testing.allocator, .{ .decay_interval_ms = 10, .topic = .{ .time_in_mesh_weight = 2, .time_in_mesh_cap = 2.5, .time_in_mesh_quantum_ms = 10, .mesh_delivery_activation_ms = 25, .mesh_delivery_threshold = 2, .mesh_delivery_weight = -3 } }, 2);
    defer score.deinit(std.testing.allocator);
    score.graft(0, 0, 5);
    try std.testing.expectEqual(@as(f64, 0), score.score(0, 5, 0));
    try std.testing.expectEqual(@as(f64, 0), score.score(0, 14, 0));
    try std.testing.expectEqual(@as(u64, 1), score.calculations);
    try std.testing.expectEqual(@as(f64, 2), score.score(0, 15, 0));
    try std.testing.expectEqual(@as(f64, 2), score.score(0, 16, 0));
    try std.testing.expectEqual(@as(f64, 4), score.score(0, 29, 0));
    try std.testing.expectEqual(@as(f64, 4), score.score(0, 30, 0));
    try std.testing.expectEqual(@as(f64, -8), score.score(0, 31, 0));
    try std.testing.expectEqual(@as(f64, -7), score.score(0, 35, 0));
    const calculations = score.calculations;
    try std.testing.expectEqual(@as(f64, -7), score.score(0, 1000, 0));
    try std.testing.expectEqual(calculations, score.calculations);
    // A caller using an earlier clock must still get the exact earlier P1/P3.
    try std.testing.expectEqual(@as(f64, 2), score.score(0, 15, 0));
}

test "score read only topic inspection preserves cache validity" {
    var score = try testScores(std.testing.allocator, .{}, 2);
    defer score.deinit(std.testing.allocator);
    _ = score.score(0, 0, 0);
    try std.testing.expect(!score.retainsTopic(0));
    try std.testing.expect(!score.rows[0].dirty);
    _ = score.score(0, 0, 0);
    try std.testing.expectEqual(@as(u64, 1), score.calculations);
}

test "score cache mutation IP topic and heartbeat decay boundaries remain exact" {
    var ip_count: u16 = 0;
    var score = try testScores(std.testing.allocator, .{ .ip_colocation_weight = -5, .decay_interval_ms = 10, .topic = .{ .first_delivery_decay = 0.5 } }, 2);
    defer score.deinit(std.testing.allocator);
    score.deliverEligible(0, 0, false);
    score.refresh(0);
    try std.testing.expectEqual(@as(f64, 1), score.score(0, 0, ip_count));
    try std.testing.expectEqual(@as(?u64, null), score.nextChange(0));
    score.refresh(9);
    try std.testing.expectEqual(@as(f64, 1), score.score(0, 9, ip_count));
    try std.testing.expectEqual(@as(u64, 1), score.calculations);
    // Wall time alone does not move the background decay schedule.
    try std.testing.expectEqual(@as(f64, 1), score.score(0, 10, ip_count));
    try std.testing.expectEqual(@as(u64, 1), score.calculations);
    score.refresh(10);
    try std.testing.expectEqual(@as(f64, 0.5), score.score(0, 10, ip_count));
    try std.testing.expectEqual(@as(u64, 2), score.calculations);
    score.refresh(11);
    try std.testing.expectEqual(@as(f64, 0.5), score.score(0, 11, ip_count));
    try std.testing.expectEqual(@as(u64, 2), score.calculations);
    ip_count = 5;
    try std.testing.expectEqual(@as(f64, -19.5), score.score(0, 11, ip_count));
    score.penalize(0, 7);
    try std.testing.expectEqual(@as(f64, -29.5), score.score(0, 11, ip_count));
    score.deliverEligible(0, 0, false);
    try std.testing.expectEqual(@as(f64, -28.5), score.score(0, 11, ip_count));
    try score.configureTopic(0, .{ .first_delivery_weight = 2, .first_delivery_decay = 0.5 });
    try std.testing.expectEqual(@as(f64, -27), score.score(0, 11, ip_count));
    score.setConnected(0, false, 11);
    score.refresh(1000);
    try std.testing.expectEqual(@as(f64, -27), score.score(0, 1000, ip_count));
    const frozen = score.calculations;
    score.refresh(2000);
    try std.testing.expectEqual(@as(f64, -27), score.score(0, 2000, ip_count));
    try std.testing.expectEqual(frozen, score.calculations);
}

test "score cache reports earliest active topic quantum activation and cap" {
    var score = try testScores(std.testing.allocator, .{}, 1);
    defer score.deinit(std.testing.allocator);
    try score.configureTopic(0, .{ .time_in_mesh_quantum_ms = 10, .time_in_mesh_cap = 1.5, .mesh_delivery_activation_ms = 17 });
    try score.configureTopic(1, .{ .time_in_mesh_weight = 0, .mesh_delivery_activation_ms = 13 });
    score.graft(0, 0, 5);
    score.graft(0, 1, 5);
    _ = score.score(0, 14, 0);
    try std.testing.expectEqual(@as(?u64, 15), score.nextChange(0));
    _ = score.score(0, 15, 0);
    try std.testing.expectEqual(@as(?u64, 19), score.nextChange(0));
    _ = score.score(0, 19, 0);
    try std.testing.expectEqual(@as(?u64, 23), score.nextChange(0));
    _ = score.score(0, 23, 0);
    try std.testing.expectEqual(@as(?u64, 25), score.nextChange(0));
    _ = score.score(0, 25, 0);
    try std.testing.expectEqual(@as(?u64, null), score.nextChange(0));
    score.invalid(0, 0);
    try std.testing.expect(score.rows[0].dirty);
}

test "score empty background decay does not fabricate mutations" {
    var score = try testScores(std.testing.allocator, .{}, 1);
    defer score.deinit(std.testing.allocator);
    score.refresh(0);
    _ = score.score(0, 0, 0);
    score.refresh(score.params.decay_interval_ms);
    try std.testing.expect(!score.rows[0].dirty);
}

test "score activation is strictly after the window for P3" {
    var score = try testScores(std.testing.allocator, .{ .topic = .{ .time_in_mesh_weight = 0, .mesh_delivery_activation_ms = 10, .mesh_delivery_threshold = 2, .mesh_delivery_weight = -3, .mesh_failure_weight = -1 } }, 3);
    defer score.deinit(std.testing.allocator);
    score.graft(0, 0, 5);
    try std.testing.expectEqual(@as(f64, 0), score.score(0, 14, 0));
    try std.testing.expectEqual(@as(?u64, 16), score.nextChange(0));
    try std.testing.expectEqual(@as(f64, 0), score.score(0, 15, 0));
    try std.testing.expectEqual(@as(u64, 1), score.calculations);
    try std.testing.expectEqual(@as(f64, -12), score.score(0, 16, 0));
    try std.testing.expectEqual(@as(u64, 2), score.calculations);
    try std.testing.expectEqual(@as(?u64, null), score.nextChange(0));
}

test "score activation is strictly after the window for P3b pruning" {
    var score = try testScores(std.testing.allocator, .{ .topic = .{ .time_in_mesh_weight = 0, .mesh_delivery_activation_ms = 10, .mesh_delivery_threshold = 2, .mesh_delivery_weight = -3, .mesh_failure_weight = -1 } }, 3);
    defer score.deinit(std.testing.allocator);
    for ([_]u64{ 14, 15, 16 }, 0..) |now, i| {
        const peer: u16 = @intCast(i);
        score.graft(peer, 0, 5);
        score.prune(peer, 0, now);
        try std.testing.expectEqual(@as(f64, if (now > 15) -4 else 0), score.score(peer, now, 0));
    }
}

test "score activation zero window still waits for the first elapsed tick" {
    var score = try testScores(std.testing.allocator, .{ .topic = .{ .time_in_mesh_weight = 0, .mesh_delivery_activation_ms = 0 } }, 1);
    defer score.deinit(std.testing.allocator);
    score.graft(0, 0, 5);
    try std.testing.expectEqual(@as(f64, 0), score.score(0, 5, 0));
    try std.testing.expectEqual(@as(?u64, 6), score.nextChange(0));
    try std.testing.expectEqual(@as(f64, -25), score.score(0, 6, 0));
}

test "score activation and quantum deadlines never invent an overflowing instant" {
    var score = try testScores(std.testing.allocator, .{ .topic = .{ .time_in_mesh_weight = 0, .mesh_delivery_activation_ms = 10 } }, 1);
    defer score.deinit(std.testing.allocator);
    const maximum = std.math.maxInt(u64);
    score.graft(0, 0, maximum - 10);
    try std.testing.expectEqual(@as(f64, 0), score.score(0, maximum - 1, 0));
    try std.testing.expectEqual(@as(?u64, null), score.nextChange(0));
    try std.testing.expectEqual(@as(f64, 0), score.score(0, maximum, 0));
    score.prune(0, 0, maximum);
    try std.testing.expectEqual(@as(f64, 0), score.score(0, maximum, 0));

    score.resetPeer(0);
    score.graft(0, 0, maximum - 11);
    try std.testing.expectEqual(@as(f64, 0), score.score(0, maximum - 1, 0));
    try std.testing.expectEqual(@as(?u64, maximum), score.nextChange(0));
    try std.testing.expectEqual(@as(f64, -25), score.score(0, maximum, 0));
    try std.testing.expectEqual(@as(?u64, null), score.nextChange(0));
    score.prune(0, 0, maximum);
    try std.testing.expectEqual(@as(f64, -25), score.score(0, maximum, 0));

    score.resetPeer(0);
    try score.configureTopic(0, .{ .time_in_mesh_quantum_ms = 10, .mesh_delivery_weight = 0 });
    score.graft(0, 0, maximum - 9);
    try std.testing.expectEqual(@as(f64, 0), score.score(0, maximum - 1, 0));
    try std.testing.expectEqual(@as(?u64, null), score.nextChange(0));
    try std.testing.expectEqual(@as(f64, 0), score.score(0, maximum, 0));
}

test "score retirement invalidates primed totals with identical parameters" {
    var score = try testScores(std.testing.allocator, .{}, 2);
    defer score.deinit(std.testing.allocator);
    score.refresh(0);
    score.deliverEligible(0, 0, false);
    score.invalid(1, 0);
    for ([_]f64{ 1, -100 }, 0..) |expected, peer| {
        try std.testing.expectEqual(expected, score.score(@intCast(peer), 1, 0));
        try std.testing.expect(!score.rows[peer].dirty);
        try std.testing.expectEqual(@as(?u64, null), score.nextChange(@intCast(peer)));
    }
    const params = score.topic_params[0];
    score.resetTopic(0);
    try score.configureTopic(0, params);
    for (0..2) |peer| {
        try std.testing.expect(score.rows[peer].dirty);
        try std.testing.expectEqual(@as(f64, 0), score.score(@intCast(peer), 1, 0));
    }
    const calculations = score.calculations;
    score.refresh(score.params.decay_interval_ms);
    for (0..2) |peer| try std.testing.expectEqual(@as(f64, 0), score.score(@intCast(peer), score.params.decay_interval_ms, 0));
    try std.testing.expectEqual(calculations, score.calculations);
}

test "score snapshots preserve cache state and match policy evaluation" {
    var scores = try testScores(std.testing.allocator, .{}, 1);
    defer scores.deinit(std.testing.allocator);
    scores.graft(0, 0, 0);
    _ = scores.score(0, 1000, 0);
    scores.deliverEligible(0, 0, true);
    const cached = scores.rows[0].cached;
    const calculations = scores.calculations;
    const visits = scores.topic_visits;
    const next = scores.rows[0].cached_until;
    const value = scores.snapshot(0, 50000, 0);
    try std.testing.expectEqual(cached, scores.rows[0].cached);
    try std.testing.expectEqual(calculations, scores.calculations);
    try std.testing.expectEqual(visits, scores.topic_visits);
    try std.testing.expectEqual(next, scores.rows[0].cached_until);
    try std.testing.expect(scores.rows[0].dirty);
    try std.testing.expectEqual(value, scores.score(0, 50000, 0));
    // A valid cache answers the snapshot; past its next change, or at another IP population, the
    // snapshot evaluates.
    const until = scores.rows[0].cached_until.?;
    try std.testing.expectEqual(value, scores.snapshot(0, until - 1, 0));
    try std.testing.expect(scores.snapshot(0, until, 0) != value);
    try std.testing.expectEqual(scores.evaluate(0, until, 0, null).total, scores.snapshot(0, until, 0));
    try std.testing.expectEqual(scores.evaluate(0, until - 1, 4, null).total, scores.snapshot(0, until - 1, 4));
    try std.testing.expectEqual(calculations + 1, scores.calculations);
    try std.testing.expect(!scores.rows[0].dirty);
}

test "score weights use policy thresholds and snapshots leave the cache untouched" {
    var ip_count: u16 = 0;
    var scores = try testScores(std.testing.allocator, .{
        .ip_colocation_weight = -3,
        .ip_colocation_threshold = 1,
        .behaviour_weight = -2,
        .behaviour_threshold = 1,
        .topic_cap = 10,
        .topic = .{ .weight = 2, .time_in_mesh_weight = 1, .time_in_mesh_cap = 2, .first_delivery_weight = 3, .mesh_delivery_weight = -5, .mesh_delivery_threshold = 3, .mesh_delivery_activation_ms = 1000, .mesh_failure_weight = -7, .invalid_weight = -11 },
    }, 1);
    defer scores.deinit(std.testing.allocator);
    scores.graft(0, 0, 0);
    scores.deliverEligible(0, 0, true);
    scores.invalid(0, 0);
    var failed = scores.load(0, 0);
    failed.mesh_failures = 1;
    scores.store(0, 0, failed);
    scores.penalize(0, 3);
    ip_count = 3;
    var detail_topics: [constants.topics_cap]TopicWeights = undefined;
    var details: Breakdown = .{ .topics = &detail_topics };
    const value = scores.snapshotWeights(0, 2000, ip_count, &details);
    try std.testing.expectEqualDeep(TopicWeights{ .p1 = 2, .p2 = 3, .p3 = -20, .p3b = -7, .p4 = -11 }, details.topics[0]);
    try std.testing.expectEqualDeep(GlobalWeights{ .p5 = 0, .p6 = -12, .p7 = -8 }, details.global);
    try std.testing.expectEqual(@as(f64, -86), value);
    try std.testing.expectEqual(@as(u64, 0), scores.calculations);
    try std.testing.expectEqual(value, scores.score(0, 2000, ip_count));
    try std.testing.expectEqual(value, scores.score(0, 2000, ip_count));
    try std.testing.expectEqual(@as(u64, 1), scores.calculations);
    scores.penalize(0, 2);
    try std.testing.expectEqual(value - 24, scores.score(0, 2000, ip_count));
    scores.resetPeer(0);
    _ = scores.score(0, 2000, ip_count);
    _ = scores.snapshotWeights(0, 2000, ip_count, &details);
    try std.testing.expectEqualDeep(TopicWeights{}, details.topics[0]);
    scores.topic_params[0].first_delivery_weight = 100;
    scores.deliverEligible(0, 0, false);
    const capped = scores.snapshotWeights(0, 2000, ip_count, &details);
    try std.testing.expectEqual(@as(f64, 100), details.topics[0].p2);
    try std.testing.expectEqual(@as(f64, 10) + details.global.p6, capped);
    scores.graft(0, 0, 0);
    scores.prune(0, 0, 5000);
    scores.prune(0, 0, 5000);
    try std.testing.expectEqual(@as(f64, 9), scores.topics[0].mesh_failures);
}

test "score first deliveries invalidate the cache only below the cap" {
    var scores = try testScores(std.testing.allocator, .{}, 1);
    defer scores.deinit(std.testing.allocator);
    try scores.configureTopic(0, .{ .first_delivery_weight = 2, .first_delivery_cap = 2 });
    scores.deliverEligible(0, 0, false);
    try std.testing.expectEqual(@as(f64, 2), scores.score(0, 0, 0));
    scores.deliverEligible(0, 0, false);
    try std.testing.expect(scores.rows[0].dirty);
    try std.testing.expectEqual(@as(f64, 4), scores.score(0, 0, 0));
    scores.deliverEligible(0, 0, false);
    try expectCached(&scores, 0, 0, 0);
    try std.testing.expectEqual(@as(f64, 4), scores.score(0, 0, 0));
}

test "score mesh deliveries invalidate the cache only in the mesh and below the threshold" {
    var scores = try testScores(std.testing.allocator, .{ .topic = .{ .time_in_mesh_weight = 0, .mesh_delivery_threshold = 3, .mesh_delivery_cap = 5, .mesh_delivery_activation_ms = 10 } }, 1);
    defer scores.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(f64, 0), scores.score(0, 0, 0));
    scores.creditMesh(0, 0);
    try expectCached(&scores, 0, 0, 0);
    scores.graft(0, 0, 0);
    try std.testing.expectEqual(@as(f64, -4), scores.score(0, 11, 0));
    for ([_]f64{ -1, 0 }) |expected| {
        scores.creditMesh(0, 0);
        try std.testing.expect(scores.rows[0].dirty);
        try std.testing.expectEqual(expected, scores.score(0, 11, 0));
    }
    for (0..3) |_| {
        scores.creditMesh(0, 0);
        try expectCached(&scores, 0, 11, 0);
    }
    try std.testing.expectEqual(@as(f64, 5), scores.load(0, 0).mesh_deliveries);
}

test "score unchanged grafts, prunes, saturated invalid counters and empty topic resets keep the cache" {
    var scores = try testScores(std.testing.allocator, .{}, 2);
    defer scores.deinit(std.testing.allocator);
    scores.graft(0, 0, 5);
    try std.testing.expectApproxEqAbs(@as(f64, 0.06), scores.score(0, 2_005, 0), 1e-12);
    scores.graft(0, 0, 2_005);
    scores.prune(0, 1, 2_005);
    try expectCached(&scores, 0, 2_005, 0);
    scores.prune(0, 0, 2_005);
    try std.testing.expect(scores.rows[0].dirty);
    try std.testing.expectEqual(@as(f64, 0), scores.score(0, 2_005, 0));

    scores.store(1, 0, .{ .invalid = counter_max - 1 });
    try std.testing.expectEqual(@as(f64, -100 * (counter_max - 1) * (counter_max - 1)), scores.score(1, 0, 0));
    scores.invalid(1, 0);
    try std.testing.expect(scores.rows[1].dirty);
    try std.testing.expectEqual(@as(f64, -100 * counter_max * counter_max), scores.score(1, 0, 0));
    scores.invalid(1, 0);
    try expectCached(&scores, 1, 0, 0);

    scores.resetTopic(1);
    try expectCached(&scores, 0, 2_005, 0);
    try expectCached(&scores, 1, 0, 0);
    scores.resetTopic(0);
    try std.testing.expect(scores.rows[1].dirty);
    try std.testing.expectEqual(@as(f64, 0), scores.score(1, 0, 0));
}

test "score background decay invalidates the cache only for counters evaluate reads" {
    var scores = try testScores(std.testing.allocator, .{ .decay_interval_ms = 10, .topic = .{ .time_in_mesh_weight = 0, .mesh_delivery_weight = -4, .mesh_delivery_threshold = 1, .mesh_delivery_cap = 8, .mesh_delivery_decay = 0.5, .mesh_delivery_activation_ms = 0 } }, 1);
    defer scores.deinit(std.testing.allocator);
    scores.graft(0, 0, 0);
    for (0..8) |_| scores.creditMesh(0, 0);
    scores.refresh(0);
    try std.testing.expectEqual(@as(f64, 0), scores.score(0, 1, 0));
    // Deliveries decay 8, 4, 2, 1 without reaching below the threshold.
    for ([_]u64{ 10, 20, 30 }) |now| {
        scores.refresh(now);
        try expectCached(&scores, 0, now, 0);
    }
    try std.testing.expectEqual(@as(f64, 1), scores.load(0, 0).mesh_deliveries);
    scores.refresh(40);
    try std.testing.expect(scores.rows[0].dirty);
    try std.testing.expectEqual(@as(f64, -1), scores.score(0, 40, 0));
}

test "score unweighted topics keep the cache until a weight exposes their counters" {
    var scores = try testScores(std.testing.allocator, .{ .decay_interval_ms = 10 }, 1);
    defer scores.deinit(std.testing.allocator);
    try scores.configureTopic(0, .{ .weight = 0 });
    scores.refresh(0);
    try std.testing.expectEqual(@as(f64, 0), scores.score(0, 0, 0));
    scores.graft(0, 0, 0);
    scores.deliverEligible(0, 0, true);
    scores.creditMesh(0, 0);
    scores.invalid(0, 0);
    scores.prune(0, 0, 5);
    scores.deliverEligible(0, 0, false);
    try expectCached(&scores, 0, 5, 0);
    scores.refresh(10);
    try expectCached(&scores, 0, 10, 0);
    try std.testing.expectEqualDeep(TopicCounters{ .graft_ms = 0, .first_deliveries = 1.8, .mesh_deliveries = 1.8, .invalid = 0.9 }, scores.load(0, 0));
    try scores.configureTopic(0, .{});
    try std.testing.expect(scores.rows[0].dirty);
    try std.testing.expectApproxEqAbs(@as(f64, 1.8 - 100 * 0.81), scores.score(0, 10, 0), 1e-9);
}

test "score cache matches fresh evaluation across random mutations" {
    const base: TopicParams = .{ .time_in_mesh_weight = 1, .time_in_mesh_cap = 3, .time_in_mesh_quantum_ms = 5, .first_delivery_cap = 4, .first_delivery_decay = 0.5, .mesh_delivery_threshold = 3, .mesh_delivery_cap = 6, .mesh_delivery_decay = 0.5, .mesh_delivery_activation_ms = 7, .mesh_failure_decay = 0.5, .invalid_decay = 0.5 };
    var variants: [4]TopicParams = @splat(base);
    variants[1].weight = 0;
    variants[2] = (TopicPolicy{ .params = base, .mesh_delivery_start_slot = 1 }).atSlot(0);
    variants[3].mesh_delivery_threshold = 6;
    const peers = 4;
    const topics = 4;
    var scores = try testScores(std.testing.allocator, .{ .ip_colocation_weight = -1, .ip_colocation_threshold = 1, .behaviour_threshold = 2, .decay_interval_ms = 10, .topic_cap = 20, .topic = base }, peers);
    defer scores.deinit(std.testing.allocator);
    var prng = std.Random.DefaultPrng.init(0x5c0e);
    const random = prng.random();
    var ip: [peers]u16 = @splat(0);
    var now: u64 = 0;
    var reads: u64 = 0;
    var kept: u64 = 0;
    for (0..10_000) |_| {
        const peer = random.uintLessThan(u16, peers);
        const topic = random.uintLessThan(u16, topics);
        const clean = !scores.rows[peer].dirty;
        const choice = random.uintLessThan(u8, 14);
        switch (choice) {
            0 => scores.graft(peer, topic, now),
            1 => scores.prune(peer, topic, now),
            2 => scores.deliverEligible(peer, topic, random.boolean()),
            3, 4 => scores.creditMesh(peer, topic),
            5 => scores.invalid(peer, topic),
            6 => scores.penalize(peer, random.float(f64) * 2),
            7 => now += random.uintLessThan(u64, 12),
            8 => scores.refresh(now),
            9 => scores.setConnected(peer, !scores.rows[peer].connected, now),
            10 => try scores.configureTopic(topic, variants[random.uintLessThan(usize, variants.len)]),
            11 => ip[peer] = random.uintLessThan(u16, 4),
            12 => {
                for (0..peers) |other| scores.prune(@intCast(other), topic, now);
                scores.resetTopic(topic);
            },
            13 => scores.resetPeer(peer),
            else => unreachable,
        }
        kept += @intFromBool(choice <= 5 and clean and !scores.rows[peer].dirty);
        for (0..peers) |other| {
            const other_peer: u16 = @intCast(other);
            try expectExact(&scores, other_peer, now, ip[other]);
            try std.testing.expectEqual(scores.evaluate(other_peer, now, ip[other], null).next_change, scores.nextChange(other_peer));
        }
        reads += peers;
    }
    // The walk must exercise both invalidating and cache-preserving mutations.
    try std.testing.expect(kept > 1_000 and scores.calculations > 1_000 and scores.calculations < reads / 2);
}

test "gossip local retention pressure restarts delivery observation without credit or penalty laundering" {
    var score = try testScores(std.testing.allocator, .{ .behaviour_threshold = 0, .topic = .{ .mesh_delivery_threshold = 2, .mesh_delivery_activation_ms = 10 } }, 1);
    defer score.deinit(std.testing.allocator);
    score.graft(0, 0, 0);
    score.creditMesh(0, 0);
    score.prune(0, 0, 11);
    score.graft(0, 0, 12);
    score.invalid(0, 0);
    score.penalizeFor(0, .broken_iwant);
    const before = score.score(0, 23, 0);
    const counters = score.load(0, 0);
    score.localPressure(0, 0, 23);
    try std.testing.expectEqual(before + 1, score.score(0, 23, 0));
    var expected = counters;
    expected.delivery_restart_ms = 23;
    try std.testing.expectEqualDeep(expected, score.load(0, 0));
    try std.testing.expectEqual(@as(f64, 1), score.rows[0].behaviour);
    try expectCached(&score, 0, 33, 0);
    try std.testing.expectEqual(before, score.score(0, 34, 0));
    try expectExact(&score, 0, 34, 0);
    score.localPressure(0, 0, 34);
    score.prune(0, 0, 35);
    try std.testing.expectEqual(counters.mesh_failures, score.load(0, 0).mesh_failures);
    score.localPressure(0, 0, 40);
    try std.testing.expectEqual(@as(u64, 34), score.load(0, 0).delivery_restart_ms);
    score.graft(0, 0, 41);
    score.prune(0, 0, 52);
    try std.testing.expectEqual(counters.mesh_failures + 1, score.load(0, 0).mesh_failures);
}
