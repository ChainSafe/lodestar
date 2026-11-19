const std = @import("std");
const prom = @import("../metrics/registry.zig");
const PeerManager = @import("../peer_manager.zig").PeerManager;

/// The latest peer selection's deficits and sampling-group coverage.
pub fn write(manager: *const PeerManager, w: *prom.Encoder) prom.Error!void {
    const selection = &manager.selection;
    const memberships = try w.family(.{
        .name = "lodestar_discovery_subnet_peers_to_connect",
        .kind = .gauge,
        .help = "Missing peer memberships across requested subnets after selection",
        .labels = &.{"type"},
    });
    try memberships.sample(.{"attnets"}, selection.deficits.attestation);
    try memberships.sample(.{"syncnets"}, selection.deficits.sync);
    try w.scalar(.{
        .name = "lodestar_discovery_custody_group_peers_to_connect",
        .kind = .gauge,
        .help = "Missing peer memberships across requested sampling groups",
    }, selection.deficits.groups);
    try w.scalar(.{
        .name = "lodestar_peer_outbound_deficit_count",
        .kind = .gauge,
        .help = "Missing qualified outbound peers after selection",
    }, selection.deficits.outbound);
    const sampling_groups = try w.family(.{
        .name = "lodestar_peer_count_per_sampling_group",
        .kind = .gauge,
        .help = "Retained eligible subscribers to every current fork column subnet in each group",
        .labels = &.{"groupIndex"},
    });
    for (selection.coverage.groups[0..manager.local.fork.custody_groups], 0..) |count, index| {
        var buffer: [5]u8 = undefined;
        const label = std.fmt.bufPrint(&buffer, "{d}", .{index}) catch unreachable;
        try sampling_groups.sample(.{label}, count);
    }
}
