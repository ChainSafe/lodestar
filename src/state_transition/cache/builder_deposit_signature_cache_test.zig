const std = @import("std");
const Cache = @import("builder_deposit_signature_cache.zig").BuilderDepositSignatureCache;
const CacheRc = @import("builder_deposit_signature_cache.zig").BuilderDepositSignatureCacheRc;

test "deposit signature cache uses PendingDeposit roots" {
    const allocator = std.testing.allocator;
    var cache: Cache = .{ .hash_context = .{ .hash_key = @splat(0) } };
    defer cache.deinit(allocator);
    const root: [32]u8 = @splat(0);
    try cache.put(allocator, root, false);
    try std.testing.expectEqual(@as(?bool, false), cache.get(root));
    var changed = root;
    changed[0] = 1;
    try std.testing.expectEqual(@as(?bool, null), cache.get(changed));
}

test "deposit signature cache bounds both maps and clear releases shared contents" {
    const allocator = std.testing.allocator;
    const rc = try CacheRc.create(allocator, .{ .hash_context = .{ .hash_key = @splat(0) }, .capacity = 2 });
    defer rc.unref();
    const shared = rc.ref();
    defer shared.unref();
    for (0..3) |index| {
        var root: [32]u8 = @splat(0);
        root[0] = @intCast(index);
        var pubkey: [48]u8 = @splat(0);
        pubkey[0] = @intCast(index);
        try rc.instance.addBuilderPubkey(allocator, pubkey);
        try rc.instance.put(allocator, root, index == 0);
        try std.testing.expectEqual(@as(?bool, if (index == 2) null else index == 0), shared.instance.get(root));
    }
    try std.testing.expectEqual(@as(usize, 2), rc.instance.validity.count());
    try std.testing.expectEqual(@as(usize, 2), rc.instance.builder_pubkeys.count());
    rc.instance.scan_cursor = 100;
    shared.instance.clear(allocator);
    try std.testing.expectEqual(@as(usize, 0), rc.instance.validity.count());
    try std.testing.expectEqual(@as(usize, 0), rc.instance.builder_pubkeys.count());
    try std.testing.expectEqual(@as(usize, 0), rc.instance.scan_cursor);
}

fn insertWithAllocationFailures(allocator: std.mem.Allocator) !void {
    const rc = try CacheRc.create(allocator, .{ .hash_context = .{ .hash_key = @splat(0) } });
    defer rc.unref();
    try rc.instance.addBuilderPubkey(allocator, @splat(0));
    try rc.instance.put(allocator, @splat(0), false);
}

test "memory_safety: deposit signature cache partial initialization and insertion" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, insertWithAllocationFailures, .{});
}
