const std = @import("std");
const n = @import("network");
const Table = @import("network_peer_reports.zig").Table;
const network_peer_reports = @import("network_peer_reports.zig");

fn identity(value: u32) n.PeerId {
    var result: n.PeerId = .{ .bytes = @splat(0) };
    std.mem.writeInt(u32, result.bytes[0..4], value, .little);
    return result;
}

test "peer reports coalesce by identity, rotate fairly and release drained rows" {
    var table: Table = .{};
    for (0..300) |_| table.addCount(&.{ .identity = identity(1), .action = .high_tolerance }, 1);
    table.addCount(&.{ .identity = identity(2), .action = .fatal }, 1);
    table.addCount(&.{ .identity = identity(1), .action = .low_tolerance }, 1);
    try std.testing.expectEqual(@as(u32, 102), table.pending);
    try std.testing.expect(table.next().?.identity.eql(&identity(1)));
    try std.testing.expect(table.next().?.identity.eql(&identity(2)));
    for (0..100) |_| try std.testing.expect(table.next().?.identity.eql(&identity(1)));
    try std.testing.expect(table.next() == null);
    for (table.rows) |row| try std.testing.expect(!row.occupied);
    table.addCount(&.{ .identity = identity(1), .action = .fatal }, 1);
    try std.testing.expectEqual(n.peers.PeerAction.fatal, table.next().?.action);
    try std.testing.expect(table.next() == null);
}

test "full report table still coalesces existing identities and reuses released capacity" {
    var table: Table = .{};
    for (0..table.rows.len) |i| table.addCount(&.{ .identity = identity(@intCast(i)), .action = .high_tolerance }, 1);
    table.addCount(&.{ .identity = identity(600), .action = .fatal }, 1);
    try std.testing.expectEqual(@as(u64, 1), table.ignored);
    try std.testing.expectEqual(@as(u64, 1), table.dropped);
    table.addCount(&.{ .identity = identity(0), .action = .high_tolerance }, 1);
    try std.testing.expectEqual(@as(u32, 513), table.pending);
    _ = table.next().?;
    _ = table.next().?;
    table.addCount(&.{ .identity = identity(600), .action = .fatal }, 1);
    try std.testing.expectEqual(@as(u64, 1), table.ignored);
    try std.testing.expectEqual(@as(u64, 1), table.dropped);
    var count: usize = 0;
    for (0..513) |_| {
        const report = table.next() orelse break;
        if (report.identity.eql(&identity(600))) count += 1;
    }
    try std.testing.expectEqual(@as(usize, 1), count);
    try std.testing.expectEqual(@as(u32, 0), table.pending);
}

test "counted reports saturate as the same number of single reports do" {
    var counted: Table = .{};
    var single: Table = .{};
    for ([_]u8{ 1, 40, 70, 100 }) |count| {
        counted.addCount(&.{ .identity = identity(1), .action = .mid_tolerance }, count);
        for (0..count) |_| single.addCount(&.{ .identity = identity(1), .action = .mid_tolerance }, 1);
        try std.testing.expectEqual(single.pending, counted.pending);
        try std.testing.expectEqualSlices(u8, &single.rows[0].counts, &counted.rows[0].counts);
    }
    try std.testing.expectEqual(@as(u32, network_peer_reports.report_max), counted.pending);
}

test "peer reports preserve original endpoints across identity reconnects and queueing" {
    var table: Table = .{};
    var report: n.peers.types.PeerReport = .{
        .identity = identity(1),
        .action = .low_tolerance,
        .reason = .gossip_validation,
        .origin = .{ .connection = .{ .index = 1, .generation = 1 }, .endpoint = .{ .ip4 = .{ .octets = .{ 192, 0, 2, 1 }, .port = 9000 } } },
    };
    const original = report;
    table.addCount(&report, 2);
    report.origin.?.connection.generation += 1;
    report.origin.?.endpoint.?.ip4.octets[3] = 2;
    const reconnected = report;
    table.addCount(&report, 1);
    report.origin.?.endpoint = null;
    const mixed_path = report;
    table.addCount(&report, 1);
    report.origin = null;
    const unknown = report;
    table.addCount(&report, 1);
    report.reason = .gossip_import;
    table.addCount(&report, 1);
    try std.testing.expectEqualDeep(original, table.next().?);
    try std.testing.expectEqualDeep(reconnected, table.next().?);
    try std.testing.expectEqualDeep(mixed_path, table.next().?);
    try std.testing.expectEqualDeep(unknown, table.next().?);
    try std.testing.expectEqualDeep(report, table.next().?);
    try std.testing.expectEqualDeep(original, table.next().?);
    try std.testing.expect(table.next() == null);
}
