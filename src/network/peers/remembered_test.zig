const std = @import("std");
const t = @import("types.zig");
const remembered = @import("remembered.zig");
const Memory = remembered.Memory;
const Record = remembered.Record;
const a = std.testing.allocator;
const now_s: u64 = 1_700_000_000;
const day_s: u64 = 24 * 60 * 60;
/// Tags splat every byte, so identities with a marked first byte never collide with a tag.
const local = marked(1);
const stranger = marked(2);

fn marked(first: u8) t.PeerId {
    var identity: t.PeerId = .{ .bytes = @splat(0) };
    identity.bytes[0] = first;
    return identity;
}

fn peer(tag: u8) t.PeerId {
    return .{ .bytes = @splat(tag) };
}

fn ip4(first: u8, second: u8, last: u8) t.Address {
    return .{ .ip4 = .{ .octets = .{ first, second, 0, last }, .port = 9000 } };
}

fn record(tag: u8, address: t.Address, age_s: u64) Record {
    return .{ .peer = peer(tag), .address = address, .qualified_at_s = now_s - age_s };
}

fn seeds(memory: *const Memory, stage: remembered.Seed) u64 {
    return memory.counters.seeds[@intFromEnum(stage)];
}

fn snapshotOf(memory: *Memory, at_s: u64, out: *[remembered.capacity]Record) []Record {
    return out[0..memory.snapshot(at_s, out)];
}

fn find(records: []const Record, tag: u8) ?Record {
    for (records) |value| if (value.peer.eql(&peer(tag))) return value;
    return null;
}

test "remembered load drops expired, unusable, local and duplicate seeds and keeps original times" {
    var memory = try Memory.init(a);
    defer memory.deinit(a);
    var prng = std.Random.DefaultPrng.init(1);
    const loaded = [_]Record{
        record(1, ip4(10, 0, 1), day_s - 1),
        record(2, ip4(10, 0, 2), day_s),
        record(3, .{ .ip4 = .{ .octets = .{ 10, 0, 0, 3 }, .port = 0 } }, 0),
        .{ .peer = local, .address = ip4(10, 0, 4), .qualified_at_s = now_s },
        record(5, ip4(10, 0, 5), 600),
        record(5, ip4(10, 0, 6), 60),
        record(5, ip4(10, 0, 7), 3_600),
        .{ .peer = peer(8), .address = ip4(10, 0, 8), .qualified_at_s = now_s + 3_600 },
    };
    memory.load(&loaded, &local, now_s, prng.random());
    try std.testing.expectEqual(@as(u16, 3), memory.count);
    try std.testing.expectEqual(@as(u64, 3), seeds(&memory, .loaded));
    try std.testing.expectEqual(@as(u64, 1), seeds(&memory, .expired));
    try std.testing.expectEqual(@as(u64, 2), seeds(&memory, .invalid));
    try std.testing.expectEqual(@as(u64, 2), seeds(&memory, .duplicate));
    var out: [remembered.capacity]Record = undefined;
    const records = snapshotOf(&memory, now_s, &out);
    try std.testing.expectEqual(now_s - (day_s - 1), find(records, 1).?.qualified_at_s);
    try std.testing.expectEqualDeep(record(5, ip4(10, 0, 6), 60), find(records, 5).?);
    try std.testing.expectEqual(now_s, find(records, 8).?.qualified_at_s);
    try std.testing.expectEqual(@as(usize, 2), snapshotOf(&memory, now_s + 1, &out).len);
    try std.testing.expectEqual(@as(u16, 2), memory.count);
    try std.testing.expect(find(snapshotOf(&memory, now_s + 1, &out), 1) == null);
}

