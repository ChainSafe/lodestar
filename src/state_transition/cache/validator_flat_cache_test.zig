const std = @import("std");
const testing = std.testing;
const Node = @import("persistent_merkle_tree").Node;
const types = @import("consensus_types");

const Validator = types.phase0.Validator;
const Validators = types.phase0.Validators;
const flat = @import("validator_flat_cache.zig");
const ValidatorFlatCache = flat.ValidatorFlatCache;
const ValidatorFields = flat.ValidatorFields;

/// Number of validators whose cached fields differ from the tree.
fn countMismatches(cache: *const ValidatorFlatCache, root: Node.Id, list_len: usize) !usize {
    if (cache.len() != list_len) return std.math.maxInt(usize);
    var mismatches: usize = 0;
    const fields = cache.fields.slice();
    var it = Node.DepthIterator.init(cache.pool, root, @intCast(Validators.chunk_depth + 1), 0);
    for (0..list_len) |i| {
        const v = try Validator.tree.getValuePtr(try it.next(), cache.pool);
        if (!std.meta.eql(fields.get(i), ValidatorFields.fromValidator(v))) mismatches += 1;
    }
    return mismatches;
}

fn expectInSync(cache: *ValidatorFlatCache, view: *Validators.TreeView) !void {
    try view.commit();
    const list_len = try view.length();
    try cache.sync(Validators, view.getRoot(), list_len);
    try testing.expectEqual(@as(usize, 0), try countMismatches(cache, view.getRoot(), list_len));
}

fn testValidator(i: usize) Validator.Type {
    var v: Validator.Type = Validator.default_value;
    v.pubkey[0] = @intCast(i & 0xff);
    v.withdrawal_credentials[0] = if (i % 3 == 0) 2 else 1;
    v.effective_balance = 32_000_000_000;
    v.slashed = i % 7 == 0;
    v.activation_eligibility_epoch = i;
    v.activation_epoch = i + 1;
    v.exit_epoch = std.math.maxInt(u64);
    v.withdrawable_epoch = std.math.maxInt(u64);
    return v;
}

test "ValidatorFlatCache follows writes, appends, truncation and forks" {
    const allocator = testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    var list: Validators.Type = .empty;
    defer list.deinit(allocator);
    for (0..100) |i| try list.append(allocator, testValidator(i));

    const root = try Validators.tree.fromValue(&pool, &list);
    var view = try Validators.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    var cache = ValidatorFlatCache.init(allocator, &pool);
    defer cache.deinit();

    try expectInSync(&cache, view);
    try testing.expectEqual(@as(usize, 100), cache.last_patched);

    // Nothing changed: nothing patched.
    try expectInSync(&cache, view);
    try testing.expectEqual(@as(usize, 0), cache.last_patched);

    // Field writes patch only the touched validators.
    var fork = try view.clone(.{ .transfer_cache = false });
    defer fork.deinit();
    for ([_]usize{ 3, 64, 99 }) |i| {
        var v = try view.get(i);
        try v.set("exit_epoch", 1234 + i);
        try v.set("slashed", true);
    }
    try expectInSync(&cache, view);
    try testing.expectEqual(@as(usize, 3), cache.last_patched);

    // Appends, including across a power-of-two boundary.
    for (100..140) |i| {
        const v = testValidator(i);
        try view.pushValue(&v);
    }
    try expectInSync(&cache, view);
    try testing.expectEqual(@as(usize, 40), cache.last_patched);

    // A state on another branch: the diff runs both ways.
    {
        var v = try fork.get(10);
        try v.set("withdrawable_epoch", 77);
    }
    try expectInSync(&cache, fork);
    try expectInSync(&cache, view);

    // Truncation.
    var sliced = try view.sliceTo(49);
    defer sliced.deinit();
    try expectInSync(&cache, sliced);
    try testing.expectEqual(@as(usize, 50), cache.len());
    try expectInSync(&cache, view);
}

