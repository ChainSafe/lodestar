const std = @import("std");
const types = @import("types.zig");
const Admission = @This();

pub const Stage = enum { challenge, handshake, packet, response, record };
const Outcome = enum { allowed, source_limit, global_limit, source_capacity };
const stage_count = std.meta.fields(Stage).len;

const Quota = struct {
    interval_ms: u64,
    burst: u16,

    pub fn maximumDuring(self: Quota, duration_ms: u64) u64 {
        return self.burst +| (duration_ms / self.interval_ms) +| @intFromBool(duration_ms % self.interval_ms != 0);
    }
};
pub const source_quota: Quota = .{ .interval_ms = 250, .burst = 4 };
pub const global_quota: Quota = .{ .interval_ms = 50, .burst = 20 };
// Packet and expected-response stages each permit two complete NODES exchanges per burst.
pub const packet_source_quota: Quota = .{ .interval_ms = 25, .burst = 2 * (types.findnode_response_packets_max + 2) };
pub const packet_global_quota: Quota = .{ .interval_ms = 10, .burst = 4 * packet_source_quota.burst };
pub const record_source_quota: Quota = .{ .interval_ms = 5, .burst = 2 * types.findnode_result_max };
// The default 64 call slots can each return 16 useful records within a one-second timeout.
pub const record_global_quota: Quota = .{ .interval_ms = 1, .burst = 64 * types.findnode_result_max };

fn quotas(stage: Stage) struct { source: Quota, global: Quota } {
    return switch (stage) {
        .challenge, .handshake => .{ .source = source_quota, .global = global_quota },
        .packet, .response => .{ .source = packet_source_quota, .global = packet_global_quota },
        .record => .{ .source = record_source_quota, .global = record_global_quota },
    };
}

// Every live source has a charge within its bucket's maximum debt window.
pub const source_capacity = blk: {
    var capacity: u32 = 0;
    for (std.enums.values(Stage)) |stage| {
        const limits = quotas(stage);
        capacity += @intCast(limits.global.maximumDuring(limits.source.interval_ms * limits.source.burst));
    }
    break :blk capacity;
};

const Bucket = struct {
    charged_until_ms: u64 = 0,

    fn next(self: Bucket, quota: Quota, cost: u16, now_ms: u64) ?u64 {
        const proposed = std.math.add(u64, @max(self.charged_until_ms, now_ms), quota.interval_ms * cost) catch return null;
        if (proposed > now_ms +| (quota.interval_ms * quota.burst)) return null;
        return proposed;
    }
};

const Source = struct {
    buckets: [stage_count]Bucket = @splat(.{}),

    fn reusable(self: *const Source, now_ms: u64) bool {
        for (self.buckets) |bucket| if (bucket.charged_until_ms > now_ms) return false;
        return true;
    }
};

sources: std.AutoHashMapUnmanaged(types.Address, Source),
global: [stage_count]Bucket = @splat(.{}),

pub fn init(allocator: std.mem.Allocator) std.mem.Allocator.Error!Admission {
    var sources: std.AutoHashMapUnmanaged(types.Address, Source) = .empty;
    try sources.ensureTotalCapacity(allocator, source_capacity);
    return .{ .sources = sources };
}

pub fn deinit(self: *Admission, allocator: std.mem.Allocator) void {
    self.sources.deinit(allocator);
    self.* = undefined;
}

pub fn allow(self: *Admission, stage: Stage, address: *const types.Address, now_ms: u64) bool {
    return self.allowCost(stage, address, 1, now_ms);
}

pub fn allowRecords(self: *Admission, address: *const types.Address, count: u8, now_ms: u64) bool {
    std.debug.assert(count > 0 and count <= types.findnode_result_max);
    return self.allowCost(.record, address, count, now_ms);
}

fn allowCost(self: *Admission, stage: Stage, address: *const types.Address, cost: u16, now_ms: u64) bool {
    return self.charge(stage, address, cost, now_ms) == .allowed;
}

fn charge(self: *Admission, stage: Stage, address: *const types.Address, cost: u16, now_ms: u64) Outcome {
    const index = @intFromEnum(stage);
    const limits = quotas(stage);
    const global_next = self.global[index].next(limits.global, cost, now_ms) orelse return .global_limit;
    const source = self.findSource(address, now_ms) orelse return .source_capacity;
    const source_next = source.buckets[index].next(limits.source, cost, now_ms) orelse return .source_limit;
    source.buckets[index].charged_until_ms = source_next;
    self.global[index].charged_until_ms = global_next;
    return .allowed;
}

fn findSource(self: *Admission, address: *const types.Address, now_ms: u64) ?*Source {
    var group = address.*;
    switch (group) {
        .ip4 => |*ip| ip.port = 0,
        .ip6 => |*ip| {
            ip.port = 0;
            ip.interface = 0;
            @memset(ip.octets[8..], 0);
        },
    }
    if (self.sources.getPtr(group)) |source| return source;
    if (self.sources.count() == source_capacity) {
        var iterator = self.sources.iterator();
        var reusable: ?types.Address = null;
        while (iterator.next()) |entry| {
            if (entry.value_ptr.reusable(now_ms)) {
                reusable = entry.key_ptr.*;
                break;
            }
        }
        // Replacing only replenished entries prevents source churn from refunding credit.
        const old = reusable orelse return null;
        const removed = self.sources.remove(old);
        std.debug.assert(removed);
    }
    self.sources.putAssumeCapacityNoClobber(group, .{});
    return self.sources.getPtr(group).?;
}

comptime {
    std.debug.assert(source_quota.interval_ms * source_quota.burst == 1_000);
    std.debug.assert(global_quota.interval_ms * global_quota.burst == 1_000);
    std.debug.assert(@sizeOf(Source) <= 40);
    std.debug.assert(source_capacity <= 2_048);
}

test {
    _ = @import("admission_test.zig");
}
