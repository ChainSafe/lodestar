const std = @import("std");
const rr = @import("network").reqresp;
const Budget = @import("network_budget.zig").Budget;
const requests = @import("network_requests.zig");
const Table = requests.Table;
const forkLabel = requests.forkLabel;

test "request fork projection retains the context-free nullable representation" {
    try std.testing.expect(forkLabel(null) == null);
    try std.testing.expectEqualStrings("deneb", forkLabel(.deneb).?);
    try std.testing.expectEqualStrings("fulu", forkLabel(.fulu).?);
}

test "request reservations are exact and stale generations cannot release replacements" {
    const protocol = rr.Protocol.blocks_by_root_v2;
    const amount = 32 + 2 * protocol.info().response_max;
    var budget: Budget = .{ .limit = amount };
    var table = try Table.init(std.testing.allocator, 1, &budget);
    defer table.deinit();
    const first = try table.reserve(protocol, 32);
    try table.allocate(first, 32);
    table.get(first).?.state = .queued;
    try std.testing.expectEqual(amount, table.snapshot().reservedBytes);
    try std.testing.expectEqual(@as(usize, 32), table.snapshot().inputBytes);
    try std.testing.expectEqual(protocol.info().response_max, table.snapshot().sinkBytes);
    try std.testing.expectError(error.NetworkRequestFull, table.reserve(protocol, 32));
    table.retire(first);
    const replacement = try table.reserve(protocol, 32);
    try std.testing.expectEqual(first.generation + 1, replacement.generation);
    try std.testing.expect(table.get(first) == null);
    table.retire(replacement);
    budget.limit = amount - 1;
    try std.testing.expectError(error.NetworkBridgeFull, table.reserve(protocol, 32));
    try std.testing.expectEqual(@as(usize, 0), table.snapshot().reservedBytes);
    table.cells[0].generation = std.math.maxInt(u64);
    try std.testing.expectError(error.NetworkRequestFull, table.reserve(protocol, 0));
}

test "request allocation prefixes release through retirement and terminal chunks pin independent sinks" {
    const protocol = rr.Protocol.blocks_by_root_v2;
    const amount = 32 + 2 * protocol.info().response_max;
    for (0..2) |fail_index| {
        var budget: Budget = .{ .limit = amount };
        var table = try Table.init(std.testing.allocator, 1, &budget);
        defer table.deinit();
        const token = try table.reserve(protocol, 32);
        var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = fail_index });
        table.backing = failing.allocator();
        try std.testing.expectError(error.OutOfMemory, table.allocate(token, 32));
        table.retire(token);
        table.backing = std.testing.allocator;
        try std.testing.expectEqual(@as(usize, 0), table.snapshot().reservedBytes);
    }
    var budget: Budget = .{ .limit = amount };
    var table = try Table.init(std.testing.allocator, 1, &budget);
    defer table.deinit();
    const token = try table.reserve(protocol, 32);
    try table.allocate(token, 32);
    const cell = table.get(token).?;
    cell.state = .terminal;
    cell.terminal = .done;
    cell.chunk = .{ .len = 4, .fork = null, .origin = .{ .connection = .{ .index = 0, .generation = 1 }, .endpoint = null } };
    @memcpy(cell.sink[0..4], "held");
    table.releasePayload(cell);
    try std.testing.expectEqual(@as(usize, 0), cell.input.len);
    try std.testing.expectEqualSlices(u8, "held", cell.sink[0..4]);
    cell.copying = true;
    table.releasePayload(cell);
    try std.testing.expectEqual(@as(usize, 4), table.snapshot().copyingBytes);
    cell.copying = false;
    cell.chunk = null;
    table.releasePayload(cell);
    try std.testing.expectEqual(@as(usize, 0), cell.sink.len);
    try std.testing.expectEqual(@as(usize, 0), table.snapshot().reservedBytes);
    try std.testing.expectEqual(@as(usize, 1), table.snapshot().terminalCells);
    table.retire(token);
}
