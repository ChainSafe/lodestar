const std = @import("std");
const FreeSlotBitmap = @import("FreeSlotBitmap.zig");

test "FreeSlotBitmap - init frees exactly first_free..capacity" {
    const allocator = std.testing.allocator;
    const word_bits = @bitSizeOf(u64);
    const three_level_capacity = word_bits * word_bits * word_bits;
    const cases = [_]struct { name: []const u8, capacity: u32, first_free: u32 }{
        .{ .name = "no free slots", .capacity = word_bits, .first_free = word_bits },
        .{ .name = "partial word", .capacity = word_bits - 1, .first_free = word_bits / 2 },
        .{ .name = "unaligned free tail across four levels", .capacity = three_level_capacity + word_bits + 1, .first_free = three_level_capacity + 1 },
        .{ .name = "all free across four levels", .capacity = three_level_capacity + word_bits + 1, .first_free = 0 },
    };
    for (cases) |case| {
        const capacity = case.capacity;
        const first_free = case.first_free;
        errdefer std.debug.print("case: {s}, capacity: {d}, first_free: {d}\n", .{ case.name, capacity, first_free });
        var slots = try FreeSlotBitmap.init(allocator, capacity, first_free);
        defer slots.deinit(allocator);

        var expected: u32 = first_free;
        while (expected < capacity) : (expected += 1) {
            try std.testing.expectEqual(expected, slots.lowest());
            slots.remove(expected);
        }
        try std.testing.expectEqual(capacity, slots.lowest());
    }
}

test "FreeSlotBitmap - lowest ignores the order slots were inserted in" {
    const allocator = std.testing.allocator;
    const capacity = 300_000;
    var slots = try FreeSlotBitmap.init(allocator, capacity, capacity);
    defer slots.deinit(allocator);
    try std.testing.expectEqual(capacity, slots.lowest());

    for ([_]u32{ 299_999, 70_000, 4096, 4095, 64, 63, 200_000, 1 }) |slot| slots.insert(slot);
    for ([_]u32{ 1, 63, 64, 4095, 4096, 70_000, 200_000, 299_999 }) |expected| {
        try std.testing.expectEqual(expected, slots.lowest());
        slots.remove(expected);
    }
    try std.testing.expectEqual(capacity, slots.lowest());
}

test "FreeSlotBitmap - matches a plain bit set under random inserts and removes" {
    const allocator = std.testing.allocator;
    const capacity = 70_000;
    var slots = try FreeSlotBitmap.init(allocator, capacity, 0);
    defer slots.deinit(allocator);
    var model = try std.DynamicBitSet.initFull(allocator, capacity);
    defer model.deinit();

    var prng = std.Random.DefaultPrng.init(0x5107);
    const random = prng.random();
    for (0..200_000) |_| {
        const slot = random.uintLessThan(u32, capacity);
        if (model.isSet(slot)) {
            model.unset(slot);
            slots.remove(slot);
        } else {
            model.set(slot);
            slots.insert(slot);
        }
        const expected: u32 = if (model.findFirstSet()) |first| @intCast(first) else capacity;
        try std.testing.expectEqual(expected, slots.lowest());
    }
}
