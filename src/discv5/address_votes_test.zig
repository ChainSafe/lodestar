const std = @import("std");
const Votes = @import("AddressVotes.zig");
const types = @import("types.zig");
const message = @import("wire/message.zig");
const CallTable = @import("CallTable.zig");

const handle: CallTable.Handle = .{ .index = 0, .generation = 1 };

fn peer(id: u16) types.Endpoint {
    var node: types.NodeId = @splat(0);
    std.mem.writeInt(u16, node[0..2], id, .big);
    return .{ .node_id = node, .address = .{ .ip4 = .{ .octets = .{ 203, @intCast(id >> 8), @truncate(id), 1 }, .port = 9000 } } };
}
fn pong(port: u16) message.Pong {
    return .{ .request_id = message.RequestId.init(&.{1}) catch unreachable, .enr_sequence = 1, .recipient_ip = .{ .ip4 = .{ 198, 51, 100, 1 } }, .recipient_port = port };
}
fn sample(votes: *Votes, source: *const types.Endpoint, report: *const message.Pong, now_ms: u64) ?types.Address {
    votes.attempted(source, handle, now_ms);
    return votes.observe(source, handle, report, now_ms);
}

test "address votes need ten prefixes and a strict supermajority without unsolicited refresh" {
    var votes: Votes = .{};
    votes.init(.{ .{ .enabled = true }, .{} });
    for (0..9) |i| try std.testing.expect(sample(&votes, &peer(@intCast(i)), &pong(443), 0) == null);
    try std.testing.expect(sample(&votes, &peer(9), &pong(80), 0) == null);
    try std.testing.expect(votes.needsSample(0, 0));
    try std.testing.expectEqual(@as(u16, 443), sample(&votes, &peer(10), &pong(443), 1).?.port());
    try std.testing.expectEqual(@as(usize, 11), votes.count(0, 1));
    for (11..15) |i| _ = sample(&votes, &peer(@intCast(i)), &pong(80), 1);
    try std.testing.expect(votes.observe(&peer(0), handle, &pong(443), 2) == null);
    try std.testing.expect(sample(&votes, &peer(15), &pong(443), 2) != null);
    try std.testing.expectEqual(@as(usize, 6), votes.count(0, Votes.lifetime_ms));
    try std.testing.expectEqual(@as(usize, 1), votes.count(0, Votes.lifetime_ms + 1));
    try std.testing.expectEqual(@as(usize, 0), votes.count(0, Votes.lifetime_ms + 2));
}

test "node movement and multiple identities in one subnet cannot multiply votes" {
    var votes: Votes = .{};
    votes.init(.{ .{ .enabled = true }, .{} });
    _ = sample(&votes, &peer(1), &pong(1), 0);
    var other = peer(2);
    other.address = peer(1).address;
    other.address.ip4.octets[3] = 2;
    try std.testing.expect(!votes.canProbe(&other, 1));
    try std.testing.expect(votes.observe(&other, handle, &pong(1), 1) == null);
    try std.testing.expectEqual(@as(usize, 1), votes.count(0, 1));
    _ = sample(&votes, &peer(3), &pong(1), 1);
    other.node_id = peer(1).node_id;
    other.address = peer(3).address;
    try std.testing.expect(!votes.canProbe(&other, 2));
    try std.testing.expect(votes.observe(&other, handle, &pong(1), 2) == null);
    try std.testing.expectEqual(@as(usize, 2), votes.count(0, 2));
}

test "observations require the selected peer endpoint and call generation exactly once" {
    var votes: Votes = .{};
    votes.init(.{ .{ .enabled = true }, .{} });
    const next: CallTable.Handle = .{ .index = handle.index, .generation = handle.generation + 1 };
    try std.testing.expect(votes.observe(&peer(1), handle, &pong(443), 0) == null);
    votes.attempted(&peer(1), handle, 0);
    try std.testing.expect(votes.observe(&peer(1), next, &pong(443), 1) == null);
    var other = peer(1);
    other.address.ip4.port += 1;
    try std.testing.expect(votes.observe(&other, handle, &pong(443), 1) == null);
    other = peer(2);
    other.address = peer(1).address;
    try std.testing.expect(votes.observe(&other, handle, &pong(443), 1) == null);
    try std.testing.expectEqual(@as(usize, 0), votes.count(0, 1));
    _ = votes.observe(&peer(1), handle, &pong(443), 1);
    try std.testing.expectEqual(@as(usize, 1), votes.count(0, 1));
    try std.testing.expect(votes.observe(&peer(1), handle, &pong(80), 2) == null);
    try std.testing.expectEqual(@as(usize, 0), votes.count(0, Votes.lifetime_ms + 1));

    votes.attempted(&peer(1), next, Votes.lifetime_ms + 1);
    votes.localFailure(&peer(1), handle);
    try std.testing.expect(votes.observe(&peer(1), handle, &pong(443), Votes.lifetime_ms + 2) == null);
    _ = votes.observe(&peer(1), next, &pong(443), Votes.lifetime_ms + 2);
    try std.testing.expectEqual(@as(usize, 1), votes.count(0, Votes.lifetime_ms + 2));
    votes.attempted(&peer(2), handle, Votes.lifetime_ms + 2);
    try std.testing.expect(votes.observe(&peer(2), handle, &pong(443), 2 * Votes.lifetime_ms + 2) == null);
}

