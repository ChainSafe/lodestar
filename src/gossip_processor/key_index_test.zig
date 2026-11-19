const std = @import("std");
const Index = @import("key_index.zig").Index;

test "fixed key index preserves colliding keys through deletion and reuse" {
    const t = std.testing;
    var rows: [64]struct { key: [32]u8 } = undefined;
    var index = try Index([32]u8).init(t.allocator, rows.len);
    defer index.deinit(t.allocator);
    for (&rows, 0..) |*row, i| {
        row.key = @splat(@intCast(i));
        index.insert(&rows, @intCast(i));
    }
    for (0..32) |i| index.remove(&rows, &rows[i * 2].key);
    for (&rows, 0..) |*row, i| try t.expectEqual(if (i % 2 == 0) null else @as(?u32, @intCast(i)), index.find(&rows, &row.key));
    for (0..32) |i| index.insert(&rows, @intCast(i * 2));
    for (&rows, 0..) |*row, i| try t.expectEqual(@as(u32, @intCast(i)), index.find(&rows, &row.key).?);
}
