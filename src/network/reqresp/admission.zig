const std = @import("std");
const ForkSeq = @import("config").ForkSeq;
/// Application accounts share IPv4 addresses and IPv6 /64s across identities and ports.
pub const Source = @import("udp").AddressPrefix(.{ .ip4 = 32, .ip6 = 64 });
const PeerId = @import("../wire/peer_id.zig").PeerId;
const Protocol = @import("protocol.zig").Protocol;
const quota_config = @import("quotas.zig");
const Options = quota_config.Options;
pub const Decision = enum { allowed, source_quota, global_quota };
pub const InitError = error{ InvalidOptions, InvalidQuota } || std.mem.Allocator.Error;
const ns_per_ms = 1_000_000;
const assert = std.debug.assert;

pub const Key = union(enum) {
    peer: PeerId,
    address: Source,

    pub fn eql(self: *const Key, other: *const Key) bool {
        return std.meta.eql(self.*, other.*);
    }
};

const Row = struct {
    key: Key = undefined,
    occupied: bool = false,
    connections: u16 = 0,
    expires_ns: u128 = 0,
    starts_ns: u128 = 0,

    fn reusable(self: *const Row, now_ns: u128) bool {
        return self.connections == 0 and (!self.occupied or self.expires_ns <= now_ns);
    }
};

/// Calls use monotonic time. Protocol charges must belong to a request with a charged start
/// on a retained connection. Connections keep their admission key through path changes.
pub const Limiter = struct {
    rows: []Row,
    options: Options,
    protocols: Protocol.Set,
    debts: []u128,
    global: []u128,
    global_starts_ns: u128 = 0,
    connections: u16 = 0,
    connection_limit: u16,

    pub fn validate(options: *const Options) error{ InvalidOptions, InvalidQuota }!void {
        for ([_]quota_config.Quota{ options.starts, options.global_starts }) |quota| try validateQuota(quota);
        for ([_]*const quota_config.Rates{ &options.source, &options.global }) |rates| {
            for (std.enums.values(Protocol)) |which| {
                for (std.enums.values(ForkSeq)) |fork| try validateQuota(rates.get(which, fork));
            }
        }
    }

    pub fn capacity(options: *const Options, protocols: Protocol.Set, connections: u16) error{ InvalidOptions, InvalidQuota }!u16 {
        try validate(options);
        if (connections == 0 or protocols.len() == 0) return error.InvalidOptions;
        var retention_ms = options.starts.period_ms;
        for (std.enums.values(Protocol)) |which| {
            if (!protocols.contains(which)) continue;
            for (std.enums.values(ForkSeq)) |fork| retention_ms = @max(retention_ms, options.source.get(which, fork).period_ms);
        }
        // Every retained debt was charged within retention_ms. Its request either already
        // occupied a connection at that window's beginning, or charged a start within it.
        // Add another connection allowance for sources connected now, including idle peers.
        const count = 2 * @as(u128, connections) + options.global_starts.maximumDuring(retention_ms);
        return std.math.cast(u16, count) orelse error.InvalidOptions;
    }

    pub fn init(allocator: std.mem.Allocator, protocols: Protocol.Set, options: Options, connections: u16) InitError!Limiter {
        const count = try capacity(&options, protocols, connections);
        const rows = try allocator.alloc(Row, count);
        errdefer allocator.free(rows);
        @memset(rows, .{});
        const debts = try allocator.alloc(u128, (@as(usize, count) + 1) * protocols.len());
        @memset(debts, 0);
        return .{ .rows = rows, .options = options, .protocols = protocols, .debts = debts, .global = debts[0..protocols.len()], .connection_limit = connections };
    }

    pub fn deinit(self: *Limiter, allocator: std.mem.Allocator) void {
        allocator.free(self.debts);
        allocator.free(self.rows);
        self.* = undefined;
    }

    pub fn memoryPlan(self: *const Limiter) struct { allocated_bytes: usize } {
        return .{ .allocated_bytes = self.rows.len * @sizeOf(Row) + self.debts.len * @sizeOf(u128) };
    }

    fn debtRow(self: *const Limiter, index: usize) []u128 {
        assert(index < self.rows.len);
        return self.debts[(index + 1) * self.protocols.len() ..][0..self.protocols.len()];
    }

    pub fn retain(self: *Limiter, key: *const Key, now_ms: u64) u16 {
        assert(self.connections < self.connection_limit);
        var reclaim: ?u16 = null;
        for (self.rows, 0..) |*row, index| {
            if (row.occupied and row.key.eql(key)) {
                row.connections += 1;
                self.connections += 1;
                return @intCast(index);
            }
            if (reclaim == null and row.reusable(@as(u128, now_ms) * ns_per_ms)) reclaim = @intCast(index);
        }
        const index = reclaim.?;
        self.rows[index] = .{ .key = key.*, .occupied = true, .connections = 1 };
        @memset(self.debtRow(index), 0);
        self.connections += 1;
        return index;
    }

    pub fn release(self: *Limiter, index: u16) void {
        const row = &self.rows[index];
        assert(row.occupied and row.connections > 0);
        assert(self.connections > 0);
        row.connections -= 1;
        self.connections -= 1;
    }

    pub fn accountKey(self: *const Limiter, index: u16) *const Key {
        const row = &self.rows[index];
        assert(row.occupied and row.connections > 0);
        return &row.key;
    }

    pub fn start(self: *Limiter, index: u16, now_ms: u64) Decision {
        const row = &self.rows[index];
        assert(row.connections > 0);
        const now_ns = @as(u128, now_ms) * ns_per_ms;
        const due = next(row.starts_ns, 1, self.options.starts, now_ns) orelse return .source_quota;
        const global_due = next(self.global_starts_ns, 1, self.options.global_starts, now_ns) orelse return .global_quota;
        row.starts_ns = due;
        row.expires_ns = @max(row.expires_ns, due);
        self.global_starts_ns = global_due;
        return .allowed;
    }

    pub fn startAt(self: *const Limiter, index: u16, now_ms: u64) u64 {
        assert(self.rows[index].connections > 0);
        const due = @max(eligible(self.rows[index].starts_ns, 1, self.options.starts), eligible(self.global_starts_ns, 1, self.options.global_starts));
        return milliseconds(due, now_ms);
    }

    pub fn eligibleAt(self: *const Limiter, index: u16, which: Protocol, cost: u128, fork: ForkSeq, now_ms: u64) ?u64 {
        assert(self.rows[index].connections > 0);
        const source = self.options.source.get(which, fork);
        const global = self.options.global.get(which, fork);
        if (cost > source.tokens or cost > global.tokens) return null;
        const protocol_index = self.protocols.index(which).?;
        return milliseconds(@max(eligible(self.debtRow(index)[protocol_index], cost, source), eligible(self.global[protocol_index], cost, global)), now_ms);
    }

    /// Legal requests can exceed a configured burst; admission reserves at most one full burst.
    pub fn requestCost(self: *const Limiter, which: Protocol, cost: u128, fork: ForkSeq) u128 {
        return @min(cost, self.options.source.get(which, fork).tokens, self.options.global.get(which, fork).tokens);
    }

    /// Ready requests accumulate credit so smaller requests cannot consume every refill.
    pub fn grant(self: *Limiter, index: u16, which: Protocol, remaining: u128, fork: ForkSeq, now_ms: u64) u128 {
        assert(self.rows[index].connections > 0);
        const source = self.options.source.get(which, fork);
        const global = self.options.global.get(which, fork);
        const protocol_index = self.protocols.index(which).?;
        const now_ns = @as(u128, now_ms) * ns_per_ms;
        const cost = @min(remaining, available(self.debtRow(index)[protocol_index], source, now_ns), available(self.global[protocol_index], global, now_ns));
        if (cost == 0 or self.take(index, which, cost, fork, now_ms) != .allowed) return 0;
        return cost;
    }

    pub fn take(self: *Limiter, index: u16, which: Protocol, cost: u128, fork: ForkSeq, now_ms: u64) Decision {
        const row = &self.rows[index];
        assert(row.connections > 0 and row.starts_ns > 0);
        assert(cost > 0);
        const source = self.options.source.get(which, fork);
        const global = self.options.global.get(which, fork);
        if (cost > source.tokens) return .source_quota;
        if (cost > global.tokens) return .global_quota;
        const now_ns = @as(u128, now_ms) * ns_per_ms;
        const protocol_index = self.protocols.index(which).?;
        const source_next = next(self.debtRow(index)[protocol_index], cost, source, now_ns) orelse return .source_quota;
        const global_next = next(self.global[protocol_index], cost, global, now_ns) orelse return .global_quota;
        self.debtRow(index)[protocol_index] = source_next;
        row.expires_ns = @max(row.expires_ns, source_next);
        self.global[protocol_index] = global_next;
        return .allowed;
    }
};