test "attempts do not vote and late local failure cannot erase successful evidence" {
    var votes: Votes = .{};
    votes.init(.{ .{ .enabled = true, .fixed_port = 443 }, .{} });
    votes.attempted(&peer(1), handle, 0);
    try std.testing.expectEqual(@as(usize, 0), votes.count(0, 0));
    try std.testing.expect(!votes.canProbe(&peer(1), 1));
    _ = votes.observe(&peer(1), handle, &pong(80), 1);
    votes.localFailure(&peer(1), handle);
    for (2..10) |i| _ = sample(&votes, &peer(@intCast(i)), &pong(@intCast(i)), 2);
    try std.testing.expectEqual(@as(u16, 443), sample(&votes, &peer(10), &pong(1), 3).?.port());
    votes.attempted(&peer(20), handle, 3);
    votes.localFailure(&peer(20), handle);
    try std.testing.expect(votes.canProbe(&peer(20), 4));
    try std.testing.expect(votes.canProbe(&peer(1), Votes.lifetime_ms + 3));
}

test "invalid observations consume the probe without voting" {
    var votes: Votes = .{};
    votes.init(.{ .{ .enabled = true }, .{ .enabled = true } });
    try std.testing.expect(sample(&votes, &peer(1), &pong(0), 0) == null);
    try std.testing.expect(votes.observe(&peer(1), handle, &pong(443), 1) == null);
    var report = pong(443);
    report.recipient_ip = .{ .ip4 = .{ 127, 0, 0, 1 } };
    try std.testing.expect(sample(&votes, &peer(2), &report, 0) == null);
    report.recipient_ip = .{ .ip6 = .{ 0x20, 1 } ++ .{0} ** 13 ++ .{1} };
    try std.testing.expect(sample(&votes, &peer(3), &report, 0) == null);
    try std.testing.expectEqual(@as(usize, 0), votes.count(0, 1));
}

test "IPv6 observations require distinct /48 sources" {
    var votes: Votes = .{};
    votes.init(.{ .{}, .{ .enabled = true } });
    var report = pong(443);
    report.recipient_ip = .{ .ip6 = .{ 0x20, 1 } ++ .{0} ** 13 ++ .{1} };
    var source = peer(0);
    source.address = .{ .ip6 = .{ .octets = report.recipient_ip.ip6, .port = 9000 } };
    _ = sample(&votes, &source, &report, 0);
    for (1..20) |i| {
        source.node_id[0] = @intCast(i);
        source.address.ip6.octets[6] = @intCast(i);
        source.address.ip6.octets[7] = @intCast(i);
        source.address.ip6.octets[15] = @intCast(i);
        source.address.ip6.interface = @intCast(i);
        try std.testing.expect(!votes.canProbe(&source, 0));
        try std.testing.expect(votes.observe(&source, handle, &report, 0) == null);
    }
    try std.testing.expectEqual(@as(usize, 1), votes.count(1, 0));
    for (1..10) |i| {
        source.node_id[0] = @intCast(i);
        source.address.ip6.octets[5] = @intCast(i);
        const observed = sample(&votes, &source, &report, 1);
        try std.testing.expectEqual(i == 9, observed != null);
    }
    try std.testing.expectEqual(@as(usize, 10), votes.count(1, 1));
    try std.testing.expectEqual(@as(usize, 0), votes.count(0, 1));
}

test "sample sufficiency counts successful observations independently of agreement" {
    var votes: Votes = .{};
    votes.init(.{ .{ .enabled = true }, .{} });
    for (0..Votes.sample_target) |i| {
        try std.testing.expect(votes.needsSample(0, 0));
        try std.testing.expect(sample(&votes, &peer(@intCast(i)), &pong(@intCast(i + 1)), 0) == null);
    }
    try std.testing.expect(!votes.needsSample(0, 1));
    try std.testing.expect(votes.needsSample(0, Votes.lifetime_ms));
}

test "evicted observation probes cannot vote on a delayed response" {
    var votes: Votes = .{};
    votes.init(.{ .{ .enabled = true }, .{} });
    votes.attempted(&peer(0), handle, 0);
    for (1..Votes.capacity + 1) |i| _ = sample(&votes, &peer(@intCast(i)), &pong(1), i);
    try std.testing.expectEqual(@as(usize, Votes.capacity), votes.count(0, Votes.capacity));
    try std.testing.expect(votes.canProbe(&peer(0), Votes.capacity));
    try std.testing.expect(votes.observe(&peer(0), handle, &pong(1), Votes.capacity) == null);
}
