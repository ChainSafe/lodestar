const std = @import("std");
const constants = @import("constants.zig");
const topic = @import("topic.zig");
const assert = std.debug.assert;
const ForkSeq = @import("config").ForkSeq;

pub const boundary_max = 64;
pub const topics_per_boundary_max = 337;
pub const topic_max = boundary_max * topics_per_boundary_max;
pub const Kind = topic.Kind;
pub const kind_count = @typeInfo(Kind).@"enum".fields.len;
pub const Rule = struct { count: u16 = 0, ssz_min: u32 = 0, ssz_max: u32 = 0 };
pub const Boundary = struct { digest: [4]u8, fork: ?ForkSeq = null, epoch: u64 = 0, rules: [kind_count]Rule = @splat(.{}) };
pub const Match = struct { ordinal: u16, kind: Kind, rule: Rule };
pub const Error = error{InvalidTopicPolicy};

pub const Subnets = struct {
    attnets: u64 = 0,
    syncnets: u4 = 0,
    columns: std.StaticBitSet(128) = .empty,
    column_subnet_count: u16 = 0,

    pub fn add(self: *Subnets, name: topic.Name) void {
        switch (name.kind) {
            .beacon_attestation => self.attnets |= @as(u64, 1) << @intCast(name.subnet),
            .sync_committee => self.syncnets |= @as(u4, 1) << @intCast(name.subnet),
            .data_column_sidecar => self.columns.set(name.subnet),
            else => {},
        }
    }
};

pub fn validate(boundaries: []const Boundary) Error!u16 {
    if (boundaries.len == 0 or boundaries.len > boundary_max) return error.InvalidTopicPolicy;
    var count: u16 = 0;
    for (boundaries, 0..) |*boundary, index| {
        for (boundaries[0..index]) |*prior| if (std.mem.eql(u8, &prior.digest, &boundary.digest)) return error.InvalidTopicPolicy;
        const before = count;
        for (boundary.rules, 0..) |rule, k| {
            const kind: Kind = @enumFromInt(k);
            if (rule.count > kind.countMax() or rule.ssz_min > rule.ssz_max or rule.ssz_max > constants.MAX_PAYLOAD_SIZE or
                (rule.count == 0 and (rule.ssz_min != 0 or rule.ssz_max != 0))) return error.InvalidTopicPolicy;
            count = std.math.add(u16, count, rule.count) catch return error.InvalidTopicPolicy;
        }
        if (count == before) return error.InvalidTopicPolicy;
    }
    assert(count <= topic_max);
    return count;
}

pub const Namespace = struct {
    boundaries: []const Boundary,
    offsets: []const [kind_count]u16,
    topic_count: u16,

    pub fn init(a: std.mem.Allocator, input: []const Boundary) (std.mem.Allocator.Error || Error)!Namespace {
        const count = try validate(input);
        const boundaries = try a.dupe(Boundary, input);
        errdefer a.free(boundaries);

        const offsets = try a.alloc([kind_count]u16, input.len);
        errdefer a.free(offsets);

        var offset: u16 = 0;
        for (boundaries, offsets) |*boundary, *starts| {
            for (boundary.rules, starts) |rule, *start| {
                start.* = offset;
                offset += rule.count;
            }
        }
        assert(offset == count);
        return .{ .boundaries = boundaries, .offsets = offsets, .topic_count = count };
    }

    pub fn deinit(self: *Namespace, a: std.mem.Allocator) void {
        a.free(self.offsets);
        a.free(self.boundaries);
        self.* = undefined;
    }

    pub fn backingBytes(input: []const Boundary) usize {
        return input.len * (@sizeOf(Boundary) + @sizeOf([kind_count]u16));
    }

    pub fn lookup(self: *const Namespace, name: []const u8) ?Match {
        return self.lookupCanonical(topic.parseCanonical(name) orelse return null);
    }

    pub fn lookupCanonical(self: *const Namespace, parsed: topic.Canonical) ?Match {
        const k = @intFromEnum(parsed.name.kind);
        for (self.boundaries, self.offsets) |*boundary, *starts| {
            if (!std.mem.eql(u8, &boundary.digest, &parsed.digest)) continue;
            const rule = boundary.rules[k];
            if (parsed.name.subnet >= rule.count) return null;
            return .{ .kind = parsed.name.kind, .ordinal = starts[k] + parsed.name.subnet, .rule = rule };
        }
        return null;
    }

    pub fn topicAt(self: *const Namespace, ordinal: u16) topic.Canonical {
        assert(ordinal < self.topic_count);
        for (self.boundaries, self.offsets) |*boundary, *starts| {
            for (boundary.rules, starts, 0..) |rule, start, k| {
                if (ordinal >= start and ordinal - start < rule.count)
                    return .{ .digest = boundary.digest, .name = .{ .kind = @enumFromInt(k), .subnet = ordinal - start } };
            }
        }
        unreachable;
    }
};

test {
    _ = @import("topic_policy_lifecycle_test.zig");
    _ = @import("topic_policy_test.zig");
}