test "ValidatorFlatCache patches grown cells even where the trees match" {
    const allocator = testing.allocator;
    var pool = try Node.Pool.init(.{ .page_allocator = allocator, .allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();

    var list: Validators.Type = .empty;
    defer list.deinit(allocator);
    for (0..140) |i| try list.append(allocator, testValidator(i));

    const root = try Validators.tree.fromValue(&pool, &list);
    var view = try Validators.TreeView.init(allocator, &pool, root);
    defer view.deinit();

    var cache = ValidatorFlatCache.init(allocator, &pool);
    defer cache.deinit();

    // Sync a prefix only, so the synced tree has real nodes past the cached length.
    try view.commit();
    try cache.sync(Validators, view.getRoot(), 50);

    var v = try view.get(3);
    try v.set("exit_epoch", 1234);
    try expectInSync(&cache, view);
    try testing.expectEqual(@as(usize, 91), cache.last_patched);
}

fn expectProgressiveInSync(cache: *ValidatorFlatCache, view: *types.gloas.Validators.TreeView) !void {
    try view.commit();
    const count = try view.length();
    try cache.sync(types.gloas.Validators, view.getRoot(), count);
    const fields = cache.fields.slice();
    var it = view.iteratorReadonly(0);
    for (0..count) |i| try testing.expect(std.meta.eql(fields.get(i), ValidatorFields.fromValidator(try it.nextValuePtr())));
}

test "progressive ValidatorFlatCache diffs shared subtrees across growth truncation and layouts" {
    const allocator = testing.allocator;
    const Progressive = types.gloas.Validators;
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 8192 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    {
        var value: Progressive.Type = .empty;
        defer value.deinit(allocator);
        for (0..342) |i| try value.append(allocator, testValidator(i));
        const view = try Progressive.TreeView.fromValue(allocator, &pool, &value);
        defer view.deinit();
        const sibling = try view.clone(.{});
        defer sibling.deinit();
        var cache = ValidatorFlatCache.init(allocator, &pool);
        defer cache.deinit();
        try expectProgressiveInSync(&cache, view);
        try testing.expectEqual(@as(usize, 342), cache.last_patched);
        try expectProgressiveInSync(&cache, view);
        try testing.expectEqual(@as(usize, 0), cache.last_patched);
        for ([_]usize{ 0, 4, 5, 20, 21, 84, 85, 340, 341 }) |i| try (try view.get(i)).set("exit_epoch", 1234 + i);
        try expectProgressiveInSync(&cache, view);
        try testing.expectEqual(@as(usize, 9), cache.last_patched);
        try expectProgressiveInSync(&cache, sibling);
        try testing.expectEqual(@as(usize, 9), cache.last_patched);
        try expectProgressiveInSync(&cache, view);
        for (342..400) |i| try view.pushValue(&testValidator(i));
        try expectProgressiveInSync(&cache, view);
        try testing.expectEqual(@as(usize, 58), cache.last_patched);
        const shortened = try view.sliceTo(84);
        defer shortened.deinit();
        try expectProgressiveInSync(&cache, shortened);
        try testing.expectEqual(@as(usize, 0), cache.last_patched);
        try expectProgressiveInSync(&cache, view);
        try testing.expectEqual(@as(usize, 315), cache.last_patched);

        // The same packed validator payloads have compatible values but a different list shape.
        const before = try Validators.TreeView.fromValue(allocator, &pool, &value);
        defer before.deinit();
        try expectInSync(&cache, before);
        try testing.expectEqual(@as(usize, 342), cache.last_patched);
        try expectProgressiveInSync(&cache, sibling);
        try testing.expectEqual(@as(usize, 342), cache.last_patched);
        try cache.sync(types.gloas.Validators, sibling.getRoot(), 5);
        try expectProgressiveInSync(&cache, sibling);
        try testing.expectEqual(@as(usize, 337), cache.last_patched);
    }
    try testing.expectEqual(baseline, pool.getNodesInUse());
}

test "memory_safety: progressive ValidatorFlatCache initial and appended subtrees survive allocation failure" {
    const allocator = testing.allocator;
    const Progressive = types.gloas.Validators;
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    {
        var value: Progressive.Type = .empty;
        defer value.deinit(allocator);
        for (0..342) |i| try value.append(allocator, testValidator(i));
        const view = try Progressive.TreeView.fromValue(allocator, &pool, &value);
        defer view.deinit();
        var backing = testing.FailingAllocator.init(allocator, .{ .resize_fail_index = 0 });
        try testing.checkAllAllocationFailures(backing.allocator(), struct {
            fn run(cache_allocator: std.mem.Allocator, source: *Progressive.TreeView) !void {
                const source_pool = source.chunks.state.pool;
                const live_nodes = source_pool.getNodesInUse();
                defer testing.expectEqual(live_nodes, source_pool.getNodesInUse()) catch @panic("cache leaked tree nodes");
                var cache = ValidatorFlatCache.init(cache_allocator, source_pool);
                defer cache.deinit();
                var old_len: usize = 0;
                // Prefixes cover an empty cache, exact subtree boundaries, and a final
                // partial subtree. The retained tree stays identical through each fill.
                for ([_]usize{ 0, 5, 85, 342 }) |new_len| {
                    cache.sync(types.gloas.Validators, source.getRoot(), new_len) catch |err| {
                        try testing.expectEqual(@as(usize, 0), cache.len());
                        try testing.expectEqual(@as(?Node.Id, null), cache.synced_root);
                        return err;
                    };
                    try testing.expectEqual(new_len - old_len, cache.last_patched);
                    var it = source.iteratorReadonly(0);
                    for (0..new_len) |i| try testing.expect(std.meta.eql(
                        cache.fields.get(i),
                        ValidatorFields.fromValidator(try it.nextValuePtr()),
                    ));
                    old_len = new_len;
                }
                cache.invalidate();
                try expectProgressiveInSync(&cache, source);
                try testing.expectEqual(@as(usize, 342), cache.last_patched);
            }
        }.run, .{view});
    }
    try testing.expectEqual(baseline, pool.getNodesInUse());
}

test "ValidatorFlatCache derives bounded depth and limits from its schema" {
    const ssz = @import("ssz");
    const Small = ssz.FixedListType(Validator, 4, .{});
    const Large = ssz.FixedListType(Validator, 32, .{});
    const allocator = testing.allocator;
    var pool = try Node.Pool.init(.{ .allocator = allocator, .page_allocator = allocator, .pool_size = 4096 });
    defer pool.deinit();
    const baseline = pool.getNodesInUse();
    {
        var value: Small.Type = .empty;
        defer value.deinit(allocator);
        for (0..4) |i| try value.append(allocator, testValidator(i));
        const small = try Small.TreeView.fromValue(allocator, &pool, &value);
        defer small.deinit();
        const large = try Large.TreeView.fromValue(allocator, &pool, &value);
        defer large.deinit();
        var cache = ValidatorFlatCache.init(allocator, &pool);
        defer cache.deinit();

        try cache.sync(Small, small.getRoot(), 4);
        try cache.sync(Large, large.getRoot(), 4);
        try testing.expectEqual(@as(usize, 4), cache.last_patched);
        for (0..4) |i| try testing.expect(std.meta.eql(cache.fields.get(i), ValidatorFields.fromValidator(&value.items[i])));
        try (try large.get(2)).set("exit_epoch", 9);
        try large.commit();
        try cache.sync(Large, large.getRoot(), 4);
        try testing.expectEqual(@as(usize, 1), cache.last_patched);
        try testing.expectEqual(@as(u64, 9), cache.fields.get(2).exit_epoch);

        try cache.sync(Small, small.getRoot(), 4);
        try testing.expectEqual(@as(usize, 4), cache.last_patched);
        try testing.expectError(error.LengthOverLimit, cache.sync(Small, small.getRoot(), 5));
        try testing.expectEqual(@as(usize, 0), cache.len());
        try testing.expectEqual(@as(?Node.Id, null), cache.synced_root);
        try cache.sync(Small, small.getRoot(), 0);
        try testing.expectEqual(@as(usize, 0), cache.last_patched);
        try cache.sync(Small, small.getRoot(), 4);
        try testing.expectEqual(@as(usize, 4), cache.last_patched);
    }
    try testing.expectEqual(baseline, pool.getNodesInUse());
}
