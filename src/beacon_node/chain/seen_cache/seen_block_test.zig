const std = @import("std");
const testing = std.testing;
const types = @import("consensus_types");
const SeenBlock = @import("seen_block.zig").SeenBlock;
const Root = types.primitive.Root.Type;

test "SeenBlock copies bytes and keys, and returns explicit misses" {
    var cache = try SeenBlock.init(testing.allocator, .{});
    defer cache.deinit();

    try testing.expectEqual(0, cache.size());
    try testing.expectEqual(0, cache.byteSize());
    try testing.expect(cache.get(@splat(1)) == null);
    try testing.expect(!cache.has(@splat(1)));
    {
        var root: Root = @splat(1);
        const bytes = try testing.allocator.dupe(u8, "block");
        defer testing.allocator.free(bytes);
        try testing.expect(try cache.add(root, bytes));
        try testing.expect(cache.get(root).?.ptr != bytes.ptr);
        @memset(bytes, 0);
        root = @splat(2);
        try testing.expect(!cache.has(root));
    }

    try testing.expectEqualSlices(u8, "block", cache.get(@splat(1)).?);
    try testing.expect(cache.has(@splat(1)));
    try testing.expectEqual(1, cache.size());
    try testing.expectEqual(5, cache.byteSize());
}

test "SeenBlock preserves the first signature under the message root for every fork" {
    inline for (.{ types.phase0, types.altair, types.bellatrix, types.capella, types.deneb, types.electra, types.fulu, types.gloas, types.heze }) |fork| {
        errdefer std.debug.print("SeenBlock fork: {s}\n", .{@typeName(fork)});
        var cache = try SeenBlock.init(testing.allocator, .{});
        defer cache.deinit();

        const SignedBlock = fork.SignedBeaconBlock;
        var block = SignedBlock.default_value;
        defer SignedBlock.deinit(testing.allocator, &block);
        block.message.slot = 123;
        block.message.parent_root = @splat(3);
        block.message.state_root = @splat(4);
        block.signature = @splat(5);
        var root: Root = undefined;
        var signed_root: Root = undefined;
        try fork.BeaconBlock.hashTreeRoot(testing.allocator, &block.message, &root);
        try SignedBlock.hashTreeRoot(testing.allocator, &block, &signed_root);
        try testing.expect(!std.mem.eql(u8, &root, &signed_root));

        const bytes = try testing.allocator.alloc(u8, SignedBlock.serializedSize(&block));
        defer testing.allocator.free(bytes);
        _ = SignedBlock.serializeIntoBytes(&block, bytes);
        try testing.expect(try cache.add(root, bytes));
        try testing.expectEqualSlices(u8, bytes, cache.get(root).?);
        try testing.expect(cache.get(signed_root) == null);

        block.signature = @splat(6);
        _ = SignedBlock.serializeIntoBytes(&block, bytes);
        try testing.expect(!try cache.add(root, bytes));

        var decoded = SignedBlock.default_value;
        defer SignedBlock.deinit(testing.allocator, &decoded);
        try SignedBlock.deserializeFromBytes(testing.allocator, cache.get(root).?, &decoded);
        try testing.expectEqual(123, decoded.message.slot);
        try testing.expectEqualSlices(u8, &block.message.state_root, &decoded.message.state_root);
        try testing.expectEqualSlices(u8, &@as([96]u8, @splat(5)), &decoded.signature);
        var decoded_root: Root = undefined;
        try fork.BeaconBlock.hashTreeRoot(testing.allocator, &decoded.message, &decoded_root);
        try testing.expectEqualSlices(u8, &root, &decoded_root);
    }
}

test "SeenBlock evicts by insertion order without refreshing on reads or duplicates" {
    var cache = try SeenBlock.init(testing.allocator, .{ .max_blocks = 2 });
    defer cache.deinit();

    _ = try cache.add(@splat(1), "first");
    _ = try cache.add(@splat(2), "second");
    const first = cache.get(@splat(1)).?;
    try testing.expect(cache.has(@splat(1)));
    try testing.expect(!try cache.add(@splat(1), "different bytes"));
    try testing.expectEqual(first.ptr, cache.get(@splat(1)).?.ptr);
    try testing.expectEqualSlices(u8, "first", first);
    try testing.expectEqual(11, cache.byteSize());

    _ = try cache.add(@splat(3), "third");
    try testing.expect(cache.get(@splat(1)) == null);
    try testing.expect(cache.has(@splat(2)));
    try testing.expect(cache.has(@splat(3)));
    try testing.expectEqual(2, cache.size());
    try testing.expectEqual(11, cache.byteSize());
}

