const std = @import("std");
const preset = @import("preset");
const t = @import("types.zig");
const Subnets = @import("../gossipsub/topic_policy.zig").Subnets;
const custody = @import("custody.zig");

pub fn gossip(subscriptions: *const Subnets, context: *const t.ForkContext) t.Coverage {
    var result: t.Coverage = .{ .attnets = subscriptions.attnets, .syncnets = subscriptions.syncnets };
    if (!context.fork.gte(.fulu) or subscriptions.column_subnet_count == 0) return result;
    for (0..context.custody_groups) |group| result.groups.set(group);
    for (0..preset.NUMBER_OF_COLUMNS) |column| {
        if (!subscriptions.columns.isSet(column % subscriptions.column_subnet_count))
            result.groups.unset(column % context.custody_groups);
    }
    return result;
}

pub fn stable(actual: *const t.Coverage, metadata: *const t.Metadata, sampled: ?custody.Groups) t.Coverage {
    return .{
        .attnets = actual.attnets & std.mem.readInt(u64, &metadata.attnets, .little),
        .syncnets = actual.syncnets & @as(u4, @intCast(metadata.syncnets)),
        .groups = actual.groups.intersectWith(sampled orelse .empty),
    };
}

test {
    _ = @import("coverage_test.zig");
}
