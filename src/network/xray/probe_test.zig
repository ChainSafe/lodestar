const std = @import("std");
const Probe = @import("probe.zig").Probe;
const Endpoint = @import("socket.zig").Endpoint;
const PeerId = @import("../wire/peer_id.zig").PeerId;

test "xray exporter shutdown does not depend on an available collector" {
    const endpoint = try Endpoint.parse("/nonexistent-lodestar-z-xray-test/collector.sock");
    const peer: PeerId = .{ .bytes = @splat(0) };
    const probe = try Probe.create(std.testing.allocator, std.testing.io, 1, &endpoint, &peer, "test");
    defer probe.destroy(std.testing.allocator);
    probe.finish();
    try std.testing.expect(probe.thread == null);
    try std.testing.expect(!probe.attached.load(.acquire));
}
