const std = @import("std");
const p = @import("network_publications.zig");
const Budget = @import("network_budget.zig").Budget;

test "publication admission protects urgent slots and charges the shared byte budget" {
    var budget: Budget = .{ .limit = 100 };
    var table = try p.Table.init(std.testing.allocator, 4, &budget, 12_000);
    defer table.deinit();
    try std.testing.expectError(error.ResourceExhausted, table.reserve(.beacon_block, 101));
    var tokens: [4]p.Token = undefined;
    for (tokens[0..3]) |*token| token.* = try table.reserve(.beacon_attestation, 20);
    try std.testing.expectError(error.PublicationQueueFull, table.reserve(.beacon_attestation, 1));
    try std.testing.expectError(error.NetworkBridgeFull, table.reserve(.beacon_block, 41));
    tokens[3] = try table.reserve(.beacon_block, 40);
    try std.testing.expectEqual(@as(usize, 100), budget.used);
    try std.testing.expectError(error.PublicationQueueFull, table.reserve(.beacon_block, 0));
    for (tokens) |token| table.retire(token);
    try std.testing.expectEqual(@as(usize, 0), budget.used);
}

test "publication close preserves pins and completed results and releases queued payloads" {
    var budget: Budget = .{ .limit = 100 };
    var table = try p.Table.init(std.testing.allocator, 4, &budget, 12_000);
    defer table.deinit();
    const preparing = try table.reserve(.beacon_block, 10);
    const copying = try table.reserve(.beacon_block, 10);
    const queued = try table.reserve(.beacon_block, 10);
    const done = try table.reserve(.beacon_block, 10);
    table.get(copying).?.state = .copying;
    table.get(queued).?.state = .queued;
    table.get(queued).?.payload = try std.testing.allocator.alloc(u8, 10);
    table.get(done).?.state = .terminal;
    table.releasePayload(table.get(done).?);
    table.close(error.NetworkClosed);
    try std.testing.expectEqual(p.State.preparing, table.get(preparing).?.state);
    try std.testing.expectEqual(p.State.copying, table.get(copying).?.state);
    try std.testing.expectEqual(error.NetworkClosed, table.get(queued).?.failure.?);
    try std.testing.expectEqual(@as(usize, 0), table.get(queued).?.payload.len);
    try std.testing.expect(table.get(done).?.failure == null);
    try std.testing.expectEqual(@as(usize, 20), budget.used);
    table.trim();
    try std.testing.expectEqual(@as(usize, 4), table.cells.len);
    for ([_]p.Token{ preparing, copying, queued, done }) |token| table.retire(token);
    table.trim();
    try std.testing.expectEqual(@as(usize, 0), table.cells.len);
}

test "publication scheduling follows admission order across reused slots" {
    var budget: Budget = .{ .limit = 100 };
    var table = try p.Table.init(std.testing.allocator, 2, &budget, 12_000);
    defer table.deinit();
    const first = try table.reserve(.beacon_block, 1);
    table.retire(first);
    const later = try table.reserve(.beacon_block, 1);
    const earlier = try table.reserve(.beacon_block, 1);
    table.get(later).?.state = .queued;
    table.get(later).?.order = 20;
    table.get(earlier).?.state = .queued;
    table.get(earlier).?.order = 10;
    try std.testing.expect(table.get(first) == null);
    try std.testing.expectEqual(earlier, table.oldest().?);
    table.retire(earlier);
    try std.testing.expectEqual(later, table.oldest().?);
    table.retire(later);
}

test "publication queue expiry releases copied bytes before publication and keeps the terminal outcome" {
    var budget: Budget = .{ .limit = 100 };
    var table = try p.Table.init(std.testing.allocator, 2, &budget, 1000);
    defer table.deinit();
    const first = try table.reserve(.beacon_block, 10);
    defer table.retire(first);
    const expired = try table.reserve(.beacon_block, 10);
    defer table.retire(expired);
    for ([_]p.Token{ first, expired }) |token| {
        const cell = table.get(token).?;
        cell.queued_ms = 10;
        cell.payload = try std.testing.allocator.alloc(u8, 10);
        table.transition(cell, .queued);
    }
    table.get(expired).?.max_wait_ms = 10;
    try std.testing.expect(table.begin(first, 1009));
    try std.testing.expectEqual(p.State.executing, table.get(first).?.state);
    table.releasePayload(table.get(first).?);
    table.transition(table.get(first).?, .terminal);
    try std.testing.expect(!table.begin(expired, 20));
    try std.testing.expectEqual(error.PublicationExpired, table.get(expired).?.failure.?);
    try std.testing.expectEqual(p.State.terminal, table.get(expired).?.state);
    try std.testing.expectEqual(@as(usize, 0), budget.used);
    table.close(error.NetworkClosed);
    try std.testing.expectEqual(error.PublicationExpired, table.get(expired).?.failure.?);
    try std.testing.expectEqual(@as(u64, 2), table.latency.count);
}

test "publication slots release after settlement independently of payload bytes" {
    var budget: Budget = .{ .limit = 100 };
    var table = try p.Table.init(std.testing.allocator, 2, &budget, 1000);
    defer table.deinit();
    const token = try table.reserve(.beacon_block, 10);
    table.releasePayload(table.get(token).?);
    try std.testing.expectEqual(@as(u64, 1), budget.release_revision);
    try std.testing.expectEqual(@as(u64, 0), table.release_revision);
    table.retire(token);
    try std.testing.expectEqual(@as(u64, 1), table.release_revision);
    try std.testing.expectEqual(@as(u64, 1), budget.release_revision);
}

test "a caller cannot extend the publication queue lifetime" {
    var budget: Budget = .{ .limit = 100 };
    var table = try p.Table.init(std.testing.allocator, 1, &budget, 1000);
    defer table.deinit();
    const token = try table.reserve(.beacon_block, 0);
    defer table.retire(token);
    const cell = table.get(token).?;
    cell.max_wait_ms = 2000;
    table.transition(cell, .queued);
    try std.testing.expect(!table.begin(token, 1000));
    try std.testing.expectEqual(error.PublicationExpired, cell.failure.?);
}
