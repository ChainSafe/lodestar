const std = @import("std");
const binding = @import("binding.zig");
const RouteTable = @import("RouteTable.zig");

const Cid = binding.Cid;

fn cidFor(value: u16) Cid {
    var bytes: [16]u8 = undefined;
    for (&bytes, 0..) |*byte, position| byte.* = @truncate((value *% 131) +% position *% 7);
    bytes[0] = @truncate(value);
    bytes[1] = @truncate(value >> 8);
    return Cid.fromSlice(&bytes);
}

test "route table inserts, finds, and removes routes" {
    var table = try RouteTable.init(std.testing.allocator, 4, 0x1234);
    defer table.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 16), table.entries.len);

    const first = cidFor(1);
    const second = cidFor(2);
    try table.insert(&first, 7);
    try table.insert(&second, 7);
    try std.testing.expectError(error.Full, table.insert(&first, 8));
    try std.testing.expectEqual(@as(usize, 2), table.count);
    try std.testing.expectEqual(@as(?u16, 7), table.find(&first));
    try std.testing.expectEqual(@as(?u16, 7), table.find(&second));
    try std.testing.expectEqual(@as(?u16, null), table.find(&cidFor(3)));

    table.remove(&first, 7);
    try std.testing.expectEqual(@as(?u16, null), table.find(&first));
    try std.testing.expectEqual(@as(?u16, 7), table.find(&second));
    table.remove(&second, 7);
    try std.testing.expectEqual(@as(?u16, null), table.find(&second));
    try std.testing.expectEqual(@as(usize, 0), table.count);
}

test "route table keeps colliding routes findable across removals" {
    var table = try RouteTable.init(std.testing.allocator, 64, 99);
    defer table.deinit(std.testing.allocator);

    var value: u16 = 0;
    while (value < 128) : (value += 1) {
        try table.insert(&cidFor(value), value / 2);
    }
    try std.testing.expectEqual(@as(usize, 128), table.count);
    value = 0;
    while (value < 128) : (value += 2) {
        table.remove(&cidFor(value), value / 2);
    }
    try std.testing.expectEqual(@as(usize, 64), table.count);
    value = 0;
    while (value < 128) : (value += 1) {
        const expected: ?u16 = if (value % 2 == 0) null else value / 2;
        try std.testing.expectEqual(expected, table.find(&cidFor(value)));
    }
    table.remove(&cidFor(7), 3);
    try std.testing.expectEqual(@as(?u16, null), table.find(&cidFor(7)));
    try std.testing.expectEqual(@as(?u16, 4), table.find(&cidFor(9)));
}

test "route table refuses inserts past half its capacity" {
    var table = try RouteTable.init(std.testing.allocator, 1, 5);
    defer table.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 4), table.entries.len);
    try table.insert(&cidFor(1), 0);
    try table.insert(&cidFor(2), 0);
    try std.testing.expectError(error.Full, table.insert(&cidFor(3), 0));
    table.remove(&cidFor(1), 0);
    table.remove(&cidFor(2), 0);
    try table.insert(&cidFor(3), 0);
    try std.testing.expectEqual(@as(?u16, 0), table.find(&cidFor(3)));
    try std.testing.expectEqual(@as(?u16, null), table.find(&Cid{}));
}

test "route table lookups depend on the seed but not on insertion order" {
    var seeded = try RouteTable.init(std.testing.allocator, 8, 1);
    defer seeded.deinit(std.testing.allocator);
    var reseeded = try RouteTable.init(std.testing.allocator, 8, 2);
    defer reseeded.deinit(std.testing.allocator);
    var value: u16 = 16;
    while (value > 0) : (value -= 1) {
        try seeded.insert(&cidFor(value), value);
        try reseeded.insert(&cidFor(17 - value), 17 - value);
    }
    value = 1;
    while (value <= 16) : (value += 1) {
        try std.testing.expectEqual(@as(?u16, value), seeded.find(&cidFor(value)));
        try std.testing.expectEqual(@as(?u16, value), reseeded.find(&cidFor(value)));
    }
}

test "route table repairs clusters longer than the probe limit" {
    var table = try RouteTable.init(std.testing.allocator, 128, 42);
    defer table.deinit(std.testing.allocator);
    var cids: [66]Cid = undefined;
    var found: usize = 0;
    for (0..1_000_000) |nonce| {
        if (found == cids.len) break;
        var raw: [16]u8 = [_]u8{0} ** 16;
        std.mem.writeInt(u64, raw[0..8], @intCast(nonce), .little);
        const cid = Cid.fromSlice(&raw);
        const desired: usize = if (found < 64) 0 else found - 63;
        const bucket = std.hash.Wyhash.hash(table.seed, cid.slice()) & (table.entries.len - 1);
        if (bucket != desired) continue;
        cids[found] = cid;
        try table.insert(&cids[found], @intCast(found));
        found += 1;
    }
    try std.testing.expectEqual(cids.len, found);
    try std.testing.expectEqual(@as(?u16, 65), table.find(&cids[65]));
    table.remove(&cids[0], 0);
    for (cids[1..], 1..) |cid, index| {
        try std.testing.expectEqual(@as(?u16, @intCast(index)), table.find(&cid));
    }
    try std.testing.expectEqual(@as(usize, 65), table.count);
}
