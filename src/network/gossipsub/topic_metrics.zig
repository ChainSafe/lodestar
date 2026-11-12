const std = @import("std");
const gossip = @import("root.zig");
const Gossipsub = @import("Gossipsub.zig");
const policy = gossip.topic_policy;
const prom = @import("../metrics/registry.zig");

pub fn write(g: *const Gossipsub, digest: [4]u8, w: *prom.Encoder) prom.Error!void {
    const overlay = g.overlay;
    const ns = &overlay.namespace;
    var mesh: [policy.topic_max]u16 = @splat(0);
    var subscribed = std.StaticBitSet(policy.topic_max).empty;
    var visible = std.StaticBitSet(policy.boundary_max).empty;
    for (ns.boundaries, 0..) |*boundary, index| {
        if (std.mem.eql(u8, &boundary.digest, &digest)) visible.set(index);
    }
    for (overlay.rows, 0..) |*row, ordinal| {
        if (!row.active) continue;
        mesh[ordinal] = @intCast(row.mesh.count());
        if (!row.subscribed) continue;
        subscribed.set(ordinal);
        for (ns.offsets, ns.boundaries, 0..) |starts, boundary, index| {
            const last = starts[policy.kind_count - 1] + boundary.rules[policy.kind_count - 1].count;
            if (ordinal >= starts[0] and ordinal < last) visible.set(index);
        }
    }
    inline for (.{ "mesh", "topic" }) |group| {
        inline for (.{ "type", "beacon_attestation_subnet", "sync_committee_subnet", "data_column_subnet" }) |suffix| {
            const metric = try w.family(.{
                .name = "lodestar_gossip_" ++ group ++ "_peers_by_" ++ suffix ++ "_count",
                .kind = .gauge,
                .help = if (std.mem.eql(u8, group, "mesh")) "Peer/topic mesh memberships in the current and locally subscribed fork boundaries" else "Accepted remote subscription memberships, including locally inactive topics, in the current and locally subscribed fork boundaries",
                .labels = &.{ if (std.mem.eql(u8, suffix, "type")) "type" else "subnet", "boundary" },
            });
            for (ns.boundaries, ns.offsets, 0..) |*boundary, starts, index| {
                if (!visible.isSet(index)) continue;
                const fork = boundary.fork orelse continue;
                var label_buffer: [48]u8 = undefined;
                const boundary_label = std.fmt.bufPrint(&label_buffer, "{s}_{d}", .{ @tagName(fork), boundary.epoch }) catch unreachable;
                inline for (std.meta.fields(policy.Kind)) |kind| {
                    const selected_suffix = comptime switch (@as(policy.Kind, @enumFromInt(kind.value))) {
                        .beacon_attestation => "beacon_attestation_subnet",
                        .sync_committee => "sync_committee_subnet",
                        .data_column_sidecar => "data_column_subnet",
                        else => "type",
                    };
                    if (comptime !std.mem.eql(u8, suffix, selected_suffix)) continue;
                    const count = boundary.rules[kind.value].count;
                    var total: usize = 0;
                    for (0..count) |subnet| {
                        const ordinal = starts[kind.value] + subnet;
                        const value: usize = if (comptime std.mem.eql(u8, group, "mesh")) mesh[ordinal] else overlay.subscribers(@intCast(ordinal)).count();
                        if (comptime std.mem.eql(u8, suffix, "type")) {
                            total += value;
                        } else {
                            var subnet_buffer: [5]u8 = undefined;
                            const label = std.fmt.bufPrint(&subnet_buffer, if (kind.value == @intFromEnum(policy.Kind.beacon_attestation)) "{d:0>2}" else "{d}", .{subnet}) catch unreachable;
                            try metric.sample(.{ label, boundary_label }, value);
                        }
                    }
                    if (comptime std.mem.eql(u8, suffix, "type")) {
                        if (count > 0) try metric.sample(.{ kind.name, boundary_label }, total);
                    }
                }
            }
        }
    }
    inline for (.{ "mesh", "topic", "subscriptions" }) |group| {
        const metric = try w.family(.{
            .name = if (comptime std.mem.eql(u8, group, "subscriptions")) "gossipsub_topic_subscription_status" else "gossipsub_" ++ group ++ "_peer_count",
            .kind = .gauge,
            .help = if (comptime std.mem.eql(u8, group, "subscriptions")) "Local subscription status per topic" else if (comptime std.mem.eql(u8, group, "mesh")) "Mesh peers per topic in the current and locally subscribed fork boundaries" else "Subscribed peers per topic in the current and locally subscribed fork boundaries",
            .labels = &.{"topicStr"},
        });
        for (ns.boundaries, ns.offsets, 0..) |*boundary, starts, index| {
            if (!visible.isSet(index)) continue;
            inline for (std.meta.fields(policy.Kind)) |kind| {
                for (0..boundary.rules[kind.value].count) |subnet| {
                    const ordinal = starts[kind.value] + subnet;
                    var name: [gossip.topic.topic_max_len]u8 = undefined;
                    const topic = gossip.topic.buildCanonical(.{ .digest = boundary.digest, .name = .{ .kind = @enumFromInt(kind.value), .subnet = @intCast(subnet) } }, &name);
                    try metric.sample(.{topic}, if (comptime std.mem.eql(u8, group, "mesh")) mesh[ordinal] else if (comptime std.mem.eql(u8, group, "topic")) overlay.subscribers(@intCast(ordinal)).count() else @intFromBool(subscribed.isSet(ordinal)));
                }
            }
        }
    }
}
