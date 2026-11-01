const topic_policy = @import("topic_policy.zig");
const constants = @import("constants.zig");

pub fn full(digest: [4]u8) topic_policy.Boundary {
    var boundary: topic_policy.Boundary = .{ .digest = digest };
    for (&boundary.rules) |*rule| rule.* = .{ .count = 1, .ssz_min = 10, .ssz_max = 100 };
    boundary.rules[2].count = 64;
    boundary.rules[7].count = 4;
    boundary.rules[11].count = 128;
    boundary.rules[12].count = 128;
    return boundary;
}

pub fn blocks(digest: [4]u8) topic_policy.Boundary {
    var boundary = full(digest);
    boundary.rules[0].ssz_min = 0;
    boundary.rules[0].ssz_max = constants.MAX_PAYLOAD_SIZE;
    return boundary;
}

pub fn bytes(digest: [4]u8) topic_policy.Boundary {
    var boundary = full(digest);
    for (&boundary.rules) |*rule| {
        rule.ssz_min = 0;
        rule.ssz_max = constants.MAX_PAYLOAD_SIZE;
    }
    return boundary;
}

pub const churn = [_]topic_policy.Boundary{ bytes(.{ 1, 2, 3, 4 }), bytes(.{ 5, 6, 7, 8 }), bytes(.{ 9, 10, 11, 12 }) };

pub fn churnTopic(index: usize, out: []u8) ![]const u8 {
    std.debug.assert(index < constants.topics_cap);
    return std.fmt.bufPrint(out, "/eth2/{x:0>8}/{s}_{d}/ssz_snappy", .{
        @as(u32, if (index < 256) 0x01020304 else 0x05060708),
        @as([]const u8, if (index % 256 < 128) "blob_sidecar" else "data_column_sidecar"),
        index % 128,
    });
}

pub fn hoodi() [5]topic_policy.Boundary {
    var out: [5]topic_policy.Boundary = undefined;
    const digests = [_][4]u8{ .{ 0xd2, 0xf1, 0x99, 0x7f }, .{ 0x82, 0x55, 0x6a, 0x32 }, .{ 0xe2, 0xab, 0xcc, 0xa4 }, .{ 0xae, 0x9f, 0x70, 0xa0 }, .{ 0xc6, 0xec, 0xb7, 0x6c } };
    for (&out, digests, 0..) |*b, digest, i| {
        b.* = full(digest);
        b.rules[11] = if (i < 2) .{ .count = if (i == 0) 6 else 9, .ssz_min = 10, .ssz_max = 100 } else .{};
        if (i < 2) b.rules[12] = .{};
    }
    return out;
}

const local = @import("local_intent.zig");
const topic = @import("topic.zig");
const std = @import("std");

pub fn subscriptions(comptime names: []const []const u8) []const local.Boundary {
    return comptime blk: {
        @setEvalBranchQuota(100_000);
        var buffer: [topic_policy.boundary_max]local.Boundary = undefined;
        const value = subscriptionsInto(names, &buffer) catch unreachable;
        const result = buffer[0..value.len].*;
        break :blk &result;
    };
}

pub fn subscriptionsInto(names: []const []const u8, out: *[topic_policy.boundary_max]local.Boundary) ![]const local.Boundary {
    std.debug.assert(names.len <= topic_policy.topic_max);
    var len: usize = 0;
    for (names) |name| {
        const parsed = topic.parseCanonical(name) orelse return error.InvalidTopic;
        const index = for (out[0..len], 0..) |*entry, i| {
            if (std.mem.eql(u8, &entry.digest, &parsed.digest)) break i;
        } else index: {
            if (len == out.len) return error.TopicCapacity;
            out[len] = .{ .digest = parsed.digest };
            len += 1;
            break :index len - 1;
        };
        const entry = &out[index];
        const byte = parsed.name.subnet / 8;
        entry.mask(parsed.name.kind)[byte] |= @as(u8, 1) << @intCast(parsed.name.subnet % 8);
        const k = @intFromEnum(parsed.name.kind);
        entry.lengths[k] = @max(entry.lengths[k], @as(u8, @intCast(byte + 1)));
    }
    return out[0..len];
}