test "remembered replay visits each loaded record once in shuffled prefix rounds" {
    var loaded: [9]Record = undefined;
    for (&loaded, 0..) |*value, index| {
        // Six records share 10.1/16, two share 10.2/16, and one sits in 10.3/16.
        const second: u8 = if (index < 6) 1 else if (index < 8) 2 else 3;
        value.* = record(@intCast(index + 1), ip4(10, second, @intCast(index)), 60);
    }
    var orders: [2][9]u8 = undefined;
    for (&orders, [_]u64{ 7, 8 }) |*order, seed| {
        var memory = try Memory.init(a);
        defer memory.deinit(a);
        var prng = std.Random.DefaultPrng.init(seed);
        memory.load(&loaded, &local, now_s, prng.random());
        var seen: [10]bool = @splat(false);
        for (order) |*tag| {
            const next = memory.nextReplay(now_s).?;
            tag.* = next.peer.bytes[0];
            try std.testing.expect(!seen[tag.*]);
            seen[tag.*] = true;
        }
        try std.testing.expect(memory.nextReplay(now_s) == null);
        // The first round takes one record from each prefix, the second one from each of the two
        // prefixes left, and the rest come from 10.1/16.
        var round: [3]u8 = @splat(0);
        for (order[0..3]) |tag| round[loaded[tag - 1].address.ip4.octets[1] - 1] += 1;
        try std.testing.expectEqual([3]u8{ 1, 1, 1 }, round);
        round = @splat(0);
        for (order[3..5]) |tag| round[loaded[tag - 1].address.ip4.octets[1] - 1] += 1;
        try std.testing.expectEqual([3]u8{ 1, 1, 0 }, round);
        for (order[5..]) |tag| try std.testing.expectEqual(@as(u8, 1), loaded[tag - 1].address.ip4.octets[1]);
    }
    try std.testing.expect(!std.mem.eql(u8, &orders[0], &orders[1]));
}

test "remembered replay skips forgotten records and drops records that expired before their turn" {
    var memory = try Memory.init(a);
    defer memory.deinit(a);
    var prng = std.Random.DefaultPrng.init(3);
    const loaded = [_]Record{ record(1, ip4(10, 1, 1), 60), record(2, ip4(10, 2, 2), day_s - 10), record(3, ip4(10, 3, 3), 60) };
    memory.load(&loaded, &local, now_s, prng.random());
    memory.forget(&peer(3));
    memory.qualify(&peer(4), ip4(10, 4, 4), now_s);
    const first = memory.nextReplay(now_s + 10).?;
    try std.testing.expect(first.peer.eql(&peer(1)));
    try std.testing.expect(memory.nextReplay(now_s + 10) == null);
    try std.testing.expectEqual(@as(u16, 2), memory.count);
    var out: [remembered.capacity]Record = undefined;
    const records = snapshotOf(&memory, now_s + 10, &out);
    try std.testing.expect(find(records, 2) == null and find(records, 3) == null);
}

test "remembered qualification keeps loaded records through a partial ramp and evicts the oldest when full" {
    var memory = try Memory.init(a);
    defer memory.deinit(a);
    var prng = std.Random.DefaultPrng.init(5);
    var loaded: [200]Record = undefined;
    for (&loaded, 0..) |*value, index| value.* = record(@intCast(index), ip4(10, @intCast(index / 8), @intCast(index)), 3_600 + index);
    memory.load(&loaded, &local, now_s, prng.random());
    // The first reconnects after a restart: ten remembered peers requalify and ten new ones join.
    for (0..10) |index| memory.qualify(&peer(@intCast(index)), ip4(172, 16, @intCast(index)), now_s + 300);
    for (200..210) |index| memory.qualify(&peer(@intCast(index)), ip4(172, 17, @intCast(index)), now_s + 300);
    var out: [remembered.capacity]Record = undefined;
    const records = snapshotOf(&memory, now_s + 300, &out);
    try std.testing.expectEqual(@as(usize, 210), records.len);
    try std.testing.expectEqualDeep(Record{ .peer = peer(3), .address = ip4(172, 16, 3), .qualified_at_s = now_s + 300 }, find(records, 3).?);
    try std.testing.expectEqualDeep(loaded[150], find(records, 150).?);
    for (210..256) |index| memory.qualify(&peer(@intCast(index)), ip4(172, 18, @intCast(index)), now_s + 400);
    try std.testing.expectEqual(@as(u16, remembered.capacity), memory.count);
    memory.qualify(&stranger, ip4(172, 19, 1), now_s + 500);
    try std.testing.expectEqual(@as(u16, remembered.capacity), memory.count);
    try std.testing.expect(find(snapshotOf(&memory, now_s + 500, &out), 199) == null);
    try std.testing.expect(find(snapshotOf(&memory, now_s + 500, &out), 198) != null);
}

test "remembered forgets a record on an identity mismatch only at its own endpoint" {
    var memory = try Memory.init(a);
    defer memory.deinit(a);
    memory.qualify(&peer(1), ip4(10, 1, 1), now_s);
    memory.forgetEndpoint(&peer(1), ip4(10, 1, 2));
    try std.testing.expectEqual(@as(u16, 1), memory.count);
    memory.forgetEndpoint(&peer(1), ip4(10, 1, 1));
    try std.testing.expectEqual(@as(u16, 0), memory.count);
    memory.forget(&peer(1));
    try std.testing.expectEqual(@as(u16, 0), memory.count);
}
