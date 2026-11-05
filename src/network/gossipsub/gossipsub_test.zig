const support = @import("test_support.zig");
const std = @import("std");
const topic_mod = @import("topic.zig");
const Pair = @import("test_pair.zig").Pair;
const constants_heartbeat = @import("constants.zig").heartbeat_interval_ms;
const topic_fixture = @import("topic_fixture.zig");
const session_io = @import("session_io.zig");

test "gossipsub exchanges subscriptions, forms a mesh and delivers a publication" {
    var setup: Pair = .{};
    try setup.init();
    defer setup.deinit();

    const beacon_block = "/eth2/6a95a1a9/beacon_block/ssz_snappy";
    try support.subscribe(setup.shared.client.gossipsub, beacon_block);
    try support.subscribe(setup.shared.server.gossipsub, beacon_block);

    for (0..10) |_| try setup.pumpOnce();
    const client_topic = setup.shared.client.gossipsub.overlay.findTopic(beacon_block).?;
    const server_topic = setup.shared.server.gossipsub.overlay.findTopic(beacon_block).?;
    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.gossipsub.overlay.subscribers(client_topic).count());
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.gossipsub.overlay.subscribers(server_topic).count());

    setup.shared.pair.advance(constants_heartbeat + 100);
    for (0..10) |_| try setup.pumpOnce();

    try std.testing.expectEqual(@as(usize, 1), setup.shared.client.gossipsub.overlay.mesh(client_topic).count());
    try std.testing.expectEqual(@as(usize, 1), setup.shared.server.gossipsub.overlay.mesh(server_topic).count());

    const payload = "a signed beacon block payload for the mesh";
    _ = try setup.shared.client.gossipsub.publish(beacon_block, payload, setup.shared.pair.now);

    var received = false;
    var rounds: usize = 0;
    while (rounds < 20 and !received) : (rounds += 1) {
        try setup.pumpOnce();
        for (setup.serverMessages()) |m| {
            try std.testing.expectEqualStrings(beacon_block, m.topic);
            try std.testing.expectEqualStrings(payload, m.bytes);
            _ = setup.shared.server.gossipsub.report(m.handle, .accept, setup.shared.pair.now);
            received = true;
        }
    }
    try std.testing.expect(received);
    try std.testing.expectEqual(@as(u64, 1), setup.shared.server.gossipsub.topic_metrics.get(beacon_block).accepted);
}

test "gossipsub subscription replay through small critical queues eventually idles" {
    const topic_capacity = @import("constants.zig").topics_cap;
    const topics = &topic_fixture.churn;
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1, .topic_policy = topics, .critical_bytes = 256, .control_bytes = 64 }, .{ .random_seed = 1, .topic_policy = topics, .critical_bytes = 256, .control_bytes = 64 });
    defer setup.deinit();
    var buf: [topic_mod.topic_max_len]u8 = undefined;
    for (0..topic_capacity) |i| {
        const topic = try topic_fixture.churnTopic(i, &buf);
        try support.subscribe(setup.shared.client.gossipsub, topic);
        try support.subscribe(setup.shared.server.gossipsub, topic);
    }
    for (0..128) |_| try setup.pumpOnce();
    const peer = setup.shared.client.gossipsub.sessions.find(setup.shared.handles.client).?;
    session_io.resetOutbound(setup.shared.client.gossipsub, &setup.shared.pair.client, peer);
    setup.shared.client.gossipsub.sessions.setOutbound(peer, .pending);
    for (0..136) |_| try setup.pumpOnce();
    try std.testing.expect(support.sessionWakeup(setup.shared.client.gossipsub, setup.shared.pair.now) > setup.shared.pair.now.millis());
}