fn validateQuota(quota: quota_config.Quota) error{InvalidQuota}!void {
    if (quota.tokens == 0 or quota.period_ms == 0 or quota.period_ms > 86_400_000) return error.InvalidQuota;
}

fn eligible(previous: u128, cost: u128, quota: quota_config.Quota) u128 {
    const period = @as(u128, quota.period_ms) * ns_per_ms;
    const charge = (cost * period + quota.tokens - 1) / quota.tokens;
    return previous + charge -| period;
}

fn milliseconds(due_ns: u128, now_ms: u64) u64 {
    return @max(now_ms, std.math.cast(u64, (due_ns +| (ns_per_ms - 1)) / ns_per_ms) orelse std.math.maxInt(u64));
}

fn available(debt: u128, quota: quota_config.Quota, now_ns: u128) u128 {
    const period = @as(u128, quota.period_ms) * ns_per_ms;
    const room = (now_ns + period) -| @max(now_ns, debt);
    return room * quota.tokens / period;
}

fn next(previous: u128, cost: u128, quota: quota_config.Quota, now_ns: u128) ?u128 {
    assert(cost > 0 and cost <= quota.tokens);
    const period_ns = @as(u128, quota.period_ms) * ns_per_ms;
    const charge_ns = (cost * period_ns + quota.tokens - 1) / quota.tokens;
    const result = @max(now_ns, previous) + charge_ns;
    return if (result <= now_ns + period_ns) result else null;
}

test {
    _ = @import("admission_test.zig");
}
