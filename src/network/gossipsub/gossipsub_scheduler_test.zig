const std = @import("std");
const Now = @import("../types.zig").Now;
const support = @import("test_support.zig");
const Pair = @import("test_pair.zig").Pair;
const Budget = @import("turn.zig").Budget;
const topic = @import("topic.zig");
const constants = @import("constants.zig");
const frame_mod = @import("frame.zig");

test "gossip maintenance yields between bounded topics and resumes without repeating them" {
    var g = try support.init(std.testing.allocator, .{ .random_seed = 1, .topics_per_pump = 4 });
    defer g.deinit();
    for ([_][]const u8{ "beacon_block", "beacon_aggregate_and_proof", "voluntary_exit" }) |name| {
        var wire: [topic.topic_max_len]u8 = undefined;
        try support.subscribe(&g, topic.build(.{ 1, 2, 3, 4 }, name, &wire));
    }
    const Clock = struct {
        elapsed: i96 = 0,
        fn now(context: ?*anyopaque, _: std.Io.Clock) std.Io.Timestamp {
            const self: *@This() = @ptrCast(@alignCast(context.?));
            self.elapsed += constants.maintenance_slice_target_ns;
            return .{ .nanoseconds = self.elapsed };
        }
    };
    var clock: Clock = .{};
    var vtable = std.Io.failing.vtable.*;
    vtable.now = Clock.now;
    g.clock = .{ .userdata = &clock, .vtable = &vtable };
    const now: Now = Now.fromMilliseconds(.{ .mono_ms = 1, .unix_s = 0 });
    support.heartbeat(&g, now);
    var ordinals: [3]u16 = undefined;
    for ([_][]const u8{ "beacon_block", "beacon_aggregate_and_proof", "voluntary_exit" }, &ordinals) |name, *ordinal| {
        var wire: [topic.topic_max_len]u8 = undefined;
        ordinal.* = g.overlay.namespace.lookup(topic.build(.{ 1, 2, 3, 4 }, name, &wire)).?.ordinal;
    }
    var visited = std.StaticBitSet(3).empty;
    for (0..ordinals.len) |_| {
        g.maintainTopics(now);
        const last = g.cycle.order[g.cycle.cursor - 1];
        const index = std.mem.findScalar(u16, &ordinals, @intCast(last)).?;
        try std.testing.expect(!visited.isSet(index));
        visited.set(index);
    }
    try std.testing.expectEqual(@as(usize, 3), visited.count());
    g.maintainTopics(now);
    try std.testing.expect(!g.cycle.isActive());
    try std.testing.expectEqual(@as(u64, 1), g.cycle.epoch);
}

test "gossip saturated peers rotate after shared call or output exhaustion" {
    for ([_]u16{ 32, 120, 128 }) |peers| {
        try saturatedPeers(peers, .calls);
        try saturatedPeers(peers, .output);
    }
}

fn saturatedPeers(peers: u16, budget: Budget) !void {
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1, .connected_capacity = peers }, .{ .random_seed = 2 });
    defer setup.deinit();
    for (0..20) |_| try setup.pumpOnce();
    const g = setup.shared.client.gossipsub;
    const stream = setup.clientStream();
    for (1..peers) |i| {
        _ = support.addPeer(g, .{ .index = @intCast(i), .generation = 100 }, .v1_2) orelse return error.TestUnexpectedResult;
    }
    // One writable QUIC stream isolates scheduler fairness from remote flow control.
    for (g.sessions.rows, 0..) |*row, index| {
        g.sessions.setOutbound(@intCast(index), .{ .live = .{ .stream = stream, .version = .v1_2 } });
        row.io.rx_ready = false;
        row.io.write_first = true;
        try std.testing.expectEqual(@as(usize, 0), row.io.tx.control.count);
    }
    if (budget == .output) {
        g.options.calls_per_pump = 4096;
        g.options.output_per_pump = 256;
    }
    var progressed = std.StaticBitSet(128).empty;
    const rounds = @divExact(peers, 4);
    for (0..rounds) |_| {
        for (g.sessions.rows, 0..) |*row, index| {
            for (row.io.tx.control.count..64) |_| try std.testing.expect(row.io.tx.inject(&.{0}, setup.shared.pair.now.millis()));
            g.settle(@intCast(index));
        }
        const turn = support.pumpTurn(g, &setup.shared.pair.client, setup.shared.pair.now);
        try std.testing.expect(turn.exhausted().contains(budget));
        for (g.sessions.rows, 0..) |row, i| {
            if (row.io.tx.control.count < 64) progressed.set(i);
        }
    }
    try std.testing.expectEqual(@as(usize, peers), progressed.count());
    try std.testing.expectEqual(@as(u64, 0), g.sessions.blocked_writes);
    for (g.sessions.rows) |row| try std.testing.expect(row.io.write_budget_deferred > 0);
}

/// Leaves the client's session at the head of the ready list with a frame of three items, one more
/// than a turn's item budget, and three more sessions behind it with output on one writable QUIC
/// stream. Returns the reader.
fn readerAhead(setup: *Pair, writers: *[3]u16) !u16 {
    const g = setup.shared.client.gossipsub;
    const reader = g.sessions.find(setup.shared.handles.client).?;
    const stream = setup.clientStream();
    for (writers, 1..) |*writer, i| writer.* = support.addPeer(g, .{ .index = @intCast(300 + i), .generation = 1 }, .v1_2).?.index;
    for (0..3) |_| _ = support.pumpTurn(g, &setup.shared.pair.client, setup.shared.pair.now);
    try std.testing.expectEqual(@as(usize, 0), g.sessions.ready.len);
    g.options.items_per_pump = 2;
    const protobuf = @import("protobuf.zig");
    var body: [256]u8 = undefined;
    var rpc = protobuf.Writer.init(&body);
    for (0..3) |_| protobuf.writeSubscription(&rpc, true, "/eth2/01020304/beacon_block/ssz_snappy");
    var frame: [260]u8 = undefined;
    try std.testing.expect(g.sessions.receiveHandoff(reader, frame_mod.writeFrame(&frame, rpc.written()), false));
    g.settle(reader);
    for (writers) |index| {
        g.sessions.setOutbound(index, .{ .live = .{ .stream = stream, .version = .v1_2 } });
        g.sendSubscriptions(index);
        try std.testing.expect(g.sessions.rows[index].io.tx.inject(&.{0}, setup.shared.pair.now.millis()));
        g.settle(index);
    }
    try std.testing.expectEqual(reader, g.sessions.ready.head);
    return reader;
}

test "gossip turn stopped by the receive item budget leaves its skipped writers ahead for the next turn" {
    var setup: Pair = .{};
    try setup.initOpts(.{ .random_seed = 1, .connected_capacity = 4 }, .{ .random_seed = 2 });
    defer setup.deinit();
    for (0..20) |_| try setup.pumpOnce();
    const g = setup.shared.client.gossipsub;
    var writers: [3]u16 = undefined;
    _ = try readerAhead(&setup, &writers);
    _ = support.pumpTurn(g, &setup.shared.pair.client, setup.shared.pair.now);
    try std.testing.expectEqual(writers[0], g.sessions.ready.head);
    for (writers) |index| try std.testing.expect(g.sessions.rows[index].io.tx.pending());
    // The next turn visits the writers.
    g.cancelWrites(g.sessions.ref(writers[2]));
    setup.shared.pair.advance(5);
    _ = support.pumpTurn(g, &setup.shared.pair.client, setup.shared.pair.now);
    for (writers[0..2]) |index| try std.testing.expect(!g.sessions.rows[index].io.tx.pending());
}