test "SeenBlock byte limit evicts multiple blocks and accepts exact limits" {
    var cache = try SeenBlock.init(testing.allocator, .{ .max_blocks = 4, .max_bytes = 6, .max_block_bytes = 6 });
    defer cache.deinit();

    _ = try cache.add(@splat(1), "aa");
    _ = try cache.add(@splat(2), "bb");
    _ = try cache.add(@splat(3), "cc");
    try testing.expectEqual(6, cache.byteSize());
    _ = try cache.add(@splat(4), "dddd");
    try testing.expect(!cache.has(@splat(1)));
    try testing.expect(!cache.has(@splat(2)));
    try testing.expectEqualSlices(u8, "cc", cache.get(@splat(3)).?);
    try testing.expectEqual(2, cache.size());
    try testing.expectEqual(6, cache.byteSize());

    _ = try cache.add(@splat(5), "eeeeee");
    try testing.expect(!cache.has(@splat(3)));
    try testing.expect(!cache.has(@splat(4)));
    try testing.expectEqualSlices(u8, "eeeeee", cache.get(@splat(5)).?);
    try testing.expectEqual(1, cache.size());
    try testing.expectEqual(6, cache.byteSize());
}

test "SeenBlock rejects invalid limits before allocating" {
    var failing = testing.FailingAllocator.init(testing.allocator, .{ .fail_index = 0 });
    inline for (.{
        SeenBlock.Opts{ .max_blocks = 0 },
        SeenBlock.Opts{ .max_bytes = 0 },
        SeenBlock.Opts{ .max_block_bytes = 0 },
        SeenBlock.Opts{ .max_bytes = 1, .max_block_bytes = 2 },
    }) |opts| {
        try testing.expectError(error.InvalidOptions, SeenBlock.init(failing.allocator(), opts));
    }
    try testing.expect(!failing.has_induced_failure);
}

test "SeenBlock rejects empty and oversized new entries without evicting" {
    var failing = testing.FailingAllocator.init(testing.allocator, .{});
    var cache = try SeenBlock.init(failing.allocator(), .{ .max_blocks = 1, .max_bytes = 4, .max_block_bytes = 3 });
    defer cache.deinit();

    _ = try cache.add(@splat(1), "abc");
    const resident = cache.get(@splat(1)).?;
    failing.fail_index = failing.alloc_index;
    try testing.expectError(error.EmptyBlock, cache.add(@splat(2), ""));
    try testing.expectError(error.BlockTooLarge, cache.add(@splat(2), "abcd"));
    try testing.expect(!try cache.add(@splat(1), ""));
    try testing.expect(!try cache.add(@splat(1), "oversized duplicate"));
    try testing.expect(!failing.has_induced_failure);
    try testing.expectEqual(1, cache.size());
    try testing.expectEqual(3, cache.byteSize());
    try testing.expectEqual(resident.ptr, cache.get(@splat(1)).?.ptr);
    try testing.expectEqualSlices(u8, "abc", resident);
}

test "SeenBlock removal preserves remaining borrows and reinsertions are newest" {
    var cache = try SeenBlock.init(testing.allocator, .{ .max_blocks = 3 });
    defer cache.deinit();

    _ = try cache.add(@splat(1), "a");
    _ = try cache.add(@splat(2), "bb");
    _ = try cache.add(@splat(3), "ccc");
    const third = cache.get(@splat(3)).?;
    try testing.expect(cache.remove(@splat(2)));
    try testing.expect(!cache.remove(@splat(2)));
    try testing.expectEqual(4, cache.byteSize());
    try testing.expectEqual(third.ptr, cache.get(@splat(3)).?.ptr);
    _ = try cache.add(@splat(2), "new");
    _ = try cache.add(@splat(4), "dddd");
    try testing.expect(!cache.has(@splat(1)));
    _ = try cache.add(@splat(5), "e");
    try testing.expect(!cache.has(@splat(3)));
    try testing.expectEqualSlices(u8, "new", cache.get(@splat(2)).?);
    try testing.expectEqual(8, cache.byteSize());
    try testing.expect(cache.remove(@splat(2)));
    try testing.expect(cache.remove(@splat(4)));
    try testing.expect(cache.remove(@splat(5)));
    try testing.expectEqual(0, cache.size());
    try testing.expectEqual(0, cache.byteSize());
}

