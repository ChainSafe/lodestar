const std = @import("std");
const mod = @import("identity_index.zig");
const PeerId = @import("types.zig").PeerId;

test "identity index preserves colliding wraparound clusters across deletion and reuse" {
    var rows: [16]struct { identity: PeerId = undefined, occupied: bool = false } = @splat(.{});
    var slots: [mod.capacity(rows.len)]u16 = @splat(mod.empty);
    const index: mod.Index = .{ .slots = &slots, .seed = 42 };
    var count: usize = 0;
    for (0..16_384) |value| {
        var identity: PeerId = .{ .bytes = @splat(0) };
        std.mem.writeInt(u32, identity.bytes[0..4], @intCast(value), .little);
        if (std.hash.Wyhash.hash(index.seed, &identity.bytes) & (slots.len - 1) != slots.len - 1) continue;
        rows[count].identity = identity;
        rows[count].occupied = true;
        index.insert(&rows, @intCast(count));
        count += 1;
        if (count == rows.len) break;
    }
    try std.testing.expectEqual(rows.len, count);
    for (0..128) |turn| {
        const removed = (turn * 7) % rows.len;
        index.remove(&rows, &rows[removed].identity);
        rows[removed].occupied = false;
        for (&rows, 0..) |*row, i| {
            try std.testing.expectEqual(if (row.occupied) @as(?u16, @intCast(i)) else null, index.find(&rows, &row.identity));
        }
        index.insert(&rows, @intCast(removed));
        rows[removed].occupied = true;
    }
    for (&rows) |*row| index.remove(&rows, &row.identity);
    for (slots) |slot| try std.testing.expectEqual(mod.empty, slot);
}
