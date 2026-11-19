const std = @import("std");
const Setup = @import("network_core_test_support.zig").Setup;
const t = @import("peers/types.zig");
const Engine = @import("quic/Engine.zig");
const test_support = @import("quic/test_support.zig");
const time = @import("time.zig");
const network_core_test_support = @import("network_core_test_support.zig");

/// Bidirectional streams the client opened on the connection.
fn clientStreams(setup: *Setup, conn: Engine.Handle) u64 {
    return setup.pair.client.registry.slots[conn.index].table.next_local_id / 4;
}

test "identify core schedules once after Status and completes without public output" {
    var setup: Setup = .{};
    var options = network_core_test_support.resolvedOptions();
    options.core.protocols.identify = .{ .agent = "core-test", .inbound_max = 1, .outbound_max = 1 };
    try setup.initOwnersWithOptions(&.{}, options);
    defer setup.deinit();
    _ = try setup.pair.dial();
    for (0..100) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    try std.testing.expectEqual(@as(usize, 1), setup.client.peer_manager.snapshots(&snapshots));
    const before = snapshots[0];
    try std.testing.expect(before.relevant);
    try std.testing.expectEqualStrings("core-test", before.identify.?.agent.?.slice());
    const schedule = &setup.client.peer_manager.control.connections[before.peer.index];
    try std.testing.expectEqual(.done, schedule.identify_state);
    const opened = clientStreams(&setup, before.connection.?);
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    for (0..100) |_| try setup.step(0);
    // The re-Status request is the only stream the client opens; another Identify would open one more.
    try std.testing.expectEqual(opened + 1, clientStreams(&setup, before.connection.?));
    try std.testing.expectEqual(.done, schedule.identify_state);
    try std.testing.expectEqualDeep(before.identify, setup.client.peer_manager.catalog.get(before.peer).?.identify);
}

test "identify remote refusal completes generation without losing accepted Status" {
    const caps = @import("capabilities.zig");
    var setup: Setup = .{};
    var options = network_core_test_support.resolvedOptions();
    options.core.protocols.identify = .{ .agent = "core-test", .inbound_max = 1, .outbound_max = 1 };
    try setup.initOwnersWithOptions(&.{}, options);
    defer setup.deinit();
    var active = setup.server.protocols.router.capabilities();
    const only_identify = caps.withIdentify(.{ .receive = .initEmpty(), .request = .initEmpty() });
    active.receive.bits &= ~only_identify.receive.bits;
    setup.server.protocols.router.setCapabilities(active);
    _ = try setup.pair.dial();
    for (0..100) |_| try setup.step(0);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    try std.testing.expect(snapshots[0].relevant and snapshots[0].identify == null);
    const schedule = &setup.client.peer_manager.control.connections[snapshots[0].peer.index];
    try std.testing.expectEqual(.done, schedule.identify_state);
    const opened = clientStreams(&setup, snapshots[0].connection.?);
    setup.client.peer_manager.reStatusPeers(setup.pair.now);
    for (0..60) |_| try setup.step(0);
    // The re-Status request is the only stream the client opens; another Identify would open one more.
    try std.testing.expectEqual(opened + 1, clientStreams(&setup, snapshots[0].connection.?));
    try std.testing.expectEqual(.done, schedule.identify_state);
    try std.testing.expect(setup.client.peer_manager.catalog.get(snapshots[0].peer).?.identify == null);
    try std.testing.expect(setup.client.peer_manager.catalog.get(snapshots[0].peer).?.relevant);
}

test "identify replacement generation starts a fresh query and rejects stale completion" {
    var setup: Setup = .{};
    var options = network_core_test_support.resolvedOptions();
    options.core.protocols.identify = .{ .agent = "first", .inbound_max = 1, .outbound_max = 1 };
    try setup.initOwnersWithOptions(&.{}, options);
    defer setup.deinit();
    _ = try setup.pair.server.dial(&test_support.client_address, setup.client.peerId(), setup.pair.now);
    for (0..100) |_| try setup.step(1);
    var snapshots: [4]t.Snapshot = undefined;
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const old = snapshots[0];
    try std.testing.expectEqualStrings("first", old.identify.?.agent.?.slice());
    setup.server.protocols.identify.local.agent = try .init("replacement");
    _ = try setup.pair.dial();
    for (0..100) |_| try setup.step(1);
    _ = setup.client.peer_manager.snapshots(&snapshots);
    const selected = snapshots[0];
    try std.testing.expectEqualDeep(old.peer, selected.peer);
    try std.testing.expect(!std.meta.eql(old.connection, selected.connection));
    try std.testing.expectEqualStrings("replacement", selected.identify.?.agent.?.slice());
    try std.testing.expectEqual(.done, setup.client.peer_manager.control.connections[selected.peer.index].identify_state);
    setup.client.peer_manager.control.identifyResults(&setup.client.peer_manager.catalog, &.{.{ .peer = old.peer, .conn = old.connection.?, .outcome = .{ .success = old.identify.? } }});
    try std.testing.expectEqualDeep(selected, setup.client.peer_manager.catalog.get(selected.peer).?);
}

test "identify local refusal retries after one second without resetting accepted Status" {
    var setup: Setup = .{};
    var options = network_core_test_support.resolvedOptions();
    options.core.protocols.identify = .{ .agent = "core", .inbound_max = 1, .outbound_max = 1 };
    try setup.initOwnersWithOptions(&.{}, options);
    defer setup.deinit();
    _ = try setup.pair.dial();
    var snapshots: [4]t.Snapshot = undefined;
    for (0..16) |_| {
        try setup.step(0);
        if (setup.client.peer_manager.snapshots(&snapshots) == 1) break;
    }
    const peer = snapshots[0].peer;
    const conn = snapshots[0].connection.?;
    try std.testing.expect(!snapshots[0].relevant);
    try setup.client.protocols.identify.start(&setup.client.protocols.router, setup.pair.client, .{ .index = 3, .generation = 99 }, conn, setup.pair.now);
    try std.testing.expect(setup.client.peer_manager.catalog.updateStatus(peer, conn, &.{}, setup.pair.now.millis()));
    setup.client.peer_manager.control.rekey(&setup.client.peer_manager.catalog, peer.index);
    _ = try setup.turn(&setup.client, .{});
    const retry = setup.pair.now.millis() + 1000;
    const schedule = &setup.client.peer_manager.control.connections[peer.index];
    try std.testing.expectEqual(retry, schedule.identify_retry_ms);
    try std.testing.expectEqual(.pending, schedule.identify_state);
    for (0..60) |_| try setup.step(0);
    try std.testing.expectEqual(.pending, schedule.identify_state);
    setup.pair.now.monotonic = time.milliseconds(retry - 1);
    try setup.step(0);
    try std.testing.expectEqual(.pending, schedule.identify_state);
    setup.pair.now.monotonic = time.milliseconds(retry);
    for (0..60) |_| try setup.step(0);
    try std.testing.expectEqual(.done, schedule.identify_state);
    try std.testing.expectEqualStrings("core", setup.client.peer_manager.catalog.get(peer).?.identify.?.agent.?.slice());
}