test "SeenBlock clear releases bytes and permits reuse" {
    var cache = try SeenBlock.init(testing.allocator, .{ .max_blocks = 1 });
    defer cache.deinit();

    cache.clear();
    _ = try cache.add(@splat(1), "old");
    cache.clear();
    try testing.expectEqual(0, cache.size());
    try testing.expectEqual(0, cache.byteSize());
    try testing.expect(cache.get(@splat(1)) == null);
    cache.clear();
    _ = try cache.add(@splat(1), "new");
    try testing.expectEqualSlices(u8, "new", cache.get(@splat(1)).?);
    try testing.expectEqual(3, cache.byteSize());
}

test "SeenBlock copies borrowed input before evicting it" {
    var cache = try SeenBlock.init(testing.allocator, .{ .max_blocks = 1 });
    defer cache.deinit();

    _ = try cache.add(@splat(1), "block");
    _ = try cache.add(@splat(2), cache.get(@splat(1)).?);
    try testing.expect(!cache.has(@splat(1)));
    try testing.expectEqualSlices(u8, "block", cache.get(@splat(2)).?);
    try testing.expectEqual(1, cache.size());
    try testing.expectEqual(5, cache.byteSize());
}

test "SeenBlock consumer copy survives eviction clear and destruction" {
    const copy = blk: {
        var cache = try SeenBlock.init(testing.allocator, .{ .max_blocks = 1 });
        defer cache.deinit();
        _ = try cache.add(@splat(1), "replay block");
        const owned = try testing.allocator.dupe(u8, cache.get(@splat(1)).?);
        errdefer testing.allocator.free(owned);
        _ = try cache.add(@splat(2), "another block");
        cache.clear();
        _ = try cache.add(@splat(3), "last block");
        break :blk owned;
    };
    defer testing.allocator.free(copy);
    try testing.expectEqualSlices(u8, "replay block", copy);
}

test "SeenBlock allocation failure preserves residents borrows and FIFO for retry" {
    var failing = testing.FailingAllocator.init(testing.allocator, .{});
    var cache = try SeenBlock.init(failing.allocator(), .{ .max_blocks = 2, .max_bytes = 4, .max_block_bytes = 4 });
    defer cache.deinit();

    _ = try cache.add(@splat(1), "aa");
    _ = try cache.add(@splat(2), "bb");
    const first = cache.get(@splat(1)).?;
    const second = cache.get(@splat(2)).?;
    failing.fail_index = failing.alloc_index;
    try testing.expectError(error.OutOfMemory, cache.add(@splat(3), "cccc"));
    try testing.expectEqual(2, cache.size());
    try testing.expectEqual(4, cache.byteSize());
    try testing.expectEqual(first.ptr, cache.get(@splat(1)).?.ptr);
    try testing.expectEqual(second.ptr, cache.get(@splat(2)).?.ptr);
    try testing.expectEqualSlices(u8, "aa", first);
    try testing.expectEqualSlices(u8, "bb", second);
    try testing.expect(!cache.has(@splat(3)));

    failing.fail_index = std.math.maxInt(usize);
    _ = try cache.add(@splat(3), "cc");
    try testing.expect(!cache.has(@splat(1)));
    try testing.expectEqual(second.ptr, cache.get(@splat(2)).?.ptr);
    try testing.expect(cache.has(@splat(3)));
}

test "SeenBlock cleans up every allocation failure during initialization and insertion" {
    try testing.checkAllAllocationFailures(testing.allocator, struct {
        fn run(allocator: std.mem.Allocator) !void {
            var cache = try SeenBlock.init(allocator, .{ .max_blocks = 32 });
            defer cache.deinit();
            _ = try cache.add(@splat(1), "first");
            _ = try cache.add(@splat(2), "second");
            cache.clear();
            _ = try cache.add(@splat(3), "third");
        }
    }.run, .{});
}

test "SeenBlock retains correct bounds and FIFO through repeated churn" {
    var cache = try SeenBlock.init(testing.allocator, .{ .max_blocks = 16, .max_bytes = 17, .max_block_bytes = 2 });
    defer cache.deinit();
    for (0..1000) |i| {
        errdefer std.debug.print("SeenBlock insertion: {d}\n", .{i});
        var root: Root = @splat(0);
        std.mem.writeInt(u64, root[0..8], i, .little);
        _ = try cache.add(root, "ab");
        const expected_count: usize = @min(i + 1, 8);
        try testing.expectEqual(expected_count, cache.size());
        try testing.expectEqual(2 * expected_count, cache.byteSize());
        try testing.expectEqualSlices(u8, "ab", cache.get(root).?);
        if (i >= 8) {
            std.mem.writeInt(u64, root[0..8], i - 8, .little);
            try testing.expect(!cache.has(root));
        }
    }
}
