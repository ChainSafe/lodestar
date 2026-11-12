const std = @import("std");
const DeadlineHeap = @import("deadline_heap.zig").DeadlineHeap;

fn expectValid(heap: *const DeadlineHeap) !void {
    var linked: usize = 0;
    for (heap.positions, 0..) |position, row| {
        if (position == DeadlineHeap.none) continue;
        linked += 1;
        try std.testing.expect(position < heap.len);
        try std.testing.expectEqual(@as(u32, @intCast(row)), heap.entries[position].row);
    }
    try std.testing.expectEqual(@as(usize, heap.len), linked);
    for (heap.entries[0..heap.len], 0..) |entry, position| {
        try std.testing.expectEqual(@as(u32, @intCast(position)), heap.positions[entry.row]);
        if (position == 0) continue;
        try std.testing.expect(heap.entries[(position - 1) / 2].deadline <= entry.deadline);
    }
}

test "deadline heap pops due rows in deadline order and keeps one key per row" {
    var heap = try DeadlineHeap.init(std.testing.allocator, 8);
    defer heap.deinit(std.testing.allocator);
    heap.set(3, 30);
    heap.set(1, 10);
    heap.set(5, 50);
    heap.set(1, 40);
    heap.set(5, 5);
    try expectValid(&heap);
    try std.testing.expectEqual(@as(u32, 3), heap.len);
    try std.testing.expectEqual(@as(?u64, 40), heap.get(1));
    try std.testing.expectEqual(DeadlineHeap.Entry{ .deadline = 5, .row = 5 }, heap.peek().?);
    try std.testing.expect(heap.popDue(4) == null);
    try std.testing.expectEqual(@as(?u32, 5), heap.popDue(30));
    try std.testing.expectEqual(@as(?u32, 3), heap.popDue(30));
    try std.testing.expect(heap.popDue(30) == null);
    try std.testing.expect(heap.get(3) == null);
    heap.clear(1);
    heap.clear(1);
    try std.testing.expect(heap.peek() == null);
    try expectValid(&heap);
}

test "deadline heap matches a reference minimum under random sets and clears" {
    const rows = 64;
    var heap = try DeadlineHeap.init(std.testing.allocator, rows);
    defer heap.deinit(std.testing.allocator);
    var reference: [rows]?u64 = @splat(null);
    var prng = std.Random.DefaultPrng.init(7);
    const random = prng.random();
    for (0..4_000) |_| {
        const row = random.uintLessThan(u32, rows);
        switch (random.uintLessThan(u8, 4)) {
            0 => {
                heap.clear(row);
                reference[row] = null;
            },
            1 => {
                const now = random.uintLessThan(u64, 1_000);
                const popped = heap.popDue(now);
                var earliest: ?u64 = null;
                for (reference) |value| if (value) |deadline| {
                    earliest = @min(earliest orelse deadline, deadline);
                };
                if (earliest != null and earliest.? <= now) {
                    try std.testing.expectEqual(earliest.?, reference[popped.?].?);
                    reference[popped.?] = null;
                } else try std.testing.expect(popped == null);
            },
            else => {
                const deadline = random.uintLessThan(u64, 1_000);
                heap.set(row, deadline);
                reference[row] = deadline;
            },
        }
        try expectValid(&heap);
        for (reference, 0..) |value, index| try std.testing.expectEqual(value, heap.get(@intCast(index)));
    }
}

fn allocateHeap(allocator: std.mem.Allocator) !void {
    var heap = try DeadlineHeap.init(allocator, 4);
    heap.deinit(allocator);
}

test "deadline heap startup allocation failure leaves no retained storage" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, allocateHeap, .{});
}
