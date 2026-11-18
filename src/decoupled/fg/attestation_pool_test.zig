const std = @import("std");
const testing = std.testing;
const AttestationPool = @import("AttestationPool.zig");
const fg = @import("finality_types.zig");
const limits = @import("../limits.zig");

fn root(n: u32) fg.Root {
    var result: fg.Root = @splat(0);
    std.mem.writeInt(u32, result[0..4], n, .little);
    return result;
}
fn create() !*AttestationPool {
    const pool = try testing.allocator.create(AttestationPool);
    pool.init();
    return pool;
}
const All = struct {
    pub fn eligible(_: All, _: *const fg.Attestation) bool {
        return true;
    }
};
const Targets = struct {
    pub fn eligible(_: Targets, a: *const fg.Attestation) bool {
        return !a.tau;
    }
};

test "pool preserves order, rejects exact duplicates, and selects in pool order" {
    const pool = try create();
    defer testing.allocator.destroy(pool);
    const a: fg.Attestation = .{ .val_index = 0, .h = 1, .T = root(0), .tau = false };
    var b = a;
    b.tau = true;
    var future = a;
    future.h = 99;
    try testing.expect(try pool.add(&a));
    try testing.expect(try pool.add(&b));
    try testing.expect(try pool.add(&future));
    try testing.expect(!try pool.add(&a));
    try testing.expectEqual(@as(u32, 3), pool.entries.count);
    var selected: AttestationPool.List = undefined;
    try pool.select(Targets{}, &selected);
    try testing.expectEqual(@as(u32, 2), selected.count);
    try testing.expect(selected.buffer[0].eql(&a));
    try testing.expect(selected.buffer[1].eql(&future));
}

test "block absorption pools each distinct new row once" {
    const pool = try create();
    defer testing.allocator.destroy(pool);
    const a: fg.Attestation = .{ .val_index = 0, .h = 1, .T = root(0), .tau = false };
    var b = a;
    b.val_index = 1;
    try testing.expect(try pool.add(&a));
    const carried = [_]fg.Attestation{ a, b, b };
    try pool.checkCapacity(&carried);
    pool.absorb(&carried);
    try testing.expectEqual(@as(u32, 2), pool.entries.count);
    try testing.expect(pool.contains(&b));
}

test "pool capacity rejects atomically but duplicates and imports with no new rows still work" {
    const pool = try create();
    defer testing.allocator.destroy(pool);
    const a: fg.Attestation = .{ .val_index = 0, .h = 1, .T = root(0), .tau = false };
    _ = try pool.add(&a);
    for (1..limits.max_attestations) |i| {
        const entry: fg.Attestation = .{ .val_index = 0, .h = @intCast(100 + i), .T = root(99), .tau = false };
        _ = try pool.add(&entry);
    }
    try testing.expect(!try pool.add(&a));
    var next = a;
    next.val_index = 1;
    try testing.expectError(error.AttestationCapacity, pool.add(&next));
    try testing.expectError(error.AttestationCapacity, pool.checkCapacity(&.{next}));
    try pool.checkCapacity(&.{ a, a });
    pool.absorb(&.{ a, a });
    try testing.expectEqual(limits.max_attestations, pool.entries.count);
}

test "proposal output capacity cannot silently omit eligible pool rows" {
    const pool = try create();
    defer testing.allocator.destroy(pool);
    for (0..limits.max_attestations_per_block + 1) |i| {
        const a: fg.Attestation = .{
            .val_index = @intCast(i % 4),
            .h = 1,
            .T = root(0),
            .tau = false,
            .h_f = 0,
            .T_f = root(@intCast(i)),
        };
        _ = try pool.add(&a);
    }
    var out: AttestationPool.List = .{};
    try testing.expectError(error.AttestationCapacity, pool.select(All{}, &out));
    try testing.expectEqual(@as(u32, 0), out.count);
}
