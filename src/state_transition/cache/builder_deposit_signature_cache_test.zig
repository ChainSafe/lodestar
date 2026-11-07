const std = @import("std");
const ct = @import("consensus_types");
const config_module = @import("config");
const Cache = @import("builder_deposit_signature_cache.zig").BuilderDepositSignatureCache;
const CacheRc = @import("builder_deposit_signature_cache.zig").BuilderDepositSignatureCacheRc;

test "deposit signature cache keys cover signed data, signature and domain but not slot" {
    const allocator = std.testing.allocator;
    var config = config_module.BeaconConfig.init(config_module.mainnet.chain_config, @splat(0));
    var cache: Cache = .{ .hash_context = .{ .hash_key = @splat(0) } };
    defer cache.deinit(allocator);
    const deposit = ct.electra.PendingDeposit.default_value;
    try cache.put(allocator, &config, &deposit, false);
    try std.testing.expectEqual(@as(?bool, false), try cache.get(&config, &deposit));
    inline for (.{ "pubkey", "withdrawal_credentials", "signature" }) |field| {
        var changed = deposit;
        @field(changed, field)[0] = 1;
        try std.testing.expectEqual(@as(?bool, null), try cache.get(&config, &changed));
    }
    var changed = deposit;
    changed.amount += 1;
    try std.testing.expectEqual(@as(?bool, null), try cache.get(&config, &changed));
    changed = deposit;
    changed.slot += 1;
    try std.testing.expectEqual(@as(?bool, false), try cache.get(&config, &changed));
    config.chain.GENESIS_FORK_VERSION[0] ^= 1;
    try std.testing.expectEqual(@as(?bool, null), try cache.get(&config, &deposit));
}

test "deposit signature cache bounds both maps and clear releases shared contents" {
    const allocator = std.testing.allocator;
    const config = config_module.BeaconConfig.init(config_module.mainnet.chain_config, @splat(0));
    const rc = try CacheRc.create(allocator, .{ .hash_context = .{ .hash_key = @splat(0) }, .capacity = 2 });
    defer rc.unref();
    const shared = rc.ref();
    defer shared.unref();
    for (0..3) |index| {
        var deposit = ct.electra.PendingDeposit.default_value;
        deposit.pubkey[0] = @intCast(index);
        try rc.instance.addBuilderPubkey(allocator, deposit.pubkey);
        try rc.instance.put(allocator, &config, &deposit, index == 0);
        try std.testing.expectEqual(@as(?bool, if (index == 2) null else index == 0), try shared.instance.get(&config, &deposit));
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
    const config = config_module.BeaconConfig.init(config_module.mainnet.chain_config, @splat(0));
    const rc = try CacheRc.create(allocator, .{ .hash_context = .{ .hash_key = @splat(0) } });
    defer rc.unref();
    const deposit = ct.electra.PendingDeposit.default_value;
    try rc.instance.addBuilderPubkey(allocator, deposit.pubkey);
    try rc.instance.put(allocator, &config, &deposit, false);
}

test "memory_safety: deposit signature cache partial initialization and insertion" {
    try std.testing.checkAllAllocationFailures(std.testing.allocator, insertWithAllocationFailures, .{});
}
